from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ScheduledJobRun(Base):
    """One run of one maintenance job: when, by what, what it did, or why it
    failed. The console reads the latest to say when cleanup last ran — a
    retention promise nobody can see being kept is not much of a promise."""

    __tablename__ = "scheduled_job_runs"
    __table_args__ = (Index("ix_scheduled_job_runs_job_started", "job", "started_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    job: Mapped[str] = mapped_column(String(48), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")  # running | ok | error
    dry_run: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    triggered_by: Mapped[str] = mapped_column(String(160), nullable=False, default="scheduler")
    counts: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
