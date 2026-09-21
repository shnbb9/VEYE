"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Chip, Icon, PageHead, Subnav, fmtDate } from "@/components/admin/admin-chrome";
import { Drawer, Field } from "@/components/admin/drawer";
import {
  CONTENT_GROUPS,
  CONTENT_GROUP_LABELS,
  createContentEntry,
  getContentSummary,
  listContentEntries,
  transitionContentEntry,
  updateContentEntry,
  type ContentEntry,
  type ContentEntryInput,
  type ContentGroup,
  type ContentGroupSummary,
  type LifecycleAction,
} from "@/lib/admin-console-api";

/* Content (admin prototype screens/content.js): the copy Veye prints —
   Help / FAQ and the member educational lines — with a Draft → Published →
   Archived lifecycle. Care Studio content (Fitness, Supplements, Resources)
   has its own area. Deterministic health scoring is never content and has no
   entry here. */

const EMPTY: ContentEntryInput = { group: "help_faq", key: "", category: null, title: "", body: "", display_order: 0 };

export default function ContentPage() {
  return <Suspense fallback={null}><Content /></Suspense>;
}

function Content() {
  const search = useSearchParams();
  const group: ContentGroup = (CONTENT_GROUPS.find((g) => g === search.get("group")) ?? "help_faq");
  const [summary, setSummary] = useState<ContentGroupSummary[] | null>(null);
  const [entries, setEntries] = useState<ContentEntry[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ entry: ContentEntry | null; form: ContentEntryInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [filter, setFilter] = useState("");

  const load = useCallback(() => {
    getContentSummary().then(setSummary).catch(() => setSummary(null));
    listContentEntries(group).then(setEntries).catch((reason) => setError(reason instanceof Error ? reason.message : "Content could not be loaded."));
  }, [group]);

  useEffect(() => { load(); }, [load]);

  const summaryFor = summary?.find((s) => s.group === group);
  const shown = (entries ?? []).filter((e) => !filter.trim() || `${e.title} ${e.category ?? ""} ${e.key}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const categories = Array.from(new Set(shown.map((e) => e.category ?? "")));

  async function act(entry: ContentEntry, action: LifecycleAction) {
    setBusy(true); setError("");
    try {
      const saved = await transitionContentEntry(entry.id, action);
      setEntries((current) => current ? current.map((e) => (e.id === saved.id ? saved : e)) : current);
      load();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That change could not be saved."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!editing) return;
    const form = { ...editing.form, key: editing.form.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""), category: editing.form.category?.trim() || null };
    if (!form.title.trim()) { setFormError("Give the entry a title."); return; }
    if (form.key.length < 2) { setFormError("Give the entry a key (letters, numbers, underscores)."); return; }
    setBusy(true); setFormError("");
    try {
      const saved = editing.entry ? await updateContentEntry(editing.entry.id, form) : await createContentEntry(form);
      // Show the server's row at once (the list refresh follows) so the table
      // never lags the save.
      setEntries((current) => current
        ? (current.some((e) => e.id === saved.id) ? current.map((e) => (e.id === saved.id ? saved : e)) : [...current, saved]).filter((e) => e.group === group)
        : current);
      setEditing(null);
      load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "The entry could not be saved.");
    } finally { setBusy(false); }
  }

  const setForm = (patch: Partial<ContentEntryInput>) => setEditing((current) => current ? { ...current, form: { ...current.form, ...patch } } : current);

  return (
    <div className="page">
      <PageHead title="Content" desc="The words the product prints: Help / FAQ and the member educational copy. Fitness, Supplements and Resources live in Care Studio."
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Content" }]}
                actions={<button className="btn btn--primary" type="button" onClick={() => { setFormError(""); setEditing({ entry: null, form: { ...EMPTY, group, display_order: (entries?.length ?? 0) + 1 } }); }}><Icon name="plus" size={18} /> New entry</button>} />
      {error && <p className="errorbar">{error}</p>}

      <Subnav items={CONTENT_GROUPS.map((g) => ({ key: g, label: CONTENT_GROUP_LABELS[g], href: `/admin/content?group=${g}`, count: summary?.find((s) => s.group === g)?.published }))} active={group} />

      <div className="statusstrip" style={{ "--strip-tone": "var(--status-info)" } as React.CSSProperties}>
        <span className="statusstrip__icon"><Icon name="lock" size={18} /></span>
        <span className="statusstrip__text"><b>Not content:</b> Health Number weights, Health Assessment bands, Simple Quiz counting, body-fat tables and blood-marker goals are system managed. See <Link href="/admin/assessments">Assessments</Link>.</span>
      </div>

      {summaryFor && (
        <div className="kpis" style={{ marginBottom: "var(--s-5)" }}>
          <div className="kpi"><span className="kpi__label"><Icon name="check-circle" size={16} /> Published</span><span className="kpi__value">{summaryFor.published}</span><span className="kpi__note">{group === "help_faq" ? "on the public Help page" : "printed in the member application"}</span></div>
          <div className="kpi"><span className="kpi__label"><Icon name="edit" size={16} /> Draft</span><span className="kpi__value">{summaryFor.draft}</span><span className="kpi__note">not published</span></div>
          <div className="kpi"><span className="kpi__label"><Icon name="lock" size={16} /> Archived</span><span className="kpi__value">{summaryFor.archived}</span><span className="kpi__note">retired</span></div>
        </div>
      )}

      <div className="card">
        <div className="findbar">
          <div className="search" style={{ flex: "1 1 260px", maxWidth: 360, position: "relative" }}>
            <span className="search__icon"><Icon name="search" size={18} /></span>
            <label className="sr-only" htmlFor="cSearch">Search entries</label>
            <input className="search__input" id="cSearch" type="search" placeholder="Search by title, category or key" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
        <div className="card__body card__body--flush">
          {!entries && !error && <p className="loading-row">Loading…</p>}
          {entries && shown.length === 0 && <p className="loading-row">No entries{filter ? " match that search" : " yet"}.</p>}
          {categories.map((category) => {
            const rows = shown.filter((e) => (e.category ?? "") === category);
            if (!rows.length) return null;
            return (
              <div key={category || "uncategorised"}>
                {categories.length > 1 && <div className="t-eyebrow" style={{ padding: "14px 20px 4px" }}>{category || "General"}</div>}
                <div className="table-wrap"><table className="table table--rows" data-testid="content-table">
                  <thead className="sr-only"><tr><th scope="col">Order</th><th scope="col">Entry</th><th scope="col">Updated</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                  <tbody>
                    {rows.map((entry) => (
                      <tr key={entry.id}>
                        <td className="t-num" style={{ width: 56 }}>{entry.display_order}</td>
                        <td><div className="cell-primary">{entry.title}</div><div className="cell-sub">{entry.body.length > 140 ? `${entry.body.slice(0, 140)}…` : entry.body}</div><div className="cell-sub mono">{entry.key}</div></td>
                        <td data-col-priority="low" style={{ whiteSpace: "nowrap" }}>{fmtDate(entry.updated_at)}<div className="cell-sub">{entry.updated_by ?? ""}</div></td>
                        <td><Chip label={entry.status} /></td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {entry.status !== "Archived" && <button className="btn btn--secondary btn--sm" type="button" onClick={() => { setFormError(""); setEditing({ entry, form: { group: entry.group, key: entry.key, category: entry.category, title: entry.title, body: entry.body, display_order: entry.display_order } }); }}>Edit</button>}
                          {entry.status === "Draft" && <button className="btn btn--primary btn--sm" type="button" disabled={busy} style={{ marginLeft: 6 }} onClick={() => act(entry, "publish")}>Publish</button>}
                          {entry.status === "Published" && <button className="btn btn--ghost btn--sm" type="button" disabled={busy} style={{ marginLeft: 6 }} onClick={() => act(entry, "unpublish")}>Unpublish</button>}
                          {entry.status !== "Archived" && <button className="btn btn--ghost btn--sm" type="button" disabled={busy} style={{ marginLeft: 6 }} onClick={() => act(entry, "archive")}>Archive</button>}
                          {entry.status === "Archived" && <button className="btn btn--secondary btn--sm" type="button" disabled={busy} onClick={() => act(entry, "restore")}>Restore to draft</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            );
          })}
        </div>
      </div>

      {editing && (
        <Drawer eyebrow="Content" title={editing.entry ? `Edit · ${editing.entry.title}` : "New entry"} onClose={() => setEditing(null)}
                desc={editing.entry ? `${editing.entry.status} · ${editing.entry.source ?? ""}` : "Saved as a draft; publish it when it is ready."}
                foot={<><button className="btn btn--primary" type="button" disabled={busy} onClick={save} data-testid="content-save">{busy ? "Saving…" : editing.entry ? "Save changes" : "Create draft"}</button><button className="btn btn--ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>{formError && <span className="field__error" style={{ marginLeft: "auto" }}>{formError}</span>}</>}>
          <div className="stack gap-5">
            <Field id="ce-group" label="Group"><select className="select" id="ce-group" value={editing.form.group} onChange={(e) => setForm({ group: e.target.value as ContentGroup })}>{CONTENT_GROUPS.map((g) => <option key={g} value={g}>{CONTENT_GROUP_LABELS[g]}</option>)}</select></Field>
            <Field id="ce-title" label={editing.form.group === "help_faq" ? "Question" : "Title"}><input className="input" id="ce-title" value={editing.form.title} onChange={(e) => setForm({ title: e.target.value })} /></Field>
            <Field id="ce-key" label="Key" hint="Stable identifier the product reads; letters, numbers and underscores."><input className="input mono" id="ce-key" value={editing.form.key} onChange={(e) => setForm({ key: e.target.value })} disabled={!!editing.entry} /></Field>
            <Field id="ce-category" label="Category" hint={editing.form.group === "help_faq" ? "About Veye · Subscription and My Account · Diet and Nutrition Terminology · Using the Platform · Technical Issues" : "Optional grouping."}><input className="input" id="ce-category" value={editing.form.category ?? ""} onChange={(e) => setForm({ category: e.target.value })} /></Field>
            <Field id="ce-body" label={editing.form.group === "help_faq" ? "Answer" : "Copy"}><textarea className="textarea" id="ce-body" style={{ minHeight: 180 }} value={editing.form.body} onChange={(e) => setForm({ body: e.target.value })} /></Field>
            <Field id="ce-order" label="Display order"><input className="input" id="ce-order" type="number" min={0} value={editing.form.display_order} onChange={(e) => setForm({ display_order: Number(e.target.value) || 0 })} style={{ maxWidth: 120 }} /></Field>
          </div>
        </Drawer>
      )}
    </div>
  );
}
