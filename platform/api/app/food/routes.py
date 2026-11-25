"""Food Diary routes (member portal only): a day's entries, add / update /
remove a meal, the prototype macro estimate, the day's Save, its rule-based
feedback and the history of logged days — the approved prototype's daily
entry experience (build/dashboard.html, #view-food-diary), persisted."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Literal, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.auth.principal import CurrentPrincipal, require_member
from app.core.rate_limit import RateLimiter, client_address
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.food.estimate import ESTIMATE_VERSION, MacroEstimate, day_feedback, estimate
from app.food.models import FEELINGS, FoodDiaryDay, FoodDiaryEntry
from app.food.photos import MealPhotoError, MealPhotoService, meal_photo_version
from app.storage.media_changes import committed_with
from app.storage.remote_image import RemoteImageFetcher

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
        # the order the member chose them (as the prototype keeps it), no duplicates
        return list(dict.fromkeys(value))


class MealOut(BaseModel):
    id: UUID
    entry_date: date
    meal_time: str
    description: str
    feelings: list[str]
    notes: str
    protein_g: int
    carbs_g: int
    fat_g: int
    kcal: int
    created_at: datetime
    updated_at: datetime
    # Changes whenever the meal's photo does; None = no photo. The bytes come
    # from /food-diary/{id}/photo.
    photo_version: str | None = None


class PhotoLinkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2048)


class DaySummary(BaseModel):
    entry_date: date
    meals: int
    kcal: int
    saved: bool
    last_updated: datetime | None


class DayTotals(BaseModel):
    protein_g: int
    carbs_g: int
    fat_g: int
    kcal: int


class DayOut(BaseModel):
    entry_date: date
    meals: list[MealOut]
    totals: DayTotals
    saved_at: datetime | None
    history: list[DaySummary]      # every logged or saved day, newest first
    feelings: list[str] = list(FEELINGS)
    days_logged: int
    # The entry a POST just made. A browser must not guess it from the list:
    # an open tab whose day is out of date would pick someone else's meal.
    created_id: UUID | None = None


class EstimateIn(BaseModel):
    description: str = Field(default="", max_length=2000)


class EstimateOut(BaseModel):
    estimate: DayTotals | None


class FeedbackOut(BaseModel):
    entry_date: date
    text: str


def _estimate_of(row: FoodDiaryEntry) -> MacroEstimate:
    if row.kcal is not None and row.protein_g is not None and row.carbs_g is not None and row.fat_g is not None:
        return MacroEstimate(row.protein_g, row.carbs_g, row.fat_g, row.kcal)
    # rows saved before the estimate existed: the same deterministic rule
    return estimate(row.description) or MacroEstimate(0, 0, 0, 0)


def meal_out(row: FoodDiaryEntry) -> MealOut:
    est = _estimate_of(row)
    return MealOut(id=row.id, entry_date=row.entry_date, meal_time=row.meal_time, description=row.description,
                   feelings=list(row.feelings or []), notes=row.notes or "", protein_g=est.protein_g, carbs_g=est.carbs_g,
                   fat_g=est.fat_g, kcal=est.kcal, created_at=row.created_at, updated_at=row.updated_at,
                   photo_version=meal_photo_version(row))


def _apply_estimate(row: FoodDiaryEntry) -> None:
    est = estimate(row.description) or MacroEstimate(0, 0, 0, 0)
    row.protein_g, row.carbs_g, row.fat_g, row.kcal = est.protein_g, est.carbs_g, est.fat_g, est.kcal
    row.estimate_version = ESTIMATE_VERSION


def _day_meals(db: Session, member_id: UUID, entry_date: date) -> list[FoodDiaryEntry]:
    # The order the member logged them; an edit keeps its place (prototype).
    return (db.query(FoodDiaryEntry).filter(FoodDiaryEntry.member_id == member_id, FoodDiaryEntry.entry_date == entry_date)
            .order_by(FoodDiaryEntry.created_at.asc(), FoodDiaryEntry.id.asc()).all())


def _aware(value: datetime) -> datetime:
    # SQLite returns naive datetimes for stored rows; every value here is UTC.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _history(db: Session, member_id: UUID) -> list[DaySummary]:
    entries = db.query(FoodDiaryEntry).filter(FoodDiaryEntry.member_id == member_id).all()
    saved = {row.entry_date: row.saved_at for row in db.query(FoodDiaryDay).filter(FoodDiaryDay.member_id == member_id).all()}
    days: dict[date, list[FoodDiaryEntry]] = {}
    for row in entries:
        days.setdefault(row.entry_date, []).append(row)
    summaries = []
    for day_key in sorted(set(days) | set(saved), reverse=True):
        rows = days.get(day_key, [])
        summaries.append(DaySummary(entry_date=day_key, meals=len(rows), kcal=sum(_estimate_of(r).kcal for r in rows),
                                    saved=day_key in saved, last_updated=max((_aware(r.updated_at) for r in rows), default=None)))
    return summaries


def _day(db: Session, member_id: UUID, entry_date: date) -> DayOut:
    meals = [meal_out(m) for m in _day_meals(db, member_id, entry_date)]
    saved = db.query(FoodDiaryDay).filter(FoodDiaryDay.member_id == member_id, FoodDiaryDay.entry_date == entry_date).one_or_none()
    history = _history(db, member_id)
    totals = DayTotals(protein_g=sum(m.protein_g for m in meals), carbs_g=sum(m.carbs_g for m in meals),
                       fat_g=sum(m.fat_g for m in meals), kcal=sum(m.kcal for m in meals))
    return DayOut(entry_date=entry_date, meals=meals, totals=totals, saved_at=saved.saved_at if saved else None,
                  history=history, days_logged=len(history))


@router.get("", response_model=DayOut)
def day(entry_date: date | None = Query(default=None, alias="date"), principal: CurrentPrincipal = Depends(require_member),
        db: Session = Depends(get_db)) -> DayOut:
    assert principal.member_id is not None
    return _day(db, principal.member_id, entry_date or datetime.now(timezone.utc).date())


@router.post("/estimate", response_model=EstimateOut)
def estimate_preview(payload: EstimateIn, principal: CurrentPrincipal = Depends(require_member)) -> EstimateOut:
    """The live "Estimated macros" chips while the member types — calculated,
    never stored."""
    est = estimate(payload.description)
    return EstimateOut(estimate=DayTotals(protein_g=est.protein_g, carbs_g=est.carbs_g, fat_g=est.fat_g, kcal=est.kcal) if est else None)


@router.post("", response_model=DayOut, status_code=status.HTTP_201_CREATED)
def add_meal(payload: MealIn, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> DayOut:
    assert principal.member_id is not None
    row = FoodDiaryEntry(member_id=principal.member_id, entry_date=payload.entry_date, meal_time=payload.meal_time,
                         description=payload.description.strip(), feelings=payload.feelings, notes=payload.notes.strip())
    _apply_estimate(row)
    db.add(row)
    db.commit()
    day_out = _day(db, principal.member_id, payload.entry_date)
    day_out.created_id = row.id
    return day_out


def _own_meal(db: Session, member_id: UUID, meal_id: UUID) -> FoodDiaryEntry:
    row = db.get(FoodDiaryEntry, meal_id)
    if row is None or row.member_id != member_id:
        raise HTTPException(status_code=404, detail="That diary entry was not found.")
    return row


def _forget_empty_day(db: Session, member_id: UUID, entry_date: date) -> None:
    """The prototype drops a day once its last meal is removed, Save included."""
    if not db.query(FoodDiaryEntry.id).filter(FoodDiaryEntry.member_id == member_id, FoodDiaryEntry.entry_date == entry_date).first():
        db.query(FoodDiaryDay).filter(FoodDiaryDay.member_id == member_id, FoodDiaryDay.entry_date == entry_date).delete(synchronize_session=False)


@router.put("/{meal_id}", response_model=DayOut)
def update_meal(meal_id: UUID, payload: MealIn, principal: CurrentPrincipal = Depends(require_member),
                db: Session = Depends(get_db)) -> DayOut:
    assert principal.member_id is not None
    row = _own_meal(db, principal.member_id, meal_id)
    previous_date = row.entry_date
    row.entry_date = payload.entry_date
    row.meal_time = payload.meal_time
    row.description = payload.description.strip()
    row.feelings = payload.feelings
    row.notes = payload.notes.strip()
    _apply_estimate(row)
    db.flush()
    if previous_date != payload.entry_date:
        _forget_empty_day(db, principal.member_id, previous_date)
    db.commit()
    return _day(db, principal.member_id, payload.entry_date)


@router.delete("/{meal_id}", response_model=DayOut)
def remove_meal(meal_id: UUID, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                runtime: Runtime = Depends(get_runtime)) -> DayOut:
    assert principal.member_id is not None
    row = _own_meal(db, principal.member_id, meal_id)
    entry_date = row.entry_date
    photos = _photos(db, runtime)
    # The row is gone first; its photo after. A photo that could not be
    # removed is left under the member's prefix, where erasure still finds it.
    with committed_with(db, photos.changes):
        photos.forget(row)
        db.delete(row)
        db.flush()
        _forget_empty_day(db, principal.member_id, entry_date)
    return _day(db, principal.member_id, entry_date)


# ---- the meal's photo (owner request, 15 Nov 2026) ---------------------------------

def _photos(db: Session, runtime: Runtime) -> MealPhotoService:
    settings = runtime.settings
    fetcher = RemoteImageFetcher(max_bytes=settings.meal_photo_max_bytes, trusted_hosts=settings.remote_image_trusted_host_set)
    return MealPhotoService(db, runtime.media_store, max_bytes=settings.meal_photo_max_bytes, fetcher=fetcher)


def _photo_refused(exc: MealPhotoError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _store_photo(db: Session, service: MealPhotoService, member_id: UUID, meal_id: UUID, save) -> FoodDiaryEntry:
    """Look the meal up again (it may have gone while a link was fetched),
    store the photo, commit; if the entry vanished meanwhile, leave no bytes."""
    row = _own_meal(db, member_id, meal_id)
    try:
        with committed_with(db, service.changes):
            save(row)
    except StaleDataError as exc:
        raise HTTPException(status_code=404, detail="That diary entry was not found.") from exc
    except MealPhotoError as exc:
        _photo_refused(exc)
    return row


@router.put("/{meal_id}/photo", response_model=DayOut)
def add_meal_photo(meal_id: UUID, request: Request, file: UploadFile = File(...),
                   principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                   runtime: Runtime = Depends(get_runtime)) -> DayOut:
    """A photo for this meal — a file from the device or a camera snapshot.
    Replaces the meal's earlier photo."""
    assert principal.member_id is not None
    _own_meal(db, principal.member_id, meal_id)
    RateLimiter(db, runtime.settings).enforce("meal_photo", subject=str(principal.user_id), address=client_address(request))
    db.commit()  # the hit stands whatever happens to the picture
    service = _photos(db, runtime)
    data = file.file.read(service.max_bytes + 1)
    row = _store_photo(db, service, principal.member_id, meal_id, lambda meal: service.attach(meal, data, file.content_type))
    return _day(db, principal.member_id, row.entry_date)


@router.post("/{meal_id}/photo/link", response_model=DayOut)
def add_meal_photo_from_link(meal_id: UUID, payload: PhotoLinkIn, request: Request,
                             principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                             runtime: Runtime = Depends(get_runtime)) -> DayOut:
    """A photo from a link the member pasted: fetched once from the public
    internet (never a private address), then kept like an upload."""
    assert principal.member_id is not None
    _own_meal(db, principal.member_id, meal_id)
    RateLimiter(db, runtime.settings).enforce("meal_photo_link", subject=str(principal.user_id), address=client_address(request))
    # Counted and committed BEFORE the fetch, which also gives the database
    # connection back: parallel requests see each other's hits, and no
    # connection waits on somebody else's website.
    db.commit()
    service = _photos(db, runtime)
    try:
        data = service.fetch(payload.url)
    except MealPhotoError as exc:
        _photo_refused(exc)
    row = _store_photo(db, service, principal.member_id, meal_id, lambda meal: service.attach_fetched(meal, data))
    return _day(db, principal.member_id, row.entry_date)


@router.delete("/{meal_id}/photo", response_model=DayOut)
def remove_meal_photo(meal_id: UUID, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                      runtime: Runtime = Depends(get_runtime)) -> DayOut:
    assert principal.member_id is not None
    service = _photos(db, runtime)
    row = _store_photo(db, service, principal.member_id, meal_id, service.remove)
    return _day(db, principal.member_id, row.entry_date)


@router.get("/{meal_id}/photo")
def meal_photo(meal_id: UUID, size: Literal["full", "thumb"] = "full", principal: CurrentPrincipal = Depends(require_member),
               db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> Response:
    assert principal.member_id is not None
    row = _own_meal(db, principal.member_id, meal_id)
    try:
        data, content_type = _photos(db, runtime).read(row, size)
    except MealPhotoError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return Response(content=data, media_type=content_type,
                    headers={"Cache-Control": "private, max-age=0, must-revalidate", "X-Content-Type-Options": "nosniff"})


@router.post("/days/{entry_date}/save", response_model=DayOut)
def save_day(entry_date: date, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> DayOut:
    """Save: marks the day saved (the prototype's `savedAt`); History shows it."""
    assert principal.member_id is not None
    row = db.query(FoodDiaryDay).filter(FoodDiaryDay.member_id == principal.member_id, FoodDiaryDay.entry_date == entry_date).one_or_none()
    if row is None:
        db.add(FoodDiaryDay(member_id=principal.member_id, entry_date=entry_date, saved_at=datetime.now(timezone.utc)))
    else:
        row.saved_at = datetime.now(timezone.utc)
    db.commit()
    return _day(db, principal.member_id, entry_date)


@router.get("/feedback", response_model=FeedbackOut)
def feedback(entry_date: date = Query(alias="date"), principal: CurrentPrincipal = Depends(require_member),
             db: Session = Depends(get_db)) -> FeedbackOut:
    """Give me feedback: the prototype's fixed rules over the day's saved entries."""
    assert principal.member_id is not None
    meals = _day_meals(db, principal.member_id, entry_date)
    return FeedbackOut(entry_date=entry_date, text=day_feedback([(_estimate_of(m), list(m.feelings or [])) for m in meals]))
