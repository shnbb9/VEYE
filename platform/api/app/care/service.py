"""Care Studio service: lifecycle and the member-facing read."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.care.models import KINDS, STATUS_ARCHIVED, STATUS_DRAFT, STATUS_PUBLISHED, CareContentItem
from app.care.schemas import CareItemIn, CareItemOut, MemberCareItem

KIND_LABELS = {"fitness": "Fitness", "supplement": "Supplements", "resource": "Resources"}

_YT_ID = re.compile(r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{6,})")


class CareError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def youtube_embed_url(url: str | None) -> str | None:
    """Privacy-enhanced embed for an approved YouTube address (the approved
    member Fitness screen embeds via youtube-nocookie.com)."""
    if not url:
        return None
    match = _YT_ID.search(url)
    return f"https://www.youtube-nocookie.com/embed/{match.group(1)}" if match else None


def item_out(item: CareContentItem) -> CareItemOut:
    return CareItemOut(
        id=item.id, kind=item.kind, title=item.title, description=item.description, category=item.category,
        content_type=item.content_type, youtube_url=item.youtube_url, youtube_embed_url=youtube_embed_url(item.youtube_url),
        external_url=item.external_url, video_object_key=item.video_object_key, body=item.body, cautions=item.cautions,
        references=item.references, display_order=item.display_order, status=item.status, source=item.source,
        created_at=item.created_at, updated_at=item.updated_at, updated_by=item.updated_by,
        published_at=item.published_at, published_by=item.published_by,
    )


def member_item(item: CareContentItem) -> MemberCareItem:
    return MemberCareItem(
        id=item.id, kind=item.kind, title=item.title, description=item.description, category=item.category,
        content_type=item.content_type, youtube_embed_url=youtube_embed_url(item.youtube_url), external_url=item.external_url,
        body=item.body, cautions=item.cautions, references=item.references, display_order=item.display_order,
    )


class CareService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---- reads --------------------------------------------------------------------------
    def list_items(self, kind: str | None = None, status: str | None = None) -> list[CareContentItem]:
        query = self.db.query(CareContentItem)
        if kind:
            query = query.filter(CareContentItem.kind == kind)
        if status:
            query = query.filter(CareContentItem.status == status)
        return query.order_by(CareContentItem.kind, CareContentItem.display_order, CareContentItem.created_at).all()

    def published(self, kind: str) -> list[CareContentItem]:
        if kind not in KINDS:
            raise CareError(404, "Unknown content area.")
        return self.list_items(kind=kind, status=STATUS_PUBLISHED)

    def get(self, item_id: UUID) -> CareContentItem:
        item = self.db.get(CareContentItem, item_id)
        if item is None:
            raise CareError(404, "That content item does not exist.")
        return item

    # ---- writes --------------------------------------------------------------------------
    def create(self, data: CareItemIn, *, by: str) -> CareContentItem:
        item = CareContentItem(**data.model_dump(), status=STATUS_DRAFT, updated_by=by, source="Admin console")
        self.db.add(item)
        self.db.flush()
        return item

    def update(self, item_id: UUID, data: CareItemIn, *, by: str) -> CareContentItem:
        item = self.get(item_id)
        if item.status == STATUS_ARCHIVED:
            raise CareError(409, "Archived content is read-only. Restore it to a draft first.")
        for key, value in data.model_dump().items():
            setattr(item, key, value)
        item.updated_by = by
        item.updated_at = datetime.now(timezone.utc)
        self.db.flush()
        return item

    def publish(self, item_id: UUID, *, by: str) -> CareContentItem:
        item = self.get(item_id)
        if item.status == STATUS_ARCHIVED:
            raise CareError(409, "Archived content cannot be published. Restore it to a draft first.")
        item.status = STATUS_PUBLISHED
        item.published_at = datetime.now(timezone.utc)
        item.published_by = by
        item.updated_by = by
        self.db.flush()
        return item

    def unpublish(self, item_id: UUID, *, by: str) -> CareContentItem:
        item = self.get(item_id)
        if item.status != STATUS_PUBLISHED:
            raise CareError(409, "Only published content can be taken back to draft.")
        item.status = STATUS_DRAFT
        item.updated_by = by
        self.db.flush()
        return item

    def archive(self, item_id: UUID, *, by: str) -> CareContentItem:
        item = self.get(item_id)
        item.status = STATUS_ARCHIVED
        item.updated_by = by
        self.db.flush()
        return item

    def restore(self, item_id: UUID, *, by: str) -> CareContentItem:
        item = self.get(item_id)
        if item.status != STATUS_ARCHIVED:
            raise CareError(409, "Only archived content can be restored.")
        item.status = STATUS_DRAFT
        item.updated_by = by
        self.db.flush()
        return item
