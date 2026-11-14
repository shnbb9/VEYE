import { apiJson, postJson } from "@/lib/api";
import { toApiAnswers, type Answers, type HealthResult } from "@/lib/health-number";

/* A visitor's saved result before sign-up (architecture V2 §2). Tokens are
   capabilities: they travel in request bodies, never in a URL the browser
   keeps, and the tab holds them in sessionStorage only. */

export const SAVED_RESULT_TOKEN_KEY = "veye_saved_result_token";      // handed to the tab that saved
export const SAVED_RESULT_LINK_KEY = "veye_saved_result_link";        // carried over from the emailed link

export type CaptureNotice = { version: string; text: string; consent_label: string; hash: string; privacy_path: string };
export type SavingPolicy = { saving_enabled: boolean; retention_label: string; not_saved_note: string; notice: CaptureNotice | null };

export type SavedStatus = {
  status: "unverified" | "verified" | "pending_claim" | "claimed" | "expired" | "erased";
  status_label: string;
  email_masked: string;
  email_verified: boolean;
  captured_at: string;
  expires_at: string | null;
  retention_mode: "never" | "days" | "forever";
  retention_days: number | null;
};

export type CaptureResponse = {
  result: Omit<HealthResult, "attempt_id" | "member_id" | "completed_at">;
  saved: SavedStatus;
  claim_token: string;
  confirmation_email: string;
  replayed: boolean;
};

export const getSavingPolicy = () => apiJson<SavingPolicy>("/api/v1/prospects/policy");

export function captureAssessment(input: { email: string; answers: Answers; notice: CaptureNotice; idempotencyKey: string }) {
  return postJson<CaptureResponse>("/api/v1/prospects/assessment", {
    email: input.email,
    answers: toApiAnswers(input.answers),
    consent: { agreed: true, notice_version: input.notice.version, notice_hash: input.notice.hash },
    idempotency_key: input.idempotencyKey,
  });
}

export const savedResultStatus = (token: string) => postJson<SavedStatus>("/api/v1/prospects/status", { token });
export const confirmSavedResult = (token: string) => postJson<SavedStatus>("/api/v1/prospects/confirm", { token });
export const eraseSavedResult = (token: string) => postJson<{ erased: boolean; message: string }>("/api/v1/prospects/erase", { token });
export const recoverSavedResult = (email: string) => postJson<{ accepted: boolean; message: string }>("/api/v1/prospects/recover", { email });
export const claimSavedResult = (token: string) =>
  postJson<{ attempt_id: string; deduplicated: boolean; already_claimed: boolean }>("/api/v1/members/me/saved-results/claim", { token });

/** The token this tab holds, if any: the emailed one wins, because it is the
 *  stronger proof (it shows the person reads that mailbox). */
export function heldSavedResultToken(): { token: string; kind: "link" | "tab" } | null {
  try {
    const link = sessionStorage.getItem(SAVED_RESULT_LINK_KEY);
    if (link) return { token: link, kind: "link" };
    const tab = sessionStorage.getItem(SAVED_RESULT_TOKEN_KEY);
    if (tab) return { token: tab, kind: "tab" };
  } catch { /* storage unavailable */ }
  return null;
}

export function forgetSavedResultTokens() {
  try { sessionStorage.removeItem(SAVED_RESULT_LINK_KEY); sessionStorage.removeItem(SAVED_RESULT_TOKEN_KEY); } catch { /* ignore */ }
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `sr-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function formatSavedUntil(saved: Pick<SavedStatus, "expires_at" | "retention_mode">): string {
  if (saved.retention_mode === "forever" || !saved.expires_at) return "until you delete it";
  return `until ${new Date(saved.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`;
}

/* ---- the console (metadata only) ------------------------------------------ */

export type ProspectRow = {
  id: string;
  email_masked: string;
  status: SavedStatus["status"];
  status_label: string;
  captured_at: string;
  expires_at: string | null;
  retention_label: string;
  source: string;
  email_verified: boolean;
  registered_member: { member_id: string; name: string } | null;
  claimed_at: string | null;
  erased_at: string | null;
  sharing_note: string;
};

export type ProspectDetail = ProspectRow & {
  consent_version: string;
  retention_policy_version: number;
  calculation_version: string;
  events: { event_type: string; label: string; actor_type: string; at: string; policy_version: number | null }[];
};

export type ProspectsPage = {
  rows: ProspectRow[];
  total: number;
  page: number;
  page_size: number;
  counts: Record<string, number>;
  retention_label: string;
  saving_enabled: boolean;
};

export function listProspects(params: { status?: string; q?: string; sort?: string; page?: number; pageSize?: number }) {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  if (params.sort) search.set("sort", params.sort);
  search.set("page", String(params.page ?? 1));
  search.set("page_size", String(params.pageSize ?? 25));
  return apiJson<ProspectsPage>(`/api/v1/admin/prospects?${search.toString()}`);
}

export const getProspect = (id: string) => apiJson<ProspectDetail>(`/api/v1/admin/prospects/${encodeURIComponent(id)}`);
export const eraseProspect = (id: string, reason: string) =>
  postJson<ProspectRow>(`/api/v1/admin/prospects/${encodeURIComponent(id)}/erase`, { reason });

export type RetentionChoice = { mode: "never" | "days" | "forever"; days: number | null };
export type JobRun = { job: string; status: string; dry_run: boolean; started_at: string; finished_at: string | null; counts: Record<string, number>; error: string | null; triggered_by: string };
export type PrivacySettings = RetentionChoice & {
  label: string;
  version: number;
  published_at: string | null;
  published_by: string;
  is_default: boolean;
  options: (RetentionChoice & { label: string })[];
  encryption_ready: boolean;
  encryption_is_development_key: boolean;
  notice_version: string;
  notice_preview: string | null;
  notice_status: string;
  counts: Record<string, number>;
  last_cleanup: JobRun | null;
  history: { version: number; label: string; published_at: string | null; published_by: string; note: string | null }[];
};
export type RetentionImpact = { active: number; would_shorten: number; would_expire_now: number; unaffected: number; applies_to_new_captures: string; lengthens_existing: boolean };

export const getPrivacySettings = () => apiJson<PrivacySettings>("/api/v1/admin/settings/privacy");
export const previewRetention = (choice: RetentionChoice) => postJson<RetentionImpact>("/api/v1/admin/settings/privacy/preview", choice);
export const publishRetention = (choice: RetentionChoice & { acknowledge_forever: boolean; note: string }) =>
  postJson<PrivacySettings>("/api/v1/admin/settings/privacy", choice, "PUT");
export const applyShorterRetention = () => postJson<{ shortened: number; purged_now: number }>("/api/v1/admin/settings/privacy/apply-shorter", { confirm: true });
export const runRetentionCleanup = (dryRun: boolean) => postJson<JobRun>("/api/v1/admin/settings/privacy/cleanup", { dry_run: dryRun });
