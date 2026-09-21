"""Requests & Inbox routes.

Public: a visitor sends a Contact Us message or a Help question.
Member: Contact Us / Help question / Join Beta from inside the application,
plus the member's own list (so a card can say "requested on …").
Admin: list with filters, one request, status changes. Nothing is emailed."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.models import UserAccount
from app.auth.principal import CurrentPrincipal, require_admin, require_member
from app.db.session import get_db
from app.requests.models import KINDS
from app.requests.schemas import MemberRequestIn, PublicRequestIn, RequestOut, RequestsPage, RequestStatusIn, SubmittedOut
from app.requests.service import RequestError, RequestService, request_out

public_router = APIRouter(prefix="/api/v1/requests", tags=["requests"])
member_router = APIRouter(prefix="/api/v1/members/me/requests", tags=["requests"])
admin_router = APIRouter(prefix="/api/v1/admin/requests", tags=["admin-requests"], dependencies=[Depends(require_admin)])


def _raise(exc: RequestError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@public_router.post("", response_model=SubmittedOut, status_code=status.HTTP_201_CREATED)
def submit_public(payload: PublicRequestIn, db: Session = Depends(get_db)) -> SubmittedOut:
    row = RequestService(db).create_public(payload)
    db.commit()
    return SubmittedOut(id=row.id, kind=row.kind, status=row.status, created_at=row.created_at)


@member_router.post("", response_model=SubmittedOut, status_code=status.HTTP_201_CREATED)
def submit_member(payload: MemberRequestIn, principal: CurrentPrincipal = Depends(require_member),
                  db: Session = Depends(get_db)) -> SubmittedOut:
    user = db.get(UserAccount, principal.user_id)
    if user is None or user.member_id is None:
        raise HTTPException(status_code=403, detail="This account has no Veye member profile.")
    try:
        row, already_open = RequestService(db).create_for_member(user, payload)
    except RequestError as exc:
        _raise(exc)
    db.commit()
    return SubmittedOut(id=row.id, kind=row.kind, status=row.status, created_at=row.created_at, already_open=already_open)


@member_router.get("", response_model=list[RequestOut])
def my_requests(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> list[RequestOut]:
    assert principal.member_id is not None
    return [request_out(r) for r in RequestService(db).list_for_member(principal.member_id)]


@admin_router.get("", response_model=RequestsPage)
def list_requests(
    view: Literal["open", "all", "resolved", "new", "in_progress"] = Query(default="open"),
    kind: str | None = Query(default=None), q: str = Query(default="", max_length=120),
    page: int = Query(default=1, ge=1), page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> RequestsPage:
    if kind is not None and kind not in KINDS:
        raise HTTPException(status_code=422, detail="Unknown request kind.")
    service = RequestService(db)
    try:
        rows, total = service.list_for_console(view=view, kind=kind, q=q, page=page, page_size=page_size)
    except RequestError as exc:
        _raise(exc)
    return RequestsPage(rows=[request_out(r) for r in rows], total=total, page=page, page_size=page_size, counts=service.counts())


@admin_router.get("/{request_id}", response_model=RequestOut)
def get_request(request_id: UUID, db: Session = Depends(get_db)) -> RequestOut:
    try:
        return request_out(RequestService(db).get(request_id))
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
    return request_out(row)
