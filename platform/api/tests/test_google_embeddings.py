"""Google's text embeddings — the provider, not a live call. Which door they
go through, and what the SDK would really send, is in test_google_backend.py.

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
from app.companion.providers.google_backend import Refused
from app.companion.providers.llm import ClientContentNotAllowed, MemberDataNotCleared, ProviderNotConfigured


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


def calls(google) -> list[dict]:
    """What was sent."""
    return google.backend.client().models.calls


WIDTH = 128         # the narrowest this model gives


def vector(*first):
    return [*first, *([0.0] * (WIDTH - len(first)))]


def provider(**kwargs):
    defaults = dict(backend="vertex", dimensions=WIDTH, project="veye-demo", client=FakeClient([vector(3.0, 0.0, 0.0, 4.0)]))
    defaults.update(kwargs)
    return GoogleEmbeddingProvider(**defaults)


# ---- configuration refusals --------------------------------------------------

def test_vertex_needs_a_project():
    with pytest.raises(ProviderNotConfigured) as refused:
        GoogleEmbeddingProvider(backend="vertex", dimensions=256)
    assert "VEYE_GCP_PROJECT" in str(refused.value)


def test_a_region_that_does_not_serve_the_model_is_refused_at_start_up():
    """Discovering it from a member's broken conversation is the worst way.
    This model is served from single regions; `us`, which serves the language
    model and which this once defaulted to, answers NOT_FOUND."""
    for place in ("us", "eu", "global"):
        with pytest.raises(ProviderNotConfigured) as refused:
            GoogleEmbeddingProvider(backend="vertex", dimensions=256, project="veye-demo", location=place)
        assert "VEYE_EMBEDDING_LOCATION" in str(refused.value) and "us-central1" in str(refused.value)
    assert GoogleEmbeddingProvider(backend="vertex", dimensions=256, project="veye-demo").backend.location == "us-central1"


def test_an_api_key_is_refused_in_production():
    with pytest.raises(ProviderNotConfigured) as refused:
        GoogleEmbeddingProvider(backend="developer", dimensions=256, api_key="local-only", local=False)
    assert "not a production identity" in str(refused.value)


def test_an_api_key_is_never_combined_with_member_data_clearance():
    with pytest.raises(ProviderNotConfigured):
        GoogleEmbeddingProvider(backend="developer", local=True, dimensions=256, api_key="local-only", member_data_cleared=True)


def test_a_model_whose_vectors_are_not_these_is_refused():
    """Its successor takes no task type and cannot be compared with what is
    stored: a change of model is a change of code and a new index, never a
    change of one setting."""
    for model in ("gemini-embedding-2", "text-embedding-005", "gemini-embedding-01"):
        with pytest.raises(ProviderNotConfigured) as refused:
            GoogleEmbeddingProvider(backend="vertex", project="veye-demo", dimensions=256, model=model)
        assert model in str(refused.value) and "gemini-embedding-001" in str(refused.value)


def test_a_width_the_model_does_not_give_is_refused():
    for dimensions in (0, 8, 127, 3073):
        with pytest.raises(ProviderNotConfigured) as refused:
            GoogleEmbeddingProvider(backend="vertex", project="veye-demo", dimensions=dimensions)
        assert "128 to 3072" in str(refused.value)


def test_the_index_is_the_model_the_width_and_the_door():
    """Anything that makes two vectors mean nothing to each other."""
    names = {GoogleEmbeddingProvider(backend=b, local=True, project="p", api_key="k", dimensions=d).index for b in ("vertex", "developer") for d in (256, 768)}
    assert names == {"gemini-embedding-001@256/vertex", "gemini-embedding-001@768/vertex", "gemini-embedding-001@256/developer",
                     "gemini-embedding-001@768/developer"}
    assert HashingEmbeddingProvider(256).index == "veye-hashing-256" and all(len(name) <= 64 for name in names)


# ---- the refusal that protects the member's words ---------------------------

def test_a_members_own_words_are_not_sent_unless_the_deployment_is_cleared():
    google = provider()
    with pytest.raises(MemberDataNotCleared):
        google.embed(["my cholesterol came back at 240"],
                     purpose="query", classification=DataClassification.REAL_MEMBER)
    assert calls(google) == [], "the text was sent before the check"


def test_and_never_on_a_developer_key_whatever_is_cleared():
    google = provider(backend="developer", local=True, api_key="k")
    google.member_data_cleared = True   # not possible to configure; not relied on either
    with pytest.raises(MemberDataNotCleared):
        google.embed(["my cholesterol came back at 240"], purpose="query", classification=DataClassification.REAL_MEMBER)
    assert calls(google) == []


def test_the_clients_own_documents_are_not_embedded_on_a_developer_key():
    google = provider(backend="developer", local=True, api_key="k")
    with pytest.raises(ClientContentNotAllowed) as refused:
        google.embed(["the client's own words"], classification=DataClassification.GENERAL, client_content=True)
    assert "Nothing was sent" in str(refused.value) and calls(google) == []
    assert google.embed(["a demonstration"], classification=DataClassification.GENERAL, client_content=False)
    assert provider().embed(["the client's own words"], classification=DataClassification.GENERAL, client_content=True)


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
    assert calls(google)[0]["contents"] == ["what should I eat"]


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

def test_each_vector_is_the_vector_of_its_own_text():
    """Asked for several at once and answered in any order. One passage's
    vector on another passage's text would never be noticed."""
    import random
    import time

    class Uneven:
        def embed_content(self, *, model, contents, config):
            time.sleep(random.random() / 50)
            return FakeResponse([vector(1.0, float(int(text))) for text in contents])

    texts = [str(n) for n in range(200)]
    for backend in ("vertex", "developer"):
        google = provider(backend=backend, local=True, api_key="k", client=type("C", (), {"models": Uneven()})())
        for text, got in zip(texts, google.embed(texts, classification=DataClassification.GENERAL), strict=True):
            assert got[1] / got[0] == pytest.approx(float(text)), backend


def test_one_that_fails_is_all_that_fail():
    asked: list = []

    class Failing:
        def embed_content(self, *, model, contents, config):
            asked.append(contents)
            if contents == ["7"]:
                raise type("APIError", (Exception,), {"code": 400, "status": "INVALID_ARGUMENT"})("no")
            return FakeResponse([vector(1.0)])

    google = provider(client=type("C", (), {"models": Failing()})())
    with pytest.raises(Refused):
        google.embed([str(n) for n in range(300)], classification=DataClassification.GENERAL)
    assert len(asked) < 60, "the rest are not paid for"


def test_a_text_that_was_not_read_to_the_end_is_not_indexed():
    """The end of it would never be found, and nothing would say so."""
    class Cut:
        def embed_content(self, *, model, contents, config):
            item = FakeEmbedding(vector(1.0))
            item.statistics = type("S", (), {"token_count": 2048, "truncated": True})()
            return type("R", (), {"embeddings": [item]})()

    with pytest.raises(Refused) as refused:
        provider(client=type("C", (), {"models": Cut()})()).embed(["long"], classification=DataClassification.GENERAL)
    assert "too long" in str(refused.value)
    for backend, told in (("vertex", {"auto_truncate": False}), ("developer", {})):
        google = provider(backend=backend, local=True, api_key="k")
        google.embed(["x"], classification=DataClassification.GENERAL)
        assert {k: v for k, v in calls(google)[0]["config"].items() if k == "auto_truncate"} == told, "this door's SDK refuses the instruction"


def test_a_query_and_a_document_are_embedded_for_different_tasks():
    """Using one task type for the other costs recall, and the mistake is
    invisible: both calls succeed and the ranking is quietly worse."""
    google = provider(member_data_cleared=True)
    google.embed(["passage"], purpose="document", classification=DataClassification.GENERAL)
    google.embed(["question"], purpose="query", classification=DataClassification.GENERAL)
    tasks = [call["config"]["task_type"] for call in calls(google)]
    assert tasks == ["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]


def test_the_vector_width_asked_for_is_the_one_the_column_stores():
    google = provider()
    google.embed(["passage"], classification=DataClassification.GENERAL)
    assert calls(google)[0]["config"]["output_dimensionality"] == WIDTH


def test_a_vector_of_the_wrong_width_fails_loudly_not_in_the_database():
    """knowledge_chunks.embedding is vector(n). A mismatch discovered by
    PostgreSQL halfway through ingesting a document is a far worse error."""
    google = provider(client=FakeClient([[1.0] * 768]))
    with pytest.raises(Refused) as refused:
        google.embed(["passage"], classification=DataClassification.GENERAL)
    assert "768-dimension" in str(refused.value)
    assert "VEYE_EMBEDDING_DIMENSIONS" in str(refused.value)


def test_a_short_answer_is_a_failure_not_a_silent_misalignment():
    """Zipping chunks against embeddings would otherwise attach one chunk's
    vector to another chunk's text."""
    google = provider(backend="developer", local=True, api_key="k", client=FakeClient([vector(1.0)]))
    with pytest.raises(Refused):
        google.embed(["one", "two"], classification=DataClassification.GENERAL)
    google = provider(client=FakeClient([]))
    with pytest.raises(Refused):
        google.embed(["one"], classification=DataClassification.GENERAL)


def test_vectors_come_back_unit_length():
    """A truncated embedding is not unit length, and a corpus of mixed
    magnitudes makes the PostgreSQL and Python ranking paths disagree."""
    google = provider(client=FakeClient([vector(3.0, 0.0, 0.0, 4.0)]))
    assert google.embed(["passage"], classification=DataClassification.GENERAL)[0] == pytest.approx(vector(0.6, 0.0, 0.0, 0.8))


def test_embedding_nothing_calls_nothing():
    google = provider()
    assert google.embed([]) == []
    assert calls(google) == []


def test_the_provider_describes_itself_without_leaking_the_key():
    described = provider(member_data_cleared=True).describe()
    assert described["provider"] == "google" and described["external"] is True
    assert described["auth"] == "application default credentials"
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
    from app.core.config import Settings

    built = build_embedding_provider("google", dimensions=256, settings=Settings(
        database_url="sqlite://", gemini_backend="vertex", gcp_project="veye-demo", gcp_location="eu", embedding_location="us-east5"))
    assert isinstance(built, GoogleEmbeddingProvider)
    assert built.backend.location == "us-east5" and built.dimensions == 256, "not where the language model is served from"
    assert built.model == GoogleEmbeddingProvider.DEFAULT_MODEL
    assert built.backend.timeout_seconds == 12.0, "a member waits for this and then for the answer"


def test_the_local_provider_accepts_the_same_arguments_so_swapping_is_configuration():
    """If the hashing provider did not take these, switching provider would
    mean editing every caller."""
    local = HashingEmbeddingProvider(8)
    assert local.embed(["x"], purpose="document", classification=DataClassification.GENERAL, client_content=True)
    assert local.embed(["x"], purpose="query", classification=DataClassification.REAL_MEMBER)
    assert local.embed(["x"], purpose="document", classification=DataClassification.GENERAL)
