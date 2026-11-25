"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ask } from "@/components/confirm-dialog";
import { useToast } from "@/components/member/member-chrome";
import { resendVerification } from "@/lib/auth-api";
import {
  getHealthPermission, getSproutPermission, revokeHealthPermission, turnOffSprout, turnOnSprout,
  type HealthPermission, type HealthPermissionEvent, type SproutPermission, type SproutPermissionEvent,
} from "@/lib/member-api";

/* Settings 04: who, and what, may use the member's health information.
 *
 * Two choices that do not know about each other (owner decision, 25 Nov 2026).
 * Each loads, fails, saves and is withdrawn on its own, and neither ever sets
 * the other. Everything a member agrees to is on screen before they agree to
 * it; saying no is one press and never waits on anything. */

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

export function PrivacyChoices() {
  return (
    <section className="settings-card settings-card--choices fade-in d4" id="privacy" data-testid="health-sharing">
      <div className="settings-card__head">
        <div><span className="settings-kicker">Your health records</span><h2>Your privacy choices</h2></div>
        <span className="settings-card__mark">04</span>
      </div>
      <p className="settings-help" data-testid="two-choices">Two separate choices. Saying yes to one never says yes to the other.</p>
      <div className="choice-pair">
        <TeamSharing />
        <SproutPersonalization />
      </div>
    </section>
  );
}

function StatePill({ on, label }: { on: boolean; label: string }) {
  return <span className={`choice__state${on ? " choice__state--on" : ""}`}>{label}</span>;
}

/* ---- A: the Veye team ------------------------------------------------------
   Deciding happens on the consent screen, where everything being agreed to is
   shown first (architecture V2 §4.4). The team can ask from the console;
   nothing they do there changes what is below. Withdrawing takes effect on
   their very next request, because the API reads this state each time. */
function TeamSharing() {
  const [permission, setPermission] = useState<HealthPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  useEffect(() => {
    let live = true;
    getHealthPermission().then((next) => { if (live) setPermission(next); }).catch((reason) => {
      if (live) setError(reason instanceof Error ? reason.message : "Your sharing setting could not be loaded.");
    });
    return () => { live = false; };
  }, []);

  async function withdraw() {
    if (busy || !(await ask({ title: "Stop sharing with the Veye team?", text: "They can no longer open your saved results, from this moment.",
                              confirm: "Stop sharing", cancel: "Keep sharing", danger: true }))) return;
    setBusy(true); setError("");
    try {
      setPermission(await revokeHealthPermission());
      toast.flash("Sharing has stopped");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That could not be saved.");
    } finally { setBusy(false); }
  }

  const asked = permission?.state === "requested";
  const sharing = permission?.shares_health_data === true;
  const reviewHref = permission?.open_request ? `/app/sharing-request?request=${encodeURIComponent(permission.open_request.ref)}` : "/app/sharing-request";

  return (
    <div className="choice" role="group" aria-labelledby="choiceTeam">
      <div className="choice__head">
        <h3 id="choiceTeam">Share health information with the VEYE team</h3>
        {permission && <StatePill on={sharing} label={sharing ? "On" : "Off"} />}
      </div>
      {error && <p className="chat-error" role="alert">{error}</p>}
      {!permission && !error && <ChoiceSkeleton />}

      {permission && (
        <>
          <p className="settings-help" data-testid="health-sharing-state">
            <strong>{permission.state_label}{sharing && permission.decided_at ? `, since ${day(permission.decided_at)}` : ""}.</strong>{" "}
            {sharing
              ? "The Veye team can open your saved results while they are helping you."
              : "Nobody at Veye can open your saved results."}
          </p>
          <p className="settings-help">{permission.explanation}</p>

          {asked && permission.requested_by_name && (
            <p className="settings-help" data-testid="health-sharing-asked">
              {permission.requested_by_name} asked on {day(permission.requested_at)}.
            </p>
          )}

          {permission.policy_version && permission.policy_version !== permission.current_policy_version && (
            <p className="settings-help" data-testid="health-sharing-older-terms">
              You decided under an earlier version of the terms ({permission.policy_version}); the current version is {permission.current_policy_version}.
            </p>
          )}

          <div className="choice__actions">
            {!sharing && (
              <Link className="settings-save" href={reviewHref} data-testid="health-sharing-review">
                {asked ? "Review the request" : "Review and decide"} <span aria-hidden="true">&rarr;</span>
              </Link>
            )}
            {sharing && (
              <button className="settings-outline" type="button" disabled={busy} aria-busy={busy} onClick={() => void withdraw()}
                      data-testid="health-sharing-revoke">
                {busy ? "Saving…" : "Stop sharing"}
              </button>
            )}
          </div>

          <History label="What has happened" testId="health-sharing-history"
                   rows={permission.events.map((event) => ({ id: event.id, text: describeTeam(event), at: event.created_at }))} />
        </>
      )}
    </div>
  );
}

function describeTeam(event: HealthPermissionEvent): string {
  switch (event.to_state) {
    case "requested": return `${event.actor_name || "The Veye team"} asked to see your results`;
    case "granted": return "You started sharing your results";
    case "declined": return "You chose not to share";
    case "revoked": return "You stopped sharing";
    default: return event.to_state;
  }
}

/* ---- B: Sprout ------------------------------------------------------------- */
function SproutPersonalization() {
  const [permission, setPermission] = useState<SproutPermission | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"on" | "off" | "verify" | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const toast = useToast();

  useEffect(() => {
    let live = true;
    getSproutPermission().then((next) => { if (live) setPermission(next); }).catch((reason) => {
      if (live) setError(reason instanceof Error ? reason.message : "Your Sprout setting could not be loaded.");
    });
    return () => { live = false; };
  }, []);

  async function change(on: boolean) {
    if (!permission || busy) return;
    setBusy(on ? "on" : "off"); setError(""); setNote("");
    try {
      setPermission(await (on ? turnOnSprout(permission.terms) : turnOffSprout()));
      setOpen(false);
      toast.flash(on ? "Sprout personalization is on" : "Sprout personalization is off");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That could not be saved.");
      // The words may have changed under the member: show the current ones.
      getSproutPermission().then(setPermission).catch(() => undefined);
    } finally { setBusy(null); }
  }

  async function verify() {
    setBusy("verify"); setNote("");
    try {
      const delivery = await resendVerification();
      setNote(delivery.status === "sent" ? "We sent a new verification link to your inbox." : `The link could not be sent: ${delivery.detail ?? "mail unavailable"}.`);
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "The link could not be sent.");
    } finally { setBusy(null); }
  }

  const on = permission?.personalizes === true;
  const terms = permission?.terms;
  return (
    <div className="choice" role="group" aria-labelledby="choiceSprout" data-testid="sprout-permission">
      <div className="choice__head">
        <h3 id="choiceSprout">Personalize Sprout using my health information</h3>
        {permission && <StatePill on={on} label={on ? "On" : "Off"} />}
      </div>
      {!permission && !error && <ChoiceSkeleton />}

      {permission && terms && (
        <>
          <p className="settings-help" data-testid="sprout-state">
            <strong>{on ? `On, since ${day(permission.authorized_at)}.`
              : permission.state === "turned_off" ? `Off. You turned it off on ${day(permission.revoked_at)}.` : "Off."}</strong>{" "}
            {on ? "Sprout may use summaries of your health information to answer you." : "Sprout answers without your health information."}
          </p>
          {permission.was_combined && (
            <p className="settings-help" data-testid="sprout-separated">
              When you agreed to share with the team, that covered Sprout too. It is now a separate choice, and it stays off until you turn it on.
            </p>
          )}
          <p className="settings-help">{terms.separate}</p>

          <div className="choice__actions">
            <button className={on ? "settings-outline" : "settings-save"} type="button" aria-expanded={open} aria-controls="sproutTerms"
                    onClick={() => { setOpen((shown) => !shown); setNote(""); }} data-testid="sprout-review">
              {on ? "See what Sprout uses" : open ? "Hide" : "Review and decide"}
            </button>
            {on && (
              <button className="settings-outline" type="button" disabled={busy !== null} aria-busy={busy === "off"}
                      onClick={() => void change(false)} data-testid="sprout-turn-off">
                {busy === "off" ? "Saving…" : "Turn off"}
              </button>
            )}
          </div>

          <div className="choice__panel" id="sproutTerms" hidden={!open} data-testid="sprout-terms">
            <h4>Why</h4>
            <p>{terms.purpose} <b>{terms.recipient}</b></p>
            <h4>{on ? "What Sprout uses" : "What Sprout would use"}</h4>
            <ul>{terms.information.map((item) => <li key={item}>{item}</li>)}</ul>
            <p>{terms.never}</p>
            <h4>An outside AI company</h4>
            <p>{terms.outside_ai}</p>
            <h4>For how long</h4>
            <p>{terms.expiry_rule} {terms.withdrawal}</p>
            <h4>When it is off</h4>
            <p>{terms.without}</p>
            <p className="choice__meta">Version {terms.version} ({terms.label})</p>
            {!on && (permission.email_verified ? (
              <div className="consent__choices" role="group" aria-label="Your choice">
                <button className="consent__choice" type="button" disabled={busy !== null} aria-busy={busy === "on"}
                        onClick={() => void change(true)} data-testid="sprout-turn-on">{busy === "on" ? "Saving…" : "Turn on personalization"}</button>
                <button className="consent__choice" type="button" disabled={busy !== null} onClick={() => setOpen(false)} data-testid="sprout-keep-off">Keep it off</button>
              </div>
            ) : (
              <div className="settings-note settings-note--error" role="status" data-testid="sprout-verify">
                <p className="settings-help">Verify your email address before you decide, so we know this choice is yours.</p>
                <button className="settings-outline" type="button" disabled={busy !== null} onClick={() => void verify()}>
                  {busy === "verify" ? "Sending…" : "Send me a verification link"}
                </button>
              </div>
            ))}
          </div>
          {note && <p className="settings-help settings-note" role="status">{note}</p>}

          <History label="What has happened" testId="sprout-history"
                   rows={permission.events.map((event) => ({ id: event.id, text: describeSprout(event), at: event.created_at }))} />
        </>
      )}
      {error && <p className="chat-error" role="alert" data-testid="sprout-error">{error}</p>}
    </div>
  );
}

const describeSprout = (event: SproutPermissionEvent) =>
  event.to_state === "on" ? "You turned personalization on" : "You turned personalization off";

function History({ label, rows, testId }: { label: string; rows: { id: string; text: string; at: string }[]; testId: string }) {
  if (!rows.length) return null;
  return (
    <details className="choice__history" data-testid={testId}>
      <summary>{label} ({rows.length})</summary>
      <ul className="settings-session-list">
        {rows.slice().reverse().map((row) => <li key={row.id}>{row.text} &middot; {day(row.at)}</li>)}
      </ul>
    </details>
  );
}

/* Holds the height while a choice loads, so nothing below it jumps. */
function ChoiceSkeleton() {
  return (
    <div className="choice__loading" role="status" aria-label="Loading">
      <span className="skel" style={{ width: "72%" }} /><span className="skel" /><span className="skel" style={{ width: "88%" }} />
    </div>
  );
}
