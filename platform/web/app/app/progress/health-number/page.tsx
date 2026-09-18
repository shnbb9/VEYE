"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getHealthNumberHistory, type HealthNumberHistory } from "@/lib/api";
import { displayHealthNumber, formatHistDate } from "@/lib/member-format";
import { BackChevron } from "@/components/member/nav-icons";

/* Dated Health Number history (client, Dashboard edits 20 Aug 2026): the
   prototype shows it under the retake result; the application gives it its
   own screen under My Progress. Records are the stored API results — a
   historical number is never re-scored. */

export default function HealthNumberHistoryPage() {
  const [data, setData] = useState<HealthNumberHistory | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getHealthNumberHistory().then(setData).catch((reason: Error) => setError(reason.message));
  }, []);

  const latest = data?.latest ?? null;
  const history = data?.history ?? [];
  const numbers = history.slice().reverse().map((item) => item.displayed_score);   // chronological for the trend
  let note = "";
  if (numbers.length === 1) note = "This is your first recorded result. Retake the quiz over time and your trend will appear here.";
  else if (numbers.length > 1) {
    const current = numbers[numbers.length - 1], previous = numbers[numbers.length - 2];
    if (current < previous) note = `You are improving — congratulations. Your number moved from ${displayHealthNumber(previous)} to ${displayHealthNumber(current)}, and lower is better on this scale.`;
    else if (current === previous) note = `Holding steady at ${displayHealthNumber(current)} — that is good. Lower is better on this scale.`;
    else note = `Your number moved up from ${displayHealthNumber(previous)} to ${displayHealthNumber(current)}. Lower is better on this scale — the areas highlighted above are the place to start.`;
  }

  return (
    <div className="view-quiz-health hn-history-page">
      <header className="quiz-topbar fade-in">
        <Link className="quiz-back" href="/app/progress"><BackChevron /> Back to My Progress</Link>
      </header>

      <section className="wizard-result-wrap">
        <div className="wizard-result-card fade-in d1">
          <div className="result-head">
            <span className="result-eyebrow">Your Veye Health Number</span>
            <div className="health-number-display">
              <strong>{latest ? displayHealthNumber(latest.displayed_score) : "—"}</strong>
              <small>/ 10</small>
            </div>
            <span className={`result-status${latest ? ` color-${latest.bucket}` : ""}`} role={error ? "alert" : undefined}>
              {latest ? latest.status : error ? error : data ? "Not taken yet" : "Loading…"}
            </span>
            <p className="result-desc">{latest ? latest.interpretation : data && !latest ? "Take the Health Number assessment to see your result and what it means." : ""}</p>
          </div>

          {history.length > 0 && (
            <div className="hn-history">
              <div className="recs-head">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5.5 1.5v3M10.5 1.5v3M2 7h12"/></svg>
                Your quiz history
              </div>
              <ol className="hn-history-list">
                {history.map((item) => (
                  <li key={item.attempt_id} className="hn-history-item">
                    <div className="hn-history-top">
                      <span className="hn-history-date">{formatHistDate(item.completed_at)}</span>
                      <span className="hn-history-num">{displayHealthNumber(item.displayed_score)}<small> / 10</small></span>
                    </div>
                    <p className="hn-history-desc">{item.interpretation}</p>
                    <p className="hn-history-desc" style={{ opacity: .75 }}>Calculation version {item.calculation_version}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {note && (
            <div className="hn-trend">
              <p className="hn-trend-note">{note}</p>
              <p className="hn-trend-tag">Based on your saved results, not a live AI service.</p>
            </div>
          )}

          <div className="result-actions">
            <Link className="btn-primary" href="/onboarding">{latest ? "Re-take quiz" : "Take the quiz"}</Link>
            <Link className="btn-ghost" href="/app/progress">Back to Progress</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
