"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, PageHead, fmtDate } from "@/components/admin/admin-chrome";
import { listAttempts, type AttemptsPage } from "@/lib/admin-console-api";

/* One instrument's results: member, result, date, calculation version —
   searchable by member. Read-only; the calculation itself is system managed. */

export default function InstrumentAttemptsPage() {
  const params = useParams<{ key: string }>();
  const key = params.key;
  const [q, setQ] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [page, setPage] = useState<AttemptsPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      listAttempts(key, { q, page: pageNo, page_size: 25 }).then(setPage).catch((reason) => setError(reason instanceof Error ? reason.message : "The results could not be loaded."));
    }, q ? 200 : 0);
    return () => clearTimeout(timer);
  }, [key, q, pageNo]);

  const instrument = page?.instrument;
  return (
    <div className="page">
      <PageHead title={instrument?.name ?? "Assessment"} desc={instrument?.description}
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Assessments", href: "/admin/assessments" }, { label: instrument?.name ?? "…" }]} />
      {error && <p className="errorbar">{error}</p>}

      {instrument && (
        <div className="kpis" style={{ marginBottom: "var(--s-5)" }}>
          <div className="kpi"><span className="kpi__label"><Icon name="lock" size={16} /> Calculation</span><span className="kpi__value" style={{ fontSize: 20 }}>{instrument.calculation_version}</span><span className="kpi__note">{instrument.calculation_owner} · read-only</span></div>
          <div className="kpi"><span className="kpi__label"><Icon name="users" size={16} /> Members scored</span><span className="kpi__value">{instrument.members_scored}</span><span className="kpi__note">distinct members with a result</span></div>
          <div className="kpi"><span className="kpi__label"><Icon name="clipboard" size={16} /> Results saved</span><span className="kpi__value">{instrument.attempts_total}</span><span className="kpi__note">{instrument.last_completed_at ? `latest ${fmtDate(instrument.last_completed_at)}` : "none yet"}</span></div>
        </div>
      )}

      <div className="card">
        <div className="findbar">
          <div className="search" style={{ flex: "1 1 260px", maxWidth: 360, position: "relative" }}>
            <span className="search__icon"><Icon name="search" size={18} /></span>
            <label className="sr-only" htmlFor="aSearch">Search by member</label>
            <input className="search__input" id="aSearch" type="search" placeholder="Search by member name or email" value={q} onChange={(event) => { setQ(event.target.value); setPageNo(1); }} />
          </div>
        </div>
        {!page && !error && <p className="loading-row">Loading…</p>}
        {page && page.rows.length === 0 && <p className="loading-row">No results{q ? " match that search" : " saved yet"}.</p>}
        {page && page.rows.length > 0 && (
          <>
            <div className="table-wrap table-wrap--sticky">
              <table className="table table--rows" data-testid="attempts-table">
                <thead><tr><th scope="col">Member</th><th scope="col">Result</th><th scope="col">Date</th><th scope="col" data-col-priority="low">Calculation version</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {page.rows.map((row) => (
                    <tr key={row.attempt_id}>
                      <td><div className="cell-primary">{row.member_name}</div><div className="cell-sub">{row.member_email}</div></td>
                      <td>{row.result}</td>
                      <td>{fmtDate(row.completed_at)}</td>
                      <td data-col-priority="low" className="mono">{row.calculation_version}</td>
                      <td style={{ textAlign: "right" }}><Link className="btn btn--secondary btn--sm" href={`/admin/members/${row.member_id}?tab=assessments`}>Member 360</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="pager__info">Showing {page.rows.length} of {page.total} results</span>
              {page.total > page.page_size && (
                <span className="row gap-2">
                  <button className="btn btn--ghost btn--sm" type="button" disabled={page.page <= 1} onClick={() => setPageNo((n) => n - 1)}>Previous</button>
                  <button className="btn btn--ghost btn--sm" type="button" disabled={page.page * page.page_size >= page.total} onClick={() => setPageNo((n) => n + 1)}>Next</button>
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
