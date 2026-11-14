"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { useSession } from "@/components/session";
import {
  SAVED_RESULT_LINK_KEY, confirmSavedResult, eraseSavedResult, forgetSavedResultTokens, formatSavedUntil,
  recoverSavedResult, savedResultStatus, type SavedStatus,
} from "@/lib/prospects-api";

/* Where the emailed link lands (architecture V2 §2.4). Opening it proves the
   mailbox is reachable; it shows nothing about the result itself — no answers
   and no number — only that a result is saved and until when. The token is
   moved out of the address bar into this tab straight away, so it is not left
   in browser history. */

export default function SavedResultPage() {
  return <Suspense fallback={null}><SavedResult /></Suspense>;
}

type View = { state: "working" } | { state: "ok"; saved: SavedStatus } | { state: "gone"; message: string } | { state: "erased"; message: string };

function SavedResult() {
  const params = useSearchParams();
  const session = useSession();
  const [view, setView] = useState<View>({ state: "working" });
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fromUrl = params.get("token");
    let token = fromUrl;
    try {
      if (fromUrl) {
        sessionStorage.setItem(SAVED_RESULT_LINK_KEY, fromUrl);
        window.history.replaceState(null, "", "/saved-result");
      } else {
        token = sessionStorage.getItem(SAVED_RESULT_LINK_KEY);
      }
    } catch { /* storage unavailable: the link still works for this visit */ }
    if (!token) { setView({ state: "gone", message: "This page needs the link from your email." }); return; }
    (fromUrl ? confirmSavedResult(token) : savedResultStatus(token))
      .then((saved) => setView({ state: "ok", saved }))
      .catch((reason) => setView({ state: "gone", message: reason instanceof Error ? reason.message : "This link is no longer available." }));
  }, [params]);

  async function erase() {
    let token: string | null = null;
    try { token = sessionStorage.getItem(SAVED_RESULT_LINK_KEY); } catch { /* ignore */ }
    if (!token || !window.confirm("Delete your saved result and the email address you gave? This cannot be undone.")) return;
    setBusy(true);
    try {
      const done = await eraseSavedResult(token);
      forgetSavedResultTokens();
      setView({ state: "erased", message: done.message });
    } catch (reason) {
      setView({ state: "gone", message: reason instanceof Error ? reason.message : "It could not be deleted right now." });
    } finally { setBusy(false); }
  }

  const member = session.member;
  return (
    <AuthFrame photo="login">
      <div className="auth__form" data-testid="saved-result-page">
        <h1 className="auth__title">Your saved result</h1>
        {view.state === "working" && <p className="auth__subtitle">Checking your link…</p>}
        {view.state === "ok" && (
          <>
            <p className="auth__subtitle">{view.saved.email_verified ? "Address confirmed" : "Saved"}</p>
            <p className="auth__status" data-testid="saved-result-status">
              Your Health Number result is saved for {view.saved.email_masked} {formatSavedUntil(view.saved)}. To keep it in
              your own history, add it to a Veye account that uses this same address.
            </p>
            {member ? (
              <Link className="btn btn--primary btn--mt" href="/app/saved-result" data-testid="saved-result-add">Add it to my account</Link>
            ) : (
              <>
                <Link className="btn btn--primary btn--mt" href="/signup" data-testid="saved-result-signup">Create an account</Link>
                <p className="auth__links">Already a member? <Link href="/login?next=/app/saved-result">Sign in to add it</Link>.</p>
              </>
            )}
            <p className="auth__links">
              <button type="button" className="auth__link-button" onClick={() => void erase()} disabled={busy} data-testid="saved-result-erase">
                {busy ? "Deleting…" : "Delete my saved result"}
              </button>
            </p>
          </>
        )}
        {view.state === "erased" && (
          <>
            <p className="auth__subtitle">Deleted</p>
            <p className="auth__status" data-testid="saved-result-erased">{view.message}</p>
            <Link className="btn btn--primary btn--mt" href="/">Back to Veye</Link>
          </>
        )}
        {view.state === "gone" && <Recover message={view.message} />}
      </div>
    </AuthFrame>
  );
}

function Recover({ message }: { message: string }) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email.trim())) { setNote("Please enter a valid email address."); return; }
    setBusy(true);
    try {
      const result = await recoverSavedResult(email.trim());
      setNote(result.message);
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "That could not be sent right now.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <p className="auth__subtitle">That did not work</p>
      <p className="auth__status" data-testid="saved-result-gone">{message} A saved result is kept only as long as the
        notice you agreed to said, and a link stops working once it has been used to add the result to an account.</p>
      <form method="post" onSubmit={(event) => void submit(event)} noValidate>
        <div className="auth__fields">
          <div className="field">
            <input className="field__input" type="email" autoComplete="email" placeholder="The address you saved it under"
                   aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="saved-result-recover-email" />
          </div>
        </div>
        <button type="submit" className="btn btn--primary btn--mt" disabled={busy} data-testid="saved-result-recover">
          {busy ? "Sending…" : "Email me a new link"}
        </button>
      </form>
      {note && <p className="auth__notice" role="status" data-testid="saved-result-recover-note">{note}</p>}
      <p className="auth__links"><Link href="/onboarding">Take the assessment again</Link></p>
    </>
  );
}
