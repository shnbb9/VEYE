import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, JSON, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BodyCompositionAttempt(Base):
    __tablename__ = "body_composition_attempts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    measurements: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    sex: Mapped[str] = mapped_column(String(12), nullable=False)
    bmi: Mapped[Decimal | None] = mapped_column(Numeric(4, 1), nullable=True)
    body_fat_percent: Mapped[int | None] = mapped_column(nullable=True)
    fat_mass_lb: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    lean_mass_lb: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    unavailable_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    calculation_version: Mapped[str] = mapped_column(String(24), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
