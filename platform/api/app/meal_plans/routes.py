"""Meal Planning routes (member portal only): the member's saved days and the
client's sample days, with the approved prototype's behaviour —
create, View/Edit (saving an edit clears the assignment, as the prototype
does), Duplicate ("<name> (copy)", unassigned), Delete, Assign to date /
Use today, and Copy a sample day (always a new day; a name clash gets a
numbered suffix). Every response returns the member's days, newest first."""

from __future__ import annotations

import re
from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal, require_member
from app.db.session import get_db
from app.meal_plans.models import DAY_MODES, MEAL_TYPES, MealPlanDay
from app.meal_plans.samples import COPY_NOTE, SAMPLE_DAYS, sample_name

router = APIRouter(prefix="/api/v1/members/me/meal-plans", tags=["meal-planning"])

NAME_MAX = 200
_TIME = re.compile(r"^(([01]\d|2[0-3]):[0-5]\d)?$")


class PlanMeal(BaseModel):
    name: str = Field(default="", max_length=120)
    type: str = "Meal"
    time: str = ""
    notes: str = Field(default="", max_length=1000)

    @field_validator("type")
    @classmethod
    def _known_type(cls, value: str) -> str:
        if value not in MEAL_TYPES:
            raise ValueError(f"Unknown meal type: {value}")
        return value

    @field_validator("time")
    @classmethod
    def _clock(cls, value: str) -> str:
        if not _TIME.match(value or ""):
            raise ValueError("Use a time like 07:30, or leave it empty.")
        return value or ""


class DayIn(BaseModel):
    name: str = Field(max_length=160)
    notes: str = Field(default="", max_length=2000)
    describe: str = Field(default="", max_length=4000)
    mode: str = "manual"
    meals: list[PlanMeal] = Field(max_length=40)

    @field_validator("name")
    @classmethod
    def _named(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Please give this day a name.")
        return value.strip()

    @field_validator("mode")
    @classmethod
    def _mode(cls, value: str) -> str:
        if value not in DAY_MODES:
            raise ValueError(f"Unknown planning mode: {value}")
        return value

    @field_validator("meals")
    @classmethod
    def _some_meals(cls, value: list[PlanMeal]) -> list[PlanMeal]:
        if not value:
            raise ValueError("Please add at least one meal.")
        return value


class AssignIn(BaseModel):
    date: date


class SampleCopyIn(BaseModel):
    key: str = Field(max_length=16)
    option: int = Field(default=0, ge=0)


class DayOut(BaseModel):
    id: UUID
    name: str
    notes: str
    describe: str
    mode: str
    meals: list[PlanMeal]
    assigned_date: date | None
    created_at: datetime
    updated_at: datetime


class DaysOut(BaseModel):
    days: list[DayOut]
    created_id: UUID | None = None


class SampleOptionOut(BaseModel):
    label: str | None
    meals: list[PlanMeal]


class SampleOut(BaseModel):
    key: str
    label: str
    options: list[SampleOptionOut]


def _day_out(row: MealPlanDay) -> DayOut:
    return DayOut(id=row.id, name=row.name, notes=row.notes or "", describe=row.describe or "", mode=row.mode,
                  meals=[PlanMeal(**m) for m in (row.meals or [])], assigned_date=row.assigned_date,
                  created_at=row.created_at, updated_at=row.updated_at)


def _days(db: Session, member_id: UUID, created_id: UUID | None = None) -> DaysOut:
    rows = (db.query(MealPlanDay).filter(MealPlanDay.member_id == member_id)
            .order_by(MealPlanDay.created_at.desc(), MealPlanDay.id.desc()).all())
    return DaysOut(days=[_day_out(r) for r in rows], created_id=created_id)


def _own_day(db: Session, member_id: UUID, day_id: UUID) -> MealPlanDay:
    row = db.get(MealPlanDay, day_id)
    if row is None or row.member_id != member_id:
        raise HTTPException(status_code=404, detail="That day was not found.")
    return row


def _meals(payload: DayIn) -> list[dict[str, str]]:
    return [m.model_dump() for m in payload.meals]


@router.get("/days", response_model=DaysOut)
def list_days(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> DaysOut:
    assert principal.member_id is not None
    return _days(db, principal.member_id)


@router.get("/samples", response_model=list[SampleOut])
def samples(principal: CurrentPrincipal = Depends(require_member)) -> list[SampleOut]:
    return [SampleOut(key=d["key"], label=d["label"],
                      options=[SampleOptionOut(label=o["label"], meals=[PlanMeal(**m) for m in o["meals"]]) for o in d["options"]])
            for d in SAMPLE_DAYS]


@router.post("/days", response_model=DaysOut, status_code=status.HTTP_201_CREATED)
def create_day(payload: DayIn, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> DaysOut:
    assert principal.member_id is not None
    row = MealPlanDay(member_id=principal.member_id, name=payload.name, notes=payload.notes.strip(),
                      describe=payload.describe.strip(), mode=payload.mode, meals=_meals(payload), assigned_date=None)
    db.add(row)
    db.commit()
    return _days(db, principal.member_id, row.id)


@router.put("/days/{day_id}", response_model=DaysOut)
def update_day(day_id: UUID, payload: DayIn, principal: CurrentPrincipal = Depends(require_member),
               db: Session = Depends(get_db)) -> DaysOut:
    assert principal.member_id is not None
    row = _own_day(db, principal.member_id, day_id)
    row.name, row.notes, row.describe, row.mode = payload.name, payload.notes.strip(), payload.describe.strip(), payload.mode
    row.meals = _meals(payload)
    row.assigned_date = None  # the prototype's save payload resets the assignment
    db.commit()
    return _days(db, principal.member_id)


@router.post("/days/{day_id}/duplicate", response_model=DaysOut, status_code=status.HTTP_201_CREATED)
def duplicate_day(day_id: UUID, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> DaysOut:
    assert principal.member_id is not None
    original = _own_day(db, principal.member_id, day_id)
    copy = MealPlanDay(member_id=principal.member_id, name=(original.name + " (copy)")[:NAME_MAX], notes=original.notes,
                       describe=original.describe, mode=original.mode, meals=[dict(m) for m in (original.meals or [])],
                       assigned_date=None)
    db.add(copy)
    db.commit()
    return _days(db, principal.member_id, copy.id)


@router.post("/days/{day_id}/assign", response_model=DaysOut)
def assign_day(day_id: UUID, payload: AssignIn, principal: CurrentPrincipal = Depends(require_member),
               db: Session = Depends(get_db)) -> DaysOut:
    assert principal.member_id is not None
    row = _own_day(db, principal.member_id, day_id)
    row.assigned_date = payload.date
    db.commit()
    return _days(db, principal.member_id)


@router.delete("/days/{day_id}", response_model=DaysOut)
def delete_day(day_id: UUID, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> DaysOut:
    assert principal.member_id is not None
    db.delete(_own_day(db, principal.member_id, day_id))
    db.commit()
    return _days(db, principal.member_id)


@router.post("/samples/copy", response_model=DaysOut, status_code=status.HTTP_201_CREATED)
def copy_sample(payload: SampleCopyIn, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> DaysOut:
    assert principal.member_id is not None
    try:
        base, meals = sample_name(payload.key, payload.option)
    except KeyError:
        raise HTTPException(status_code=404, detail="That sample day was not found.") from None
    taken = {name for (name,) in db.query(MealPlanDay.name).filter(MealPlanDay.member_id == principal.member_id).all()}
    name, n = base, 2
    while name in taken:  # never overwrite: a clash gets a numbered suffix
        name, n = f"{base} ({n})", n + 1
    row = MealPlanDay(member_id=principal.member_id, name=name, notes=COPY_NOTE, describe="", mode="manual", meals=meals,
                      assigned_date=None)
    db.add(row)
    db.commit()
    return _days(db, principal.member_id, row.id)
