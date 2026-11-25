"""Home → "Needs your attention": what is waiting for a person, in one list
(Cara's 15 Nov request; V4 §5). It owns nothing: every row is a message in
Requests & Inbox or a conversation Sprout handed over, opened where it lives.

The states are facts about the record, kept apart on purpose:

  reply_needed    a message nobody has answered;
  reply_failed    it was answered, and the answer never left;
  review_needed   Sprout handed a conversation over and nobody has read it;
  replied         answered, not yet marked resolved;
  reviewed        read by somebody — which answers nobody — and not resolved;
  resolved        nothing is left to do.

Importance is a label a person put on. The order is importance, then the
oldest first; nothing is ranked by a model, and none of it is medical triage.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.auth.models import UserAccount
from app.auth.principal import require_admin
from app.companion.models import CompanionConversation
from app.db.session import get_db
from app.members.models import Member
from app.requests.models import KIND_LABELS, MemberRequest
from app.requests.service import reply_state

router = APIRouter(prefix="/api/v1/admin/attention", tags=["admin-attention"], dependencies=[Depends(require_admin)])

State = Literal["reply_needed", "reply_failed", "review_needed", "replied", "reviewed", "resolved"]
WAITING = ("reply_needed", "reply_failed", "review_needed")
STATES = (*WAITING, "replied", "reviewed", "resolved")
_FROM_REPLY = {"waiting": "reply_needed", "failed": "reply_failed", "replied": "replied", "resolved": "resolved"}
_RANK = {"high": 0, "medium": 1, None: 2, "low": 3}


class AttentionItem(BaseModel):
    source: Literal["request", "conversation"]
    id: UUID
    state: State
    title: str
    detail: str
    person: str
    person_kind: Literal["member", "visitor", "former"]
    member_id: UUID | None
    priority: Literal["high", "medium", "low"] | None
    at: datetime


class AttentionOut(BaseModel):
    rows: list[AttentionItem]
    total: int
    page: int
    page_size: int
    counts: dict[str, int]      # every state, plus "waiting"


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def items(db: Session) -> list[AttentionItem]:
    people = {user.member_id: user.display_name for user in
              db.query(UserAccount).filter(UserAccount.member_id.is_not(None)).all()}
    # Archived members and members being erased are not "active members"
    # waiting for anything; what they wrote stays in its own place.
    gone = {mid for (mid,) in db.query(Member.id).filter(
        (Member.archived_at.is_not(None)) | (Member.erasure_requested_at.is_not(None))).all()}
    out: list[AttentionItem] = []
    for row in db.query(MemberRequest).options(selectinload(MemberRequest.replies)).all():
        if row.member_id in gone:
            continue
        person_kind = "member" if row.member_id in people else "former" if row.source == "member" else "visitor"
        out.append(AttentionItem(
            source="request", id=row.id, state=_FROM_REPLY[reply_state(row)], title=row.subject or KIND_LABELS.get(row.kind, "Message"),
            detail=" · ".join(part for part in (KIND_LABELS.get(row.kind, row.kind), " ".join(row.message.split())[:120]) if part),
            person=row.name or people.get(row.member_id) or row.email or "Visitor", person_kind=person_kind,
            member_id=row.member_id if row.member_id in people else None, priority=row.priority, at=_aware(row.created_at)))
    for row in db.query(CompanionConversation).filter(CompanionConversation.flagged.is_(True)).all():
        if row.member_id in gone:
            continue
        state = "resolved" if row.resolved_at else "reviewed" if row.reviewed_at else "review_needed"
        out.append(AttentionItem(
            source="conversation", id=row.id, state=state, title="Sprout handed a question to a person",
            detail=row.flag_reason or "", person=people.get(row.member_id, "Member"),
            person_kind="member" if row.member_id in people else "former",
            member_id=row.member_id if row.member_id in people else None, priority=row.priority, at=_aware(row.last_message_at)))
    return out


@router.get("", response_model=AttentionOut)
def attention(
    state: Literal["waiting", "reply_needed", "reply_failed", "review_needed", "replied", "reviewed", "resolved", "all"] = Query(default="waiting"),
    who: Literal["any", "member", "visitor"] = Query(default="any"),
    priority: Literal["any", "high", "medium", "low", "unassigned"] = Query(default="any"),
    page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
) -> AttentionOut:
    rows = items(db)
    if who != "any":
        rows = [r for r in rows if r.person_kind == who]
    if priority != "any":
        rows = [r for r in rows if r.priority == (None if priority == "unassigned" else priority)]
    counts = {key: sum(1 for r in rows if r.state == key) for key in STATES}
    counts["waiting"] = sum(counts[key] for key in WAITING)
    if state == "waiting":
        rows = [r for r in rows if r.state in WAITING]
    elif state != "all":
        rows = [r for r in rows if r.state == state]
    rows.sort(key=lambda r: (_RANK[r.priority], r.at, str(r.id)))
    start = (page - 1) * page_size
    return AttentionOut(rows=rows[start:start + page_size], total=len(rows), page=page, page_size=page_size, counts=counts)
