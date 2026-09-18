import { apiJson, postJson } from "@/lib/api";
import type { AskResponse } from "@/lib/companion-api";

/* Guided experiences (Cara's decision trees) — the server owns the flow state;
   the browser renders the step, sends explicit choices or typed replies, and
   maps the server's structured UI actions onto its own routes. No URL from the
   server is ever navigated to. */

export type Choice = { key: string; label: string };
export type StepNode = {
  id: string;
  type: "MESSAGE" | "QUESTION" | "CHOICE" | "CHECK_MEMBER_STATE" | "NAVIGATION" | "KNOWLEDGE" | "AI_TASK" | "COMPLETE";
  section: string | null;
  text: string;
  copy_origin: string;
  choices: Choice[];
  answer_label: string | null;
  task: string | null;
};
export type UiAction = { type: string; target: string | null };
export type Step = {
  session_id: string;
  flow_key: string;
  flow_title: string;
  flow_version: number;
  status: "in_progress" | "paused" | "completed" | "skipped";
  messages: string[];
  node: StepNode | null;
  actions: UiAction[];
  clarification: string | null;
  section_title: string;
  steps_taken: number;
  content_meta: Record<string, unknown>;
};
export type SessionSummary = {
  id: string; status: Step["status"]; flow_version: number; current_node: string; section_title: string; steps_taken: number;
  started_at: string; updated_at: string; completed_at: string | null;
};
export type FlowSummary = { key: string; title: string; version: number; description: string; session: SessionSummary | null };
export type GuidedOverview = { flows: FlowSummary[]; first_arrival_offer: boolean };

export const FIRST_TIME_FLOW = "first_time_user";
export const PROGRESS_GUIDE_FLOW = "progress_tracker_guide";

const BASE = "/api/v1/companion/guided-flows";

export const getGuidedOverview = () => apiJson<GuidedOverview>(BASE);
export const startFlow = (key: string) => postJson<Step>(`${BASE}/${key}/start`, {});
export const restartFlow = (key: string) => postJson<Step>(`${BASE}/${key}/restart`, {});
export const getFlowSession = (key: string) => apiJson<Step | null>(`${BASE}/${key}/session`);
export const answerFlow = (key: string, payload: { choice?: string; text?: string }) => postJson<Step>(`${BASE}/${key}/answer`, payload);
export const pauseFlow = (key: string) => postJson<Step>(`${BASE}/${key}/pause`, {});
export const skipFlow = (key: string) => postJson<Step>(`${BASE}/${key}/skip`, {});
export const askInFlow = (key: string, question: string) => postJson<{ reply: AskResponse; step: Step }>(`${BASE}/${key}/ask`, { question });

/** The only routes a flow may send the member to. Anything else is ignored. */
const TRACKER_ROUTES: Record<string, string> = {
  blood_markers: "/app/progress/blood-markers",
  body_composition: "/app/progress/body-composition",
  health_assessment: "/app/progress/health-assessment",
  simple_quiz: "/app/progress/simple-quiz",
};
export function routeForAction(action: UiAction): string | null {
  switch (action.type) {
    case "OPEN_DASHBOARD": return "/app";
    case "OPEN_PROGRESS": return "/app/progress";
    case "OPEN_FOOD_CHOICES": return "/app/food-choices";
    case "OPEN_MEAL_PLANNING": return "/app/meal-planning";
    case "OPEN_COMPANION": return "/app/companion";
    case "OPEN_TRACKER": return action.target ? TRACKER_ROUTES[action.target] ?? null : null;
    default: return null; // START_FLOW is handled by the Companion page, not as a route
  }
}
