"use client";

import type { ReactNode } from "react";
import { ADVANCED_NAV, PageHead, Subnav, fmtDate } from "@/components/admin/admin-chrome";
import type { TraceRow } from "@/lib/admin-api";

export function AdvancedPage({ active, title, desc, children }: { active: (typeof ADVANCED_NAV)[number]["key"]; title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <PageHead title={title} desc={desc}
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Companion", href: "/admin/companion/conversations" }, { label: "Settings", href: "/admin/companion/settings" }, { label: "Advanced" }]} />
      <Subnav items={ADVANCED_NAV} active={active} />
      {children}
    </div>
  );
}

export function Counts({ counts, empty = "None yet" }: { counts: Record<string, number>; empty?: string }) {
  const entries = Object.entries(counts);
  if (!entries.length) return <span className="t-support">{empty}</span>;
  return <div className="tagrow">{entries.map(([key, value]) => <span key={key} className="tag">{key.replace(/_/g, " ")} · {value}</span>)}</div>;
}

export function TraceTable({ rows, caption }: { rows: TraceRow[]; caption: string }) {
  if (!rows.length) return <p className="loading-row">No Sprout turns recorded yet.</p>;
  return (
    <div className="table-wrap">
      <table className="table table--compact">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th>When</th><th>Member ref</th><th>Provider</th><th>Latency</th><th>Tokens</th><th>Policy</th><th>Safety</th><th>Sources</th><th>Feedback</th><th>Error</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.trace_id}>
              <td className="t-nowrap">{fmtDate(row.created_at)}</td>
              <td className="mono">{row.member_ref}</td>
              <td>{row.provider ? `${row.provider}${row.model ? ` · ${row.model}` : ""}` : "—"}</td>
              <td className="t-num">{row.provider ? `${row.latency_ms} ms` : "—"}</td>
              <td className="t-num">{row.input_tokens != null ? `${row.input_tokens} / ${row.output_tokens ?? 0}` : "—"}</td>
              <td>{row.policy_outcome}{row.policy_category ? ` (${row.policy_category})` : ""}</td>
              <td>{row.safety_result.replace(/_/g, " ")}</td>
              <td className="t-num">{row.retrieval_count}{row.top_retrieval_score != null ? ` · top ${Math.round(row.top_retrieval_score * 100)}%` : ""}</td>
              <td>{row.feedback ? row.feedback.replace("_", " ") : "—"}</td>
              <td>{row.error_category ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
