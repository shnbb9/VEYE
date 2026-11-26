from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.auth.schemas import EmailAddress

Kind = Literal["contact_us", "help_question", "join_beta"]
Status = Literal["new", "in_progress", "resolved"]
Priority = Literal["high", "medium", "low"]
# Has a person answered? Separate from Status: "in progress" says nothing about it.
ReplyState = Literal["waiting", "failed", "replied", "resolved"]


class PublicRequestIn(BaseModel):
    """A visitor's Contact Us message or Help question (no account needed)."""
    kind: Literal["contact_us", "help_question"]
    name: str = Field(default="", max_length=160)
    email: EmailAddress | None = None
    subject: str = Field(default="", max_length=200)
    message: str = Field(min_length=3, max_length=4000)
    page: str | None = Field(default=None, max_length=200)


class MemberRequestIn(BaseModel):
    """A signed-in member's request; name and email come from the account."""
    kind: Kind
    subject: str = Field(default="", max_length=200)
    message: str = Field(default="", max_length=4000)
    page: str | None = Field(default=None, max_length=200)


class RequestReplyOut(BaseModel):
    """An answer the console sent. `delivery_status` is kept so a reply that
    never left is visible as such rather than assumed delivered."""

    id: UUID
    body: str
    to_email: str
    sent_by_name: str
    delivery_status: str
    delivery_detail: str | None
    created_at: datetime


class TeamNoticeOut(BaseModel):
    """The email that told the team this request arrived: where it went and
    whether it left. The console's record only; a member never sees it."""

    status: str           # queued | sending | retry | sent | failed
    to_email: str
    sent_at: datetime | None
    detail: str | None


class MemberReplyOut(BaseModel):
    """What the member sees of an answer: the words, and when they were sent.
    Not the administrator who typed it, not the address it went to, and never
    the delivery diagnostics — those are the console's record."""

    id: UUID
    body: str
    created_at: datetime


class MemberRequestOut(BaseModel):
    """A member's own view of a request they sent.

    Deliberately narrower than the console's RequestOut below: the internal
    note and the administrator who handled it belong to the console, so they
    are not on the wire to the member at all."""

    id: UUID
    kind: Kind
    kind_label: str
    status: Status
    status_label: str
    source: str
    name: str
    email: str
    subject: str
    message: str
    created_at: datetime
    updated_at: datetime
    replies: list[MemberReplyOut] = []


class RequestOut(BaseModel):
    id: UUID
    kind: Kind
    kind_label: str
    status: Status
    status_label: str
    source: str
    member_id: UUID | None
    name: str
    email: str
    subject: str
    message: str
    page: str | None
    created_at: datetime
    updated_at: datetime
    handled_by: str | None
    handled_at: datetime | None
    resolution_note: str
    priority: Priority | None = None
    reply_state: ReplyState = "waiting"
    replies: list[RequestReplyOut] = []
    # None for requests that came in before the team was emailed about them.
    team_notice: TeamNoticeOut | None = None


class RequestsPage(BaseModel):
    rows: list[RequestOut]
    total: int
    page: int
    page_size: int
    counts: dict[str, int]  # new / in_progress / resolved / total


class RequestStatusIn(BaseModel):
    status: Status
    resolution_note: str = Field(default="", max_length=4000)


class PriorityIn(BaseModel):
    """null takes the label off again."""
    priority: Priority | None


class SubmittedOut(BaseModel):
    id: UUID
    kind: Kind
    status: Status
    created_at: datetime
    already_open: bool = False


class RequestReplyIn(BaseModel):
    body: str = Field(min_length=2, max_length=4000)
    # Optional, and the console always sends one. A retried POST or a
    # double-clicked button must not put a second reply in front of a member
    # or a second message in their inbox.
    idempotency_key: str | None = Field(default=None, max_length=128)
