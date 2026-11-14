"""Asking a member to share — by hand from Member 360, or automatically once
a new member has verified their address (architecture V2 §4.2–4.3).

Asking is the console's whole power here, and this module adds only the
ability to *tell* the member they were asked:

  * the request and its email are written in ONE transaction (the outbox row
    is queued, not sent), the caller commits, and only then is the message
    handed to the provider — so an email can never describe a request that was
    rolled back, and a failed send stays visible as failed;
  * the link carries an opaque reference that identifies the request and
    grants nothing. Deciding still takes a member session, the right member,
    and a verified address (see routes.py);
  * an automatic request fires at most once per member per notification
    policy version — the notification's unique idempotency key makes that a
    database fact — and never for someone who already decided.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth.models import UserAccount
from app.health_permission.models import (
    SOURCE_ADMIN_CONSOLE,
    SOURCE_AUTOMATIC,
    STATE_DECLINED,
    STATE_GRANTED,
    STATE_NOT_REQUESTED,
    STATE_REQUESTED,
    STATE_REVOKED,
    MemberHealthPermission,
)
from app.health_permission.policy import (
    CTA_LABEL,
    MODE_AUTOMATIC,
    current_notification,
    current_template,
)
from app.health_permission.service import HealthPermissionService
from app.notifications import templates
from app.notifications.models import Notification, NotificationOutbox
from app.notifications.service import NotificationService
from app.policies.richtext import render_html, render_text, substitute
from app.policies.service import aware


class SharingRequestError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class Eligibility:
    can_request: bool
    reason: str | None           # why not, in the console's words
    requires_reason: bool        # declined/revoked: a new ask needs a stated reason
    next_request_at: datetime | None


@dataclass(frozen=True)
class RequestOutcome:
    permission: MemberHealthPermission
    outbox_id: UUID
    request_ref: str


def review_link(base_url: str, ref: str) -> str:
    return f"{base_url}/app/settings?section=privacy&request={ref}"


def _support_email(db: Session) -> str:
    try:
        from app.product_settings.routes import read_support

        return read_support(db).support_email
    except Exception:  # a convenience in the message, never a blocker
        return ""


class SharingRequests:
    def __init__(self, db: Session, notifications: NotificationService, *, web_base_url: str,
                 now: Callable[[], datetime] | None = None) -> None:
        self.db = db
        self.notifications = notifications
        self.web_base_url = web_base_url
        self._now = now or (lambda: datetime.now(timezone.utc))

    def account_for(self, member_id: UUID) -> UserAccount | None:
        return self.db.query(UserAccount).filter(UserAccount.member_id == member_id).one_or_none()

    # ---- may the console ask? -------------------------------------------------------
    def eligibility(self, member_id: UUID) -> Eligibility:
        user = self.account_for(member_id)
        if user is None:
            return Eligibility(False, "This member has no sign-in account.", False, None)
        if not user.is_active:
            return Eligibility(False, "This account is deactivated.", False, None)
        if user.email_verified_at is None:
            return Eligibility(False, "This member has not verified their email address yet. A request can be "
                                      "sent once they have.", False, None)
        row = HealthPermissionService(self.db).current(member_id)
        state = row.state if row is not None else STATE_NOT_REQUESTED
        if state == STATE_GRANTED:
            return Eligibility(False, "This member already shares their health records.", False, None)
        if state == STATE_REQUESTED and row is not None and row.requested_at is not None:
            policy = current_notification(self.db)
            next_at = aware(row.requested_at) + timedelta(hours=policy.resend_interval_hours)
            if next_at > self._now():
                return Eligibility(False, f"Asked {aware(row.requested_at):%d %b %Y}. You can ask again after "
                                          f"{next_at:%d %b %Y, %H:%M} UTC.", False, next_at)
        return Eligibility(True, None, state in (STATE_DECLINED, STATE_REVOKED), None)

    # ---- asking ----------------------------------------------------------------------
    def manual(self, member_id: UUID, *, by_user_id: UUID, by_name: str, reason: str | None) -> RequestOutcome:
        allowed = self.eligibility(member_id)
        if not allowed.can_request:
            raise SharingRequestError(409, allowed.reason or "A request cannot be sent now.")
        note = (reason or "").strip()
        if allowed.requires_reason and len(note) < 10:
            raise SharingRequestError(422, "This member said no before. Asking again needs a short reason that is "
                                           "about them — it is kept with the request.")
        user = self.account_for(member_id)
        assert user is not None
        ref = secrets.token_urlsafe(18)
        row = HealthPermissionService(self.db).request(member_id, by_user_id=by_user_id, by_name=by_name,
                                                       note=note or None, request_ref=ref)
        outbox = self._queue(user, row, ref, idempotency_key=f"hsr:manual:{row.id}:{ref}")
        return RequestOutcome(permission=row, outbox_id=outbox.id, request_ref=ref)

    def automatic(self, user: UserAccount) -> RequestOutcome | None:
        """After a member's address is verified. Quietly does nothing unless
        every condition holds; never raises into the verification it follows."""
        policy = current_notification(self.db)
        if policy.mode != MODE_AUTOMATIC or user.member_id is None or not user.is_active or user.email_verified_at is None:
            return None
        row = HealthPermissionService(self.db).current(user.member_id)
        if row is not None and row.state != STATE_NOT_REQUESTED:
            return None
        key = f"hsr:auto:{user.member_id}:{policy.version}"
        if self.db.query(Notification.id).filter(Notification.idempotency_key == key).first() is not None:
            return None
        ref = secrets.token_urlsafe(18)
        row = HealthPermissionService(self.db).request(user.member_id, by_user_id=None, by_name="Veye (automatic)",
                                                       actor="system", source=SOURCE_AUTOMATIC, request_ref=ref)
        outbox = self._queue(user, row, ref, idempotency_key=key)
        return RequestOutcome(permission=row, outbox_id=outbox.id, request_ref=ref)

    def latest_delivery(self, row: MemberHealthPermission | None) -> NotificationOutbox | None:
        if row is None or row.request_outbox_id is None:
            return None
        return self.db.get(NotificationOutbox, row.request_outbox_id)

    def retry_delivery(self, member_id: UUID) -> NotificationOutbox:
        row = HealthPermissionService(self.db).current(member_id)
        outbox = self.latest_delivery(row)
        if row is None or row.state != STATE_REQUESTED or outbox is None:
            raise SharingRequestError(409, "There is no open request whose email can be sent again.")
        if outbox.status not in ("retry", "failed"):
            raise SharingRequestError(409, "That email was not refused, so there is nothing to retry.")
        outbox.status = "retry"
        outbox.next_attempt_at = self._now()
        self.db.flush()
        return outbox

    # ---- the email ------------------------------------------------------------------
    def _queue(self, user: UserAccount, row: MemberHealthPermission, ref: str, *,
               idempotency_key: str) -> NotificationOutbox:
        policy = current_notification(self.db)
        template, template_version = current_template(self.db)
        link = review_link(self.web_base_url, ref)
        variables = {"first_name": user.first_name or "there", "organization_name": "Veye",
                     "support_email": _support_email(self.db) or "the Veye team",
                     "review_link": link, "request_expiry": "until you answer it"}
        rendered = templates.health_sharing_request(
            substitute(template.subject, variables), render_html(template.body, variables, email=True),
            render_text(template.body, variables), link, CTA_LABEL)
        outbox = self.notifications.queue(
            "health_sharing_request", to_email=user.email, subject=rendered.subject, text=rendered.text,
            html=rendered.html, user=user, idempotency_key=idempotency_key,
            context={"member_id": str(row.member_id), "request_ref": ref, "template_version": template_version,
                     "notification_policy_version": policy.version, "from_name": policy.sender_name})
        row.request_outbox_id = outbox.id
        self.db.flush()
        return outbox
