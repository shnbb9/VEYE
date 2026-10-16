"""Meal Planning: the member's saved days — reusable meal templates (weekday,
weekend, travel…) that can be assigned to a date — exactly as the approved
prototype keeps them (build/dashboard.html, Meal Planning / `veye_days`).
The meals of a day are an ordered list stored with it."""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# The day editor's meal kinds, in the prototype's select order.
MEAL_TYPES = ("Meal", "Snack", "Breakfast", "Lunch", "Dinner", "Brunch", "Exercise", "Routine")
DAY_MODES = ("manual", "ai")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MealPlanDay(Base):
    __tablename__ = "meal_plan_days"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    describe: Mapped[str] = mapped_column(Text, nullable=False, default="")
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    # [{"name", "type", "time" ("HH:MM" or ""), "notes"}] in the order entered
    meals: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    assigned_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
