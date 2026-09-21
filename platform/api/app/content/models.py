"""Content: the approved copy the product prints, grouped and versioned by
lifecycle (Draft → Published → Archived). Deterministic health scoring is
never content — weights, bands and formulas are system managed and have no
row here."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

GROUPS = ("help_faq", "member_copy")
GROUP_LABELS = {"help_faq": "Help / FAQ", "member_copy": "Member educational copy"}
STATUS_DRAFT = "Draft"
STATUS_PUBLISHED = "Published"
STATUS_ARCHIVED = "Archived"
STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED, STATUS_ARCHIVED)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ContentEntry(Base):
    __tablename__ = "content_entries"
    __table_args__ = (UniqueConstraint("group", "key", name="uq_content_entries_group_key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    group: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_DRAFT, index=True)
    source: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
