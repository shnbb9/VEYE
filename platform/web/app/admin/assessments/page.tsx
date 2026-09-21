"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon, PageHead, fmtDate } from "@/components/admin/admin-chrome";
import { listInstruments, type Instrument } from "@/lib/admin-console-api";

/* Assessments (admin prototype screens/assessments.js): the five instruments
   with their pinned calculation version, members scored and results saved.
   The calculation logic is SYSTEM MANAGED — weights, bands and formulas are
   not editable CMS fields anywhere in this console. */

const ICONS: Record<string, string> = { health_number: "activity", body_composition: "users", blood_markers: "clipboard", health_assessment: "file-text", simple_quiz: "check-circle" };

export default function AssessmentsPage() {
  const [instruments, setInstruments] = useState<Instrument[] | null>(null);
  const [error, setError] = useState("");
  const [compare, setCompare] = useState(false);

  useEffect(() => {
    listInstruments().then(setInstruments).catch((reason) => setError(reason instanceof Error ? reason.message : "The instruments could not be loaded."));
  }, []);

  return (
    <div className="page">
      <PageHead title="Assessments" desc="Everything that turns a member's answers into a number, and every result it has produced. Questions, weights, bands and formulas are system managed and read-only here."
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Assessments" }]}
                actions={<button className="btn btn--secondary" type="button" onClick={() => setCompare((v) => !v)}>How scoring differs</button>} />
      {error && <p className="errorbar">{error}</p>}

      <div className="statusstrip" style={{ "--strip-tone": "var(--status-positive)" } as React.CSSProperties}>
        <span className="statusstrip__icon"><Icon name="lock" size={18} /></span>
        <span className="statusstrip__text"><b>System managed</b> — deterministic calculations with pinned versions. Historical results are never re-scored, and no administrator can edit a stored result.</span>
      </div>

      {compare && (
        <div className="card" style={{ marginBottom: "var(--s-5)" }}>
          <div className="card__head"><div><h2 className="card__title">How scoring differs</h2><p className="t-support">The three questionnaires are separate instruments with separate scoring and separate records.</p></div></div>
          <div className="card__body card__body--flush">
            <div className="table-wrap"><table className="table">
              <thead><tr><th scope="col">Instrument</th><th scope="col">Questions</th><th scope="col">Produces</th><th scope="col">Direction</th></tr></thead>
              <tbody>
                <tr><th scope="row">Health Number</th><td>12, of which 9 score</td><td>1 to 10, one of four bands</td><td>Lower is better</td></tr>
                <tr><th scope="row">Simple Quiz</th><td>8 yes/no</td><td>A count of Yes and No answers</td><td>Fewer Yes is better</td></tr>
                <tr><th scope="row">Health Assessment</th><td>11, each scoring 1, 2 or 3</td><td>11 to 33, one of six bands</td><td>Lower is better</td></tr>
              </tbody>
            </table></div>
          </div>
          <div className="card__foot"><span className="t-support">They are never combined, each keeps its own dated history, and the Simple Quiz never creates or changes a Health Number.</span></div>
        </div>
      )}

      {!instruments && !error && <p className="loading-row">Loading…</p>}
      {instruments && (
        <div className="instruments" data-testid="instruments">
          {instruments.map((instrument) => (
            <Link className="instr" href={`/admin/assessments/${instrument.key}`} key={instrument.key} style={{ textDecoration: "none", color: "inherit" }}>
              <span className="instr__name">
                <span className="instr__icon"><Icon name={ICONS[instrument.key] ?? "clipboard"} size={20} /></span>
                <span style={{ minWidth: 0 }}>
                  <span className="t-strong" style={{ fontSize: "var(--fs-card-title)", display: "block" }}>{instrument.name}</span>
                  <span className="instr__desc">{instrument.description}</span>
                </span>
              </span>
              <span className="instr__versions">
                <span className="vslot vslot--live">
                  <span className="vslot__label">Calculation</span>
                  <span className="vslot__v">{instrument.calculation_version}</span>
                  <span className="vslot__meta">{instrument.calculation_owner}</span>
                </span>
                <span className="vslot">
                  <span className="vslot__label">Members scored</span>
                  <span className="vslot__v">{instrument.members_scored}</span>
                  <span className="vslot__meta">{instrument.attempts_total} result{instrument.attempts_total === 1 ? "" : "s"}{instrument.last_completed_at ? ` · last ${fmtDate(instrument.last_completed_at)}` : ""}</span>
                </span>
              </span>
              <span className="btn btn--secondary btn--sm">Open</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
