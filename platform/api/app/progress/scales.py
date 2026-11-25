"""The scales, bands and goals the Progress Trackers draw, served from the one
place each calculation lives so a chart can never carry its own copy (and
drift from the scoring, as the prototype once did). Body composition and the
Simple Quiz have no client band, so they have none here."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.assessments.service import BANDS as HEALTH_NUMBER_BANDS
from app.auth.principal import require_member
from app.progress.blood_markers.service import GOALS, IDEAL_RANGES
from app.progress.health_assessment.service import BANDS as HEALTH_ASSESSMENT_BANDS, MAX_TOTAL, MIN_TOTAL

router = APIRouter(prefix="/api/v1/progress-scales", tags=["progress"], dependencies=[Depends(require_member)])


class Band(BaseModel):
    upto: float
    bucket: str
    label: str


class Scale(BaseModel):
    low: float
    high: float
    step: float
    bands: list[Band]


class Goal(BaseModel):
    key: str
    ideal: str
    low: float | None
    high: float


class ScalesOut(BaseModel):
    health_number: Scale
    health_assessment: Scale
    blood_markers: list[Goal]


@router.get("", response_model=ScalesOut)
def scales() -> ScalesOut:
    return ScalesOut(
        health_number=Scale(low=1, high=10, step=0.5, bands=[Band(upto=u, bucket=b, label=s) for u, b, s in HEALTH_NUMBER_BANDS]),
        health_assessment=Scale(low=MIN_TOTAL, high=MAX_TOTAL, step=1,
                                bands=[Band(upto=u, bucket=b, label=s) for u, b, s, _ in HEALTH_ASSESSMENT_BANDS]),
        blood_markers=[Goal(key=k, ideal=IDEAL_RANGES[k], low=low, high=high) for k, (low, high, _) in GOALS.items()])
