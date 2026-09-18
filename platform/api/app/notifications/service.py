"""Generic notification foundation: one record per event, one outbox row per
delivery attempt, preferences per kind. Delivery is synchronous here (local
development); a queue/worker can take over the outbox later without changing
callers."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth.models import UserAccount
from app.notifications.email import EmailMessage, EmailProvider
from app.notifications.models import Notification, NotificationOutbox, NotificationPreference

NOTIFICATION_KINDS = ("welcome", "email_verification", "password_reset", "companion_escalation")
# Security messages are always delivered regardless of preference.
TRANSACTIONAL_KINDS = frozenset({"email_verification", "password_reset"})


class NotificationService:
    def __init__(self, db: Session, provider: EmailProvider) -> None:
        self.db = db
        self.provider = provider

    # ---- preferences --------------------------------------------------------
    def preferences(self, user_id: UUID) -> dict[str, bool]:
        rows = self.db.query(NotificationPreference).filter(NotificationPreference.user_id == user_id).all()
        stored = {row.kind: row.email_enabled for row in rows}
        return {kind: stored.get(kind, True) for kind in NOTIFICATION_KINDS}

    def set_preference(self, user_id: UUID, kind: str, email_enabled: bool) -> None:
        if kind not in NOTIFICATION_KINDS:
            raise ValueError(f"Unknown notification kind '{kind}'")
        row = (
            self.db.query(NotificationPreference)
            .filter(NotificationPreference.user_id == user_id, NotificationPreference.kind == kind)
            .one_or_none()
        )
        if row is None:
            row = NotificationPreference(user_id=user_id, kind=kind)
            self.db.add(row)
        row.email_enabled = email_enabled
        self.db.flush()

    # ---- sending --------------------------------------------------------------
    def notify(
        self,
        user: UserAccount,
        kind: str,
        *,
        subject: str,
        text: str,
        html: str | None = None,
        context: dict | None = None,
    ) -> Notification:
        if kind not in NOTIFICATION_KINDS:
            raise ValueError(f"Unknown notification kind '{kind}'")
        notification = Notification(
            user_id=user.id, kind=kind, channel="email", subject=subject,
            body_text=text, body_html=html, context=context or {},
        )
        self.db.add(notification)
        self.db.flush()
        outbox = NotificationOutbox(notification_id=notification.id, to_email=user.email, provider=self.provider.name)
        self.db.add(outbox)
        self.db.flush()

        if kind not in TRANSACTIONAL_KINDS and not self.preferences(user.id).get(kind, True):
            outbox.status = "skipped"
            outbox.last_error = "Disabled by the recipient's notification preference."
            self.db.flush()
            return notification

        self.deliver(outbox)
        return notification

    def deliver(self, outbox: NotificationOutbox) -> NotificationOutbox:
        notification = outbox.notification
        outbox.attempts += 1
        result = self.provider.send(
            EmailMessage(to=outbox.to_email, subject=notification.subject, text=notification.body_text, html=notification.body_html)
        )
        outbox.provider = result.provider
        if result.accepted:
            outbox.status = "sent"
            outbox.sent_at = datetime.now(timezone.utc)
            outbox.provider_message_id = result.message_id
            outbox.last_error = None
        else:
            outbox.status = "failed"
            outbox.last_error = result.error
        self.db.flush()
        return outbox

    def latest_outbox(self, notification_id: UUID) -> NotificationOutbox | None:
        return (
            self.db.query(NotificationOutbox)
            .filter(NotificationOutbox.notification_id == notification_id)
            .order_by(NotificationOutbox.created_at.desc())
            .first()
        )
