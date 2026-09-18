from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.assessments.models import HealthNumberAttempt
from app.assessments.repository import health_number_history as load_history, record_health_number_attempt
from app.assessments.schemas import (
    HealthNumberHistoryItem,
    HealthNumberHistoryResponse,
    HealthNumberPreview,
    HealthNumberRequest,
    HealthNumberResponse,
)
from app.assessments.service import CALCULATION_VERSION, calculate_health_number
from app.auth.principal import CurrentPrincipal, require_member, resolve_member_route
from app.db.session import get_db

router = APIRouter(prefix="/api/v1/health-number", tags=["health-number"])
member_router = APIRouter(prefix="/api/v1/members", tags=["members"])


def history_item(attempt: HealthNumberAttempt) -> HealthNumberHistoryItem:
    return HealthNumberHistoryItem(
        attempt_id=attempt.id,
        displayed_score=float(attempt.displayed_score),
        status=attempt.status,
        bucket=attempt.bucket,
        category=attempt.category,
        interpretation=attempt.interpretation,
        calculation_version=attempt.calculation_version,
        completed_at=attempt.completed_at,
    )


@router.post("/preview", response_model=HealthNumberPreview)
def preview(payload: HealthNumberRequest) -> HealthNumberPreview:
    """The approved onboarding shows the number before an account exists. This
    is the same calculation, not stored; the answers are attached to the
    account at sign-up so the saved record is calculated server-side too."""
    result = calculate_health_number(payload.answers)
    return HealthNumberPreview(
        raw_score=result.raw_score, displayed_score=result.displayed_score, status=result.status, bucket=result.bucket,
        category=result.category, category_rule=result.category_rule, interpretation=result.interpretation,
        calculation_version=CALCULATION_VERSION, points=result.points,
    )


@router.post("/calculate", response_model=HealthNumberResponse, status_code=201)
def calculate(
    payload: HealthNumberRequest, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)
) -> HealthNumberResponse:
    attempt, result = record_health_number_attempt(db, principal.member_id, payload.answers)
    db.commit()
    db.refresh(attempt)
    return HealthNumberResponse(
        attempt_id=attempt.id, member_id=principal.member_id, raw_score=result.raw_score,
        displayed_score=result.displayed_score, status=result.status, bucket=result.bucket,
        category=result.category, category_rule=result.category_rule,
        interpretation=result.interpretation, calculation_version=CALCULATION_VERSION,
        points=result.points, completed_at=attempt.completed_at,
    )


@member_router.get("/{member_ref}/health-number", response_model=HealthNumberHistoryResponse)
def health_number_history(
    member_ref: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)
) -> HealthNumberHistoryResponse:
    member_id = resolve_member_route(member_ref, principal)
    history = [history_item(attempt) for attempt in load_history(db, member_id)]
    return HealthNumberHistoryResponse(member_id=member_id, latest=history[0] if history else None, history=history)
