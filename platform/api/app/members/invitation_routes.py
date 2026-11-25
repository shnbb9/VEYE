"""Member invitations: the console's Invitations view and the two public
routes behind the emailed link. See `invitations.py` for the rules."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.dependencies import get_auth_service, get_notification_service, set_session_cookie
from app.auth.models import UserAccount
from app.auth.principal import PORTAL_MEMBER, CurrentPrincipal, require_admin
from app.auth.schemas import AccountOut, EmailAddress
from app.auth.service import AuthError, AuthService
from app.core.rate_limit import RateLimiter, client_address
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.members.invitations import MODE_MEMBER, STATUS_LABELS, MemberInvitation, MemberInvitationService, aware
from app.notifications.models import NotificationOutbox
from app.notifications.service import NotificationService

admin_router = APIRouter(prefix="/api/v1/admin/member-invitations", tags=["admin-member-invitations"],
                         dependencies=[Depends(require_admin)])
public_router = APIRouter(prefix="/api/v1/auth/member-invitation", tags=["auth"])


class InviteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailAddress
    first_name: str = Field(default="", max_length=120)
    last_name: str = Field(default="", max_length=120)


class InvitationOut(BaseModel):
    id: UUID
    email: str
    name: str
    status: Literal["pending", "accepted", "expired", "revoked"]
    status_label: str
    invited_by: str
    created_at: datetime
    last_sent_at: datetime | None
    sent_count: int
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    member_id: UUID | None
    delivery: str | None            # queued | sending | retry | sent | failed
    delivery_error: str | None


class InvitationsPage(BaseModel):
    rows: list[InvitationOut]
    total: int
    page: int
    page_size: int
    counts: dict[str, int]


class TokenIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=1, max_length=256)


class PreviewOut(BaseModel):
    email: str
    first_name: str
    last_name: str
    invited_by: str
    mode: Literal["new_account", "add_profile", "confirm_existing", "already_member"]
    expires_at: datetime


class AcceptIn(TokenIn):
    first_name: str = Field(default="", max_length=120)
    last_name: str = Field(default="", max_length=120)
    password: str = Field(default="", max_length=256)
    remember: bool = False


class AcceptOut(BaseModel):
    mode: str
    account: AccountOut | None
    message: str


def _raise(exc: AuthError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _out(row: MemberInvitation, outbox: NotificationOutbox | None) -> InvitationOut:
    status = row.status(_now())
    return InvitationOut(
        id=row.id, email=row.email, name=f"{row.first_name} {row.last_name}".strip(), status=status,
        status_label=STATUS_LABELS[status], invited_by=row.invited_by_name, created_at=aware(row.created_at),
        last_sent_at=aware(row.last_sent_at), sent_count=row.sent_count, expires_at=aware(row.expires_at),
        accepted_at=aware(row.accepted_at), revoked_at=aware(row.revoked_at), member_id=row.member_id,
        delivery=outbox.status if outbox else None, delivery_error=outbox.last_error if outbox else None)


def _row(db: Session, invitation_id: UUID) -> MemberInvitation:
    row = db.get(MemberInvitation, invitation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That invitation was not found.")
    return row


@admin_router.get("", response_model=InvitationsPage)
def list_invitations(
    q: str = Query(default="", max_length=120),
    status: Literal["any", "pending", "accepted", "expired", "revoked"] = Query(default="any"),
    sort: Literal["newest", "oldest", "email"] = Query(default="newest"),
    page: int = Query(default=1, ge=1), page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> InvitationsPage:
    now = _now()
    rows = db.query(MemberInvitation).all()
    counts = {key: 0 for key in STATUS_LABELS}
    for row in rows:
        counts[row.status(now)] += 1
    needle = q.strip().lower()
    if needle:
        rows = [r for r in rows if needle in r.email or needle in f"{r.first_name} {r.last_name}".lower()]
    if status != "any":
        rows = [r for r in rows if r.status(now) == status]
    if sort == "email":
        rows.sort(key=lambda r: (r.email, str(r.id)))
    else:
        rows.sort(key=lambda r: (aware(r.created_at), str(r.id)), reverse=sort == "newest")
    start = (page - 1) * page_size
    shown = rows[start:start + page_size]
    ids = [r.outbox_id for r in shown if r.outbox_id]
    boxes = {b.id: b for b in db.query(NotificationOutbox).filter(NotificationOutbox.id.in_(ids)).all()} if ids else {}
    return InvitationsPage(rows=[_out(r, boxes.get(r.outbox_id)) for r in shown], total=len(rows), page=page,
                           page_size=page_size, counts=counts)


def _send_and_answer(db: Session, notifications: NotificationService, row: MemberInvitation) -> InvitationOut:
    """Committed first, sent second: a refused send leaves the invitation
    standing and says so, and the scheduled job keeps trying."""
    db.commit()
    if row.outbox_id:
        notifications.dispatch(row.outbox_id)
    db.refresh(row)
    return _out(row, db.get(NotificationOutbox, row.outbox_id) if row.outbox_id else None)


@admin_router.post("", response_model=InvitationOut, status_code=201)
def invite_member(payload: InviteIn, request: Request, principal: CurrentPrincipal = Depends(require_admin),
                  db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
                  auth: AuthService = Depends(get_auth_service),
                  notifications: NotificationService = Depends(get_notification_service)) -> InvitationOut:
    RateLimiter(db, runtime.settings).enforce("member_invitation", subject=str(principal.user_id),
                                              address=client_address(request))
    actor = db.get(UserAccount, principal.user_id)
    try:
        row = MemberInvitationService(db, auth, notifications).invite(
            email=str(payload.email), first_name=payload.first_name, last_name=payload.last_name, by=actor)
    except AuthError as exc:
        _raise(exc)
    record_audit(db, principal, "member_invitation.sent", "member_invitation", str(row.id), {"email": row.email})
    return _send_and_answer(db, notifications, row)


@admin_router.post("/{invitation_id}/resend", response_model=InvitationOut)
def resend_member_invitation(invitation_id: UUID, request: Request, principal: CurrentPrincipal = Depends(require_admin),
                             db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
                             auth: AuthService = Depends(get_auth_service),
                             notifications: NotificationService = Depends(get_notification_service)) -> InvitationOut:
    RateLimiter(db, runtime.settings).enforce("member_invitation", subject=str(principal.user_id),
                                              address=client_address(request))
    row = _row(db, invitation_id)
    try:
        MemberInvitationService(db, auth, notifications).resend(row, db.get(UserAccount, principal.user_id))
    except AuthError as exc:
        _raise(exc)
    record_audit(db, principal, "member_invitation.resent", "member_invitation", str(row.id),
                 {"email": row.email, "times_sent": row.sent_count})
    return _send_and_answer(db, notifications, row)


@admin_router.post("/{invitation_id}/revoke", response_model=InvitationOut)
def revoke_member_invitation(invitation_id: UUID, principal: CurrentPrincipal = Depends(require_admin),
                             db: Session = Depends(get_db), auth: AuthService = Depends(get_auth_service),
                             notifications: NotificationService = Depends(get_notification_service)) -> InvitationOut:
    row = _row(db, invitation_id)
    service = MemberInvitationService(db, auth, notifications)
    try:
        service.revoke(row)
    except AuthError as exc:
        _raise(exc)
    record_audit(db, principal, "member_invitation.revoked", "member_invitation", str(row.id), {"email": row.email})
    db.commit()
    db.refresh(row)
    return _out(row, service.delivery(row))


@public_router.post("/preview", response_model=PreviewOut)
def preview(payload: TokenIn, request: Request, db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
            auth: AuthService = Depends(get_auth_service),
            notifications: NotificationService = Depends(get_notification_service)) -> PreviewOut:
    """POST, so the capability never sits in an access log's query string."""
    RateLimiter(db, runtime.settings).enforce("member_invitation_token", subject=f"ip:{client_address(request)}")
    service = MemberInvitationService(db, auth, notifications)
    try:
        row = service.peek(payload.token)
        mode = service.mode(row)
    except AuthError as exc:
        db.commit()  # keep the rate-limit hit
        _raise(exc)
    db.commit()
    return PreviewOut(email=row.email, first_name=row.first_name, last_name=row.last_name,
                      invited_by=row.invited_by_name, mode=mode, expires_at=aware(row.expires_at))


@public_router.post("/accept", response_model=AcceptOut)
def accept(payload: AcceptIn, request: Request, response: Response, db: Session = Depends(get_db),
           runtime: Runtime = Depends(get_runtime), auth: AuthService = Depends(get_auth_service),
           notifications: NotificationService = Depends(get_notification_service)) -> AcceptOut:
    from app.auth.routes import account_out

    RateLimiter(db, runtime.settings).enforce("member_invitation_token", subject=f"ip:{client_address(request)}")
    db.commit()  # the hit stands whatever happens next
    try:
        done = MemberInvitationService(db, auth, notifications).accept(
            payload.token, first_name=payload.first_name, last_name=payload.last_name,
            password=payload.password, remember=payload.remember)
    except AuthError as exc:
        db.rollback()
        _raise(exc)
    asked = None
    if done.mode != MODE_MEMBER:
        # The address is proven now, exactly as after /verify-email: finish a
        # pending saved result, and fire the automatic sharing request if that
        # mode is on. Neither grants anything.
        from app.health_permission.requests import SharingRequests
        from app.prospects.routes import cipher_for
        from app.prospects.service import ProspectService

        ProspectService(db, cipher=cipher_for(runtime.settings), now=runtime.clock).finalize_for_verified_account(done.user)
        asked = SharingRequests(db, notifications, web_base_url=runtime.settings.web_base_url,
                                now=runtime.clock).automatic(done.user)
    db.commit()
    if asked is not None:
        notifications.dispatch(asked.outbox_id)
    db.refresh(done.user)
    if done.session is None:
        return AcceptOut(mode=done.mode, account=None, message="You already have a Veye member account. Sign in to open it.")
    set_session_cookie(response, done.session, runtime)
    return AcceptOut(mode=done.mode, account=account_out(done.user, PORTAL_MEMBER), message="Welcome to Veye.")
