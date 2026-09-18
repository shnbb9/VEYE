from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.companion.schemas import AskResponse


class ChoiceOut(BaseModel):
    key: str
    label: str


class NodeOut(BaseModel):
    id: str
    type: str
    section: str | None = None
    text: str
    copy_origin: str = "client"
    choices: list[ChoiceOut] = []
    answer_label: str | None = None
    task: str | None = None


class ActionOut(BaseModel):
    """A UI action the frontend maps to one of its own routes. Never a URL."""
    type: str
    target: str | None = None


class StepOut(BaseModel):
    session_id: UUID
    flow_key: str
    flow_title: str
    flow_version: int
    status: str
    messages: list[str]
    node: NodeOut | None
    actions: list[ActionOut]
    clarification: str | None = None
    section_title: str
    steps_taken: int
    content_meta: dict


class SessionSummaryOut(BaseModel):
    id: str
    status: str
    flow_version: int
    current_node: str
    section_title: str
    steps_taken: int
    started_at: str
    updated_at: str
    completed_at: str | None


class FlowSummaryOut(BaseModel):
    key: str
    title: str
    version: int
    description: str
    session: SessionSummaryOut | None


class OverviewOut(BaseModel):
    flows: list[FlowSummaryOut]
    first_arrival_offer: bool


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    choice: str | None = Field(default=None, max_length=64)
    text: str | None = Field(default=None, max_length=500)


class AskInFlowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=500)


class AskInFlowResponse(BaseModel):
    reply: AskResponse
    step: StepOut


# ---- admin ----------------------------------------------------------------------------------
class AdminFlowVersionOut(BaseModel):
    id: UUID
    key: str
    title: str
    version: int
    status: str
    source: str | None
    content_meta: dict
    node_count: int
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None
    published_by: str | None
    sessions_total: int
    sessions_in_progress: int
    sessions_completed: int


class AdminFlowGroupOut(BaseModel):
    key: str
    title: str
    active_version: int | None
    versions: list[AdminFlowVersionOut]


class AdminEdgeOut(BaseModel):
    from_node: str
    via: str | None
    to_node: str


class AdminFlowDetailOut(BaseModel):
    flow: AdminFlowVersionOut
    definition: dict
    edges: list[AdminEdgeOut]
    validation: str  # "valid" or the problem list
