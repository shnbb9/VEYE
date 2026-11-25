"""Sprout personalization: the member's second, separate choice.

Sharing with the Veye team (`app/health_permission`) decides whether a person
at Veye may open this member's health records. This decides whether Sprout may
use summaries of them to answer the member. They are kept in different tables
and nothing writes both, so a yes to one can never be read as a yes to the
other (owner decision, 25 Nov 2026).

Everybody starts switched off. Members who already shared with the team were
not carried over: one choice covered both at the time, and a yes to it is not
a yes to this.

  `member_sprout_permissions`        what is true right now, one row per member
                                     who has ever switched it on
  `member_sprout_permission_events`  how it got that way, append-only
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


STATE_OFF = "off"                # never switched on; also what "no row" means
STATE_ON = "on"
STATE_TURNED_OFF = "turned_off"
STATES = (STATE_OFF, STATE_ON, STATE_TURNED_OFF)

STATE_LABELS = {STATE_OFF: "Off", STATE_ON: "On", STATE_TURNED_OFF: "Turned off"}

SOURCE_MEMBER_APP = "member_app"

JsonType = JSON().with_variant(JSONB(), "postgresql")


class MemberSproutPermission(Base):
    """What is true right now, for one member."""

    __tablename__ = "member_sprout_permissions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"),
                                                 unique=True, index=True, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default=STATE_OFF)
    # The words the member last switched it on under.
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    authorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    events = relationship("MemberSproutPermissionEvent", back_populates="permission",
                          cascade="all, delete-orphan", order_by="MemberSproutPermissionEvent.created_at")


class MemberSproutPermissionEvent(Base):
    """One change, kept as evidence. Never edited, and no screen offers to."""

    __tablename__ = "member_sprout_permission_events"
    __table_args__ = (Index("ix_member_sprout_permission_events_member", "member_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    permission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("member_sprout_permissions.id", ondelete="CASCADE"),
                                                     nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    from_state: Mapped[str] = mapped_column(String(16), nullable=False)
    to_state: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    actor_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default=SOURCE_MEMBER_APP)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # What was agreed to, so "to what?" can be answered later. Empty when it is
    # switched off: that is not a decision on any words.
    terms_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    terms_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scope: Mapped[list | None] = mapped_column(JsonType, nullable=True)
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    recipient: Mapped[str | None] = mapped_column(String(160), nullable=True)
    expiry_rule: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    permission = relationship("MemberSproutPermission", back_populates="events")
