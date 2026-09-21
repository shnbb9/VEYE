"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Chip, Icon, PageHead, Subnav, fmtDate } from "@/components/admin/admin-chrome";
import { Drawer, Field } from "@/components/admin/drawer";
import {
  CARE_CONTENT_TYPES,
  CARE_KINDS,
  CARE_KIND_LABELS,
  createCareItem,
  getCareSummary,
  listCareItems,
  transitionCareItem,
  updateCareItem,
  type CareItem,
  type CareItemInput,
  type CareKind,
  type CareKindSummary,
  type LifecycleAction,
} from "@/lib/admin-console-api";

/* Care Studio (admin prototype screens/care-studio.js): the configurable
   member content — Fitness, Supplements, Resources — as metadata with a
   Draft → Published → Archived lifecycle. Members see Published items in
   their sections. Videos are YouTube addresses or, later, an object key in
   whatever object store Veye chooses; no binary lives in PostgreSQL. */

const EMPTY: CareItemInput = { kind: "fitness", title: "", description: "", category: null, content_type: "copy", youtube_url: null, external_url: null, video_object_key: null, body: "", cautions: null, references: null, display_order: 0 };
const CONTENT_TYPE_LABEL = { video: "YouTube video", program: "External program", article: "Article", link: "Link", copy: "Educational copy" } as const;

export default function CareStudioPage() {
  return <Suspense fallback={null}><CareStudio /></Suspense>;
}

function CareStudio() {
  const search = useSearchParams();
  const kind: CareKind = (CARE_KINDS.find((k) => k === search.get("kind")) ?? "fitness");
  const [summary, setSummary] = useState<CareKindSummary[] | null>(null);
  const [items, setItems] = useState<CareItem[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ item: CareItem | null; form: CareItemInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(() => {
    getCareSummary().then(setSummary).catch(() => setSummary(null));
    listCareItems(kind).then(setItems).catch((reason) => setError(reason instanceof Error ? reason.message : "Care Studio could not be loaded."));
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  const summaryFor = summary?.find((s) => s.kind === kind);

  async function act(item: CareItem, action: LifecycleAction) {
    setBusy(true); setError("");
    try {
      const saved = await transitionCareItem(item.id, action);
      setItems((current) => current ? current.map((i) => (i.id === saved.id ? saved : i)) : current);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That change could not be saved.");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!editing) return;
    if (!editing.form.title.trim()) { setFormError("Give the item a title."); return; }
    setBusy(true); setFormError("");
    const form: CareItemInput = {
      ...editing.form,
      category: editing.form.category?.trim() || null,
      youtube_url: editing.form.youtube_url?.trim() || null,
      external_url: editing.form.external_url?.trim() || null,
      video_object_key: editing.form.video_object_key?.trim() || null,
      cautions: editing.form.cautions?.trim() || null,
      references: editing.form.references?.trim() || null,
    };
    try {
      if (editing.item) await updateCareItem(editing.item.id, form); else await createCareItem(form);
      setEditing(null);
      load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "The item could not be saved.");
    } finally { setBusy(false); }
  }

  const setForm = (patch: Partial<CareItemInput>) => setEditing((current) => current ? { ...current, form: { ...current.form, ...patch } } : current);

  return (
    <div className="page">
      <PageHead title="Care Studio" desc="The member content Veye configures: fitness recommendations, supplement education and resources. Draft it, publish it, retire it."
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Care Studio" }]}
                actions={<button className="btn btn--primary" type="button" onClick={() => { setFormError(""); setEditing({ item: null, form: { ...EMPTY, kind, display_order: (items?.length ?? 0) + 1 } }); }}><Icon name="plus" size={18} /> New {CARE_KIND_LABELS[kind].replace(/s$/, "").toLowerCase()} item</button>} />
      {error && <p className="errorbar">{error}</p>}

      <Subnav items={CARE_KINDS.map((k) => ({ key: k, label: CARE_KIND_LABELS[k], href: `/admin/care?kind=${k}`, count: summary?.find((s) => s.kind === k)?.published }))} active={kind} />

      {summaryFor && (
        <div className="kpis" style={{ marginBottom: "var(--s-5)" }}>
          <div className="kpi"><span className="kpi__label"><Icon name="check-circle" size={16} /> Published</span><span className="kpi__value">{summaryFor.published}</span><span className="kpi__note">visible to members now</span></div>
          <div className="kpi"><span className="kpi__label"><Icon name="edit" size={16} /> Draft</span><span className="kpi__value">{summaryFor.draft}</span><span className="kpi__note">not shown to members</span></div>
          <div className="kpi"><span className="kpi__label"><Icon name="lock" size={16} /> Archived</span><span className="kpi__value">{summaryFor.archived}</span><span className="kpi__note">retired, kept for reference</span></div>
        </div>
      )}

      <div className="card">
        <div className="card__head"><div><h2 className="card__title">{CARE_KIND_LABELS[kind]}</h2><p className="t-support">{kind === "fitness" ? "Cara's recommendations as VEYE cards: programs open externally, videos embed privacy-enhanced." : kind === "supplement" ? "Approved educational copy with cautions and references. Dosage is chosen by condition, never inferred from a tracker." : "The four Resources cards stay Coming Soon until their content is supplied."}</p></div></div>
        <div className="card__body card__body--flush">
          {!items && !error && <p className="loading-row">Loading…</p>}
          {items && items.length === 0 && <p className="loading-row">Nothing here yet.</p>}
          {items && items.length > 0 && (
            <div className="table-wrap"><table className="table table--rows" data-testid="care-table">
              <thead><tr><th scope="col">Order</th><th scope="col">Item</th><th scope="col" data-col-priority="medium">Type</th><th scope="col" data-col-priority="low">Updated</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="t-num">{item.display_order}</td>
                    <td><div className="cell-primary">{item.title}</div><div className="cell-sub">{item.category ?? "—"}{item.youtube_url ? ` · ${item.youtube_url}` : item.external_url ? ` · ${item.external_url}` : ""}</div></td>
                    <td data-col-priority="medium">{CONTENT_TYPE_LABEL[item.content_type]}</td>
                    <td data-col-priority="low">{fmtDate(item.updated_at)}<div className="cell-sub">{item.updated_by ?? ""}</div></td>
                    <td><Chip label={item.status} /></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {item.status !== "Archived" && <button className="btn btn--secondary btn--sm" type="button" onClick={() => { setFormError(""); setEditing({ item, form: { kind: item.kind, title: item.title, description: item.description, category: item.category, content_type: item.content_type, youtube_url: item.youtube_url, external_url: item.external_url, video_object_key: item.video_object_key, body: item.body, cautions: item.cautions, references: item.references, display_order: item.display_order } }); }}>Edit</button>}
                      {item.status === "Draft" && <button className="btn btn--primary btn--sm" type="button" disabled={busy} style={{ marginLeft: 6 }} onClick={() => act(item, "publish")}>Publish</button>}
                      {item.status === "Published" && <button className="btn btn--ghost btn--sm" type="button" disabled={busy} style={{ marginLeft: 6 }} onClick={() => act(item, "unpublish")}>Unpublish</button>}
                      {item.status !== "Archived" && <button className="btn btn--ghost btn--sm" type="button" disabled={busy} style={{ marginLeft: 6 }} onClick={() => act(item, "archive")}>Archive</button>}
                      {item.status === "Archived" && <button className="btn btn--secondary btn--sm" type="button" disabled={busy} onClick={() => act(item, "restore")}>Restore to draft</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
        <div className="card__foot"><span className="t-support">Published items appear in the member's {CARE_KIND_LABELS[kind]} section in display order. Uploaded video (object storage) is a future field: today a video is a YouTube address.</span></div>
      </div>

      {editing && (
        <Drawer eyebrow="Care Studio" title={editing.item ? `Edit · ${editing.item.title}` : `New ${CARE_KIND_LABELS[kind].toLowerCase()} item`} onClose={() => setEditing(null)}
                desc={editing.item ? `${editing.item.status} · last updated ${fmtDate(editing.item.updated_at)}` : "Saved as a draft; publish it when it is ready."}
                foot={<><button className="btn btn--primary" type="button" disabled={busy} onClick={save} data-testid="care-save">{busy ? "Saving…" : editing.item ? "Save changes" : "Create draft"}</button><button className="btn btn--ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>{formError && <span className="field__error" style={{ marginLeft: "auto" }}>{formError}</span>}</>}>
          <div className="stack gap-5">
            <Field id="ci-kind" label="Area"><select className="select" id="ci-kind" value={editing.form.kind} onChange={(e) => setForm({ kind: e.target.value as CareKind })}>{CARE_KINDS.map((k) => <option key={k} value={k}>{CARE_KIND_LABELS[k]}</option>)}</select></Field>
            <Field id="ci-title" label="Title"><input className="input" id="ci-title" value={editing.form.title} onChange={(e) => setForm({ title: e.target.value })} /></Field>
            <Field id="ci-category" label="Category" hint="e.g. Martial Arts & Boxing, Omega 3, Resources"><input className="input" id="ci-category" value={editing.form.category ?? ""} onChange={(e) => setForm({ category: e.target.value })} /></Field>
            <Field id="ci-type" label="Content type"><select className="select" id="ci-type" value={editing.form.content_type} onChange={(e) => setForm({ content_type: e.target.value as CareItemInput["content_type"] })}>{CARE_CONTENT_TYPES.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABEL[t]}</option>)}</select></Field>
            <Field id="ci-desc" label="Description" hint="The short line on the member card."><textarea className="textarea" id="ci-desc" value={editing.form.description} onChange={(e) => setForm({ description: e.target.value })} /></Field>
            {(editing.form.content_type === "video" || editing.form.youtube_url) && <Field id="ci-yt" label="YouTube address" hint="Embeds through youtube-nocookie.com, lazily, without autoplay."><input className="input" id="ci-yt" placeholder="https://youtu.be/…" value={editing.form.youtube_url ?? ""} onChange={(e) => setForm({ youtube_url: e.target.value })} /></Field>}
            {(editing.form.content_type === "program" || editing.form.content_type === "link" || editing.form.external_url) && <Field id="ci-ext" label="External address" hint="Opens in a new tab; never framed."><input className="input" id="ci-ext" placeholder="https://…" value={editing.form.external_url ?? ""} onChange={(e) => setForm({ external_url: e.target.value })} /></Field>}
            <Field id="ci-body" label={editing.form.kind === "supplement" ? "Approved educational copy" : "Body"} hint={editing.form.kind === "supplement" ? "Client-approved wording only." : "Longer text shown when the item opens."}><textarea className="textarea" id="ci-body" style={{ minHeight: 140 }} value={editing.form.body} onChange={(e) => setForm({ body: e.target.value })} /></Field>
            {editing.form.kind === "supplement" && <>
              <Field id="ci-cautions" label="Cautions / disclaimer"><textarea className="textarea" id="ci-cautions" value={editing.form.cautions ?? ""} onChange={(e) => setForm({ cautions: e.target.value })} /></Field>
              <Field id="ci-refs" label="References" hint="Citations pending clinical review."><textarea className="textarea" id="ci-refs" value={editing.form.references ?? ""} onChange={(e) => setForm({ references: e.target.value })} /></Field>
            </>}
            <Field id="ci-video-key" label="Uploaded video (future)" hint="Object-storage key once Veye's object store is chosen. Not used by the member product yet."><input className="input" id="ci-video-key" value={editing.form.video_object_key ?? ""} onChange={(e) => setForm({ video_object_key: e.target.value })} disabled /></Field>
            <Field id="ci-order" label="Display order"><input className="input" id="ci-order" type="number" min={0} value={editing.form.display_order} onChange={(e) => setForm({ display_order: Number(e.target.value) || 0 })} style={{ maxWidth: 120 }} /></Field>
          </div>
        </Drawer>
      )}
    </div>
  );
}
