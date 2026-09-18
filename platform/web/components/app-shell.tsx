"use client";

/* The public site, the member application (/app/*), onboarding, the auth
   screens and the admin console each carry their own approved chrome; the
   root shell adds nothing of its own. */
export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
