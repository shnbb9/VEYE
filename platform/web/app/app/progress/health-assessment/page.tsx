"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  calculateHealthAssessment,
  getHealthAssessmentDefinition,
  getHealthAssessmentHistory,
  type HealthAssessmentDefinition,
  type HealthAssessmentHistory,
  type HealthAssessmentHistoryItem,
} from "@/lib/api";
import { formatUpd } from "@/lib/member-format";
import { BackChevron } from "@/components/member/nav-icons";
import { usePublishedCopy } from "@/components/member/published-copy";

/* Health Assessment (build/dashboard.html, #view-assessment): the 11-row
   questionnaire with the client's information icons, the result card with the
   dated bar chart on the left and the latest score on the right, the
   supplement recommendation block, and "Previous Assessments". Questions,
   bands, wording and the EPA/DHA suggestion all come from the API (one
   calculation, pinned version); the browser holds no scoring. First use runs
   the questionnaire; afterwards it opens on the saved result with Re-take as
   the primary action (client, Functional Edits 260824). The member-facing
   name stays "Health Assessment" pending Cara's confirmation. */

type Tier = 1 | 2 | 3;
const TIER_CLASS: Record<Tier, string> = { 1: "best", 2: "middle", 3: "worst" };

export default function HealthAssessmentPage() {
  const parametersNote = usePublishedCopy("health_assessment_parameters_note",
    "These parameters reflect the overall inflammation in your organs. Your goal is to keep inflammation in control — not too much or too little. Symptoms of chronic diseases are associated with chronic high inflammation.");
  const [definition, setDefinition] = useState<HealthAssessmentDefinition | null>(null);
  const [history, setHistory] = useState<HealthAssessmentHistory | null>(null);
  const [mode, setMode] = useState<"loading" | "form" | "result">("loading");
  const [answers, setAnswers] = useState<Record<string, Tier>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<{ key: string; x: number; y: number } | null>(null);
  const infoTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    Promise.all([getHealthAssessmentDefinition(), getHealthAssessmentHistory()])
      .then(([def, hist]) => { setDefinition(def); setHistory(hist); setMode(hist.latest ? "result" : "form"); })
      .catch((reason: Error) => { setError(reason.message); setMode("form"); });
  }, []);

  useEffect(() => {
    if (!info) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setInfo(null); infoTrigger.current?.focus(); } };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".info-popover") && !target.closest(".info-i")) setInfo(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [info]);

  const questions = definition?.questions ?? [];
  const answered = questions.filter((q) => answers[q.key]).length;
  const latest = history?.latest ?? null;
  const entries = history?.history ?? [];

  function showInfo(key: string, button: HTMLButtonElement) {
    infoTrigger.current = button;
    const rect = button.getBoundingClientRect();
    setInfo({ key, x: Math.min(rect.left, window.innerWidth - 340), y: rect.bottom + 8 });
  }

  function retake() {
    setAnswers({});
    setMode("form");
    window.scrollTo(0, 0);
  }

  async function submit() {
    if (answered < questions.length) return;
    setSaving(true); setError("");
    try {
      const saved = await calculateHealthAssessment(answers);
      setHistory((current) => ({ member_id: saved.member_id, latest: saved, history: [saved, ...(current?.history ?? [])] }));
      setMode("result");
      window.scrollTo(0, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not save this assessment.");
    } finally { setSaving(false); }
  }

  return (
    <div className="view-assessment">
      <header className="quiz-topbar fade-in">
        <Link className="quiz-back" href="/app/progress"><BackChevron /> Back to My Progress</Link>
      </header>

      {mode === "loading" && <section className="quiz-card-wrap"><div className="quiz-card"><p className="history-empty">Loading your assessment…</p></div></section>}

      {mode === "form" && (
        <section className="quiz-card-wrap" id="assessFormWrap">
          <div className="quiz-card fade-in d1">
            <div className="quiz-card-head">
              <h2>Health Assessment</h2>
              <p>11 questions about your daily signals. The <strong>first choice</strong> on each row is the healthiest answer.</p>
            </div>
            <div className="assess-rows" id="assessRows">
              {questions.map((q, index) => (
                <div className="assess-row" data-q={index} key={q.key}>
                  <span className="assess-q"><span className="qnum">{index + 1}.</span>{q.label}</span>
                  {q.options.map((option) => {
                    const selected = answers[q.key] === option.value;
                    return (
                      <button key={option.value} type="button" className={`assess-opt${selected ? ` selected ${TIER_CLASS[option.value]}` : ""}`}
                              data-tier={TIER_CLASS[option.value]} data-score={option.value} aria-pressed={selected}
                              onClick={() => { setAnswers((current) => ({ ...current, [q.key]: option.value })); setError(""); }}>
                        {option.label}
                      </button>
                    );
                  })}
                  <button type="button" className="info-i" aria-label={`About ${q.label}`} onClick={(event) => { event.preventDefault(); showInfo(q.key, event.currentTarget); }}>i</button>
                </div>
              ))}
            </div>
            {error && <p className="fdx-err" role="alert">{error}</p>}
            <div className="quiz-foot">
              <span className="quiz-counter" id="assessCounter">{answered} / {questions.length || 11} answered</span>
              <button className="quiz-submit" id="assessSubmit" type="button" disabled={answered < (questions.length || 11) || saving} onClick={submit}>
                {saving ? "Saving…" : "Submit Assessment"}
              </button>
            </div>
          </div>
        </section>
      )}

      {mode === "result" && latest && definition && (
        <section className="quiz-result-wrap" id="assessResultWrap">
          <div className="quiz-result-card fade-in d1">
            <div className="result-head">
              <span className="result-eyebrow">Inflammation Snapshot</span>
              <h2>Your Assessment</h2>
              <div className="assess-result-pair">
                <div className="assess-chart">
                  <AssessBars entries={entries} max={definition.scale_max} />
                  <p className="assess-chart-note">Scored {definition.scale_min}&ndash;{definition.scale_max} &mdash; a <strong>lower</strong> score means less inflammation, so lower bars are better.</p>
                </div>
                <div className="assess-latest">
                  <div className="result-row" style={{ marginTop: 14 }}>
                    <span className="result-score" id="assessResultScore">{latest.total} / {definition.scale_max}</span>
                    <span className={`result-status color-${latest.tone}`} id="assessResultStatus">{latest.status}</span>
                  </div>
                  <p className="result-desc" id="assessResultDesc">{latest.interpretation}</p>
                  <p className="result-desc result-desc--params" data-testid="ha-parameters-note">{parametersNote}</p>
                </div>
              </div>
            </div>
            <div className="result-recs">
              <div className="recs-head">Supplement Recommendation</div>
              <div className="rec-row"><span className="rec-label">EPA/DHA suggested dosage</span><span className="rec-value" id="assessRecEpa">{latest.epa_dha_dose}</span></div>
              <div className="rec-subhead">Polyphenol suggested dosage &mdash; the same for all scores</div>
              {latest.polyphenol_lines.map((line) => (
                <div className="rec-row rec-row--poly" key={line.amount}><span className="rec-label">{line.amount}</span><span className="rec-note-inline">{line.note}</span></div>
              ))}
              <p className="rec-note">The separate {definition.neurological_row.epa_dha_dose} EPA/DHA row applies to neurological disorders only &mdash; a condition this assessment does not establish, so it is never assigned here.</p>
              <p className="rec-var">There is a tremendous variation of biological responses once you start using activated essential fatty acids in combination with a balanced diet. The Health Assessment allows you to control them without blood testing.</p>
              <p className="rec-disclaimer">For informational purposes only. Not medical advice. Consult your healthcare provider.</p>
              <p className="bmi-trend-note" style={{ marginTop: 10 }}>Saved {formatUpd(latest.completed_at)} · calculation version {latest.calculation_version}</p>
            </div>
            <div className="result-actions">
              <button className="btn-primary" id="assessRetake" type="button" onClick={retake}>Re-take</button>
              <Link className="btn-ghost" id="assessResultBack" href="/app/progress">Back to Progress</Link>
            </div>
          </div>
        </section>
      )}

      {entries.length > 0 && definition && (
        <section className="history-wrap" id="assessHistoryWrap">
          <div className="history-card fade-in d2">
            <div className="history-head">
              <h3>Previous Assessments</h3>
              <span className="history-hint">A lower score out of {definition.scale_max} means less inflammation.</span>
            </div>
            <HistoryList entries={entries} definition={definition} />
          </div>
        </section>
      )}

      {info && definition && (
        <div className="info-popover" role="dialog" aria-labelledby="infoTitle" style={{ left: info.x, top: info.y }}>
          <button className="info-close" type="button" aria-label="Close" onClick={() => { setInfo(null); infoTrigger.current?.focus(); }}>&times;</button>
          <h4 id="infoTitle">{questions.find((q) => q.key === info.key)?.label}</h4>
          <p>{questions.find((q) => q.key === info.key)?.info}</p>
        </div>
      )}
    </div>
  );
}

/** Dated bar chart of the last six assessments — latest highlighted (client, 20 Aug 2026). */
function AssessBars({ entries, max }: { entries: HealthAssessmentHistoryItem[]; max: number }) {
  const shown = [...entries].reverse().slice(-6);
  return (
    <div className="assess-bars" id="assessBars" role="img" aria-label="Bar chart of your Health Assessment scores by date">
      {shown.map((item, index) => {
        const pct = Math.max(6, Math.round((item.total / max) * 100));
        return (
          <div className={`assess-bar${index === shown.length - 1 ? " latest" : ""}`} key={item.attempt_id}>
            <b>{item.total}</b>
            <i style={{ height: `${pct}%` }} />
            <span className="assess-bar-date">{formatUpd(item.completed_at)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Replays each SAVED report — score, interpretation, the recommendation
 *  issued that day and the answers used. Nothing is re-scored. */
function HistoryList({ entries, definition }: { entries: HealthAssessmentHistoryItem[]; definition: HealthAssessmentDefinition }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="history-list" id="assessHistoryList">
      {entries.map((item) => {
        const isOpen = !!open[item.attempt_id];
        return (
          <div className={`history-item${isOpen ? " open" : ""}`} key={item.attempt_id}>
            <button className="history-row" type="button" aria-expanded={isOpen} onClick={() => setOpen((current) => ({ ...current, [item.attempt_id]: !isOpen }))}>
              <span className="history-date">{formatUpd(item.completed_at)}</span>
              <span className="history-value">{item.total} / {definition.scale_max}</span>
              <span className="history-meta">{item.status}</span>
              <span className="history-caret">▶</span>
            </button>
            <div className="history-detail" hidden={!isOpen}>
              <div className="history-detail-head">Report</div>
              <div className="history-detail-line"><span>Score</span><b>{item.total} / {definition.scale_max}</b></div>
              <div className="history-detail-line"><span>Interpretation</span><b>{item.status}</b></div>
              <p className="history-detail-note">{item.interpretation}</p>
              <div className="history-detail-head">Recommendation issued that day</div>
              <div className="history-detail-line"><span>EPA/DHA suggested dosage</span><b>{item.epa_dha_dose}</b></div>
              <p className="history-detail-note">Polyphenols are the same for every score: 500mg, 1000mg and 1500mg — see the current report.</p>
              <div className="history-detail-head">Answers used</div>
              {definition.questions.map((q) => {
                const value = item.answers[q.key];
                const label = q.options.find((o) => o.value === value)?.label ?? "—";
                return <div className="history-detail-line" key={q.key}><span>{q.label}</span><b>{label}{value ? ` (${value})` : ""}</b></div>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
