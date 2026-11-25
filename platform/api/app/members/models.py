import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Member(Base):
    __tablename__ = "members"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    # Set the moment the member asks to be deleted (architecture V2 §6). From
    # then on nothing reads this profile — not the member routes (the account
    # no longer points here), not the console, not Sprout — while the purge
    # removes it.
    erasure_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Archived (V4 §1.6): out of the active directory and out of the member
    # application, reversible, nothing deleted. Not a deactivated account (the
    # sign-in and any console access are untouched) and not an erasure.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
    archive_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    health_number_attempts = relationship("HealthNumberAttempt", back_populates="member", cascade="all, delete-orphan")

