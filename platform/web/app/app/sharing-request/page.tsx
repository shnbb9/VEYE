"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useToast } from "@/components/member/member-chrome";
import { resendVerification } from "@/lib/auth-api";
import {
  declineHealthPermission, getHealthPermission, getSharingRequest, grantHealthPermission,
  type HealthPermission, type SharingTerms,
} from "@/lib/member-api";

/* The consent screen (architecture V2 §4.4). Reached from the emailed
   "Review sharing request" button — which only identified the request — or
   from Settings. Everything the member is agreeing to is on this page before
   either button: who asks, what is shared, with whom, why, for how long, what
   is not covered, what declining means and how to withdraw. The two choices
   carry equal weight; nothing is pre-selected. Deciding needs a verified
   address, and the decision is sent with the exact terms version shown here,
   so it can never be credited to words the member did not read. */

export default function SharingRequestPage() {
  return <Suspense fallback={null}><SharingRequest /></Suspense>;
}

function SharingRequest() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const ref = params.get("request");
  const [permission, setPermission] = useState<HealthPermission | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState<"allow" | "deny" | "verify" | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    (ref ? getSharingRequest(ref) : getHealthPermission())
      .then(setPermission)
      .catch((reason) => setProblem(reason instanceof Error ? reason.message : "This request could not be opened."));
  }, [ref]);

  async function decide(allow: boolean, terms: SharingTerms) {
    setBusy(allow ? "allow" : "deny"); setNote("");
    try {
      const outcome = await (allow ? grantHealthPermission : declineHealthPermission)({ terms, requestRef: ref });
      setPermission(outcome);
      toast.flash(allow ? "Sharing is on" : "Your results stay private");
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "Your choice could not be saved.");
      // The terms may have changed under the member: show the current ones.
      if (reason instanceof Error && /terms changed/i.test(reason.message)) {
        getHealthPermission().then(setPermission).catch(() => undefined);
      }
    } finally { setBusy(null); }
  }

  async function verify() {
    setBusy("verify");
    try {
      const delivery = await resendVerification();
      setNote(delivery.status === "sent" ? "We sent a new verification link to your inbox." : `The link could not be sent: ${delivery.detail ?? "mail unavailable"}.`);
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "The link could not be sent.");
    } finally { setBusy(null); }
  }

  const terms = permission?.terms ?? null;
  const decided = permission && ["granted", "declined"].includes(permission.state) && !ref;
  const answered = permission && ref && permission.state !== "requested";

  return (
    <>
      <header className="settings-hero fade-in">
        <div>
          <span className="settings-eyebrow">Your health records</span>
          <h1 className="fd-title">A request to share your health information</h1>
          <p>Read what sharing means before you choose. Nothing is shared unless you allow it.</p>
        </div>
      </header>

      {problem && (
        <section className="settings-card" data-testid="sharing-request-problem">
          <p className="settings-help settings-note settings-note--error" role="alert">{problem}</p>
          <p className="settings-help">If someone forwarded you this link, it is not for your account. You can still see and change your own choice in Settings.</p>
          <Link className="settings-outline" href="/app/settings?section=privacy">Go to Settings</Link>
        </section>
      )}

      {permission && terms && (
        <section className="settings-card consent fade-in d1" data-testid="sharing-request" aria-labelledby="consentWho">
          <h2 id="consentWho" className="consent__heading">Who is asking</h2>
          <p className="settings-help" data-testid="sharing-request-who">
            {permission.open_request
              ? permission.open_request.automatic
                ? `Veye asked automatically after you verified your email${permission.open_request.requested_at ? ` (${new Date(permission.open_request.requested_at).toLocaleDateString()})` : ""}, on behalf of ${terms.recipient}.`
                : `${permission.open_request.requested_by_name || "The Veye team"} asked${permission.open_request.requested_at ? ` on ${new Date(permission.open_request.requested_at).toLocaleDateString()}` : ""}, on behalf of ${terms.recipient}.`
              : `${terms.recipient}.`}
          </p>

          {/* Generated by the API from a validated tree; every text node escaped. */}
          <div className="consent__rich" dangerouslySetInnerHTML={{ __html: terms.summary_html }} />

          <h2 className="consent__heading">What would be shared</h2>
          <ul className="consent__list" data-testid="sharing-request-categories">
            {terms.categories.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p className="settings-help">{terms.companion_use}</p>

          <h2 className="consent__heading">Who receives it, and why</h2>
          <p className="settings-help"><b>{terms.recipient}.</b> {terms.purpose}</p>

          <h2 className="consent__heading">For how long</h2>
          <p className="settings-help">{terms.expiry_rule} {terms.withdrawal}</p>

          <h2 className="consent__heading">What is not covered</h2>
          <p className="settings-help">{terms.not_covered}</p>

          <h2 className="consent__heading">If you don&rsquo;t allow it</h2>
          <p className="settings-help">{terms.decline_effect}</p>

          <details className="consent__details">
            <summary>Read the full terms</summary>
            <div className="consent__rich" dangerouslySetInnerHTML={{ __html: terms.details_html }} />
          </details>
          <p className="settings-help consent__meta" data-testid="sharing-request-version">
            Terms version {terms.version === 0 ? "1 (initial)" : terms.version}{terms.published_at ? `, published ${new Date(terms.published_at).toLocaleDateString()}` : ""}. See also our <Link href="/privacy">Privacy Policy</Link>.
          </p>

          {decided || answered ? (
            <p className="settings-help settings-note" role="status" data-testid="sharing-request-decided">
              <strong>{permission.state_label}.</strong> {permission.shares_health_data
                ? "The Veye team can open your saved results while they are helping you. You can stop at any time in Settings."
                : "Nobody at Veye can open your saved results."}{" "}
              <Link href="/app/settings?section=privacy">Change this in Settings</Link>.
            </p>
          ) : permission.email_verified === false ? (
            <div className="settings-note settings-note--error" role="status" data-testid="sharing-request-verify">
              <p className="settings-help">Verify your email address before you decide, so we know this choice is yours.</p>
              <button className="settings-outline" type="button" disabled={busy !== null} onClick={() => void verify()}>
                {busy === "verify" ? "Sending…" : "Send me a verification link"}
              </button>
            </div>
          ) : (
            <div className="consent__choices" role="group" aria-label="Your choice">
              <button className="consent__choice" type="button" disabled={busy !== null} onClick={() => void decide(true, terms)} data-testid="sharing-allow">
                {busy === "allow" ? "Saving…" : "Allow sharing with the VEYE team"}
              </button>
              <button className="consent__choice" type="button" disabled={busy !== null} onClick={() => void decide(false, terms)} data-testid="sharing-deny">
                {busy === "deny" ? "Saving…" : "Don't allow sharing"}
              </button>
            </div>
          )}
          {note && <p className="settings-help settings-note settings-note--error" role="alert" data-testid="sharing-request-note">{note}</p>}
          <p className="settings-help"><button className="settings-link" type="button" onClick={() => router.push("/app/settings?section=privacy")}>Back to Settings</button></p>
        </section>
      )}
      {!permission && !problem && <section className="settings-card"><p className="settings-help">Loading…</p></section>}
    </>
  );
}
