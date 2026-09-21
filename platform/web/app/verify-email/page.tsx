"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { useSession } from "@/components/session";
import { verifyEmail } from "@/lib/auth-api";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}

function VerifyEmail() {
  const params = useSearchParams();
  const session = useSession();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<{ status: "working" | "done" | "failed"; message: string }>({ status: "working", message: "" });
  // The token is single-use: make sure the request goes out exactly once even
  // when React runs the effect twice in development.
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!token) { setState({ status: "failed", message: "This link is missing its verification token. Open the link from your email again." }); return; }
    if (started.current === token) return;
    started.current = token;
    verifyEmail(token)
      .then(async () => { await session.refresh(); setState({ status: "done", message: "Your email address is verified." }); })
      .catch((reason) => setState({ status: "failed", message: reason instanceof Error ? reason.message : "This link is not valid." }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const signedIn = session.member !== null;
  return (
    <AuthFrame photo="login">
      <div className="auth__form">
        <h1 className="auth__title">Email verification</h1>
        <p className="auth__subtitle">{state.status === "working" ? "Checking your link…" : state.status === "done" ? "All set!" : "That did not work"}</p>
        <p className="auth__status">{state.message}</p>
        {state.status === "done" && (
          <Link className="btn btn--primary btn--mt" href={signedIn ? "/app" : "/login?flash=verified"}>{signedIn ? "Go to dashboard" : "Sign in"}</Link>
        )}
        {state.status === "failed" && (
          <>
            <Link className="btn btn--primary btn--mt" href={signedIn ? "/app/settings" : "/login"}>{signedIn ? "Request a new link in Settings" : "Sign in"}</Link>
            <p className="auth__links"><Link href="/help">Browse help &amp; FAQs</Link></p>
          </>
        )}
      </div>
    </AuthFrame>
  );
}
