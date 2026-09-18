"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  calculateBodyComposition,
  getBodyCompositionHistory,
  type BodyCompositionHistory,
  type BodyCompositionHistoryItem,
  type BodyCompositionInput,
} from "@/lib/api";
import { formatUpd, prefersReducedMotion } from "@/lib/member-format";
import { BackChevron } from "@/components/member/nav-icons";

/* BMI Analysis / Body Composition (build/dashboard.html, #view-bmi): the
   Woman / Man toggle, four stepper measurements around the approved figure,
   and the result card with the composition pie, the dated body-fat trend and
   the mass rows. The calculation is the API's exact client-table lookup; no
   body-fat value is ever estimated here. */

type Sex = "female" | "male";
type Values = { weight: string; height: string; waist: string; fourth: string };

const DEFAULTS: Values = { weight: "145", height: "64", waist: "30", fourth: "36.5" };

const COPY = {
  weight: "Weigh yourself without shoes. Round to the nearest five pounds (e.g., 120 or 145).",
  height: "Stand without shoes, heels 3-4 inches apart. Use half-inch increments (e.g., 62.5 or 64.0).",
  waistFemale: "Measure at your belly button and around your body keeping the tape level. Keep the tape snug but not tight. Use half-inch increments (e.g., 26.5 or 30.0).",
  waistMale: "Measure at belly button level, around your natural waist. Keep the tape snug but not tight. Use half-inch increments (e.g., 26.5 or 30.0).",
  hips: "Measure around your body at the widest part of your hips and buttocks. Keep the tape level. Use half-inch increments (e.g., 36.5).",
  wrist: "Measure your dominant hand above the wrist bone where your wrist bends. Use half-inch increments (e.g., 7.0 or 7.5).",
};

// Factual description only — the client body-fat documents supply no clinical
// interpretation bands, so none are invented here.
const COMMENTARY = "Your body-fat percentage comes from the Veye body-fat tables. Fat mass is your weight multiplied by that percentage, and lean body mass is the total weight of all non-fat body tissue.";

function stepValue(value: string, step: number, direction: 1 | -1): string {
  const next = (parseFloat(value) || 0) + direction * step;
  return next.toFixed(step >= 1 ? 0 : 1);
}

export default function BodyCompositionPage() {
  const [sex, setSex] = useState<Sex>("female");
  const [values, setValues] = useState<Values>(DEFAULTS);
  const [history, setHistory] = useState<BodyCompositionHistory | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getBodyCompositionHistory().then((data) => {
      setHistory(data);
      // Restore the last saved measurements so the member edits rather than
      // re-enters them (the prototype does the same from its saved record).
      const last = data.latest?.measurements;
      if (last) {
        const lastSex: Sex = data.latest?.sex === "Man" ? "male" : "female";
        setSex(lastSex);
        setValues({
          weight: String(last.weight ?? DEFAULTS.weight),
          height: String(last.height ?? DEFAULTS.height),
          waist: String((lastSex === "female" ? last.abdomen : last.waist) ?? DEFAULTS.waist),
          fourth: String((lastSex === "female" ? last.hips : last.wrist) ?? (lastSex === "female" ? "36.5" : "7")),
        });
      }
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  function chooseSex(next: Sex) {
    setSex(next);
    // image shows both tape points; only the fourth input changes meaning
    setValues((current) => {
      const fourth = parseFloat(current.fourth);
      if (next === "female" && fourth < 20) return { ...current, fourth: "36.5" };
      if (next === "male" && fourth > 15) return { ...current, fourth: "7" };
      return current;
    });
  }

  async function save() {
    setError("");
    const weight = parseFloat(values.weight), height = parseFloat(values.height);
    const waist = parseFloat(values.waist), fourth = parseFloat(values.fourth);
    if (!weight || !waist || !fourth || !height) { setError("Please fill in all four measurements."); return; }
    const input: BodyCompositionInput = sex === "female"
      ? { sex: "Woman", weight, height, abdomen: waist, hips: fourth }
      : { sex: "Man", weight, height, waist, wrist: fourth };
    setSaving(true);
    try {
      const saved = await calculateBodyComposition(input);
      setHistory((current) => ({ member_id: saved.member_id, latest: saved, history: [saved, ...(current?.history ?? [])] }));
      setShowResult(true);
      window.scrollTo(0, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not save this measurement.");
    } finally {
      setSaving(false);
    }
  }

  const latest = history?.latest ?? null;

  return (
    <div className="view-bmi">
      <header className="quiz-topbar fade-in">
        <Link className="quiz-back" href="/app/progress"><BackChevron /> Back to My Progress</Link>
      </header>

      {!showResult && (
        <section className="bmi-wrap fade-in d1">
          <h2 className="bmi-title">Choose the biology that best describes you</h2>
          <div className="bmi-toggle" role="group" aria-label="Biology">
            <button className={`bmi-toggle-btn${sex === "female" ? " active" : ""}`} type="button" aria-pressed={sex === "female"} onClick={() => chooseSex("female")}>Woman</button>
            <button className={`bmi-toggle-btn${sex === "male" ? " active" : ""}`} type="button" aria-pressed={sex === "male"} onClick={() => chooseSex("male")}>Man</button>
          </div>

          <div className="bmi-stage">
            <div className="bmi-col bmi-col-left">
              <Field id="bmi_weight" label="Weight" hint={COPY.weight} step={5} value={values.weight} onChange={(weight) => setValues({ ...values, weight })} />
              <Field id="bmi_waist" label="Waist" hint={sex === "female" ? COPY.waistFemale : COPY.waistMale} step={0.5} value={values.waist} onChange={(waist) => setValues({ ...values, waist })} />
            </div>

            {/* ILLUSTRATION NOTE (client, 20 Aug 2026): the female figure needs
                its own artwork; until that asset arrives the approved figure is
                shown for both and the written instructions are authoritative. */}
            <div className="bmi-silhouette">
              <img src="/assets/web/img/bmi-figure-tapes.png" alt="Body biology figure showing the measuring-tape positions" className="bmi-figure-img" />
            </div>

            <div className="bmi-col bmi-col-right">
              <Field id="bmi_height" label="Height" hint={COPY.height} step={0.5} value={values.height} onChange={(height) => setValues({ ...values, height })} />
              <Field id="bmi_fourth" label={sex === "female" ? "Hips" : "Wrist"} hint={sex === "female" ? COPY.hips : COPY.wrist} step={0.5} value={values.fourth} onChange={(fourth) => setValues({ ...values, fourth })} />
            </div>
          </div>

          {error && <p className="fdx-err" role="alert">{error}</p>}
          <button className="btn-primary bmi-save" type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Measurements"}</button>
          {latest && !showResult && (
            <p className="bmi-trend-note" style={{ marginTop: 14 }}>
              Last saved {formatUpd(latest.completed_at)}. <button type="button" className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => setShowResult(true)}>View results</button>
            </p>
          )}
        </section>
      )}

      {showResult && latest && (
        <ResultCard latest={latest} history={history?.history ?? []} sex={latest.sex === "Man" ? "male" : "female"} onEdit={() => setShowResult(false)} />
      )}
    </div>
  );
}

function Field({ id, label, hint, step, value, onChange }: { id: string; label: string; hint: string; step: number; value: string; onChange: (value: string) => void }) {
  return (
    <div className="bmi-field">
      <label htmlFor={id}>{label} <small>{hint}</small></label>
      <div className="bmi-stepper">
        <button className="step-dec" type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(stepValue(value, step, -1))}>−</button>
        <input type="number" step={step} id={id} value={value} inputMode="decimal" onChange={(event) => onChange(event.target.value)} />
        <button className="step-inc" type="button" aria-label={`Increase ${label}`} onClick={() => onChange(stepValue(value, step, 1))}>+</button>
      </div>
    </div>
  );
}

function ResultCard({ latest, history, sex, onEdit }: { latest: BodyCompositionHistoryItem; history: BodyCompositionHistoryItem[]; sex: Sex; onEdit: () => void }) {
  const available = latest.body_fat_available && typeof latest.body_fat_percent === "number";
  const bf = available ? (latest.body_fat_percent as number) : null;
  const lean = bf === null ? null : 100 - bf;
  const weight = latest.measurements?.weight ?? null;
  const C = 2 * Math.PI * 46;
  const [arc, setArc] = useState(0);
  useEffect(() => {
    // Two-segment pie: body fat (orange) over lean mass (green), drawn in on entry.
    const target = bf === null ? 0 : C * bf / 100;
    if (prefersReducedMotion()) { setArc(target); return; }
    setArc(0);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setArc(target)));
    return () => cancelAnimationFrame(frame);
  }, [bf, C]);

  return (
    <section className="bmi-result-wrap fade-in d1">
      <div className="quiz-result-card">
        <div className="result-head">
          <span className="result-eyebrow">{sex === "female" ? "Woman · " : "Man · "}Body Composition</span>
          <h2 style={{ marginBottom: 18 }}>{available ? "Your Results" : "Body fat percentage unavailable"}</h2>
          <div className="bmi-result-pair">
            <div className="bmi-pie">
              <svg viewBox="0 0 120 120" role="img" aria-label={available ? `Pie chart: body fat ${bf} percent, lean mass ${lean} percent.` : "No body-fat result to chart"}>
                <circle cx="60" cy="60" r="46" fill="none" stroke="#7DBE5F" strokeWidth="24"/>
                <circle cx="60" cy="60" r="46" fill="none" stroke="#E89A4A" strokeWidth="24" strokeDasharray={`${arc.toFixed(2)} ${C.toFixed(2)}`} transform="rotate(-90 60 60)" style={{ transition: prefersReducedMotion() ? "none" : "stroke-dasharray .8s cubic-bezier(0.2, 0.8, 0.2, 1)" }}/>
              </svg>
              <div className="bmi-pie-center">
                <strong>{available ? `${bf}%` : "—"}</strong>
                <small>Body Fat</small>
              </div>
            </div>
            <Trend history={history} />
          </div>
          <div className="bmi-result-meta bmi-result-meta--row">
            <div className="bmi-meta-row"><span className="dot" style={{ background: "#E89A4A" }} /> Body fat: <strong>{available ? `${bf}%` : "—"}</strong></div>
            <div className="bmi-meta-row"><span className="dot" style={{ background: "#7DBE5F" }} /> Lean mass: <strong>{available ? `${lean}%` : "—"}</strong></div>
            {/* WEIGHT stays: standard BMI, the male table, fat mass and lean mass all require it. */}
            <div className="bmi-meta-row"><span>Weight</span><strong>{weight !== null ? `${weight} lbs` : "—"}</strong></div>
            <div className="bmi-meta-row"><span>Lean body mass</span><strong>{latest.lean_mass_lb !== null ? `${latest.lean_mass_lb} lbs` : "— lbs"}</strong></div>
            <div className="bmi-meta-row"><span>Fat mass</span><strong>{latest.fat_mass_lb !== null ? `${latest.fat_mass_lb} lbs` : "— lbs"}</strong></div>
            {/* Standard weight/height index, reported separately: NOT part of the body-fat lookup. */}
            <div className="bmi-meta-row"><span>BMI (weight/height)</span><strong>{latest.bmi !== null ? latest.bmi : "—"}</strong></div>
          </div>
          <p className="result-desc">
            {available
              ? COMMENTARY
              : `Your measurements were saved, but they fall ${latest.unavailable_reason ?? "outside the Veye body-fat table"}, so no body-fat percentage is reported. The table covers weight 120-300 lb and waist minus wrist 22-50 in for men, and the printed ranges for women.`}
          </p>
          <p className="bmi-trend-note">Saved {formatUpd(latest.completed_at)} · calculation version {latest.calculation_version}</p>
        </div>
        {/* No sourced Body Fat % -> dose table exists, so the prototype hides its
            supplement block; it is not rendered here either. */}
        <div className="result-actions">
          <button className="btn-ghost" type="button" onClick={onEdit}>Edit measurements</button>
          <Link className="btn-primary" href="/app/progress">Back to Progress</Link>
        </div>
      </div>
    </section>
  );
}

/** Dated body-fat % line graph with a progress arrow (client, 20 Aug 2026). */
function Trend({ history }: { history: BodyCompositionHistoryItem[] }) {
  const hist = useMemo(() => history.filter((item) => item.body_fat_available && typeof item.body_fat_percent === "number").slice().reverse().slice(-8), [history]);
  const W = 260, H = 120, padL = 30, padR = 26, padT = 12, padB = 10;
  const vals = hist.map((item) => item.body_fat_percent as number);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2; }
  const x = (i: number) => hist.length === 1 ? (padL + (W - padL - padR) / 2) : padL + i * (W - padL - padR) / (hist.length - 1);
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  let arrow: React.ReactNode = null;
  if (hist.length >= 2) {
    const lastX = x(vals.length - 1), lastY = y(vals[vals.length - 1]);
    const last = vals[vals.length - 1], prev = vals[vals.length - 2];
    const dy = last === prev ? 0 : (last > prev ? -7 : 7);
    const ax = Math.min(W - 6, lastX + 16);
    const ay = lastY - dy;
    arrow = <>
      <line x1={lastX} y1={lastY} x2={ax} y2={ay} stroke="#E89A4A" strokeWidth="2.2" strokeLinecap="round"/>
      <path d={`M${ax} ${ay} l-6 ${dy === 0 ? "-3" : (dy > 0 ? "1.5" : "-1.5")} l1.5 ${dy === 0 ? "3" : (dy > 0 ? "-5" : "5")} z`} fill="#E89A4A"/>
    </>;
  }
  let note = "";
  if (hist.length >= 2) {
    const d = vals[vals.length - 1] - vals[vals.length - 2];
    note = d === 0 ? "Body fat is unchanged since your previous measurement."
      : d < 0 ? `Body fat is down ${Math.abs(d)}% since your previous measurement.` : `Body fat is up ${d}% since your previous measurement.`;
  } else if (hist.length === 1) {
    note = "Your first measurement is recorded — the trend builds as you re-measure.";
  }
  const label = hist.length
    ? `Line graph of body fat percentage by date: ${hist.map((item) => `${formatUpd(item.completed_at)} ${item.body_fat_percent} percent`).join(", ")}.`
    : "No body-fat measurements recorded yet.";
  return (
    <div className="bmi-trend">
      <div className="bmi-trend-head">Body fat % over time</div>
      <svg className="bmi-trend-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {hist.length > 0 && <>
          <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="rgba(46,74,26,0.15)"/>
          <text x="4" y={padT + 5} fontSize="9" fill="#7C8A63">{Math.round(hi)}%</text>
          <text x="4" y={H - padB} fontSize="9" fill="#7C8A63">{Math.round(lo)}%</text>
          <polyline points={pts} fill="none" stroke="#4A6B2A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          {vals.map((v, i) => <circle key={i} cx={x(i).toFixed(1)} cy={y(v).toFixed(1)} r="3.4" fill="#4A6B2A"/>)}
          {arrow}
        </>}
      </svg>
      <div className="bmi-trend-dates">{hist.map((item) => <span key={item.attempt_id}>{formatUpd(item.completed_at)}</span>)}</div>
      <p className="bmi-trend-note">{note}</p>
    </div>
  );
}
