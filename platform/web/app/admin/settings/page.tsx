"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Chip, Icon, PageHead, Subnav, fmtDate } from "@/components/admin/admin-chrome";
import { useSession } from "@/components/session";
import { forgotPassword } from "@/lib/auth-api";
import { getFeatureStates, getSupportSettings, saveSupportSettings, type FeatureState, type SupportDetails } from "@/lib/admin-console-api";

/* Settings (admin prototype screens/settings.js): the small set of account
   and product controls the Beta needs — your own account, the support
   details member surfaces print, and an honest read-only list of what is
   available and what waits on the client. No roles, teams or invitations:
   VEYE keeps one plain administrator capability. */

const MODES = [
  { key: "account", label: "Your account", href: "/admin/settings?section=account" },
  { key: "product", label: "Product settings", href: "/admin/settings?section=product" },
  { key: "features", label: "Feature states", href: "/admin/settings?section=features" },
] as const;

const STATE_TONE: Record<FeatureState["state"], string> = { available: "live", holding: "draft", client_input: "attention", phase_2: "archived" };

export default function SettingsPage() {
  return <Suspense fallback={null}><Settings /></Suspense>;
}

function Settings() {
  const search = useSearchParams();
  const mode = MODES.find((m) => m.key === search.get("section"))?.key ?? "account";
  return (
    <div className="page">
      <PageHead title="Settings" desc="The small set of account and product controls the Beta needs." crumbs={[{ label: "Home", href: "/admin" }, { label: "Settings" }]} />
      <Subnav items={MODES} active={mode} />
      {mode === "account" && <AccountSection />}
      {mode === "product" && <ProductSection />}
      {mode === "features" && <FeaturesSection />}
    </div>
  );
}

function AccountSection() {
  const session = useSession();
  const account = session.admin;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!account) return null;
  const initials = `${account.first_name[0] ?? ""}${account.last_name[0] ?? ""}`.toUpperCase();

  async function changePassword() {
    setBusy(true);
    try {
      const result = await forgotPassword(account!.email, "admin");
      setNote(result.delivery && result.delivery.status !== "sent"
        ? `The password-change link could not be sent: ${result.delivery.detail ?? "mail service unavailable"}.`
        : "A password-change link has been emailed to you (local development mailbox). It works once and expires in 30 minutes.");
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "The password-change link could not be sent.");
    } finally { setBusy(false); }
  }

  return (
    <div className="hgrid" data-testid="settings-account">
      <div className="card">
        <div className="card__head"><div><h2 className="card__title">{account.first_name} {account.last_name}</h2><p className="t-support">Administrator</p></div><span className="avatar avatar--lg">{initials}</span></div>
        <div className="card__body stack gap-5">
          <div><div className="t-eyebrow">Email</div><p data-testid="settings-admin-email">{account.email}</p></div>
          <div><div className="t-eyebrow">Access</div><p>Full VEYE administration{account.member_access ? " · also holds a member profile (signs into the member application separately at /login)" : ""}</p></div>
          <div className="notice notice--quiet"><Icon name="info" size={18} /><div>This Beta console has one administrator capability. Roles, teams, invitations and organisation hierarchies are intentionally not included; every administrator account can do the same things.</div></div>
        </div>
      </div>
      <div className="card">
        <div className="card__head"><div><h2 className="card__title">Account security</h2><p className="t-support">Passwords change through a single-use emailed link.</p></div></div>
        <div className="card__body card__body--flush"><div className="rows">
          <div className="rowitem"><span className="rowitem__icon"><Icon name="lock" size={18} /></span><div><div className="rowitem__title">Password</div><div className="rowitem__meta">Sends a reset link to {account.email}; the link returns you to the console sign-in.</div></div><button className="btn btn--secondary btn--sm" type="button" disabled={busy} onClick={() => void changePassword()}>{busy ? "Sending…" : "Send reset link"}</button></div>
          <div className="rowitem"><span className="rowitem__icon rowitem__icon--off"><Icon name="shield" size={18} /></span><div><div className="rowitem__title">Two-step verification</div><div className="rowitem__meta">Not built. A production identity decision (provider, enforcement) belongs to the client.</div></div><Chip label="Client input" tone="attention" /></div>
          <div className="rowitem"><span className="rowitem__icon"><Icon name="log-out" size={18} /></span><div><div className="rowitem__title">Sign out</div><div className="rowitem__meta">Ends this console session only; a member session in the same browser stays.</div></div><button className="btn btn--ghost btn--sm" type="button" onClick={() => void session.signOut("admin", "/admin/login?flash=signed-out")}>Sign out</button></div>
        </div></div>
        {note && <div className="card__foot"><p className="t-support" role="status">{note}</p></div>}
      </div>
    </div>
  );
}

function ProductSection() {
  const [saved, setSaved] = useState<SupportDetails | null>(null);
  const [form, setForm] = useState({ support_email: "", support_phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    getSupportSettings().then((data) => { setSaved(data); setForm({ support_email: data.support_email, support_phone: data.support_phone }); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Settings could not be loaded."));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await saveSupportSettings(form);
      setSaved(data);
      setForm({ support_email: data.support_email, support_phone: data.support_phone });
      setNotice("Support details saved. The member dashboard's Contact Us card and the public Help page read them on their next load.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The settings could not be saved.");
    } finally { setBusy(false); }
  }

  return (
    <div className="hgrid" data-testid="settings-product">
      <form className="card" onSubmit={(event) => void save(event)}>
        <div className="card__head"><div><h2 className="card__title">Member support</h2><p className="t-support">The contact details shown on the member dashboard (Contact Us) and offered on the Help page.</p></div></div>
        <div className="card__body stack gap-5">
          {error && <p className="errorbar">{error}</p>}
          {!saved && !error && <p className="loading-row">Loading…</p>}
          {saved && <>
          <div className="field"><label className="field__label" htmlFor="supportEmail">Support email</label><input className="input" id="supportEmail" type="email" required value={form.support_email} onChange={(e) => { const value = e.target.value; setForm((current) => ({ ...current, support_email: value })); }} data-testid="support-email-input" /></div>
          <div className="field"><label className="field__label" htmlFor="supportPhone">Support phone <span className="t-support">(optional)</span></label><input className="input" id="supportPhone" type="tel" value={form.support_phone} onChange={(e) => { const value = e.target.value; setForm((current) => ({ ...current, support_phone: value })); }} maxLength={40} data-testid="support-phone-input" /></div>
          </>}
          {saved?.updated_at && <p className="t-support">Last saved {fmtDate(saved.updated_at)}{saved.updated_by ? ` by ${saved.updated_by}` : ""}.</p>}
          {notice && <p className="t-support" role="status" data-testid="support-saved">{notice}</p>}
        </div>
        <div className="card__foot"><button className="btn btn--primary" type="submit" disabled={busy || !saved} data-testid="support-save">{busy ? "Saving…" : "Save support details"}</button></div>
      </form>
      <div className="card">
        <div className="card__head"><div><h2 className="card__title">Beta defaults</h2><p className="t-support">Behaviour the console could switch once it exists.</p></div></div>
        <div className="card__body card__body--flush"><div className="rows">
          <div className="rowitem"><span className="rowitem__icon"><Icon name="edit" size={18} /></span><div><div className="rowitem__title">Daily health tip</div><div className="rowitem__meta">Written and published in <Link href="/admin/content?group=member_copy">Content → Member copy</Link> (key <code>daily_health_tip</code>); the dashboard shows the published text.</div></div><Chip label="Content" tone="live" /></div>
          <div className="rowitem"><span className="rowitem__icon rowitem__icon--off"><Icon name="bell" size={18} /></span><div><div className="rowitem__title">Tracker reminders</div><div className="rowitem__meta">No reminder is sent yet; members see the same &ldquo;not connected&rdquo; note in their Settings. A switch will appear here with the reminder release.</div></div><Chip label="Not built" tone="draft" /></div>
          <div className="rowitem"><span className="rowitem__icon"><Icon name="sprout" size={18} /></span><div><div className="rowitem__title">Companion review queue</div><div className="rowitem__meta">Sensitive replies are held for review in <Link href="/admin/companion/settings">Companion → Settings</Link>, where Sprout&rsquo;s wording and topic rules live.</div></div><Chip label="Companion" tone="live" /></div>
        </div></div>
      </div>
    </div>
  );
}

function FeaturesSection() {
  const [rows, setRows] = useState<FeatureState[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { getFeatureStates().then(setRows).catch((reason) => setError(reason instanceof Error ? reason.message : "Feature states could not be loaded.")); }, []);
  return (
    <div className="card" data-testid="settings-features">
      <div className="card__head"><div><h2 className="card__title">Feature states</h2><p className="t-support">Derived from what is built and what the client has supplied — there is no switch here.</p></div></div>
      <div className="card__body card__body--flush">
        {error && <p className="errorbar">{error}</p>}
        {!rows && !error && <p className="loading-row">Loading…</p>}
        {rows && (
          <div className="table-wrap"><table className="table table--rows">
            <thead className="sr-only"><tr><th scope="col">Area</th><th scope="col">State</th><th scope="col">Note</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td><div className="cell-primary">{row.label}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}><Chip label={row.state_label} tone={STATE_TONE[row.state]} /></td>
                  <td className="t-support">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
