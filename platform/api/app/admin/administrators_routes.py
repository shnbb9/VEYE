"""Administrators: who may use the console, and how that access is granted
and withdrawn.

There are no roles here. An administrator is one boolean on the account, and
every administrator has exactly the same console. What this module adds is the
provisioning path the console was missing: invite someone, resend or withdraw
an invitation that has not been accepted, and switch an account off or back on.

Guardrails that matter more than the screen does:
  * nobody can switch off their own console access;
  * the last active administrator cannot be switched off, so the console can
    never end up with no way in;
  * deactivating ends every live session immediately;
  * every action is written to the admin audit log.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.dependencies import get_auth_service
from app.auth.models import AuthToken, UserAccount
from app.auth.principal import CurrentPrincipal, require_admin
from app.auth.schemas import DeliveryOut, EmailAddress
from app.auth.service import PURPOSE_ADMIN_INVITE, AuthError, AuthService
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db

router = APIRouter(prefix="/api/v1/admin/administrators", tags=["admin-administrators"],
                   dependencies=[Depends(require_admin)])

STATUS_ACCEPTED = "accepted"
STATUS_PENDING = "pending"
STATUS_EXPIRED = "expired"
STATUS_SEEDED = "seeded"


class AdministratorRow(BaseModel):
    user_id: UUID
    name: str
    email: str
    invitation_status: str          # accepted | pending | expired | seeded
    invited_at: datetime | None
    invited_by: str | None
    accepted_at: datetime | None
    last_active_at: datetime | None
    active_sessions: int
    is_active: bool
    deactivated_at: datetime | None
    also_member: bool               # the same person also uses the member application
    is_self: bool                   # the administrator reading this page
    is_synthetic: bool


class AdministratorsOut(BaseModel):
    rows: list[AdministratorRow]
    total: int
    active: int
    pending: int


class InviteRequest(BaseModel):
    email: EmailAddress
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(default="", max_length=120)


class ActionResult(BaseModel):
    row: AdministratorRow
    delivery: DeliveryOut | None = None


def _raise(exc: AuthError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _administrators(db: Session) -> list[UserAccount]:
    """Everyone who can use the console, plus anyone deactivated while holding
    it — a withdrawn account must stay visible, not vanish from the page."""
    return (db.query(UserAccount)
            .filter(or_(UserAccount.admin_access.is_(True), UserAccount.invitation_accepted_at.isnot(None)))
            .order_by(UserAccount.created_at)
            .all())


def _pending_token(db: Session, user: UserAccount) -> AuthToken | None:
    return (db.query(AuthToken)
            .filter(AuthToken.user_id == user.id, AuthToken.purpose == PURPOSE_ADMIN_INVITE,
                    AuthToken.used_at.is_(None))
            .order_by(AuthToken.created_at.desc())
            .first())


def _invitation_status(db: Session, user: UserAccount) -> str:
    if user.invitation_accepted_at is not None:
        return STATUS_ACCEPTED
    if user.invited_at is None:
        # Created by the seed or by an earlier provisioning route: it works,
        # it simply did not arrive through an invitation.
        return STATUS_SEEDED
    token = _pending_token(db, user)
    if token is None:
        return STATUS_EXPIRED
    expires = _aware(token.expires_at)
    return STATUS_PENDING if expires and expires > datetime.now(timezone.utc) else STATUS_EXPIRED


def _row(db: Session, user: UserAccount, principal: CurrentPrincipal, runtime: Runtime) -> AdministratorRow:
    sessions = runtime.auth_provider.live_sessions(db, user.id)
    admin_sessions = [s for s in sessions if s.portal == "admin"]
    last_seen = max((_aware(s.last_seen_at) for s in sessions), default=None)
    inviter = db.get(UserAccount, user.invited_by_user_id) if user.invited_by_user_id else None
    return AdministratorRow(
        user_id=user.id, name=user.display_name or user.email, email=user.email,
        invitation_status=_invitation_status(db, user),
        invited_at=_aware(user.invited_at), invited_by=(inviter.display_name if inviter else None),
        accepted_at=_aware(user.invitation_accepted_at), last_active_at=last_seen,
        active_sessions=len(admin_sessions), is_active=user.is_active,
        deactivated_at=_aware(user.deactivated_at), also_member=user.member_id is not None,
        is_self=user.id == principal.user_id, is_synthetic=user.is_synthetic,
    )


def _target(db: Session, user_id: UUID) -> UserAccount:
    user = db.get(UserAccount, user_id)
    if user is None or not (user.admin_access or user.invitation_accepted_at is not None):
        raise HTTPException(status_code=404, detail="That administrator was not found.")
    return user


def _other_active_admins(db: Session, user: UserAccount) -> int:
    """Accounts other than this one that can sign in to the console right now —
    seeded or invited. If this reaches zero the console has no way in."""
    return (db.query(UserAccount)
            .filter(UserAccount.id != user.id, UserAccount.admin_access.is_(True), UserAccount.is_active.is_(True))
            .count())


@router.get("", response_model=AdministratorsOut)
def list_administrators(principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db),
                        runtime: Runtime = Depends(get_runtime)) -> AdministratorsOut:
    rows = [_row(db, user, principal, runtime) for user in _administrators(db)]
    return AdministratorsOut(
        rows=rows, total=len(rows),
        active=sum(1 for r in rows if r.is_active),
        pending=sum(1 for r in rows if r.invitation_status == STATUS_PENDING),
    )


@router.post("/invite", response_model=ActionResult, status_code=201)
def invite_administrator(payload: InviteRequest, principal: CurrentPrincipal = Depends(require_admin),
                         db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
                         service: AuthService = Depends(get_auth_service)) -> ActionResult:
    actor = db.get(UserAccount, principal.user_id)
    try:
        user, delivery, created = service.invite_administrator(
            email=str(payload.email), first_name=payload.first_name, last_name=payload.last_name, invited_by=actor,
        )
    except AuthError as exc:
        _raise(exc)
    record_audit(db, principal, "administrator.invited", "user_account", str(user.id),
                 {"email": user.email, "new_account": created, "delivery": delivery.status})
    db.commit()
    return ActionResult(row=_row(db, user, principal, runtime),
                        delivery=DeliveryOut(kind=delivery.kind, status=delivery.status, detail=delivery.detail))


@router.post("/{user_id}/resend", response_model=ActionResult)
def resend_invitation(user_id: UUID, principal: CurrentPrincipal = Depends(require_admin),
                      db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
                      service: AuthService = Depends(get_auth_service)) -> ActionResult:
    user = _target(db, user_id)
    actor = db.get(UserAccount, principal.user_id)
    try:
        delivery = service.resend_admin_invitation(user, actor)
    except AuthError as exc:
        _raise(exc)
    record_audit(db, principal, "administrator.invitation_resent", "user_account", str(user.id),
                 {"email": user.email, "delivery": delivery.status})
    db.commit()
    return ActionResult(row=_row(db, user, principal, runtime),
                        delivery=DeliveryOut(kind=delivery.kind, status=delivery.status, detail=delivery.detail))


@router.post("/{user_id}/revoke-invitation", response_model=ActionResult)
def revoke_invitation(user_id: UUID, principal: CurrentPrincipal = Depends(require_admin),
                      db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
                      service: AuthService = Depends(get_auth_service)) -> ActionResult:
    user = _target(db, user_id)
    if user.id == principal.user_id:
        raise HTTPException(status_code=409, detail="You cannot withdraw your own access.")
    try:
        service.revoke_admin_invitation(user)
    except AuthError as exc:
        _raise(exc)
    record_audit(db, principal, "administrator.invitation_revoked", "user_account", str(user.id), {"email": user.email})
    db.commit()
    return ActionResult(row=_row(db, user, principal, runtime))


@router.post("/{user_id}/deactivate", response_model=ActionResult)
def deactivate_administrator(user_id: UUID, principal: CurrentPrincipal = Depends(require_admin),
                             db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
                             service: AuthService = Depends(get_auth_service)) -> ActionResult:
    user = _target(db, user_id)
    if user.id == principal.user_id:
        raise HTTPException(status_code=409, detail="You cannot deactivate your own account.")
    if _other_active_admins(db, user) == 0:
        raise HTTPException(status_code=409, detail="This is the last active administrator. Invite another one first.")
    service.set_account_active(user, active=False)
    record_audit(db, principal, "administrator.deactivated", "user_account", str(user.id), {"email": user.email})
    db.commit()
    return ActionResult(row=_row(db, user, principal, runtime))


@router.post("/{user_id}/reactivate", response_model=ActionResult)
def reactivate_administrator(user_id: UUID, principal: CurrentPrincipal = Depends(require_admin),
                             db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
                             service: AuthService = Depends(get_auth_service)) -> ActionResult:
    user = _target(db, user_id)
    service.set_account_active(user, active=True)
    record_audit(db, principal, "administrator.reactivated", "user_account", str(user.id), {"email": user.email})
    db.commit()
    return ActionResult(row=_row(db, user, principal, runtime))
