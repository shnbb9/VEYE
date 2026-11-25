"""A member began one of the five instruments. Kept only so the console can
say how many were begun and never finished (Cara, 25 Nov): which instrument
and when — never an answer. A start counts as finished when a result for that
instrument is saved at or after it, so nothing has to be written on completion
and an abandoned tab needs no signal."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.auth.principal import CurrentPrincipal, require_member
from app.db.base import Base
from app.db.session import get_db

router = APIRouter(prefix="/api/v1/members/me/assessment-starts", tags=["assessments"])
InstrumentKey = Literal["health_number", "body_composition", "blood_markers", "health_assessment", "simple_quiz"]
# Reopening the same form shortly afterwards is the same attempt.
SAME_ATTEMPT = timedelta(hours=12)
# A form open right now is not abandoned.
STILL_OPEN = timedelta(hours=1)


class AssessmentStart(Base):
    __tablename__ = "member_assessment_starts"
    __table_args__ = (Index("ix_member_assessment_starts_lookup", "member_id", "instrument", "started_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    instrument: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class StartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instrument: InstrumentKey


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _models() -> dict:
    from app.admin.console_routes import INSTRUMENTS

    return {key: row[1] for key, row in INSTRUMENTS.items()}


@router.post("", status_code=204)
def started(payload: StartIn, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> Response:
    assert principal.member_id is not None
    now = datetime.now(timezone.utc)
    last = (db.query(AssessmentStart)
            .filter(AssessmentStart.member_id == principal.member_id, AssessmentStart.instrument == payload.instrument)
            .order_by(AssessmentStart.started_at.desc()).first())
    again = last is None or now - _aware(last.started_at) > SAME_ATTEMPT
    if not again:
        model = _models()[payload.instrument]
        again = any(_aware(at) >= _aware(last.started_at) for (at,) in
                    db.query(model.completed_at).filter(model.member_id == principal.member_id).all())
    if again:
        db.add(AssessmentStart(member_id=principal.member_id, instrument=payload.instrument, started_at=now))
    db.commit()
    return Response(status_code=204)


def unfinished(db: Session, key: str, model, allowed: set[uuid.UUID]) -> tuple[int, int]:
    """(starts, starts never finished) for members who share. A start is
    finished when a result was saved at or after it and before the next one."""
    if not allowed:
        return 0, 0
    starts: dict[uuid.UUID, list[datetime]] = {}
    for member_id, at in (db.query(AssessmentStart.member_id, AssessmentStart.started_at)
                          .filter(AssessmentStart.instrument == key, AssessmentStart.member_id.in_(allowed))
                          .order_by(AssessmentStart.started_at.asc()).all()):
        starts.setdefault(member_id, []).append(_aware(at))
    done: dict[uuid.UUID, list[datetime]] = {}
    for member_id, at in db.query(model.member_id, model.completed_at).filter(model.member_id.in_(allowed)).all():
        done.setdefault(member_id, []).append(_aware(at))
    now = datetime.now(timezone.utc)
    total = abandoned = 0
    for member_id, times in starts.items():
        for index, at in enumerate(times):
            until = times[index + 1] if index + 1 < len(times) else None
            finished = any(at <= c and (until is None or c < until) for c in done.get(member_id, []))
            if not finished and until is None and now - at < STILL_OPEN:
                continue  # still being filled in: neither finished nor abandoned
            total += 1
            abandoned += 0 if finished else 1
    return total, abandoned
