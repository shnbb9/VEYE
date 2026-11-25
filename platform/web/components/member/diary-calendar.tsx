"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { addDays, addMonths, longDay, monthLabel, monthOf, monthWeeks, shortDay, toDate } from "@/lib/diary-dates";
import type { DiaryHistoryDay } from "@/lib/member-api";

/* The Food Diary's History as a month (owner, 25 Nov 2026): which days have
   meals, which were saved, and one press to open any of them in "Your day".

   It asks the API for nothing. The diary already answers with every logged or
   saved day, so the same rows the list shows are the marks here, and they can
   never disagree. Planned meals are not in that answer and are not shown: this
   is what was eaten.

   One tab stop. Arrows move by day and week, Home and End along the week, Page
   Up and Down by month (with Shift, by year); Enter opens the day. */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const mealsOf = (n: number) => `${n} meal${n === 1 ? "" : "s"}`;

export function DiaryCalendar({ selected, today, days, onSelect }: {
  selected: string; today: string; days: DiaryHistoryDay[] | null; onSelect: (key: string, byPointer: boolean) => void;
}) {
  const id = useId();
  const [month, setMonth] = useState(monthOf(selected));
  const [cursor, setCursor] = useState(selected);
  const grid = useRef<HTMLDivElement>(null);
  const follow = useRef(false);
  const marks = useMemo(() => new Map((days ?? []).map((row) => [row.entry_date, row])), [days]);

  // Opening another day elsewhere (the arrows, the date box, the list) turns
  // to its month. Turning pages here leaves the open day alone.
  useEffect(() => { setMonth(monthOf(selected)); setCursor(selected); }, [selected]);

  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-cal-day="${cursor}"]`)?.focus();
  }, [cursor, month]);

  function turn(n: number) {
    const next = addMonths(`${month}-01`, n);
    setMonth(monthOf(next));
  }

  function onKeyDown(event: KeyboardEvent) {
    const to = move(event.key, event.shiftKey, tabbable);
    if (!to) return;
    event.preventDefault();
    follow.current = true;
    setCursor(to);
    setMonth(monthOf(to));
  }

  const inMonth = (key: string) => monthOf(key) === month;
  const tabbable = inMonth(cursor) ? cursor : inMonth(selected) ? selected : inMonth(today) ? today : `${month}-01`;
  const open = marks.get(selected);

  return (
    <div className="fdxcal" data-testid="diary-calendar">
      <div className="fdxcal-head">
        <button className="fdxcal-turn" type="button" aria-label="Previous month" onClick={() => turn(-1)}>&lsaquo;</button>
        <h4 className="fdxcal-month" id={`${id}-month`} aria-live="polite">{monthLabel(month)}</h4>
        <button className="fdxcal-turn" type="button" aria-label="Next month" onClick={() => turn(1)}>&rsaquo;</button>
      </div>

      <div className="fdxcal-grid" role="grid" aria-labelledby={`${id}-month`} aria-busy={days === null} ref={grid} onKeyDown={onKeyDown}>
        <div className="fdxcal-row fdxcal-row--head" role="row">
          {WEEKDAYS.map((name) => <span key={name} className="fdxcal-weekday" role="columnheader" aria-label={name}>{name.slice(0, 2)}</span>)}
        </div>
        {/* keyed by month, so a turned page arrives instead of the numbers changing in place */}
        <div className="fdxcal-weeks" role="rowgroup" key={month}>
          {monthWeeks(month).map((week, w) => (
            <div className="fdxcal-row" role="row" key={w}>
              {week.map((key, i) => key === null
                ? <span key={i} className="fdxcal-blank" role="gridcell" aria-hidden="true" />
                : (
                  <span key={key} role="gridcell" aria-selected={key === selected}>
                    <button type="button" data-cal-day={key} tabIndex={key === tabbable ? 0 : -1}
                            className={cell(key, marks.get(key), key === selected, key === today, key > today)}
                            aria-label={spoken(key, marks.get(key))} aria-current={key === today ? "date" : undefined}
                            onFocus={() => setCursor(key)}
                            onClick={(event) => onSelect(key, event.detail > 0)}>
                      <span className="fdxcal-num">{toDate(key).getDate()}</span>
                      <i className="fdxcal-mark" aria-hidden="true" />
                    </button>
                  </span>
                ))}
            </div>
          ))}
        </div>
      </div>

      <div className="fdxcal-foot">
        <p className="fdxcal-legend" aria-hidden="true">
          <span><i className="fdxcal-mark fdxcal-mark--logged" /> Logged</span>
          <span><i className="fdxcal-mark fdxcal-mark--saved" /> Saved</span>
        </p>
        {month !== monthOf(today) && (
          <button className="fdxcal-today" type="button" onClick={() => setMonth(monthOf(today))}>This month</button>
        )}
      </div>
      <p className="fdxcal-day" data-testid="diary-calendar-day">
        <b>{shortDay(selected)}</b>{" "}
        {open && open.meals > 0 ? `${mealsOf(open.meals)} · ~${open.kcal} kcal${open.saved ? " · saved" : ""}`
          : open?.saved ? "Saved, with nothing logged." : days === null ? "" : "Nothing logged on this day."}
      </p>
    </div>
  );
}

function move(key: string, shift: boolean, from: string): string | null {
  switch (key) {
    case "ArrowLeft": return addDays(from, -1);
    case "ArrowRight": return addDays(from, 1);
    case "ArrowUp": return addDays(from, -7);
    case "ArrowDown": return addDays(from, 7);
    case "Home": return addDays(from, -toDate(from).getDay());
    case "End": return addDays(from, 6 - toDate(from).getDay());
    case "PageUp": return addMonths(from, shift ? -12 : -1);
    case "PageDown": return addMonths(from, shift ? 12 : 1);
    default: return null;
  }
}

function cell(key: string, mark: DiaryHistoryDay | undefined, selected: boolean, today: boolean, ahead: boolean): string {
  return ["fdxcal-cell", mark && mark.meals > 0 && "has-meals", mark?.saved && "is-saved", selected && "is-open",
    today && "is-today", ahead && "is-ahead"].filter(Boolean).join(" ");
}

function spoken(key: string, mark: DiaryHistoryDay | undefined): string {
  const logged = mark && mark.meals > 0 ? `${mealsOf(mark.meals)} logged` : "nothing logged";
  return `${longDay(key)}, ${logged}${mark?.saved ? ", saved" : ""}`;
}
