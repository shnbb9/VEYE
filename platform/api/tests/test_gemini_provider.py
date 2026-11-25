"""The Gemini provider, without a Google Cloud project.

Nothing here reaches Google. The SDK client is injected, so what is tested is
the part VEYE owns: which prompts are allowed to leave, which credentials are
allowed to carry them, and that the default deployment still runs the offline
mock.
"""

from __future__ import annotations

import pytest

from app.companion.providers.gemini import (
    GeminiLLMProvider,
    MemberDataNotCleared,
    carries_member_data,
)
from app.companion.providers.llm import (
    ClientContentNotAllowed,
    DataClassification,
    LLMMessage,
    LLMRequest,
    MockLLMProvider,
    ProviderNotConfigured,
    UnconfiguredLLMProvider,
    build_llm_provider,
)


class FakeVertex:
    """Stands in for google-genai. Records what it was asked to send."""

    def __init__(self, text="A short answer."):
        self.text = text
        self.sent: list[dict] = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.sent.append({"model": model, "contents": contents, "config": config})
        return type("R", (), {"text": self.text, "usage_metadata": None, "candidates": []})()


def _request(system: str, classification: DataClassification = DataClassification.REAL_MEMBER,
             *, message: str = "How am I doing?", client_content: bool | None = None) -> LLMRequest:
    return LLMRequest(system=system, messages=(LLMMessage(role="user", content=message),),
                      client_content=client_content, classification=classification)


WITH_CONTEXT = (
    "## ROLE\nYou are Sprout.\n\n## MEMBER CONTEXT\n"
    "- health_number: 2.4 (good; balanced pattern; improved since the previous result)\n"
)
WITHOUT_CONTEXT = "## ROLE\nYou are Sprout.\n\n## APPROVED KNOWLEDGE\nSomething general.\n"
EMPTY_CONTEXT = (
    "## ROLE\nYou are Sprout.\n\n## MEMBER CONTEXT\n"
    "- health_number: not available (no Health Number saved yet)\n"
    "- mood: not available (no moods logged yet)\n"
)


# ---- what counts as member data --------------------------------------------

def test_a_prompt_is_phi_bearing_only_when_the_context_actually_says_something():
    assert carries_member_data(_request(WITH_CONTEXT)) is True
    assert carries_member_data(_request(WITHOUT_CONTEXT, DataClassification.GENERAL)) is False
    # The section exists but every line is "not available" — that is a statement
    # about absence, not about the member.
    assert carries_member_data(_request(EMPTY_CONTEXT, DataClassification.REAL_MEMBER)) is False


def test_the_check_reads_the_prompt_rather_than_trusting_a_caller_flag():
    """A new caller that forgets a flag would otherwise get the permissive
    answer, which is the wrong way round for this decision."""
    sneaky = LLMRequest(system=WITH_CONTEXT, messages=(LLMMessage(role="user", content="hi"),),
                        metadata={"contains_member_data": "false"},
                        classification=DataClassification.REAL_MEMBER)
    assert carries_member_data(sneaky) is True


# ---- the clearance gate -----------------------------------------------------

def test_member_context_is_refused_until_a_deployment_is_cleared_for_it():
    vertex = FakeVertex()
    provider = GeminiLLMProvider(backend="vertex", project="veye-dev", location="us", model="gemini-3.8-flash",
                                 member_data_cleared=False, client=vertex)
    with pytest.raises(MemberDataNotCleared) as refused:
        provider.complete(_request(WITH_CONTEXT))
    assert "BAA" in str(refused.value)
    assert vertex.sent == [], "member context reached the model despite the gate"


def test_the_refusal_is_a_failure_not_a_quiet_strip():
    """An answer confidently built from a prompt whose context was silently
    removed is worse than no answer at all."""
    vertex = FakeVertex()
    provider = GeminiLLMProvider(backend="vertex", project="veye-dev", location="us", model="m",
                                 member_data_cleared=False, client=vertex)
    with pytest.raises(ProviderNotConfigured):
        provider.complete(_request(WITH_CONTEXT))
    assert len(vertex.sent) == 0


def test_a_prompt_without_member_context_goes_through_uncleared():
    vertex = FakeVertex()
    provider = GeminiLLMProvider(backend="vertex", project="veye-dev", location="us", model="gemini-3.8-flash",
                                 member_data_cleared=False, client=vertex)
    answer = provider.complete(_request(WITHOUT_CONTEXT, DataClassification.GENERAL))
    assert answer.text == "A short answer."
    assert answer.provider == "gemini"
    assert len(vertex.sent) == 1


def test_once_cleared_member_context_is_sent():
    vertex = FakeVertex()
    provider = GeminiLLMProvider(backend="vertex", project="veye-prod", location="us", model="gemini-3.8-flash",
                                 member_data_cleared=True, client=vertex)
    provider.complete(_request(WITH_CONTEXT))
    assert len(vertex.sent) == 1
    assert "MEMBER CONTEXT" in vertex.sent[0]["config"]["system_instruction"]


# ---- credentials -------------------------------------------------------------

def test_a_personal_api_key_is_refused_in_production():
    with pytest.raises(ProviderNotConfigured) as refused:
        GeminiLLMProvider(backend="developer", model="m", api_key="dev-key", local=False)
    assert "production identity" in str(refused.value).lower() or "Application Default" in str(refused.value)


def test_a_personal_api_key_may_never_carry_member_data():
    with pytest.raises(ProviderNotConfigured) as refused:
        GeminiLLMProvider(backend="developer", local=True, model="m",
                          api_key="dev-key", member_data_cleared=True)
    assert "service identity" in str(refused.value)


def test_vertex_needs_a_project():
    with pytest.raises(ProviderNotConfigured) as refused:
        GeminiLLMProvider(backend="vertex", project="", location="us", model="m")
    assert "VEYE_GCP_PROJECT" in str(refused.value)


def test_vertex_uses_the_services_own_identity_not_a_key_file():
    provider = GeminiLLMProvider(backend="vertex", project="veye-prod", location="eu", model="gemini-3.8-flash",
                                 client=FakeVertex())
    described = provider.describe()
    assert described["auth"] == "application default credentials"
    assert described["project"] == "veye-prod"
    assert described["location"] == "eu"
    assert described["external"] is True
    assert described["member_data_cleared"] is False


# ---- no web grounding ---------------------------------------------------------

def test_sprout_never_reaches_the_open_web():
    """Approved Veye knowledge and the member's own summaries, nothing else."""
    vertex = FakeVertex()
    GeminiLLMProvider(backend="vertex", project="veye-dev", location="us", model="m", client=vertex).complete(
        _request(WITHOUT_CONTEXT, DataClassification.GENERAL))
    assert vertex.sent[0]["config"]["tools"] == []


# ---- the default deployment ----------------------------------------------------

def test_the_default_provider_is_still_the_offline_mock():
    provider = build_llm_provider("mock", groq_api_key=None, groq_model="x", timeout_seconds=5)
    assert isinstance(provider, MockLLMProvider)


def test_a_misconfigured_gemini_deployment_boots_and_reports_itself():
    """The API must not fail to start because a cloud setting is missing; the
    Companion reports the absence instead of answering anyway."""
    provider = build_llm_provider("gemini", groq_api_key=None, groq_model="x", timeout_seconds=5,
                                  gemini={"backend": "vertex", "project": "", "location": "us-central1", "model": "m"})
    assert isinstance(provider, UnconfiguredLLMProvider)
    assert provider.describe()["configured"] is False
    with pytest.raises(ProviderNotConfigured):
        provider.complete(_request(WITHOUT_CONTEXT, DataClassification.GENERAL))


def test_the_settings_default_to_nothing_connected_and_nothing_cleared(monkeypatch):
    """With nothing in the environment: conftest sets these, and a default
    nobody looked at could say anything."""
    import os

    from app.core.config import Settings

    for name in [n for n in os.environ if n.startswith("VEYE_")]:
        monkeypatch.delenv(name)
    defaults = Settings(_env_file=None, database_url="sqlite:///./unused.db")
    assert (defaults.llm_provider, defaults.embedding_provider, defaults.gemini_backend) == ("mock", "hashing", "")
    assert (defaults.gemini_model, defaults.gcp_location, defaults.embedding_location) == ("gemini-3.8-flash", "us", "us-central1")
    assert (defaults.embedding_dimensions, defaults.embedding_model) == (256, "")
    assert defaults.gcp_project is None and defaults.gemini_api_key is None
    assert defaults.gemini_member_data_cleared is False


def test_no_key_is_ever_printed_with_the_settings():
    """A repr of the settings reaches tracebacks and log lines. Every key in
    them is a SecretStr, so the value is never part of that text, and the one
    place that needs it unwraps it on purpose."""
    from app.core.config import Settings, reveal

    keys = {"gemini_api_key": "gemini-canary-1f3a", "groq_api_key": "groq-canary-2b4c",
            "langfuse_secret_key": "langfuse-canary-3d5e", "telemetry_pseudonym_key": "pseudonym-canary-4f6a",
            "smtp_password": "smtp-canary-5a7b", "prospect_encryption_keys": "prospect-canary-6c8d"}
    configured = Settings(database_url="sqlite:///./unused.db", **keys)
    printed = repr(configured) + str(configured) + str(configured.model_dump())
    for name, value in keys.items():
        assert value not in printed, f"{name} is printed with the settings"
        assert reveal(getattr(configured, name)) == value


# ---- the trust boundary, by classification ---------------------------------
# A heading in a prompt describes the prompt. The classification states whose
# data it is, decided from server state when the request was built. These are
# the cases the heading check could not see.

def test_a_personal_tip_for_a_real_member_cannot_leave_through_an_api_key():
    """The Personal Tip puts a member's summaries in the USER message under no
    heading at all, so nothing in the prompt's text marks it as theirs."""
    vertex = FakeVertex()
    developer = GeminiLLMProvider(backend="developer", local=True, model="m",
                                  api_key="dev-key", client=vertex)
    tip_like = LLMRequest(
        system="You are Sprout, writing one short personal note.",
        messages=(LLMMessage(role="user", content="Summary of this member:\n- mood: 21 day(s) logged, balance 74/100"),),
        classification=DataClassification.REAL_MEMBER,
    )
    assert carries_member_data(tip_like) is False, "the heading check cannot see this, which is the point"
    with pytest.raises(MemberDataNotCleared):
        developer.complete(tip_like)
    assert vertex.sent == []


def test_ordinary_real_member_chat_cannot_use_an_api_key_even_with_an_empty_context():
    """A member typing their own health information is a disclosure whatever
    the context block says."""
    vertex = FakeVertex()
    developer = GeminiLLMProvider(backend="developer", local=True, model="m",
                                  api_key="dev-key", client=vertex)
    typed = _request(EMPTY_CONTEXT, DataClassification.REAL_MEMBER,
                     message="My fasting glucose was 6.2 this morning, should I worry?")
    assert carries_member_data(typed) is False
    with pytest.raises(MemberDataNotCleared) as refused:
        developer.complete(typed)
    assert "developer API key" in str(refused.value)
    assert vertex.sent == []


def test_a_synthetic_member_may_use_an_api_key():
    """Seeded demo accounts and disposable E2E identities are what a developer
    key is for."""
    vertex = FakeVertex()
    developer = GeminiLLMProvider(backend="developer", local=True, model="m",
                                  api_key="dev-key", client=vertex)
    answer = developer.complete(_request(WITH_CONTEXT, DataClassification.SYNTHETIC_MEMBER))
    assert answer.text == "A short answer."
    assert len(vertex.sent) == 1


def test_general_evaluation_with_no_member_may_use_an_api_key():
    vertex = FakeVertex()
    developer = GeminiLLMProvider(backend="developer", local=True, model="m",
                                  api_key="dev-key", client=vertex)
    developer.complete(_request(WITHOUT_CONTEXT, DataClassification.GENERAL, client_content=False))
    assert len(vertex.sent) == 1


def test_the_clients_own_documents_never_leave_through_an_api_key():
    """Approved knowledge is the client's work. On a developer key only what
    was written for demonstration is sent, whoever is asking."""
    sent = FakeVertex()
    developer = GeminiLLMProvider(backend="developer", local=True, model="m", api_key="dev-key", client=sent)
    for classification in (DataClassification.GENERAL, DataClassification.SYNTHETIC_MEMBER):
        # Said to be theirs, or not said at all and visibly there.
        for said in (True, None):
            with pytest.raises(ClientContentNotAllowed) as refused:
                developer.complete(_request(WITHOUT_CONTEXT, classification, client_content=said))
            assert "only through Vertex AI" in str(refused.value)
    assert sent.sent == []
    # Synthetic passages, or none at all.
    developer.complete(_request(WITHOUT_CONTEXT, DataClassification.SYNTHETIC_MEMBER, client_content=False))
    developer.complete(_request("## APPROVED KNOWLEDGE\n(none retrieved for this topic)\n", DataClassification.SYNTHETIC_MEMBER))
    assert len(sent.sent) == 2
    GeminiLLMProvider(backend="vertex", project="veye-prod", location="us", model="m", client=sent).complete(
        _request(WITHOUT_CONTEXT, DataClassification.SYNTHETIC_MEMBER, client_content=True))
    assert len(sent.sent) == 3


def test_whose_passages_they_are_is_said_by_the_source_and_survives_the_privacy_filter():
    from types import SimpleNamespace

    from app.companion.context import MemberContext
    from app.companion.privacy import KnownIdentifiers, OutboundPrivacyFilter
    from app.companion.prompt import PromptBuilder
    from app.knowledge.service import RetrievedChunk

    def passage(**kwargs):
        return RetrievedChunk(source_id="s", document_id="d", chunk_id="c", source_title="Guide", source_version=1, scope_key="help",
                              heading=None, text="Text.", score=1.0, **kwargs)

    for passages, theirs, quoted in (([], False, False), ([passage(synthetic=True)], False, False), ([passage()], True, False),
                                     ([passage(synthetic=True), passage(synthetic=False)], True, False), ([passage(synthetic=True)], True, True)):
        built = PromptBuilder().build(decision=SimpleNamespace(category="help", policy_version="1"), passages=passages, context=MemberContext(scopes=()),
                                      history=[], message="Hello", classification=DataClassification.SYNTHETIC_MEMBER, quoted=quoted)
        filtered, _ = OutboundPrivacyFilter(KnownIdentifiers(names=(), emails=(), ids=())).filter_request(built)
        assert built.client_content is filtered.client_content is theirs, passages


def test_production_still_refuses_a_real_member_until_the_gate_is_cleared():
    vertex = FakeVertex()
    uncleared = GeminiLLMProvider(backend="vertex", project="veye-prod", location="us", model="m",
                                  member_data_cleared=False, client=vertex)
    with pytest.raises(MemberDataNotCleared):
        uncleared.complete(_request(WITH_CONTEXT, DataClassification.REAL_MEMBER))
    assert vertex.sent == []

    cleared = GeminiLLMProvider(backend="vertex", project="veye-prod", location="us", model="m",
                                member_data_cleared=True, client=vertex)
    cleared.complete(_request(WITH_CONTEXT, DataClassification.REAL_MEMBER))
    assert len(vertex.sent) == 1
    # Synthetic and general never needed the gate.
    cleared_none = GeminiLLMProvider(backend="vertex", project="veye-prod", location="us", model="m", client=vertex)
    cleared_none.complete(_request(WITH_CONTEXT, DataClassification.SYNTHETIC_MEMBER))
    assert len(vertex.sent) == 2


def test_nothing_a_browser_sends_can_downgrade_the_classification():
    """It comes from the principal, and the principal comes from the session.
    Sign-up forbids unknown fields, so `is_synthetic` is unreachable from
    outside; and a request that claims general while visibly carrying member
    context is refused rather than believed."""
    from app.auth.schemas import SignUpRequest

    assert SignUpRequest.model_config.get("extra") == "forbid"
    assert "is_synthetic" not in SignUpRequest.model_fields

    vertex = FakeVertex()
    provider = GeminiLLMProvider(backend="vertex", project="veye-prod", location="us", model="m",
                                 member_data_cleared=True, client=vertex)
    lying = LLMRequest(system=WITH_CONTEXT, messages=(LLMMessage(role="user", content="hi"),),
                       metadata={"classification": "general"},
                       classification=DataClassification.GENERAL)
    with pytest.raises(MemberDataNotCleared) as refused:
        provider.complete(lying)
    assert "classified as general" in str(refused.value)
    assert vertex.sent == []


def test_the_classification_survives_the_privacy_filter():
    """Scrubbing identifiers out does not make a real member's prompt general."""
    from app.companion.privacy import KnownIdentifiers, OutboundPrivacyFilter

    known = KnownIdentifiers(names=("Aditya",), emails=("aditya.demo@demo.veye.test",), ids=())
    before = LLMRequest(system=WITH_CONTEXT,
                        messages=(LLMMessage(role="user", content="I am Aditya"),),
                        classification=DataClassification.REAL_MEMBER)
    after, _ = OutboundPrivacyFilter(known).filter_request(before)
    assert after.classification is DataClassification.REAL_MEMBER


def test_every_request_must_choose_a_classification():
    """No default, so a new caller is a decision rather than an omission that
    silently inherits the permissive answer."""
    with pytest.raises(TypeError):
        LLMRequest(system="x", messages=())  # type: ignore[call-arg]


# ---- the model and the region ------------------------------------------------
# Checked against Google's documentation on 9 Nov 2026. These assertions exist
# so that the next model retirement is a failing test rather than a NOT_FOUND
# in front of a member.

def test_the_default_model_is_one_that_still_exists():
    """gemini-2.0-flash, the previous default, was retired on 1 June 2026."""
    from app.companion.providers.gemini import DEFAULT_MODEL
    from app.core.config import Settings

    assert DEFAULT_MODEL == "gemini-3.8-flash"
    assert Settings(database_url="sqlite:///unused").gemini_model == "gemini-3.8-flash"


def test_a_region_that_does_not_serve_the_model_is_refused_at_start_up():
    """Not at the first member's message. us-central1 is not in Google's list
    for this model, and an unserved region answers NOT_FOUND to every call."""
    with pytest.raises(ProviderNotConfigured) as refused:
        GeminiLLMProvider(backend="vertex", project="veye-prod", location="us-central1", model="gemini-3.8-flash")
    assert "us-central1" in str(refused.value)
    assert "global, us, eu" in str(refused.value)

    for served in ("global", "us", "eu"):
        GeminiLLMProvider(backend="vertex", project="veye-prod", location=served, model="gemini-3.8-flash",
                          client=FakeVertex())


def test_the_default_region_keeps_processing_in_the_united_states():
    from app.companion.providers.gemini import DEFAULT_LOCATION
    from app.core.config import Settings

    assert DEFAULT_LOCATION == "us"
    assert Settings(database_url="sqlite:///unused").gcp_location == "us"


def test_deprecated_sampling_parameters_are_never_sent():
    """temperature, top_p and top_k are ignored by this model generation and
    the migration guide says to remove them. frequency_penalty,
    presence_penalty and candidate_count throw an API error outright."""
    vertex = FakeVertex()
    provider = GeminiLLMProvider(backend="vertex", project="veye-prod", location="us", model="gemini-3.8-flash",
                                 client=vertex)
    provider.complete(_request(WITHOUT_CONTEXT, DataClassification.GENERAL))
    config = vertex.sent[0]["config"]
    for banned in ("temperature", "top_p", "top_k", "topP", "topK",
                   "frequency_penalty", "presence_penalty", "candidate_count"):
        assert banned not in config, f"{banned} was sent to a model that does not accept it"
    # What it does send.
    assert config["system_instruction"]
    assert config["max_output_tokens"] > 0
    assert config["tools"] == []


def test_thinking_level_is_left_at_its_default():
    """MEDIUM is the documented default and nothing here needs to move it.
    MINIMAL is rejected by the API, so it must never be sent speculatively."""
    vertex = FakeVertex()
    GeminiLLMProvider(backend="vertex", project="veye-prod", location="us", model="gemini-3.8-flash",
                      client=vertex).complete(_request(WITHOUT_CONTEXT, DataClassification.GENERAL))
    assert "thinking_level" not in vertex.sent[0]["config"]
    assert "thinking_budget" not in vertex.sent[0]["config"]
