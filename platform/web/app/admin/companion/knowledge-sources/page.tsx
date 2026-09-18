"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Chip, Icon, fmtDate } from "@/components/admin/admin-chrome";
import { CompanionPage } from "@/components/admin/companion-page";
import {
  attachKnowledgeDocument, createKnowledgeSource, getKnowledgeOptions, listKnowledgeSources, transitionKnowledgeSource, updateKnowledgeSource,
  type KnowledgeSource, type KnowledgeSourceInput,
} from "@/lib/admin-api";

type Options = { types: string[]; scopes: Record<string, string>; statuses: string[] };
const EMPTY: KnowledgeSourceInput = { title: "", type: "VEYE educational document", scope_key: "help", description: "", reference_label: "", effective_date: null };

export default function KnowledgeSourcesPage() {
  const [sources, setSources] = useState<KnowledgeSource[] | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; input: KnowledgeSourceInput } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    listKnowledgeSources().then(setSources).catch((reason) => setError(reason instanceof Error ? reason.message : "Sources could not be loaded."));
  }, []);

  useEffect(() => { load(); getKnowledgeOptions().then(setOptions).catch(() => setOptions(null)); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy("save"); setError("");
    try {
      const input = { ...editing.input, reference_label: editing.input.reference_label || null, effective_date: editing.input.effective_date || null };
      if (editing.id) await updateKnowledgeSource(editing.id, input); else await createKnowledgeSource(input);
      setNotice(editing.id ? "Source saved." : "Source added as Draft. Attach a document, then activate it.");
      setEditing(null);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The source could not be saved.");
    } finally { setBusy(null); }
  }

  async function transition(source: KnowledgeSource, action: "activate" | "deactivate" | "archive" | "restore") {
    if (action === "archive" && !window.confirm(`Archive "${source.title}"? It is retained as an archived record and is never permanently deleted.`)) return;
    setBusy(source.id); setError("");
    try {
      const updated = await transitionKnowledgeSource(source.id, action);
      setNotice(`${updated.title}: ${updated.status}${action === "activate" ? ` — approved by ${updated.approved_by}` : ""}.`);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The change could not be saved.");
    } finally { setBusy(null); }
  }

  async function attach(source: KnowledgeSource, file: File | undefined) {
    if (!file) return;
    setBusy(source.id); setError("");
    try {
      const updated = await attachKnowledgeDocument(source.id, file);
      const doc = updated.current_document;
      setNotice(doc?.ingestion_status === "ingested"
        ? `${file.name}: ingested into ${doc.chunk_count} passages (version ${updated.version}). Activate the source to make it retrievable.`
        : `${file.name}: ingestion failed — ${doc?.ingestion_error ?? "unknown error"}.`);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The document could not be attached.");
    } finally { setBusy(null); }
  }

  const storage = sources?.[0]?.storage ?? "local-file";

  return (
    <CompanionPage active="knowledge" actions={<button className="btn btn--primary" type="button" onClick={() => setEditing({ id: null, input: EMPTY })}><Icon name="plus" size={18} /> Add source</button>}>
      {error && <p className="errorbar">{error}</p>}
      {notice && <div className="notice notice--quiet" style={{ marginBottom: "var(--s-4)" }}><Icon name="info" size={18} /><div>{notice}</div></div>}

      {editing && options && (
        <form className="card" style={{ marginBottom: "var(--s-5)" }} onSubmit={save}>
          <div className="card__head"><div><h2 className="card__title">{editing.id ? "View / edit source" : "Add source"}</h2>
            <p className="t-support">Metadata is saved to PostgreSQL. Attaching a document stores the file in the {storage} object store and ingests it for retrieval.</p></div></div>
          <div className="card__body inline-form">
            <div className="field"><label htmlFor="ks-title">Source title</label><input className="input" id="ks-title" required value={editing.input.title} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, title: e.target.value } })} /></div>
            <div className="field"><label htmlFor="ks-type">Source type</label>
              <select className="select" id="ks-type" value={editing.input.type} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, type: e.target.value } })}>
                {options.types.map((type) => <option key={type} value={type}>{type}</option>)}
              </select></div>
            <div className="field"><label htmlFor="ks-scope">Scope</label>
              <select className="select" id="ks-scope" value={editing.input.scope_key} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, scope_key: e.target.value } })}>
                {Object.entries(options.scopes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select></div>
            <div className="field"><label htmlFor="ks-ref">Filename or URL label (optional)</label><input className="input" id="ks-ref" value={editing.input.reference_label ?? ""} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, reference_label: e.target.value } })} /></div>
            <div className="field"><label htmlFor="ks-date">Effective date (optional)</label><input className="input" id="ks-date" type="date" value={editing.input.effective_date ?? ""} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, effective_date: e.target.value || null } })} /></div>
            <div className="field field--wide"><label htmlFor="ks-desc">Short description</label><textarea className="textarea" id="ks-desc" rows={3} value={editing.input.description} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, description: e.target.value } })} /></div>
          </div>
          <div className="card__foot">
            <button className="btn btn--secondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn--primary" type="submit" disabled={busy === "save"}>{editing.id ? "Save source" : "Add source"}</button>
          </div>
        </form>
      )}

      <section className="card">
        <div className="card__head">
          <div><h2 className="card__title">Knowledge Sources</h2>
            <p className="t-support">Approved sources Sprout may draw on. Only an Active source with an ingested document is retrievable; Inactive and Archived sources never are.</p></div>
        </div>
        <div className="card__body card__body--flush">
          <div className="rows">
            {sources === null && <p className="loading-row">Loading…</p>}
            {sources?.map((source) => {
              const doc = source.current_document;
              return (
                <div key={source.id} className="rowitem" style={{ gridTemplateColumns: "44px minmax(0,1fr) auto" }}>
                  <span className={`rowitem__icon${source.status === "Active" ? "" : " rowitem__icon--off"}`}><Icon name="file-text" size={18} /></span>
                  <div>
                    <div className="rowitem__title">{source.title} <span className="t-support">v{source.version}</span></div>
                    <div className="rowitem__meta">{source.type} · {source.scope_label}{source.reference_label ? ` · ${source.reference_label}` : ""}</div>
                    <div className="rowitem__meta">
                      {doc ? <>Document: {doc.filename} · <Chip label={doc.ingestion_status} />{doc.ingestion_status === "ingested" ? ` · ${doc.chunk_count} passages` : doc.ingestion_error ? ` · ${doc.ingestion_error}` : ""}</> : "No document attached"}
                      {" · "}Updated {fmtDate(source.updated_at)}
                      {source.approved_at && <> · Approved by {source.approved_by} on {fmtDate(source.approved_at)}</>}
                    </div>
                    {source.status !== "Archived" && (
                      <label className="filelabel t-support" style={{ marginTop: 6 }}>
                        Attach document (.md or .txt)
                        <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" disabled={busy === source.id}
                               onChange={(event) => { void attach(source, event.target.files?.[0]); event.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                  <div className="rowitem__side row gap-2 wrap">
                    <Chip label={source.status} />
                    {source.status !== "Archived" && <button className="btn btn--ghost btn--sm" type="button" onClick={() => setEditing({ id: source.id, input: { title: source.title, type: source.type, scope_key: source.scope_key, description: source.description, reference_label: source.reference_label ?? "", effective_date: source.effective_date } })}>View / edit</button>}
                    {source.status === "Archived"
                      ? <button className="btn btn--ghost btn--sm" type="button" disabled={busy === source.id} onClick={() => void transition(source, "restore")}>Restore</button>
                      : <>
                          <button className="btn btn--ghost btn--sm" type="button" disabled={busy === source.id || (source.status !== "Active" && doc?.ingestion_status !== "ingested")}
                                  title={source.status !== "Active" && doc?.ingestion_status !== "ingested" ? "Attach an ingested document first" : undefined}
                                  onClick={() => void transition(source, source.status === "Active" ? "deactivate" : "activate")}>
                            {source.status === "Active" ? "Deactivate" : "Activate"}
                          </button>
                          <button className="btn btn--ghost btn--sm" type="button" disabled={busy === source.id} onClick={() => void transition(source, "archive")}>Archive</button>
                        </>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card__foot"><span className="t-support">Archiving keeps the source record, its documents and its history. Nothing is permanently deleted from this screen. Storage: {storage} (production target S3, not configured).</span></div>
      </section>
    </CompanionPage>
  );
}
