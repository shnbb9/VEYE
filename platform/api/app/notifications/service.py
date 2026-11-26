"""Generic notification foundation: one record per event, one outbox row per
delivery attempt, preferences per kind.

Two ways to send:

  * `notify` delivers at once, inside the caller's transaction — the original
    path, still used by the account messages;
  * `queue` + `dispatch` is commit-first: the outbox row is written in the same
    transaction as the change it reports, the caller commits, and only then is
    the message handed to the provider. A message can therefore never describe
    a change that was rolled back, a failed send stays visible as `retry` /
    `failed` instead of being mistaken for sent, and `dispatch_due` (the
    scheduled job) retries with backoff until it is out of attempts."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.models import UserAccount
from app.notifications.email import EmailMessage, EmailProvider
from app.notifications.models import Notification, NotificationOutbox, NotificationPreference

NOTIFICATION_KINDS = ("welcome", "email_verification", "password_reset", "companion_escalation",
                      "admin_invitation", "email_change", "email_changed", "account_deactivated",
                      "prospect_confirmation", "health_sharing_request", "erasure_receipt", "member_invitation",
                      "request_received")
# Security messages are always delivered regardless of preference: nobody may
# switch off the message that activates their console account, confirms a new
# address, tells the old address that the account moved, or tells them their
# account was switched off. ("email_change" is the confirmation sent to the new
# address; "email_changed" is the warning sent to the old one afterwards.)
# The three V2 kinds are service messages about the person's own data — a
# saved result, a request to share, a deletion — not updates anyone opted into.
TRANSACTIONAL_KINDS = frozenset({"email_verification", "password_reset",
                                 "admin_invitation", "email_change", "email_changed", "account_deactivated",
                                 "prospect_confirmation", "health_sharing_request", "erasure_receipt", "member_invitation"})

# Outbox states for the commit-first path.
QUEUED, SENDING, RETRY, SENT, FAILED, SKIPPED = "queued", "sending", "retry", "sent", "failed", "skipped"
MAX_ATTEMPTS = 5
# Minutes to wait after the 1st, 2nd, 3rd, 4th failed attempt.
BACKOFF_MINUTES = (1, 5, 30, 120)
# A dispatcher that died mid-send leaves a row in `sending`; after this long it
# is handed out again. (A provider that accepted the message but whose answer
# was lost would then be asked twice — the duplicate is the lesser harm than a
# message that silently never goes.)
STALE_SENDING = timedelta(minutes=10)


class DuplicateNotification(Exception):
    """A message with this idempotency key was already queued."""


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
        to_email: str | None = None,
    ) -> Notification:
        """`to_email` overrides the account's current address — used only when
        the message must go somewhere else by design, as the confirmation of a
        new email address does."""
        if kind not in NOTIFICATION_KINDS:
            raise ValueError(f"Unknown notification kind '{kind}'")
        notification = Notification(
            user_id=user.id, kind=kind, channel="email", subject=subject,
            body_text=text, body_html=html, context=context or {},
        )
        self.db.add(notification)
        self.db.flush()
        outbox = NotificationOutbox(notification_id=notification.id, to_email=to_email or user.email,
                                    provider=self.provider.name)
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

    # ---- commit-first delivery ------------------------------------------------
    def queue(self, kind: str, *, to_email: str, subject: str, text: str, html: str | None = None,
              context: dict | None = None, user: UserAccount | None = None,
              idempotency_key: str | None = None) -> NotificationOutbox:
        """Write the message and its outbox row; send nothing. The caller
        commits, then calls `dispatch`. With an `idempotency_key`, a second
        queue of the same message raises DuplicateNotification — the unique
        constraint decides, so two concurrent callers cannot both queue it."""
        if kind not in NOTIFICATION_KINDS:
            raise ValueError(f"Unknown notification kind '{kind}'")
        if idempotency_key is not None:
            existing = (self.db.query(Notification)
                        .filter(Notification.idempotency_key == idempotency_key).one_or_none())
            if existing is not None:
                raise DuplicateNotification(idempotency_key)
        now = datetime.now(timezone.utc)
        notification = Notification(user_id=user.id if user is not None else None, kind=kind, channel="email",
                                    subject=subject, body_text=text, body_html=html, context=context or {},
                                    idempotency_key=idempotency_key)
        self.db.add(notification)
        self.db.flush()
        outbox = NotificationOutbox(notification_id=notification.id, to_email=to_email, provider=self.provider.name,
                                    status=QUEUED, next_attempt_at=now)
        self.db.add(outbox)
        self.db.flush()
        if user is not None and kind not in TRANSACTIONAL_KINDS and not self.preferences(user.id).get(kind, True):
            outbox.status = SKIPPED
            outbox.last_error = "Disabled by the recipient's notification preference."
            outbox.next_attempt_at = None
            self.db.flush()
        return outbox

    def dispatch(self, outbox_id: UUID) -> NotificationOutbox | None:
        """Send one queued row. Call only after the transaction that queued it
        committed. Claims the row with a conditional update first, so two
        dispatchers never send the same row; commits its own outcome."""
        claimed = (self.db.query(NotificationOutbox)
                   .filter(NotificationOutbox.id == outbox_id, NotificationOutbox.status.in_((QUEUED, RETRY)))
                   .update({"status": SENDING, "attempts": NotificationOutbox.attempts + 1,
                            "next_attempt_at": datetime.now(timezone.utc)}, synchronize_session=False))
        self.db.commit()
        outbox = self.db.get(NotificationOutbox, outbox_id)
        if outbox is None:
            return None
        self.db.refresh(outbox)
        if not claimed:
            return outbox
        notification = outbox.notification
        try:
            result = self.provider.send(EmailMessage(to=outbox.to_email, subject=notification.subject,
                                                     text=notification.body_text, html=notification.body_html,
                                                     from_name=(notification.context or {}).get("from_name")))
            accepted, error, message_id, provider = result.accepted, result.error, result.message_id, result.provider
        except Exception as exc:  # a provider bug must not leave the row "sending" for ever
            accepted, error, message_id, provider = False, f"{type(exc).__name__}: {str(exc)[:300]}", None, outbox.provider
        now = datetime.now(timezone.utc)
        outbox.provider = provider
        if accepted:
            outbox.status = SENT
            outbox.sent_at = now
            outbox.provider_message_id = message_id
            outbox.last_error = None
            outbox.next_attempt_at = None
        else:
            outbox.last_error = error
            if outbox.attempts >= MAX_ATTEMPTS:
                outbox.status = FAILED
                outbox.next_attempt_at = None
            else:
                outbox.status = RETRY
                outbox.next_attempt_at = now + timedelta(minutes=BACKOFF_MINUTES[min(outbox.attempts, len(BACKOFF_MINUTES)) - 1])
        self.db.commit()
        return outbox

    def dispatch_due(self, *, now: datetime | None = None, limit: int = 100, dry_run: bool = False) -> dict:
        """The scheduled job: everything queued or due for a retry, plus rows a
        dead dispatcher left in `sending`."""
        now = now or datetime.now(timezone.utc)
        stale = (self.db.query(NotificationOutbox)
                 .filter(NotificationOutbox.status == SENDING, NotificationOutbox.next_attempt_at.is_not(None),
                         NotificationOutbox.next_attempt_at <= now - STALE_SENDING).all())
        due = (self.db.query(NotificationOutbox.id)
               .filter(NotificationOutbox.status.in_((QUEUED, RETRY)),
                       or_(NotificationOutbox.next_attempt_at.is_(None), NotificationOutbox.next_attempt_at <= now))
               .order_by(NotificationOutbox.created_at, NotificationOutbox.id).limit(limit).all())
        if dry_run:
            return {"due": len(due), "stale": len(stale), "sent": 0, "failed": 0}
        for row in stale:
            row.status = RETRY
        self.db.commit()
        ids = [row_id for (row_id,) in due] + [row.id for row in stale]
        sent = failed = 0
        for outbox_id in dict.fromkeys(ids):
            outcome = self.dispatch(outbox_id)
            if outcome is not None and outcome.status == SENT:
                sent += 1
            elif outcome is not None and outcome.status in (RETRY, FAILED):
                failed += 1
        return {"due": len(due), "stale": len(stale), "sent": sent, "failed": failed}


def deliver_after(outbox_ids: list[UUID]) -> None:
    """For a background task, after the person has their answer: a mail server
    that takes its time keeps nobody waiting. Anything not sent here is picked
    up by the scheduled delivery."""
    from app.core.runtime import get_runtime
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        service = NotificationService(db, get_runtime().email)
        for outbox_id in outbox_ids:
            service.dispatch(outbox_id)
