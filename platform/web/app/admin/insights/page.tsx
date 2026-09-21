"use client";

import { useEffect, useState } from "react";
import { Icon, PageHead, fmtDate } from "@/components/admin/admin-chrome";
import {
  REQUEST_KIND_LABELS, REQUEST_STATUS_LABELS, TRACKER_KEYS, TRACKER_LABELS, getInsights,
  type Insights, type MonthCount, type RequestKind, type RequestStatus,
} from "@/lib/admin-console-api";

/* Insights — lightweight and real: member count and sign-ups by month,
   tracker usage, guided-flow starts and completions, Companion usage and
   feedback. Every figure is an aggregate of the local database. No medical
   conclusions, no health-outcome analytics, no invented trends. */

export default function InsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getInsights().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Insights could not be loaded."));
  }, []);

  return (
    <div className="page">
      <PageHead title="Insights" desc="How members are using Veye — counts from the database, nothing modelled." crumbs={[{ label: "Home", href: "/admin" }, { label: "Insights" }]} />
      {error && <p className="errorbar">{error}</p>}
      {!data && !error && <p className="loading-row">Loading…</p>}
      {data && (
        <>
          <div className="kpis kpis--quad">
            <div className="kpi"><span className="kpi__label"><Icon name="users" size={16} /> Members</span><span className="kpi__value">{data.members_total}</span><span className="kpi__note">accounts with a member profile</span></div>
            <div className="kpi"><span className="kpi__label"><Icon name="clipboard" size={16} /> Results saved</span><span className="kpi__value">{TRACKER_KEYS.reduce((sum, key) => sum + data.attempts[key], 0)}</span><span className="kpi__note">across the five trackers</span></div>
            <div className="kpi"><span className="kpi__label"><Icon name="sprout" size={16} /> Guided sessions</span><span className="kpi__value">{data.guided_flows.reduce((sum, f) => sum + f.started, 0)}</span><span className="kpi__note">{data.guided_flows.reduce((sum, f) => sum + f.completed, 0)} completed</span></div>
            <div className="kpi"><span className="kpi__label"><Icon name="messages" size={16} /> Sprout conversations</span><span className="kpi__value">{data.companion_conversations}</span><span className="kpi__note">{data.companion_messages} messages · {data.companion_feedback_helpful} helpful / {data.companion_feedback_not_helpful} not helpful</span></div>
          </div>

          <div className="grid grid--2" style={{ marginTop: "var(--s-6)" }}>
            <div className="card">
              <div className="card__head"><div><h2 className="card__title">New members by month</h2><p className="t-support">Member profiles created, last twelve months.</p></div></div>
              <div className="card__body"><MonthBars series={data.members_by_month} /></div>
            </div>
            <div className="card">
              <div className="card__head"><div><h2 className="card__title">Tracker usage</h2><p className="t-support">Members with a result (of {data.members_total}) · results saved.</p></div></div>
              <div className="card__body">
                <div className="bars">
                  {TRACKER_KEYS.map((key) => {
                    const members = data.members_completed[key];
                    const pct = data.members_total ? Math.round((members / data.members_total) * 100) : 0;
                    return (
                      <div className="bar" key={key}>
                        <span className="bar__label">{TRACKER_LABELS[key]}</span>
                        <span className="bar__track"><span className="bar__fill bar__fill--deep" style={{ width: `${Math.max(pct, members ? 4 : 0)}%` }} /></span>
                        <span className="bar__n">{members} <span className="t-muted">/ {data.attempts[key]}</span></span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid--2" style={{ marginTop: "var(--s-5)" }}>
            <div className="card">
              <div className="card__head"><div><h2 className="card__title">Results saved by month</h2><p className="t-support">Per tracker, last twelve months.</p></div></div>
              <div className="card__body card__body--flush">
                <div className="table-wrap"><table className="table table--compact">
                  <thead><tr><th scope="col">Month</th>{TRACKER_KEYS.map((key) => <th scope="col" key={key}>{TRACKER_LABELS[key]}</th>)}</tr></thead>
                  <tbody>
                    {data.members_by_month.map((m, index) => (
                      <tr key={m.month}><th scope="row">{monthLabel(m.month)}</th>{TRACKER_KEYS.map((key) => <td key={key}>{data.attempts_by_month[key][index]?.count ?? 0}</td>)}</tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            </div>
            <div className="card">
              <div className="card__head"><div><h2 className="card__title">Guided experiences</h2><p className="t-support">Sprout's guided flows: starts and where they stand.</p></div></div>
              <div className="card__body card__body--flush">
                <div className="table-wrap"><table className="table table--compact">
                  <thead><tr><th scope="col">Flow</th><th scope="col">Started</th><th scope="col">In progress</th><th scope="col">Paused</th><th scope="col">Completed</th><th scope="col">Explored instead</th></tr></thead>
                  <tbody>
                    {data.guided_flows.map((f) => <tr key={f.flow_key}><th scope="row">{f.flow_title}</th><td>{f.started}</td><td>{f.in_progress}</td><td>{f.paused}</td><td>{f.completed}</td><td>{f.skipped}</td></tr>)}
                    {!data.guided_flows.length && <tr><td colSpan={6} className="t-support">No guided flow is active.</td></tr>}
                  </tbody>
                </table></div>
              </div>
            </div>
          </div>
          <div className="grid grid--2" style={{ marginTop: "var(--s-5)" }} data-testid="insights-phase1">
            <div className="card">
              <div className="card__head"><div><h2 className="card__title">Requests & Inbox</h2><p className="t-support">Messages received by month, by kind and by status.</p></div></div>
              <div className="card__body">
                <MonthBars series={data.requests_by_month} />
                <dl className="kv" style={{ marginTop: "var(--s-4)" }}>
                  {Object.entries(data.requests_by_kind).map(([kind, count]) => <span key={kind} style={{ display: "contents" }}><dt>{REQUEST_KIND_LABELS[kind as RequestKind] ?? kind}</dt><dd>{count}</dd></span>)}
                  {Object.entries(data.requests_by_status).map(([status, count]) => <span key={status} style={{ display: "contents" }}><dt>{REQUEST_STATUS_LABELS[status as RequestStatus] ?? status}</dt><dd>{count}</dd></span>)}
                  {!Object.keys(data.requests_by_kind).length && <><dt>Requests</dt><dd className="t-muted">None yet</dd></>}
                </dl>
              </div>
            </div>
            <div className="card">
              <div className="card__head"><div><h2 className="card__title">Journal use</h2><p className="t-support">Mood Tracker and Food Diary — entries and how many members use them.</p></div></div>
              <div className="card__body">
                <dl className="kv">
                  <dt>Mood entries</dt><dd>{data.mood_entries} across {data.mood_members} member{data.mood_members === 1 ? "" : "s"}</dd>
                  <dt>Food Diary entries</dt><dd>{data.food_diary_entries} across {data.food_diary_members} member{data.food_diary_members === 1 ? "" : "s"}</dd>
                </dl>
                <p className="t-support" style={{ marginTop: "var(--s-4)" }}>Counts only. No mood or nutrition conclusion is drawn here.</p>
              </div>
            </div>
          </div>
          <p className="t-support" style={{ marginTop: "var(--s-4)" }}>Generated {fmtDate(data.generated_at)} from the local database. Synthetic demonstration data.</p>
        </>
      )}
    </div>
  );
}

function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function MonthBars({ series }: { series: MonthCount[] }) {
  const max = Math.max(1, ...series.map((m) => m.count));
  return (
    <div className="bars">
      {series.map((m) => (
        <div className="bar" key={m.month}>
          <span className="bar__label">{monthLabel(m.month)}</span>
          <span className="bar__track"><span className="bar__fill" style={{ width: `${Math.max(m.count ? 4 : 0, Math.round((m.count / max) * 100))}%` }} /></span>
          <span className="bar__n">{m.count}</span>
        </div>
      ))}
    </div>
  );
}
