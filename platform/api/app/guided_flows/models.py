"""Persistence for guided flows: versioned definitions and per-member sessions.

`guided_flows` holds one row per (key, version) with the whole tree as JSON —
the trees are small and edited as a unit, so edges are not normalised into
tables. `member_guided_flow_sessions` pins the version a member started with;
publishing a new version never moves an existing session."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")

STATUS_DRAFT = "Draft"
STATUS_ACTIVE = "Active"
STATUS_ARCHIVED = "Archived"
FLOW_STATUSES = (STATUS_DRAFT, STATUS_ACTIVE, STATUS_ARCHIVED)

SESSION_IN_PROGRESS = "in_progress"
SESSION_PAUSED = "paused"
SESSION_COMPLETED = "completed"
SESSION_SKIPPED = "skipped"  # the member chose to explore on their own
SESSION_STATUSES = (SESSION_IN_PROGRESS, SESSION_PAUSED, SESSION_COMPLETED, SESSION_SKIPPED)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GuidedFlow(Base):
    __tablename__ = "guided_flows"
    __table_args__ = (UniqueConstraint("key", "version", name="uq_guided_flows_key_version"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    definition: Mapped[dict] = mapped_column(JsonType, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_DRAFT)
    source: Mapped[str | None] = mapped_column(Text, nullable=True)  # the client document this version was built from
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[str | None] = mapped_column(String(120), nullable=True)

    sessions = relationship("MemberGuidedFlowSession", back_populates="flow")


class MemberGuidedFlowSession(Base):
    __tablename__ = "member_guided_flow_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    flow_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("guided_flows.id", ondelete="RESTRICT"), index=True, nullable=False)
    flow_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    flow_version: Mapped[int] = mapped_column(Integer, nullable=False)
    current_node: Mapped[str] = mapped_column(String(64), nullable=False)
    # {"history": [{"node", "choice", "via", "at"}], "questions_asked": n, "pauses": n}
    # — choice keys only, never the member's free text.
    answers: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=SESSION_IN_PROGRESS)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    flow = relationship("GuidedFlow", back_populates="sessions")
