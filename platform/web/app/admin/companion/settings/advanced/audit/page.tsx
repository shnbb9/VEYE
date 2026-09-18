"use client";

import { useEffect, useState } from "react";
import { AdvancedPage } from "@/components/admin/advanced-page";
import { fmtDate } from "@/components/admin/admin-chrome";
import { getAudit, type AuditEntry } from "@/lib/admin-api";

export default function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAudit().then(setRows).catch((reason) => setError(reason instanceof Error ? reason.message : "The audit log could not be loaded."));
  }, []);

  return (
    <AdvancedPage active="audit" title="Audit" desc="Who changed what in the console: knowledge-source lifecycle, Companion settings, conversation and feedback reviews. Policy decisions on member messages are audited separately with each conversation.">
      {error && <p className="errorbar">{error}</p>}
      <div className="card">
        <div className="card__body card__body--flush">
          {rows === null && <p className="loading-row">Loading…</p>}
          {rows && rows.length === 0 && <p className="loading-row">No administrator actions recorded yet.</p>}
          {rows && rows.length > 0 && (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="t-nowrap">{fmtDate(row.created_at)}</td>
                      <td>{row.actor_name}</td>
                      <td>{row.action}</td>
                      <td className="mono">{row.entity_type}{row.entity_id ? ` ${row.entity_id.slice(0, 8)}…` : ""}</td>
                      <td className="t-support">{Object.entries(row.details).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value ?? "—")}`).join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdvancedPage>
  );
}
