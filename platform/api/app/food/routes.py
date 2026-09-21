"""Food Diary routes (member portal only): a day's entries, add / update /
remove a meal, and the history of logged days."""

from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal, require_member
from app.db.session import get_db
from app.food.models import FEELINGS, FoodDiaryEntry

router = APIRouter(prefix="/api/v1/members/me/food-diary", tags=["food-diary"])


class MealIn(BaseModel):
    entry_date: date
    meal_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    description: str = Field(min_length=1, max_length=2000)
    feelings: list[str] = Field(default_factory=list)
    notes: str = Field(default="", max_length=2000)

    @field_validator("feelings")
    @classmethod
    def _known_feelings(cls, value: list[str]) -> list[str]:
        unknown = [f for f in value if f not in FEELINGS]
        if unknown:
            raise ValueError(f"Unknown feeling: {', '.join(unknown)}")
        # keep screen order, drop duplicates
        return [f for f in FEELINGS if f in value]


class MealOut(BaseModel):
    id: UUID
    entry_date: date
    meal_time: str
    description: str
    feelings: list[str]
    notes: str
    created_at: datetime
    updated_at: datetime


class DaySummary(BaseModel):
    entry_date: date
    meals: int
    last_updated: datetime


class DayOut(BaseModel):
    entry_date: date
    meals: list[MealOut]
    history: list[DaySummary]      # every logged day, newest first
    feelings: list[str] = list(FEELINGS)
    days_logged: int


def meal_out(row: FoodDiaryEntry) -> MealOut:
    return MealOut(id=row.id, entry_date=row.entry_date, meal_time=row.meal_time, description=row.description,
                   feelings=list(row.feelings or []), notes=row.notes or "", created_at=row.created_at, updated_at=row.updated_at)


def _history(db: Session, member_id: UUID) -> list[DaySummary]:
    rows = (db.query(FoodDiaryEntry.entry_date, func.count(FoodDiaryEntry.id), func.max(FoodDiaryEntry.updated_at))
            .filter(FoodDiaryEntry.member_id == member_id).group_by(FoodDiaryEntry.entry_date)
            .order_by(FoodDiaryEntry.entry_date.desc()).all())
    return [DaySummary(entry_date=d, meals=n, last_updated=at) for d, n, at in rows]


def _day(db: Session, member_id: UUID, entry_date: date) -> DayOut:
    meals = (db.query(FoodDiaryEntry).filter(FoodDiaryEntry.member_id == member_id, FoodDiaryEntry.entry_date == entry_date)
             .order_by(FoodDiaryEntry.meal_time.asc(), FoodDiaryEntry.created_at.asc()).all())
    history = _history(db, member_id)
    return DayOut(entry_date=entry_date, meals=[meal_out(m) for m in meals], history=history, days_logged=len(history))


@router.get("", response_model=DayOut)
def day(entry_date: date | None = Query(default=None, alias="date"), principal: CurrentPrincipal = Depends(require_member),
        db: Session = Depends(get_db)) -> DayOut:
    assert principal.member_id is not None
    return _day(db, principal.member_id, entry_date or datetime.now(timezone.utc).date())


@router.post("", response_model=DayOut, status_code=status.HTTP_201_CREATED)
def add_meal(payload: MealIn, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> DayOut:
    assert principal.member_id is not None
    db.add(FoodDiaryEntry(member_id=principal.member_id, entry_date=payload.entry_date, meal_time=payload.meal_time,
                          description=payload.description.strip(), feelings=payload.feelings, notes=payload.notes.strip()))
    db.commit()
    return _day(db, principal.member_id, payload.entry_date)


def _own_meal(db: Session, member_id: UUID, meal_id: UUID) -> FoodDiaryEntry:
    row = db.get(FoodDiaryEntry, meal_id)
    if row is None or row.member_id != member_id:
        raise HTTPException(status_code=404, detail="That diary entry was not found.")
    return row


@router.put("/{meal_id}", response_model=DayOut)
def update_meal(meal_id: UUID, payload: MealIn, principal: CurrentPrincipal = Depends(require_member),
                db: Session = Depends(get_db)) -> DayOut:
    assert principal.member_id is not None
    row = _own_meal(db, principal.member_id, meal_id)
    row.entry_date = payload.entry_date
    row.meal_time = payload.meal_time
    row.description = payload.description.strip()
    row.feelings = payload.feelings
    row.notes = payload.notes.strip()
    db.commit()
    return _day(db, principal.member_id, payload.entry_date)


@router.delete("/{meal_id}", response_model=DayOut)
def remove_meal(meal_id: UUID, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> DayOut:
    assert principal.member_id is not None
    row = _own_meal(db, principal.member_id, meal_id)
    entry_date = row.entry_date
    db.delete(row)
    db.commit()
    return _day(db, principal.member_id, entry_date)
