"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdvancedPage, Counts } from "@/components/admin/advanced-page";
import { Chip, fmtDate } from "@/components/admin/admin-chrome";
import { getSafetyAnalytics, type SafetyAnalytics } from "@/lib/admin-api";

export default function SafetyAnalyticsPage() {
  const [data, setData] = useState<SafetyAnalytics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getSafetyAnalytics(30).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Safety analytics could not be loaded."));
  }, []);

  return (
    <AdvancedPage active="safety-analytics" title="Safety Analytics" desc="How the policy gate and the output-safety check decided over the last 30 days, and every conversation handed to a person.">
      {error && <p className="errorbar">{error}</p>}
      {data && (
        <div className="stackgap">
          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Policy decisions</h2><p className="t-support">Policy version {data.policy_version}. Decisions are deterministic rules, never a model.</p></div></div>
            <div className="card__body">
              <dl className="kv">
                <dt>By outcome</dt><dd><Counts counts={data.decisions_by_outcome} /></dd>
                <dt>By category</dt><dd><Counts counts={data.decisions_by_category} /></dd>
                <dt>Output safety</dt><dd><Counts counts={data.safety_results} /></dd>
              </dl>
            </div>
          </div>
          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Handed to a person</h2></div></div>
            <div className="card__body card__body--flush">
              {data.escalations.length === 0 ? <p className="loading-row">No conversation has been handed to a person.</p> : (
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead><tr><th>Member</th><th>Why</th><th>When</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {data.escalations.map((row) => (
                        <tr key={row.id}>
                          <td>{row.member_name}</td>
                          <td className="t-support">{row.flag_reason}</td>
                          <td className="t-nowrap">{fmtDate(row.last_message_at)}</td>
                          <td>{row.reviewed_at ? <Chip label="Reviewed" tone="live" /> : <Chip label="Needs review" tone="attention" />}</td>
                          <td><Link className="btn btn--ghost btn--sm" href={`/admin/companion/conversations?conversation=${row.id}`}>Open</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AdvancedPage>
  );
}
