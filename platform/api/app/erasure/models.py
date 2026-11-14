"""An erasure request: deletion is not deactivation.

Deactivation (the existing account switch) is reversible and keeps every row.
Erasure removes the member profile and its data for good. The request row is
the minimum record that it happened — who it was for (by id only), what scope,
when, what state it reached and counts of what was removed — and never a
health value, a note, a meal or the person's answers.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")

SCOPE_MEMBER_DATA = "member_data"          # the account stays (it also holds console access)
SCOPE_ENTIRE_IDENTITY = "entire_identity"  # nothing else on the account, so it goes too

STATE_REQUESTED = "requested"
STATE_ACCESS_CLOSED = "access_closed"
STATE_PURGING = "purging"
STATE_PURGE_BLOCKED = "purge_blocked"
STATE_ERASED = "erased"
OPEN_STATES = (STATE_REQUESTED, STATE_ACCESS_CLOSED, STATE_PURGING, STATE_PURGE_BLOCKED)

STATE_LABELS = {
    STATE_REQUESTED: "Requested",
    STATE_ACCESS_CLOSED: "Access closed, deletion queued",
    STATE_PURGING: "Deleting",
    STATE_PURGE_BLOCKED: "Deletion paused after an error — it will be retried",
    STATE_ERASED: "Deleted",
}

# ENGINEERING DRAFT pending owner and counsel approval (V2 §11 decision 5):
# no grace period, immediate access closure, no legal-hold path.
POLICY_VERSION = "erasure-2026-11-14-draft-v1"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ErasureRequest(Base):
    __tablename__ = "erasure_requests"
    __table_args__ = (Index("ix_erasure_requests_state", "state", "requested_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    subject_user_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    subject_member_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(24), nullable=False)
    state: Mapped[str] = mapped_column(String(24), nullable=False, default=STATE_REQUESTED)
    requested_via: Mapped[str] = mapped_column(String(24), nullable=False, default="member_app")
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False, default=POLICY_VERSION)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    # The last stage that finished; a retry resumes after it.
    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failure_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Counts per category of what was removed. Never a value.
    receipt: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    # Where the completion receipt goes; cleared once it has been queued.
    receipt_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    receipt_outbox_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
