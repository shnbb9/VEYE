"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/session";
import { claimSavedResult, forgetSavedResultTokens, heldSavedResultToken, savedResultStatus, type SavedStatus } from "@/lib/prospects-api";

/* Adding a saved result to the signed-in member's own history (architecture
   V2 §2.3). It takes a deliberate click, it needs this account's address to
   be verified, and it needs a capability from this tab or the emailed link —
   being signed in with the same address is not enough on its own. */

type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; saved: SavedStatus; token: string; via: "link" | "tab" }
  | { kind: "added"; deduplicated: boolean }
  | { kind: "problem"; message: string };

export default function SavedResultClaimPage() {
  const session = useSession();
  const account = session.member;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const held = heldSavedResultToken();
    if (!held) { setState({ kind: "none" }); return; }
    savedResultStatus(held.token)
      .then((saved) => setState({ kind: "ready", saved, token: held.token, via: held.kind }))
      .catch((reason) => {
        forgetSavedResultTokens();
        setState({ kind: "problem", message: reason instanceof Error ? reason.message : "That saved result is no longer available." });
      });
  }, []);

  async function add(token: string) {
    setBusy(true);
    try {
      const outcome = await claimSavedResult(token);
      forgetSavedResultTokens();
      setState({ kind: "added", deduplicated: outcome.deduplicated });
    } catch (reason) {
      setState({ kind: "problem", message: reason instanceof Error ? reason.message : "It could not be added right now." });
    } finally { setBusy(false); }
  }

  return (
    <>
      <header className="settings-hero fade-in">
        <div>
          <span className="settings-eyebrow">Your saved result</span>
          <h1 className="fd-title">Add it to your account</h1>
          <p>A Health Number you saved before signing up can join your own history here.</p>
        </div>
      </header>
      <section className="settings-card fade-in d1" data-testid="saved-result-claim">
        {state.kind === "loading" && <p className="settings-help">Checking…</p>}
        {state.kind === "none" && (
          <>
            <p className="settings-help">There is no saved result waiting in this browser tab. Open the link from the email we sent
              when you saved it, or take the assessment again.</p>
            <Link className="settings-outline" href="/app/progress/health-number">Go to your Health Number</Link>
          </>
        )}
        {state.kind === "ready" && (
          <>
            <p className="settings-help" data-testid="saved-result-claim-status">
              A result saved for <b>{state.saved.email_masked}</b> on {new Date(state.saved.captured_at).toLocaleDateString()} is
              waiting. Adding it puts it in your Health Number history with the date you took it.
            </p>
            {account && !account.email_verified ? (
              <p className="settings-help settings-note settings-note--error" role="status">
                Verify your email address first — use the link we sent when you signed up, or resend it from Settings.
                The saved result stays where it is until then.
              </p>
            ) : (
              <div className="settings-profile-actions">
                <button className="settings-save" type="button" disabled={busy} onClick={() => void add(state.token)} data-testid="saved-result-claim-add">
                  {busy ? "Adding…" : "Add it to my account"}
                </button>
              </div>
            )}
          </>
        )}
        {state.kind === "added" && (
          <>
            <p className="settings-help" role="status" data-testid="saved-result-claim-added">
              {state.deduplicated
                ? "Done. This result was already in your history from when you signed up, so nothing was duplicated."
                : "Done. The result is now part of your Health Number history."}
            </p>
            <Link className="settings-outline" href="/app/progress/health-number">See your Health Number history</Link>
          </>
        )}
        {state.kind === "problem" && (
          <>
            <p className="settings-help settings-note settings-note--error" role="alert" data-testid="saved-result-claim-problem">{state.message}</p>
            <Link className="settings-outline" href="/app">Back to your dashboard</Link>
          </>
        )}
      </section>
    </>
  );
}
