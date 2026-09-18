"""KnowledgeService: source lifecycle, document attachment, ingestion and
retrieval. Only Active + approved sources whose current document is ingested
can be retrieved; Inactive, Draft and Archived sources never are."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy import cast, func, literal, select
from sqlalchemy.orm import Session, selectinload

from app.companion.providers.embeddings import EmbeddingProvider, cosine_similarity
from app.knowledge.chunking import chunk_text
from app.knowledge.models import (
    SCOPES,
    SOURCE_TYPES,
    STATUS_ACTIVE,
    STATUS_ARCHIVED,
    STATUS_DRAFT,
    STATUS_INACTIVE,
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeSource,
)
from app.knowledge.object_store import KnowledgeObjectStore
from app.knowledge.vector_type import Vector

TEXT_CONTENT_TYPES = {"text/plain", "text/markdown", "text/x-markdown"}
TEXT_EXTENSIONS = {".txt", ".md", ".markdown"}


class KnowledgeError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class RetrievedChunk:
    source_id: str
    document_id: str
    chunk_id: str
    source_title: str
    source_version: int
    scope_key: str
    heading: str | None
    text: str
    score: float

    def provenance(self) -> dict:
        return {"source_id": self.source_id, "document_id": self.document_id, "chunk_id": self.chunk_id,
                "source_version": self.source_version, "score": round(self.score, 4), "title": self.source_title}


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-") or "document"
    return cleaned[:120]


class KnowledgeService:
    def __init__(self, db: Session, object_store: KnowledgeObjectStore, embeddings: EmbeddingProvider) -> None:
        self.db = db
        self.object_store = object_store
        self.embeddings = embeddings

    # ---- sources ----------------------------------------------------------------------
    def list_sources(self, *, include_archived: bool = True) -> list[KnowledgeSource]:
        query = select(KnowledgeSource).options(selectinload(KnowledgeSource.documents)).order_by(KnowledgeSource.created_at.asc())
        if not include_archived:
            query = query.where(KnowledgeSource.status != STATUS_ARCHIVED)
        return list(self.db.scalars(query).all())

    def get_source(self, source_id: UUID) -> KnowledgeSource:
        source = self.db.get(KnowledgeSource, source_id)
        if source is None:
            raise KnowledgeError(404, "Knowledge source not found.")
        return source

    def create_source(self, *, title: str, type: str, scope_key: str, description: str = "", reference_label: str | None = None,
                      effective_date: date | None = None, synthetic: bool = True) -> KnowledgeSource:
        self._validate_metadata(title, type, scope_key)
        source = KnowledgeSource(title=title.strip(), type=type, scope_key=scope_key, description=description.strip(),
                                 reference_label=(reference_label or "").strip() or None, effective_date=effective_date,
                                 status=STATUS_DRAFT, is_synthetic=synthetic)
        self.db.add(source)
        self.db.flush()
        return source

    def update_source(self, source: KnowledgeSource, *, title: str, type: str, scope_key: str, description: str,
                      reference_label: str | None, effective_date: date | None) -> KnowledgeSource:
        if source.status == STATUS_ARCHIVED:
            raise KnowledgeError(409, "Restore the archived source before editing it.")
        self._validate_metadata(title, type, scope_key)
        source.title, source.type, source.scope_key = title.strip(), type, scope_key
        source.description = description.strip()
        source.reference_label = (reference_label or "").strip() or None
        source.effective_date = effective_date
        self.db.flush()
        return source

    def _validate_metadata(self, title: str, type: str, scope_key: str) -> None:
        if not title.strip():
            raise KnowledgeError(422, "Give this source a clear title.")
        if type not in SOURCE_TYPES:
            raise KnowledgeError(422, "Choose one of the source types.")
        if scope_key not in SCOPES:
            raise KnowledgeError(422, "Choose one of the retrieval scopes.")

    # ---- lifecycle ------------------------------------------------------------------------
    def activate(self, source: KnowledgeSource, *, approved_by: str) -> KnowledgeSource:
        if source.status == STATUS_ARCHIVED:
            raise KnowledgeError(409, "Restore the archived source before activating it.")
        document = source.current_document
        if document is None or document.ingestion_status != "ingested":
            raise KnowledgeError(409, "Attach a document and let it ingest before activating this source.")
        source.status = STATUS_ACTIVE
        source.approved_by = approved_by
        source.approved_at = datetime.now(timezone.utc)
        self.db.flush()
        return source

    def deactivate(self, source: KnowledgeSource) -> KnowledgeSource:
        if source.status == STATUS_ARCHIVED:
            raise KnowledgeError(409, "This source is archived.")
        source.status = STATUS_INACTIVE
        self.db.flush()
        return source

    def archive(self, source: KnowledgeSource) -> KnowledgeSource:
        source.status = STATUS_ARCHIVED
        source.archived_at = datetime.now(timezone.utc)
        self.db.flush()
        return source

    def restore(self, source: KnowledgeSource) -> KnowledgeSource:
        if source.status != STATUS_ARCHIVED:
            raise KnowledgeError(409, "Only an archived source can be restored.")
        source.status = STATUS_INACTIVE
        source.archived_at = None
        self.db.flush()
        return source

    # ---- documents + ingestion ------------------------------------------------------------
    def attach_document(self, source: KnowledgeSource, *, filename: str, content_type: str, data: bytes) -> KnowledgeDocument:
        if source.status == STATUS_ARCHIVED:
            raise KnowledgeError(409, "Restore the archived source before attaching a document.")
        if not data:
            raise KnowledgeError(422, "The uploaded file is empty.")
        if len(data) > 5 * 1024 * 1024:
            raise KnowledgeError(413, "Documents larger than 5 MB are not accepted in the local environment.")
        if source.current_document is not None:
            for previous in source.documents:
                previous.is_current = False
            source.version += 1
        key = f"sources/{source.id}/v{source.version}/{uuid.uuid4().hex}-{_safe_filename(filename)}"
        stored = self.object_store.put(key, data, content_type)
        document = KnowledgeDocument(source_id=source.id, source_version=source.version, object_key=stored.key,
                                     filename=filename[:240], content_type=content_type, byte_size=stored.byte_size,
                                     sha256=stored.sha256, is_current=True)
        self.db.add(document)
        self.db.flush()
        self.db.expire(source, ["documents"])
        self.ingest(document)
        # A new version is not automatically approved: an Active source drops
        # to Inactive until an administrator activates the new document.
        if source.status == STATUS_ACTIVE:
            source.status = STATUS_INACTIVE
        self.db.flush()
        return document

    def ingest(self, document: KnowledgeDocument) -> KnowledgeDocument:
        try:
            text = self._extract_text(document)
            chunks = chunk_text(text)
            if not chunks:
                raise KnowledgeError(422, "The document contains no readable text.")
            vectors = self.embeddings.embed([c.text for c in chunks])
            for chunk, vector in zip(chunks, vectors):
                self.db.add(KnowledgeChunk(document_id=document.id, source_id=document.source_id, ordinal=chunk.ordinal,
                                           heading=chunk.heading, text=chunk.text, token_estimate=chunk.token_estimate,
                                           embedding=vector, embedding_model=self.embeddings.model,
                                           meta={"filename": document.filename}))
            document.chunk_count = len(chunks)
            document.embedding_model = self.embeddings.model
            document.ingestion_status = "ingested"
            document.ingestion_error = None
            document.ingested_at = datetime.now(timezone.utc)
        except KnowledgeError as exc:
            document.ingestion_status = "failed"
            document.ingestion_error = exc.detail
        self.db.flush()
        return document

    def _extract_text(self, document: KnowledgeDocument) -> str:
        extension = "." + document.filename.rsplit(".", 1)[-1].lower() if "." in document.filename else ""
        if document.content_type.split(";")[0].strip() not in TEXT_CONTENT_TYPES and extension not in TEXT_EXTENSIONS:
            raise KnowledgeError(415, "Only plain-text and Markdown documents are ingested in this environment.")
        raw = self.object_store.get(document.object_key)
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise KnowledgeError(422, "The document is not UTF-8 text.") from exc

    # ---- retrieval ------------------------------------------------------------------------
    def search(self, query: str, *, scopes: list[str] | None = None, limit: int = 4) -> list[RetrievedChunk]:
        query = query.strip()
        if not query:
            return []
        vector = self.embeddings.embed([query])[0]
        base = (
            select(KnowledgeChunk, KnowledgeSource, KnowledgeDocument)
            .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
            .join(KnowledgeSource, KnowledgeChunk.source_id == KnowledgeSource.id)
            .where(
                KnowledgeSource.status == STATUS_ACTIVE,
                KnowledgeSource.approved_at.is_not(None),
                KnowledgeDocument.is_current.is_(True),
                KnowledgeDocument.ingestion_status == "ingested",
                KnowledgeChunk.embedding_model == self.embeddings.model,
                KnowledgeChunk.embedding.is_not(None),
            )
        )
        if scopes:
            base = base.where(KnowledgeSource.scope_key.in_(scopes))

        if self.db.get_bind().dialect.name == "postgresql":

            distance = KnowledgeChunk.embedding.cosine_distance(cast(literal(vector, type_=Vector(len(vector))), Vector(len(vector))))
            rows = self.db.execute(base.add_columns(distance.label("distance")).order_by(distance.asc()).limit(limit)).all()
            scored = [(chunk, source, document, 1.0 - float(dist)) for chunk, source, document, dist in rows]
        else:
            rows = self.db.execute(base).all()
            scored = sorted(
                ((chunk, source, document, cosine_similarity(chunk.embedding or [], vector)) for chunk, source, document in rows),
                key=lambda item: item[3], reverse=True,
            )[:limit]
        return [
            RetrievedChunk(source_id=str(source.id), document_id=str(document.id), chunk_id=str(chunk.id),
                           source_title=source.title, source_version=document.source_version, scope_key=source.scope_key,
                           heading=chunk.heading, text=chunk.text, score=score)
            for chunk, source, document, score in scored
        ]

    def index_stats(self) -> dict:
        sources = self.list_sources()
        active = [s for s in sources if s.retrievable]
        chunk_count = self.db.scalar(select(func.count(KnowledgeChunk.id))) or 0
        return {
            "sources_total": len(sources), "sources_retrievable": len(active),
            "sources_by_status": {status: sum(1 for s in sources if s.status == status) for status in (STATUS_DRAFT, STATUS_INACTIVE, STATUS_ACTIVE, STATUS_ARCHIVED)},
            "documents_ingested": sum(1 for s in sources for d in s.documents if d.ingestion_status == "ingested"),
            "chunks_total": int(chunk_count), "embedding_model": self.embeddings.model,
        }
