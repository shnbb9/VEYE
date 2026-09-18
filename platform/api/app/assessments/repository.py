"""Persistence for Health Number attempts, shared by the member route, sign-up
(the onboarding result gate) and the development seed."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.assessments.models import HealthNumberAttempt
from app.assessments.schemas import HealthNumberAnswers
from app.assessments.service import CALCULATION_VERSION, HealthNumberResult, calculate_health_number


def record_health_number_attempt(
    db: Session, member_id: UUID, answers: HealthNumberAnswers, *, completed_at: datetime | None = None
) -> tuple[HealthNumberAttempt, HealthNumberResult]:
    result = calculate_health_number(answers)
    attempt = HealthNumberAttempt(
        member_id=member_id,
        answers=answers.model_dump(),
        raw_score=Decimal(str(result.raw_score)),
        displayed_score=Decimal(str(result.displayed_score)),
        status=result.status,
        bucket=result.bucket,
        category=result.category,
        interpretation=result.interpretation,
        calculation_version=CALCULATION_VERSION,
        completed_at=completed_at or datetime.now(timezone.utc),
    )
    db.add(attempt)
    db.flush()
    return attempt, result


def health_number_history(db: Session, member_id: UUID) -> list[HealthNumberAttempt]:
    return (
        db.query(HealthNumberAttempt)
        .filter(HealthNumberAttempt.member_id == member_id)
        .order_by(HealthNumberAttempt.completed_at.desc(), HealthNumberAttempt.created_at.desc())
        .all()
    )
