"""Food Diary: the daily meal-entry experience the client specified (Dashboard
edits, 20 Aug 2026) — what was eaten, the required time, how the member felt
before eating and any notes, kept per calendar day. Data capture and history
only: the prototype's keyword "macro estimates" and rule-based day feedback
were placeholders, and how the Companion should analyse entries is an open
client question (Feedback_docs clarifications), so no nutritional figure is
computed or stored here."""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Date, DateTime, ForeignKey, String, Text
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
