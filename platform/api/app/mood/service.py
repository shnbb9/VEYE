"""Mood Tracker service: upsert one entry per day, list, and the header
statistics exactly as the approved prototype computes them."""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.mood.models import MOOD_BALANCE, MOOD_LABELS, MOODS, MoodEntry
from app.mood.schemas import MoodEntryOut, MoodOverview, MoodStats


class MoodError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def entry_out(row: MoodEntry) -> MoodEntryOut:
    return MoodEntryOut(id=row.id, entry_date=row.entry_date, mood=row.mood, mood_label=MOOD_LABELS[row.mood],
                        note=row.note or "", created_at=row.created_at, updated_at=row.updated_at)


def compute_stats(entries: list[MoodEntry], *, today: date, month: str | None = None) -> MoodStats:
    month = month or f"{today.year:04d}-{today.month:02d}"
    year, mon = int(month[:4]), int(month[5:7])
    by_day = {e.entry_date: e for e in entries}

    in_month = [e for e in entries if e.entry_date.year == year and e.entry_date.month == mon]
    tally = Counter(e.mood for e in in_month)
    top = tally.most_common(1)[0][0] if tally else None

    # streak: consecutive logged days ending today
    streak = 0
    cursor = today
    while cursor in by_day:
        streak += 1
        cursor -= timedelta(days=1)

    cutoff = today - timedelta(days=29)
    window = [MOOD_BALANCE[e.mood] for e in entries if cutoff <= e.entry_date <= today]
    balance = round(sum(window) / len(window)) if window else None

    return MoodStats(month=month, days_logged_this_month=len(in_month), day_streak=streak, top_mood=top,
                     top_mood_label=MOOD_LABELS[top] if top else None, balance_score=balance, balance_entries=len(window))


class MoodService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def entries(self, member_id: UUID) -> list[MoodEntry]:
        return (self.db.query(MoodEntry).filter(MoodEntry.member_id == member_id)
                .order_by(MoodEntry.entry_date.desc()).all())

    def overview(self, member_id: UUID, *, today: date, month: str | None = None) -> MoodOverview:
        rows = self.entries(member_id)
        return MoodOverview(entries=[entry_out(r) for r in rows], stats=compute_stats(rows, today=today, month=month),
                            latest=entry_out(rows[0]) if rows else None)

    def upsert(self, member_id: UUID, *, entry_date: date, mood: str, note: str, today: date) -> MoodEntry:
        if mood not in MOODS:
            raise MoodError(422, "Unknown mood.")
        if entry_date > today:
            raise MoodError(422, "A mood can only be logged for today or an earlier day.")
        row = (self.db.query(MoodEntry).filter(MoodEntry.member_id == member_id, MoodEntry.entry_date == entry_date).one_or_none())
        if row is None:
            row = MoodEntry(member_id=member_id, entry_date=entry_date, mood=mood, note=note.strip())
            self.db.add(row)
        else:
            row.mood = mood
            row.note = note.strip()
        self.db.flush()
        return row

    def delete(self, member_id: UUID, entry_date: date) -> bool:
        row = (self.db.query(MoodEntry).filter(MoodEntry.member_id == member_id, MoodEntry.entry_date == entry_date).one_or_none())
        if row is None:
            return False
        self.db.delete(row)
        self.db.flush()
        return True
