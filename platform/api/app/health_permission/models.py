"""Health Data Sharing Permission.

The member decides whether the Veye team may look at their health records in
the console. Until they say yes, nobody there sees a Health Number, a blood
marker, a mood or a diary entry — not because a screen hides them, but because
the API does not send them.

Deliberately *not* called a HIPAA Authorization anywhere a member can read.
That is a legal term with legal consequences, and no counsel has approved the
wording; this is what the product does, described plainly.

Two tables, for two different jobs:

  `member_health_permissions`        what is true right now, one row per member
  `member_health_permission_events`  how it got that way, append-only

The second is the evidence. A permission that can only say "granted" is worth
very little when somebody asks *when*, *who asked*, *from where* and *against
which version of the words the member read* — so every transition keeps all of
it, and no row is ever edited or deleted.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# The five states the handoff fixes. `not_requested` is the default for every
# member who exists: silence is never consent.
STATE_NOT_REQUESTED = "not_requested"
STATE_REQUESTED = "requested"
STATE_GRANTED = "granted"
STATE_DECLINED = "declined"
STATE_REVOKED = "revoked"

STATES = (STATE_NOT_REQUESTED, STATE_REQUESTED, STATE_GRANTED, STATE_DECLINED, STATE_REVOKED)

# Only one of them opens the records.
SHARING_STATES = frozenset({STATE_GRANTED})

STATE_LABELS = {
    STATE_NOT_REQUESTED: "Not requested",
    STATE_REQUESTED: "Awaiting your decision",
    STATE_GRANTED: "Shared with the Veye team",
    STATE_DECLINED: "Declined",
    STATE_REVOKED: "Withdrawn",
}

# The version of the words the member was shown when they decided. Bump it
# whenever that copy changes, so an old decision is never silently credited to
# new wording. v2 (9 Nov 2026) added Veye Companion: the same records reaching
# Sprout is the same disclosure, and the member has to have been told that.
POLICY_VERSION = "health-sharing-2026-11-09-v2"

# Where a decision came from. A permission is never granted by replying to an
# email: the member has to act in the application, and the source says so.
SOURCE_MEMBER_APP = "member_app"
SOURCE_ADMIN_CONSOLE = "admin_console"
SOURCES = (SOURCE_MEMBER_APP, SOURCE_ADMIN_CONSOLE)


class MemberHealthPermission(Base):
    """What is true right now, for one member."""

    __tablename__ = "member_health_permissions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"),
                                                 unique=True, index=True, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default=STATE_NOT_REQUESTED)
    # The copy version the member last decided against; empty until they decide.
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    requested_by_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    events = relationship("MemberHealthPermissionEvent", back_populates="permission",
                          cascade="all, delete-orphan", order_by="MemberHealthPermissionEvent.created_at")

    @property
    def shares_health_data(self) -> bool:
        return self.state in SHARING_STATES


class MemberHealthPermissionEvent(Base):
    """One transition, kept forever.

    Append-only: this is the evidence that a member was asked and answered, so
    nothing here is edited or removed, and no screen offers to.
    """

    __tablename__ = "member_health_permission_events"
    __table_args__ = (Index("ix_member_health_permission_events_member", "member_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    permission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("member_health_permissions.id", ondelete="CASCADE"),
                                                     nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    from_state: Mapped[str] = mapped_column(String(16), nullable=False)
    to_state: Mapped[str] = mapped_column(String(16), nullable=False)
    # "member" or "administrator" — who performed the transition, not who benefits.
    actor: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    actor_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default=SOURCE_MEMBER_APP)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    permission = relationship("MemberHealthPermission", back_populates="events")
