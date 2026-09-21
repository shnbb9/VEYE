"use client";

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
const W = 640, H = 200, PAD_X = 22, PAD_TOP = 18, PAD_BOTTOM = 26;

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
  const series = buildSeries(blood, body, assessment, quiz);
  const all = series.flatMap((s) => s.points);
  const anyUsed = all.length > 0;
  const minAt = all.length ? Math.min(...all.map((p) => p.at)) : 0;
  const maxAt = all.length ? Math.max(...all.map((p) => p.at)) : 1;
  const x = (at: number) => all.length < 2 || maxAt === minAt ? W / 2 : PAD_X + ((at - minAt) / (maxAt - minAt)) * (W - PAD_X * 2);
  const plotTop = PAD_TOP, plotBottom = H - PAD_BOTTOM;
  const yFor = (s: Series, p: Point) => {
    const values = s.points.map((q) => q.value);
    const lo = Math.min(...values), hi = Math.max(...values);
    if (hi === lo) return (plotTop + plotBottom) / 2;
    return plotBottom - ((p.value - lo) / (hi - lo)) * (plotBottom - plotTop);
  };
  const restY = (index: number) => plotBottom - 10 - index * 14;
  const dates = all.length ? [new Date(minAt), new Date(maxAt)] : [];
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className={`tracker-graph${compact ? " tracker-graph--compact" : ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={anyUsed ? "Progress trackers over time" : "Progress trackers — all at rest"} className="tracker-graph__svg">
        <line x1={PAD_X} y1={plotBottom} x2={W - PAD_X} y2={plotBottom} className="tracker-graph__axis" />
        <line x1={PAD_X} y1={plotTop} x2={PAD_X} y2={plotBottom} className="tracker-graph__axis" />
        {series.map((s, index) => s.points.length === 0
          ? <line key={s.key} x1={PAD_X + 6} y1={restY(index)} x2={W - PAD_X - 6} y2={restY(index)} stroke={s.color} strokeWidth={2} strokeDasharray="6 8" opacity={0.35} />
          : (
            <g key={s.key}>
              <polyline fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
                        points={s.points.map((p) => `${x(p.at).toFixed(1)},${yFor(s, p).toFixed(1)}`).join(" ")} />
              {s.points.map((p) => <circle key={p.at} cx={x(p.at)} cy={yFor(s, p)} r={4} fill="#fff" stroke={s.color} strokeWidth={2.5}><title>{`${s.label}: ${p.display} · ${fmt(new Date(p.at))}`}</title></circle>)}
            </g>
          ))}
        {dates.length === 2 && (
          <>
            <text x={PAD_X} y={H - 8} className="tracker-graph__tick">{fmt(dates[0])}</text>
            {maxAt !== minAt && <text x={W - PAD_X} y={H - 8} textAnchor="end" className="tracker-graph__tick">{fmt(dates[1])}</text>}
          </>
        )}
        {!anyUsed && <text x={W / 2} y={plotTop + 22} textAnchor="middle" className="tracker-graph__empty">All trackers at rest — results appear here as you use them.</text>}
      </svg>
      <ul className="tracker-graph__legend">
        {series.map((s) => {
          const latest = s.points[s.points.length - 1];
          return (
            <li key={s.key}>
              <span className="tracker-graph__swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="tracker-graph__name">{s.label}</span>
              <span className="tracker-graph__value">{latest ? `${latest.display} · ${s.points.length} result${s.points.length === 1 ? "" : "s"}` : s.rest}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
