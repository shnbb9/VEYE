"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Chip, EmptyState, fmtDate } from "@/components/admin/admin-chrome";
import { CompanionPage } from "@/components/admin/companion-page";
import { listFeedback, reviewFeedback, type FeedbackRow } from "@/lib/admin-api";

type Filter = "unreviewed" | "reviewed" | "all";

export default function FeedbackPage() {
  const [filter, setFilter] = useState<Filter>("unreviewed");
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    listFeedback(filter).then(setRows).catch((reason) => setError(reason instanceof Error ? reason.message : "Feedback could not be loaded."));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function review(row: FeedbackRow) {
    setBusy(row.id);
    try { await reviewFeedback(row.id); load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not mark reviewed."); } finally { setBusy(null); }
  }

  return (
    <CompanionPage active="feedback" desc="Helpful / not helpful responses members leave on Sprout replies. Reading changes nothing; marking reviewed is recorded in the audit log.">
      {error && <p className="errorbar">{error}</p>}
      <div className="card">
        <div className="card__head">
          <div><h2 className="card__title">Member feedback</h2></div>
          <div className="modeswitch">
            {(["unreviewed", "reviewed", "all"] as Filter[]).map((key) => (
              <button key={key} className="modeswitch__btn" type="button" aria-selected={filter === key} onClick={() => setFilter(key)}>{key[0].toUpperCase() + key.slice(1)}</button>
            ))}
          </div>
        </div>
        <div className="card__body card__body--flush">
          {rows === null && <p className="loading-row">Loading…</p>}
          {rows && rows.length === 0 && <div style={{ padding: "var(--s-6)" }}><EmptyState icon="thumbs" title="No feedback here" msg={filter === "unreviewed" ? "Every response has been read." : "Members have not left feedback yet."} /></div>}
          {rows && rows.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Member</th><th>Rating</th><th>Reason</th><th>Sprout said</th><th>Submitted</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.member_name}</td>
                      <td><Chip label={row.rating} /></td>
                      <td>{row.reason ?? "—"}{row.comment && <div className="t-support">“{row.comment}”</div>}</td>
                      <td className="t-support">{row.reply_excerpt}</td>
                      <td className="t-nowrap">{fmtDate(row.submitted_at)}</td>
                      <td>{row.reviewed_at ? <span className="t-support">Reviewed by {row.reviewed_by}</span> : <Chip label="Unreviewed" tone="attention" />}</td>
                      <td className="t-nowrap">
                        <Link className="btn btn--ghost btn--sm" href={`/admin/companion/conversations?conversation=${row.conversation_id}`}>Open</Link>
                        {!row.reviewed_at && <button className="btn btn--secondary btn--sm" type="button" disabled={busy === row.id} onClick={() => void review(row)}>Mark reviewed</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </CompanionPage>
  );
}
