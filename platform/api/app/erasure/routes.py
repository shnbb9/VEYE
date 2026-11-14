"""Deleting a member profile: the member's routes, a status check that needs
no session, and the console's oversight list.

The console can see that deletions happened and retry one that stopped on an
error. It cannot start one for a member, cannot stop one, and sees ids and
states only — never what was deleted.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.dependencies import clear_session_cookie
from app.auth.models import UserAccount
from app.auth.principal import PORTAL_MEMBER, CurrentPrincipal, require_admin, require_member
from app.core.rate_limit import RateLimiter, client_address
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.erasure.models import POLICY_VERSION, STATE_LABELS, STATE_PURGE_BLOCKED, ErasureRequest
from app.erasure.service import CONFIRM_WORD, ErasureError, build_service
from app.policies.service import aware

member_router = APIRouter(prefix="/api/v1/members/me/erasure", tags=["erasure"])
public_router = APIRouter(prefix="/api/v1/erasure-requests", tags=["erasure"])
admin_router = APIRouter(prefix="/api/v1/admin/erasure-requests", tags=["admin-erasure"],
                         dependencies=[Depends(require_admin)])


class PreviewOut(BaseModel):
    scope: str
    removed: list[str]
    kept: list[str]
    counts: dict[str, int]
    confirm_word: str = CONFIRM_WORD
    policy_version: str = POLICY_VERSION
    note: str = ("Deletion starts straight away and cannot be undone. Download your data first if you want a copy. "
                 "Copies inside backups are removed as backups expire, and a deletion is re-applied if a backup is "
                 "ever restored.")


class EraseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=256)
    confirm: str = Field(max_length=20)


class ErasureOut(BaseModel):
    request_id: UUID
    state: str
    state_label: str
    scope: str
    requested_at: datetime
    completed_at: datetime | None
    receipt: dict[str, int] = {}


class ErasureAdminRow(BaseModel):
    request_id: UUID
    subject_user_id: UUID
    subject_member_id: UUID
    scope: str
    state: str
    state_label: str
    requested_at: datetime
    completed_at: datetime | None
    attempts: int
    failure_category: str | None
    stage: str


def _out(request: ErasureRequest, *, with_receipt: bool) -> ErasureOut:
    return ErasureOut(request_id=request.id, state=request.state, state_label=STATE_LABELS.get(request.state, request.state),
                      scope=request.scope, requested_at=aware(request.requested_at), completed_at=aware(request.completed_at),
                      receipt=(request.receipt or {}) if with_receipt else {})


@member_router.get("/preview", response_model=PreviewOut)
def preview(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
            runtime: Runtime = Depends(get_runtime)) -> PreviewOut:
    user = db.get(UserAccount, principal.user_id)
    result = build_service(db, runtime).preview(user)
    return PreviewOut(scope=result.scope, removed=result.removed, kept=result.kept, counts=result.counts)


@member_router.post("", response_model=ErasureOut, status_code=202)
def request_erasure(payload: EraseIn, request: Request, response: Response,
                    principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                    runtime: Runtime = Depends(get_runtime)) -> ErasureOut:
    RateLimiter(db, runtime.settings).enforce("reauthenticate", subject=str(principal.user_id),
                                              address=client_address(request))
    user = db.get(UserAccount, principal.user_id)
    service = build_service(db, runtime)
    try:
        erasure = service.request(user, password=payload.password, confirm=payload.confirm)
    except ErasureError as exc:
        db.commit()  # keep the rate-limit hit
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    # Access is closed already (committed above); the browser's member cookie
    # goes too. A console session in the same browser is untouched.
    clear_session_cookie(response, runtime, PORTAL_MEMBER)
    erasure = service.process(erasure)
    if erasure.receipt_outbox_id:
        service.notifications.dispatch(erasure.receipt_outbox_id)
    return _out(erasure, with_receipt=True)


@public_router.get("/{request_id}", response_model=ErasureOut)
def erasure_status(request_id: UUID, db: Session = Depends(get_db)) -> ErasureOut:
    """For the person whose session has ended: the reference on the screen
    and in the receipt shows where the deletion stands. States and dates
    only — no ids, no counts, nothing about the person."""
    erasure = db.get(ErasureRequest, request_id)
    if erasure is None:
        raise HTTPException(status_code=404, detail="No deletion with that reference.")
    return _out(erasure, with_receipt=False)


def _admin_row(r: ErasureRequest) -> ErasureAdminRow:
    return ErasureAdminRow(request_id=r.id, subject_user_id=r.subject_user_id, subject_member_id=r.subject_member_id,
                           scope=r.scope, state=r.state, state_label=STATE_LABELS.get(r.state, r.state),
                           requested_at=aware(r.requested_at), completed_at=aware(r.completed_at), attempts=r.attempts,
                           failure_category=r.failure_category, stage=r.stage)


@admin_router.get("", response_model=list[ErasureAdminRow])
def list_erasures(db: Session = Depends(get_db)) -> list[ErasureAdminRow]:
    rows = (db.query(ErasureRequest).order_by(ErasureRequest.requested_at.desc(), ErasureRequest.id.desc())
            .limit(200).all())
    return [_admin_row(r) for r in rows]


@admin_router.post("/{request_id}/retry", response_model=ErasureAdminRow)
def retry_erasure(request_id: UUID, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db),
                  runtime: Runtime = Depends(get_runtime)) -> ErasureAdminRow:
    """Resume a deletion that stopped on an error. It can only move a deletion
    forward; nothing here undoes or pauses one."""
    erasure = db.get(ErasureRequest, request_id)
    if erasure is None:
        raise HTTPException(status_code=404, detail="No deletion with that reference.")
    if erasure.state != STATE_PURGE_BLOCKED:
        raise HTTPException(status_code=409, detail="Only a deletion that stopped on an error can be retried.")
    record_audit(db, principal, "erasure.retried", "erasure_request", str(erasure.id), {"stage": erasure.stage})
    db.commit()
    service = build_service(db, runtime)
    erasure = service.process(erasure)
    if erasure.receipt_outbox_id:
        service.notifications.dispatch(erasure.receipt_outbox_id)
    return _admin_row(erasure)
