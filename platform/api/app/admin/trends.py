"""Which way a member's Health Number moved between two dated results (Cara's
15 Nov "trending" request; V4 §8).

Arithmetic only: the latest result minus the one before it, with both dates.
The Health Number scale is the client's and LOWER IS BETTER, so a fall is an
improvement in that number — and only in that number. Nothing here speaks
about a person's health, and no other instrument is mixed in.

Not compared: results scored by different calculation versions, a single
result, and — because a trend is a health record like the number itself —
anyone who does not share. There is no "no significant change" threshold: no
client source defines one, so unchanged means exactly equal.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.assessments.models import HealthNumberAttempt

TrendState = Literal["improved", "worsened", "unchanged", "first", "not_comparable", "none", "not_shared"]
TREND_STATES: tuple[str, ...] = ("improved", "worsened", "unchanged", "first", "not_comparable", "none", "not_shared")


class Trend(BaseModel):
    state: TrendState
    delta: float | None = None          # latest - previous; negative is an improvement
    current: float | None = None
    previous: float | None = None
    current_at: datetime | None = None
    previous_at: datetime | None = None


NOT_SHARED = Trend(state="not_shared")


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def compare(attempts: list[HealthNumberAttempt]) -> Trend:
    """`attempts` newest first."""
    if not attempts:
        return Trend(state="none")
    latest = attempts[0]
    now = dict(current=float(latest.displayed_score), current_at=_aware(latest.completed_at))
    if len(attempts) == 1:
        return Trend(state="first", **now)
    before = attempts[1]
    then = dict(previous=float(before.displayed_score), previous_at=_aware(before.completed_at))
    if before.calculation_version != latest.calculation_version:
        return Trend(state="not_comparable", **now, **then)
    delta = round(float(latest.displayed_score) - float(before.displayed_score), 2)
    return Trend(state="improved" if delta < 0 else "worsened" if delta > 0 else "unchanged", delta=delta, **now, **then)


def trends_for(db: Session, member_ids: set[UUID]) -> dict[UUID, Trend]:
    if not member_ids:
        return {}
    found: dict[UUID, list[HealthNumberAttempt]] = {}
    for attempt in (db.query(HealthNumberAttempt).filter(HealthNumberAttempt.member_id.in_(member_ids))
                    .order_by(HealthNumberAttempt.completed_at.desc(), HealthNumberAttempt.created_at.desc()).all()):
        kept = found.setdefault(attempt.member_id, [])
        if len(kept) < 2:
            kept.append(attempt)
    return {member_id: compare(found.get(member_id, [])) for member_id in member_ids}
