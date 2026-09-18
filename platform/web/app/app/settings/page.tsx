"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/member/member-chrome";
import { useSession } from "@/components/session";
import { forgotPassword, getNotificationPreferences, resendVerification, setNotificationPreference } from "@/lib/auth-api";

/* The approved Settings view (build/dashboard.html, #view-settings): four
   numbered cards. Profile and Security are backed by the account service;
   controls the application does not implement yet say so instead of saving
   to the browser as the prototype did. */

export default function SettingsPage() {
  const session = useSession();
  const router = useRouter();
  const toast = useToast();
  const account = session.account;
  const [preferences, setPreferences] = useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = useState<"verify" | "password" | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    getNotificationPreferences().then((result) => setPreferences(result.preferences)).catch(() => setPreferences({}));
  }, []);

  async function resend() {
    setBusy("verify");
    try {
      const delivery = await resendVerification();
      setNote(delivery.status === "sent"
        ? "A new verification link is on its way to your inbox (local development mailbox)."
        : `The verification email could not be sent: ${delivery.detail ?? "mail service unavailable"}.`);
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "The verification email could not be sent.");
    } finally { setBusy(null); }
  }

  async function changePassword() {
    if (!account) return;
    setBusy("password");
    try {
      const result = await forgotPassword(account.email);
      const delivery = result.delivery;
      setNote(delivery && delivery.status !== "sent"
        ? `The password-change link could not be sent: ${delivery.detail ?? "mail service unavailable"}.`
        : "A password-change link has been emailed to you. It works once and expires in 30 minutes.");
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "The password-change link could not be sent.");
    } finally { setBusy(null); }
  }

  async function toggleEmailUpdates(enabled: boolean) {
    try {
      const result = await setNotificationPreference("welcome", enabled);
      setPreferences(result.preferences);
      toast.flash(enabled ? "Email updates on" : "Email updates off");
    } catch { toast.flash("Preference could not be saved"); }
  }

  async function logOut() {
    router.replace("/");
    await session.signOut();
  }

  if (!account) return null;
  const memberSince = new Date(account.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <>
      <header className="settings-hero fade-in">
        <div>
          <span className="settings-eyebrow">Your account</span>
          <h1 className="fd-title">Settings</h1>
          <p>Keep your profile, notifications, and Veye Companion preferences up to date.</p>
        </div>
      </header>
      <div className="settings-grid">
        <section className="settings-card settings-card--profile fade-in d1">
          <div className="settings-card__head"><div><span className="settings-kicker">Profile</span><h2>Your details</h2></div><span className="settings-card__mark">01</span></div>
          <div className="settings-profile">
            <div className="settings-photo-wrap">
              <div className="settings-photo settings-photo--initial" role="img" aria-label="Profile initial">{account.first_name[0]?.toUpperCase()}</div>
              <p className="settings-photo-hint">Member since<br />{memberSince}</p>
            </div>
            <div className="settings-fields">
              <label>Name<input type="text" value={`${account.first_name} ${account.last_name}`.trim()} readOnly /></label>
              <label>Email<input type="email" value={account.email} readOnly /></label>
              <label>Email status<input type="text" value={account.email_verified ? "Verified" : "Not verified yet"} readOnly /></label>
            </div>
          </div>
          <div className="settings-profile-actions">
            {!account.email_verified && (
              <button className="settings-save" type="button" onClick={() => void resend()} disabled={busy === "verify"}>
                {busy === "verify" ? "Sending…" : "Resend verification email"} <span aria-hidden="true">&rarr;</span>
              </button>
            )}
            {account.email_verified && <p className="settings-help">Your email address is verified. Name and email editing arrives with the account service release.</p>}
          </div>
        </section>

        <section className="settings-card fade-in d2">
          <div className="settings-card__head"><div><span className="settings-kicker">Preferences</span><h2>Notifications</h2></div><span className="settings-card__mark">02</span></div>
          <label className="settings-toggle">
            <span><b>Email updates</b><small>Occasional updates about your Veye journey</small></span>
            <input type="checkbox" checked={preferences?.welcome ?? true} disabled={preferences === null} onChange={(event) => void toggleEmailUpdates(event.target.checked)} />
            <i aria-hidden="true" />
          </label>
          <label className="settings-toggle is-unavailable">
            <span><b>Tracker reminders</b><small>Not connected yet — reminders arrive with the tracker release</small></span>
            <input type="checkbox" disabled />
            <i aria-hidden="true" />
          </label>
          <label className="settings-toggle is-unavailable">
            <span><b>Companion check-ins</b><small>Not connected yet — Sprout does not send proactive messages</small></span>
            <input type="checkbox" disabled />
            <i aria-hidden="true" />
          </label>
          <p className="settings-help">Security messages (email verification, password changes) are always sent.</p>
        </section>

        <section className="settings-card fade-in d3">
          <div className="settings-card__head"><div><span className="settings-kicker">Veye Companion</span><h2>Personalisation</h2></div><span className="settings-card__mark">03</span></div>
          <p className="settings-help">Sprout addresses you by your first name, which Veye adds to each reply itself — your name, email and contact details are never sent to the language model. Proactive suggestions are not connected yet.</p>
          <Link className="settings-outline" href="/app/companion">Open Sprout <span aria-hidden="true">&rarr;</span></Link>
        </section>

        <section className="settings-card fade-in d4">
          <div className="settings-card__head"><div><span className="settings-kicker">Security</span><h2>Sign-in details</h2></div><span className="settings-card__mark">04</span></div>
          <p className="settings-help">Passwords are changed through a single-use emailed link. Signing out ends this session on the server.</p>
          <button className="settings-outline" type="button" onClick={() => void changePassword()} disabled={busy === "password"}>
            {busy === "password" ? "Sending…" : "Change password"} <span aria-hidden="true">&rarr;</span>
          </button>
          <button className="settings-outline" type="button" onClick={() => void logOut()}>Sign out <span aria-hidden="true">&rarr;</span></button>
          {note && <p className="settings-help settings-note" role="status">{note}</p>}
          <div className="settings-link-row"><Link className="settings-link" href="/privacy">Privacy</Link><Link className="settings-link" href="/terms">Terms</Link></div>
        </section>
      </div>
    </>
  );
}
