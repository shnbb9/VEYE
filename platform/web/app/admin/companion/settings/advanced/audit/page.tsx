"use client";

import { useEffect, useState } from "react";
import { AdvancedPage } from "@/components/admin/advanced-page";
import { fmtDate } from "@/components/admin/admin-chrome";
import { getAudit, type AuditPage as AuditPageData } from "@/lib/admin-api";

const PAGE_SIZE = 100;

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditPageData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getAudit(page, PAGE_SIZE)
      .then((next) => { if (live) setData(next); })
      .catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : "The audit log could not be loaded."); });
    return () => { live = false; };
  }, [page]);

  const rows = data?.rows ?? null;
  // The first row of this window counted from the start of the whole log, so
  // the caption reads as a position in the record rather than a page number.
  const from = data && data.total > 0 ? (data.page - 1) * data.page_size + 1 : 0;
  const to = data ? from + data.rows.length - 1 : 0;
  const hasMore = data ? data.page * data.page_size < data.total : false;

  return (
    <AdvancedPage active="audit" title="Audit" desc="Who changed what in the console: knowledge-source lifecycle, Companion settings, conversation and feedback reviews. Policy decisions on member messages are audited separately with each conversation.">
      {error && <p className="errorbar">{error}</p>}
      <div className="card">
        <div className="card__body card__body--flush">
          {rows === null && !error && <p className="loading-row">Loading…</p>}
          {rows && rows.length === 0 && page === 1 && <p className="empty-row">No administrator actions recorded yet.</p>}
          {rows && rows.length > 0 && (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="t-nowrap">{fmtDate(row.created_at)}</td>
                      <td className="t-nowrap">{row.actor_name}</td>
                      <td>{row.action}</td>
                      <td className="mono">{row.entity_type}{row.entity_id ? ` ${row.entity_id.slice(0, 8)}…` : ""}</td>
                      <td className="t-support">{Object.entries(row.details).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value ?? "—")}`).join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > 0 && (
            <div className="pager">
              <span className="pager__info" data-testid="audit-range">
                {data.total <= data.page_size
                  ? `All ${data.total} entries`
                  : `Entries ${from}–${to} of ${data.total}, newest first`}
              </span>
              {data.total > data.page_size && (
                <span className="row gap-2">
                  <button className="btn btn--secondary btn--sm" type="button" data-testid="audit-newer"
                          disabled={data.page <= 1} onClick={() => setPage((c) => c - 1)}>Newer</button>
                  <button className="btn btn--secondary btn--sm" type="button" data-testid="audit-older"
                          disabled={!hasMore} onClick={() => setPage((c) => c + 1)}>Older</button>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </AdvancedPage>
  );
}
