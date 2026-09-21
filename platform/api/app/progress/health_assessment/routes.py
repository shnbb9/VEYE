from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal, require_member, resolve_member_route
from app.db.session import get_db
from app.progress.health_assessment.models import HealthAssessmentAttempt
from app.progress.health_assessment.repository import health_assessment_history as load_history, record_health_assessment_attempt
from app.progress.health_assessment.schemas import (
    HealthAssessmentDefinition,
    HealthAssessmentHistoryItem,
    HealthAssessmentHistoryResponse,
    HealthAssessmentRequest,
    HealthAssessmentResult,
    QuestionOut,
)
from app.progress.health_assessment.service import (
    HEALTH_ASSESSMENT_CALCULATION_VERSION,
    MAX_TOTAL,
    MIN_TOTAL,
    NEUROLOGICAL_ROW,
    POLYPHENOL_LINES,
    QUESTIONS,
    TONE_BY_BUCKET,
)

router = APIRouter(prefix="/api/v1/health-assessment", tags=["health-assessment"])
member_router = APIRouter(prefix="/api/v1/members", tags=["members"])


def _poly_lines() -> list[dict]:
    return [{"amount": amount, "note": note} for amount, note in POLYPHENOL_LINES]


def history_item(attempt: HealthAssessmentAttempt) -> HealthAssessmentHistoryItem:
    """Stored values only — a historical report is never re-scored on read."""
    return HealthAssessmentHistoryItem(
        attempt_id=attempt.id, answers=attempt.answers, total=attempt.total, bucket=attempt.bucket, status=attempt.status,
        interpretation=attempt.interpretation, tone=TONE_BY_BUCKET.get(attempt.bucket, "moderate"),
        epa_dha_dose=attempt.epa_dha_dose, polyphenol_lines=_poly_lines(),
        calculation_version=attempt.calculation_version, completed_at=attempt.completed_at,
    )


@router.get("/definition", response_model=HealthAssessmentDefinition)
def definition(principal: CurrentPrincipal = Depends(require_member)) -> HealthAssessmentDefinition:
    return HealthAssessmentDefinition(
        questions=[QuestionOut(key=q.key, label=q.label, info=q.info,
                               options=[{"value": value, "label": label} for value, label in q.options]) for q in QUESTIONS],
        scale_min=MIN_TOTAL, scale_max=MAX_TOTAL, polyphenol_lines=_poly_lines(), neurological_row=NEUROLOGICAL_ROW,
        calculation_version=HEALTH_ASSESSMENT_CALCULATION_VERSION,
    )


@router.post("/calculate", response_model=HealthAssessmentResult, status_code=201)
def calculate(
    payload: HealthAssessmentRequest, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)
) -> HealthAssessmentResult:
    attempt = record_health_assessment_attempt(db, principal.member_id, payload.input)
    db.commit()
    db.refresh(attempt)
    return HealthAssessmentResult(member_id=principal.member_id, **history_item(attempt).model_dump())


@member_router.get("/{member_ref}/health-assessment", response_model=HealthAssessmentHistoryResponse)
def health_assessment_history(
    member_ref: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)
) -> HealthAssessmentHistoryResponse:
    member_id = resolve_member_route(member_ref, principal)
    history = [history_item(attempt) for attempt in load_history(db, member_id)]
    return HealthAssessmentHistoryResponse(member_id=member_id, latest=history[0] if history else None, history=history)
