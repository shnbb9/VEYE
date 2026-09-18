from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.companion.schemas import MessageOut


# ---- overview ----------------------------------------------------------------------------------
class OverviewOut(BaseModel):
    conversations_total: int
    conversations_needing_review: int
    feedback_total: int
    feedback_unreviewed: int
    knowledge_sources_active: int
    knowledge_sources_total: int
    traces_last_7_days: int
    escalations_last_7_days: int
    llm_provider: str
    llm_model: str | None
    langfuse_status: str


# ---- conversations ---------------------------------------------------------------------------------
class ConversationSummaryOut(BaseModel):
    id: UUID
    member_name: str
    member_email: str
    started_at: datetime
    last_message_at: datetime
    message_count: int
    flagged: bool
    flag_reason: str | None
    reviewed_at: datetime | None
    reviewed_by: str | None
    first_message: str
    feedback_rating: str | None
    outcomes: list[str]


class PolicyDecisionOut(BaseModel):
    id: UUID
    outcome: str
    category: str | None
    matched_rule: str | None
    retrieval_scopes: list[str]
    member_data_scopes: list[str]
    reason: str
    policy_version: str
    created_at: datetime


class AdminMessageOut(MessageOut):
    provider: str | None = None
    model: str | None = None
    latency_ms: int | None = None
    safety_result: str | None = None
    context_scopes: list[str] = []
    trace_id: str | None = None
    policy_decision: PolicyDecisionOut | None = None


class MemberContextCardOut(BaseModel):
    name: str
    email: str
    member_since: datetime
    health_number: str
    email_verified: bool
    is_synthetic: bool


class ConversationDetailOut(BaseModel):
    summary: ConversationSummaryOut
    member: MemberContextCardOut
    messages: list[AdminMessageOut]


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str | None = Field(default=None, max_length=500)


# ---- feedback ---------------------------------------------------------------------------------------
class FeedbackRowOut(BaseModel):
    id: UUID
    conversation_id: UUID
    message_id: UUID
    member_name: str
    rating: str
    reason: str | None
    comment: str | None
    submitted_at: datetime
    reviewed_at: datetime | None
    reviewed_by: str | None
    reply_excerpt: str


# ---- knowledge sources --------------------------------------------------------------------------------
class DocumentOut(BaseModel):
    id: UUID
    source_version: int
    filename: str
    content_type: str
    byte_size: int
    sha256: str
    is_current: bool
    ingestion_status: str
    ingestion_error: str | None
    chunk_count: int
    ingested_at: datetime | None
    created_at: datetime


class KnowledgeSourceOut(BaseModel):
    id: UUID
    title: str
    type: str
    scope_key: str
    scope_label: str
    description: str
    reference_label: str | None
    status: str
    version: int
    approved_by: str | None
    approved_at: datetime | None
    effective_date: date | None
    is_synthetic: bool
    retrievable: bool
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    current_document: DocumentOut | None
    documents: list[DocumentOut] = []
    storage: str


class KnowledgeSourceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    type: str
    scope_key: str
    description: str = Field(default="", max_length=2000)
    reference_label: str | None = Field(default=None, max_length=240)
    effective_date: date | None = None


class KnowledgeOptionsOut(BaseModel):
    types: list[str]
    scopes: dict[str, str]
    statuses: list[str]


# ---- settings ----------------------------------------------------------------------------------------------
class QuickPromptIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=24)
    label: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=240)
    active: bool = True


class TopicIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    label: str = Field(min_length=1, max_length=120)
    allowed: bool = True
    keywords: list[str] = Field(default_factory=list, max_length=80)
    retrieval_scopes: list[str] = Field(default_factory=list)
    member_data_scopes: list[str] = Field(default_factory=list)
    why: str | None = Field(default=None, max_length=240)


class ProhibitedRuleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    label: str = Field(min_length=1, max_length=120)
    action: str = Field(pattern="^(prohibit|escalate)$")
    keywords: list[str] = Field(default_factory=list, max_length=80)
    why: str | None = Field(default=None, max_length=240)


class PolicyOut(BaseModel):
    version: str
    topics: list[TopicIn]
    prohibited: list[ProhibitedRuleIn]
    member_data_scopes_enabled: list[str]
    escalation_categories: list[str]


class SettingsOut(BaseModel):
    enabled: bool
    name: str
    welcome: str
    returning_welcome: str
    safe_response: str
    fallback: str
    escalation_response: str
    quick_prompts: list[QuickPromptIn]
    policy: PolicyOut
    member_data_scope_options: list[str]
    retrieval_scope_options: dict[str, str]
    updated_at: datetime
    updated_by: str | None


class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    name: str = Field(min_length=1, max_length=48)
    welcome: str = Field(min_length=1, max_length=1000)
    returning_welcome: str = Field(min_length=1, max_length=1000)
    safe_response: str = Field(min_length=1, max_length=1000)
    fallback: str = Field(min_length=1, max_length=1000)
    escalation_response: str = Field(min_length=1, max_length=1000)
    quick_prompts: list[QuickPromptIn] = Field(max_length=12)
    policy: PolicyOut


# ---- advanced ---------------------------------------------------------------------------------------------------
class TraceRowOut(BaseModel):
    trace_id: str
    created_at: datetime
    member_ref: str
    session_ref: str
    conversation_id: UUID | None
    provider: str | None
    model: str | None
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None
    policy_outcome: str
    policy_category: str | None
    safety_result: str
    retrieval_count: int
    top_retrieval_score: float | None
    feedback: str | None
    error_category: str | None
    exporters: str


class AiMonitoringOut(BaseModel):
    window_days: int
    traces: int
    answered: int
    average_latency_ms: int | None
    p95_latency_ms: int | None
    input_tokens: int
    output_tokens: int
    by_provider: dict[str, int]
    by_outcome: dict[str, int]
    by_error: dict[str, int]
    feedback: dict[str, int]
    telemetry: dict
    langfuse_status: str
    recent: list[TraceRowOut]


class RetrievalDiagnosticsOut(BaseModel):
    index: dict
    recent: list[TraceRowOut]
    average_top_score: float | None
    empty_retrievals: int


class DiagnosticQueryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=1, max_length=300)
    scopes: list[str] = Field(default_factory=list)
    limit: int = Field(default=4, ge=1, le=10)


class DiagnosticHitOut(BaseModel):
    source_id: str
    document_id: str
    chunk_id: str
    title: str
    source_version: int
    scope_key: str
    heading: str | None
    score: float
    excerpt: str


class SafetyAnalyticsOut(BaseModel):
    window_days: int
    decisions_by_outcome: dict[str, int]
    decisions_by_category: dict[str, int]
    safety_results: dict[str, int]
    escalations: list[ConversationSummaryOut]
    policy_version: str


class ProviderStatusOut(BaseModel):
    environment: str
    auth_provider: dict
    email: dict
    llm: dict
    embeddings: dict
    object_store: dict
    telemetry: dict
    langfuse: dict
    database: dict


class AuditEntryOut(BaseModel):
    id: UUID
    actor_name: str
    action: str
    entity_type: str
    entity_id: str | None
    details: dict
    created_at: datetime
