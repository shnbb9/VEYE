import { apiJson, postJson } from "@/lib/api";
import type { RichDoc } from "@/components/admin/rich-text-editor";

/* Settings -> Product settings -> Health sharing (architecture V2 §4.2, §4.5).
   Every change here publishes a new immutable version; drafts are separate,
   and a member's decision is always recorded against a published version. */

export type PolicyVersionRow = { version: number; published_at: string | null; published_by: string; note: string | null; hash: string };
export type TemplateValue = { subject: string; body: RichDoc };
export type TermsValue = { summary: RichDoc; details: RichDoc; purpose: string; recipient: string };
export type Draft<T> = { value: T; updated_at: string | null; by: string } | null;

export type SharingSettings = {
  notification: {
    mode: "manual" | "automatic"; resend_interval_hours: number; sender_name: string; version: number;
    published_at: string | null; published_by: string; resend_choices: number[]; history: PolicyVersionRow[]; backfill: string;
  };
  template: { value: TemplateValue; version: number; draft: Draft<TemplateValue>; history: PolicyVersionRow[]; variables: string[]; cta_label: string };
  terms: {
    value: TermsValue; version: number; label: string; hash: string; draft: Draft<TermsValue>; history: PolicyVersionRow[]; variables: string[];
    locked: { categories: string[]; companion_use: string; expiry_rule: string; withdrawal: string; not_covered: string };
  };
  status: string;
};

const BASE = "/api/v1/admin/settings/health-sharing";
export const getSharingSettings = () => apiJson<SharingSettings>(BASE);
export const publishNotification = (value: { mode: string; resend_interval_hours: number; sender_name: string }) =>
  postJson<SharingSettings>(`${BASE}/notification`, value, "PUT");
export const saveTemplateDraft = (value: TemplateValue) => postJson<SharingSettings>(`${BASE}/template/draft`, value, "PUT");
export const discardTemplateDraft = () => apiJson<SharingSettings>(`${BASE}/template/draft`, { method: "DELETE" });
export const previewTemplate = (value: TemplateValue) => postJson<{ subject: string; html: string; text: string }>(`${BASE}/template/preview`, value);
export const sendTemplateTest = (value: TemplateValue) => postJson<{ status: string; to: string; error: string | null }>(`${BASE}/template/test`, value);
export const publishTemplate = () => postJson<SharingSettings>(`${BASE}/template/publish`, {});
export const saveTermsDraft = (value: TermsValue) => postJson<SharingSettings>(`${BASE}/terms/draft`, value, "PUT");
export const discardTermsDraft = () => apiJson<SharingSettings>(`${BASE}/terms/draft`, { method: "DELETE" });
export const previewTerms = (value: TermsValue) => postJson<Record<string, unknown> & { material_change: boolean; summary_html: string; details_html: string; categories: string[] }>(`${BASE}/terms/preview`, value);
export const publishTerms = () => postJson<SharingSettings>(`${BASE}/terms/publish`, {});
