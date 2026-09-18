/* Date formats used by the approved dashboard: "UPD: MM/DD/YY" chips and
   "Aug 11, 2026" history rows (build/dashboard.html formatUpd/formatHistDate). */

const HIST_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatUpd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const y = String(d.getFullYear()).slice(2);
  return `${m}/${day}/${y}`;
}

export function formatHistDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${HIST_MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()}`;
}

/** The published one-decimal Health Number format ("1.0"), identical on the
 *  onboarding result, the Dashboard card and My Progress. */
export function displayHealthNumber(value: number): string {
  return Number(value).toFixed(1);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
