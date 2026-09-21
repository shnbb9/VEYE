from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.auth.schemas import EmailAddress

Kind = Literal["contact_us", "help_question", "join_beta"]
Status = Literal["new", "in_progress", "resolved"]


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


class RequestsPage(BaseModel):
    rows: list[RequestOut]
    total: int
    page: int
    page_size: int
    counts: dict[str, int]  # new / in_progress / resolved / total


class RequestStatusIn(BaseModel):
    status: Status
    resolution_note: str = Field(default="", max_length=4000)


class SubmittedOut(BaseModel):
    id: UUID
    kind: Kind
    status: Status
    created_at: datetime
    already_open: bool = False
