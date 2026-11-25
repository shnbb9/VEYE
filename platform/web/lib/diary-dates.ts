/* Calendar days for the Food Diary: the member's own day, as YYYY-MM-DD.
 *
 * A key is never turned into an instant and back. `new Date("2026-03-01")` is
 * midnight in Greenwich, which is the day before for half of the world; every
 * calculation here is on local year, month and day, at noon, where no clock
 * change can move it into the next or the last. */

export const dateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const parts = (key: string) => key.split("-").map(Number) as [number, number, number];
const at = (y: number, m: number, d: number) => new Date(y, m, d, 12);

export const toDate = (key: string): Date => { const [y, m, d] = parts(key); return at(y, m - 1, d); };
export const addDays = (key: string, n: number): string => { const [y, m, d] = parts(key); return dateKey(at(y, m - 1, d + n)); };

/** A month away, on the same day: the 31st of January becomes the last day of February, not the 3rd of March. */
export function addMonths(key: string, n: number): string {
  const [y, m, d] = parts(key);
  const last = at(y, m + n, 0).getDate();
  return dateKey(at(y, m - 1 + n, Math.min(d, last)));
}

/** A day that exists, written the way the API writes it. */
export function isDayKey(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dateKey(toDate(value)) === value;
}

export const monthOf = (key: string): string => key.slice(0, 7);

/** The month as six weeks from Sunday, so every month has the same height; null before the first and after the last. */
export function monthWeeks(month: string): (string | null)[][] {
  const [y, m] = month.split("-").map(Number);
  const lead = at(y, m - 1, 1).getDay();
  const count = at(y, m, 0).getDate();
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, i) => {
    const d = week * 7 + i - lead + 1;
    return d >= 1 && d <= count ? `${month}-${String(d).padStart(2, "0")}` : null;
  }));
}

export const longDay = (key: string): string =>
  toDate(key).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
export const shortDay = (key: string): string =>
  toDate(key).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
export const monthLabel = (month: string): string =>
  toDate(`${month}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
