from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SourceOut(BaseModel):
    source_id: str
    document_id: str
    chunk_id: str
    source_version: int
    score: float
    title: str


class FeedbackOut(BaseModel):
    rating: str
    reason: str | None = None
    comment: str | None = None
    submitted_at: datetime


class MessageOut(BaseModel):
    id: UUID
    role: str
    content: str
    outcome: str | None
    sources: list[SourceOut] = []
    feedback: FeedbackOut | None = None
    created_at: datetime


class ConversationOut(BaseModel):
    id: UUID
    started_at: datetime
    message_count: int
    flagged: bool
    messages: list[MessageOut]


class QuickPromptOut(BaseModel):
    id: str
    label: str
    prompt: str


class CompanionSessionOut(BaseModel):
    enabled: bool
    name: str
    welcome: str
    quick_prompts: list[QuickPromptOut]
    conversation: ConversationOut
    provider: str
    model: str | None


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=500)
    conversation_id: UUID | None = None


class AskResponse(BaseModel):
    conversation_id: UUID
    member_message_id: UUID
    reply_message_id: UUID
    reply: str
    outcome: str
    policy_outcome: str
    policy_category: str | None
    sources: list[SourceOut]
    context_scopes: list[str]
    provider: str | None
    model: str | None
    safety_result: str | None
    trace_id: str | None
    personalized: bool


class FeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: str = Field(pattern="^(helpful|not_helpful)$")
    reason: str | None = Field(default=None, max_length=48)
    comment: str | None = Field(default=None, max_length=1000)
