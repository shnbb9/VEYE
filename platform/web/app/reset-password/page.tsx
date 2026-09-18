"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { AuthFrame, FormError, PasswordField } from "@/components/auth/auth-frame";
import { resetPassword } from "@/lib/auth-api";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPassword />
    </Suspense>
  );
}

function ResetPassword() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 12) { setError("Choose a password of at least 12 characters."); return; }
    if (password !== confirm) { setError("The two passwords do not match."); return; }
    setBusy(true);
    try {
      await resetPassword(token, password);
      router.replace("/login?flash=reset");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This link is not valid.");
    } finally { setBusy(false); }
  }

  return (
    <AuthFrame photo="login">
      <form className="auth__form" onSubmit={submit} noValidate>
        <h1 className="auth__title">Choose a new password</h1>
        <p className="auth__subtitle">The link works once and expires soon.</p>
        {!token && <p className="auth__notice auth__notice--warn">This link is missing its reset token. Open the link from your email again, or request a new one from the sign-in screen.</p>}
        <div className="auth__fields">
          <PasswordField name="password" value={password} onChange={setPassword} placeholder="New password" autoComplete="new-password" />
          <PasswordField name="confirm" value={confirm} onChange={setConfirm} placeholder="Confirm new password" autoComplete="new-password" />
        </div>
        <FormError message={error} />
        <button type="submit" className="btn btn--primary btn--mt" disabled={busy || !token}>{busy ? "Saving…" : "Save new password"}</button>
        <p className="auth__links"><Link href="/login">Back to sign in</Link></p>
      </form>
    </AuthFrame>
  );
}
