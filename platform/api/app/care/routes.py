"""Care Studio: admin lifecycle routes and the member read of published content."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.principal import CurrentPrincipal, require_admin, require_member
from app.care.models import KINDS, STATUSES
from app.care.schemas import CareItemIn, CareItemOut, CareKindSummary, MemberCareItem
from app.care.service import KIND_LABELS, CareError, CareService, item_out, member_item
from app.db.session import get_db

admin_router = APIRouter(prefix="/api/v1/admin/care", tags=["admin-care"], dependencies=[Depends(require_admin)])
member_router = APIRouter(prefix="/api/v1/care", tags=["care"])


def _raise(exc: CareError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@admin_router.get("/summary", response_model=list[CareKindSummary])
def summary(db: Session = Depends(get_db)) -> list[CareKindSummary]:
    items = CareService(db).list_items()
    out = []
    for kind in KINDS:
        mine = [i for i in items if i.kind == kind]
        out.append(CareKindSummary(
            kind=kind, label=KIND_LABELS[kind], total=len(mine),
            published=sum(1 for i in mine if i.status == "Published"),
            draft=sum(1 for i in mine if i.status == "Draft"),
            archived=sum(1 for i in mine if i.status == "Archived"),
        ))
    return out


@admin_router.get("/items", response_model=list[CareItemOut])
def list_items(kind: str | None = Query(default=None), status: str | None = Query(default=None),
               db: Session = Depends(get_db)) -> list[CareItemOut]:
    if kind is not None and kind not in KINDS:
        raise HTTPException(status_code=422, detail="Unknown content area.")
    if status is not None and status not in STATUSES:
        raise HTTPException(status_code=422, detail="Unknown status.")
    return [item_out(i) for i in CareService(db).list_items(kind=kind, status=status)]


@admin_router.post("/items", response_model=CareItemOut, status_code=201)
def create_item(payload: CareItemIn, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> CareItemOut:
    item = CareService(db).create(payload, by=principal.display_name)
    record_audit(db, principal, "care.create", "care_content_item", str(item.id), {"kind": item.kind, "title": item.title})
    db.commit()
    return item_out(item)


@admin_router.get("/items/{item_id}", response_model=CareItemOut)
def get_item(item_id: UUID, db: Session = Depends(get_db)) -> CareItemOut:
    try:
        return item_out(CareService(db).get(item_id))
    except CareError as exc:
        _raise(exc)


@admin_router.put("/items/{item_id}", response_model=CareItemOut)
def update_item(item_id: UUID, payload: CareItemIn, principal: CurrentPrincipal = Depends(require_admin),
                db: Session = Depends(get_db)) -> CareItemOut:
    try:
        item = CareService(db).update(item_id, payload, by=principal.display_name)
    except CareError as exc:
        _raise(exc)
    record_audit(db, principal, "care.update", "care_content_item", str(item.id), {"kind": item.kind, "title": item.title})
    db.commit()
    return item_out(item)


def _transition(action: str):
    def handler(item_id: UUID, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> CareItemOut:
        service = CareService(db)
        try:
            item = getattr(service, action)(item_id, by=principal.display_name)
        except CareError as exc:
            _raise(exc)
        record_audit(db, principal, f"care.{action}", "care_content_item", str(item.id), {"kind": item.kind, "title": item.title, "status": item.status})
        db.commit()
        return item_out(item)

    handler.__name__ = f"{action}_item"
    return handler


for _action in ("publish", "unpublish", "archive", "restore"):
    admin_router.add_api_route(f"/items/{{item_id}}/{_action}", _transition(_action), methods=["POST"], response_model=CareItemOut)


@member_router.get("/{kind}", response_model=list[MemberCareItem])
def published_for_members(kind: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> list[MemberCareItem]:
    try:
        return [member_item(i) for i in CareService(db).published(kind)]
    except CareError as exc:
        _raise(exc)
