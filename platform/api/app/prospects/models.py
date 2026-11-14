"""A visitor's saved assessment, before (or instead of) an account.

Three tables, three jobs:

  `prospect_assessments`  the record: who typed which address, under which
                          notice and retention policy, until when — and the
                          questionnaire and result, sealed (see crypto.py).
  `prospect_events`       what happened to it, append-only, and never a health
                          value or the address itself.
  `prospect_tokens`       the bearer proofs handed to the visitor's browser and
                          mailbox, stored only as hashes.

A prospect is not an account and never becomes one by itself. Typing an email
address proves nothing about owning it, so an account registered later with
the same address gets nothing from here until ownership is proven and a claim
capability is presented (see service.py).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")

STATUS_UNVERIFIED = "unverified"        # saved; the address has not been confirmed
STATUS_VERIFIED = "verified"            # saved; the address was confirmed from its mailbox
STATUS_PENDING_CLAIM = "pending_claim"  # linked to a new account, waiting for proof of the address
STATUS_CLAIMED = "claimed"              # added to a member's own record; payload moved there
STATUS_EXPIRED = "expired"              # retention elapsed and the payload was purged
STATUS_ERASED = "erased"                # deleted on request

ACTIVE_STATUSES = (STATUS_UNVERIFIED, STATUS_VERIFIED, STATUS_PENDING_CLAIM)
STATUSES = ACTIVE_STATUSES + (STATUS_CLAIMED, STATUS_EXPIRED, STATUS_ERASED)

STATUS_LABELS = {
    STATUS_UNVERIFIED: "Unverified prospect",
    STATUS_VERIFIED: "Verified prospect",
    STATUS_PENDING_CLAIM: "Pending claim",
    STATUS_CLAIMED: "Registered member",
    STATUS_EXPIRED: "Expired",
    STATUS_ERASED: "Deleted",
}

TOKEN_BROWSER = "browser"   # handed to the tab that saved the result
TOKEN_EMAIL = "email"       # delivered to the address that was typed
TOKEN_PURPOSES = (TOKEN_BROWSER, TOKEN_EMAIL)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ProspectAssessment(Base):
    __tablename__ = "prospect_assessments"
    __table_args__ = (Index("ix_prospect_assessments_status_expiry", "status", "expires_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Cleared when the record is claimed, expires or is erased.
    email_normalized: Mapped[str | None] = mapped_column(String(320), nullable=True, index=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Answers + result, sealed. Cleared on claim (moved to the member's own
    # record), on expiry and on erasure.
    payload_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    calculation_version: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="onboarding")
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    # The words the visitor was shown and agreed to, by version and by hash.
    consent_version: Mapped[str] = mapped_column(String(64), nullable=False)
    consent_notice_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # The retention the visitor agreed to, frozen at capture.
    retention_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retention_policy_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_UNVERIFIED, index=True)
    # Set at sign-up from the same browser; the claim completes only once the
    # address is proven. The attempt is the account's own copy of this same
    # submission, so completing the claim never writes a second one.
    pending_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True)
    pending_attempt_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    pending_proof: Mapped[str | None] = mapped_column(String(16), nullable=True)
    claimed_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True)
    # Unique: one saved submission becomes at most one attempt, and one attempt
    # is the copy of at most one submission.
    claimed_attempt_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, unique=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    erased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # sha256 of the browser's idempotency key: a double click or a retry is the
    # same submission, not a second record.
    idempotency_key_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    # Saved under the reserved synthetic domain (demo.veye.test). Lets the
    # local QA cleanup remove test records even after the address is cleared.
    is_synthetic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class ProspectEvent(Base):
    """Append-only history. Never an answer, a score or the address."""

    __tablename__ = "prospect_events"
    __table_args__ = (Index("ix_prospect_events_prospect", "prospect_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    prospect_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("prospect_assessments.id", ondelete="CASCADE"),
                                                   nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # visitor | member | administrator | system
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    policy_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ProspectToken(Base):
    """A bearer proof. Only its sha256 is kept; the raw value exists in the
    visitor's tab (sessionStorage) or in the email that was sent."""

    __tablename__ = "prospect_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    prospect_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("prospect_assessments.id", ondelete="CASCADE"),
                                                   index=True, nullable=False)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
