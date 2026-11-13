"""Google's text embeddings on Vertex AI — the provider, not a live call.

Nothing here reaches Google. The SDK is an optional extra and the default
deployment uses the local hashing provider; what is tested is the shape of the
call and, far more importantly, the refusals.

The refusal that matters: the Companion retrieves *before* it runs the
outbound privacy filter, so the text handed to the embedder is the member's
raw question. With the local provider that is irrelevant — nothing leaves the
process. With an external one it is the whole question, and an earlier version
of the embedding module's docstring asserted the opposite ("the already
privacy-filtered query text"), which is exactly the sort of comment a provider
gets written against.
"""

from __future__ import annotations

import pytest

from app.companion.providers.embeddings import (
    DataClassification,
    GoogleEmbeddingProvider,
    HashingEmbeddingProvider,
    build_embedding_provider,
)
from app.companion.providers.gemini import MemberDataNotCleared
from app.companion.providers.llm import ProviderNotConfigured


class FakeEmbedding:
    def __init__(self, values):
        self.values = values


class FakeResponse:
    def __init__(self, vectors):
        self.embeddings = [FakeEmbedding(v) for v in vectors]


class FakeModels:
    def __init__(self, vectors):
        self._vectors = vectors
        self.calls = []

    def embed_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": list(contents), "config": config})
        return FakeResponse(self._vectors[: len(contents)])


class FakeClient:
    def __init__(self, vectors):
        self.models = FakeModels(vectors)


class FakeConfig:
    """Stands in for google.genai.types.EmbedContentConfig."""

    def __init__(self, *, task_type, output_dimensionality):
        self.task_type = task_type
        self.output_dimensionality = output_dimensionality


@pytest.fixture(autouse=True)
def _fake_sdk_config(monkeypatch):
    """`_config` imports the SDK's types; stand in for it so the tests run
    without the optional extra installed."""
    monkeypatch.setattr(GoogleEmbeddingProvider, "_config",
                        lambda self, purpose: FakeConfig(
                            task_type=self.TASK_TYPES[purpose],
                            output_dimensionality=self.dimensions))


def provider(**kwargs):
    defaults = dict(dimensions=4, project="veye-demo", client=FakeClient([[3.0, 0.0, 0.0, 4.0]]))
    defaults.update(kwargs)
    return GoogleEmbeddingProvider(**defaults)


# ---- configuration refusals --------------------------------------------------

def test_vertex_needs_a_project():
    with pytest.raises(ProviderNotConfigured) as refused:
        GoogleEmbeddingProvider(dimensions=4)
    assert "VEYE_GCP_PROJECT" in str(refused.value)


def test_a_region_that_does_not_serve_the_model_is_refused_at_start_up():
    """Discovering it from a member's broken conversation is the worst way."""
    with pytest.raises(ProviderNotConfigured) as refused:
        GoogleEmbeddingProvider(dimensions=4, project="veye-demo", location="us-central1")
    assert "global, us, eu" in str(refused.value)


def test_an_api_key_is_refused_in_production():
    with pytest.raises(ProviderNotConfigured) as refused:
        GoogleEmbeddingProvider(dimensions=4, api_key="local-only", production=True)
    assert "not a production identity" in str(refused.value)


def test_an_api_key_is_never_combined_with_member_data_clearance():
    with pytest.raises(ProviderNotConfigured):
        GoogleEmbeddingProvider(dimensions=4, api_key="local-only", member_data_cleared=True)


# ---- the refusal that protects the member's words ---------------------------

def test_a_members_own_words_are_not_sent_unless_the_deployment_is_cleared():
    google = provider()
    with pytest.raises(MemberDataNotCleared):
        google.embed(["my cholesterol came back at 240"],
                     purpose="query", classification=DataClassification.REAL_MEMBER)
    assert google._client.models.calls == [], "the text was sent before the check"


def test_the_default_classification_is_the_conservative_one():
    """A caller that forgets to say whose text this is gets the restrictive
    answer, not the permissive one."""
    google = provider()
    with pytest.raises(MemberDataNotCleared):
        google.embed(["anything at all"])


def test_a_cleared_deployment_may_send_a_members_question():
    google = provider(member_data_cleared=True)
    vectors = google.embed(["what should I eat"], purpose="query",
                           classification=DataClassification.REAL_MEMBER)
    assert len(vectors) == 1
    assert google._client.models.calls[0]["contents"] == ["what should I eat"]


def test_approved_knowledge_is_sent_without_any_clearance():
    """Ingestion embeds documents an administrator approved. That is nobody's
    personal data and must not require the member-data clearance."""
    google = provider()
    vectors = google.embed(["Olive oil is the cooking fat."],
                           purpose="document", classification=DataClassification.GENERAL)
    assert len(vectors) == 1


def test_synthetic_members_are_not_real_members():
    google = provider()
    assert google.embed(["a demo question"], purpose="query",
                        classification=DataClassification.SYNTHETIC_MEMBER)


# ---- the call ----------------------------------------------------------------

def test_a_query_and_a_document_are_embedded_for_different_tasks():
    """Using one task type for the other costs recall, and the mistake is
    invisible: both calls succeed and the ranking is quietly worse."""
    google = provider(member_data_cleared=True)
    google.embed(["passage"], purpose="document", classification=DataClassification.GENERAL)
    google.embed(["question"], purpose="query", classification=DataClassification.GENERAL)
    tasks = [call["config"].task_type for call in google._client.models.calls]
    assert tasks == ["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]


def test_the_vector_width_asked_for_is_the_one_the_column_stores():
    google = provider(dimensions=4)
    google.embed(["passage"], classification=DataClassification.GENERAL)
    assert google._client.models.calls[0]["config"].output_dimensionality == 4


def test_a_vector_of_the_wrong_width_fails_loudly_not_in_the_database():
    """knowledge_chunks.embedding is vector(n). A mismatch discovered by
    PostgreSQL halfway through ingesting a document is a far worse error."""
    google = provider(dimensions=4, client=FakeClient([[1.0] * 768]))
    with pytest.raises(ValueError) as refused:
        google.embed(["passage"], classification=DataClassification.GENERAL)
    assert "768-dimension" in str(refused.value)
    assert "VEYE_EMBEDDING_DIMENSIONS" in str(refused.value)


def test_a_short_answer_is_a_failure_not_a_silent_misalignment():
    """Zipping chunks against embeddings would otherwise attach one chunk's
    vector to another chunk's text."""
    google = provider(client=FakeClient([[1.0, 0.0, 0.0, 0.0]]))
    with pytest.raises(ValueError):
        google.embed(["one", "two"], classification=DataClassification.GENERAL)


def test_vectors_come_back_unit_length():
    """A truncated embedding is not unit length, and a corpus of mixed
    magnitudes makes the PostgreSQL and Python ranking paths disagree."""
    google = provider(client=FakeClient([[3.0, 0.0, 0.0, 4.0]]))
    vector = google.embed(["passage"], classification=DataClassification.GENERAL)[0]
    assert vector == pytest.approx([0.6, 0.0, 0.0, 0.8])


def test_embedding_nothing_calls_nothing():
    google = provider()
    assert google.embed([]) == []
    assert google._client.models.calls == []


def test_the_provider_describes_itself_without_leaking_the_key():
    described = provider(member_data_cleared=True).describe()
    assert described["provider"] == "google" and described["external"] is True
    assert described["auth"] == "application-default-credentials"
    assert described["model"] == "gemini-embedding-001"
    assert "api_key" not in described and "veye-demo" == described["project"]


# ---- the factory -------------------------------------------------------------

def test_hashing_is_still_the_default_and_needs_no_settings():
    built = build_embedding_provider("hashing", dimensions=8)
    assert isinstance(built, HashingEmbeddingProvider)
    assert built.describe()["external"] is False


def test_an_unknown_provider_names_the_ones_that_exist():
    with pytest.raises(ValueError) as refused:
        build_embedding_provider("openai", dimensions=8)
    assert "hashing" in str(refused.value) and "google" in str(refused.value)


def test_the_factory_builds_google_from_the_application_settings():
    class Settings:
        gcp_project = "veye-demo"
        gcp_location = "eu"
        embedding_model = ""
        gemini_member_data_cleared = False
        gemini_api_key = None
        is_production = False

    built = build_embedding_provider("google", dimensions=256, settings=Settings())
    assert isinstance(built, GoogleEmbeddingProvider)
    assert built.location == "eu" and built.dimensions == 256
    assert built.model == GoogleEmbeddingProvider.DEFAULT_MODEL


def test_the_local_provider_accepts_the_same_arguments_so_swapping_is_configuration():
    """If the hashing provider did not take these, switching provider would
    mean editing every caller."""
    local = HashingEmbeddingProvider(8)
    assert local.embed(["x"], purpose="query", classification=DataClassification.REAL_MEMBER)
    assert local.embed(["x"], purpose="document", classification=DataClassification.GENERAL)
