import type { Answers } from "@/lib/health-number";
import { toApiAnswers } from "@/lib/health-number";
import { apiJson, postJson } from "@/lib/api";
import { apiBaseUrl } from "@/lib/api-base";

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
  /** An address the member asked to move to; null unless a change is pending. */
  pending_email: string | null;
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
  prospectClaimToken?: string;
};

/** Anonymous is a normal answer (`null` per portal), never a failed request. */
export async function me(): Promise<PortalSessions> {
  return apiJson<PortalSessions>("/api/v1/auth/me");
}

/** Member sign-up: identity + member profile + a MEMBER portal session. */
export async function signUp(input: SignUpInput) {
  const { answers, prospectClaimToken, ...rest } = input;
  return postJson<{ account: Account; deliveries: Delivery[]; health_number_attempt_id: string | null; prospect_link: string }>("/api/v1/auth/sign-up", {
    ...rest,
    phone: rest.phone || null,
    postal_code: rest.postal_code || null,
    health_number_answers: answers ? toApiAnswers(answers) : null,
    // A saved result from this tab (or the emailed link) is remembered against
    // the new account; it joins it only once the address is proven.
    prospect_claim_token: prospectClaimToken || null,
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

/* ---- a sign-in this browser did not keep -----------------------------------
   The API accepted the password and set the session cookie, yet the next
   question to it comes back anonymous: the browser dropped the cookie. On a
   developer's machine that happens when the page is open at one name for the
   computer and the API at another (127.0.0.1 and localhost) — the browser
   counts them as two sites. The sign-in form used to reappear with no word of
   why (15 Nov 2026); now the screen says so, and where it will work. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type SessionNotKept = { message: string; link: { href: string; label: string } | null };

/** Why a sign-in the API accepted left this browser signed out — with the
 *  address that works when the cause is a second name for this computer.
 *  `path` is where that link lands (this page by default). */
export function sessionNotKept(portal: Portal, done: string, path?: string, base?: string): SessionNotKept {
  const here = window.location;
  let apiHost = "";
  try { apiHost = new URL(apiBaseUrl(base)).hostname; } catch { /* a relative API address shares the page's site */ }
  if (apiHost && apiHost !== here.hostname && LOOPBACK_HOSTS.has(apiHost) && LOOPBACK_HOSTS.has(here.hostname)) {
    const origin = `${here.protocol}//${apiHost}${here.port ? `:${here.port}` : ""}`;
    const target = path ?? `${here.pathname}${here.search}`;
    return {
      message: `${done}, but this browser did not keep the sign-in, because this page is open at ${here.hostname} rather than ${apiHost}.`,
      link: { href: `${origin}${target}`, label: `Continue at ${origin}${target.split("?")[0]}` },
    };
  }
  const place = portal === "admin" ? "the console" : "your Veye account";
  return { message: `${done}, but this browser did not keep the sign-in, so ${place} cannot open. Allow cookies for this site, then sign in again.`, link: null };
}

/* ---- administrator invitations & account security -------------------------
   Administrator access is provisioned, never self-served: these two calls are
   the only way an invited person activates a console account. */

export type InvitationPreview = { email: string; first_name: string; last_name: string; invited_by: string | null };

export async function previewAdminInvitation(token: string) {
  return apiJson<InvitationPreview>(`/api/v1/auth/admin-invitation?token=${encodeURIComponent(token)}`);
}

export async function acceptAdminInvitation(token: string, password: string) {
  return postJson<{ ok: boolean; message: string | null }>("/api/v1/auth/admin-invitation/accept", { token, password });
}

export async function confirmEmailChange(token: string) {
  return postJson<{ ok: boolean; message: string | null }>("/api/v1/auth/confirm-email-change", { token });
}

/** The member's own credentials and sessions (member portal session needed). */
export type MemberSession = {
  id: string;
  portal: Portal;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  remember: boolean;
  current: boolean;
};

export async function changeMyPassword(current_password: string, new_password: string) {
  return postJson<{ ok: boolean; message: string | null }>("/api/v1/members/me/password", { current_password, new_password });
}

export async function listMySessions() {
  return apiJson<{ rows: MemberSession[]; current_session_id: string | null }>("/api/v1/members/me/sessions");
}

export async function signOutEverywhereElse() {
  return postJson<{ ok: boolean; message: string | null }>("/api/v1/members/me/sessions/revoke-others", {});
}

export async function requestEmailChange(new_email: string, password: string) {
  return postJson<Delivery>("/api/v1/members/me/email", { new_email, password });
}

export async function cancelEmailChange() {
  return postJson<{ ok: boolean; message: string | null }>("/api/v1/members/me/email", {}, "DELETE");
}
