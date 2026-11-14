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

/** Back to the top of whatever is actually scrolling.
 *
 *  The member shell scrolls `.main` (`overflow-y: auto`), not the document, so
 *  `window.scrollTo(0, 0)` is a no-op inside /app: every Progress screen called
 *  it after saving and the member was left looking at the Submit button they
 *  had just pressed, with the result they had asked for above the fold. The
 *  window is scrolled too, for the screens that live outside the shell. */
export function scrollToTop(): void {
  if (typeof document === "undefined") return;
  document.querySelector<HTMLElement>(".main")?.scrollTo({ top: 0 });
  window.scrollTo(0, 0);
}
