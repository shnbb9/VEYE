"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  calculateSimpleQuiz,
  getSimpleQuizDefinition,
  getSimpleQuizHistory,
  type SimpleQuizDefinition,
  type SimpleQuizHistory,
  type SimpleQuizHistoryItem,
} from "@/lib/api";
import { formatUpd } from "@/lib/member-format";
import { BackChevron } from "@/components/member/nav-icons";
import { usePublishedCopy } from "@/components/member/published-copy";

/* Simple Quiz (build/dashboard.html, #view-quiz-simple): eight yes/no rows,
   the count result with the client's donut (Yes green, No orange), and
   "Previous Entries" where a day expands to that day's eight answers. The
   quiz is a COUNT — Simple Quiz.docx defines no status tiers and no dosage,
   so none are shown — and it never creates or changes a Health Number. The
   count is calculated and stored by the API (pinned calculation version). */

type YesNo = "yes" | "no";
const CIRCUMFERENCE = 2 * Math.PI * 46;

export default function SimpleQuizPage() {
  const intro = usePublishedCopy("simple_quiz_intro", "8 yes/no questions to track your progress. Best health is 8 “No” answers.");
  const [definition, setDefinition] = useState<SimpleQuizDefinition | null>(null);
  const [history, setHistory] = useState<SimpleQuizHistory | null>(null);
  const [mode, setMode] = useState<"loading" | "form" | "result">("loading");
  const [answers, setAnswers] = useState<Record<string, YesNo>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getSimpleQuizDefinition(), getSimpleQuizHistory()])
      .then(([def, hist]) => { setDefinition(def); setHistory(hist); setMode(hist.latest ? "result" : "form"); })
      .catch((reason: Error) => { setError(reason.message); setMode("form"); });
  }, []);

  const questions = definition?.questions ?? [];
  const latest = history?.latest ?? null;
  const entries = history?.history ?? [];
  const yes = questions.filter((q) => answers[q.key] === "yes").length;
  const no = questions.filter((q) => answers[q.key] === "no").length;
  const complete = questions.length > 0 && yes + no === questions.length;

  function retake() {
    setAnswers({});
    setMode("form");
    window.scrollTo(0, 0);
  }

  async function submit() {
    if (!complete) return;
    setSaving(true); setError("");
    try {
      const saved = await calculateSimpleQuiz(answers);
      setHistory((current) => ({ member_id: saved.member_id, latest: saved, history: [saved, ...(current?.history ?? [])] }));
      setMode("result");
      window.scrollTo(0, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not save this quiz.");
    } finally { setSaving(false); }
  }

  return (
    <div className="view-quiz-simple">
      <header className="quiz-topbar fade-in">
        <Link className="quiz-back" href="/app/progress"><BackChevron /> Back</Link>
      </header>

      {mode === "loading" && <section className="quiz-card-wrap"><div className="quiz-card"><p className="history-empty">Loading your quiz…</p></div></section>}

      {mode === "form" && (
        <section className="quiz-card-wrap" id="simpleQuizFormWrap">
          <div className="quiz-card fade-in d1">
            <div className="quiz-card-head">
              <h2>Simple Quiz</h2>
              <p data-testid="sq-intro">{intro}</p>
            </div>
            <div className="quiz-rows" id="simpleQuizRows">
              {questions.map((q, index) => (
                <div className="quiz-row" key={q.key}>
                  <span className="quiz-q">{q.label}</span>
                  <div className="yn-buttons">
                    {(["yes", "no"] as YesNo[]).map((value) => (
                      <button key={value} type="button" className={`yn-btn${answers[q.key] === value ? ` ${value}-active` : ""}`} data-q={index} data-a={value}
                              aria-pressed={answers[q.key] === value} onClick={() => { setAnswers((current) => ({ ...current, [q.key]: value })); setError(""); }}>
                        {value === "yes" ? "Yes" : "No"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {error && <p className="fdx-err" role="alert">{error}</p>}
            <div className="quiz-foot">
              <span className="quiz-counter" id="simpleCounter">{no} No / {yes} Yes</span>
              <button className="quiz-submit" id="simpleSubmit" type="button" disabled={!complete || saving} onClick={submit}>{saving ? "Saving…" : "Submit Quiz"}</button>
            </div>
          </div>
        </section>
      )}

      {mode === "result" && latest && (
        <section className="quiz-result-wrap" id="simpleQuizResultWrap">
          <div className="quiz-result-card fade-in d1">
            <div className="result-head">
              <h2>Your Results</h2>
              <div className="result-row">
                <span className="result-score" id="simpleResultScore">{latest.no_count} No / {latest.yes_count} Yes</span>
              </div>
              <p className="result-desc" id="simpleResultDesc">{latest.progress_note}</p>
            </div>
            <Donut item={latest} />
            <p className="bmi-trend-note" style={{ marginTop: 10 }}>Saved {formatUpd(latest.completed_at)} · calculation version {latest.calculation_version}</p>
            <div className="result-actions">
              <button className="btn-ghost" id="simpleRetake" type="button" onClick={retake}>Re-take quiz</button>
              <Link className="btn-primary" id="simpleResultBack" href="/app/progress">Back to Progress</Link>
            </div>
          </div>
        </section>
      )}

      {entries.length > 0 && definition && (
        <section className="history-wrap" id="simpleHistoryWrap">
          <div className="history-card fade-in d2">
            <div className="history-head">
              <h3>Previous Entries</h3>
              <span className="history-hint">Fewer &ldquo;Yes&rdquo; answers over time means you are improving.</span>
            </div>
            <HistoryList entries={entries} definition={definition} />
          </div>
        </section>
      )}
    </div>
  );
}

/** The compact Yes/No summary: latest counts + a donut. Colours are the
 *  client's own request (Yes green, No orange). Pure presentation. */
function Donut({ item }: { item: SimpleQuizHistoryItem }) {
  const total = item.yes_count + item.no_count;
  const yesArc = total ? (item.yes_count / total) * CIRCUMFERENCE : 0;
  return (
    <div className="sq-visual" id="sqVisual">
      <div className="sq-latest">
        <span className="sq-latest-label">Most recent result</span>
        <span className="sq-latest-count" id="sqLatestCount">{item.no_count} No / {item.yes_count} Yes</span>
        <span className="sq-latest-date" id="sqLatestDate">Taken {formatUpd(item.completed_at)}</span>
      </div>
      <div className="sq-donut-wrap">
        <svg className="sq-donut" viewBox="0 0 120 120" role="img" id="sqDonut" aria-label={`Donut chart: ${item.yes_count} yes answers in green, ${item.no_count} no answers in orange.`}>
          <circle cx="60" cy="60" r="46" fill="none" stroke="#F3EAD9" strokeWidth="16" />
          <circle cx="60" cy="60" r="46" fill="none" stroke="#E89A4A" strokeWidth="16" id="sqDonutNo" strokeDasharray={`${CIRCUMFERENCE.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`} strokeDashoffset="0" transform="rotate(-90 60 60)" />
          <circle cx="60" cy="60" r="46" fill="none" stroke="#7DBE5F" strokeWidth="16" id="sqDonutYes" strokeDasharray={`${yesArc.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`} strokeDashoffset="0" transform="rotate(-90 60 60)" strokeLinecap="butt" />
        </svg>
        <div className="sq-legend">
          <span><i style={{ background: "#7DBE5F" }} /> Yes <b id="sqLegendYes">{item.yes_count}</b></span>
          <span><i style={{ background: "#E89A4A" }} /> No <b id="sqLegendNo">{item.no_count}</b></span>
        </div>
      </div>
    </div>
  );
}

function HistoryList({ entries, definition }: { entries: SimpleQuizHistoryItem[]; definition: SimpleQuizDefinition }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="history-list" id="simpleHistoryList">
      {entries.map((item) => {
        const isOpen = !!open[item.attempt_id];
        return (
          <div className={`history-item${isOpen ? " open" : ""}`} key={item.attempt_id}>
            <button className="history-row" type="button" aria-expanded={isOpen} onClick={() => setOpen((current) => ({ ...current, [item.attempt_id]: !isOpen }))}>
              <span className="history-date">{formatUpd(item.completed_at)}</span>
              <span className="history-value">{item.no_count} No / {item.yes_count} Yes</span>
              <span className="history-caret">▶</span>
            </button>
            <div className="history-detail" hidden={!isOpen}>
              <div className="history-detail-head">Answers on this day</div>
              {definition.questions.map((q) => {
                const value = item.answers[q.key];
                return <div className="history-detail-line" key={q.key}><span>{q.label}</span><b className={value === "yes" ? "ans-yes" : value === "no" ? "ans-no" : ""}>{value === "yes" ? "Yes" : value === "no" ? "No" : "—"}</b></div>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
