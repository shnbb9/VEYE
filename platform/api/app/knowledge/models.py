"""Approved-knowledge model.

knowledge_sources   — the product record Cara manages (title, type, scope,
                      lifecycle status, version, approval)
knowledge_documents — one attached file per version, stored in the object
                      store; metadata only lives here
knowledge_chunks    — approved chunk text + embedding for retrieval (pgvector)

Member health data never enters these tables."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.db.base import Base
from app.knowledge.vector_type import vector_column_type

JsonType = JSON().with_variant(JSONB(), "postgresql")

STATUS_DRAFT = "Draft"
STATUS_INACTIVE = "Inactive"
STATUS_ACTIVE = "Active"
STATUS_ARCHIVED = "Archived"
SOURCE_STATUSES = (STATUS_DRAFT, STATUS_INACTIVE, STATUS_ACTIVE, STATUS_ARCHIVED)

SOURCE_TYPES = ("VEYE educational document", "FAQ / Help", "Nutrition reference", "Food Choices reference", "Companion guidance")

# Retrieval scopes: the policy engine maps a member's topic to these keys.
SCOPES = {
    "health_number": "Health Number explanations",
    "assessments": "How Veye assessments work",
    "help": "Member support questions",
    "food_choices": "Food Choices guidance",
    "companion": "Companion guidance",
}

EMBEDDING_DIMENSIONS = settings.embedding_dimensions


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    scope_key: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reference_label: Mapped[str | None] = mapped_column(String(240), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_DRAFT, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    approved_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_synthetic: Mapped[bool] = mapped_column(nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    documents = relationship("KnowledgeDocument", back_populates="source", cascade="all, delete-orphan",
                             order_by="KnowledgeDocument.created_at.desc()")

    @property
    def current_document(self) -> KnowledgeDocument | None:
        for document in self.documents:
            if document.is_current:
                return document
        return None

    @property
    def retrievable(self) -> bool:
        doc = self.current_document
        return (self.status == STATUS_ACTIVE and self.approved_at is not None and doc is not None
                and doc.ingestion_status == "ingested")


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("knowledge_sources.id", ondelete="CASCADE"), index=True, nullable=False)
    source_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    object_key: Mapped[str] = mapped_column(String(320), nullable=False)
    filename: Mapped[str] = mapped_column(String(240), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    is_current: Mapped[bool] = mapped_column(nullable=False, default=True)
    ingestion_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")  # pending | ingested | failed
    ingestion_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ingested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    source = relationship("KnowledgeSource", back_populates="documents")
    chunks = relationship("KnowledgeChunk", back_populates="document", cascade="all, delete-orphan",
                          order_by="KnowledgeChunk.ordinal")


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("knowledge_documents.id", ondelete="CASCADE"), index=True, nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("knowledge_sources.id", ondelete="CASCADE"), index=True, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    heading: Mapped[str | None] = mapped_column(String(200), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    token_estimate: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding: Mapped[list[float] | None] = mapped_column(vector_column_type(EMBEDDING_DIMENSIONS), nullable=True)
    embedding_model: Mapped[str] = mapped_column(String(64), nullable=False)
    meta: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    document = relationship("KnowledgeDocument", back_populates="chunks")
