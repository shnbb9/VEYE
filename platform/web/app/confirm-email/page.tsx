"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { confirmEmailChange } from "@/lib/auth-api";

/* The end of an email change. The link was sent to the NEW address, so
   opening it is the proof that mailbox is reachable; the account moves and
   every session ends, which is why this page always finishes at the sign-in
   rather than carrying anyone onwards. */

export default function ConfirmEmailPage() {
  return <Suspense fallback={null}><ConfirmEmail /></Suspense>;
}

function ConfirmEmail() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) { setState("failed"); setMessage("This link is missing its confirmation token."); return; }
    let cancelled = false;
    confirmEmailChange(token)
      .then((result) => {
        if (cancelled) return;
        setState("done");
        setMessage(result.message ?? "Your email address has been changed. Please sign in again.");
      })
      .catch((reason) => {
        if (cancelled) return;
        setState("failed");
        setMessage(reason instanceof Error ? reason.message : "This link is not valid. Request a new one from Settings.");
      });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <AuthFrame photo="login">
      <div className="auth__form" data-testid="confirm-email">
        <h1 className="auth__title">
          {state === "working" ? "Confirming your new address…" : state === "done" ? "Email address confirmed" : "That link did not work"}
        </h1>
        {state !== "working" && (
          <p className={state === "failed" ? "auth__notice auth__notice--warn" : "auth__subtitle"} data-testid="confirm-email-message">
            {message}
          </p>
        )}
        {state === "done" && (
          <p className="auth__subtitle">
            Signing in again keeps the account safe after its address changes — use the new address with the password you already had.
          </p>
        )}
        {state !== "working" && (
          <Link className="btn btn--primary btn--mt" href="/login?flash=email-changed">Go to sign in</Link>
        )}
      </div>
    </AuthFrame>
  );
}
