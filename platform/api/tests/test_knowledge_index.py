"""Two embedding providers and one knowledge base.

What was ingested with one cannot be compared with what another writes. The
danger is not a crash: it is that retrieval filters on the index, so approved
knowledge is simply not found, and Sprout answers as if there were none. So
every one of these asks the same thing from a different side: is it all there,
and if not, does somebody say so?

Nothing here reaches Google. The "Google" provider is the real one with a
double behind it, whose vectors are its own kind and still mean something.
"""

from __future__ import annotations

import logging
from uuid import UUID

import pytest
from sqlalchemy import text

from app.auth.models import UserAccount
from app.companion.models import CompanionMessage
from app.companion.providers.embeddings import GoogleEmbeddingProvider, HashingEmbeddingProvider, UnconfiguredEmbeddingProvider
from app.companion.providers.google_backend import CallBudget
from app.companion.providers.llm import DataClassification, MockLLMProvider
from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal
from app.guided_flows.catalog import ensure_builtin_flows
from app.guided_flows.models import STATUS_DRAFT, GuidedFlow, MemberGuidedFlowSession
from app.jobs.runner import run_job
from app.knowledge.models import STATUS_ACTIVE, STATUS_INACTIVE, KnowledgeChunk, KnowledgeDocument
from app.knowledge.object_store import LocalFileKnowledgeObjectStore
from app.knowledge.service import MOST_PASSAGES, IndexNotReady, KnowledgeError, KnowledgeService, NotAllIndexed, NotEmbedded, WrongWidth
from app.observability.models import AiTraceEvent
from app.seed.knowledge import seed_knowledge
from tests.pg import pg_sessionmaker  # noqa: F401 - fixture

HASHING = "veye-hashing-256"
VERTEX = "gemini-embedding-001@256/vertex"
DEVELOPER = "gemini-embedding-001@256/developer"
QUESTION = "what does the health number scale mean"
ASK = "/api/v1/companion/messages"
ADVANCED = "/api/v1/admin/companion/advanced"


class FakeGoogle:
    """Vectors of another kind: the local ones, back to front."""

    def __init__(self, width: int = 256):
        self.local, self.sent, self.fail_after = HashingEmbeddingProvider(width), [], None
        self.models = self

    def embed_content(self, *, model, contents, config):
        if self.fail_after is not None and len(self.sent) >= self.fail_after:
            raise type("APIError", (Exception,), {"code": 503, "status": "UNAVAILABLE"})("busy")
        self.sent.append(list(contents))
        item = lambda text: type("E", (), {"values": self.local._embed_one(text)[::-1], "statistics": None})()  # noqa: E731
        return type("R", (), {"embeddings": [item(text) for text in contents]})()


def google(kind: str = "vertex", *, dimensions: int = 256):
    fake = FakeGoogle(dimensions)
    return GoogleEmbeddingProvider(backend=kind, dimensions=dimensions, project="veye-demo", api_key="k", local=True, client=fake,
                                   budget=CallBudget(500), sleep=lambda _: None), fake


def service(db, tmp_path, provider=None) -> KnowledgeService:
    return KnowledgeService(db, LocalFileKnowledgeObjectStore(tmp_path / "objects"), provider or HashingEmbeddingProvider(256))


def make(knowledge, title, *, scope="health_number", status=STATUS_ACTIVE, body="The Health Number is shown on a scale of 1 to 10 where lower is better.",
         synthetic=True):
    source = knowledge.create_source(title=title, type="VEYE educational document", scope_key=scope, synthetic=synthetic)
    knowledge.attach_document(source, filename="note.md", content_type="text/markdown", data=f"# {title}\n\n{body}\n".encode(), synthetic=synthetic)
    if status in (STATUS_ACTIVE, STATUS_INACTIVE):
        knowledge.activate(source, approved_by="test")
    if status == STATUS_INACTIVE:
        knowledge.deactivate(source)
    knowledge.db.commit()
    return source


def labels(db) -> dict[str, int]:
    counts: dict[str, int] = {}
    for (label,) in db.query(KnowledgeChunk.embedding_model):
        counts[label] = counts.get(label, 0) + 1
    return counts


# ---- nothing disappears quietly, and nothing is mixed -------------------------------------------

def test_after_a_change_of_provider_nothing_is_answered_until_it_has_been_indexed(tmp_path):
    with SessionLocal() as db:
        make(service(db, tmp_path), "Guide")
        provider, fake = google()
        knowledge = service(db, tmp_path, provider)
        with pytest.raises(IndexNotReady) as refused:
            knowledge.search(QUESTION, classification=DataClassification.GENERAL)
        assert refused.value.titles == ["Guide"] and VERTEX in refused.value.detail
        assert "reindex-knowledge" in refused.value.detail and "nothing has been lost" in refused.value.detail
        assert fake.sent == [], "the question was sent for an answer that could not be found"
        assert knowledge.not_searchable() == ["Guide"]


def test_indexing_writes_beside_and_changing_back_is_changing_back(tmp_path):
    with SessionLocal() as db:
        local = service(db, tmp_path)
        make(local, "Guide")
        make(local, "Help", scope="help", body="Use the show and hide control to check your password.")
        before = [(hit.chunk_id, round(hit.score, 6)) for hit in local.search(QUESTION)]
        provider, fake = google()
        knowledge = service(db, tmp_path, provider)
        assert knowledge.reindex() == {"index": VERTEX, "documents": 2, "indexed": 2, "passages": 2}
        assert labels(db) == {HASHING: 2, VERTEX: 2}
        found = knowledge.search(QUESTION, classification=DataClassification.GENERAL)
        assert found[0].source_title == "Guide" and found[0].synthetic is True
        assert {hit.chunk_id for hit in found}.isdisjoint(chunk for chunk, _ in before), "its own vectors, not the other's"
        # The same passages, word for word.
        rows = db.query(KnowledgeChunk).all()
        assert {(r.document_id, r.ordinal, r.heading, r.text) for r in rows if r.embedding_model == VERTEX} == \
               {(r.document_id, r.ordinal, r.heading, r.text) for r in rows if r.embedding_model == HASHING}
        # And back, with nothing to do.
        assert [(hit.chunk_id, round(hit.score, 6)) for hit in local.search(QUESTION)] == before
        assert local.not_searchable() == []


def test_indexing_twice_does_it_once_and_a_dry_run_does_nothing(tmp_path):
    with SessionLocal() as db:
        make(service(db, tmp_path), "Guide")
        provider, fake = google()
        knowledge = service(db, tmp_path, provider)
        assert knowledge.reindex(dry_run=True) == {"index": VERTEX, "documents": 1, "indexed": 0, "passages": 1}
        assert fake.sent == [] and labels(db) == {HASHING: 1}
        knowledge.reindex()
        sent = len(fake.sent)
        assert knowledge.reindex() == {"index": VERTEX, "documents": 0, "indexed": 0, "passages": 0}
        assert len(fake.sent) == sent and labels(db) == {HASHING: 1, VERTEX: 1}


def test_the_two_doors_are_two_indexes(tmp_path):
    """The same model by name. Nobody has shown that its vectors are, and a
    corpus built with a developer key is not what production answers from."""
    with SessionLocal() as db:
        developer, _ = google("developer")
        make(service(db, tmp_path, developer), "Guide")
        vertex, fake = google("vertex")
        with pytest.raises(IndexNotReady):
            service(db, tmp_path, vertex).search(QUESTION, classification=DataClassification.GENERAL)
        assert labels(db) == {DEVELOPER: 1} and fake.sent == []


def test_what_was_added_since_is_missing_from_the_other_and_says_so(tmp_path):
    with SessionLocal() as db:
        local = service(db, tmp_path)
        make(local, "Guide")
        provider, _ = google()
        outside = service(db, tmp_path, provider)
        outside.reindex()
        make(outside, "Written since")
        with pytest.raises(IndexNotReady) as refused:
            local.search(QUESTION)
        assert refused.value.titles == ["Written since"]
        assert local.reindex()["documents"] == 1
        assert {hit.source_title for hit in local.search(QUESTION)} == {"Guide", "Written since"}


def test_only_what_could_have_been_in_the_answer_stops_it(tmp_path):
    with SessionLocal() as db:
        make(service(db, tmp_path), "Help", scope="help")
        make(service(db, tmp_path), "Not approved yet", status=STATUS_INACTIVE)
        provider, _ = google()
        knowledge = service(db, tmp_path, provider)
        make(knowledge, "Guide")
        hits = knowledge.search(QUESTION, scopes=["health_number"], classification=DataClassification.GENERAL)
        assert [hit.source_title for hit in hits] == ["Guide"]
        with pytest.raises(IndexNotReady):
            knowledge.search(QUESTION, scopes=["help"], classification=DataClassification.GENERAL)
        # Indexed all the same, so that activating it does not lose it.
        assert knowledge.reindex()["documents"] == 2 and knowledge.not_searchable() == []


def test_half_way_through_what_was_done_is_kept_and_the_rest_is_done_next_time(tmp_path):
    with SessionLocal() as db:
        for title in ("One", "Two", "Three"):
            make(service(db, tmp_path), title)
        provider, fake = google()
        knowledge = service(db, tmp_path, provider)
        fake.fail_after = 1
        with pytest.raises(NotAllIndexed) as stopped:
            knowledge.reindex()
        assert stopped.value.counts == {"index": VERTEX, "documents": 3, "indexed": 1, "passages": 1}
        assert stopped.value.detail.count("Nothing was changed") == 1, "a service that is down is asked once, not for every document"
        assert labels(db) == {HASHING: 3, VERTEX: 1}
        with pytest.raises(IndexNotReady) as refused:
            knowledge.search(QUESTION, classification=DataClassification.GENERAL)
        assert refused.value.titles == ["Three", "Two"], "part of an index is not an index"
        fake.fail_after = None
        assert knowledge.reindex()["documents"] == 2 and labels(db) == {HASHING: 3, VERTEX: 3}


def test_one_that_cannot_be_indexed_does_not_keep_the_others_out(tmp_path):
    """A source with passages missing, and one of the client's on a developer
    key: neither is half done, and both are named."""
    with SessionLocal() as db:
        broken = make(service(db, tmp_path), "Broken")
        db.query(KnowledgeDocument).filter(KnowledgeDocument.source_id == broken.id).update({"chunk_count": 2})
        make(service(db, tmp_path), "Theirs", synthetic=False, scope="help")
        make(service(db, tmp_path), "Guide")
        db.commit()
        provider, fake = google("developer")
        for attempt in range(2):
            with pytest.raises(NotAllIndexed) as some:
                service(db, tmp_path, provider).reindex()
            assert "Broken" in some.value.detail and "1 of its 2 passages" in some.value.detail and "Theirs" in some.value.detail
            assert some.value.counts["indexed"] == (1 if attempt == 0 else 0)
            assert labels(db) == {HASHING: 3, DEVELOPER: 1} and len(fake.sent) == 1


def test_a_source_the_deployment_cannot_search_is_not_made_active(tmp_path):
    """Every question in its scope would be refused for the want of it."""
    with SessionLocal() as db:
        source = make(service(db, tmp_path), "Guide", status=STATUS_INACTIVE)
        provider, _ = google()
        knowledge = service(db, tmp_path, provider)
        with pytest.raises(KnowledgeError) as refused:
            knowledge.activate(source, approved_by="test")
        assert refused.value.status_code == 409 and VERTEX in refused.value.detail and "reindex-knowledge" in refused.value.detail
        assert source.status == STATUS_INACTIVE
        knowledge.reindex()
        assert knowledge.activate(source, approved_by="test").status == STATUS_ACTIVE


def test_the_job_records_what_it_did(tmp_path):
    runtime = get_runtime()
    with SessionLocal() as db:
        make(service(db, tmp_path), "Guide")
    provider, _ = google()
    configure_runtime(embeddings=provider)
    record = run_job(SessionLocal, "reindex-knowledge", dry_run=True, triggered_by="test")
    assert (record.status, record.counts) == ("ok", {"index": VERTEX, "documents": 1, "indexed": 0, "passages": 1})
    record = run_job(SessionLocal, "reindex-knowledge", triggered_by="test")
    assert (record.status, record.counts["indexed"]) == ("ok", 1)
    configure_runtime(embeddings=UnconfiguredEmbeddingProvider("VEYE_GEMINI_BACKEND must be said.", 256))
    record = run_job(SessionLocal, "reindex-knowledge", triggered_by="test")
    assert record.status == "error" and "VEYE_GEMINI_BACKEND must be said" in record.error
    assert record.counts["documents"] == 1 and record.counts["indexed"] == 0, "what was done is recorded, failed or not"
    configure_runtime(embeddings=runtime.embeddings)


# ---- the client's own documents and a developer's key -----------------------------------------

def test_the_clients_documents_are_never_embedded_on_a_developer_key(tmp_path):
    with SessionLocal() as db:
        provider, fake = google("developer")
        knowledge = service(db, tmp_path, provider)
        theirs = knowledge.create_source(title="Theirs", type="FAQ / Help", scope_key="help", synthetic=False)
        with pytest.raises(NotEmbedded) as refused:
            knowledge.attach_document(theirs, filename="a.md", content_type="text/markdown", data=b"# A\n\nTheir own words.\n")
        assert refused.value.category == "client_content_not_allowed" and "only through Vertex AI" in refused.value.detail
        assert fake.sent == [] and labels(db) == {} and theirs.documents == []
        # Nor on the way back through indexing.
        make(service(db, tmp_path), "Theirs too", synthetic=False)
        with pytest.raises(NotAllIndexed):
            knowledge.reindex()
        assert fake.sent == []
        vertex, sent = google("vertex")
        assert service(db, tmp_path, vertex).reindex()["documents"] == 1 and sent.sent


def test_a_source_is_a_demonstration_only_while_everything_in_it_is(tmp_path):
    """Attached to a demonstration through the console, a document of the
    client's would have gone out as one."""
    with SessionLocal() as db:
        provider, fake = google("developer")
        knowledge = service(db, tmp_path, provider)
        source = make(knowledge, "Health Number guide")
        assert source.is_synthetic is True and len(fake.sent) == 1
        with pytest.raises(NotEmbedded):    # as the console attaches: it does not know, and does not say
            knowledge.attach_document(source, filename="b.md", content_type="text/markdown", data=b"# B\n\nTheir own words.\n")
        db.rollback()
        assert len(fake.sent) == 1 and "Their own words" not in str(fake.sent)
        local = service(db, tmp_path)
        local.attach_document(source, filename="b.md", content_type="text/markdown", data=b"# B\n\nTheir own words.\n")
        assert source.is_synthetic is False
        local.attach_document(source, filename="c.md", content_type="text/markdown", data=b"# C\n\nA demonstration again.\n", synthetic=True)
        assert source.is_synthetic is False, "for good: what was said from it is in conversations"
        assert knowledge.create_source(title="Nobody said", type="FAQ / Help", scope_key="help").is_synthetic is False


def test_through_the_console_a_document_is_the_clients(client, admin_client):
    seed_knowledge()
    sources = "/api/v1/admin/companion/knowledge-sources"
    guide = next(s for s in admin_client.get(sources).json() if s["title"] == "Health Number guide")
    assert guide["is_synthetic"] is True
    after = admin_client.post(f"{sources}/{guide['id']}/document", files={"file": ("n.md", b"# New\n\nThe client wrote this.\n", "text/markdown")})
    assert after.status_code == 201 and after.json()["is_synthetic"] is False and after.json()["version"] == 2


def test_a_passage_says_whose_document_it_is_from(tmp_path):
    with SessionLocal() as db:
        knowledge = service(db, tmp_path)
        make(knowledge, "Demonstration")
        make(knowledge, "Theirs", scope="help", synthetic=False)
        assert {hit.source_title: hit.synthetic for hit in knowledge.search(QUESTION)} == {"Demonstration": True, "Theirs": False}


def test_a_provider_that_does_not_answer_takes_nothing_off_the_shelf(tmp_path):
    """The approved version answers as it did. It used to be un-approved, with
    nothing in its place and no way back."""
    with SessionLocal() as db:
        provider, fake = google()
        knowledge = service(db, tmp_path, provider)
        source = make(knowledge, "Guide")
        kept = sorted(p.name for p in (tmp_path / "objects").rglob("*") if p.is_file())
        fake.fail_after = 0
        for broken in (knowledge, service(db, tmp_path, UnconfiguredEmbeddingProvider("VEYE_GEMINI_API_KEY is not set.", 256))):
            with pytest.raises(NotEmbedded) as refused:
                broken.attach_document(source, filename="b.md", content_type="text/markdown", data=b"# B\n\nNew words.\n", synthetic=True)
            assert refused.value.status_code == 503 and refused.value.detail.startswith("Nothing was changed")
        db.commit()
        assert (source.status, source.version, source.is_synthetic, len(source.documents)) == (STATUS_ACTIVE, 1, True, 1)
        assert sorted(p.name for p in (tmp_path / "objects").rglob("*") if p.is_file()) == kept
        fake.fail_after = None
        assert knowledge.search(QUESTION, classification=DataClassification.GENERAL)[0].source_title == "Guide"
        # A file that cannot be read is still recorded, as it was.
        failed = knowledge.attach_document(source, filename="c.pdf", content_type="application/pdf", data=b"%PDF-1.4", synthetic=True)
        assert failed.ingestion_status == "failed" and source.status == STATUS_INACTIVE and failed.chunk_count == 0


@pytest.mark.parametrize("decided", ["activate", "archive"])
def test_what_is_decided_while_a_version_is_indexed_stands(tmp_path, decided):
    """Somebody approves the version on their screen, or archives it, while
    another is being sent. The new one is nobody's approved version, and what
    was archived stays so."""
    with SessionLocal() as db:
        provider, fake = google()
        knowledge = service(db, tmp_path, provider)
        source = make(knowledge, "Guide", status=STATUS_INACTIVE)
        source_id, real = source.id, fake.embed_content

        def meanwhile(**kwargs):
            with SessionLocal() as other:
                theirs = service(other, tmp_path, provider)
                {"activate": lambda s: theirs.activate(s, approved_by="somebody else"), "archive": theirs.archive}[decided](theirs.get_source(source_id))
                other.commit()
            return real(**kwargs)

        db.commit()
        fake.embed_content = meanwhile
        attach = lambda: knowledge.attach_document(source, filename="b.md", content_type="text/markdown", data=b"# B\n\nNobody approved this.\n", synthetic=True)  # noqa: E731
        if decided == "archive":
            with pytest.raises(KnowledgeError) as refused:
                attach()
            assert refused.value.status_code == 409
            db.rollback()
        else:
            attach()
            db.commit()
        fake.embed_content = real
    with SessionLocal() as db:
        now = service(db, tmp_path, provider).get_source(source_id)
        assert now.status == ("Archived" if decided == "archive" else STATUS_INACTIVE), "a version nobody approved does not answer"
        assert (now.version, bool(now.archived_at)) == ((1, True) if decided == "archive" else (2, False))


@pytest.mark.parametrize("file, data, status", [("b.md", b"# B\n\nNew words.\n", STATUS_ACTIVE), ("b.pdf", b"%PDF-1.4", STATUS_INACTIVE)])
def test_approving_is_of_what_is_there_when_it_is_approved(pg_sessionmaker, tmp_path, file, data, status):  # noqa: F811
    """On PostgreSQL the row is held from the moment the new version is written
    until it is saved, and read again by whoever was waiting: a version that
    turned out not to be readable is not approved on the strength of the last."""
    import threading

    with pg_sessionmaker() as db:
        source_id = make(service(db, tmp_path), "Guide", status=STATUS_INACTIVE).id
    answered = threading.Event()
    refused: list = []

    def approve():
        with pg_sessionmaker() as other:
            theirs = service(other, tmp_path)
            source = theirs.get_source(source_id)
            assert source.current_document.ingestion_status == "ingested"       # what is on their screen
            try:
                theirs.activate(source, approved_by="somebody else")
                other.commit()
            except KnowledgeError as exc:
                refused.append(exc.status_code)
        answered.set()

    with pg_sessionmaker() as db:
        knowledge = service(db, tmp_path)
        knowledge.attach_document(knowledge.get_source(source_id), filename=file, content_type="application/octet-stream", data=data)
        thread = threading.Thread(target=approve)
        thread.start()
        assert not answered.wait(1.0), "it was approved in the middle of being replaced"
        db.commit()
        assert answered.wait(10)
        thread.join(5)
    with pg_sessionmaker() as db:
        now = service(db, tmp_path).get_source(source_id)
        assert (now.status, now.version, refused) == (status, 2, [] if status == STATUS_ACTIVE else [409])


def test_through_the_console_it_is_said_and_nothing_is_changed(client, admin_client):
    seed_knowledge()
    sources = "/api/v1/admin/companion/knowledge-sources"
    guide = next(s for s in admin_client.get(sources).json() if s["title"] == "Health Number guide")
    runtime = get_runtime()
    provider, fake = google()
    fake.fail_after = 0
    configure_runtime(embeddings=provider)
    refused = admin_client.post(f"{sources}/{guide['id']}/document", files={"file": ("n.md", b"# New\n\nNew words.\n", "text/markdown")})
    assert refused.status_code == 503 and "Nothing was changed" in refused.json()["detail"]
    configure_runtime(embeddings=runtime.embeddings)
    after = next(s for s in admin_client.get(sources).json() if s["id"] == guide["id"])
    assert {k: after[k] for k in ("status", "version", "retrievable", "is_synthetic")} == {k: guide[k] for k in ("status", "version", "retrievable", "is_synthetic")}


def test_an_upload_is_waited_for_by_whoever_sent_it_and_nobody_else():
    """An `async` route would hold every other request on this server while
    Google is asked about each passage."""
    import inspect

    from app.admin.knowledge_routes import attach_document

    assert not inspect.iscoroutinefunction(attach_document)


def test_a_document_nobody_would_wait_for_is_refused_before_anything_is_sent(tmp_path):
    many = "\n\n".join(f"# Part {n}\n\nSomething short." for n in range(MOST_PASSAGES + 1)).encode()
    with SessionLocal() as db:
        provider, fake = google()
        knowledge = service(db, tmp_path, provider)
        source = knowledge.create_source(title="Long", type="FAQ / Help", scope_key="help", synthetic=True)
        with pytest.raises(KnowledgeError) as refused:
            knowledge.attach_document(source, filename="a.md", content_type="text/markdown", data=many, synthetic=True)
        assert refused.value.status_code == 413 and fake.sent == [] and source.documents == []
        local = service(db, tmp_path).attach_document(source, filename="a.md", content_type="text/markdown", data=many, synthetic=True)
        assert local.chunk_count == MOST_PASSAGES + 1, "nobody waits for the local one"


def test_a_table_with_no_full_stop_in_it_is_still_passages():
    from app.knowledge.chunking import chunk_text

    table = " | ".join(f"row {n} value {n * 7}" for n in range(400))
    chunks = chunk_text(f"# Table\n\n{table}\n")
    assert len(chunks) > 5 and all(len(c.text) <= 1100 for c in chunks)
    assert " ".join(c.text for c in chunks).split() == table.split(), "every word, once, in order"
    unbroken = chunk_text("x" * 5000)
    assert "".join(c.text for c in unbroken) == "x" * 5000 and all(len(c.text) <= 1100 for c in unbroken)


# ---- what a member, a guide and the console are told -------------------------------------------

@pytest.fixture
def switched(client):
    """Approved knowledge in the local index, and an API that now searches
    another one."""
    seed_knowledge()
    runtime = get_runtime()
    provider, fake = google()
    model = MockLLMProvider()
    configure_runtime(embeddings=provider, llm=model)
    yield provider, fake, model
    configure_runtime(embeddings=runtime.embeddings, llm=runtime.llm)


def test_sprout_does_not_answer_without_the_knowledge_it_should_have(switched, member_client):
    provider, fake, model = switched
    body = member_client.post(ASK, json={"message": "Explain what my Health Number means"}).json()
    assert body["outcome"] == "unavailable" and body["reply"].startswith("Sprout is not connected to a language model"), "not 'in a moment': it will be the same"
    assert model.requests == [] and fake.sent == [], "nothing was asked of anybody"
    with SessionLocal() as db:
        assert db.query(AiTraceEvent).one().error_category == "index_not_ready"
        assert [m.outcome for m in db.query(CompanionMessage).filter(CompanionMessage.role == "sprout")] == ["unavailable"], "and it is kept, as that"
        # Indexed, and asked again in the same conversation by somebody who is
        # known to be synthetic: an ordinary sign-up is a real person here.
        KnowledgeService(db, get_runtime().object_store, provider).reindex()
        fake.sent.clear()
        refused = member_client.post(ASK, json={"message": "Explain what my Health Number means"}).json()
        assert refused["outcome"] == "unavailable" and fake.sent == [] and model.requests == []
        db.query(UserAccount).update({"is_synthetic": True})
        db.commit()
    answered = member_client.post(ASK, json={"message": "Explain what my Health Number means"}).json()
    assert answered["outcome"] == "answered" and answered["conversation_id"] == body["conversation_id"]
    assert fake.sent == [["Explain what my Health Number means"]]
    assert "Health Number guide" in model.last_request.system


def test_an_urgent_message_is_answered_all_the_same(switched, member_client, admin_client):
    """The safety of a member never waits for a knowledge base."""
    body = member_client.post(ASK, json={"message": "I'm going to kill myself tonight"}).json()
    assert body["outcome"] == "escalated" and body["safety_level"] == "imminent"


def test_the_console_is_told_what_is_missing_and_why(switched, admin_client):
    status = admin_client.get(f"{ADVANCED}/provider-status").json()["embeddings"]
    assert VERTEX in status["index_warning"] and "reindex-knowledge" in status["index_warning"]
    index = admin_client.get(f"{ADVANCED}/retrieval-diagnostics").json()["index"]
    assert index["embedding_model"] == VERTEX and index["chunks_total"] == 0
    assert set(index["other_indexes"]) == {HASHING} and len(index["not_searchable"]) == 3
    refused = admin_client.post(f"{ADVANCED}/retrieval-diagnostics/query", json={"query": QUESTION})
    assert refused.status_code == 503 and "reindex-knowledge" in refused.json()["detail"]


def test_and_when_nothing_is_missing_the_console_is_as_it_was(client, admin_client):
    seed_knowledge()
    assert "index_warning" not in admin_client.get(f"{ADVANCED}/provider-status").json()["embeddings"]
    index = admin_client.get(f"{ADVANCED}/retrieval-diagnostics").json()["index"]
    assert set(index) == {"sources_total", "sources_retrievable", "sources_by_status", "documents_ingested", "chunks_total", "embedding_model"}
    assert index["embedding_model"] == HASHING and index["chunks_total"] > 0


def test_an_administrators_test_words_are_not_sent_outside_unless_the_deployment_is_cleared(client, admin_client):
    """They are meant to be made up. Nothing here knows that they are."""
    seed_knowledge()
    provider, fake = google()
    configure_runtime(embeddings=provider)
    with SessionLocal() as db:
        KnowledgeService(db, get_runtime().object_store, provider).reindex()
    fake.sent.clear()
    refused = admin_client.post(f"{ADVANCED}/retrieval-diagnostics/query", json={"query": "Mrs Patel's cholesterol is 240"})
    assert refused.status_code == 503 and fake.sent == []


def test_whoever_changed_it_is_told_when_the_api_starts(switched, caplog):
    from fastapi.testclient import TestClient

    from app.main import app

    caplog.set_level(logging.WARNING, logger="veye.api")
    with TestClient(app):
        pass
    assert "reindex-knowledge" in caplog.text and VERTEX in caplog.text


def test_a_database_that_does_not_answer_does_not_keep_the_api_from_starting(client, monkeypatch):
    """It accepted the connection and said nothing: the API would have waited
    two minutes, and the platform would have killed it after one."""
    import threading
    import time

    from fastapi.testclient import TestClient

    from app.main import app

    answer = threading.Event()
    monkeypatch.setattr(KnowledgeService, "not_searchable", lambda self, scopes=None: answer.wait(30) and [])
    started = time.monotonic()
    try:
        with TestClient(app) as api:
            assert api.get("/health").status_code == 200
        assert time.monotonic() - started < 6
    finally:
        answer.set()


def test_a_provider_that_is_not_there_does_not_keep_a_new_database_from_being_seeded(client):
    runtime = get_runtime()
    provider, fake = google()
    for missing in (UnconfiguredEmbeddingProvider("VEYE_GEMINI_API_KEY is not set.", 256), provider):
        fake.fail_after = 0
        configure_runtime(embeddings=missing)
        outcome = seed_knowledge()
        assert outcome and all(said.startswith("not created: Nothing was changed") for said in outcome.values()), outcome
        with SessionLocal() as db:
            assert KnowledgeService(db, runtime.object_store, runtime.embeddings).list_sources() == []
    configure_runtime(embeddings=runtime.embeddings)
    assert all(said.startswith("created") for said in seed_knowledge().values()), "and is, next time"


def test_a_guide_stops_at_the_step_and_says_so(switched, member_client, admin_client):
    provider, fake, _ = switched
    definition = {
        "key": "knowledge_probe", "title": "Knowledge probe", "version": 1, "start": "k1",
        "content_meta": {"source": "test", "client_supplied": False, "clinical_review_status": "pending"},
        "sections": [{"key": "s", "title": "S", "start": "k1", "kind": "deterministic"}],
        "nodes": {"k1": {"type": "KNOWLEDGE", "section": "s", "text": "Here is what Veye says.", "query": "What does my Health Number mean?",
                         "scopes": ["health_number"], "next": "done"},
                  "done": {"type": "COMPLETE", "section": "s", "text": "Done."}}}
    with SessionLocal() as db:
        ensure_builtin_flows(db)
        row = GuidedFlow(key="knowledge_probe", title="Knowledge probe", version=1, definition=definition, status=STATUS_DRAFT, source="test")
        db.add(row)
        db.commit()
        flow_id = str(row.id)
    assert admin_client.post(f"/api/v1/admin/companion/guided-flows/{flow_id}/activate").status_code == 200
    start = "/api/v1/companion/guided-flows/knowledge_probe/start"
    stopped = member_client.post(start)
    assert stopped.status_code == 503
    assert stopped.json()["detail"] == "This part of the guide is not available in this environment yet."
    # The guide's own words, published by the team: not held back as a
    # member's are, once there is something to find them in.
    with SessionLocal() as db:
        KnowledgeService(db, get_runtime().object_store, provider).reindex()
    fake.sent.clear()
    # Google is down for a moment: that is said, and nothing is half saved.
    fake.fail_after = 0
    down = member_client.post(start)
    assert down.status_code == 503 and "Please try again in a moment" in down.json()["detail"]
    with SessionLocal() as db:
        assert db.query(MemberGuidedFlowSession).count() == 0, "the guide was not begun, and left in the middle"
    fake.fail_after = None
    step = member_client.post(start)
    assert step.status_code == 200 and len(step.json()["messages"]) >= 2, step.text
    assert fake.sent == [["What does my Health Number mean?"]]


# ---- on the real column -------------------------------------------------------------------------

def test_side_by_side_on_pgvector_each_finds_only_its_own(pg_sessionmaker, tmp_path):  # noqa: F811
    with pg_sessionmaker() as db:
        local = service(db, tmp_path)
        make(local, "Guide")
        make(local, "Other", body="Olive oil is the cooking fat.")
        provider, _ = google()
        outside = service(db, tmp_path, provider)
        assert outside.column_width() == 256
        with pytest.raises(IndexNotReady):
            outside.search(QUESTION, classification=DataClassification.GENERAL)
        outside.reindex()
        for knowledge, label in ((local, HASHING), (outside, VERTEX)):
            hits = knowledge.search(QUESTION, classification=DataClassification.GENERAL)
            assert hits[0].source_title == "Guide"
            assert {db.get(KnowledgeChunk, UUID(hit.chunk_id)).embedding_model for hit in hits} == {label}


def test_two_indexings_at_once_write_every_passage_once(pg_sessionmaker, tmp_path):  # noqa: F811
    import threading

    with pg_sessionmaker() as db:
        for title in ("One", "Two", "Three"):
            make(service(db, tmp_path), title)
    both = threading.Barrier(2)
    wrong: list = []

    def index():
        provider, fake = google()
        real = fake.embed_content

        def together(**kwargs):
            answer = real(**kwargs)
            if len(fake.sent) == 1:
                both.wait(10)      # both have the first document's vectors in hand
            return answer

        fake.embed_content = together
        try:
            with pg_sessionmaker() as db:
                service(db, tmp_path, provider).reindex()
        except Exception as exc:  # noqa: BLE001 - reported below
            wrong.append(exc)

    threads = [threading.Thread(target=index) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)
    assert wrong == []
    with pg_sessionmaker() as db:
        assert labels(db) == {HASHING: 3, VERTEX: 3}


def test_sources_marked_before_this_rule_are_looked_at_when_the_database_is_upgraded():
    """A demonstration that holds anything but the seed's own documents is not
    one, and a source nobody said it of is not either."""
    import os
    import subprocess
    import sys
    from pathlib import Path
    from uuid import uuid4

    from sqlalchemy import create_engine

    from tests.pg import PG_ADMIN_URL

    name = "veye_synthetic_upgrade"
    url = f"{PG_ADMIN_URL.rpartition('/')[0]}/{name}"
    admin = create_engine(PG_ADMIN_URL, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"PostgreSQL is not reachable: {exc}")
    engine = create_engine(url)

    def migrate(revision: str) -> None:
        run = subprocess.run([sys.executable, "-m", "alembic", "upgrade", revision], cwd=str(Path(__file__).resolve().parents[1]),
                             capture_output=True, text=True, env={**os.environ, "VEYE_DATABASE_URL": url})
        assert run.returncode == 0, run.stdout[-1500:] + run.stderr[-1500:]

    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
        migrate("20261125_0033")
        guide = (Path(__file__).resolve().parents[1] / "app" / "seed" / "knowledge_content" / "health-number-guide.md").read_bytes()
        import hashlib

        seeded = hashlib.sha256(guide).hexdigest()
        with engine.begin() as conn:
            for title, documents in (("seed", [seeded]), ("seed and theirs", [seeded, "a" * 64]), ("theirs", ["b" * 64]), ("empty", [])):
                source = uuid4()
                conn.execute(text("INSERT INTO knowledge_sources (id, title, type, scope_key, description, status, version, created_at, updated_at) "
                                  "VALUES (:id, :t, 'FAQ / Help', 'help', '', 'Draft', 1, now(), now())"), {"id": source, "t": title})
                for sha256 in documents:
                    conn.execute(text("INSERT INTO knowledge_documents (id, source_id, source_version, object_key, filename, content_type, byte_size, sha256, "
                                      "is_current, ingestion_status, chunk_count, created_at) VALUES (gen_random_uuid(), :s, 1, 'k', 'f.md', 'text/markdown', 1, :h, true, "
                                      "'ingested', 0, now())"), {"s": source, "h": sha256})
            assert set(conn.execute(text("SELECT is_synthetic FROM knowledge_sources")).scalars()) == {True}, "as it was: unless somebody said otherwise"
        migrate("head")
        with engine.begin() as conn:
            marked = dict(conn.execute(text("SELECT title, is_synthetic FROM knowledge_sources")).tuples().all())
            assert marked == {"seed": True, "seed and theirs": False, "theirs": False, "empty": True}
            conn.execute(text("INSERT INTO knowledge_sources (id, title, type, scope_key, description, status, version, created_at, updated_at) "
                              "VALUES (gen_random_uuid(), 'new', 'FAQ / Help', 'help', '', 'Draft', 1, now(), now())"))
            assert conn.execute(text("SELECT is_synthetic FROM knowledge_sources WHERE title = 'new'")).scalar() is False
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def test_an_approved_passage_is_found_however_many_nearer_ones_may_not_be_used(pg_sessionmaker, tmp_path):  # noqa: F811
    """The approximate index keeps its nearest few and only then are they asked
    whether they may be used. With another index beside, or a large inactive
    source, its nearest few may all be ones that may not."""
    with pg_sessionmaker() as db:
        db.execute(text("CREATE INDEX near ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)"))
        local = service(db, tmp_path)
        source = make(local, "Guide", body="Something only distantly about the scale.")
        chunk = db.query(KnowledgeChunk).one()
        exactly = local.embeddings.embed([QUESTION])[0]
        db.add_all(KnowledgeChunk(document_id=chunk.document_id, source_id=source.id, ordinal=100 + n, text="x", embedding=exactly,
                                  embedding_model="another-index", meta={}) for n in range(400))
        db.commit()
        # What a large table would do by itself.
        for other_way in ("seqscan", "bitmapscan", "sort"):
            db.execute(text(f"SET enable_{other_way} = off"))
        assert [hit.source_title for hit in local.search(QUESTION, limit=4)] == ["Guide"]


def test_a_width_the_column_does_not_have_is_found_out_before_anything_is_sent(pg_sessionmaker, tmp_path):  # noqa: F811
    with pg_sessionmaker() as db:
        make(service(db, tmp_path), "Guide")
        provider, fake = google(dimensions=768)
        knowledge = service(db, tmp_path, provider)
        for attempt, kind in ((lambda: knowledge.search(QUESTION, classification=DataClassification.GENERAL), WrongWidth), (knowledge.reindex, NotAllIndexed)):
            with pytest.raises(kind) as refused:
                attempt()
            assert "vector(256)" in refused.value.detail and "768" in refused.value.detail
        assert fake.sent == [] and knowledge.index_stats()["column_width"] == 256
        source = knowledge.create_source(title="New", type="FAQ / Help", scope_key="help")
        with pytest.raises(WrongWidth):
            knowledge.attach_document(source, filename="a.md", content_type="text/markdown", data=b"# A\n\nWords.\n")
        assert source.documents == []
