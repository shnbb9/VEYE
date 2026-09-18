"""Persistence for Body Composition attempts (member route + seed)."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.progress.body_composition.models import BodyCompositionAttempt
from app.progress.body_composition.schemas import BodyCompositionInput
from app.progress.body_composition.service import BODY_COMPOSITION_CALCULATION_VERSION, calculate_body_composition


def record_body_composition_attempt(
    db: Session, member_id: UUID, payload: BodyCompositionInput, *, completed_at: datetime | None = None
) -> BodyCompositionAttempt:
    result = calculate_body_composition(payload)
    attempt = BodyCompositionAttempt(
        member_id=member_id,
        measurements=payload.model_dump(exclude_none=True),
        sex=result.sex,
        bmi=Decimal(str(result.bmi)) if result.bmi is not None else None,
        body_fat_percent=result.body_fat_percent,
        fat_mass_lb=Decimal(str(result.fat_mass_lb)) if result.fat_mass_lb is not None else None,
        lean_mass_lb=Decimal(str(result.lean_mass_lb)) if result.lean_mass_lb is not None else None,
        unavailable_reason=result.unavailable_reason,
        calculation_version=BODY_COMPOSITION_CALCULATION_VERSION,
        completed_at=completed_at or datetime.now(timezone.utc),
    )
    db.add(attempt)
    db.flush()
    return attempt


def body_composition_history(db: Session, member_id: UUID) -> list[BodyCompositionAttempt]:
    return (
        db.query(BodyCompositionAttempt)
        .filter(BodyCompositionAttempt.member_id == member_id)
        .order_by(BodyCompositionAttempt.completed_at.desc(), BodyCompositionAttempt.created_at.desc())
        .all()
    )
