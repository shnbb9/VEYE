"use client";

import { useAssessmentStart } from "@/components/member/use-assessment-start";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/member/member-chrome";
import { calculateHealthNumber, getHealthNumberHistory, type HealthNumberHistory, type HealthNumberHistoryItem } from "@/lib/api";
import {
  RETAKE_QUESTIONS, RETAKE_YES_NO, retakeAnswered, retakeToApi, type RetakeAnswer,
} from "@/lib/health-number";
import { displayHealthNumber, formatHistDate } from "@/lib/member-format";

/* The Health Number inside the dashboard, as the approved prototype draws it
   (build/dashboard.html, view quiz-health): opening it shows the saved result
   with its dated history and Re-take as the primary action, or — first time,
   or from "Take / Retake the assessment" — the eleven-step wizard, which goes
   straight to the result (client, Dashboard edits 20 Aug 2026). The owner
   chose this over sending members back to the public onboarding quiz (14 Nov
   2026). Every number is the API's: the answers are scored and stored by
   POST /api/v1/health-number/calculate, and history is never re-scored. */

type Mode = "loading" | "wizard" | "result";

const blankAnswers = (): RetakeAnswer[] => RETAKE_QUESTIONS.map(() => null);
const blankOther = (): string[] => RETAKE_QUESTIONS.map(() => "");

function trendNote(history: HealthNumberHistoryItem[]): string {
  const numbers = history.slice().reverse().map((item) => item.displayed_score); // chronological
  if (numbers.length === 1) return "This is your first recorded result. Retake the quiz over time and your trend will appear here.";
  if (numbers.length < 2) return "";
  const current = numbers[numbers.length - 1], previous = numbers[numbers.length - 2];
  if (current < previous) return `You are improving — congratulations. Your number moved from ${displayHealthNumber(previous)} to ${displayHealthNumber(current)}, and lower is better on this scale.`;
  if (current === previous) return `Holding steady at ${displayHealthNumber(current)} — that is good. Lower is better on this scale.`;
  return `Your number moved up from ${displayHealthNumber(previous)} to ${displayHealthNumber(current)}. Lower is better on this scale — the areas highlighted above are the place to start.`;
}

function HealthNumberView() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const fromDashboard = params.get("from") === "dashboard";
  const startNow = params.get("start") === "1";
  const backHref = fromDashboard ? "/app" : "/app/progress";

  const [mode, setMode] = useState<Mode>("loading");
  const [data, setData] = useState<HealthNumberHistory | null>(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<RetakeAnswer[]>(blankAnswers);
  const [other, setOther] = useState<string[]>(blankOther);
  const [busy, setBusy] = useState(false);
  const numericInput = useRef<HTMLInputElement>(null);
  useAssessmentStart("health_number", mode === "wizard" && answers.some((item) => (Array.isArray(item) ? item.length > 0 : item !== null && item !== undefined && item !== "")));

  const start = useCallback(() => {
    setAnswers(blankAnswers());
    setOther(blankOther());
    setStep(0);
    setMode("wizard");
  }, []);

  useEffect(() => {
    let alive = true;
    getHealthNumberHistory()
      .then((history) => {
        if (!alive) return;
        setData(history);
        // First use runs the questionnaire; afterwards the saved result opens,
        // unless the member asked to take it again.
        if (startNow || !history.latest) start(); else setMode("result");
      })
      .catch((reason: Error) => {
        if (!alive) return;
        setLoadError(reason.message || "Your Health Number could not be loaded. Please try again.");
        setMode("result");
      });
    return () => { alive = false; };
  }, [start, startNow]);

  const question = RETAKE_QUESTIONS[step];
  const total = RETAKE_QUESTIONS.length;
  const answer = answers[step];
  const ready = mode === "wizard" && retakeAnswered(question, answer, other[step]);

  useEffect(() => {
    if (mode !== "wizard" || question.type !== "numeric") return;
    const timer = window.setTimeout(() => numericInput.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [mode, question.type, step]);

  function setAnswer(value: RetakeAnswer) {
    setAnswers((current) => current.map((item, index) => (index === step ? value : item)));
  }
  function setWritten(value: string) {
    setOther((current) => current.map((item, index) => (index === step ? value : item)));
  }

  function choose(value: string) {
    if (question.type === "multi") {
      let picked = Array.isArray(answer) ? [...answer] : [];
      const exclusive = question.exclusive;
      if (exclusive && value === exclusive) {
        // "No other plans" stands alone (XLSX R23).
        picked = picked.includes(exclusive) ? [] : [exclusive];
      } else {
        if (exclusive) picked = picked.filter((item) => item !== exclusive);
        picked = picked.includes(value) ? picked.filter((item) => item !== value) : [...picked, value];
      }
      setAnswer(picked);
      if (!picked.includes("Other")) setWritten("");
    } else {
      setAnswer(value);
      if ("otherWriteIn" in question && value !== "Other") setWritten("");
    }
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    try {
      await calculateHealthNumber(retakeToApi(answers, other));
      const history = await getHealthNumberHistory();
      setData(history);
      setLoadError("");
      setMode("result");
      if (startNow) router.replace(fromDashboard ? "/app/progress/health-number?from=dashboard" : "/app/progress/health-number", { scroll: false });
    } catch (reason) {
      toast.flash(reason instanceof Error && reason.message ? reason.message : "Your Health Number could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (!ready) return;
    if (step < total - 1) setStep(step + 1);
    else void finish();
  }

  const latest = data?.latest ?? null;
  const history = data?.history ?? [];
  const note = trendNote(history);

  const isSelected = (value: string) => (Array.isArray(answer) ? answer.includes(value) : answer === value);
  const options = question.type === "yesno"
    ? RETAKE_YES_NO
    : "options" in question ? question.options.map((option) => ({ label: option, value: option })) : [];

  return (
    <div className="view-quiz-health">
      {/* Step state */}
      <section className="wizard-step-wrap" id="wizardStepWrap" hidden={mode !== "wizard"}>
        <header className="wizard-topbar fade-in">
          <button className="quiz-back" id="healthQuizBack" type="button" aria-label="Back" onClick={() => router.push(backHref)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10,3 5,8 10,13" /></svg>
          </button>
          <div className="wizard-progress-track">
            <div className="wizard-progress-fill" id="wizardProgressFill" style={{ width: `${((step + 1) / total) * 100}%` }}></div>
          </div>
          <span className="wizard-progress-label" id="wizardProgressLabel">{`${step + 1}/${total}`}</span>
        </header>

        <div className="wizard-step">
          <h2 className="wizard-question" id="wizardQuestion">{question.title}</h2>
          <div className="wizard-options" id="wizardOptions">
            {question.type === "numeric" ? (
              <input ref={numericInput} className="wizard-numeric-input" id="wizardNumericInput" type="text" inputMode="decimal"
                placeholder={question.placeholder} aria-label={question.title}
                value={typeof answer === "string" ? answer : ""} onChange={(event) => setAnswer(event.target.value.trim())} />
            ) : options.map((option) => (
              <OptionWithWriteIn key={option.value} label={option.label} value={option.value} selected={isSelected(option.value)}
                multi={question.type === "multi"} onChoose={choose}
                writeIn={"otherWriteIn" in question && option.value === "Other" ? question.otherWriteIn : null}
                written={other[step]} onWrite={setWritten} />
            ))}
          </div>
          <div className="wizard-controls">
            <button className="btn-ghost wizard-prev" id="wizardPrev" type="button" disabled={step === 0}
              onClick={() => { if (step > 0) setStep(step - 1); }}>Previous</button>
            <button className="btn-primary wizard-next" id="wizardNext" type="button" disabled={!ready || busy} onClick={next}>
              {step === total - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </section>

      {/* Results state */}
      <section className="wizard-result-wrap" id="wizardResultWrap" hidden={mode !== "result"}>
        <div className="wizard-result-card fade-in d1">
          <div className="result-head">
            <span className="result-eyebrow">Your Veye Health Number</span>
            <div className="health-number-display">
              <strong id="healthNumberValue">{latest ? displayHealthNumber(latest.displayed_score) : "—"}</strong>
              <small>/ 10</small>
            </div>
            <span className={`result-status${latest ? ` color-${latest.bucket}` : ""}`} id="healthResultStatus" role={loadError ? "alert" : undefined}>
              {latest ? latest.status : loadError || "—"}
            </span>
            <p className="result-desc" id="healthResultDesc">{latest ? latest.interpretation : ""}</p>
          </div>

          {/* Dated history: the number and its explanation for each date the
              quiz was taken (client, Dashboard edits 20 Aug 2026). */}
          <div className="hn-history" id="hnHistoryWrap" hidden={history.length === 0}>
            <div className="recs-head">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M5.5 1.5v3M10.5 1.5v3M2 7h12" /></svg>
              Your quiz history
            </div>
            <ol className="hn-history-list" id="hnHistoryList">
              {history.map((item) => (
                <li key={item.attempt_id} className="hn-history-item">
                  <div className="hn-history-top">
                    <span className="hn-history-date">{formatHistDate(item.completed_at)}</span>
                    <span className="hn-history-num">{displayHealthNumber(item.displayed_score)}<small> / 10</small></span>
                  </div>
                  {item.interpretation ? <p className="hn-history-desc">{item.interpretation}</p> : null}
                </li>
              ))}
            </ol>
          </div>
          {/* A fixed comparison of the saved numbers, said as such — not AI. */}
          <div className="hn-trend" id="hnTrendWrap" hidden={history.length === 0}>
            <p className="hn-trend-note" id="hnTrendNote">{note}</p>
            <p className="hn-trend-tag">Based on your saved results, not a live AI service.</p>
          </div>
          <div className="result-actions">
            <button className="btn-primary" id="healthRetake" type="button" onClick={start}>Re-take quiz</button>
            <button className="btn-ghost" id="healthResultBack" type="button" onClick={() => router.push("/app/progress")}>Back to Progress</button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* A tick box is drawn only where more than one answer may be chosen; a
   single-choice answer is a plain button (owner, 15 Nov 2026 — the prototype
   carries the same `wizard-option--multi` rule). */
function OptionWithWriteIn({ label, value, selected, multi, onChoose, writeIn, written, onWrite }: {
  label: string; value: string; selected: boolean; multi: boolean; onChoose: (value: string) => void;
  writeIn: string | null; written: string; onWrite: (value: string) => void;
}) {
  return (
    <>
      <button className={`wizard-option${multi ? " wizard-option--multi" : ""}${selected ? " selected" : ""}`} data-value={value}
        type="button" aria-pressed={selected} onClick={() => onChoose(value)}>{label}</button>
      {/* XLSX "Other write in": optional words; the score stays with "Other". */}
      {writeIn !== null ? (
        <input className="wizard-other-input" id="wizardOtherInput" type="text" placeholder={writeIn} aria-label={writeIn}
          value={written} hidden={!selected} onChange={(event) => onWrite(event.target.value)} />
      ) : null}
    </>
  );
}

export default function HealthNumberPage() {
  return (
    <Suspense fallback={null}>
      <HealthNumberView />
    </Suspense>
  );
}
