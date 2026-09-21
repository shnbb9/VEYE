"""Care Studio: configurable member content metadata (Fitness, Supplements,
Resources). Metadata only — a video is a YouTube URL or, later, an object key
in whatever object store Veye chooses; binary media never lives in
PostgreSQL. Lifecycle Draft → Published → Archived; members see Published."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

KINDS = ("fitness", "supplement", "resource")
CONTENT_TYPES = ("video", "program", "article", "link", "copy")
STATUS_DRAFT = "Draft"
STATUS_PUBLISHED = "Published"
STATUS_ARCHIVED = "Archived"
STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED, STATUS_ARCHIVED)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CareContentItem(Base):
    __tablename__ = "care_content_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(24), nullable=False, index=True)  # fitness | supplement | resource
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    content_type: Mapped[str] = mapped_column(String(24), nullable=False, default="copy")
    youtube_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    external_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Future uploaded video: an object key in the (abstract) object store.
    video_object_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Approved educational copy (supplements), or a longer description.
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    cautions: Mapped[str | None] = mapped_column(Text, nullable=True)
    references: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_DRAFT, index=True)
    source: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
