import type { ReactNode } from "react";
import type { HealthPermission, MemberRow, MemberTrend, Priority } from "@/lib/admin-console-api";

/* The cells the directory, the trends view and Member 360 share, so the same
   fact is never worded two ways. */

const SHARING_TONE: Record<HealthPermission["state"], string> = {
  not_requested: "draft", requested: "info", granted: "live", declined: "attention", revoked: "archived",
};
export const SHARING_OPTIONS = [
  ["any", "Any health sharing"], ["not_requested", "Not requested"], ["requested", "Requested"], ["granted", "Shared"],
  ["declined", "Declined"], ["revoked", "Revoked"],
] as const;

export function SharingChip({ member }: { member: Pick<MemberRow, "sharing_state" | "sharing_label"> }) {
  return <span className={`chip chip--${SHARING_TONE[member.sharing_state]}`} data-sharing={member.sharing_state}>{member.sharing_label}</span>;
}

/** A day, for tables: the time of day is on Member 360. */
export const fmtDay = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The figure, or why there is none — never "not completed" for "not shared". */
export function HealthNumberCell({ member }: { member: MemberRow }) {
  if (!member.shares_health_data) return <span className="t-muted">Not shared</span>;
  if (member.health_number === null) return <span className="t-muted">Not completed</span>;
  return <><span className="t-num">{Number(member.health_number).toFixed(1)}</span> <span className="cell-sub">{member.health_number_status}</span></>;
}

export const TREND_OPTIONS = [
  ["any", "Any trend"], ["improved", "Improved"], ["worsened", "Increased (worse)"], ["unchanged", "No change"], ["first", "First result"],
  ["not_comparable", "Not comparable"], ["none", "No result"], ["not_shared", "Not shared"],
] as const;

/* Lower is better on the client's scale, so the arrow follows the number and
   the words say what that means; colour never carries it alone. */
export function TrendCell({ trend }: { trend: MemberTrend }) {
  const since = trend.previous_at ? <span className="cell-sub t-nowrap">since {fmtDay(trend.previous_at)}</span> : null;
  const by = Math.abs(trend.delta ?? 0).toFixed(1);
  const two = (chip: ReactNode, below: ReactNode) => <span className="trend" data-trend={trend.state}>{chip} {below}</span>;
  switch (trend.state) {
    case "improved":
      return two(<span className="chip chip--live"><span aria-hidden="true">↓ </span>{by} lower<span className="sr-only">, improved: lower is better</span></span>, since);
    case "worsened":
      return two(<span className="chip chip--error"><span aria-hidden="true">↑ </span>{by} higher<span className="sr-only">, worse: lower is better</span></span>, since);
    case "unchanged":
      return two(<span className="chip"><span aria-hidden="true">— </span>No change</span>, since);
    case "first":
      return <span className="t-muted" data-trend="first">First result</span>;
    case "not_comparable":
      return <span className="t-muted" data-trend="not_comparable" title="The two results were scored by different versions of the calculation">Not comparable</span>;
    case "none":
      return <span className="t-muted" data-trend="none">No result yet</span>;
    default:
      return <span className="t-muted" data-trend="not_shared">Not shared</span>;
  }
}

export const PRIORITY_OPTIONS: readonly { value: Priority | ""; label: string }[] = [
  { value: "", label: "Not set" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" },
];
const PRIORITY_TONE: Record<Priority, string> = { high: "error", medium: "attention", low: "draft" };

export function PriorityChip({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  return <span className={`chip chip--${PRIORITY_TONE[priority]} chip--sm`} data-priority={priority}>{priority[0].toUpperCase() + priority.slice(1)} importance</span>;
}

/** Importance is a label the team puts on. It is not medical triage and nothing guesses it. */
export function PrioritySelect({ id, value, disabled, onChange }: { id: string; value: Priority | null; disabled?: boolean; onChange: (value: Priority | null) => void }) {
  return (
    <div className="field" style={{ margin: 0, maxWidth: 220 }}>
      <label className="t-eyebrow" htmlFor={id}>Importance</label>
      <select className="select" id={id} value={value ?? ""} disabled={disabled} data-testid="priority-select"
              onChange={(event) => onChange((event.target.value || null) as Priority | null)}>
        {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span className="field__hint">Set by the team. Not medical triage.</span>
    </div>
  );
}
