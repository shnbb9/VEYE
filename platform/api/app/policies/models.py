"""Versioned platform policies.

A product rule the console can change — how long an unsigned-up quiz result is
kept, how a health-sharing request is sent, the words a member reads before
deciding — is not a mutable setting. It is a sequence of published versions,
each frozen once published, so a decision taken under version 3 can always be
read back against the rule and the words of version 3, and nobody can rewrite
what a person agreed to by editing a row.

Drafts live in the same table with `status = "draft"` and no version number.
There is at most one draft per key: it is overwritten until it is published,
and publishing turns it into the next numbered, immutable version.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PlatformPolicyVersion(Base):
    __tablename__ = "platform_policy_versions"
    # Two administrators publishing the same key at the same moment both
    # compute "next version = 4"; the database refuses the second rather than
    # leaving two different rules both called version 4.
    __table_args__ = (UniqueConstraint("key", "version", name="uq_platform_policy_key_version"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # NULL while a draft; 1, 2, 3 … once published.
    version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_DRAFT)
    value: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    # sha256 of the canonical JSON of `value`: what a decision is recorded
    # against, so "the words you agreed to" is checkable, not just nameable.
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    created_by_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    published_by_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    published_by_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
