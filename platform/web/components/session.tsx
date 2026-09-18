"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { me, signOut as apiSignOut, type Account } from "@/lib/auth-api";

/* The browser never decides who is signed in: it asks the API (`/auth/me`)
   and the API reads the HttpOnly session cookie. This provider caches that
   answer for the current page tree and re-asks when the route changes. */

type SessionState = {
  status: "loading" | "anonymous" | "signed-in";
  account: Account | null;
  refresh: () => Promise<Account | null>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [account, setAccount] = useState<Account | null>(null);

  const refresh = useCallback(async () => {
    try {
      const current = await me();
      setAccount(current);
      setStatus(current ? "signed-in" : "anonymous");
      return current;
    } catch {
      setAccount(null);
      setStatus("anonymous");
      return null;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    try { await apiSignOut(); } catch { /* the cookie is gone either way */ }
    setAccount(null);
    setStatus("anonymous");
  }, []);

  return <SessionContext.Provider value={{ status, account, refresh, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

/** Wraps a protected tree: sends anonymous visitors to sign-in (remembering
 *  where they were going) and the wrong role to its own home. */
export function RequireRole({ role, children, fallback }: { role: "member" | "admin"; children: ReactNode; fallback?: ReactNode }) {
  const { status, account } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "anonymous") router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
    else if (status === "signed-in" && account && account.role !== role) router.replace(account.role === "admin" ? "/admin" : "/app");
  }, [status, account, role, router, pathname]);

  if (status !== "signed-in" || !account || account.role !== role) {
    return <>{fallback ?? null}</>;
  }
  return <>{children}</>;
}
