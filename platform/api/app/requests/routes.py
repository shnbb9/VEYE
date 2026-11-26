"""Requests & Inbox routes.

Public: a visitor sends a Contact Us message or a Help question.
Member: Contact Us / Help question / Join Beta from inside the application,
plus the member's own list (so a card can say "requested on …").
Admin: list with filters, one request, status changes, and the replies
the console sends back.

Two things here email anybody: a new request tells the team's support
address that it arrived (app/requests/team.py), and a reply goes to whoever
wrote in."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.models import UserAccount
from app.auth.principal import CurrentPrincipal, require_admin, require_member
from app.core.runtime import Runtime, get_runtime
from app.core.idempotency import Idempotency, Replay
from app.core.rate_limit import RateLimiter, client_address
from app.db.session import get_db
from app.notifications.service import deliver_after
from app.product_settings.routes import read_support
from app.requests.models import KINDS, MemberRequest
from app.requests.schemas import (
    MemberRequestIn,
    MemberRequestOut,
    PriorityIn,
    PublicRequestIn,
    RequestOut,
    RequestReplyIn,
    RequestsPage,
    RequestStatusIn,
    SubmittedOut,
)
from app.requests.service import RequestError, RequestService, member_request_out, request_out
from app.requests.team import team_notices, tell_the_team

public_router = APIRouter(prefix="/api/v1/requests", tags=["requests"])
member_router = APIRouter(prefix="/api/v1/members/me/requests", tags=["requests"])
admin_router = APIRouter(prefix="/api/v1/admin/requests", tags=["admin-requests"], dependencies=[Depends(require_admin)])


def _raise(exc: RequestError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _console(db: Session, row: MemberRequest) -> RequestOut:
    """A request as the console sees it, with what became of the team's email."""
    return request_out(row, team_notices(db, [row.id]).get(row.id))


@public_router.post("", response_model=SubmittedOut, status_code=status.HTTP_201_CREATED)
def submit_public(payload: PublicRequestIn, request: Request, background: BackgroundTasks, db: Session = Depends(get_db),
                  runtime: Runtime = Depends(get_runtime)) -> SubmittedOut:
    # Anyone at all can write here, so anyone at all is limited.
    RateLimiter(db).enforce("public_request", subject=f"ip:{client_address(request)}")
    row = RequestService(db).create_public(payload)
    told = tell_the_team(db, runtime, row)
    db.commit()
    background.add_task(deliver_after, [told])
    return SubmittedOut(id=row.id, kind=row.kind, status=row.status, created_at=row.created_at)


@member_router.post("", response_model=SubmittedOut, status_code=status.HTTP_201_CREATED)
def submit_member(payload: MemberRequestIn, background: BackgroundTasks, principal: CurrentPrincipal = Depends(require_member),
                  db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> SubmittedOut:
    user = db.get(UserAccount, principal.user_id)
    if user is None or user.member_id is None:
        raise HTTPException(status_code=403, detail="This account has no Veye member profile.")
    # Each one emails the team now, so a member is limited too, far above anything honest.
    RateLimiter(db).enforce("member_request", subject=f"member:{user.member_id}")
    try:
        row, already_open = RequestService(db).create_for_member(user, payload)
    except RequestError as exc:
        _raise(exc)
    told = None if already_open else tell_the_team(db, runtime, row)
    db.commit()
    if told is not None:
        background.add_task(deliver_after, [told])
    return SubmittedOut(id=row.id, kind=row.kind, status=row.status, created_at=row.created_at, already_open=already_open)


@member_router.get("", response_model=list[MemberRequestOut])
def my_requests(principal: CurrentPrincipal = Depends(require_member),
                db: Session = Depends(get_db)) -> list[MemberRequestOut]:
    assert principal.member_id is not None
    return [member_request_out(r) for r in RequestService(db).list_for_member(principal.member_id)]


@admin_router.get("", response_model=RequestsPage)
def list_requests(
    view: Literal["open", "all", "resolved", "new", "in_progress", "awaiting_reply"] = Query(default="open"),
    kind: str | None = Query(default=None), q: str = Query(default="", max_length=120),
    source: Literal["member", "public"] | None = Query(default=None),
    priority: Literal["high", "medium", "low", "unassigned"] | None = Query(default=None),
    page: int = Query(default=1, ge=1), page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> RequestsPage:
    if kind is not None and kind not in KINDS:
        raise HTTPException(status_code=422, detail="Unknown request kind.")
    service = RequestService(db)
    try:
        rows, total = service.list_for_console(view=view, kind=kind, q=q, source=source, priority=priority,
                                               page=page, page_size=page_size)
    except RequestError as exc:
        _raise(exc)
    notices = team_notices(db, [r.id for r in rows])
    return RequestsPage(rows=[request_out(r, notices.get(r.id)) for r in rows], total=total, page=page, page_size=page_size,
                        counts=service.counts())


@admin_router.get("/{request_id}", response_model=RequestOut)
def get_request(request_id: UUID, db: Session = Depends(get_db)) -> RequestOut:
    try:
        return _console(db, RequestService(db).get(request_id))
    except RequestError as exc:
        _raise(exc)


@admin_router.post("/{request_id}/status", response_model=RequestOut)
def set_status(request_id: UUID, payload: RequestStatusIn, principal: CurrentPrincipal = Depends(require_admin),
               db: Session = Depends(get_db)) -> RequestOut:
    try:
        row = RequestService(db).set_status(request_id, payload.status, by=principal.display_name, note=payload.resolution_note)
    except RequestError as exc:
        _raise(exc)
    record_audit(db, principal, f"requests.{payload.status}", "member_request", str(row.id), {"kind": row.kind, "status": row.status})
    db.commit()
    return _console(db, row)


@admin_router.put("/{request_id}/priority", response_model=RequestOut)
def set_priority(request_id: UUID, payload: PriorityIn, principal: CurrentPrincipal = Depends(require_admin),
                 db: Session = Depends(get_db)) -> RequestOut:
    """How important the team says this is. A label a person puts on, recorded
    with who and what it was before."""
    try:
        row, before = RequestService(db).set_priority(request_id, payload.priority)
    except RequestError as exc:
        _raise(exc)
    record_audit(db, principal, "requests.priority_set", "member_request", str(row.id),
                 {"from": before or "", "to": row.priority or ""})
    db.commit()
    return _console(db, row)


@admin_router.post("/{request_id}/reply", response_model=RequestOut)
def reply_to_request(request_id: UUID, payload: RequestReplyIn, principal: CurrentPrincipal = Depends(require_admin),
                     db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> RequestOut:
    """Answer whoever wrote in. The reply is emailed to the address on the
    request and kept with it, including whether it actually left — a reply
    that failed must not look like one that arrived.

    The status is deliberately left alone: moving it is a separate, visible
    decision the administrator makes with the buttons beside this box."""
    idempotency = Idempotency(db)
    try:
        # Claimed before the send, so a replay never reaches the relay.
        idempotency.claim("request_reply", payload.idempotency_key, subject=str(principal.user_id))
    except Replay as replay:
        db.commit()
        return _console(db, RequestService(db).get(request_id))
    sender = db.get(UserAccount, principal.user_id)
    support = read_support(db).support_email
    try:
        reply = RequestService(db).reply(request_id, payload.body, sender=sender, email=runtime.email,
                                         support_email=support)
    except RequestError as exc:
        _raise(exc)
    row = RequestService(db).get(request_id)
    record_audit(db, principal, "requests.replied", "member_request", str(row.id),
                 {"kind": row.kind, "to": reply.to_email, "delivery": reply.delivery_status})
    idempotency.complete("request_reply", payload.idempotency_key, str(reply.id))
    db.commit()
    return _console(db, row)
