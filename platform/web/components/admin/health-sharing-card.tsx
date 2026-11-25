"use client";

import { useEffect, useState } from "react";
import { Chip, Icon, fmtDate } from "@/components/admin/admin-chrome";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import {
  discardTemplateDraft, discardTermsDraft, getSharingSettings, previewTemplate, previewTerms, publishNotification,
  publishTemplate, publishTerms, saveTemplateDraft, saveTermsDraft, sendTemplateTest,
  type SharingSettings, type TemplateValue, type TermsValue,
} from "@/lib/sharing-admin-api";

/* Settings -> Product settings -> Health sharing (architecture V2 §4.2, §4.5).
   Three things, each versioned: how a request is sent (Manual, or Automatic
   once a new member has verified their address), the request email, and the
   terms a member reads before deciding. Edits are drafts until published; a
   published version never changes, so a member's past decision always reads
   against the words they were shown. What is shared, for how long, how to
   withdraw and what is not covered are fixed — they appear here read-only. */

const INTERVALS: Record<number, string> = { 24: "1 day", 72: "3 days", 168: "1 week", 336: "2 weeks" };

type Note = { tone: "ok" | "error"; text: string } | null;

export function HealthSharingCard() {
  const [settings, setSettings] = useState<SharingSettings | null>(null);
  const [error, setError] = useState("");
  const load = () => getSharingSettings().then(setSettings).catch((reason) => setError(reason instanceof Error ? reason.message : "Health sharing settings could not be loaded."));
  useEffect(() => { void load(); }, []);

  return (
    <div className="card" id="health-sharing" data-testid="health-sharing-settings" style={{ gridColumn: "1 / -1" }}>
      <div className="card__head">
        <div>
          <h2 className="card__title">Health sharing</h2>
          <p className="t-support">How a request to share health records reaches a member, and what they read before they decide. Members decide in the app; nothing here can decide for them.</p>
        </div>
        <Chip label="Draft wording" tone="attention" />
      </div>
      <div className="card__body stack gap-6">
        {error && <p className="errorbar">{error}</p>}
        {!settings && !error && <p className="loading-row">Loading…</p>}
        {settings && (
          <>
            <p className="t-support" data-testid="sharing-settings-status">{settings.status}</p>
            <ModeSection settings={settings} onSaved={setSettings} />
            <TemplateSection settings={settings} onSaved={setSettings} />
            <TermsSection settings={settings} onSaved={setSettings} />
          </>
        )}
      </div>
    </div>
  );
}

function ModeSection({ settings, onSaved }: { settings: SharingSettings; onSaved: (s: SharingSettings) => void }) {
  const current = settings.notification;
  const [form, setForm] = useState({ mode: current.mode, resend_interval_hours: current.resend_interval_hours, sender_name: current.sender_name });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const changed = form.mode !== current.mode || form.resend_interval_hours !== current.resend_interval_hours || form.sender_name.trim() !== current.sender_name;

  async function publish() {
    if (form.mode === "automatic" && current.mode !== "automatic" &&
        !window.confirm("Switch on automatic requests? From now on, every member who verifies their email address is asked once, by email. Members who verified earlier are not emailed.")) return;
    setBusy(true); setNote(null);
    try {
      const saved = await publishNotification({ ...form, sender_name: form.sender_name.trim() });
      onSaved(saved);
      setNote({ tone: "ok", text: `Published as version ${saved.notification.version}.` });
    } catch (reason) {
      setNote({ tone: "error", text: reason instanceof Error ? reason.message : "That could not be published." });
    } finally { setBusy(false); }
  }

  return (
    <section className="stack gap-3" data-testid="sharing-mode">
      <h3 className="t-eyebrow">Request mode</h3>
      <div className="row gap-4 wrap" role="radiogroup" aria-label="Request mode">
        <label className="row gap-2"><input type="radio" name="sharingMode" checked={form.mode === "manual"} onChange={() => setForm((f) => ({ ...f, mode: "manual" }))} data-testid="sharing-mode-manual" /> Manual — the team asks from Member 360</label>
        <label className="row gap-2"><input type="radio" name="sharingMode" checked={form.mode === "automatic"} onChange={() => setForm((f) => ({ ...f, mode: "automatic" }))} data-testid="sharing-mode-automatic" /> Automatic after a verified sign-up</label>
      </div>
      <p className="t-support">{settings.notification.backfill} A member who declined or withdrew is never asked automatically again.</p>
      <div className="row gap-4 wrap">
        <div className="field" style={{ minWidth: 200 }}>
          <label className="field__label" htmlFor="resendInterval">Earliest time to ask again</label>
          <select className="select" id="resendInterval" value={form.resend_interval_hours} onChange={(e) => setForm((f) => ({ ...f, resend_interval_hours: Number(e.target.value) }))}>
            {current.resend_choices.map((h) => <option key={h} value={h}>{INTERVALS[h] ?? `${h} hours`}</option>)}
          </select>
        </div>
        <div className="field" style={{ minWidth: 240 }}>
          <label className="field__label" htmlFor="senderName">Email signed as</label>
          <input className="input" id="senderName" maxLength={60} value={form.sender_name} onChange={(e) => setForm((f) => ({ ...f, sender_name: e.target.value }))} data-testid="sharing-sender-name" />
          <span className="field__hint">A display name only. The address is always Veye&rsquo;s authenticated sender; a personal name needs that person&rsquo;s approval.</span>
        </div>
      </div>
      <div className="row gap-3 wrap" style={{ alignItems: "center" }}>
        <button className="btn btn--primary btn--sm" type="button" disabled={!changed || busy || !form.sender_name.trim()} onClick={() => void publish()} data-testid="sharing-mode-publish" title={!changed ? "Nothing to save yet: change the mode, the interval or the sender first" : !form.sender_name.trim() ? "Not yet: the sender needs a name" : undefined}>{busy ? "Publishing…" : "Publish"}</button>
        <span className="t-support">{current.version ? `Version ${current.version}, ${fmtDate(current.published_at)} by ${current.published_by}.` : "Built-in default: Manual, nothing published yet."}</span>
      </div>
      {note && <p className={note.tone === "error" ? "errorbar" : "t-support"} role="status">{note.text}</p>}
    </section>
  );
}

function TemplateSection({ settings, onSaved }: { settings: SharingSettings; onSaved: (s: SharingSettings) => void }) {
  const t = settings.template;
  const [value, setValue] = useState<TemplateValue>(t.draft?.value ?? t.value);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const set = (patch: Partial<TemplateValue>) => { setValue((v) => ({ ...v, ...patch })); setDirty(true); setPreview(null); };

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setNote(null);
    try { await action(); } catch (reason) {
      setNote({ tone: "error", text: reason instanceof Error ? reason.message : "That did not work." });
    } finally { setBusy(null); }
  }

  return (
    <section className="stack gap-3" data-testid="sharing-template">
      <h3 className="t-eyebrow">Request email {t.draft && <Chip label="Unpublished draft" tone="attention" />}</h3>
      <div className="field">
        <label className="field__label" htmlFor="sharingSubject">Subject</label>
        <input className="input" id="sharingSubject" maxLength={180} value={value.subject} onChange={(e) => set({ subject: e.target.value })} data-testid="sharing-subject" />
      </div>
      <RichTextEditor id="sharingBody" label="Message" value={value.body} onChange={(body) => set({ body })} testId="sharing-body" variables={t.variables} />
      <p className="t-support">The button always reads <b>{t.cta_label}</b> and opens the app; it grants nothing by itself.</p>
      <div className="row gap-2 wrap">
        <button className="btn btn--secondary btn--sm" type="button" disabled={busy !== null} data-testid="sharing-template-save"
                onClick={() => void run("save", async () => { const s = await saveTemplateDraft(value); onSaved(s); setDirty(false); setNote({ tone: "ok", text: "Draft saved. Members still receive the published version." }); })}>
          {busy === "save" ? "Saving…" : "Save draft"}</button>
        <button className="btn btn--ghost btn--sm" type="button" disabled={busy !== null} data-testid="sharing-template-preview"
                onClick={() => void run("preview", async () => setPreview(await previewTemplate(value)))}>{busy === "preview" ? "Rendering…" : "Preview"}</button>
        <button className="btn btn--ghost btn--sm" type="button" disabled={busy !== null} data-testid="sharing-template-test"
                onClick={() => void run("test", async () => { const r = await sendTemplateTest(value); setNote(r.status === "sent" ? { tone: "ok", text: `A test was sent to ${r.to}.` } : { tone: "error", text: `The test could not be sent: ${r.error ?? r.status}.` }); })}>
          {busy === "test" ? "Sending…" : "Send me a test"}</button>
        <button className="btn btn--primary btn--sm" type="button" disabled={busy !== null || dirty || !t.draft} data-testid="sharing-template-publish"
                title={dirty ? "Save the draft first" : !t.draft ? "Nothing to publish: save a draft first" : undefined}
                onClick={() => void run("publish", async () => { const s = await publishTemplate(); onSaved(s); setValue(s.template.value); setNote({ tone: "ok", text: `Published as version ${s.template.version}.` }); })}>
          {busy === "publish" ? "Publishing…" : "Publish"}</button>
        {t.draft && <button className="btn btn--ghost btn--sm" type="button" disabled={busy !== null}
                onClick={() => void run("discard", async () => { const s = await discardTemplateDraft(); onSaved(s); setValue(s.template.value); setDirty(false); })}>Discard draft</button>}
      </div>
      <span className="t-support">{t.version ? `Published version ${t.version}.` : "Members receive the built-in default until a version is published."}{dirty ? " You have unsaved changes." : ""}</span>
      {note && <p className={note.tone === "error" ? "errorbar" : "t-support"} role="status" data-testid="sharing-template-note">{note.text}</p>}
      {preview && (
        <div className="stack gap-2" data-testid="sharing-template-preview-panel">
          <div className="t-support"><b>Subject:</b> {preview.subject}</div>
          {/* sandbox="" : no scripts, no forms, no same-origin access. */}
          <iframe className="preview-frame" title="Email preview" sandbox="" srcDoc={preview.html} />
          <details><summary className="t-support">Plain-text version</summary><pre style={{ whiteSpace: "pre-wrap" }}>{preview.text}</pre></details>
        </div>
      )}
    </section>
  );
}

function TermsSection({ settings, onSaved }: { settings: SharingSettings; onSaved: (s: SharingSettings) => void }) {
  const t = settings.terms;
  const [value, setValue] = useState<TermsValue>(t.draft?.value ?? t.value);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewTerms>> | null>(null);
  const set = (patch: Partial<TermsValue>) => { setValue((v) => ({ ...v, ...patch })); setDirty(true); setPreview(null); };

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setNote(null);
    try { await action(); } catch (reason) {
      setNote({ tone: "error", text: reason instanceof Error ? reason.message : "That did not work." });
    } finally { setBusy(null); }
  }

  return (
    <section className="stack gap-3" data-testid="sharing-terms">
      <h3 className="t-eyebrow">What members read before deciding {t.draft && <Chip label="Unpublished draft" tone="attention" />}</h3>
      <RichTextEditor id="termsSummary" label="Summary" value={value.summary} onChange={(summary) => set({ summary })} testId="terms-summary" variables={t.variables} />
      <div className="row gap-4 wrap">
        <div className="field" style={{ flex: "1 1 280px" }}>
          <label className="field__label" htmlFor="termsRecipient">Who receives it (required)</label>
          <input className="input" id="termsRecipient" maxLength={160} value={value.recipient} onChange={(e) => set({ recipient: e.target.value })} data-testid="terms-recipient" />
        </div>
        <div className="field" style={{ flex: "2 1 360px" }}>
          <label className="field__label" htmlFor="termsPurpose">Why (required)</label>
          <input className="input" id="termsPurpose" maxLength={300} value={value.purpose} onChange={(e) => set({ purpose: e.target.value })} data-testid="terms-purpose" />
        </div>
      </div>
      <RichTextEditor id="termsDetails" label="Full terms" value={value.details} onChange={(details) => set({ details })} testId="terms-details" variables={t.variables} />
      <div className="notice notice--quiet">
        <Icon name="lock" size={18} />
        <div>
          <strong>Fixed — always shown, not editable here:</strong> what is shared ({t.locked.categories.join("; ")}), {t.locked.companion_use}{" "}
          For how long: {t.locked.expiry_rule} {t.locked.withdrawal} Not covered: {t.locked.not_covered}
        </div>
      </div>
      <div className="row gap-2 wrap">
        <button className="btn btn--secondary btn--sm" type="button" disabled={busy !== null} data-testid="terms-save"
                onClick={() => void run("save", async () => { const s = await saveTermsDraft(value); onSaved(s); setDirty(false); setNote({ tone: "ok", text: "Draft saved. Members still read the published version." }); })}>
          {busy === "save" ? "Saving…" : "Save draft"}</button>
        <button className="btn btn--ghost btn--sm" type="button" disabled={busy !== null} data-testid="terms-preview"
                onClick={() => void run("preview", async () => setPreview(await previewTerms(value)))}>{busy === "preview" ? "Rendering…" : "Preview"}</button>
        <button className="btn btn--primary btn--sm" type="button" disabled={busy !== null || dirty || !t.draft} data-testid="terms-publish"
                title={dirty ? "Save the draft first" : !t.draft ? "Nothing to publish: save a draft first" : undefined}
                onClick={() => void run("publish", async () => {
                  if (preview?.material_change && !window.confirm("This changes who receives the records or why. Members who already decided agreed to the earlier wording; they will see that a newer version exists. Publish?")) return;
                  const s = await publishTerms(); onSaved(s); setValue(s.terms.value); setNote({ tone: "ok", text: `Published as version ${s.terms.version}. New decisions are recorded against it.` });
                })}>{busy === "publish" ? "Publishing…" : "Publish"}</button>
        {t.draft && <button className="btn btn--ghost btn--sm" type="button" disabled={busy !== null}
                onClick={() => void run("discard", async () => { const s = await discardTermsDraft(); onSaved(s); setValue(s.terms.value); setDirty(false); })}>Discard draft</button>}
      </div>
      <span className="t-support">Current: {t.label}{t.version ? "" : " (built-in default)"}.{dirty ? " You have unsaved changes." : ""}</span>
      {note && <p className={note.tone === "error" ? "errorbar" : "t-support"} role="status" data-testid="terms-note">{note.text}</p>}
      {preview && (
        <div className="card" data-testid="terms-preview-panel"><div className="card__body stack gap-2">
          {preview.material_change && <p className="errorbar">Material change: who receives the records or why has changed.</p>}
          {/* Generated server-side from the validated tree; escaped text only. */}
          <div className="consent-preview" dangerouslySetInnerHTML={{ __html: preview.summary_html }} />
          <ul>{preview.categories.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="consent-preview" dangerouslySetInnerHTML={{ __html: preview.details_html }} />
        </div></div>
      )}
      {t.history.length > 0 && (
        <details className="disclose"><summary><Icon name="chevron-right" size={15} /> Published versions ({t.history.length})</summary>
          <ul className="rows" style={{ marginTop: 8 }}>{t.history.map((row) => (
            <li className="rowitem" key={row.version}><span className="rowitem__icon"><Icon name="file-text" size={16} /></span>
              <div><div className="rowitem__title">Version {row.version}</div><div className="rowitem__meta">{fmtDate(row.published_at)} by {row.published_by}{row.note ? ` — ${row.note}` : ""}</div></div></li>
          ))}</ul>
        </details>
      )}
    </section>
  );
}
