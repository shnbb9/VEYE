import type { HealthResult } from "@/lib/health-number";
import { apiPath } from "@/lib/api-base";

/** The only member reference the browser may use: the signed-in member. */
export const ME = "me";

export type HealthNumberHistoryItem = Pick<HealthResult,
  "attempt_id" | "displayed_score" | "status" | "bucket" | "category" | "interpretation" | "calculation_version" | "completed_at"
>;

export type HealthNumberHistory = {
  member_id: string;
  latest: HealthNumberHistoryItem | null;
  history: HealthNumberHistoryItem[];
};

export type BodyCompositionInput = {
  sex: "Woman" | "Man";
  weight: number;
  height: number;
  abdomen?: number;
  hips?: number;
  waist?: number;
  wrist?: number;
};

export type BodyCompositionHistoryItem = {
  attempt_id: string;
  sex: BodyCompositionInput["sex"];
  measurements: Partial<Omit<BodyCompositionInput, "sex">> & { sex?: string };
  bmi: number | null;
  body_fat_percent: number | null;
  fat_mass_lb: number | null;
  lean_mass_lb: number | null;
  body_fat_available: boolean;
  unavailable_reason: string | null;
  calculation_version: string;
  completed_at: string;
};

export type BodyCompositionResult = BodyCompositionHistoryItem & { member_id: string };

export type BodyCompositionHistory = {
  member_id: string;
  latest: BodyCompositionHistoryItem | null;
  history: BodyCompositionHistoryItem[];
};

/* ---- Blood Test Markers -------------------------------------------------- */

export type BloodMarkerKey = "tg" | "hdl" | "insulin" | "glucose" | "aa" | "epa" | "hba1c";
export type BloodCalculationKey = "tg_hdl" | "homa_ir" | "aa_epa" | "hba1c";
export type MarkerStatus = "optimal" | "moderate" | "high" | "undefined";

/** Lab values as reported; `aa_epa` is accepted only as a lab-reported ratio
 *  when AA and EPA are not both supplied. Ratios are never client-computed. */
export type BloodMarkersInput = Partial<Record<BloodMarkerKey, number>> & { aa_epa?: number };

export type BloodMarkersRecommendation = {
  state: "none" | "ok" | "review";
  epa_dha_dose: string | null;
  lead: string | null;
};

export type BloodMarkersHistoryItem = {
  attempt_id: string;
  markers: Record<BloodMarkerKey, number | null>;
  tg_hdl: number | null;
  homa_ir: number | null;
  aa_epa: number | null;
  aa_epa_source: "calculated" | "entered" | null;
  in_range: Record<BloodCalculationKey, boolean | null>;
  classification: Record<BloodCalculationKey, MarkerStatus | null>;
  recommendation: BloodMarkersRecommendation;
  calculation_version: string;
  completed_at: string;
};

export type BloodMarkersResult = BloodMarkersHistoryItem & { member_id: string };

export type BloodMarkersHistory = {
  member_id: string;
  latest: BloodMarkersHistoryItem | null;
  history: BloodMarkersHistoryItem[];
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Every request carries the HttpOnly session cookie (same-site in local
 *  development, same-origin behind Nginx in production). */
export async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), { credentials: "include", ...options });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new ApiError(response.status, describeDetail(detail?.detail) ?? "This Veye result is not available right now.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function postJson<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  return apiJson<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** FastAPI returns a string for domain errors and a list for validation errors. */
export function describeDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item && typeof item === "object" && "msg" in item ? String((item as { msg: unknown }).msg) : null))
      .filter((item): item is string => Boolean(item));
    if (messages.length) return messages.map((message) => message.replace(/^Value error, /, "")).join(" ");
  }
  return null;
}

export async function getHealthNumberHistory(): Promise<HealthNumberHistory> {
  return apiJson<HealthNumberHistory>(`/api/v1/members/${ME}/health-number`);
}

export async function getBodyCompositionHistory(): Promise<BodyCompositionHistory> {
  return apiJson<BodyCompositionHistory>(`/api/v1/members/${ME}/body-composition`);
}

export async function calculateBodyComposition(input: BodyCompositionInput): Promise<BodyCompositionResult> {
  return apiJson<BodyCompositionResult>("/api/v1/body-composition/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
}

export async function getBloodMarkersHistory(): Promise<BloodMarkersHistory> {
  return apiJson<BloodMarkersHistory>(`/api/v1/members/${ME}/blood-markers`);
}

export type BloodMarkersPreview = Pick<BloodMarkersHistoryItem, "tg_hdl" | "homa_ir" | "aa_epa" | "aa_epa_source" | "in_range" | "calculation_version">;

/** The same server calculation without saving — backs the live "Calculated"
 *  fields while the member types. */
export async function previewBloodMarkers(input: BloodMarkersInput): Promise<BloodMarkersPreview> {
  return apiJson<BloodMarkersPreview>("/api/v1/blood-markers/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
}

export async function calculateBloodMarkers(input: BloodMarkersInput): Promise<BloodMarkersResult> {
  return apiJson<BloodMarkersResult>("/api/v1/blood-markers/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
}

/* ---- Health Assessment (11 questions, 11–33, lower is better) ------------ */

export type HealthAssessmentQuestion = { key: string; label: string; options: { value: 1 | 2 | 3; label: string }[]; info: string };

export type HealthAssessmentDefinition = {
  questions: HealthAssessmentQuestion[];
  scale_min: number;
  scale_max: number;
  polyphenol_lines: { amount: string; note: string }[];
  neurological_row: { epa_dha_dose: string; condition: string; note: string };
  calculation_version: string;
};

export type HealthAssessmentHistoryItem = {
  attempt_id: string;
  answers: Record<string, 1 | 2 | 3>;
  total: number;
  bucket: string;
  status: string;
  interpretation: string;
  tone: "good" | "moderate" | "elevated" | "significant";
  epa_dha_dose: string;
  polyphenol_lines: { amount: string; note: string }[];
  calculation_version: string;
  completed_at: string;
};

export type HealthAssessmentResult = HealthAssessmentHistoryItem & { member_id: string };

export type HealthAssessmentHistory = {
  member_id: string;
  latest: HealthAssessmentHistoryItem | null;
  history: HealthAssessmentHistoryItem[];
};

export const getHealthAssessmentDefinition = () => apiJson<HealthAssessmentDefinition>("/api/v1/health-assessment/definition");
export const getHealthAssessmentHistory = () => apiJson<HealthAssessmentHistory>(`/api/v1/members/${ME}/health-assessment`);
export const calculateHealthAssessment = (answers: Record<string, 1 | 2 | 3>) =>
  postJson<HealthAssessmentResult>("/api/v1/health-assessment/calculate", { input: { answers } });

/* ---- Simple Quiz (8 yes/no; a count, never a Health Number input) --------- */

export type SimpleQuizDefinition = {
  questions: { key: string; label: string }[];
  total_questions: number;
  progress_note: string;
  calculation_version: string;
};

export type SimpleQuizHistoryItem = {
  attempt_id: string;
  answers: Record<string, "yes" | "no">;
  yes_count: number;
  no_count: number;
  summary: string;
  progress_note: string;
  calculation_version: string;
  completed_at: string;
};

export type SimpleQuizResult = SimpleQuizHistoryItem & { member_id: string };

export type SimpleQuizHistory = {
  member_id: string;
  latest: SimpleQuizHistoryItem | null;
  history: SimpleQuizHistoryItem[];
};

export const getSimpleQuizDefinition = () => apiJson<SimpleQuizDefinition>("/api/v1/simple-quiz/definition");
export const getSimpleQuizHistory = () => apiJson<SimpleQuizHistory>(`/api/v1/members/${ME}/simple-quiz`);
export const calculateSimpleQuiz = (answers: Record<string, "yes" | "no">) =>
  postJson<SimpleQuizResult>("/api/v1/simple-quiz/calculate", { input: { answers } });

/* ---- Care Studio content published for members --------------------------- */

export type MemberCareItem = {
  id: string;
  kind: "fitness" | "supplement" | "resource";
  title: string;
  description: string;
  category: string | null;
  content_type: "video" | "program" | "article" | "link" | "copy";
  youtube_embed_url: string | null;
  external_url: string | null;
  body: string;
  cautions: string | null;
  references: string | null;
  display_order: number;
};

export const getPublishedCare = (kind: MemberCareItem["kind"]) => apiJson<MemberCareItem[]>(`/api/v1/care/${kind}`);
