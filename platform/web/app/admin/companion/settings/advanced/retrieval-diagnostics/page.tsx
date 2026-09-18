"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AdvancedPage, Counts, TraceTable } from "@/components/admin/advanced-page";
import { getRetrievalDiagnostics, runDiagnosticQuery, type DiagnosticHit, type RetrievalDiagnostics } from "@/lib/admin-api";

export default function RetrievalDiagnosticsPage() {
  const [data, setData] = useState<RetrievalDiagnostics | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DiagnosticHit[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRetrievalDiagnostics().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Diagnostics could not be loaded."));
  }, []);

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setError("");
    try { setHits(await runDiagnosticQuery(query.trim(), [])); } catch (reason) { setError(reason instanceof Error ? reason.message : "The query failed."); } finally { setBusy(false); }
  }

  return (
    <AdvancedPage active="retrieval-diagnostics" title="Retrieval Diagnostics" desc="What the approved-knowledge index holds and how recent retrievals scored. Try a synthetic question against the index — administrator text only, never member data.">
      {error && <p className="errorbar">{error}</p>}
      {data && (
        <div className="stackgap">
          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Index</h2><p className="t-support">PostgreSQL + pgvector · embeddings: {data.index.embedding_model}</p></div></div>
            <div className="card__body">
              <div className="metric-row metric-row--wrap">
                <div className="metric"><div className="metric__body"><span className="metric__label">Retrievable sources</span><span className="metric__value">{data.index.sources_retrievable} / {data.index.sources_total}</span></div></div>
                <div className="metric"><div className="metric__body"><span className="metric__label">Ingested documents</span><span className="metric__value">{data.index.documents_ingested}</span></div></div>
                <div className="metric"><div className="metric__body"><span className="metric__label">Passages</span><span className="metric__value">{data.index.chunks_total}</span></div></div>
                <div className="metric"><div className="metric__body"><span className="metric__label">Average top match</span><span className="metric__value">{data.average_top_score != null ? `${Math.round(data.average_top_score * 100)}%` : "—"}</span></div></div>
                <div className="metric"><div className="metric__body"><span className="metric__label">Empty retrievals</span><span className="metric__value">{data.empty_retrievals}</span></div></div>
              </div>
              <dl className="kv" style={{ marginTop: "var(--s-5)" }}><dt>Sources by status</dt><dd><Counts counts={data.index.sources_by_status} /></dd></dl>
            </div>
          </div>
          <form className="card" onSubmit={run}>
            <div className="card__head"><div><h2 className="card__title">Run a diagnostic query</h2><p className="t-support">Searches only Active, approved sources — the same path Sprout uses.</p></div></div>
            <div className="card__body row gap-3 wrap">
              <input className="input" style={{ flex: "1 1 320px" }} placeholder="e.g. what does a lower Health Number mean" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Diagnostic query" />
              <button className="btn btn--primary" type="submit" disabled={busy || !query.trim()}>{busy ? "Searching…" : "Search the index"}</button>
            </div>
            {hits && (
              <div className="card__body card__body--flush">
                {hits.length === 0 ? <p className="loading-row">No approved passage matched.</p> : (
                  <div className="rows">
                    {hits.map((hit) => (
                      <div key={hit.chunk_id} className="rowitem" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                        <div>
                          <div className="rowitem__title">{hit.title} <span className="t-support">v{hit.source_version}{hit.heading ? ` · ${hit.heading}` : ""}</span></div>
                          <div className="rowitem__meta">{hit.excerpt}{hit.excerpt.length >= 280 ? "…" : ""}</div>
                          <div className="rowitem__meta mono">source {hit.source_id} · chunk {hit.chunk_id}</div>
                        </div>
                        <span className="rowitem__side chip chip--lime">match {Math.round(hit.score * 100)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </form>
          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Recent retrievals</h2></div></div>
            <div className="card__body card__body--flush"><TraceTable rows={data.recent} caption="Recent retrieval-backed turns" /></div>
          </div>
        </div>
      )}
    </AdvancedPage>
  );
}
