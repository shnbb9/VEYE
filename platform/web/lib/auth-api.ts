import type { Answers } from "@/lib/health-number";
import { toApiAnswers } from "@/lib/health-number";
import { apiJson, postJson } from "@/lib/api";

export type Account = {
  id: string;
  email: string;
  role: "member" | "admin";
  first_name: string;
  last_name: string;
  member_id: string | null;
  email_verified: boolean;
  is_synthetic: boolean;
  created_at: string;
};

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

/** Anonymous is a normal answer (`account: null`), never a failed request. */
export async function me(): Promise<Account | null> {
  const session = await apiJson<{ account: Account | null }>("/api/v1/auth/me");
  return session.account;
}

export async function signUp(input: SignUpInput) {
  const { answers, ...rest } = input;
  return postJson<{ account: Account; deliveries: Delivery[]; health_number_attempt_id: string | null }>("/api/v1/auth/sign-up", {
    ...rest,
    phone: rest.phone || null,
    postal_code: rest.postal_code || null,
    health_number_answers: answers ? toApiAnswers(answers) : null,
  });
}

export async function signIn(email: string, password: string, remember: boolean) {
  return postJson<{ account: Account }>("/api/v1/auth/sign-in", { email, password, remember });
}

export async function signOut(): Promise<void> {
  await apiJson<void>("/api/v1/auth/sign-out", { method: "POST" });
}

export async function verifyEmail(token: string) {
  return postJson<{ account: Account }>("/api/v1/auth/verify-email", { token });
}

export async function resendVerification() {
  return postJson<Delivery>("/api/v1/auth/resend-verification", {});
}

export async function forgotPassword(email: string) {
  return postJson<{ accepted: boolean; message: string; delivery: Delivery | null }>("/api/v1/auth/forgot-password", { email });
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

/** Where a signed-in account belongs. */
export function homeFor(account: Account): string {
  return account.role === "admin" ? "/admin" : "/app";
}
