"use client";

import { useCallback, useEffect, useState } from "react";
import { Chip, Icon, PageHead, Subnav, fmtDate } from "@/components/admin/admin-chrome";
import { MEMBER_VIEWS } from "@/components/admin/member-views";
import { apiJson, postJson } from "@/lib/api";

/* Deletions (architecture V2 §6): members who deleted their own profile.
   Oversight only — ids, states and dates, never what was removed. The console
   cannot start a deletion for a member, cannot pause or undo one, and can
   only retry one that stopped on an error. */

type Row = {
  request_id: string; subject_user_id: string; subject_member_id: string; scope: string; state: string;
  state_label: string; requested_at: string; completed_at: string | null; attempts: number;
  failure_category: string | null; stage: string;
};
const TONE: Record<string, string> = { erased: "live", purge_blocked: "attention", purging: "draft", access_closed: "draft", requested: "draft" };

export default function DeletionsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => apiJson<Row[]>("/api/v1/admin/erasure-requests").then(setRows)
    .catch((reason) => setError(reason instanceof Error ? reason.message : "Deletions could not be loaded.")), []);
  useEffect(() => { void load(); }, [load]);

  async function retry(id: string) {
    setBusy(id); setError("");
    try { await postJson<Row>(`/api/v1/admin/erasure-requests/${id}/retry`, {}); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The deletion could not be retried."); }
    finally { setBusy(null); }
  }

  return (
    <div className="page">
      <PageHead title="Deletions" crumbs={[{ label: "Home", href: "/admin" }, { label: "Members", href: "/admin/members" }, { label: "Deletions" }]}
                desc="Members who deleted their member profile. You see that it happened and whether it finished — never what was removed." />
      <Subnav items={MEMBER_VIEWS} active="deletions" />
      {error && <p className="errorbar">{error}</p>}
      <div className="card">
        {rows === null && !error && <p className="loading-row">Loading…</p>}
        {rows && rows.length === 0 && (
          <div className="card__body"><div className="state"><span className="state__icon"><Icon name="shield" /></span>
            <div className="state__title">No deletions</div><p className="state__msg">When a member deletes their profile from Settings, it is listed here.</p></div></div>
        )}
        {rows && rows.length > 0 && (
          <div className="table-wrap"><table className="table table--rows" data-testid="deletions-table">
            <caption className="sr-only">Deletion requests</caption>
            <thead><tr>
              <th scope="col">Reference</th><th scope="col">Scope</th><th scope="col">State</th>
              <th scope="col" data-col-priority="medium">Requested</th><th scope="col" data-col-priority="low">Finished</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.request_id} data-testid="deletion-row">
                  <td className="mono">{row.request_id.slice(0, 8)}…</td>
                  <td>{row.scope === "member_data" ? "Member data (console access kept)" : "Member profile and account"}</td>
                  <td><Chip label={row.state_label} tone={TONE[row.state]} />
                    {row.failure_category && <div className="cell-sub">Stopped at {row.failure_category} (attempt {row.attempts})</div>}</td>
                  <td data-col-priority="medium">{fmtDate(row.requested_at)}</td>
                  <td data-col-priority="low">{row.completed_at ? fmtDate(row.completed_at) : <span className="t-muted">—</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    {row.state === "purge_blocked" && (
                      <button className="btn btn--secondary btn--sm" type="button" disabled={busy !== null} onClick={() => void retry(row.request_id)} data-testid="deletion-retry">
                        {busy === row.request_id ? "Retrying…" : "Retry"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
