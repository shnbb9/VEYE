"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/member/member-chrome";
import { MemberAvatar } from "@/components/member/member-avatar";
import { useSession } from "@/components/session";
import { forgotPassword, getNotificationPreferences, resendVerification, setNotificationPreference } from "@/lib/auth-api";
import { exportUrl, removePhoto, updateProfile, uploadPhoto } from "@/lib/member-api";

/* The approved Settings view (build/dashboard.html, #view-settings): four
   numbered cards. Profile, photo and security are backed by the account
   service and persist on the server; controls the application does not
   implement yet say so instead of saving to the browser as the prototype did. */

export default function SettingsPage() {
  const session = useSession();
  const toast = useToast();
  const account = session.member;
  const [preferences, setPreferences] = useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = useState<"verify" | "password" | "profile" | "photo" | null>(null);
  const [note, setNote] = useState("");
  const [profileNote, setProfileNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", postal_code: "" });
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getNotificationPreferences().then((result) => setPreferences(result.preferences)).catch(() => setPreferences({}));
  }, []);

  // Fill the form from the account once (and again after a save refreshes it).
  useEffect(() => {
    if (!account || dirty) return;
    setForm({ first_name: account.first_name, last_name: account.last_name, phone: account.phone ?? "", postal_code: account.postal_code ?? "" });
  }, [account, dirty]);

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

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy("profile");
    setProfileNote(null);
    try {
      await updateProfile({ first_name: form.first_name, last_name: form.last_name, phone: form.phone || null, postal_code: form.postal_code || null });
      await session.refresh();
      setDirty(false);
      setProfileNote({ tone: "ok", text: "Profile saved." });
      toast.flash("Profile saved");
    } catch (reason) {
      setProfileNote({ tone: "error", text: reason instanceof Error ? reason.message : "Your profile could not be saved." });
    } finally { setBusy(null); }
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setBusy("photo");
    setProfileNote(null);
    try {
      await uploadPhoto(file);
      await session.refresh();
      setProfileNote({ tone: "ok", text: "Profile photo updated." });
      toast.flash("Profile photo updated");
    } catch (reason) {
      setProfileNote({ tone: "error", text: reason instanceof Error ? reason.message : "The photo could not be saved." });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function dropPhoto() {
    setBusy("photo");
    try {
      await removePhoto();
      await session.refresh();
      setProfileNote({ tone: "ok", text: "Profile photo removed — your initial is shown instead." });
    } catch (reason) {
      setProfileNote({ tone: "error", text: reason instanceof Error ? reason.message : "The photo could not be removed." });
    } finally { setBusy(null); }
  }

  async function logOut() {
    await session.signOut("member", "/");
  }

  if (!account) return null;
  // Every profile value below — photo, name, email, status, tenure — is read
  // from this ONE member-portal account. The admin session (if any) is never
  // consulted here.
  const fullName = `${account.first_name} ${account.last_name}`.trim();
  const memberSince = new Date(account.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const field = (key: keyof typeof form) => (event: { target: { value: string } }) => { setDirty(true); setForm((current) => ({ ...current, [key]: event.target.value })); };

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
          <form className="settings-profile" data-testid="settings-profile" onSubmit={(event) => void saveProfile(event)}>
            <div className="settings-photo-wrap">
              <MemberAvatar account={account} className="settings-photo" size="large" testId="settings-photo" />
              <input ref={fileRef} id="settingsPhotoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden
                     onChange={(event) => void choosePhoto(event.target.files?.[0])} data-testid="settings-photo-input" />
              <button className="settings-photo-btn" type="button" disabled={busy === "photo"} onClick={() => fileRef.current?.click()}>
                {busy === "photo" ? "Saving…" : "Change photo"}
              </button>
              {account.photo_version && (
                <button className="settings-photo-remove" type="button" disabled={busy === "photo"} onClick={() => void dropPhoto()}>Remove photo</button>
              )}
              <p className="settings-photo-hint">JPG, PNG or WebP<br />up to 2 MB</p>
            </div>
            <div className="settings-fields">
              <label>First name<input type="text" value={form.first_name} onChange={field("first_name")} autoComplete="given-name" required maxLength={120} data-testid="settings-first-name" /></label>
              <label>Last name<input type="text" value={form.last_name} onChange={field("last_name")} autoComplete="family-name" maxLength={120} data-testid="settings-last-name" /></label>
              <label>Email<input type="email" value={account.email} readOnly data-testid="settings-email" /></label>
              <label>Email status<input type="text" value={account.email_verified ? "Verified" : "Not verified yet"} readOnly /></label>
              <label><span>Phone <small>(optional)</small></span><input type="tel" value={form.phone} onChange={field("phone")} autoComplete="tel" maxLength={40} data-testid="settings-phone" /></label>
              <label><span>ZIP / postal code <small>(optional)</small></span><input type="text" value={form.postal_code} onChange={field("postal_code")} autoComplete="postal-code" maxLength={20} data-testid="settings-postal" /></label>
              <label>Member since<input type="text" value={memberSince} readOnly /></label>
              <label>Signed-in name<input type="text" value={fullName} readOnly data-testid="settings-name" /></label>
            </div>
            <div className="settings-profile-actions settings-profile-actions--form">
              <p className="settings-help">Email changes are handled through support so your sign-in address stays verified. Everything else saves to your account.</p>
              <button className="settings-save" type="submit" disabled={busy === "profile" || !dirty} data-testid="settings-save">
                {busy === "profile" ? "Saving…" : "Save profile"} <span aria-hidden="true">&rarr;</span>
              </button>
            </div>
          </form>
          {profileNote && <p className={`settings-help settings-note${profileNote.tone === "error" ? " settings-note--error" : ""}`} role="status" data-testid="settings-profile-note">{profileNote.text}</p>}
          {!account.email_verified && (
            <div className="settings-profile-actions">
              <button className="settings-save" type="button" onClick={() => void resend()} disabled={busy === "verify"}>
                {busy === "verify" ? "Sending…" : "Resend verification email"} <span aria-hidden="true">&rarr;</span>
              </button>
            </div>
          )}
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
          <a className="settings-outline" href={exportUrl()} download data-testid="settings-export">Download my data (JSON) <span aria-hidden="true">&rarr;</span></a>
          <button className="settings-outline" type="button" onClick={() => void logOut()}>Sign out <span aria-hidden="true">&rarr;</span></button>
          {note && <p className="settings-help settings-note" role="status">{note}</p>}
          <div className="settings-link-row"><Link className="settings-link" href="/privacy">Privacy</Link><Link className="settings-link" href="/terms">Terms</Link></div>
        </section>
      </div>
    </>
  );
}
