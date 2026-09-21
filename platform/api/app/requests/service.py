"""Requests & Inbox service: create from the public site or a member, list
and filter for the console, move through New → In progress → Resolved."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.models import UserAccount
from app.requests.models import (
    KIND_BETA,
    KIND_LABELS,
    KINDS,
    SOURCE_MEMBER,
    SOURCE_PUBLIC,
    STATUS_IN_PROGRESS,
    STATUS_LABELS,
    STATUS_NEW,
    STATUS_RESOLVED,
    STATUSES,
    MemberRequest,
)
from app.requests.schemas import MemberRequestIn, PublicRequestIn, RequestOut


class RequestError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def request_out(row: MemberRequest) -> RequestOut:
    return RequestOut(
        id=row.id, kind=row.kind, kind_label=KIND_LABELS.get(row.kind, row.kind), status=row.status,
        status_label=STATUS_LABELS.get(row.status, row.status), source=row.source, member_id=row.member_id,
        name=row.name, email=row.email, subject=row.subject, message=row.message, page=row.page,
        created_at=row.created_at, updated_at=row.updated_at, handled_by=row.handled_by, handled_at=row.handled_at,
        resolution_note=row.resolution_note or "",
    )


class RequestService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---- creation ------------------------------------------------------------
    def create_public(self, data: PublicRequestIn) -> MemberRequest:
        row = MemberRequest(
            kind=data.kind, status=STATUS_NEW, source=SOURCE_PUBLIC, name=data.name.strip(),
            email=(str(data.email).strip().lower() if data.email else ""), subject=data.subject.strip(),
            message=data.message.strip(), page=data.page,
        )
        self.db.add(row)
        self.db.flush()
        return row

    def create_for_member(self, user: UserAccount, data: MemberRequestIn) -> tuple[MemberRequest, bool]:
        """Returns (request, already_open). A member holds at most one open
        Join Beta request; asking again returns the open one unchanged."""
        if data.kind not in KINDS:
            raise RequestError(422, "Unknown request kind.")
        if data.kind != KIND_BETA and len(data.message.strip()) < 3:
            raise RequestError(422, "Please write a short message.")
        if data.kind == KIND_BETA:
            existing = (self.db.query(MemberRequest)
                        .filter(MemberRequest.member_id == user.member_id, MemberRequest.kind == KIND_BETA,
                                MemberRequest.status != STATUS_RESOLVED)
                        .order_by(MemberRequest.created_at.desc()).first())
            if existing is not None:
                return existing, True
        row = MemberRequest(
            kind=data.kind, status=STATUS_NEW, source=SOURCE_MEMBER, member_id=user.member_id,
            name=user.display_name, email=user.email, subject=data.subject.strip() or self._default_subject(data.kind),
            message=data.message.strip(), page=data.page,
        )
        self.db.add(row)
        self.db.flush()
        return row, False

    @staticmethod
    def _default_subject(kind: str) -> str:
        return {KIND_BETA: "Beta application"}.get(kind, KIND_LABELS.get(kind, "Request"))

    # ---- member's own ------------------------------------------------------------
    def list_for_member(self, member_id: UUID) -> list[MemberRequest]:
        return (self.db.query(MemberRequest).filter(MemberRequest.member_id == member_id)
                .order_by(MemberRequest.created_at.desc()).all())

    # ---- console -------------------------------------------------------------------
    def counts(self) -> dict[str, int]:
        rows = self.db.query(MemberRequest.status, func.count(MemberRequest.id)).group_by(MemberRequest.status).all()
        counts = {status: 0 for status in STATUSES}
        for status, count in rows:
            counts[status] = count
        counts["total"] = sum(counts[status] for status in STATUSES)
        counts["open"] = counts[STATUS_NEW] + counts[STATUS_IN_PROGRESS]
        return counts

    def list_for_console(self, *, view: str = "open", kind: str | None = None, q: str = "",
                         page: int = 1, page_size: int = 25) -> tuple[list[MemberRequest], int]:
        query = self.db.query(MemberRequest)
        if view == "open":
            query = query.filter(MemberRequest.status != STATUS_RESOLVED)
        elif view == "resolved":
            query = query.filter(MemberRequest.status == STATUS_RESOLVED)
        elif view in STATUSES:
            query = query.filter(MemberRequest.status == view)
        if kind:
            if kind not in KINDS:
                raise RequestError(422, "Unknown request kind.")
            query = query.filter(MemberRequest.kind == kind)
        needle = q.strip().lower()
        if needle:
            like = f"%{needle}%"
            query = query.filter(func.lower(MemberRequest.name).like(like) | func.lower(MemberRequest.email).like(like)
                                 | func.lower(MemberRequest.subject).like(like) | func.lower(MemberRequest.message).like(like))
        total = query.count()
        rows = query.order_by(MemberRequest.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
        return rows, total

    def get(self, request_id: UUID) -> MemberRequest:
        row = self.db.get(MemberRequest, request_id)
        if row is None:
            raise RequestError(404, "That request was not found.")
        return row

    def set_status(self, request_id: UUID, status: str, *, by: str, note: str = "") -> MemberRequest:
        if status not in STATUSES:
            raise RequestError(422, "Unknown status.")
        row = self.get(request_id)
        row.status = status
        row.handled_by = by
        row.handled_at = datetime.now(timezone.utc)
        if note.strip():
            row.resolution_note = note.strip()
        if status == STATUS_NEW:
            # Reopened: the previous handling stays in the note; the assignment is cleared.
            row.handled_by = None
            row.handled_at = None
        self.db.flush()
        return row
