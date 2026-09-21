"""Persistence for Simple Quiz attempts (member route + seed). Deliberately
imports nothing from the Health Number package: the quiz cannot touch it."""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.progress.simple_quiz.models import SimpleQuizAttempt
from app.progress.simple_quiz.schemas import SimpleQuizInput
from app.progress.simple_quiz.service import SIMPLE_QUIZ_CALCULATION_VERSION, calculate_simple_quiz


def record_simple_quiz_attempt(
    db: Session, member_id: UUID, payload: SimpleQuizInput, *, completed_at: datetime | None = None
) -> SimpleQuizAttempt:
    result = calculate_simple_quiz(payload.answers)
    attempt = SimpleQuizAttempt(
        member_id=member_id, answers=result.answers, yes_count=result.yes_count, no_count=result.no_count,
        calculation_version=SIMPLE_QUIZ_CALCULATION_VERSION, completed_at=completed_at or datetime.now(timezone.utc),
    )
    db.add(attempt)
    db.flush()
    return attempt


def simple_quiz_history(db: Session, member_id: UUID) -> list[SimpleQuizAttempt]:
    return (
        db.query(SimpleQuizAttempt)
        .filter(SimpleQuizAttempt.member_id == member_id)
        .order_by(SimpleQuizAttempt.completed_at.desc(), SimpleQuizAttempt.created_at.desc())
        .all()
    )
