"""The Fitness library: videos the console adds for each of the four goals on
the member Fitness screen (owner request, 15 Nov 2026).

A video is a YouTube or Vimeo link the console pastes — Veye stores the link,
never the video. Each goal has at most one MAIN video (the big player at the
top); the rest follow in the console's order, nine to a page. A hidden video
is kept for the console and never shown to members.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# The member screen's four goals, in the prototype's order.
GOALS: dict[str, str] = {"stronger": "Get Stronger", "weight": "Lose Weight", "fit": "Get Fit", "performance": "Boost Performance"}
PROVIDERS = ("youtube", "vimeo")
PAGE_SIZE = 9


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FitnessVideo(Base):
    __tablename__ = "fitness_videos"
    __table_args__ = (
        UniqueConstraint("goal", "provider", "video_id", name="uq_fitness_videos_goal_video"),
        # One main video per goal, enforced by the database as well as the service.
        Index("uq_fitness_videos_main", "goal", unique=True, sqlite_where=text("is_main"), postgresql_where=text("is_main")),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    goal: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)          # youtube | vimeo
    video_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Vimeo's privacy hash for an unlisted video (player.vimeo.com/video/ID?h=HASH).
    video_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    url: Mapped[str] = mapped_column(String(500), nullable=False)              # the link as the console gave it, normalised
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    subtitle: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    thumbnail_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_main: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
