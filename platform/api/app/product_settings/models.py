from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Keys with a defined purpose today. Anything else is refused by the API.
# Printed on the member Contact Us card and dialog, and in the account emails
# and request replies Veye sends. NOT on the public Help page: that page carries
# the client-approved help@veye.co in its own copy (as the approved prototype
# does), and the two addresses are a deliberate split, not a drift.
SUPPORT_EMAIL = "support_email"
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
