"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { adminSignOut as apiAdminSignOut, me, signOut as apiSignOut, type Account, type Portal, type PortalSessions } from "@/lib/auth-api";

/* The browser never decides who is signed in: it asks the API (`/auth/me`)
   and the API reads the HttpOnly session cookies — one per portal. The
   member application and the admin console are separate portals with
   separate sessions; a person may be signed into both at once, and signing
   out of one never touches the other. This provider caches the answer for the
   current page tree and re-asks when the route changes. */

type SessionState = {
  status: "loading" | "ready";
  member: Account | null;
  admin: Account | null;
  refresh: () => Promise<PortalSessions>;
  /** Ends ONE portal session. With `redirectTo`, ends it on the server and
   *  performs a full navigation so the next page asks the API afresh — no
   *  in-page state change that a route guard could race against. */
  signOut: (portal: Portal, redirectTo?: string) => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

// Set while a sign-out's full navigation is in flight, so a route guard that
// happens to re-run never bounces the person to a sign-in screen first.
let leaving = false;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [sessions, setSessions] = useState<PortalSessions>({ member: null, admin: null });

  const refresh = useCallback(async () => {
    try {
      const current = await me();
      setSessions(current);
      setStatus("ready");
      return current;
    } catch {
      const none = { member: null, admin: null };
      setSessions(none);
      setStatus("ready");
      return none;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signOut = useCallback(async (portal: Portal, redirectTo?: string) => {
    try { await (portal === "admin" ? apiAdminSignOut() : apiSignOut()); } catch { /* the cookie is gone either way */ }
    if (redirectTo) { leaving = true; window.location.assign(redirectTo); return; }
    setSessions((current) => ({ ...current, [portal]: null }));
  }, []);

  return <SessionContext.Provider value={{ status, member: sessions.member, admin: sessions.admin, refresh, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

/** The account signed into ONE portal (null when that portal is anonymous). */
export function usePortalAccount(portal: Portal): Account | null {
  const session = useSession();
  return portal === "admin" ? session.admin : session.member;
}

const SIGN_IN: Record<Portal, string> = { member: "/login", admin: "/admin/login" };

/** Wraps a protected tree: sends visitors without a session on THIS portal
 *  to that portal's own sign-in (remembering where they were going). It
 *  never redirects on the strength of the other portal's session or of the
 *  account's flags — the portal the person chose is the portal they get. */
export function RequirePortal({ portal, children, fallback }: { portal: Portal; children: ReactNode; fallback?: ReactNode }) {
  const account = usePortalAccount(portal);
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (leaving) return;
    if (status === "ready" && !account) router.replace(`${SIGN_IN[portal]}?next=${encodeURIComponent(pathname || "/")}`);
  }, [status, account, portal, router, pathname]);

  if (status !== "ready" || !account) return <>{fallback ?? null}</>;
  return <>{children}</>;
}
