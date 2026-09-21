from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Mood = Literal["happy", "excited", "calm", "neutral", "tired", "stressed", "sad", "angry"]


class MoodEntryIn(BaseModel):
    entry_date: date
    mood: Mood
    note: str = Field(default="", max_length=1000)


class MoodEntryOut(BaseModel):
    id: UUID
    entry_date: date
    mood: Mood
    mood_label: str
    note: str
    created_at: datetime
    updated_at: datetime


class MoodStats(BaseModel):
    """The four figures on the Mood Tracker header, computed for `month`
    (YYYY-MM) and `today` (the member's calendar day)."""
    month: str
    days_logged_this_month: int
    day_streak: int
    top_mood: Mood | None
    top_mood_label: str | None
    balance_score: int | None          # 0–100, None with no entries in the window
    balance_window_days: int = 30
    balance_entries: int


class MoodOverview(BaseModel):
    entries: list[MoodEntryOut]        # every entry (newest first) — the calendar paints from this
    stats: MoodStats
    latest: MoodEntryOut | None
