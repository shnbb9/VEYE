from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Keys with a defined purpose today. Anything else is refused by the API.
SUPPORT_EMAIL = "support_email"      # printed on the member Contact Us card and the public Help page
SUPPORT_PHONE = "support_phone"      # optional; shown beside the email when set
KEYS = (SUPPORT_EMAIL, SUPPORT_PHONE)
# The approved prototype's values (dashboard Contact Us = contact@veye.co).
DEFAULTS = {SUPPORT_EMAIL: "contact@veye.co", SUPPORT_PHONE: ""}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ProductSetting(Base):
    __tablename__ = "product_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)   # {"value": ...}
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
