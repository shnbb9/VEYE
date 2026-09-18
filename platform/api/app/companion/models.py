"""Companion (Sprout) persistence: settings, conversations, messages,
provenance, policy decisions and member feedback."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CompanionSettings(Base):
    """One row (id = 1): what Sprout says and what it may talk about. The
    policy JSON is the configurable part of the policy engine."""

    __tablename__ = "companion_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    name: Mapped[str] = mapped_column(String(48), nullable=False, default="Sprout")
    welcome: Mapped[str] = mapped_column(Text, nullable=False)
    returning_welcome: Mapped[str] = mapped_column(Text, nullable=False)
    safe_response: Mapped[str] = mapped_column(Text, nullable=False)
    fallback: Mapped[str] = mapped_column(Text, nullable=False)
    escalation_response: Mapped[str] = mapped_column(Text, nullable=False)
    quick_prompts: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    policy: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(120), nullable=True)


class CompanionConversation(Base):
    __tablename__ = "companion_conversations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_message_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")  # open | cleared
    flagged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    flag_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    messages = relationship("CompanionMessage", back_populates="conversation", cascade="all, delete-orphan",
                            order_by="CompanionMessage.created_at")


class CompanionMessage(Base):
    __tablename__ = "companion_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companion_conversations.id", ondelete="CASCADE"), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # member | sprout
    content: Mapped[str] = mapped_column(Text, nullable=False)
    outcome: Mapped[str | None] = mapped_column(String(24), nullable=True)  # answered | prohibited | escalated | off_topic | unavailable
    policy_decision_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companion_policy_decisions.id", ondelete="SET NULL"), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    safety_result: Mapped[str | None] = mapped_column(String(32), nullable=True)
    context_scopes: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    conversation = relationship("CompanionConversation", back_populates="messages")
    sources = relationship("CompanionMessageSource", back_populates="message", cascade="all, delete-orphan",
                           order_by="CompanionMessageSource.rank")
    feedback = relationship("CompanionFeedback", back_populates="message", cascade="all, delete-orphan", uselist=False)
    policy_decision = relationship("CompanionPolicyDecision", foreign_keys=[policy_decision_id])


class CompanionMessageSource(Base):
    """Full provenance for a retrieval-backed reply."""

    __tablename__ = "companion_message_sources"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companion_messages.id", ondelete="CASCADE"), index=True, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    chunk_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    source_title: Mapped[str] = mapped_column(String(200), nullable=False)
    source_version: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)

    message = relationship("CompanionMessage", back_populates="sources")


class CompanionPolicyDecision(Base):
    """Audit record of every policy gate evaluation."""

    __tablename__ = "companion_policy_decisions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(index=True, nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(index=True, nullable=False)
    outcome: Mapped[str] = mapped_column(String(24), nullable=False)  # allow | prohibit | escalate | off_topic
    category: Mapped[str | None] = mapped_column(String(48), nullable=True)
    matched_rule: Mapped[str | None] = mapped_column(String(120), nullable=True)
    retrieval_scopes: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    member_data_scopes: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    policy_version: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CompanionFeedback(Base):
    __tablename__ = "companion_feedback"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companion_messages.id", ondelete="CASCADE"), unique=True, nullable=False)
    conversation_id: Mapped[uuid.UUID] = mapped_column(index=True, nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(index=True, nullable=False)
    rating: Mapped[str] = mapped_column(String(16), nullable=False)  # helpful | not_helpful
    reason: Mapped[str | None] = mapped_column(String(48), nullable=True)  # Not relevant | Incorrect | Other
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(120), nullable=True)

    message = relationship("CompanionMessage", back_populates="feedback")
