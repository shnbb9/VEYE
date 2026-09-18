import { apiJson, postJson } from "@/lib/api";

export type Source = { source_id: string; document_id: string; chunk_id: string; source_version: number; score: number; title: string };
export type Feedback = { rating: "helpful" | "not_helpful"; reason: string | null; comment: string | null; submitted_at: string };
export type Message = {
  id: string;
  role: "member" | "sprout";
  content: string;
  outcome: string | null;
  sources: Source[];
  feedback: Feedback | null;
  created_at: string;
};
export type Conversation = { id: string; started_at: string; message_count: number; flagged: boolean; messages: Message[] };
export type QuickPrompt = { id: string; label: string; prompt: string };
export type CompanionSession = {
  enabled: boolean;
  name: string;
  welcome: string;
  quick_prompts: QuickPrompt[];
  conversation: Conversation;
  provider: string;
  model: string | null;
};
export type AskResponse = {
  conversation_id: string;
  member_message_id: string;
  reply_message_id: string;
  reply: string;
  outcome: "answered" | "prohibited" | "escalated" | "off_topic" | "unavailable";
  policy_outcome: string;
  policy_category: string | null;
  sources: Source[];
  context_scopes: string[];
  provider: string | null;
  model: string | null;
  safety_result: string | null;
  trace_id: string | null;
  personalized: boolean;
};

export const getCompanionSession = () => apiJson<CompanionSession>("/api/v1/companion/session");
export const askSprout = (message: string, conversation_id: string | null) =>
  postJson<AskResponse>("/api/v1/companion/messages", { message, conversation_id });
export const sendFeedback = (messageId: string, rating: Feedback["rating"], reason?: string, comment?: string) =>
  postJson<Feedback>(`/api/v1/companion/messages/${messageId}/feedback`, { rating, reason: reason ?? null, comment: comment ?? null });
export const clearConversation = () => postJson<Conversation>("/api/v1/companion/conversations/clear", {});
