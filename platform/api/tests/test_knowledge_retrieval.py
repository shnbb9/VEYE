"""Approved-knowledge lifecycle and retrieval.

The lifecycle rules run on the SQLite fixture (Python-ranked); the pgvector
retrieval test runs against the real local PostgreSQL and is skipped only
when that database is unreachable."""

from pathlib import Path

import pytest

from app.companion.providers.embeddings import HashingEmbeddingProvider
from app.db.session import SessionLocal
from app.knowledge.models import STATUS_ACTIVE, STATUS_ARCHIVED, STATUS_DRAFT, STATUS_INACTIVE, KnowledgeChunk
from app.knowledge.object_store import LocalFileKnowledgeObjectStore
from app.knowledge.service import KnowledgeError, KnowledgeService
from app.seed.knowledge import SEED_SOURCES, seed_knowledge
from tests.pg import pg_sessionmaker  # noqa: F401 - fixture

CONTENT = Path("app/seed/knowledge_content")


def _service(db, tmp_path):
    return KnowledgeService(db, LocalFileKnowledgeObjectStore(tmp_path / "objects"), HashingEmbeddingProvider(256))


def _make(service, title, scope, status, text=b"# Note\n\nThe Health Number is shown on a scale of 1 to 10 where lower is better.\n"):
    source = service.create_source(title=title, type="VEYE educational document", scope_key=scope, description="t")
    service.attach_document(source, filename="note.md", content_type="text/markdown", data=text)
    if status in (STATUS_ACTIVE, STATUS_INACTIVE, STATUS_ARCHIVED):
        service.activate(source, approved_by="test")
    if status == STATUS_INACTIVE:
        service.deactivate(source)
    if status == STATUS_ARCHIVED:
        service.archive(source)
    return source


def test_only_active_approved_sources_are_retrievable(tmp_path):
    with SessionLocal() as db:
        service = _service(db, tmp_path)
        active = _make(service, "Active guide", "health_number", STATUS_ACTIVE)
        _make(service, "Inactive guide", "health_number", STATUS_INACTIVE)
        _make(service, "Archived guide", "health_number", STATUS_ARCHIVED)
        _make(service, "Draft guide", "health_number", STATUS_DRAFT)
        db.commit()

        hits = service.search("what does the health number scale mean", limit=10)
        assert {hit.source_title for hit in hits} == {"Active guide"}
        assert hits[0].source_id == str(active.id)
        assert hits[0].document_id and hits[0].chunk_id and hits[0].source_version == 1
        assert 0 < hits[0].score <= 1


def test_retrieval_scope_filtering(tmp_path):
    with SessionLocal() as db:
        service = _service(db, tmp_path)
        _make(service, "Health guide", "health_number", STATUS_ACTIVE)
        _make(service, "Help guide", "help", STATUS_ACTIVE)
        db.commit()
        hits = service.search("health number scale", scopes=["help"], limit=10)
        assert {hit.source_title for hit in hits} == {"Help guide"}
        assert service.search("health number scale", scopes=["food_choices"], limit=10) == []


def test_activation_needs_an_ingested_document_and_versions_demote(tmp_path):
    with SessionLocal() as db:
        service = _service(db, tmp_path)
        source = service.create_source(title="No document yet", type="FAQ / Help", scope_key="help")
        with pytest.raises(KnowledgeError) as excinfo:
            service.activate(source, approved_by="test")
        assert excinfo.value.status_code == 409

        # Unsupported file types fail honestly and cannot be activated.
        failed = service.attach_document(source, filename="guide.pdf", content_type="application/pdf", data=b"%PDF-1.4")
        assert failed.ingestion_status == "failed" and "Markdown" in failed.ingestion_error
        with pytest.raises(KnowledgeError):
            service.activate(source, approved_by="test")

        ok = service.attach_document(source, filename="guide.md", content_type="text/markdown", data=b"# Guide\n\nUse the show/hide control to check your password.\n")
        assert ok.ingestion_status == "ingested" and ok.chunk_count == 1 and source.version == 2
        service.activate(source, approved_by="Cara")
        assert source.status == STATUS_ACTIVE and source.approved_by == "Cara" and source.approved_at

        # A newer document is not automatically approved.
        newer = service.attach_document(source, filename="guide-v3.md", content_type="text/markdown", data=b"# Guide\n\nRevised wording.\n")
        assert source.status == STATUS_INACTIVE and source.version == 3 and newer.is_current
        assert [d.is_current for d in source.documents].count(True) == 1
        db.commit()
        assert service.search("password show hide control", limit=5) == []

        service.activate(source, approved_by="Cara")
        db.commit()
        hits = service.search("revised wording", limit=5)
        assert hits and hits[0].source_version == 3

        service.archive(source)
        assert source.status == STATUS_ARCHIVED and source.archived_at
        with pytest.raises(KnowledgeError):
            service.update_source(source, title="x", type="FAQ / Help", scope_key="help", description="", reference_label=None, effective_date=None)
        service.restore(source)
        assert source.status == STATUS_INACTIVE and source.archived_at is None


def test_seed_is_idempotent_and_matches_the_lifecycle_model(client):
    first = seed_knowledge()
    second = seed_knowledge()
    assert all(value.startswith("created:") for value in first.values())
    assert set(second.values()) == {"exists"}
    with SessionLocal() as db:
        from app.core.runtime import get_runtime

        runtime = get_runtime()
        service = KnowledgeService(db, runtime.object_store, runtime.embeddings)
        by_title = {s.title: s for s in service.list_sources()}
        assert {spec.title: spec.target_status for spec in SEED_SOURCES} == {t: s.status for t, s in by_title.items()}
        assert all(s.approved_at is not None and s.is_synthetic for s in by_title.values())
        hits = service.search("what does my health number mean", limit=3)
        assert hits and hits[0].source_title == "Health Number guide"
        titles = {hit.source_title for hit in service.search("welcome magnesium snack", limit=10)}
        assert "Superseded welcome note" not in titles and "Food Choices reference" not in titles


def test_chunk_text_never_carries_the_original_binary(tmp_path):
    with SessionLocal() as db:
        service = _service(db, tmp_path)
        data = (CONTENT / "health-number-guide.md").read_bytes()
        source = service.create_source(title="HN", type="VEYE educational document", scope_key="health_number")
        document = service.attach_document(source, filename="health-number-guide.md", content_type="text/markdown", data=data)
        chunks = db.query(KnowledgeChunk).filter(KnowledgeChunk.document_id == document.id).order_by(KnowledgeChunk.ordinal).all()
        assert document.chunk_count == len(chunks) > 1
        assert all(len(c.embedding) == 256 for c in chunks)
        assert document.sha256 and document.byte_size == len(data)
        assert service.object_store.get(document.object_key) == data


def test_pgvector_retrieval_on_real_postgresql(pg_sessionmaker, tmp_path):  # noqa: F811
    with pg_sessionmaker() as db:
        assert db.get_bind().dialect.name == "postgresql"
        service = _service(db, tmp_path)
        for spec in SEED_SOURCES:
            source = service.create_source(title=spec.title, type=spec.type, scope_key=spec.scope_key, description=spec.description)
            service.attach_document(source, filename=spec.filename, content_type="text/markdown", data=(CONTENT / spec.filename).read_bytes())
            service.activate(source, approved_by="pg-test")
            if spec.target_status == STATUS_INACTIVE:
                service.deactivate(source)
            elif spec.target_status == STATUS_ARCHIVED:
                service.archive(source)
        db.commit()

        stored = db.query(KnowledgeChunk).first()
        assert len(stored.embedding) == 256  # round-trips through the vector(256) column

        hits = service.search("what does my health number mean and is lower better", limit=3)
        assert hits, "pgvector cosine search returned nothing"
        assert hits[0].source_title == "Health Number guide"
        assert hits[0].score >= hits[-1].score
        assert all(hit.source_title not in {"Superseded welcome note", "Food Choices reference"} for hit in service.search("welcome snack carbohydrates", limit=10))
        scoped = service.search("how do I use the Veye site", scopes=["help"], limit=3)
        assert scoped and all(hit.scope_key == "help" for hit in scoped)
        assert all({"source_id", "document_id", "chunk_id", "source_version", "score", "title"} <= set(hit.provenance()) for hit in hits)
