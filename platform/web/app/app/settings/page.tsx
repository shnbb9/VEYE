"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/member/member-chrome";
import { MemberAvatar } from "@/components/member/member-avatar";
import { DeleteProfile } from "@/components/member/delete-profile";
import { useSession } from "@/components/session";
import {
  cancelEmailChange,
  changeMyPassword,
  forgotPassword,
  getNotificationPreferences,
  listMySessions,
  requestEmailChange,
  resendVerification,
  setNotificationPreference,
  signOutEverywhereElse,
  type Account,
  type MemberSession,
} from "@/lib/auth-api";
import {
  getHealthPermission,
  revokeHealthPermission,
  type HealthPermission,
  type HealthPermissionEvent,
} from "@/lib/member-api";
import { exportUrl, myOriginalPhotoUrl, recropPhoto, removePhoto, updateProfile, uploadPhoto, type PhotoCrop } from "@/lib/member-api";
import dynamic from "next/dynamic";

/* The approved Settings view (build/dashboard.html, #view-settings): four
   numbered cards. Profile, photo and security are backed by the account
   service and persist on the server; controls the application does not
   implement yet say so instead of saving to the browser as the prototype did. */

// The API's own limits, checked here first so a wrong file is named before
// anything is uploaded (the API checks again, from the bytes).
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 10_000_000;

const AvatarCropDialog = dynamic(() => import("@/components/avatar-crop-dialog").then((m) => m.AvatarCropDialog), { ssr: false });

export default function SettingsPage() {
  return <Suspense fallback={null}><SettingsView /></Suspense>;
}

function SettingsView() {
  const session = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const account = session.member;
  const [preferences, setPreferences] = useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = useState<"verify" | "profile" | "photo" | null>(null);
  const [note, setNote] = useState("");
  const [profileNote, setProfileNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", postal_code: "" });
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<{ src: string; file?: File; initial?: PhotoCrop } | null>(null);

  useEffect(() => {
    getNotificationPreferences().then((result) => setPreferences(result.preferences)).catch(() => setPreferences({}));
  }, []);

  // The emailed "Review sharing request" link lands here (architecture V2
  // §4.4): /app/settings?section=privacy&request=<ref>. The member is signed
  // in by now (the portal guard saw to that); the reference only says which
  // request to open, on the dedicated consent screen.
  const section = params.get("section");
  const requestRef = params.get("request");
  useEffect(() => {
    if (section === "privacy" && requestRef) {
      router.replace(`/app/sharing-request?request=${encodeURIComponent(requestRef)}`);
      return;
    }
    if (section === "privacy") document.getElementById("privacy")?.scrollIntoView({ block: "start" });
  }, [section, requestRef, router]);

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

  // A chosen file opens the circular crop editor first; nothing is uploaded
  // until the person saves the square they want (owner request, 15 Nov 2026).
  function choosePhoto(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setProfileNote(null);
    if (!PHOTO_TYPES.includes(file.type)) { setProfileNote({ tone: "error", text: "Please choose a JPG, PNG or WebP image." }); return; }
    if (file.size > PHOTO_MAX_BYTES) { setProfileNote({ tone: "error", text: "The photo is too large. Please use an image under 10 MB." }); return; }
    setCropping({ src: URL.createObjectURL(file), file });
  }

  function adjustPhoto() {
    if (!account?.photo_version || !account.photo_crop) return;
    const { x, y, size } = account.photo_crop;
    setProfileNote(null);
    setCropping({ src: myOriginalPhotoUrl(account.photo_version), initial: { x, y, size } });
  }

  useEffect(() => () => { if (cropping?.file) URL.revokeObjectURL(cropping.src); }, [cropping]);

  function closeCropper() {
    setCropping(null);
  }

  async function saveCrop(square: PhotoCrop) {
    if (!cropping) return;
    if (cropping.file) await uploadPhoto(cropping.file, square); else await recropPhoto(square);
    await session.refresh();
    closeCropper();
    setProfileNote({ tone: "ok", text: "Profile photo updated." });
    toast.flash("Profile photo updated");
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
          <form className="settings-profile" data-testid="settings-profile" method="post" onSubmit={(event) => void saveProfile(event)}>
            <div className="settings-photo-wrap">
              <MemberAvatar account={account} className="settings-photo" size="large" testId="settings-photo" />
              <input ref={fileRef} id="settingsPhotoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden
                     onChange={(event) => choosePhoto(event.target.files?.[0])} data-testid="settings-photo-input" />
              <button className="settings-photo-btn" type="button" disabled={busy === "photo"} onClick={() => fileRef.current?.click()}>
                {busy === "photo" ? "Saving…" : "Change photo"}
              </button>
              {account.photo_version && account.photo_crop && (
                <button className="settings-photo-remove" type="button" disabled={busy === "photo"} onClick={adjustPhoto} data-testid="settings-photo-adjust">Adjust photo</button>
              )}
              {account.photo_version && (
                <button className="settings-photo-remove" type="button" disabled={busy === "photo"} onClick={() => void dropPhoto()}>Remove photo</button>
              )}
              <p className="settings-photo-hint">JPG, PNG or WebP<br />up to 10 MB</p>
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
              <p className="settings-help">To change your email address, use <b>Sign-in details</b> below — we confirm the new address before it replaces this one. Everything else saves to your account.</p>
              <button className="settings-save" type="submit" disabled={busy === "profile" || !dirty} data-testid="settings-save">
                {busy === "profile" ? "Saving…" : "Save profile"} <span aria-hidden="true">&rarr;</span>
              </button>
            </div>
          </form>
          {cropping && (
            <AvatarCropDialog src={cropping.src} initial={cropping.initial} primaryClass="btn-primary" secondaryClass="btn-ghost"
                              title={cropping.file ? "Crop your new photo" : "Adjust your photo"} saveLabel="Save photo"
                              onCancel={closeCropper} onSave={saveCrop} />
          )}
          {profileNote && <p className={`settings-help settings-note${profileNote.tone === "error" ? " settings-note--error" : ""}`} role="status" data-testid="settings-profile-note">{profileNote.text}</p>}
          {!account.email_verified && (
            <div className="settings-profile-actions">
              <button className="settings-save" type="button" onClick={() => void resend()} disabled={busy === "verify"} data-testid="settings-resend-verification">
                {busy === "verify" ? "Sending…" : "Resend verification email"} <span aria-hidden="true">&rarr;</span>
              </button>
            </div>
          )}
          {note && <p className="settings-help settings-note" role="status" data-testid="settings-verify-note">{note}</p>}
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

        <HealthSharingSection />

        <SecuritySection account={account} onEmailChangeRequested={() => void session.refresh()} />

        {/* Privacy & your data (architecture V2 §6): a copy of everything, and
            permanent deletion — which is not the same as being deactivated. */}
        <section className="settings-card fade-in d4" id="your-data" data-testid="settings-your-data">
          <div className="settings-card__head"><div><span className="settings-kicker">Privacy</span><h2>Your data</h2></div><span className="settings-card__mark">06</span></div>
          <p className="settings-help">Download a copy of everything you have entered and been given. Deleting your member profile removes it and all of its data for good.</p>
          <a className="settings-outline" href={exportUrl()} download data-testid="settings-export">Download my data (JSON) <span aria-hidden="true">&rarr;</span></a>
          <DeleteProfile />
        </section>
      </div>
    </>
  );
}

/* Health Data Sharing Permission — the member's decision, and the only place
   it can be made. The Veye team can ask from the console; nothing they do
   there changes what is below. Deciding happens on the consent screen, where
   everything being agreed to is shown first (architecture V2 §4.4).
   Withdrawing is one confirmed click here, and takes effect on the team's very
   next request, because the API reads this state each time. */
function HealthSharingSection() {
  const [permission, setPermission] = useState<HealthPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  useEffect(() => {
    getHealthPermission().then(setPermission).catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Your sharing setting could not be loaded."));
  }, []);

  async function withdraw() {
    if (!window.confirm("Stop sharing your saved results with the Veye team? It takes effect at once.")) return;
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
    <section className="settings-card fade-in d4" id="privacy" data-testid="health-sharing">
      <div className="settings-card__head">
        <div><span className="settings-kicker">Your health records</span><h2>Sharing with the Veye team</h2></div>
        <span className="settings-card__mark">04</span>
      </div>

      {error && <p className="chat-error" role="alert">{error}</p>}
      {!permission && !error && <p className="settings-help">Loading…</p>}

      {permission && (
        <>
          <p className="settings-help" data-testid="health-sharing-state">
            <strong>{permission.state_label}.</strong>{" "}
            {sharing
              ? "The Veye team can open your saved results while they are helping you."
              : "Nobody at Veye can open your saved results."}
          </p>
          <p className="settings-help">{permission.explanation}</p>

          {asked && permission.requested_by_name && (
            <p className="settings-help" data-testid="health-sharing-asked">
              {permission.requested_by_name} asked on {shortDate(permission.requested_at)}.
            </p>
          )}

          {permission.policy_version && permission.policy_version !== permission.current_policy_version && (
            <p className="settings-help" data-testid="health-sharing-older-terms">
              You decided against an earlier version of the terms ({permission.policy_version}); the current version is {permission.current_policy_version}.
            </p>
          )}

          <div className="settings-profile-actions">
            {!sharing && (
              <Link className="settings-save" href={reviewHref} data-testid="health-sharing-review">
                {asked ? "Review the request" : "Review and decide"} <span aria-hidden="true">&rarr;</span>
              </Link>
            )}
            {sharing && (
              <button className="settings-outline" type="button" disabled={busy}
                      onClick={() => void withdraw()}
                      data-testid="health-sharing-revoke">
                {busy ? "Saving…" : "Stop sharing"}
              </button>
            )}
          </div>

          {permission.events.length > 0 && (
            <>
              <p className="settings-help" style={{ marginTop: 18 }}><strong>What has happened</strong></p>
              <ul className="settings-session-list" data-testid="health-sharing-history">
                {permission.events.slice().reverse().map((event) => (
                  <li key={event.id}>
                    {describeEvent(event)} &middot; {shortDate(event.created_at)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function describeEvent(event: HealthPermissionEvent): string {
  switch (event.to_state) {
    case "requested": return `${event.actor_name || "The Veye team"} asked to see your results`;
    case "granted": return "You started sharing your results";
    case "declined": return "You chose not to share";
    case "revoked": return "You stopped sharing";
    default: return event.to_state;
  }
}

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";


/* Security — the member's own credentials and sessions. Everything here acts
   on the signed-in account only, and the member always proves who they are
   with their current password before anything changes. */
function SecuritySection({ account, onEmailChangeRequested }: { account: Account; onEmailChangeRequested: () => void }) {
  const session = useSession();
  const [open, setOpen] = useState<"password" | "email" | null>(null);
  const [busy, setBusy] = useState<"password" | "email" | "cancel" | "sessions" | "link" | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [emailForm, setEmailForm] = useState({ new_email: "", password: "" });
  const [sessions, setSessions] = useState<MemberSession[] | null>(null);

  const loadSessions = () => listMySessions().then((result) => setSessions(result.rows)).catch(() => setSessions(null));
  useEffect(() => { void loadSessions(); }, []);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setNote(null);
    if (passwords.next.length < 12) { setNote({ tone: "error", text: "Choose a password of at least 12 characters." }); return; }
    if (passwords.next !== passwords.confirm) { setNote({ tone: "error", text: "The two new passwords do not match." }); return; }
    setBusy("password");
    try {
      const result = await changeMyPassword(passwords.current, passwords.next);
      setPasswords({ current: "", next: "", confirm: "" });
      setOpen(null);
      setNote({ tone: "ok", text: result.message ?? "Your password has been changed." });
      await loadSessions();
    } catch (reason) {
      setNote({ tone: "error", text: reason instanceof Error ? reason.message : "That password could not be changed." });
    } finally { setBusy(null); }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setNote(null); setBusy("email");
    try {
      const delivery = await requestEmailChange(emailForm.new_email.trim(), emailForm.password);
      setEmailForm({ new_email: "", password: "" });
      setOpen(null);
      setNote(delivery.status === "sent"
        ? { tone: "ok", text: "Check the new address for a confirmation link. Your current address stays until you use it." }
        : { tone: "error", text: `The confirmation could not be sent: ${delivery.detail ?? "mail service unavailable"}.` });
      onEmailChangeRequested();
    } catch (reason) {
      setNote({ tone: "error", text: reason instanceof Error ? reason.message : "That address could not be set." });
    } finally { setBusy(null); }
  }

  async function cancelChange() {
    setBusy("cancel"); setNote(null);
    try {
      await cancelEmailChange();
      setNote({ tone: "ok", text: "The email change has been cancelled." });
      onEmailChangeRequested();
    } catch (reason) {
      setNote({ tone: "error", text: reason instanceof Error ? reason.message : "That could not be cancelled." });
    } finally { setBusy(null); }
  }

  async function endOtherSessions() {
    setBusy("sessions"); setNote(null);
    try {
      const result = await signOutEverywhereElse();
      setNote({ tone: "ok", text: result.message ?? "Other sessions were signed out." });
      await loadSessions();
    } catch (reason) {
      setNote({ tone: "error", text: reason instanceof Error ? reason.message : "Those sessions could not be ended." });
    } finally { setBusy(null); }
  }

  async function emailMeALink() {
    setBusy("link"); setNote(null);
    try {
      const result = await forgotPassword(account.email);
      setNote(result.delivery && result.delivery.status !== "sent"
        ? { tone: "error", text: `The link could not be sent: ${result.delivery.detail ?? "mail service unavailable"}.` }
        : { tone: "ok", text: "A password-change link has been emailed to you. It works once and expires in 30 minutes." });
    } catch (reason) {
      setNote({ tone: "error", text: reason instanceof Error ? reason.message : "The link could not be sent." });
    } finally { setBusy(null); }
  }

  const others = (sessions ?? []).filter((row) => !row.current).length;

  return (
    <section className="settings-card fade-in d4" data-testid="settings-security">
      <div className="settings-card__head"><div><span className="settings-kicker">Security</span><h2>Sign-in details</h2></div><span className="settings-card__mark">05</span></div>

      {/* Password */}
      {open === "password" ? (
        <form className="settings-fields settings-fields--security" method="post" onSubmit={(event) => void submitPassword(event)} noValidate>
          <label>Current password
            <input type="password" autoComplete="current-password" required value={passwords.current}
                   onChange={(e) => { const v = e.target.value; setPasswords((c) => ({ ...c, current: v })); }} data-testid="password-current" /></label>
          <label>New password
            <input type="password" autoComplete="new-password" required value={passwords.next}
                   onChange={(e) => { const v = e.target.value; setPasswords((c) => ({ ...c, next: v })); }} data-testid="password-new" /></label>
          <label>Confirm new password
            <input type="password" autoComplete="new-password" required value={passwords.confirm}
                   onChange={(e) => { const v = e.target.value; setPasswords((c) => ({ ...c, confirm: v })); }} data-testid="password-confirm" /></label>
          <div className="settings-profile-actions settings-profile-actions--form">
            <button className="settings-save" type="submit" disabled={busy === "password"} data-testid="password-save">
              {busy === "password" ? "Saving…" : "Save new password"}
            </button>
            <button className="settings-outline" type="button" onClick={() => { setOpen(null); setNote(null); }}>Cancel</button>
            <p className="settings-help">At least 12 characters. You stay signed in here; every other device is signed out.</p>
          </div>
        </form>
      ) : (
        <>
          <p className="settings-help">Change your password here, or have a single-use link emailed to you instead.</p>
          <button className="settings-outline" type="button" onClick={() => { setOpen("password"); setNote(null); }} data-testid="open-password">
            Change password <span aria-hidden="true">&rarr;</span>
          </button>
          <button className="settings-outline" type="button" disabled={busy === "link"} onClick={() => void emailMeALink()} data-testid="email-password-link">
            {busy === "link" ? "Sending…" : "Email me a change link"} <span aria-hidden="true">&rarr;</span>
          </button>
        </>
      )}

      {/* Email address */}
      {account.pending_email ? (
        <p className="settings-help settings-note" data-testid="pending-email">
          Waiting for you to confirm <b>{account.pending_email}</b> from that mailbox. Until then this account keeps{" "}
          {account.email}.{" "}
          <button className="settings-link" type="button" disabled={busy === "cancel"} onClick={() => void cancelChange()} data-testid="cancel-email-change">
            {busy === "cancel" ? "Cancelling…" : "Cancel the change"}
          </button>
        </p>
      ) : open === "email" ? (
        <form className="settings-fields settings-fields--security" method="post" onSubmit={(event) => void submitEmail(event)} noValidate>
          <label>New email address
            <input type="email" required value={emailForm.new_email}
                   onChange={(e) => { const v = e.target.value; setEmailForm((c) => ({ ...c, new_email: v })); }} data-testid="email-new" /></label>
          <label>Your password
            <input type="password" autoComplete="current-password" required value={emailForm.password}
                   onChange={(e) => { const v = e.target.value; setEmailForm((c) => ({ ...c, password: v })); }} data-testid="email-password" /></label>
          <div className="settings-profile-actions settings-profile-actions--form">
            <button className="settings-save" type="submit" disabled={busy === "email"} data-testid="email-save">
              {busy === "email" ? "Sending…" : "Send confirmation"}
            </button>
            <button className="settings-outline" type="button" onClick={() => { setOpen(null); setNote(null); }}>Cancel</button>
            <p className="settings-help">We email the new address a single-use link. Nothing changes until you use it.</p>
          </div>
        </form>
      ) : (
        <button className="settings-outline" type="button" onClick={() => { setOpen("email"); setNote(null); }} data-testid="open-email-change">
          Change email address <span aria-hidden="true">&rarr;</span>
        </button>
      )}

      {/* Sessions */}
      {sessions && sessions.length > 0 && (
        <div className="settings-sessions" data-testid="settings-sessions">
          <p className="settings-help">
            Signed in {sessions.length === 1 ? "here only" : `on ${sessions.length} sessions`}
            {others > 0 ? ` — ${others} other than this one.` : "."}
          </p>
          <ul className="settings-session-list">
            {/* The newest handful: an account that has been signed in many
                times should not turn this card into a wall of rows. */}
            {sessions.slice(0, 5).map((row) => (
              <li key={row.id} data-testid={row.current ? "session-current" : "session-other"}>
                <b>{row.portal === "admin" ? "Admin console" : "Member application"}</b>
                {row.current && <span className="settings-session-tag">this device</span>}
                <small>Last used {new Date(row.last_seen_at).toLocaleString()}{row.remember ? " · stays signed in" : ""}</small>
              </li>
            ))}
            {sessions.length > 5 && <li className="settings-session-more">and {sessions.length - 5} more</li>}
          </ul>
          {others > 0 && (
            <button className="settings-outline" type="button" disabled={busy === "sessions"} onClick={() => void endOtherSessions()} data-testid="revoke-others">
              {busy === "sessions" ? "Signing out…" : "Sign out everywhere else"} <span aria-hidden="true">&rarr;</span>
            </button>
          )}
        </div>
      )}

      {/* The approved destination for a member sign-out is the public site. */}
      <button className="settings-outline" type="button" onClick={() => void session.signOut("member", "/")}>Sign out <span aria-hidden="true">&rarr;</span></button>
      {note && <p className={`settings-help settings-note${note.tone === "error" ? " settings-note--error" : ""}`} role="status" data-testid="security-note">{note.text}</p>}
      <div className="settings-link-row"><Link className="settings-link" href="/privacy">Privacy</Link><Link className="settings-link" href="/terms">Terms</Link></div>
    </section>
  );
}
