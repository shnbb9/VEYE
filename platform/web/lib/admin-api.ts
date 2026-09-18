import { apiJson, postJson } from "@/lib/api";
import { apiPath } from "@/lib/api-base";
import type { Message } from "@/lib/companion-api";

const BASE = "/api/v1/admin/companion";

export type Overview = {
  conversations_total: number;
  conversations_needing_review: number;
  feedback_total: number;
  feedback_unreviewed: number;
  knowledge_sources_active: number;
  knowledge_sources_total: number;
  traces_last_7_days: number;
  escalations_last_7_days: number;
  llm_provider: string;
  llm_model: string | null;
  langfuse_status: string;
};

export type ConversationSummary = {
  id: string;
  member_name: string;
  member_email: string;
  started_at: string;
  last_message_at: string;
  message_count: number;
  flagged: boolean;
  flag_reason: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  first_message: string;
  feedback_rating: string | null;
  outcomes: string[];
};

export type PolicyDecision = {
  id: string;
  outcome: string;
  category: string | null;
  matched_rule: string | null;
  retrieval_scopes: string[];
  member_data_scopes: string[];
  reason: string;
  policy_version: string;
  created_at: string;
};

export type AdminMessage = Message & {
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  safety_result: string | null;
  context_scopes: string[];
  trace_id: string | null;
  policy_decision: PolicyDecision | null;
};

export type ConversationDetail = {
  summary: ConversationSummary;
  member: { name: string; email: string; member_since: string; health_number: string; email_verified: boolean; is_synthetic: boolean };
  messages: AdminMessage[];
};

export type FeedbackRow = {
  id: string;
  conversation_id: string;
  message_id: string;
  member_name: string;
  rating: string;
  reason: string | null;
  comment: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reply_excerpt: string;
};

export type KnowledgeDocument = {
  id: string;
  source_version: number;
  filename: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  is_current: boolean;
  ingestion_status: string;
  ingestion_error: string | null;
  chunk_count: number;
  ingested_at: string | null;
  created_at: string;
};

export type KnowledgeSource = {
  id: string;
  title: string;
  type: string;
  scope_key: string;
  scope_label: string;
  description: string;
  reference_label: string | null;
  status: "Draft" | "Inactive" | "Active" | "Archived";
  version: number;
  approved_by: string | null;
  approved_at: string | null;
  effective_date: string | null;
  is_synthetic: boolean;
  retrievable: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  current_document: KnowledgeDocument | null;
  documents: KnowledgeDocument[];
  storage: string;
};

export type KnowledgeSourceInput = {
  title: string;
  type: string;
  scope_key: string;
  description: string;
  reference_label: string | null;
  effective_date: string | null;
};

export type QuickPromptSetting = { id: string; label: string; prompt: string; active: boolean };
export type Topic = { key: string; label: string; allowed: boolean; keywords: string[]; retrieval_scopes: string[]; member_data_scopes: string[]; why: string | null };
export type ProhibitedRule = { key: string; label: string; action: "prohibit" | "escalate"; keywords: string[]; why: string | null };
export type Policy = { version: string; topics: Topic[]; prohibited: ProhibitedRule[]; member_data_scopes_enabled: string[]; escalation_categories: string[] };
export type Settings = {
  enabled: boolean;
  name: string;
  welcome: string;
  returning_welcome: string;
  safe_response: string;
  fallback: string;
  escalation_response: string;
  quick_prompts: QuickPromptSetting[];
  policy: Policy;
  member_data_scope_options: string[];
  retrieval_scope_options: Record<string, string>;
  updated_at: string;
  updated_by: string | null;
};
export type SettingsInput = Pick<Settings, "enabled" | "name" | "welcome" | "returning_welcome" | "safe_response" | "fallback" | "escalation_response" | "quick_prompts" | "policy">;

export type TraceRow = {
  trace_id: string;
  created_at: string;
  member_ref: string;
  session_ref: string;
  conversation_id: string | null;
  provider: string | null;
  model: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  policy_outcome: string;
  policy_category: string | null;
  safety_result: string;
  retrieval_count: number;
  top_retrieval_score: number | null;
  feedback: string | null;
  error_category: string | null;
  exporters: string;
};

export type AiMonitoring = {
  window_days: number;
  traces: number;
  answered: number;
  average_latency_ms: number | null;
  p95_latency_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  by_provider: Record<string, number>;
  by_outcome: Record<string, number>;
  by_error: Record<string, number>;
  feedback: Record<string, number>;
  telemetry: { exporters: string[]; capture_content: boolean; environment: string };
  langfuse_status: string;
  recent: TraceRow[];
};

export type RetrievalDiagnostics = {
  index: { sources_total: number; sources_retrievable: number; sources_by_status: Record<string, number>; documents_ingested: number; chunks_total: number; embedding_model: string };
  recent: TraceRow[];
  average_top_score: number | null;
  empty_retrievals: number;
};

export type DiagnosticHit = { source_id: string; document_id: string; chunk_id: string; title: string; source_version: number; scope_key: string; heading: string | null; score: number; excerpt: string };

export type SafetyAnalytics = {
  window_days: number;
  decisions_by_outcome: Record<string, number>;
  decisions_by_category: Record<string, number>;
  safety_results: Record<string, number>;
  escalations: ConversationSummary[];
  policy_version: string;
};

export type ProviderStatus = {
  environment: string;
  auth_provider: Record<string, unknown>;
  email: Record<string, unknown>;
  llm: Record<string, unknown>;
  embeddings: Record<string, unknown>;
  object_store: Record<string, unknown>;
  telemetry: Record<string, unknown>;
  langfuse: Record<string, unknown>;
  database: Record<string, unknown>;
};

export type AuditEntry = { id: string; actor_name: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown>; created_at: string };

export const getOverview = () => apiJson<Overview>(`${BASE}/overview`);
export const listConversations = (filter: "needs_review" | "reviewed" | "all", q = "") =>
  apiJson<ConversationSummary[]>(`${BASE}/conversations?filter=${filter}&q=${encodeURIComponent(q)}`);
export const getConversation = (id: string) => apiJson<ConversationDetail>(`${BASE}/conversations/${id}`);
export const reviewConversation = (id: string, note?: string) => postJson<ConversationSummary>(`${BASE}/conversations/${id}/review`, { note: note ?? null });
export const listFeedback = (filter: "all" | "unreviewed" | "reviewed") => apiJson<FeedbackRow[]>(`${BASE}/feedback?filter=${filter}`);
export const reviewFeedback = (id: string) => postJson<FeedbackRow>(`${BASE}/feedback/${id}/review`, {});

export const getKnowledgeOptions = () => apiJson<{ types: string[]; scopes: Record<string, string>; statuses: string[] }>(`${BASE}/knowledge-sources/options`);
export const listKnowledgeSources = () => apiJson<KnowledgeSource[]>(`${BASE}/knowledge-sources`);
export const getKnowledgeSource = (id: string) => apiJson<KnowledgeSource>(`${BASE}/knowledge-sources/${id}`);
export const createKnowledgeSource = (input: KnowledgeSourceInput) => postJson<KnowledgeSource>(`${BASE}/knowledge-sources`, input);
export const updateKnowledgeSource = (id: string, input: KnowledgeSourceInput) => postJson<KnowledgeSource>(`${BASE}/knowledge-sources/${id}`, input, "PUT");
export const transitionKnowledgeSource = (id: string, action: "activate" | "deactivate" | "archive" | "restore") =>
  postJson<KnowledgeSource>(`${BASE}/knowledge-sources/${id}/${action}`, {});
export async function attachKnowledgeDocument(id: string, file: File): Promise<KnowledgeSource> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(apiPath(`${BASE}/knowledge-sources/${id}/document`), { method: "POST", body, credentials: "include" });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof detail?.detail === "string" ? detail.detail : "The document could not be attached.");
  }
  return response.json() as Promise<KnowledgeSource>;
}

export const getSettings = () => apiJson<Settings>(`${BASE}/settings`);
export const saveSettings = (input: SettingsInput) => postJson<Settings>(`${BASE}/settings`, input, "PUT");

export const getAiMonitoring = (days = 30) => apiJson<AiMonitoring>(`${BASE}/advanced/ai-monitoring?days=${days}`);
export const getRetrievalDiagnostics = () => apiJson<RetrievalDiagnostics>(`${BASE}/advanced/retrieval-diagnostics`);
export const runDiagnosticQuery = (query: string, scopes: string[]) => postJson<DiagnosticHit[]>(`${BASE}/advanced/retrieval-diagnostics/query`, { query, scopes, limit: 5 });
export const getSafetyAnalytics = (days = 30) => apiJson<SafetyAnalytics>(`${BASE}/advanced/safety-analytics?days=${days}`);
export const getProviderStatus = () => apiJson<ProviderStatus>(`${BASE}/advanced/provider-status`);
export const getAudit = () => apiJson<AuditEntry[]>(`${BASE}/advanced/audit`);

/* ---- Guided Experiences (Companion → Settings → Guided Experiences) -------- */
export type GuidedFlowVersion = {
  id: string; key: string; title: string; version: number; status: "Draft" | "Active" | "Archived"; source: string | null;
  content_meta: Record<string, unknown>; node_count: number; created_at: string; updated_at: string; published_at: string | null;
  published_by: string | null; sessions_total: number; sessions_in_progress: number; sessions_completed: number;
};
export type GuidedFlowGroup = { key: string; title: string; active_version: number | null; versions: GuidedFlowVersion[] };
export type GuidedFlowEdge = { from_node: string; via: string | null; to_node: string };
export type GuidedFlowDefinition = {
  key: string; title: string; version: number; start: string; description?: string;
  sections?: { key: string; title: string; start: string; kind: string }[];
  content_meta?: Record<string, unknown>;
  nodes: Record<string, {
    type: string; section?: string; text: string; source_ref?: string; copy_origin?: string; next?: string; pause?: boolean; task?: string; note?: string;
    choices?: { key: string; label: string; next: string }[]; check?: { state: string; if_true: string; if_false: string }; action?: { type: string; target?: string };
  }>;
};
export type GuidedFlowDetail = { flow: GuidedFlowVersion; definition: GuidedFlowDefinition; edges: GuidedFlowEdge[]; validation: string };

export const listGuidedFlows = () => apiJson<GuidedFlowGroup[]>(`${BASE}/guided-flows`);
export const getGuidedFlow = (id: string) => apiJson<GuidedFlowDetail>(`${BASE}/guided-flows/${id}`);
export const activateGuidedFlow = (id: string) => postJson<GuidedFlowVersion>(`${BASE}/guided-flows/${id}/activate`, {});
export const deactivateGuidedFlow = (id: string) => postJson<GuidedFlowVersion>(`${BASE}/guided-flows/${id}/deactivate`, {});
