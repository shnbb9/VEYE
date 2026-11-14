"use client";

import { useEffect, useState } from "react";
import { Chip, Icon, fmtDate } from "@/components/admin/admin-chrome";
import {
  applyShorterRetention, getPrivacySettings, previewRetention, publishRetention, runRetentionCleanup,
  type JobRun, type PrivacySettings, type RetentionChoice, type RetentionImpact,
} from "@/lib/prospects-api";

/* Privacy & prospects (architecture V2 §3): how long a visitor's saved result
   is kept when they do not sign up. The five choices are exactly the ones the
   product asked for. A new policy governs new saves; existing records keep the
   expiry they were saved with unless an administrator explicitly applies a
   SHORTER policy to them — the console has no way to lengthen what a visitor
   agreed to. */

const key = (c: RetentionChoice) => `${c.mode}:${c.days ?? ""}`;

export function PrivacyProspectsCard() {
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [choice, setChoice] = useState<RetentionChoice | null>(null);
  const [impact, setImpact] = useState<RetentionImpact | null>(null);
  const [forever, setForever] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"publish" | "apply" | "dry" | "run" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [lastRun, setLastRun] = useState<JobRun | null>(null);

  const load = () => getPrivacySettings().then((data) => {
    setSettings(data);
    setChoice({ mode: data.mode, days: data.days });
    setLastRun(data.last_cleanup);
  }).catch((reason) => setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Privacy settings could not be loaded." }));
  useEffect(() => { void load(); }, []);

  const changed = settings && choice ? key(choice) !== key({ mode: settings.mode, days: settings.days }) : false;

  // Counts for the choice being considered, before anything is published.
  useEffect(() => {
    if (!choice || !changed) { setImpact(null); return; }
    let live = true;
    previewRetention(choice).then((data) => { if (live) setImpact(data); }).catch(() => { if (live) setImpact(null); });
    return () => { live = false; };
  }, [choice, changed]);

  async function publish() {
    if (!choice) return;
    setBusy("publish"); setMessage(null);
    try {
      const data = await publishRetention({ ...choice, acknowledge_forever: choice.mode === "forever" && forever, note: note.trim() });
      setSettings(data); setChoice({ mode: data.mode, days: data.days }); setForever(false); setNote("");
      setMessage({ tone: "ok", text: `Published as version ${data.version}. New saved results follow it from now on; existing ones keep their own expiry.` });
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "The policy could not be published." });
    } finally { setBusy(null); }
  }

  async function applyShorter() {
    if (!settings) return;
    if (!window.confirm(`Apply "${settings.label}" to existing saved results? Expiry only ever moves earlier, and any result already past its new expiry is deleted now. This cannot be undone.`)) return;
    setBusy("apply"); setMessage(null);
    try {
      const outcome = await applyShorterRetention();
      setMessage({ tone: "ok", text: outcome.shortened === 0 ? "No existing saved result was kept longer than this policy allows — nothing changed."
        : `${outcome.shortened} saved result(s) now expire earlier; ${outcome.purged_now} were already past their new expiry and were deleted.` });
      await load();
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "That could not be applied." });
    } finally { setBusy(null); }
  }

  async function cleanup(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "run"); setMessage(null);
    try {
      const run = await runRetentionCleanup(dryRun);
      setLastRun(run);
      setMessage(run.status !== "ok"
        ? { tone: "error", text: `Cleanup failed: ${run.error ?? "unknown error"}` }
        : { tone: "ok", text: dryRun ? `${run.counts.due ?? 0} expired saved result(s) are waiting to be removed. Nothing was changed.`
          : `Removed ${run.counts.purged ?? 0} expired saved result(s).` });
      if (!dryRun) await load();
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Cleanup could not run." });
    } finally { setBusy(null); }
  }

  return (
    <div className="card" id="privacy-prospects" data-testid="privacy-prospects" style={{ gridColumn: "1 / -1" }}>
      <div className="card__head">
        <div>
          <h2 className="card__title">Privacy &amp; prospects</h2>
          <p className="t-support">How long a visitor&rsquo;s saved assessment result is kept if they do not sign up. Prospects are listed under <a href="/admin/members/prospects">Members → Prospects</a>.</p>
        </div>
        {settings && <Chip label={settings.is_default ? "Default: Never" : `Version ${settings.version}`} tone={settings.mode === "never" ? "draft" : "live"} />}
      </div>
      <div className="card__body stack gap-5">
        {!settings && !message && <p className="loading-row">Loading…</p>}
        {settings && choice && (
          <>
            <p className="t-support" data-testid="retention-current">
              Now: <strong>{settings.label}</strong>{settings.published_at ? ` — published ${fmtDate(settings.published_at)} by ${settings.published_by}.` : " — the built-in default; nothing has been published."}
            </p>
            {!settings.encryption_ready && (
              <div className="notice"><Icon name="alert-circle" size={18} /><div>This deployment has no encryption key for saved answers, so saving cannot be switched on. Set <code>VEYE_PROSPECT_ENCRYPTION_KEYS</code> from Secret Manager.</div></div>
            )}
            {settings.encryption_ready && settings.encryption_is_development_key && (
              <p className="t-support">Saved answers are sealed with the local development key — fine for synthetic data on this machine, never for a real deployment (production refuses to save without its own key).</p>
            )}
            <fieldset className="stack gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field__label">Keep unsigned-up quiz results</legend>
              <div className="row gap-2 wrap" role="radiogroup" aria-label="Keep unsigned-up quiz results">
                {settings.options.map((option) => {
                  const selected = key(option) === key(choice);
                  const disabled = option.mode !== "never" && !settings.encryption_ready;
                  return (
                    <label key={key(option)} className={`retention-option btn btn--sm ${selected ? "btn--primary" : "btn--secondary"}`} style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .5 : 1 }}>
                      <input type="radio" name="retention" className="sr-only" value={key(option)} checked={selected} disabled={disabled}
                             onChange={() => { setChoice({ mode: option.mode, days: option.days }); setMessage(null); }} data-testid={`retention-${option.mode}${option.days ?? ""}`} />
                      {option.label}{option.mode === "forever" ? "*" : ""}
                    </label>
                  );
                })}
              </div>
              <span className="field__hint">Never saves nothing (the visitor still sees their number). Forever* keeps results until they are deleted, and needs the owner&rsquo;s and counsel&rsquo;s approval.</span>
            </fieldset>

            {changed && (
              <div className="notice notice--quiet" data-testid="retention-impact">
                <Icon name="info" size={18} />
                <div>
                  <strong>Applies to new saved results only.</strong>{" "}
                  {impact ? (
                    <>There {impact.active === 1 ? "is" : "are"} {impact.active} saved result{impact.active === 1 ? "" : "s"} now.{" "}
                      {impact.lengthens_existing
                        ? "Existing ones keep their shorter expiry — a longer policy never extends what a visitor agreed to."
                        : `Applying it to them as well (a separate step) would shorten ${impact.would_shorten} and delete ${impact.would_expire_now} at once.`}</>
                  ) : "Counting existing saved results…"}
                </div>
              </div>
            )}

            {choice.mode === "forever" && changed && (
              <label className="row gap-2" style={{ alignItems: "flex-start" }}>
                <input type="checkbox" checked={forever} onChange={(event) => setForever(event.target.checked)} data-testid="retention-forever-ack" />
                <span className="t-support">I confirm the owner and counsel approved keeping unsigned-up results until they are deleted, and that the privacy notice says so. Deletion requests still apply.</span>
              </label>
            )}

            {changed && (
              <div className="field">
                <label className="field__label" htmlFor="retentionNote">Note for the history (optional)</label>
                <input className="input" id="retentionNote" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Approved by Cara on 14 Nov" />
              </div>
            )}

            {settings.notice_preview && (
              <div>
                <div className="t-eyebrow">What a visitor reads {settings.mode === "never" ? "(when saving is on)" : ""}</div>
                <p className="t-support" style={{ marginTop: 6 }} data-testid="retention-notice">&ldquo;{settings.notice_preview}&rdquo;</p>
                <p className="t-support"><Chip label="Draft wording" tone="attention" /> {settings.notice_status} Version <code>{settings.notice_version}</code>.</p>
              </div>
            )}

            <div className="rows">
              <div className="rowitem">
                <span className="rowitem__icon"><Icon name="clipboard" size={18} /></span>
                <div><div className="rowitem__title">Existing saved results</div>
                  <div className="rowitem__meta">{settings.counts.unregistered ?? 0} kept now · {settings.counts.expiring_within_7_days ?? 0} expire within 7 days · {settings.counts.awaiting_purge ?? 0} past expiry, waiting for cleanup.</div></div>
                <button className="btn btn--secondary btn--sm" type="button" disabled={busy !== null || settings.is_default} onClick={() => void applyShorter()} data-testid="retention-apply">
                  {busy === "apply" ? "Applying…" : "Apply current policy to existing"}
                </button>
              </div>
              <div className="rowitem">
                <span className="rowitem__icon"><Icon name="activity" size={18} /></span>
                <div><div className="rowitem__title">Cleanup</div>
                  <div className="rowitem__meta" data-testid="retention-last-run">{lastRun
                    ? `Last run ${fmtDate(lastRun.finished_at ?? lastRun.started_at)} (${lastRun.triggered_by}${lastRun.dry_run ? ", dry run" : ""}): ${lastRun.status === "ok" ? `${lastRun.counts.purged ?? 0} removed, ${lastRun.counts.due ?? 0} were due` : `failed — ${lastRun.error}`}.`
                    : "Has not run yet. Expired results are already unreachable; cleanup removes them physically."}</div></div>
                <span className="row gap-2">
                  <button className="btn btn--ghost btn--sm" type="button" disabled={busy !== null} onClick={() => void cleanup(true)} data-testid="retention-dry-run">{busy === "dry" ? "Checking…" : "Preview"}</button>
                  <button className="btn btn--secondary btn--sm" type="button" disabled={busy !== null} onClick={() => void cleanup(false)} data-testid="retention-run">{busy === "run" ? "Running…" : "Run cleanup now"}</button>
                </span>
              </div>
            </div>

            {settings.history.length > 0 && (
              <details className="disclose">
                <summary><Icon name="chevron-right" size={15} /> Version history ({settings.history.length})</summary>
                <ul className="rows" style={{ marginTop: 8 }} data-testid="retention-history">
                  {settings.history.map((row) => (
                    <li className="rowitem" key={row.version}><span className="rowitem__icon"><Icon name="file-text" size={16} /></span>
                      <div><div className="rowitem__title">v{row.version} · {row.label}</div><div className="rowitem__meta">{fmtDate(row.published_at)} by {row.published_by}{row.note ? ` — ${row.note}` : ""}</div></div></li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        {message && <p className={message.tone === "error" ? "errorbar" : "t-support"} role="status" data-testid="retention-message">{message.text}</p>}
      </div>
      {settings && (
        <div className="card__foot">
          <button className="btn btn--primary" type="button" disabled={!changed || busy !== null || (choice?.mode === "forever" && !forever)}
                  onClick={() => void publish()} data-testid="retention-publish">
            {busy === "publish" ? "Publishing…" : "Publish retention policy"}
          </button>
          {!changed && <span className="t-support">Choose a different option to publish a new version.</span>}
          {changed && choice?.mode === "forever" && !forever && <span className="t-support">Tick the confirmation to publish Forever.</span>}
        </div>
      )}
    </div>
  );
}
