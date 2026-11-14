"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { AuthFrame, FormError, PasswordField } from "@/components/auth/auth-frame";
import { acceptAdminInvitation, previewAdminInvitation, type InvitationPreview } from "@/lib/auth-api";

/* Activating an invited administrator account: the only way into the console
   for someone the system has not provisioned before. The link carries a
   single-use token; the person chooses their own password here, and then
   signs in at /admin/login like every other administrator — accepting never
   signs anyone in, because the portal decides that, not the invitation. */

export default function AcceptInvitationPage() {
  return <Suspense fallback={null}><AcceptInvitation /></Suspense>;
}

function AcceptInvitation() {
  const token = useSearchParams().get("token") ?? "";
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setLoadError("This link is missing its invitation token."); return; }
    previewAdminInvitation(token)
      .then(setInvitation)
      .catch((reason) => setLoadError(reason instanceof Error ? reason.message : "This invitation link is not valid."));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 12) { setError("Choose a password of at least 12 characters."); return; }
    if (password !== confirm) { setError("The two passwords do not match."); return; }
    setBusy(true);
    try {
      await acceptAdminInvitation(token, password);
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This invitation could not be accepted.");
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <AuthFrame photo="login">
        <div className="auth__form" data-testid="invitation-accepted">
          <h1 className="auth__title">Your administrator account is ready</h1>
          <p className="auth__subtitle">Sign in to the Veye admin console with your new password.</p>
          <Link className="btn btn--primary btn--mt" href="/admin/login?flash=invited">Go to the console sign-in</Link>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame photo="login">
      {/* method="post": an unhydrated submit of a method-less form is a GET,
          which put the chosen console password in the URL. */}
      <form className="auth__form" method="post" onSubmit={submit} noValidate data-testid="accept-invitation">
        <h1 className="auth__title">Set your console password</h1>
        {invitation ? (
          <p className="auth__subtitle" data-testid="invitation-for">
            {invitation.invited_by ? `${invitation.invited_by} invited you` : "You have been invited"} to the Veye admin
            console as <strong>{invitation.email}</strong>.
          </p>
        ) : (
          <p className="auth__subtitle">Checking your invitation…</p>
        )}
        {loadError && (
          <p className="auth__notice auth__notice--warn" data-testid="invitation-error">
            {loadError} Ask an administrator to send a fresh invitation.
          </p>
        )}
        <div className="auth__fields">
          <PasswordField name="password" value={password} onChange={setPassword} placeholder="Choose a password" autoComplete="new-password" />
          <PasswordField name="confirm" value={confirm} onChange={setConfirm} placeholder="Confirm password" autoComplete="new-password" />
        </div>
        <p className="auth__subtitle">At least 12 characters. Nobody at Veye can see or set it for you.</p>
        <FormError message={error} />
        <button type="submit" className="btn btn--primary btn--mt" disabled={busy || !invitation} data-testid="accept-submit">
          {busy ? "Activating…" : "Activate my account"}
        </button>
        <p className="auth__links"><Link href="/admin/login">Back to the console sign-in</Link></p>
      </form>
    </AuthFrame>
  );
}
