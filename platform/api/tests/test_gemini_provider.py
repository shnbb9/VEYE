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


def _request(system: str) -> LLMRequest:
    return LLMRequest(system=system, messages=(LLMMessage(role="user", content="How am I doing?"),))


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
    assert carries_member_data(_request(WITHOUT_CONTEXT)) is False
    # The section exists but every line is "not available" — that is a statement
    # about absence, not about the member.
    assert carries_member_data(_request(EMPTY_CONTEXT)) is False


def test_the_check_reads_the_prompt_rather_than_trusting_a_caller_flag():
    """A new caller that forgets a flag would otherwise get the permissive
    answer, which is the wrong way round for this decision."""
    sneaky = LLMRequest(system=WITH_CONTEXT, messages=(LLMMessage(role="user", content="hi"),),
                        metadata={"contains_member_data": "false"})
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
    answer = provider.complete(_request(WITHOUT_CONTEXT))
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
        _request(WITHOUT_CONTEXT))
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
        provider.complete(_request(WITHOUT_CONTEXT))


def test_the_settings_default_to_nothing_connected_and_nothing_cleared():
    from app.core.config import Settings

    defaults = Settings(database_url="sqlite:///./unused.db")
    assert defaults.llm_provider == "mock"
    assert defaults.gcp_project is None
    assert defaults.gemini_api_key is None
    assert defaults.gemini_member_data_cleared is False
