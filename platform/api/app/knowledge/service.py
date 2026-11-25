"""KnowledgeService: source lifecycle, document attachment, ingestion and
retrieval. Only Active + approved sources whose current document is ingested
can be retrieved; Inactive, Draft and Archived sources never are."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Callable
from uuid import UUID

from sqlalchemy import cast, func, literal, select, text
from sqlalchemy.orm import Session, selectinload

from app.companion.providers.embeddings import EmbeddingProvider, cosine_similarity
from app.companion.providers.llm import DataClassification, ProviderFailed, ProviderNotConfigured, leaves_veye
from app.knowledge import extract as extract_module
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

# Kept as re-exports: callers and tests imported these from here before the
# readers moved into `extract`.
TEXT_CONTENT_TYPES = extract_module.TEXT_CONTENT_TYPES
TEXT_EXTENSIONS = extract_module.TEXT_EXTENSIONS
SUPPORTED_EXTENSIONS = extract_module.SUPPORTED_EXTENSIONS
MOST_BYTES = 5 * 1024 * 1024


class KnowledgeError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class IndexNotReady(KnowledgeError):
    """Approved knowledge exists that the configured embedding provider cannot
    search. Answering from the rest, or from none of it, would look like an
    answer, so nothing is answered."""
    category = "index_not_ready"

    def __init__(self, index: str, titles: list[str]) -> None:
        super().__init__(503, f"{len(titles)} approved knowledge source(s) have not been indexed for '{index}', which is what this deployment "
                              "searches with. Run 'python -m app.jobs run reindex-knowledge', or go back to the embedding provider they were "
                              "indexed with; nothing has been lost.")
        self.index, self.titles = index, titles


class WrongWidth(KnowledgeError):
    """The column is as wide as the migration made it."""
    category = "index_width"

    def __init__(self, column: int, configured: int) -> None:
        super().__init__(409, f"The knowledge column is vector({column}) and VEYE_EMBEDDING_DIMENSIONS is {configured}. They change together, "
                              "in a migration, with every source indexed again.")


class NotEmbedded(KnowledgeError):
    """The embedding provider did not do it. Nothing has been changed: what was
    approved yesterday still answers."""

    def __init__(self, reason: Exception) -> None:
        super().__init__(503, f"Nothing was changed: the document could not be indexed. {reason}")
        self.category = getattr(reason, "category", "provider_error")
        self.reason = reason


class NotAllIndexed(KnowledgeError):
    """Some of it was."""

    def __init__(self, counts: dict, failed: list[str]) -> None:
        super().__init__(409, f"{counts['indexed']} of {counts['documents']} document(s) indexed. Not: {'; '.join(failed)}")
        self.counts = counts


# Why a search did not happen, for whoever has to say so.
SEARCH_FAILED = (IndexNotReady, WrongWidth, ProviderNotConfigured, ProviderFailed)
# What another document would meet as well: no use going on.
_FOR_EVERY_DOCUMENT = ("provider_not_configured", "provider_auth", "provider_permission", "provider_model", "provider_quota", "provider_rate_limited",
                       "provider_timeout", "provider_unavailable", "provider_budget", "index_width")
# With an outside provider somebody is waiting while each passage is sent.
MOST_PASSAGES = 400


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
    # Written for demonstration, or one of the client's own documents? Not
    # said is the client's.
    synthetic: bool = False

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
                      effective_date: date | None = None, synthetic: bool = False) -> KnowledgeSource:
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
    def _as_it_is_now(self, source: KnowledgeSource) -> None:
        """Held, and read again: somebody else may have decided something."""
        self.db.refresh(source, with_for_update=True)
        self.db.expire(source, ["documents"])

    def activate(self, source: KnowledgeSource, *, approved_by: str) -> KnowledgeSource:
        self._as_it_is_now(source)
        if source.status == STATUS_ARCHIVED:
            raise KnowledgeError(409, "Restore the archived source before activating it.")
        document = source.current_document
        if document is None or document.ingestion_status != "ingested":
            raise KnowledgeError(409, "Attach a document and let it ingest before activating this source.")
        if self.db.scalar(select(KnowledgeDocument.id).where(KnowledgeDocument.id == document.id, self._in_index())) is None:
            # Every question in its scope would be refused for the want of it.
            raise KnowledgeError(409, f"This source has not been indexed for '{self.embeddings.index}', which is what Sprout searches. "
                                      "Run 'python -m app.jobs run reindex-knowledge' first.")
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
    def attach_document(self, source: KnowledgeSource, *, filename: str, content_type: str, data: bytes,
                        synthetic: bool = False) -> KnowledgeDocument:
        """`synthetic` only when whoever calls knows that this document is. A
        source is synthetic while everything ever attached to it was."""
        if source.status == STATUS_ARCHIVED:
            raise KnowledgeError(409, "Restore the archived source before attaching a document.")
        if not data:
            raise KnowledgeError(422, "The uploaded file is empty.")
        if len(data) > MOST_BYTES:
            raise KnowledgeError(413, "Documents larger than 5 MB are not accepted in the local environment.")
        # Read, and indexed, before anything is changed: a provider that does
        # not answer must not take the approved version off the shelf.
        unreadable: KnowledgeError | None = None
        vectors: list[list[float]] = []
        try:
            extracted = self._extract(filename, content_type, data)
            chunks = chunk_text(extracted.text)
            if not chunks:
                raise KnowledgeError(422, "The document contains no readable text.")
        except KnowledgeError as exc:
            unreadable = exc
        else:
            if len(chunks) > MOST_PASSAGES and leaves_veye(self.embeddings):
                raise KnowledgeError(413, f"This document is {len(chunks)} passages, and at most {MOST_PASSAGES} can be indexed at once. Divide it.")
            vectors = self._embed(chunks, client_content=not (source.is_synthetic and synthetic))
        # That took as long as it took. What is decided from here is decided on
        # what is so now: it may have been approved, archived or given another
        # version meanwhile.
        self._as_it_is_now(source)
        if source.status == STATUS_ARCHIVED:
            raise KnowledgeError(409, "Restore the archived source before attaching a document.")
        source.is_synthetic = source.is_synthetic and synthetic
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
        if unreadable is not None:
            document.ingestion_status = "failed"
            document.ingestion_error = unreadable.detail
        else:
            for chunk, vector in zip(chunks, vectors):
                self.db.add(KnowledgeChunk(document_id=document.id, source_id=document.source_id, ordinal=chunk.ordinal,
                                           heading=chunk.heading, text=chunk.text, token_estimate=chunk.token_estimate,
                                           embedding=vector, embedding_model=self.embeddings.index,
                                           meta={"filename": document.filename,
                                                 "extracted_from": extracted.kind}))
            document.chunk_count = len(chunks)
            document.embedding_model = self.embeddings.index
            document.ingestion_status = "ingested"
            document.extraction_note = extracted.note
            document.ingested_at = datetime.now(timezone.utc)
        # A new version is not automatically approved: an Active source drops
        # to Inactive until an administrator activates the new document.
        if source.status == STATUS_ACTIVE:
            source.status = STATUS_INACTIVE
        self.db.flush()
        return document

    def _embed(self, passages, *, client_content: bool) -> list[list[float]]:
        """Approved knowledge, not anybody's personal data."""
        self._require_width()
        failed: Exception | None = None
        try:
            return self.embeddings.embed([p.text for p in passages], purpose="document", classification=DataClassification.GENERAL,
                                         client_content=client_content)
        except (ProviderNotConfigured, ProviderFailed) as exc:
            failed = exc
        raise NotEmbedded(failed)

    def _require_width(self) -> None:
        """Found out before anything is sent anywhere, not from a database
        error afterwards."""
        column = self.column_width()
        if column is not None and self.embeddings.dimensions not in (0, column):
            raise WrongWidth(column, self.embeddings.dimensions)

    def column_width(self) -> int | None:
        if self.db.get_bind().dialect.name != "postgresql":
            return None
        return self.db.execute(text("SELECT atttypmod FROM pg_attribute WHERE attrelid = 'knowledge_chunks'::regclass "
                                    "AND attname = 'embedding'")).scalar()

    # ---- which index is searched ----------------------------------------------------------
    def _retrievable(self, query, scopes: list[str] | None = None):
        query = query.where(KnowledgeSource.status == STATUS_ACTIVE, KnowledgeSource.approved_at.is_not(None),
                            KnowledgeDocument.is_current.is_(True), KnowledgeDocument.ingestion_status == "ingested")
        return query.where(KnowledgeSource.scope_key.in_(scopes)) if scopes else query

    def _in_index(self):
        """Of a document: it has passages in the index this deployment searches."""
        return (select(KnowledgeChunk.id).where(KnowledgeChunk.document_id == KnowledgeDocument.id,
                                                KnowledgeChunk.embedding_model == self.embeddings.index,
                                                KnowledgeChunk.embedding.is_not(None)).exists())

    def not_searchable(self, scopes: list[str] | None = None) -> list[str]:
        """Approved sources that would be silently missing from an answer."""
        query = select(KnowledgeSource.title).join(KnowledgeDocument, KnowledgeDocument.source_id == KnowledgeSource.id)
        return list(self.db.scalars(self._retrievable(query, scopes).where(~self._in_index()).order_by(KnowledgeSource.title)).all())

    def reindex(self, *, dry_run: bool = False) -> dict:
        """Write what is missing from the index this deployment searches with,
        beside whatever is there. Nothing is replaced or removed: the index a
        source was first written to still answers if the provider is changed
        back, and running this twice does nothing the second time. Inactive
        and archived sources too, so that activating one does not lose it."""
        waiting = list(self.db.scalars(
            select(KnowledgeDocument.id).join(KnowledgeSource, KnowledgeDocument.source_id == KnowledgeSource.id)
            .where(KnowledgeDocument.is_current.is_(True), KnowledgeDocument.ingestion_status == "ingested", ~self._in_index())
            .order_by(KnowledgeSource.created_at)).all())
        counts = {"index": self.embeddings.index, "documents": len(waiting), "indexed": 0, "passages": 0}
        failed: list[str] = []
        for document_id in waiting:
            document = self.db.get(KnowledgeDocument, document_id)
            title = document.source.title
            try:
                passages = self._passages(document)
                if not dry_run:
                    self._reindex_one(document, passages)
            except KnowledgeError as exc:
                # One that cannot be indexed does not keep the others out.
                self.db.rollback()
                failed.append(f"{title} ({exc.detail})")
                if getattr(exc, "category", "") in _FOR_EVERY_DOCUMENT:
                    break
                continue
            counts["indexed"] += 0 if dry_run else 1
            counts["passages"] += len(passages)
        if failed:
            raise NotAllIndexed(counts, failed)
        return counts

    def _reindex_one(self, document: KnowledgeDocument, passages: list[KnowledgeChunk]) -> None:
        # The same passages in the same order, read once and embedded again:
        # what an answer may quote does not change with the index.
        vectors = self._embed(passages, client_content=not document.source.is_synthetic)
        # Held, and looked at again: two of these running at once must not
        # write every passage twice.
        self.db.query(KnowledgeDocument.id).filter(KnowledgeDocument.id == document.id).with_for_update().one()
        if self.db.scalar(select(KnowledgeDocument.id).where(KnowledgeDocument.id == document.id, self._in_index())) is None:
            self.db.add_all(KnowledgeChunk(
                document_id=document.id, source_id=document.source_id, ordinal=p.ordinal, heading=p.heading, text=p.text,
                token_estimate=p.token_estimate, embedding=vector, embedding_model=self.embeddings.index, meta=dict(p.meta))
                for p, vector in zip(passages, vectors))
            document.embedding_model = self.embeddings.index
        # One document at a time: what was paid for is kept if the next one
        # fails, and it is found already done when this runs again.
        self.db.commit()

    def _passages(self, document: KnowledgeDocument) -> list[KnowledgeChunk]:
        """As they were first written, from whichever index has them all."""
        rows = list(self.db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id)
                                    .order_by(KnowledgeChunk.created_at, KnowledgeChunk.ordinal)).all())
        first = [row for row in rows if rows and row.embedding_model == rows[0].embedding_model]
        if len(first) != document.chunk_count:
            raise KnowledgeError(409, f"'{document.filename}' has {len(first)} of its {document.chunk_count} passages. Attach it again instead.")
        return sorted(first, key=lambda row: row.ordinal)

    def _extract(self, filename: str, content_type: str, raw: bytes) -> extract_module.Extracted:
        """Text, Word and PDF."""
        try:
            return extract_module.extract(filename[:240], content_type, raw)
        except extract_module.ExtractionError as exc:
            raise KnowledgeError(exc.status_code, exc.detail) from exc

    # ---- retrieval ------------------------------------------------------------------------
    def search(self, query: str, *, scopes: list[str] | None = None, limit: int = 4,
               classification: DataClassification = DataClassification.REAL_MEMBER,
               before_leaving: Callable[[], None] | None = None) -> list[RetrievedChunk]:
        """`before_leaving` is called before an outside provider is waited for:
        whoever holds a transaction can let go of it."""
        query = query.strip()
        if not query:
            return []
        if self.embeddings.index != "none":     # no provider at all says why itself, just below
            self._require_width()
            missing = self.not_searchable(scopes)
            if missing:
                raise IndexNotReady(self.embeddings.index, missing)
            if before_leaving is not None and leaves_veye(self.embeddings):
                before_leaving()
        # The member's own words, and the Companion retrieves before it runs
        # the outbound privacy filter, so this is unredacted text. An
        # external provider refuses it unless the deployment is cleared.
        vector = self.embeddings.embed([query], purpose="query",
                                       classification=classification)[0]
        base = self._retrievable(
            select(KnowledgeChunk, KnowledgeSource, KnowledgeDocument)
            .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
            .join(KnowledgeSource, KnowledgeChunk.source_id == KnowledgeSource.id)
            .where(KnowledgeChunk.embedding_model == self.embeddings.index, KnowledgeChunk.embedding.is_not(None)),
            scopes)

        if self.db.get_bind().dialect.name == "postgresql":
            # `+ 0.0`: measured against every passage that may be used. The
            # approximate index would find its nearest few first and only then
            # ask whether they are approved, in scope and of this index, which
            # with two indexes side by side can leave nothing at all.
            distance = KnowledgeChunk.embedding.cosine_distance(cast(literal(vector, type_=Vector(len(vector))), Vector(len(vector)))) + 0.0
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
                           heading=chunk.heading, text=chunk.text, score=score, synthetic=source.is_synthetic)
            for chunk, source, document, score in scored
        ]

    def index_stats(self) -> dict:
        sources = self.list_sources()
        active = [s for s in sources if s.retrievable]
        by_index = dict(self.db.execute(select(KnowledgeChunk.embedding_model, func.count(KnowledgeChunk.id))
                                        .group_by(KnowledgeChunk.embedding_model)).tuples().all())
        chunk_count = by_index.pop(self.embeddings.index, 0)
        missing, width = self.not_searchable(), self.column_width()
        # Said only when there is something to say.
        beside = {"other_indexes": by_index} if by_index else {}
        if missing:
            beside["not_searchable"] = missing
        if width is not None and self.embeddings.dimensions not in (0, width):
            beside["column_width"] = width
        return {
            "sources_total": len(sources), "sources_retrievable": len(active),
            "sources_by_status": {status: sum(1 for s in sources if s.status == status) for status in (STATUS_DRAFT, STATUS_INACTIVE, STATUS_ACTIVE, STATUS_ARCHIVED)},
            "documents_ingested": sum(1 for s in sources for d in s.documents if d.ingestion_status == "ingested"),
            "chunks_total": int(chunk_count), "embedding_model": self.embeddings.index, **beside,
        }
