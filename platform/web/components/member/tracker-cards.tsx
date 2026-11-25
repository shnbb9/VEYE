"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  getProgressScales, type BloodCalculationKey, type BloodMarkersHistory, type BodyCompositionHistory, type HealthAssessmentHistory,
  type HealthNumberHistory, type ProgressScales, type Scale, type SimpleQuizHistory,
} from "@/lib/api";
import { CardsSkeleton } from "@/components/skeleton";
import { displayHealthNumber } from "@/lib/member-format";

/* Progress Trackers (concept A, chosen by the owner 25 Nov 2026): each of the
   five instruments on its own true scale, with the client's bands, the latest
   result and what changed. Nothing shares an axis, nothing is smoothed between
   tests, the time axis is real days, and every value is printed — colour and
   hover never carry anything alone. Bands and goals come from the API, where
   the calculations live; an instrument without a client band draws none.

   A tracker with no result rests, as Cara's decision tree asks. */

type Pt = { at: number; value: number; label: string };
const DAY = 86_400_000;

function short(at: number, year = false): string {
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
}

/** Dates that tell two results of one day apart. */
function stamp(points: Pt[], index: number): string {
  const day = (at: number) => new Date(at).toDateString();
  const sameDay = points.some((p, i) => i !== index && day(p.at) === day(points[index].at));
  return sameDay ? `${short(points[index].at)} ${new Date(points[index].at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : short(points[index].at);
}

function byDate<T>(rows: T[] | undefined, read: (row: T) => Pt | null): Pt[] {
  return (rows ?? []).map(read).filter((p): p is Pt => p !== null && Number.isFinite(p.at) && Number.isFinite(p.value)).sort((a, b) => a.at - b.at);
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(420);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const TINT: Record<string, string> = {
  good: "#D9E9CC", relative: "#E9F1DB", moderate: "#F7EBCB", high: "#F5DFD7",
  verylow: "#D9E9CC", low: "#E9F1DB", significant: "#F1D3C8", poor: "#EAC2B4",
};

/* One line on its own scale. Points are the only data; straight segments join
   them so the order is readable. */
function LineChart({ points, low, high, color, bands, unit, describe }: {
  points: Pt[]; low: number; high: number; color: string; bands?: Scale; unit?: string; describe: string;
}) {
  const [ref, W] = useWidth();
  const H = 200, L = 34, R = 14, T = 24, B = 30;
  const first = points[0].at, last = points[points.length - 1].at;
  const x = (at: number) => last === first ? (L + W - R) / 2 : L + 12 + ((at - first) / (last - first)) * (W - L - R - 24);
  const y = (v: number) => H - B - ((v - low) / (high - low || 1)) * (H - T - B);
  const ticks = last === first ? [first] : last - first < 2 * DAY || W < 360 ? [first, last] : [first, first + (last - first) / 2, last];
  return (
    <div ref={ref} className="tracker-plot">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={describe}>
        {bands?.bands.map((band, index) => {
          // A band runs from halfway after the one below it to halfway before
          // the one above, so the scale's own steps sit inside their band.
          const below = index ? bands.bands[index - 1].upto : low;
          const from = index ? below + bands.step / 2 : low;
          const to = band.upto >= high ? high : band.upto + bands.step / 2;
          const top = y(to), height = y(from) - top;
          return <rect key={band.label} x={L} y={top} width={W - L - R} height={Math.max(0, height)} fill={TINT[band.bucket] ?? "#EEF2E6"} />;
        })}
        {[low, high].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="tracker-plot__rule" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="tracker-plot__tick">{v}{unit ?? ""}</text></g>)}
        {points.length > 1 && <polyline points={points.map((p) => `${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" />}
        {points.map((p, i) => {
          const end = i === points.length - 1;
          const anchor = points.length > 1 && i === 0 ? "start" : end && points.length > 1 ? "end" : "middle";
          // Every value is printed while there is room; with many results the
          // first, the latest and the table carry them.
          const show = points.length <= Math.floor((W - L - R) / 46) || i === 0 || end;
          return (
            <g key={p.at + i}>
              <circle cx={x(p.at)} cy={y(p.value)} r={end ? 7 : 5} fill={end ? color : "#FFFCF4"} stroke={color} strokeWidth={2.4} />
              {show && <text x={x(p.at)} y={y(p.value) - 12 < 12 ? y(p.value) + 22 : y(p.value) - 12} textAnchor={anchor} className="tracker-plot__value">{p.label}</text>}
            </g>
          );
        })}
        {ticks.map((at, i) => <text key={i} x={x(at)} y={H - 8} textAnchor={ticks.length === 1 ? "middle" : i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"} className="tracker-plot__tick">{short(at, last - first > 300 * DAY)}</text>)}
      </svg>
      {bands && (
        <ul className="tracker-key">
          {bands.bands.map((band, i) => {
            const from = i ? bands.bands[i - 1].upto + bands.step : low;
            return <li key={band.label}><span style={{ background: TINT[band.bucket] ?? "#EEF2E6" }} aria-hidden="true" />{band.label} {from === band.upto ? band.upto : `${from}–${band.upto}`}</li>;
          })}
        </ul>
      )}
    </div>
  );
}

function BarChart({ points, high, color, describe }: { points: Pt[]; high: number; color: string; describe: string }) {
  const [ref, W] = useWidth();
  const shown = points.slice(-Math.max(2, Math.min(6, Math.floor(W / 74))));
  const H = 200, L = 26, T = 22, B = 30, step = (W - L) / shown.length, bar = Math.min(44, step * 0.55);
  const y = (v: number) => H - B - (v / high) * (H - T - B);
  return (
    <div ref={ref} className="tracker-plot">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={describe}>
        {[0, high].map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="tracker-plot__rule" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="tracker-plot__tick">{v}</text></g>)}
        {shown.map((p, i) => {
          const cx = L + step * (i + 0.5), end = i === shown.length - 1;
          return (
            <g key={p.at + i}>
              <rect x={cx - bar / 2} y={y(p.value)} width={bar} height={Math.max(1, y(0) - y(p.value))} rx={5} fill={end ? color : "#F3E2CC"} stroke={color} strokeWidth={1.6} />
              <text x={cx} y={y(p.value) - 6} textAnchor="middle" className="tracker-plot__value">{p.label}</text>
              <text x={cx} y={H - 8} textAnchor="middle" className="tracker-plot__tick">{short(p.at)}</text>
            </g>
          );
        })}
      </svg>
      {shown.length < points.length && <p className="tracker-note">The latest {shown.length} of {points.length}. The table lists them all.</p>}
    </div>
  );
}

type CardTable = { caption: string; heads: string[]; rows: string[][] };

function Card({ testid, name, color, headline, chip, change, children, href, action, rest, table }: {
  testid: string; name: string; color: string; headline?: ReactNode; chip?: string; change?: ReactNode; children?: ReactNode; href: string; action: string; rest?: boolean; table?: CardTable;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <article className={`tracker-card${rest ? " tracker-card--rest" : ""}`} data-testid={testid} style={{ borderTopColor: color }}>
      <h3 className="tracker-card__name">{name}</h3>
      {rest ? <p className="tracker-card__rest">At rest &mdash; no result yet.</p> : (
        <>
          <p className="tracker-card__headline">{headline}{chip && <span className="tracker-card__chip">{chip}</span>}</p>
          <p className="tracker-card__change">{change}</p>
          {children}
        </>
      )}
      <div className="tracker-card__foot">
        {table && <button type="button" className="tracker-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>{open ? "Hide table" : "Show table"}<span className="sr-only">: {table.caption}</span></button>}
        <Link className="tracker-btn tracker-btn--main" href={href}>{action}<span className="sr-only"> {name}</span></Link>
      </div>
      {table && (
        <div id={id} hidden={!open} className="tracker-table">
          <table><caption className="sr-only">{table.caption}</caption>
            <thead><tr>{table.heads.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => j === 0 ? <th scope="row" key={j}>{c}</th> : <td key={j}>{c}</td>)}</tr>)}</tbody></table>
        </div>
      )}
    </article>
  );
}

const MARKERS: { key: BloodCalculationKey; label: string; unit: string }[] = [
  { key: "tg_hdl", label: "TG / HDL", unit: "" }, { key: "aa_epa", label: "AA / EPA", unit: "" }, { key: "hba1c", label: "HbA1c", unit: " %" }, { key: "homa_ir", label: "HOMA-IR", unit: "" },
];

export function TrackerCards({ loading, health, body, blood, assessment, quiz }: {
  /** Nothing is known yet: not "no result". */
  loading: boolean;
  health: HealthNumberHistory | null; body: BodyCompositionHistory | null; blood: BloodMarkersHistory | null;
  assessment: HealthAssessmentHistory | null; quiz: SimpleQuizHistory | null;
}) {
  const [scales, setScales] = useState<ProgressScales | null>(null);
  useEffect(() => {
    let live = true;
    getProgressScales().then((next) => { if (live) setScales(next); }).catch(() => { /* the charts draw without bands */ });
    return () => { live = false; };
  }, []);

  if (loading) return <CardsSkeleton count={4} label="Loading your trackers…" />;
  const missing = [["Health Number", health], ["Health Assessment", assessment], ["Blood Markers", blood], ["Body Composition", body], ["Simple Quiz", quiz]]
    .filter(([, data]) => data === null).map(([name]) => name as string);

  return (
    <div className="tracker-cards" data-testid="tracker-cards">
      {missing.length > 0 && <p className="fdx-err tracker-cards__error" role="alert">{missing.join(", ")} could not be loaded. Reload to try again.</p>}
      {health && <HealthNumberCard data={health} scale={scales?.health_number} />}
      {assessment && <AssessmentCard data={assessment} scale={scales?.health_assessment} />}
      {blood && <BloodCard data={blood} scales={scales} />}
      {body && <BodyCard data={body} />}
      {quiz && <QuizCard data={quiz} />}
    </div>
  );
}

function change(points: Pt[], comparable: boolean, digits: number): ReactNode {
  const now = points[points.length - 1];
  if (points.length === 1) return <>First result, {short(now.at, true)}. <b>Lower is better.</b></>;
  const before = points[points.length - 2];
  if (!comparable) return <>Scored by a newer version than {stamp(points, points.length - 2)}, so the two are not compared. <b>Lower is better.</b></>;
  const delta = now.value - before.value;
  const by = Math.abs(delta).toFixed(digits);
  return <>{delta === 0 ? `No change since ${stamp(points, points.length - 2)}.` : `${delta < 0 ? "Down" : "Up"} ${by} since ${stamp(points, points.length - 2)}.`} <b>Lower is better.</b></>;
}

function HealthNumberCard({ data, scale }: { data: HealthNumberHistory | null; scale?: Scale }) {
  const rows = [...(data?.history ?? [])].sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at));
  const points = byDate(rows, (r) => ({ at: Date.parse(r.completed_at), value: Number(r.displayed_score), label: displayHealthNumber(r.displayed_score) }));
  const base = { testid: "tracker-health-number", name: "Health Number", color: "#2F5F9E", href: "/app/progress/health-number?start=1" };
  if (!points.length) return <Card {...base} rest action="Take the quiz" />;
  const now = rows[rows.length - 1], before = rows[rows.length - 2];
  return (
    <Card {...base} table={{ caption: "Health Number results", heads: ["Date", "Health Number", "Band"],
            rows: [...rows].reverse().map((r) => [short(Date.parse(r.completed_at), true), displayHealthNumber(r.displayed_score), r.status]) }}
          action="Retake" headline={displayHealthNumber(now.displayed_score)} chip={now.status}
          change={change(points, !before || before.calculation_version === now.calculation_version, 1)}>
      <LineChart points={points} low={scale?.low ?? 1} high={scale?.high ?? 10} color={base.color} bands={scale}
                 describe={`Health Number, ${points.map((p) => `${p.label} on ${short(p.at, true)}`).join(", ")}. Lower is better.`} />
    </Card>
  );
}

function AssessmentCard({ data, scale }: { data: HealthAssessmentHistory | null; scale?: Scale }) {
  const rows = [...(data?.history ?? [])].sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at));
  const points = byDate(rows, (r) => ({ at: Date.parse(r.completed_at), value: r.total, label: String(r.total) }));
  const base = { testid: "tracker-health-assessment", name: "Health Assessment", color: "#5B4A9C", href: "/app/progress/health-assessment" };
  if (!points.length) return <Card {...base} rest action="Take the assessment" />;
  const now = rows[rows.length - 1], before = rows[rows.length - 2];
  return (
    <Card {...base} table={{ caption: "Health Assessment results", heads: ["Date", "Score", "Band"],
            rows: [...rows].reverse().map((r) => [short(Date.parse(r.completed_at), true), String(r.total), r.status]) }}
          action="Retake" headline={<>{now.total} <small>of 33</small></>} chip={now.status}
          change={change(points, !before || before.calculation_version === now.calculation_version, 0)}>
      <LineChart points={points} low={scale?.low ?? 11} high={scale?.high ?? 33} color={base.color} bands={scale}
                 describe={`Health Assessment, ${points.map((p) => `${p.label} on ${short(p.at, true)}`).join(", ")}. Lower is better.`} />
    </Card>
  );
}

function BloodCard({ data, scales }: { data: BloodMarkersHistory | null; scales: ProgressScales | null }) {
  const rows = [...(data?.history ?? [])].sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at));
  const base = { testid: "tracker-blood-markers", name: "Blood Markers", color: "#B2483B", href: "/app/progress/blood-markers" };
  if (!rows.length) return <Card {...base} rest action="Add results" />;
  const now = rows[rows.length - 1], before = rows[rows.length - 2];
  const tally = (r: typeof now) => { const known = Object.values(r.in_range).filter((v) => v !== null); return { known: known.length, good: known.filter(Boolean).length }; };
  const value = (r: typeof now, key: BloodCalculationKey) => key === "hba1c" ? r.markers.hba1c : r[key];
  const t = tally(now), was = before ? tally(before) : null;
  return (
    <Card {...base} table={{ caption: "Blood Marker results", heads: ["Date", ...MARKERS.map((m) => m.label)],
            rows: [...rows].reverse().map((r) => [short(Date.parse(r.completed_at), true), ...MARKERS.map((m) => { const v = value(r, m.key); return v === null || v === undefined ? "—" : `${v}${m.unit}`; })]) }}
          action="Add results"
          headline={t.known ? <>{t.good} of {t.known} <small>in the ideal range</small></> : <small>No marker with an ideal range yet</small>}
          change={<>On {short(Date.parse(now.completed_at), true)}.{was && was.known ? ` On ${short(Date.parse(before.completed_at), true)}: ${was.good} of ${was.known}.` : ""}</>}>
      <ul className="marker-list">
        {MARKERS.map((marker) => {
          const goal = scales?.blood_markers.find((g) => g.key === marker.key);
          const v = value(now, marker.key), prev = before ? value(before, marker.key) : null;
          const ok = now.in_range[marker.key];
          const top = Math.max(goal ? goal.high * 2 : 0, v ?? 0, prev ?? 0) * 1.1 || 1;
          const bottom = goal?.low ? Math.max(0, Math.min(goal.low - (goal.high - goal.low) * 2, v ?? goal.low, prev ?? goal.low)) : 0;
          const x = (n: number) => `${Math.min(100, Math.max(0, ((n - bottom) / (top - bottom)) * 100))}%`;
          return (
            <li key={marker.key} data-marker={marker.key}>
              <span className="marker-list__name"><b>{marker.label}</b>{goal && <small>ideal {goal.ideal.replace("<", "below")}</small>}</span>
              <span className="marker-list__track" aria-hidden="true">
                {goal && <span className="marker-list__goal" style={{ left: x(goal.low ?? bottom), right: `calc(100% - ${x(goal.high)})` }} />}
                {prev !== null && prev !== undefined && <span className="marker-list__was" style={{ left: x(prev) }} />}
                {v !== null && v !== undefined && <span className={`marker-list__now${ok ? " is-in" : ""}`} style={{ left: x(v) }} />}
              </span>
              <span className="marker-list__value">{v === null || v === undefined ? <span className="marker-list__none">Not entered</span> : <><b>{v}{marker.unit}</b> {ok === null ? "" : ok ? "in range" : "outside"}</>}</span>
            </li>
          );
        })}
      </ul>
      <p className="tracker-note">Dot: latest, filled inside the ideal range. {before ? "Grey tick: the result before. " : ""}Other markers have no ideal range from Veye, so none is drawn.</p>
    </Card>
  );
}

function axis(points: Pt[]): [number, number] {
  const lo = Math.min(...points.map((p) => p.value)), hi = Math.max(...points.map((p) => p.value));
  const pad = Math.max(1, Math.ceil((hi - lo) * 0.25));
  return [Math.max(0, Math.floor(lo) - pad), Math.ceil(hi) + pad];
}

function BodyCard({ data }: { data: BodyCompositionHistory | null }) {
  const rows = [...(data?.history ?? [])].sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at));
  const [show, setShow] = useState<"fat" | "bmi">("fat");
  const base = { testid: "tracker-body-composition", name: "Body Composition", color: "#2F7A35", href: "/app/progress/body-composition" };
  if (!rows.length) return <Card {...base} rest action="Add measurements" />;
  const fat = byDate(rows, (r) => r.body_fat_percent === null || r.body_fat_percent === undefined ? null : { at: Date.parse(r.completed_at), value: Number(r.body_fat_percent), label: `${Number(r.body_fat_percent)}%` });
  const bmi = byDate(rows, (r) => r.bmi === null || r.bmi === undefined ? null : { at: Date.parse(r.completed_at), value: Number(r.bmi), label: Number(r.bmi).toFixed(1) });
  const view = show === "fat" && fat.length ? "fat" : "bmi";
  const points = view === "fat" ? fat : bmi;
  const now = rows[rows.length - 1];
  const last = points[points.length - 1], before = points[points.length - 2];
  const unit = view === "fat" ? " points" : "";
  const [low, high] = points.length ? axis(points) : [0, 1];
  return (
    <Card {...base} table={{ caption: "Body Composition results", heads: ["Date", "Body fat", "BMI"],
            rows: [...rows].reverse().map((r) => [short(Date.parse(r.completed_at), true), r.body_fat_percent === null ? "Not available" : `${r.body_fat_percent}%`, r.bmi === null ? "—" : Number(r.bmi).toFixed(1)]) }}
          action="Update"
          headline={points.length ? <>{view === "fat" ? `${last.value}%` : last.label} <small>{view === "fat" ? "body fat" : "BMI"}</small></> : <small>No supported result</small>}
          change={<>{!points.length ? "" : !before ? `First result, ${short(last.at, true)}.` : last.value === before.value ? `No change since ${stamp(points, points.length - 2)}.` : `${Math.abs(last.value - before.value).toFixed(1)}${unit} ${last.value < before.value ? "lower" : "higher"} than ${stamp(points, points.length - 2)}.`}
            {view === "fat" && now.bmi !== null ? ` Standard BMI ${Number(now.bmi).toFixed(1)}, reported separately.` : ""}{now.body_fat_percent === null ? " Body fat is not available for the latest measurements." : ""}</>}>
      {fat.length > 0 && bmi.length > 0 && (
        <div className="tracker-switch" role="group" aria-label="Which measure">
          <button type="button" aria-pressed={view === "fat"} onClick={() => setShow("fat")}>Body fat</button>
          <button type="button" aria-pressed={view === "bmi"} onClick={() => setShow("bmi")}>BMI</button>
        </div>
      )}
      {points.length > 0 && <LineChart points={points} low={low} high={high} color={base.color} unit={view === "fat" ? "%" : ""} describe={`${view === "fat" ? "Body fat" : "BMI"}, ${points.map((p) => `${p.label} on ${short(p.at, true)}`).join(", ")}.`} />}
      <p className="tracker-note">Veye has no range for this, so none is drawn.</p>
    </Card>
  );
}

function QuizCard({ data }: { data: SimpleQuizHistory | null }) {
  const rows = [...(data?.history ?? [])].sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at));
  const points = byDate(rows, (r) => ({ at: Date.parse(r.completed_at), value: r.no_count, label: String(r.no_count) }));
  const base = { testid: "tracker-simple-quiz", name: "Simple Quiz", color: "#B5650A", href: "/app/progress/simple-quiz" };
  if (!points.length) return <Card {...base} rest action="Take the quiz" />;
  const now = rows[rows.length - 1], before = points[points.length - 2];
  const of = now.yes_count + now.no_count;
  return (
    <Card {...base} table={{ caption: "Simple Quiz results", heads: ["Date", "No", "Yes"],
            rows: [...rows].reverse().map((r) => [short(Date.parse(r.completed_at), true), String(r.no_count), String(r.yes_count)]) }}
          action="Take the quiz" headline={<>{now.no_count} No <small>of {of} answers</small></>}
          change={<>On {short(points[points.length - 1].at, true)}.{before ? ` On ${stamp(points, points.length - 2)}: ${before.value} No.` : ""}</>}>
      <BarChart points={points} high={of} color={base.color} describe={`Simple Quiz No answers, ${points.map((p) => `${p.label} on ${short(p.at, true)}`).join(", ")}.`} />
      <p className="tracker-note">A count of answers, nothing more.</p>
    </Card>
  );
}
