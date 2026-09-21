"""Content administration (admin) and the published read (public, cached by
the web layer). A pragmatic area for the copy Veye needs now — not a CMS."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.principal import CurrentPrincipal, require_admin
from app.content.models import GROUP_LABELS, GROUPS, STATUS_ARCHIVED, STATUS_DRAFT, STATUS_PUBLISHED, STATUSES, ContentEntry
from app.db.session import get_db

admin_router = APIRouter(prefix="/api/v1/admin/content", tags=["admin-content"], dependencies=[Depends(require_admin)])
public_router = APIRouter(prefix="/api/v1/content", tags=["content"])

Group = Literal["help_faq", "member_copy"]
_KEY = re.compile(r"^[a-z0-9_]{2,80}$")


class ContentEntryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group: Group
    key: str = Field(min_length=2, max_length=80, pattern=_KEY.pattern)
    category: str | None = Field(default=None, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=20000)
    display_order: int = Field(default=0, ge=0, le=10000)


class ContentEntryOut(BaseModel):
    id: UUID
    group: str
    group_label: str
    key: str
    category: str | None
    title: str
    body: str
    display_order: int
    status: str
    source: str | None
    updated_at: datetime
    updated_by: str | None
    published_at: datetime | None
    published_by: str | None


class ContentGroupSummary(BaseModel):
    group: str
    label: str
    total: int
    published: int
    draft: int
    archived: int


class PublishedEntry(BaseModel):
    key: str
    category: str | None
    title: str
    body: str
    display_order: int


def entry_out(entry: ContentEntry) -> ContentEntryOut:
    return ContentEntryOut(
        id=entry.id, group=entry.group, group_label=GROUP_LABELS.get(entry.group, entry.group), key=entry.key,
        category=entry.category, title=entry.title, body=entry.body, display_order=entry.display_order, status=entry.status,
        source=entry.source, updated_at=entry.updated_at, updated_by=entry.updated_by, published_at=entry.published_at,
        published_by=entry.published_by,
    )


def _get(db: Session, entry_id: UUID) -> ContentEntry:
    entry = db.get(ContentEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="That content entry does not exist.")
    return entry


@admin_router.get("/summary", response_model=list[ContentGroupSummary])
def summary(db: Session = Depends(get_db)) -> list[ContentGroupSummary]:
    rows = db.query(ContentEntry).all()
    return [ContentGroupSummary(
        group=group, label=GROUP_LABELS[group], total=sum(1 for r in rows if r.group == group),
        published=sum(1 for r in rows if r.group == group and r.status == STATUS_PUBLISHED),
        draft=sum(1 for r in rows if r.group == group and r.status == STATUS_DRAFT),
        archived=sum(1 for r in rows if r.group == group and r.status == STATUS_ARCHIVED),
    ) for group in GROUPS]


@admin_router.get("/entries", response_model=list[ContentEntryOut])
def list_entries(group: str | None = Query(default=None), status: str | None = Query(default=None),
                 db: Session = Depends(get_db)) -> list[ContentEntryOut]:
    if group is not None and group not in GROUPS:
        raise HTTPException(status_code=422, detail="Unknown content group.")
    if status is not None and status not in STATUSES:
        raise HTTPException(status_code=422, detail="Unknown status.")
    query = db.query(ContentEntry)
    if group:
        query = query.filter(ContentEntry.group == group)
    if status:
        query = query.filter(ContentEntry.status == status)
    return [entry_out(e) for e in query.order_by(ContentEntry.group, ContentEntry.display_order, ContentEntry.title).all()]


@admin_router.post("/entries", response_model=ContentEntryOut, status_code=201)
def create_entry(payload: ContentEntryIn, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> ContentEntryOut:
    exists = db.query(ContentEntry).filter(ContentEntry.group == payload.group, ContentEntry.key == payload.key).one_or_none()
    if exists is not None:
        raise HTTPException(status_code=409, detail="An entry with this key already exists in that group.")
    entry = ContentEntry(**payload.model_dump(), status=STATUS_DRAFT, updated_by=principal.display_name, source="Admin console")
    db.add(entry)
    db.flush()
    record_audit(db, principal, "content.create", "content_entry", str(entry.id), {"group": entry.group, "key": entry.key})
    db.commit()
    return entry_out(entry)


@admin_router.put("/entries/{entry_id}", response_model=ContentEntryOut)
def update_entry(entry_id: UUID, payload: ContentEntryIn, principal: CurrentPrincipal = Depends(require_admin),
                 db: Session = Depends(get_db)) -> ContentEntryOut:
    entry = _get(db, entry_id)
    if entry.status == STATUS_ARCHIVED:
        raise HTTPException(status_code=409, detail="Archived content is read-only. Restore it to a draft first.")
    clash = db.query(ContentEntry).filter(ContentEntry.group == payload.group, ContentEntry.key == payload.key,
                                         ContentEntry.id != entry.id).one_or_none()
    if clash is not None:
        raise HTTPException(status_code=409, detail="An entry with this key already exists in that group.")
    for key, value in payload.model_dump().items():
        setattr(entry, key, value)
    entry.updated_by = principal.display_name
    entry.updated_at = datetime.now(timezone.utc)
    db.flush()
    record_audit(db, principal, "content.update", "content_entry", str(entry.id), {"group": entry.group, "key": entry.key})
    db.commit()
    return entry_out(entry)


def _transition(entry: ContentEntry, action: str, by: str) -> None:
    if action == "publish":
        if entry.status == STATUS_ARCHIVED:
            raise HTTPException(status_code=409, detail="Archived content cannot be published. Restore it first.")
        entry.status = STATUS_PUBLISHED
        entry.published_at = datetime.now(timezone.utc)
        entry.published_by = by
    elif action == "unpublish":
        if entry.status != STATUS_PUBLISHED:
            raise HTTPException(status_code=409, detail="Only published content can be taken back to draft.")
        entry.status = STATUS_DRAFT
    elif action == "archive":
        entry.status = STATUS_ARCHIVED
    elif action == "restore":
        if entry.status != STATUS_ARCHIVED:
            raise HTTPException(status_code=409, detail="Only archived content can be restored.")
        entry.status = STATUS_DRAFT
    entry.updated_by = by


def _make(action: str):
    def handler(entry_id: UUID, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> ContentEntryOut:
        entry = _get(db, entry_id)
        _transition(entry, action, principal.display_name)
        db.flush()
        record_audit(db, principal, f"content.{action}", "content_entry", str(entry.id), {"group": entry.group, "key": entry.key, "status": entry.status})
        db.commit()
        return entry_out(entry)

    handler.__name__ = f"{action}_entry"
    return handler


for _action in ("publish", "unpublish", "archive", "restore"):
    admin_router.add_api_route(f"/entries/{{entry_id}}/{_action}", _make(_action), methods=["POST"], response_model=ContentEntryOut)


@public_router.get("/{group}", response_model=list[PublishedEntry])
def published(group: str, db: Session = Depends(get_db)) -> list[PublishedEntry]:
    """Published entries of a group. Public: the Help page is public."""
    if group not in GROUPS:
        raise HTTPException(status_code=404, detail="Unknown content group.")
    rows = (db.query(ContentEntry).filter(ContentEntry.group == group, ContentEntry.status == STATUS_PUBLISHED)
            .order_by(ContentEntry.display_order, ContentEntry.title).all())
    return [PublishedEntry(key=r.key, category=r.category, title=r.title, body=r.body, display_order=r.display_order) for r in rows]
