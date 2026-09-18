"use client";

import Link from "next/link";
import { PROGRESS_GUIDE_FLOW } from "@/lib/guided-flows-api";
import { useEffect, useState } from "react";
import {
  getBloodMarkersHistory,
  getBodyCompositionHistory,
  getHealthNumberHistory,
  type BloodMarkersHistory,
  type BodyCompositionHistory,
  type HealthNumberHistory,
} from "@/lib/api";
import { displayHealthNumber, formatUpd } from "@/lib/member-format";
import { ArrowCircle } from "@/components/member/nav-icons";

/* The approved My Progress overview (build/dashboard.html, #view-progress):
   four module cards — Blood Test Markers, BMI Analysis, Health Assessment,
   Simple Quiz — plus the reduced Health Number card. Health Number, Body
   Composition and Blood Test Markers read the persisted API results; Health
   Assessment and Simple Quiz have no production slice yet and stay honestly
   "Not started" until they do. */

type Loaded<T> = { data: T | null; error: string };

export default function ProgressPage() {
  const [health, setHealth] = useState<Loaded<HealthNumberHistory>>({ data: null, error: "" });
  const [body, setBody] = useState<Loaded<BodyCompositionHistory>>({ data: null, error: "" });
  const [blood, setBlood] = useState<Loaded<BloodMarkersHistory>>({ data: null, error: "" });

  useEffect(() => {
    getHealthNumberHistory().then((data) => setHealth({ data, error: "" })).catch((reason: Error) => setHealth({ data: null, error: reason.message }));
    getBodyCompositionHistory().then((data) => setBody({ data, error: "" })).catch((reason: Error) => setBody({ data: null, error: reason.message }));
    getBloodMarkersHistory().then((data) => setBlood({ data, error: "" })).catch((reason: Error) => setBlood({ data: null, error: reason.message }));
  }, []);

  const bloodUpdated = blood.data?.latest?.completed_at;
  const bodyUpdated = body.data?.latest?.completed_at;

  return (
    // The prototype pulls My Progress up 20px by id (#view-progress); keep the id so that rule applies.
    <div className="view-progress" id="view-progress">
      <header className="progress-hero fade-in">
        <div>
          <span className="mood-eyebrow">Your Journey</span>
          <h1>My Progress</h1>
          <p>Track your health across five modules. Re-take any time to see how far you&apos;ve come.</p>
          <Link className="tracker-card__link" href={`/app/companion?flow=${PROGRESS_GUIDE_FLOW}`}>Let Sprout guide you through the trackers</Link>
        </div>
      </header>

      <div className="progress-modules">
        <ProgressModule
          title="Blood Test Markers"
          desc="Enter the blood test results you have, whether all of them or only one or two."
          updated={bloodUpdated}
          error={blood.error}
          href="/app/progress/blood-markers"
          viz={<div className="viz-bars"><span style={{ "--p": "22px" } as React.CSSProperties} /><span style={{ "--p": "42px" } as React.CSSProperties} /><span style={{ "--p": "122px" } as React.CSSProperties} /></div>}
        />
        <ProgressModule
          title="BMI Analysis"
          desc="Veye prefers measuring progress with your individual BMI, rather than weight alone."
          updated={bodyUpdated}
          error={body.error}
          href="/app/progress/body-composition"
          viz={<BodyCompositionViz history={body.data} />}
        />
        <ProgressModule
          title="Health Assessment"
          desc="The Veye health assessment provides a comprehensive overview of your current health condition without testing."
          href="/app/progress/health-assessment"
          viz={<AssessmentViz />}
        />
        <ProgressModule
          title="Simple Quiz"
          desc="Hate tests of any kind, and still want to know if you are making progress? This simple quiz will help you track your progress using only 8 yes or no questions."
          href="/app/progress/simple-quiz"
        />
        <HealthNumberCard state={health} />
      </div>
    </div>
  );
}

function ProgressModule({ title, desc, updated, error, href, viz }: {
  title: string; desc: string; updated?: string; error?: string; href: string; viz?: React.ReactNode;
}) {
  return (
    <div className="progress-module">
      {/* "UPD: 06/24/24" used to show for every module, saved or not. That was a
          Figma sample date; an unsaved module reads "Not started". */}
      <span className={`module-upd${updated ? "" : " module-upd--none"}`}>{updated ? `UPD: ${formatUpd(updated)}` : "Not started"}</span>
      <div className="module-title">{title}</div>
      <div className="module-desc">{desc}</div>
      {error && <p className="module-desc" role="alert" style={{ color: "#C0492F" }}>{error}</p>}
      {viz}
      <Link className="module-cta" href={href}>
        ENTER/EDIT <ArrowCircle />
      </Link>
    </div>
  );
}

/** Client progress review (25 Aug 2026): composition pie on the left, dated
 *  body-fat trend on the right. Nothing is invented when no measurement with
 *  a body-fat result has been saved. */
function BodyCompositionViz({ history }: { history: BodyCompositionHistory | null }) {
  const rows = (history?.history ?? [])
    .filter((item) => item.body_fat_available && typeof item.body_fat_percent === "number")
    .slice()
    .reverse()          // the API lists newest first; the trend reads oldest → newest
    .slice(-6);
  const latest = rows[rows.length - 1];
  if (!latest) {
    return (
      <div className="bmi-card-viz">
        <div className="bmi-card-pie-wrap"><div className="bmi-card-pie is-empty"><span className="bmi-card-pie-value">—</span></div><div className="bmi-card-legend">Body composition</div></div>
        <div className="bmi-card-trend"><strong>Body fat % over time</strong><svg viewBox="0 0 130 62" role="img" aria-label="No body-fat trend recorded"><line x1="8" y1="51" x2="124" y2="51" stroke="#DDE5D1"/><line x1="8" y1="10" x2="8" y2="51" stroke="#DDE5D1"/></svg><small>Add a measurement to begin your trend.</small></div>
      </div>
    );
  }
  const bf = latest.body_fat_percent as number;
  const lean = 100 - bf;
  const vals = rows.map((item) => item.body_fat_percent as number);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2; }
  const x = (i: number) => vals.length === 1 ? 65 : 10 + i * 112 / (vals.length - 1);
  const y = (v: number) => 8 + 40 * (1 - (v - lo) / (hi - lo));
  const points = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const direction = vals.length < 2 ? "First measurement saved."
    : vals[vals.length - 1] < vals[vals.length - 2] ? "Body fat is trending down."
    : vals[vals.length - 1] > vals[vals.length - 2] ? "Body fat is trending up." : "Body fat is unchanged.";
  const dateRange = rows.length > 1 ? `${formatUpd(rows[0].completed_at)}–${formatUpd(rows[rows.length - 1].completed_at)}` : formatUpd(latest.completed_at);
  return (
    <div className="bmi-card-viz">
      <div className="bmi-card-pie-wrap">
        <div className="bmi-card-pie" style={{ "--bf": `${bf}%` } as React.CSSProperties}><span className="bmi-card-pie-value">{bf}%</span></div>
        <div className="bmi-card-legend"><b>{bf}%</b> fat · <b>{lean}%</b> lean</div>
      </div>
      <div className="bmi-card-trend">
        <strong>Body fat % over time</strong>
        <svg viewBox="0 0 130 62" role="img" aria-label="Body-fat percentage over time">
          <line x1="8" y1="51" x2="124" y2="51" stroke="#DDE5D1"/><line x1="8" y1="7" x2="8" y2="51" stroke="#DDE5D1"/>
          <polyline points={points} fill="none" stroke="#446514" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          {vals.map((v, i) => <circle key={i} cx={x(i).toFixed(1)} cy={y(v).toFixed(1)} r="3" fill="#E89A4A"/>)}
        </svg>
        <small>{dateRange} · {direction}</small>
      </div>
    </div>
  );
}

/** Health Assessment has no production slice yet, so only its honest empty
 *  state (the prototype's own) is rendered. */
function AssessmentViz() {
  return (
    <div className="assess-card-viz">
      <div className="assess-card-bars" aria-hidden="true"><i style={{ height: "18%" }} /><i style={{ height: "18%" }} /><i style={{ height: "18%" }} /></div>
      <div className="assess-card-latest"><strong>—</strong><span>No result yet</span></div>
      <p className="assess-card-caption">Complete the assessment to begin your dated progress report.</p>
    </div>
  );
}

/** Reduced Health Number card (client, Functional Edits 260821): number,
 *  status, last updated, History and Retake. The full explanation lives on the
 *  Dashboard. */
function HealthNumberCard({ state }: { state: Loaded<HealthNumberHistory> }) {
  const latest = state.data?.latest ?? null;
  const taken = latest !== null;
  const bucket = taken ? latest.bucket : "none";
  const chip = taken ? `UPD: ${formatUpd(latest.completed_at)}` : state.error ? "Unavailable" : state.data ? "Not taken" : "Loading";
  return (
    <aside className={`hn-card hn-card--${bucket}`}>
      <span className={`module-upd${taken ? "" : " module-upd--none"}`}>{chip}</span>
      <h3 className="hn-card__label">Your Health Number</h3>
      <div className="hn-card__row">
        <span className="hn-card__num">{taken ? displayHealthNumber(latest.displayed_score) : "—"}</span>
        <span className="hn-card__status">{taken ? latest.status : state.error ? "Could not load" : "Not taken yet"}</span>
      </div>
      {!taken && <p className="hn-card__desc" role={state.error ? "alert" : undefined}>{state.error || "Take the Health Number assessment to see your result and what it means."}</p>}
      <div className="hn-card__actions">
        {taken && <Link className="module-cta module-cta--ghost" href="/app/progress/health-number">History</Link>}
        <Link className="module-cta" href="/onboarding">{taken ? "Retake" : "Take the quiz"} <ArrowCircle /></Link>
      </div>
    </aside>
  );
}
