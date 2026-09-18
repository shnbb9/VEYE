from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal, require_member, resolve_member_route
from app.db.session import get_db
from app.progress.blood_markers.models import BloodMarkerAttempt
from app.progress.blood_markers.repository import blood_markers_history as load_history, record_blood_markers_attempt
from app.progress.blood_markers.schemas import (
    AaEpaSource,
    BloodMarkersHistoryItem,
    BloodMarkersHistoryResponse,
    BloodMarkersRecommendation,
    BloodMarkersRequest,
    BloodMarkersResult,
)
from app.progress.blood_markers.service import (
    BLOOD_MARKERS_CALCULATION_VERSION,
    calculate_blood_markers,
)


router = APIRouter(prefix="/api/v1/blood-markers", tags=["blood-markers"])
member_router = APIRouter(prefix="/api/v1/members", tags=["members"])


def _float(value) -> float | None:
    return float(value) if value is not None else None


def history_item(attempt: BloodMarkerAttempt) -> BloodMarkersHistoryItem:
    """Stored values only — a historical entry is never re-scored on read."""
    results = attempt.results
    return BloodMarkersHistoryItem(
        attempt_id=attempt.id,
        markers=attempt.markers,
        tg_hdl=_float(attempt.tg_hdl),
        homa_ir=_float(attempt.homa_ir),
        aa_epa=_float(attempt.aa_epa),
        aa_epa_source=attempt.aa_epa_source,
        in_range=results["in_range"],
        classification=results["classification"],
        recommendation=BloodMarkersRecommendation(**results["recommendation"]),
        calculation_version=attempt.calculation_version,
        completed_at=attempt.completed_at,
    )


class BloodMarkersPreview(BaseModel):
    """The same deterministic calculation, not stored: it backs the approved
    screen's live "Calculated" fields and in-range flags while the member
    types, so the browser never carries its own copy of the formulas."""

    tg_hdl: float | None
    homa_ir: float | None
    aa_epa: float | None
    aa_epa_source: AaEpaSource | None
    in_range: dict[str, bool | None]
    calculation_version: str


@router.post("/preview", response_model=BloodMarkersPreview)
def preview(payload: BloodMarkersRequest, principal: CurrentPrincipal = Depends(require_member)) -> BloodMarkersPreview:
    result = calculate_blood_markers(payload.input)
    return BloodMarkersPreview(
        tg_hdl=result.tg_hdl, homa_ir=result.homa_ir, aa_epa=result.aa_epa,
        aa_epa_source=result.aa_epa_source, in_range=result.in_range,
        calculation_version=BLOOD_MARKERS_CALCULATION_VERSION,
    )


@router.post("/calculate", response_model=BloodMarkersResult, status_code=201)
def calculate(
    payload: BloodMarkersRequest, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)
) -> BloodMarkersResult:
    attempt = record_blood_markers_attempt(db, principal.member_id, payload.input)
    db.commit()
    db.refresh(attempt)
    return BloodMarkersResult(member_id=principal.member_id, **history_item(attempt).model_dump())


@member_router.get("/{member_ref}/blood-markers", response_model=BloodMarkersHistoryResponse)
def blood_markers_history(
    member_ref: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)
) -> BloodMarkersHistoryResponse:
    member_id = resolve_member_route(member_ref, principal)
    history = [history_item(attempt) for attempt in load_history(db, member_id)]
    return BloodMarkersHistoryResponse(member_id=member_id, latest=history[0] if history else None, history=history)
