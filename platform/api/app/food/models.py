"""Food Diary: the daily meal-entry experience the client specified (Dashboard
edits, 20 Aug 2026) — what was eaten, the required time, how the member felt
before eating and any notes, kept per calendar day — exactly as the approved
prototype presents it, including its labelled prototype macro estimate
(`app.food.estimate`), the day's Save and its rule-based feedback. The
estimate is calculated by the API when an entry is saved and stored with it."""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# The approved "How did you feel before you ate?" options, in screen order.
FEELINGS = ("Hungry", "Very hungry", "Not hungry", "Stressed", "Relaxed", "Tired", "Energized", "Rushed", "Bored")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FoodDiaryEntry(Base):
    __tablename__ = "food_diary_entries"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    meal_time: Mapped[str] = mapped_column(String(5), nullable=False)  # HH:MM, required by the approved screen
    description: Mapped[str] = mapped_column(Text, nullable=False)
    feelings: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # The prototype estimate stored with the entry (null on rows saved before
    # the estimate existed; those are estimated from the description on read).
    protein_g: Mapped[int | None] = mapped_column(Integer, nullable=True)
    carbs_g: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fat_g: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kcal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimate_version: Mapped[str | None] = mapped_column(String(24), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class FoodDiaryDay(Base):
    """A day the member pressed Save on (the prototype's per-day `savedAt`)."""

    __tablename__ = "food_diary_days"
    __table_args__ = (UniqueConstraint("member_id", "entry_date", name="uq_food_diary_days_member_date"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
