import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class HealthAssessmentAttempt(Base):
    """One completed Health Assessment (11 questions, total 11–33, lower is
    better). Everything needed to replay the report later is stored with it —
    the answers, the total, the band, the wording and the EPA/DHA suggestion
    issued that day, plus the calculation version. History reads never
    re-score, and no administrator can change a stored result."""

    __tablename__ = "health_assessment_attempts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    answers: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    bucket: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(48), nullable=False)
    interpretation: Mapped[str] = mapped_column(Text, nullable=False)
    epa_dha_dose: Mapped[str] = mapped_column(String(16), nullable=False)
    calculation_version: Mapped[str] = mapped_column(String(40), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
