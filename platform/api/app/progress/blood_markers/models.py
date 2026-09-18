import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, JSON, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BloodMarkerAttempt(Base):
    """One saved Blood Test Markers entry. Everything needed to audit the
    result later is stored with it: the submitted values, the calculated
    ratios, the in-range flags, the bands and the recommendation, plus the
    calculation version. History reads never recalculate."""

    __tablename__ = "blood_marker_attempts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    markers: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    # Calculated ratios carry two decimals; a laboratory-reported AA/EPA ratio
    # is kept as reported, to four decimals.
    tg_hdl: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    homa_ir: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    aa_epa: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    aa_epa_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    results: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    calculation_version: Mapped[str] = mapped_column(String(24), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
