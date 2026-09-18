"""Persistence for Blood Test Marker attempts (member route + seed)."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.progress.blood_markers.models import BloodMarkerAttempt
from app.progress.blood_markers.schemas import BloodMarkersInput
from app.progress.blood_markers.service import BLOOD_MARKERS_CALCULATION_VERSION, calculate_blood_markers


def _decimal(value: float | None) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


def record_blood_markers_attempt(
    db: Session, member_id: UUID, payload: BloodMarkersInput, *, completed_at: datetime | None = None
) -> BloodMarkerAttempt:
    result = calculate_blood_markers(payload)
    attempt = BloodMarkerAttempt(
        member_id=member_id,
        markers=result.markers,
        tg_hdl=_decimal(result.tg_hdl),
        homa_ir=_decimal(result.homa_ir),
        aa_epa=_decimal(result.aa_epa),
        aa_epa_source=result.aa_epa_source,
        results={
            "in_range": result.in_range,
            "classification": result.classification,
            "recommendation": {
                "state": result.recommendation.state,
                "epa_dha_dose": result.recommendation.epa_dha_dose,
                "lead": result.recommendation.lead,
            },
        },
        calculation_version=BLOOD_MARKERS_CALCULATION_VERSION,
        completed_at=completed_at or datetime.now(timezone.utc),
    )
    db.add(attempt)
    db.flush()
    return attempt


def blood_markers_history(db: Session, member_id: UUID) -> list[BloodMarkerAttempt]:
    return (
        db.query(BloodMarkerAttempt)
        .filter(BloodMarkerAttempt.member_id == member_id)
        .order_by(BloodMarkerAttempt.completed_at.desc(), BloodMarkerAttempt.created_at.desc())
        .all()
    )
