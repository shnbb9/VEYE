/* Member account, Mood Tracker, Food Diary, Requests, published content and
   support details — the Phase-1 slices added on 21 Sep 2026. Every member
   call is for the signed-in member only (`/members/me/…`). */

import type { Account } from "@/lib/auth-api";
import { apiJson, ME, postJson } from "@/lib/api";
import { apiPath } from "@/lib/api-base";

/* ---- profile ------------------------------------------------------------- */

export type ProfileInput = { first_name: string; last_name: string; phone?: string | null; postal_code?: string | null };

export const updateProfile = (input: ProfileInput) => postJson<Account>(`/api/v1/members/${ME}/profile`, input, "PUT");

export async function uploadPhoto(file: File): Promise<Account> {
  const body = new FormData();
  body.append("file", file, file.name);
  return apiJson<Account>(`/api/v1/members/${ME}/photo`, { method: "POST", body });
}

export const removePhoto = () => apiJson<Account>(`/api/v1/members/${ME}/photo`, { method: "DELETE" });

/** The member's own photo URL, cache-busted by the account's photo_version. */
export const myPhotoUrl = (version: string) => apiPath(`/api/v1/members/${ME}/photo?v=${encodeURIComponent(version)}`);
export const exportUrl = () => apiPath(`/api/v1/members/${ME}/export`);

/* ---- mood ---------------------------------------------------------------- */

export type Mood = "happy" | "excited" | "calm" | "neutral" | "tired" | "stressed" | "sad" | "angry";
export type MoodEntry = { id: string; entry_date: string; mood: Mood; mood_label: string; note: string; created_at: string; updated_at: string };
export type MoodStats = {
  month: string; days_logged_this_month: number; day_streak: number; top_mood: Mood | null; top_mood_label: string | null;
  balance_score: number | null; balance_window_days: number; balance_entries: number;
};
export type MoodOverview = { entries: MoodEntry[]; stats: MoodStats; latest: MoodEntry | null };

/** The browser's calendar day (YYYY-MM-DD) — streaks and the 30-day window follow the member's clock. */
export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const getMood = (month?: string) =>
  apiJson<MoodOverview>(`/api/v1/members/${ME}/mood?today=${localDateKey()}${month ? `&month=${month}` : ""}`);
export const logMood = (entry_date: string, mood: Mood, note: string) =>
  postJson<MoodEntry>(`/api/v1/members/${ME}/mood?today=${localDateKey()}`, { entry_date, mood, note }, "PUT");
export const removeMood = (entry_date: string) => apiJson<void>(`/api/v1/members/${ME}/mood/${entry_date}`, { method: "DELETE" });

/* ---- food diary ---------------------------------------------------------- */

/** The prototype macro estimate (grams and kcal), calculated by the API. */
export type Macros = { protein_g: number; carbs_g: number; fat_g: number; kcal: number };
export type Meal = { id: string; entry_date: string; meal_time: string; description: string; feelings: string[]; notes: string; created_at: string; updated_at: string } & Macros;
export type DiaryHistoryDay = { entry_date: string; meals: number; kcal: number; saved: boolean; last_updated: string | null };
export type DiaryDay = { entry_date: string; meals: Meal[]; totals: Macros; saved_at: string | null; history: DiaryHistoryDay[]; feelings: string[]; days_logged: number };
export type MealInput = { entry_date: string; meal_time: string; description: string; feelings: string[]; notes: string };

export const getDiaryDay = (date: string) => apiJson<DiaryDay>(`/api/v1/members/${ME}/food-diary?date=${date}`);
export const addMeal = (input: MealInput) => postJson<DiaryDay>(`/api/v1/members/${ME}/food-diary`, input);
export const updateMeal = (id: string, input: MealInput) => postJson<DiaryDay>(`/api/v1/members/${ME}/food-diary/${id}`, input, "PUT");
export const removeMeal = (id: string) => apiJson<DiaryDay>(`/api/v1/members/${ME}/food-diary/${id}`, { method: "DELETE" });
export const estimateMacros = (description: string) =>
  postJson<{ estimate: Macros | null }>(`/api/v1/members/${ME}/food-diary/estimate`, { description });
export const saveDiaryDay = (date: string) => postJson<DiaryDay>(`/api/v1/members/${ME}/food-diary/days/${date}/save`, {});
export const getDiaryFeedback = (date: string) => apiJson<{ entry_date: string; text: string }>(`/api/v1/members/${ME}/food-diary/feedback?date=${date}`);

/* ---- meal planning ------------------------------------------------------- */

export const MEAL_TYPES = ["Meal", "Snack", "Breakfast", "Lunch", "Dinner", "Brunch", "Exercise", "Routine"] as const;
export type PlanMeal = { name: string; type: string; time: string; notes: string };
export type PlanDay = { id: string; name: string; notes: string; describe: string; mode: "manual" | "ai"; meals: PlanMeal[]; assigned_date: string | null; created_at: string; updated_at: string };
export type PlanDays = { days: PlanDay[]; created_id: string | null };
export type PlanDayInput = { name: string; notes: string; describe: string; mode: "manual" | "ai"; meals: PlanMeal[] };
export type SampleDay = { key: string; label: string; options: { label: string | null; meals: PlanMeal[] }[] };

const PLANS = `/api/v1/members/${ME}/meal-plans`;
export const getPlanDays = () => apiJson<PlanDays>(`${PLANS}/days`);
export const getSampleDays = () => apiJson<SampleDay[]>(`${PLANS}/samples`);
export const createPlanDay = (input: PlanDayInput) => postJson<PlanDays>(`${PLANS}/days`, input);
export const updatePlanDay = (id: string, input: PlanDayInput) => postJson<PlanDays>(`${PLANS}/days/${id}`, input, "PUT");
export const duplicatePlanDay = (id: string) => postJson<PlanDays>(`${PLANS}/days/${id}/duplicate`, {});
export const assignPlanDay = (id: string, date: string) => postJson<PlanDays>(`${PLANS}/days/${id}/assign`, { date });
export const deletePlanDay = (id: string) => apiJson<PlanDays>(`${PLANS}/days/${id}`, { method: "DELETE" });
export const copySampleDay = (key: string, option: number) => postJson<PlanDays>(`${PLANS}/samples/copy`, { key, option });

/* ---- requests ------------------------------------------------------------ */

export type RequestKind = "contact_us" | "help_question" | "join_beta";
export type RequestStatus = "new" | "in_progress" | "resolved";
export type MemberRequest = {
  id: string; kind: RequestKind; kind_label: string; status: RequestStatus; status_label: string; source: string;
  subject: string; message: string; created_at: string; updated_at: string; handled_at: string | null; resolution_note: string;
};
export type Submitted = { id: string; kind: RequestKind; status: RequestStatus; created_at: string; already_open: boolean };

export const myRequests = () => apiJson<MemberRequest[]>(`/api/v1/members/${ME}/requests`);
export const sendMemberRequest = (input: { kind: RequestKind; subject?: string; message?: string; page?: string }) =>
  postJson<Submitted>(`/api/v1/members/${ME}/requests`, input);
export const sendPublicRequest = (input: { kind: "contact_us" | "help_question"; name?: string; email?: string | null; subject?: string; message: string; page?: string }) =>
  postJson<Submitted>("/api/v1/requests", input);

/* ---- published content + support details --------------------------------- */

export type PublishedEntry = { key: string; category: string | null; title: string; body: string; display_order: number };
export const getPublishedContent = (group: "help_faq" | "member_copy") => apiJson<PublishedEntry[]>(`/api/v1/content/${group}`);

export type SupportDetails = { support_email: string; support_phone: string };
export const getSupportDetails = () => apiJson<SupportDetails>("/api/v1/settings/support");
