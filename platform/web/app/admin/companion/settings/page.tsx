"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ADVANCED_NAV, Icon, fmtDate } from "@/components/admin/admin-chrome";
import { CompanionPage } from "@/components/admin/companion-page";
import { getSettings, saveSettings, type Settings, type SettingsInput } from "@/lib/admin-api";

/* Companion settings (admin prototype screens/companion.js `settings`): is
   Companion on, what it says, quick prompts, what it may talk about — now
   persisted in PostgreSQL and read by the policy engine on every message.
   Settings → Advanced holds the operational surfaces. */

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<SettingsInput | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSettings().then((data) => { setSettings(data); setDraft(toInput(data)); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Settings could not be loaded."));
  }, []);

  async function save() {
    if (!draft) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = await saveSettings(draft);
      setSettings(saved); setDraft(toInput(saved));
      setNotice("Companion settings saved. Members see the new wording and topic rules on their next message.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settings could not be saved.");
    } finally { setBusy(false); }
  }

  if (!draft || !settings) return <CompanionPage active="settings">{error ? <p className="errorbar">{error}</p> : <p className="loading-row">Loading…</p>}</CompanionPage>;

  const text = (key: keyof Pick<SettingsInput, "name" | "welcome" | "returning_welcome" | "safe_response" | "fallback" | "escalation_response">, label: string, hint: string, rows = 3) => (
    <div className="field">
      <label htmlFor={`c-${key}`}>{label}</label>
      {rows === 1 ? <input className="input" id={`c-${key}`} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        : <textarea className="textarea" id={`c-${key}`} rows={rows} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />}
      <span className="t-support">{hint}</span>
    </div>
  );

  return (
    <CompanionPage active="settings" actions={<button className="btn btn--primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>}>
      {error && <p className="errorbar">{error}</p>}
      {notice && <div className="notice notice--quiet" style={{ marginBottom: "var(--s-4)" }}><Icon name="info" size={18} /><div>{notice}</div></div>}
      <div className="hgrid">
        <div className="stack gap-5">
          <div className="card">
            <div className="card__head">
              <div><h2 className="card__title">Is Companion on?</h2><p className="t-support">When it is off, members see the rest of their dashboard as normal and Sprout declines to answer.</p></div>
              <label className="switch">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                <span className="switch__track" />
                <span className="check__text">{draft.enabled ? "On for everyone" : "Off"}</span>
              </label>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><div><h2 className="card__title">What Companion says</h2></div></div>
            <div className="card__body stack gap-5">
              {text("name", "Companion name", "Shown in the member chat header.", 1)}
              {text("welcome", "Opening message (first visit)", "The first thing a member reads when they open Companion.")}
              {text("returning_welcome", "Opening message (returning)", "Shown when the member has talked to Sprout before.")}
              {text("safe_response", "When a question needs a person", "Used for anything about an amount, a symptom or a medicine.")}
              {text("fallback", "When the question is off-topic", "Used when the question has nothing to do with Veye.")}
              {text("escalation_response", "When the conversation is handed to a person", "Sent instead of an answer; the conversation is flagged for review and the team is notified.")}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <div><h2 className="card__title">Quick prompts</h2><p className="t-support">The suggestions a member can tap instead of typing.</p></div>
              <button className="btn btn--secondary btn--sm" type="button" onClick={() => setDraft({ ...draft, quick_prompts: [...draft.quick_prompts, { id: `QP-${Date.now().toString(36)}`, label: "New prompt", prompt: "", active: true }] })}><Icon name="plus" size={16} /> Add a prompt</button>
            </div>
            <div className="card__body card__body--flush">
              <div className="rows">
                {draft.quick_prompts.map((prompt, index) => (
                  <div key={prompt.id} className="rowitem" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr) auto" }}>
                    <input className="input input--sm" aria-label="What the member taps" value={prompt.label} onChange={(e) => setDraft({ ...draft, quick_prompts: draft.quick_prompts.map((p, i) => i === index ? { ...p, label: e.target.value } : p) })} />
                    <input className="input input--sm" aria-label="What it asks Companion" value={prompt.prompt} placeholder="What it asks Companion" onChange={(e) => setDraft({ ...draft, quick_prompts: draft.quick_prompts.map((p, i) => i === index ? { ...p, prompt: e.target.value } : p) })} />
                    <div className="rowitem__side row gap-2">
                      <label className="switch"><input type="checkbox" checked={prompt.active} onChange={(e) => setDraft({ ...draft, quick_prompts: draft.quick_prompts.map((p, i) => i === index ? { ...p, active: e.target.checked } : p) })} /><span className="switch__track" /><span className="sr-only">Show to members</span></label>
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => setDraft({ ...draft, quick_prompts: draft.quick_prompts.filter((_, i) => i !== index) })}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="stack gap-5">
          <div className="card">
            <div className="card__head"><div><h2 className="card__title">What Companion may talk about</h2>
              <p className="t-support">Anything outside this list gets the off-topic wording. Keywords decide the topic; edit them as comma-separated words or phrases.</p></div></div>
            <div className="card__body card__body--flush">
              <div className="rows">
                {draft.policy.topics.map((topic, index) => (
                  <div key={topic.key} className="rowitem" style={{ gridTemplateColumns: "44px minmax(0,1fr) auto" }}>
                    <span className={`rowitem__icon${topic.allowed ? "" : " rowitem__icon--warn"}`}><Icon name={topic.allowed ? "check-circle" : "lock"} size={18} /></span>
                    <div>
                      <div className="rowitem__title">{topic.label}</div>
                      <textarea className="textarea" rows={2} aria-label={`Keywords for ${topic.label}`} value={topic.keywords.join(", ")}
                                onChange={(e) => setDraft({ ...draft, policy: { ...draft.policy, topics: draft.policy.topics.map((t, i) => i === index ? { ...t, keywords: splitKeywords(e.target.value) } : t) } })} />
                      <div className="rowitem__meta">Retrieval: {topic.retrieval_scopes.map((s) => settings.retrieval_scope_options[s] ?? s).join(", ") || "none"} · Member data: {topic.member_data_scopes.join(", ") || "none"}</div>
                    </div>
                    <div className="rowitem__side">
                      <label className="switch"><input type="checkbox" checked={topic.allowed} onChange={(e) => setDraft({ ...draft, policy: { ...draft.policy, topics: draft.policy.topics.map((t, i) => i === index ? { ...t, allowed: e.target.checked } : t) } })} /><span className="switch__track" /><span className="sr-only">Allow {topic.label}</span></label>
                    </div>
                  </div>
                ))}
                {draft.policy.prohibited.map((rule, index) => (
                  <div key={rule.key} className="rowitem" style={{ gridTemplateColumns: "44px minmax(0,1fr) auto" }}>
                    <span className="rowitem__icon rowitem__icon--warn"><Icon name="lock" size={18} /></span>
                    <div>
                      <div className="rowitem__title">{rule.label}</div>
                      <textarea className="textarea" rows={2} aria-label={`Keywords for ${rule.label}`} value={rule.keywords.join(", ")}
                                onChange={(e) => setDraft({ ...draft, policy: { ...draft.policy, prohibited: draft.policy.prohibited.map((r, i) => i === index ? { ...r, keywords: splitKeywords(e.target.value) } : r) } })} />
                      {rule.why && <div className="rowitem__meta">{rule.why}</div>}
                    </div>
                    <div className="rowitem__side"><span className={`chip ${rule.action === "escalate" ? "chip--error" : "chip--attention"}`}>{rule.action === "escalate" ? "Handed to a person" : "Safe response"}</span></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card__foot" style={{ display: "block" }}>
              <div className="notice notice--quiet"><Icon name="info" size={18} /><div>Companion does not diagnose, treat or prevent any condition. Questions about symptoms, medicines or amounts are always handed to a person or answered with the safe response.</div></div>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Member data Sprout may use</h2><p className="t-support">Short structured summaries only — never the raw record, never contact details.</p></div></div>
            <div className="card__body stack gap-3">
              {settings.member_data_scope_options.map((scope) => (
                <label key={scope} className="switch">
                  <input type="checkbox" checked={draft.policy.member_data_scopes_enabled.includes(scope)}
                         onChange={(e) => setDraft({ ...draft, policy: { ...draft.policy, member_data_scopes_enabled: e.target.checked ? [...draft.policy.member_data_scopes_enabled, scope] : draft.policy.member_data_scopes_enabled.filter((s) => s !== scope) } })} />
                  <span className="switch__track" /><span className="check__text">{scope.replace(/_/g, " ")}</span>
                </label>
              ))}
              <p className="t-support">Mood and food-pattern summaries report “not available” until those trackers are connected in the application.</p>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Guided Experiences</h2><p className="t-support">The step-by-step guides Sprout walks members through — Cara&rsquo;s First-Time User and Progress Tracker decision trees, published as numbered versions.</p></div></div>
            <div className="card__body card__body--flush">
              <div className="rows">
                <Link className="rowitem" href="/admin/companion/settings/guided-experiences" style={{ gridTemplateColumns: "minmax(0,1fr) auto", textDecoration: "none" }}>
                  <div><div className="rowitem__title">First-Time User &middot; Progress Tracker Guide</div><div className="rowitem__meta">Status, active version, member sessions, read-only preview, activate / deactivate.</div></div>
                  <span className="rowitem__side"><Icon name="chevron-right" size={18} /></span>
                </Link>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Advanced</h2><p className="t-support">Operational monitoring for the development environment.</p></div></div>
            <div className="card__body card__body--flush">
              <div className="rows">
                {ADVANCED_NAV.map((item) => (
                  <Link key={item.key} className="rowitem" href={item.href} style={{ gridTemplateColumns: "minmax(0,1fr) auto", textDecoration: "none" }}>
                    <div className="rowitem__title">{item.label}</div>
                    <span className="rowitem__side"><Icon name="chevron-right" size={18} /></span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="card__foot"><span className="t-support">Policy {settings.policy.version} · last saved {fmtDate(settings.updated_at)}{settings.updated_by ? ` by ${settings.updated_by}` : ""}</span></div>
          </div>
        </div>
      </div>
    </CompanionPage>
  );
}

function toInput(settings: Settings): SettingsInput {
  return {
    enabled: settings.enabled, name: settings.name, welcome: settings.welcome, returning_welcome: settings.returning_welcome,
    safe_response: settings.safe_response, fallback: settings.fallback, escalation_response: settings.escalation_response,
    quick_prompts: settings.quick_prompts, policy: settings.policy,
  };
}

function splitKeywords(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
