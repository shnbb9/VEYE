"use client";

import { useEffect, useRef, useState } from "react";
import type { BloodMarkersHistory, BodyCompositionHistory, HealthAssessmentHistory, SimpleQuizHistory } from "@/lib/api";

/* Progress Trackers line graph (Cara, Progress Trackers Decision Tree ¶012–016):
   "a line graph of the ones used. Unused ones are at rest, and if none are used
   then all are at rest." Colours are hers: Blood Markers red, BMI green, Health
   Questionnaire blue, Simple Quiz orange. Every point is a real persisted result;
   a tracker without results — or not connected yet — draws a resting line.

   Cara's spreadsheet key for the y-axis is not in the workspace, so each line
   uses a provisional per-tracker value (Blood Markers: markers in range; BMI:
   the BMI value; Health Assessment: the 11–33 total; Simple Quiz: the number
   of No answers) scaled within its own band — flagged as a client clarification. */

export type TrackerKey = "blood_markers" | "body_composition" | "health_assessment" | "simple_quiz";
type Point = { at: number; value: number; display: string };
type Series = { key: TrackerKey; label: string; color: string; points: Point[]; rest: string | null };

const COLORS: Record<TrackerKey, string> = { blood_markers: "#D64545", body_composition: "#4FA64F", health_assessment: "#3B7DD8", simple_quiz: "#E8891D" };
const PAD_X = 18, PAD_TOP = 22, PAD_BOTTOM = 30;

/* A smooth line through the points (Catmull-Rom as cubic Béziers), so a
   tracker reads as a trend rather than a zig-zag; one point is just a point. */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return "";
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function buildSeries(blood: BloodMarkersHistory | null, body: BodyCompositionHistory | null,
                            assessment: HealthAssessmentHistory | null = null, quiz: SimpleQuizHistory | null = null): Series[] {
  const bloodPoints: Point[] = (blood?.history ?? [])
    .map((item) => {
      const flags = Object.values(item.in_range ?? {}).filter((v) => v !== null) as boolean[];
      const inRange = flags.filter(Boolean).length;
      return { at: Date.parse(item.completed_at), value: flags.length ? inRange / flags.length : 0, display: `${inRange} of ${flags.length} in range` };
    })
    .filter((p) => Number.isFinite(p.at)).sort((a, b) => a.at - b.at);
  const bodyPoints: Point[] = (body?.history ?? [])
    .filter((item) => item.bmi !== null && item.bmi !== undefined)
    .map((item) => ({ at: Date.parse(item.completed_at), value: Number(item.bmi), display: `BMI ${Number(item.bmi).toFixed(1)}` }))
    .filter((p) => Number.isFinite(p.at)).sort((a, b) => a.at - b.at);
  const assessmentPoints: Point[] = (assessment?.history ?? [])
    .map((item) => ({ at: Date.parse(item.completed_at), value: item.total, display: `${item.total} / 33 · ${item.status}` }))
    .filter((p) => Number.isFinite(p.at)).sort((a, b) => a.at - b.at);
  const quizPoints: Point[] = (quiz?.history ?? [])
    .map((item) => ({ at: Date.parse(item.completed_at), value: item.no_count, display: `${item.no_count} No / ${item.yes_count} Yes` }))
    .filter((p) => Number.isFinite(p.at)).sort((a, b) => a.at - b.at);
  const rest = (points: Point[]) => (points.length ? null : "at rest — no results yet");
  return [
    { key: "blood_markers", label: "Blood Markers", color: COLORS.blood_markers, points: bloodPoints, rest: rest(bloodPoints) },
    { key: "body_composition", label: "BMI", color: COLORS.body_composition, points: bodyPoints, rest: rest(bodyPoints) },
    { key: "health_assessment", label: "Health Questionnaire", color: COLORS.health_assessment, points: assessmentPoints, rest: rest(assessmentPoints) },
    { key: "simple_quiz", label: "Simple Quiz", color: COLORS.simple_quiz, points: quizPoints, rest: rest(quizPoints) },
  ];
}

export function TrackerGraph({ blood, body, assessment = null, quiz = null, compact = false }: {
  blood: BloodMarkersHistory | null; body: BodyCompositionHistory | null;
  assessment?: HealthAssessmentHistory | null; quiz?: SimpleQuizHistory | null; compact?: boolean;
}) {
  // The plot is drawn at its real width — one SVG unit per pixel — so lines and
  // points keep their size on a phone instead of shrinking with a scaled-down
  // drawing.
  const plotRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(960);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const update = () => setW(Math.max(280, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const H = W < 600 ? 190 : 230;
  const series = buildSeries(blood, body, assessment, quiz);
  const all = series.flatMap((s) => s.points);
  const anyUsed = all.length > 0;
  const minAt = all.length ? Math.min(...all.map((p) => p.at)) : 0;
  const maxAt = all.length ? Math.max(...all.map((p) => p.at)) : 1;
  const x = (at: number) => all.length < 2 || maxAt === minAt ? W / 2 : PAD_X + ((at - minAt) / (maxAt - minAt)) * (W - PAD_X * 2);
  const plotTop = PAD_TOP, plotBottom = H - PAD_BOTTOM;
  // One calm lane per tracker. The four values have no common unit (the key
  // is provisional), so lines never share an axis: each moves within its own
  // lane to show its trend, and the exact values live in the tooltips and the
  // legend. (A shared full-height scale drew every two-result tracker corner
  // to corner, crossing the others.)
  const laneOf = (s: Series) => series.findIndex((t) => t.key === s.key);
  const laneY = (index: number) => plotTop + (plotBottom - plotTop) * (0.2 + index * 0.2);
  const laneAmp = (plotBottom - plotTop) * 0.085;
  const yFor = (s: Series, p: Point) => {
    const values = s.points.map((q) => q.value);
    const lo = Math.min(...values), hi = Math.max(...values);
    const norm = hi === lo ? 0.5 : (p.value - lo) / (hi - lo);
    return laneY(laneOf(s)) - (norm - 0.5) * 2 * laneAmp;
  };
  // A resting tracker draws a quiet dotted line in its own lane.
  const restY = (index: number) => laneY(index);
  // Only the baseline: each lane draws its own faint guide.
  const grid = [plotBottom];
  const dates = all.length ? [new Date(minAt), new Date(maxAt)] : [];
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className={`tracker-graph${compact ? " tracker-graph--compact" : ""}`}>
      <div className="tracker-graph__plot" ref={plotRef}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={anyUsed ? "Progress trackers over time" : "Progress trackers — all at rest"} className="tracker-graph__svg">
          {grid.map((y, i) => <line key={i} x1={PAD_X} y1={y} x2={W - PAD_X} y2={y} className="tracker-graph__base" />)}
          {series.map((s, index) => {
            if (s.points.length === 0) {
              const y = restY(index);
              return (
                <g key={s.key} className="tracker-graph__rest">
                  <line x1={PAD_X + 8} y1={y} x2={W - PAD_X - 26} y2={y} stroke={s.color} strokeWidth={3.2} strokeLinecap="round" strokeDasharray="0.1 11" opacity={0.5} />
                  <circle cx={W - PAD_X - 12} cy={y} r={9} fill={s.color} opacity={0.14} />
                  <circle cx={W - PAD_X - 12} cy={y} r={4} fill={s.color} opacity={0.85} />
                </g>
              );
            }
            const pts: [number, number][] = s.points.map((p) => [x(p.at), yFor(s, p)]);
            const line = smoothPath(pts);
            const last = pts[pts.length - 1];
            return (
              <g key={s.key}>
                <line x1={PAD_X + 8} y1={laneY(index)} x2={W - PAD_X - 8} y2={laneY(index)} stroke={s.color} strokeWidth={1.5} strokeLinecap="round" strokeDasharray="0.1 9" opacity={0.28} />
                {line && <path d={line} fill="none" stroke={s.color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />}
                <circle cx={last[0]} cy={last[1]} r={11} fill={s.color} opacity={0.14} />
                {s.points.map((p) => <circle key={p.at} cx={x(p.at)} cy={yFor(s, p)} r={4.5} fill="#fff" stroke={s.color} strokeWidth={2.5}><title>{`${s.label}: ${p.display} · ${fmt(new Date(p.at))}`}</title></circle>)}
              </g>
            );
          })}
          {dates.length === 2 && (
            <>
              <text x={PAD_X} y={H - 8} className="tracker-graph__tick">{fmt(dates[0])}</text>
              {maxAt !== minAt && <text x={W - PAD_X} y={H - 8} textAnchor="end" className="tracker-graph__tick">{fmt(dates[1])}</text>}
            </>
          )}
        </svg>
        {!anyUsed && <p className="tracker-graph__empty">All trackers at rest — results appear here as you use them.</p>}
      </div>
      <ul className="tracker-graph__legend">
        {series.map((s) => {
          const latest = s.points[s.points.length - 1];
          return (
            <li key={s.key} style={{ background: `${s.color}14`, borderColor: `${s.color}33` }}>
              <span className="tracker-graph__swatch" style={{ background: s.color, boxShadow: `0 0 0 4px ${s.color}24` }} aria-hidden="true" />
              <span className="tracker-graph__text">
                <span className="tracker-graph__name">{s.label}</span>
                <span className="tracker-graph__value">{latest ? `${latest.display} · ${s.points.length} result${s.points.length === 1 ? "" : "s"}` : s.rest}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
