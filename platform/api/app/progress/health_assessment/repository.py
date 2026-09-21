"""Persistence for Health Assessment attempts (member route + seed)."""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.progress.health_assessment.models import HealthAssessmentAttempt
from app.progress.health_assessment.schemas import HealthAssessmentInput
from app.progress.health_assessment.service import HEALTH_ASSESSMENT_CALCULATION_VERSION, calculate_health_assessment


def record_health_assessment_attempt(
    db: Session, member_id: UUID, payload: HealthAssessmentInput, *, completed_at: datetime | None = None
) -> HealthAssessmentAttempt:
    result = calculate_health_assessment(payload.answers)
    attempt = HealthAssessmentAttempt(
        member_id=member_id, answers=result.answers, total=result.total, bucket=result.bucket, status=result.status,
        interpretation=result.interpretation, epa_dha_dose=result.epa_dha_dose,
        calculation_version=HEALTH_ASSESSMENT_CALCULATION_VERSION,
        completed_at=completed_at or datetime.now(timezone.utc),
    )
    db.add(attempt)
    db.flush()
    return attempt


def health_assessment_history(db: Session, member_id: UUID) -> list[HealthAssessmentAttempt]:
    return (
        db.query(HealthAssessmentAttempt)
        .filter(HealthAssessmentAttempt.member_id == member_id)
        .order_by(HealthAssessmentAttempt.completed_at.desc(), HealthAssessmentAttempt.created_at.desc())
        .all()
    )
