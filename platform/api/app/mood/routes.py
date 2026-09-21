"""Mood Tracker routes (member portal only). The browser passes its own
calendar day as `today` so streaks and the 30-day window follow the member's
clock, not the server's."""

from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal, require_member
from app.db.session import get_db
from app.mood.schemas import MoodEntryIn, MoodEntryOut, MoodOverview
from app.mood.service import MoodError, MoodService, entry_out

router = APIRouter(prefix="/api/v1/members/me/mood", tags=["mood"])


def _today(value: date | None) -> date:
    return value or datetime.now(timezone.utc).date()


def _raise(exc: MoodError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("", response_model=MoodOverview)
def overview(today: date | None = Query(default=None), month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
             principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> MoodOverview:
    assert principal.member_id is not None
    return MoodService(db).overview(principal.member_id, today=_today(today), month=month)


@router.put("", response_model=MoodEntryOut)
def log_mood(payload: MoodEntryIn, today: date | None = Query(default=None),
             principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> MoodEntryOut:
    assert principal.member_id is not None
    try:
        row = MoodService(db).upsert(principal.member_id, entry_date=payload.entry_date, mood=payload.mood, note=payload.note,
                                     today=_today(today))
    except MoodError as exc:
        _raise(exc)
    db.commit()
    return entry_out(row)


@router.delete("/{entry_date}", status_code=status.HTTP_204_NO_CONTENT)
def remove_mood(entry_date: date, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> Response:
    assert principal.member_id is not None
    if not MoodService(db).delete(principal.member_id, entry_date):
        raise HTTPException(status_code=404, detail="No mood is logged for that day.")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
