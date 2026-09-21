import type { Answers } from "@/lib/health-number";
import { toApiAnswers } from "@/lib/health-number";
import { apiJson, postJson } from "@/lib/api";

export type Portal = "member" | "admin";

export type Account = {
  id: string;
  email: string;
  /** Primary kind for display only; authorization uses the two access facts. */
  role: "member" | "admin";
  first_name: string;
  last_name: string;
  member_id: string | null;
  member_access: boolean;
  admin_access: boolean;
  /** Which portal session produced this answer. */
  portal: Portal | null;
  email_verified: boolean;
  is_synthetic: boolean;
  created_at: string;
  phone: string | null;
  postal_code: string | null;
  /** Changes when the photo is replaced or removed; null = no photo (show the initial). */
  photo_version: string | null;
};

/** Both portals at once — either may be signed in, both, or neither. */
export type PortalSessions = { member: Account | null; admin: Account | null };

export type Delivery = { kind: string; status: "sent" | "failed" | "skipped" | string; detail: string | null };

export type SignUpInput = {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  confirm_password: string;
  phone?: string;
  postal_code?: string;
  remember: boolean;
  answers?: Answers;
};

/** Anonymous is a normal answer (`null` per portal), never a failed request. */
export async function me(): Promise<PortalSessions> {
  return apiJson<PortalSessions>("/api/v1/auth/me");
}

/** Member sign-up: identity + member profile + a MEMBER portal session. */
export async function signUp(input: SignUpInput) {
  const { answers, ...rest } = input;
  return postJson<{ account: Account; deliveries: Delivery[]; health_number_attempt_id: string | null }>("/api/v1/auth/sign-up", {
    ...rest,
    phone: rest.phone || null,
    postal_code: rest.postal_code || null,
    health_number_answers: answers ? toApiAnswers(answers) : null,
  });
}

/** MEMBER portal sign-in (/login). */
export async function signIn(email: string, password: string, remember: boolean) {
  return postJson<{ account: Account }>("/api/v1/auth/sign-in", { email, password, remember });
}

/** ADMIN portal sign-in (/admin/login). */
export async function adminSignIn(email: string, password: string, remember: boolean) {
  return postJson<{ account: Account }>("/api/v1/auth/admin/sign-in", { email, password, remember });
}

export async function signOut(): Promise<void> {
  await apiJson<void>("/api/v1/auth/sign-out", { method: "POST" });
}

export async function adminSignOut(): Promise<void> {
  await apiJson<void>("/api/v1/auth/admin/sign-out", { method: "POST" });
}

export async function verifyEmail(token: string) {
  return postJson<{ account: Account }>("/api/v1/auth/verify-email", { token });
}

export async function resendVerification() {
  return postJson<Delivery>("/api/v1/auth/resend-verification", {});
}

/** `portal` only decides which sign-in screen the reset returns to. */
export async function forgotPassword(email: string, portal: Portal = "member") {
  return postJson<{ accepted: boolean; message: string; delivery: Delivery | null }>("/api/v1/auth/forgot-password", { email, portal });
}

export async function resetPassword(token: string, password: string) {
  return postJson<{ ok: boolean; message: string | null }>("/api/v1/auth/reset-password", { token, password });
}

export async function getNotificationPreferences() {
  return apiJson<{ preferences: Record<string, boolean> }>("/api/v1/auth/notification-preferences");
}

export async function setNotificationPreference(kind: string, email_enabled: boolean) {
  return postJson<{ preferences: Record<string, boolean> }>("/api/v1/auth/notification-preferences", { kind, email_enabled }, "PUT");
}

/** Where a portal's home is. The portal decides, never the account. */
export function homeFor(portal: Portal): string {
  return portal === "admin" ? "/admin" : "/app";
}

/** A `next` parameter is honoured only inside the portal that produced it. */
export function safeNext(next: string | null, portal: Portal): string {
  const home = homeFor(portal);
  if (!next || !next.startsWith("/") || next.startsWith("//")) return home;
  const inside = portal === "admin" ? next.startsWith("/admin") && !next.startsWith("/admin/login") : next.startsWith("/app") || next.startsWith("/onboarding");
  return inside ? next : home;
}
