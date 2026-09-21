"""Mood Tracker: one mood per member per calendar day with an optional note —
the approved prototype's wellness journal (8 moods), persisted. Non-clinical
data capture; the only derived figure is the client-supplied Balance score."""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Order and labels as the approved Mood Tracker palette prints them.
MOODS = ("happy", "excited", "calm", "neutral", "tired", "stressed", "sad", "angry")
MOOD_LABELS = {"happy": "Happy", "excited": "Excited", "calm": "Calm", "neutral": "Neutral",
               "tired": "Tired", "stressed": "Stressed", "sad": "Sad", "angry": "Angry"}
# Balance score — CLIENT FORMULA (progress-review answers, 25 Aug 2026): the
# rolling 30-day average where happy, calm and excited count 100, neutral 50,
# tired and sad 25, stressed and angry 0.
MOOD_BALANCE = {"happy": 100, "calm": 100, "excited": 100, "neutral": 50, "tired": 25, "sad": 25, "stressed": 0, "angry": 0}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MoodEntry(Base):
    __tablename__ = "mood_entries"
    __table_args__ = (UniqueConstraint("member_id", "entry_date", name="uq_mood_entries_member_day"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    mood: Mapped[str] = mapped_column(String(16), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
