"""The team hears that somebody wrote in.

Each new Contact Us message, Help question and Join Beta request is emailed to
the support address in Settings -> Product settings: the address members are
told to write to, so the team reads both in one place. The email says that one
arrived and links to it; who wrote and what they wrote stay in the console,
behind its sign-in.

Commit-first, like every email here: queued with the request, sent after the
person has their answer, retried by the scheduled delivery when refused, and
shown on the request in the console whichever way it went. A Join Beta request
that was already open is the same request, so it is not announced twice."""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.runtime import Runtime
from app.notifications import templates
from app.notifications.models import Notification, NotificationOutbox
from app.notifications.service import NotificationService
from app.product_settings.routes import read_support
from app.requests.models import MemberRequest
from app.requests.schemas import TeamNoticeOut

KIND = "request_received"


def _key(request_id: UUID) -> str:
    return f"{KIND}:{request_id}"


def tell_the_team(db: Session, runtime: Runtime, row: MemberRequest) -> UUID:
    """Queue the email; the caller commits and then sends it."""
    link = f"{runtime.settings.web_base_url}/admin/requests?id={row.id}"
    rendered = templates.request_received(row.kind, row.source, row.created_at, link)
    outbox = NotificationService(db, runtime.email).queue(
        KIND, to_email=read_support(db).support_email, subject=rendered.subject, text=rendered.text, html=rendered.html,
        idempotency_key=_key(row.id), context={"request_id": str(row.id), "kind": row.kind})
    return outbox.id


def team_notices(db: Session, request_ids: Iterable[UUID]) -> dict[UUID, TeamNoticeOut]:
    """What happened to each request's email to the team, for the console."""
    keys = {_key(request_id): request_id for request_id in request_ids}
    if not keys:
        return {}
    rows = (db.query(Notification.idempotency_key, NotificationOutbox)
            .join(NotificationOutbox, NotificationOutbox.notification_id == Notification.id)
            .filter(Notification.idempotency_key.in_(list(keys))).all())
    return {keys[key]: TeamNoticeOut(status=outbox.status, to_email=outbox.to_email, sent_at=outbox.sent_at,
                                     detail=outbox.last_error) for key, outbox in rows}
