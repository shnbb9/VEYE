from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal, require_member, resolve_member_route
from app.db.session import get_db
from app.progress.body_composition.models import BodyCompositionAttempt
from app.progress.body_composition.repository import body_composition_history as load_history, record_body_composition_attempt
from app.progress.body_composition.schemas import (
    BodyCompositionHistoryItem,
    BodyCompositionHistoryResponse,
    BodyCompositionRequest,
    BodyCompositionResult,
)


router = APIRouter(prefix="/api/v1/body-composition", tags=["body-composition"])
member_router = APIRouter(prefix="/api/v1/members", tags=["members"])


def history_item(attempt: BodyCompositionAttempt) -> BodyCompositionHistoryItem:
    return BodyCompositionHistoryItem(
        attempt_id=attempt.id,
        sex=attempt.sex,
        measurements=attempt.measurements,
        bmi=float(attempt.bmi) if attempt.bmi is not None else None,
        body_fat_percent=attempt.body_fat_percent,
        fat_mass_lb=float(attempt.fat_mass_lb) if attempt.fat_mass_lb is not None else None,
        lean_mass_lb=float(attempt.lean_mass_lb) if attempt.lean_mass_lb is not None else None,
        body_fat_available=attempt.body_fat_percent is not None,
        unavailable_reason=attempt.unavailable_reason,
        calculation_version=attempt.calculation_version,
        completed_at=attempt.completed_at,
    )


@router.post("/calculate", response_model=BodyCompositionResult, status_code=201)
def calculate(
    payload: BodyCompositionRequest, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)
) -> BodyCompositionResult:
    attempt = record_body_composition_attempt(db, principal.member_id, payload.input)
    db.commit()
    db.refresh(attempt)
    return BodyCompositionResult(member_id=principal.member_id, **history_item(attempt).model_dump())


@member_router.get("/{member_ref}/body-composition", response_model=BodyCompositionHistoryResponse)
def body_composition_history(
    member_ref: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)
) -> BodyCompositionHistoryResponse:
    member_id = resolve_member_route(member_ref, principal)
    history = [history_item(attempt) for attempt in load_history(db, member_id)]
    return BodyCompositionHistoryResponse(member_id=member_id, latest=history[0] if history else None, history=history)
