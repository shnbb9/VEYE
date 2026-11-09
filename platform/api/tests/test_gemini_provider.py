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
             *, message: str = "How am I doing?") -> LLMRequest:
    return LLMRequest(system=system, messages=(LLMMessage(role="user", content=message),),
                      classification=classification)


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
    provider = GeminiLLMProvider(project="veye-dev", location="us-central1", model="gemini-2.0-flash",
                                 member_data_cleared=False, client=vertex)
    with pytest.raises(MemberDataNotCleared) as refused:
        provider.complete(_request(WITH_CONTEXT))
    assert "BAA" in str(refused.value)
    assert vertex.sent == [], "member context reached the model despite the gate"


def test_the_refusal_is_a_failure_not_a_quiet_strip():
    """An answer confidently built from a prompt whose context was silently
    removed is worse than no answer at all."""
    vertex = FakeVertex()
    provider = GeminiLLMProvider(project="veye-dev", location="us-central1", model="m",
                                 member_data_cleared=False, client=vertex)
    with pytest.raises(ProviderNotConfigured):
        provider.complete(_request(WITH_CONTEXT))
    assert len(vertex.sent) == 0


def test_a_prompt_without_member_context_goes_through_uncleared():
    vertex = FakeVertex()
    provider = GeminiLLMProvider(project="veye-dev", location="us-central1", model="gemini-2.0-flash",
                                 member_data_cleared=False, client=vertex)
    answer = provider.complete(_request(WITHOUT_CONTEXT, DataClassification.GENERAL))
    assert answer.text == "A short answer."
    assert answer.provider == "gemini"
    assert len(vertex.sent) == 1


def test_once_cleared_member_context_is_sent():
    vertex = FakeVertex()
    provider = GeminiLLMProvider(project="veye-prod", location="us-central1", model="gemini-2.0-flash",
                                 member_data_cleared=True, client=vertex)
    provider.complete(_request(WITH_CONTEXT))
    assert len(vertex.sent) == 1
    assert "MEMBER CONTEXT" in vertex.sent[0]["config"]["system_instruction"]


# ---- credentials -------------------------------------------------------------

def test_a_personal_api_key_is_refused_in_production():
    with pytest.raises(ProviderNotConfigured) as refused:
        GeminiLLMProvider(project="", location="us-central1", model="m", api_key="dev-key", production=True)
    assert "production identity" in str(refused.value).lower() or "Application Default" in str(refused.value)


def test_a_personal_api_key_may_never_carry_member_data():
    with pytest.raises(ProviderNotConfigured) as refused:
        GeminiLLMProvider(project="", location="us-central1", model="m",
                          api_key="dev-key", member_data_cleared=True)
    assert "service identity" in str(refused.value)


def test_vertex_needs_a_project():
    with pytest.raises(ProviderNotConfigured) as refused:
        GeminiLLMProvider(project="", location="us-central1", model="m")
    assert "VEYE_GCP_PROJECT" in str(refused.value)


def test_vertex_uses_the_services_own_identity_not_a_key_file():
    provider = GeminiLLMProvider(project="veye-prod", location="europe-west4", model="gemini-2.0-flash",
                                 client=FakeVertex())
    described = provider.describe()
    assert described["auth"] == "application default credentials"
    assert described["project"] == "veye-prod"
    assert described["location"] == "europe-west4"
    assert described["external"] is True
    assert described["member_data_cleared"] is False


# ---- no web grounding ---------------------------------------------------------

def test_sprout_never_reaches_the_open_web():
    """Approved Veye knowledge and the member's own summaries, nothing else."""
    vertex = FakeVertex()
    GeminiLLMProvider(project="veye-dev", location="us-central1", model="m", client=vertex).complete(
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
                                  gemini={"project": "", "location": "us-central1", "model": "m"})
    assert isinstance(provider, UnconfiguredLLMProvider)
    assert provider.describe()["configured"] is False
    with pytest.raises(ProviderNotConfigured):
        provider.complete(_request(WITHOUT_CONTEXT, DataClassification.GENERAL))


def test_the_settings_default_to_nothing_connected_and_nothing_cleared():
    from app.core.config import Settings

    defaults = Settings(database_url="sqlite:///./unused.db")
    assert defaults.llm_provider == "mock"
    assert defaults.gcp_project is None
    assert defaults.gemini_api_key is None
    assert defaults.gemini_member_data_cleared is False


# ---- the trust boundary, by classification ---------------------------------
# A heading in a prompt describes the prompt. The classification states whose
# data it is, decided from server state when the request was built. These are
# the cases the heading check could not see.

def test_a_personal_tip_for_a_real_member_cannot_leave_through_an_api_key():
    """The Personal Tip puts a member's summaries in the USER message under no
    heading at all, so nothing in the prompt's text marks it as theirs."""
    vertex = FakeVertex()
    developer = GeminiLLMProvider(project="", location="us-central1", model="m",
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
    developer = GeminiLLMProvider(project="", location="us-central1", model="m",
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
    developer = GeminiLLMProvider(project="", location="us-central1", model="m",
                                  api_key="dev-key", client=vertex)
    answer = developer.complete(_request(WITH_CONTEXT, DataClassification.SYNTHETIC_MEMBER))
    assert answer.text == "A short answer."
    assert len(vertex.sent) == 1


def test_general_evaluation_with_no_member_may_use_an_api_key():
    vertex = FakeVertex()
    developer = GeminiLLMProvider(project="", location="us-central1", model="m",
                                  api_key="dev-key", client=vertex)
    developer.complete(_request(WITHOUT_CONTEXT, DataClassification.GENERAL))
    assert len(vertex.sent) == 1


def test_production_still_refuses_a_real_member_until_the_gate_is_cleared():
    vertex = FakeVertex()
    uncleared = GeminiLLMProvider(project="veye-prod", location="us", model="m",
                                  member_data_cleared=False, client=vertex)
    with pytest.raises(MemberDataNotCleared):
        uncleared.complete(_request(WITH_CONTEXT, DataClassification.REAL_MEMBER))
    assert vertex.sent == []

    cleared = GeminiLLMProvider(project="veye-prod", location="us", model="m",
                                member_data_cleared=True, client=vertex)
    cleared.complete(_request(WITH_CONTEXT, DataClassification.REAL_MEMBER))
    assert len(vertex.sent) == 1
    # Synthetic and general never needed the gate.
    cleared_none = GeminiLLMProvider(project="veye-prod", location="us", model="m", client=vertex)
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
    provider = GeminiLLMProvider(project="veye-prod", location="us", model="m",
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
