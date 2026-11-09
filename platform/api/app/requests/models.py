"""Requests & Inbox: the messages the public site and the member application
already invite — Contact Us, Help questions and Join Beta. Deliberately not a
CRM: a kind, a status, who wrote it, what they wrote, who handled it, and the
replies the console has sent back.

A reply is a row here rather than in the account-scoped notification outbox,
because a Help question from the public site has no account at all. The row
keeps the delivery result, so a reply that never left is visible as such
instead of being assumed delivered."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

KIND_CONTACT = "contact_us"
KIND_HELP = "help_question"
KIND_BETA = "join_beta"
KINDS = (KIND_CONTACT, KIND_HELP, KIND_BETA)
KIND_LABELS = {KIND_CONTACT: "Contact Us", KIND_HELP: "Help question", KIND_BETA: "Join Beta"}

STATUS_NEW = "new"
STATUS_IN_PROGRESS = "in_progress"
STATUS_RESOLVED = "resolved"
STATUSES = (STATUS_NEW, STATUS_IN_PROGRESS, STATUS_RESOLVED)
STATUS_LABELS = {STATUS_NEW: "New", STATUS_IN_PROGRESS: "In progress", STATUS_RESOLVED: "Resolved"}

SOURCE_PUBLIC = "public"
SOURCE_MEMBER = "member"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MemberRequest(Base):
    __tablename__ = "member_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_NEW, index=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default=SOURCE_PUBLIC)  # public | member
    # A signed-in member's request keeps the link; a public one carries the
    # name/email the person typed. Deleting the member keeps the request for
    # the inbox history but detaches it.
    member_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("members.id", ondelete="SET NULL"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    subject: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    page: Mapped[str | None] = mapped_column(String(200), nullable=True)  # where it was sent from
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    handled_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_note: Mapped[str] = mapped_column(Text, nullable=False, default="")

    replies = relationship("MemberRequestReply", back_populates="request", cascade="all, delete-orphan")


class MemberRequestReply(Base):
    """One answer the console sent. Append-only: a sent reply is a record of
    what the person received, so it is never edited or removed."""

    __tablename__ = "member_request_replies"
    # The one way these are ever read: a request's replies, oldest first.
    # Declared here so the model and the migration describe the same index.
    __table_args__ = (Index("ix_member_request_replies_request_id", "request_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("member_requests.id", ondelete="CASCADE"),
                                                  nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Where it actually went, kept with the reply: the account address may
    # change afterwards, and the record has to stay true to what was sent.
    to_email: Mapped[str] = mapped_column(String(320), nullable=False)
    sent_by_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    sent_by_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    delivery_status: Mapped[str] = mapped_column(String(16), nullable=False, default="sent")
    delivery_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    request = relationship("MemberRequest", back_populates="replies")
