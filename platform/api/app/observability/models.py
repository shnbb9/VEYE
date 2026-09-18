import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")


class AiTraceEvent(Base):
    """Masked Companion telemetry kept locally for the admin Advanced monitoring
    screens. `payload` is exactly what an external exporter would receive;
    `conversation_id`/`message_id` are internal review links only."""

    __tablename__ = "ai_trace_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trace_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    environment: Mapped[str] = mapped_column(String(32), nullable=False)
    member_ref: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    session_ref: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    policy_outcome: Mapped[str] = mapped_column(String(24), nullable=False)
    policy_category: Mapped[str | None] = mapped_column(String(48), nullable=True)
    safety_result: Mapped[str] = mapped_column(String(32), nullable=False)
    retrieval_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    top_retrieval_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    feedback: Mapped[str | None] = mapped_column(String(24), nullable=True)
    error_category: Mapped[str | None] = mapped_column(String(48), nullable=True)
    exporters: Mapped[str] = mapped_column(Text, nullable=False, default="")
    payload: Mapped[dict] = mapped_column(JsonType, nullable=False)
