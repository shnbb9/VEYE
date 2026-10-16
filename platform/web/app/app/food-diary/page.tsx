"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  addMeal, estimateMacros, getDiaryDay, getDiaryFeedback, localDateKey, removeMeal, saveDiaryDay, updateMeal,
  type DiaryDay, type Macros, type Meal,
} from "@/lib/member-api";
import { prefersReducedMotion } from "@/lib/member-format";
import "../prototype-type.css";

/* The approved Food Diary (build/dashboard.html, #view-food-diary), reproduced
   element for element: log a meal on the left — the photo row "In
   Development", what you ate with the live prototype macro estimate, the
   required time, how you felt and notes — and the day on the right with its
   date switcher, the summary, Give me feedback, Save and History. Every value
   is read from and written to the member's account; the estimate and the
   feedback are the prototype's own rules, calculated by the API. */

const FEELINGS = ["Hungry", "Very hungry", "Not hungry", "Stressed", "Relaxed", "Tired", "Energized", "Rushed", "Bored"];
const EMPTY = { what: "", time: "", notes: "" };

function shift(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return localDateKey(new Date(y, m - 1, d + delta, 12));
}

/* The prototype's one-time scroll reveal (.fdx-panel is one of its reveal
   marks): each panel fades and rises in the first time it nears the viewport,
   once per load of the app; with reduced motion or no IntersectionObserver it
   is simply shown. */
const revealedPanels = new Set<string>();

function useReveal(name: string) {
  const ref = useRef<HTMLElement>(null);
  const [reveal, setReveal] = useState("");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || revealedPanels.has(name) || prefersReducedMotion() || !("IntersectionObserver" in window)) return;
    setReveal(" reveal-pending");
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      revealedPanels.add(name);
      setReveal(" reveal-in");
      io.disconnect();
    }, { rootMargin: "40px 0px", threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [name]);
  return [ref, reveal] as const;
}

export default function FoodDiaryPage() {
  const [leftRef, leftReveal] = useReveal("left");
  const [rightRef, rightReveal] = useReveal("right");
  const [date, setDate] = useState(localDateKey());
  const [day, setDay] = useState<DiaryDay | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [feelings, setFeelings] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [macros, setMacros] = useState<Macros | null>(null);
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const busy = useRef(false);
  const estimateTurn = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // renderFdxDay: a new day (or a changed one) hides the previous feedback.
  const show = useCallback((next: DiaryDay) => { setDay(next); setFeedback(null); }, []);

  useEffect(() => {
    let live = true;
    getDiaryDay(date)
      .then((next) => { if (live) show(next); })
      .catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : "Your diary could not be loaded."); });
    return () => { live = false; };
  }, [date, show]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  // refreshMacroPreview: the estimate follows the description as it is typed.
  function preview(what: string) {
    const turn = ++estimateTurn.current;
    if (!what.trim()) { setMacros(null); return; }
    estimateMacros(what)
      .then((result) => { if (turn === estimateTurn.current) setMacros(result.estimate); })
      .catch(() => { if (turn === estimateTurn.current) setMacros(null); });
  }

  function onWhat(value: string) {
    setForm((current) => ({ ...current, what: value }));
    preview(value);
  }

  function toggleFeeling(feeling: string) {
    setFeelings((current) => current.includes(feeling) ? current.filter((f) => f !== feeling) : [...current, feeling]);
  }

  function goTo(next: string) {
    setEditing(null);          // the form keeps what was typed, as in the prototype
    setDate(next);
  }

  function startEdit(meal: Meal) {
    setEditing(meal.id);
    setForm({ what: meal.description, time: meal.meal_time, notes: meal.notes });
    setFeelings(meal.feelings);
    preview(meal.description);
    document.getElementById("fdxWhat")?.focus();
  }

  async function submit() {
    const what = form.what.trim();
    if (!what) { setError("Describe what you ate first."); document.getElementById("fdxWhat")?.focus(); return; }
    if (!form.time) { setError("The time you ate is required."); document.getElementById("fdxTime")?.focus(); return; }
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      const input = { entry_date: date, meal_time: form.time, description: what, feelings, notes: form.notes.trim() };
      show(editing ? await updateMeal(editing, input) : await addMeal(input));
      setEditing(null);
      setForm(EMPTY);
      setFeelings([]);
      estimateTurn.current++;
      setMacros(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The entry could not be saved.");
    } finally { busy.current = false; }
  }

  async function remove(meal: Meal) {
    try {
      show(await removeMeal(meal.id));
      if (editing === meal.id) setEditing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The entry could not be removed.");
    }
  }

  async function saveDay() {
    try {
      const next = await saveDiaryDay(date);
      setDay(next);
      setSavedNote(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedNote(false), 2200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The day could not be saved.");
    }
  }

  async function askFeedback() {
    try {
      setFeedback((await getDiaryFeedback(date)).text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Feedback is not available right now.");
    }
  }

  const meals = day?.entry_date === date ? day.meals : [];
  const totals = day?.entry_date === date ? day.totals : null;

  return (
    <>
      <h1 className="fd-title">Food Diary</h1>
      <p className="fdx-blurb">Note the time, macronutrient content, and how you felt before you ate on the left, and your day summary will update on the right.</p>

      <div className="fdx-layout">
        {/* ================= left: log a meal ================= */}
        <section ref={leftRef} className={`fdx-panel fdx-left${leftReveal}`} aria-labelledby="fdxLeftTitle">
          <h2 className="fdx-panel-title" id="fdxLeftTitle">Log a meal</h2>

          <div className="fdx-photo">
            <button className="fdx-photo-btn" type="button" disabled aria-disabled="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V9.5A1.5 1.5 0 0 1 4 8z" /><circle cx="12" cy="14" r="3.6" /></svg>
              Snap a photo
              <span className="fdx-indev-tag">In Development</span>
            </button>
            <div className="fdx-photo-sub">
              <label className="fdx-label fdx-label--muted" htmlFor="fdxPhotoUrl">Meal photo url</label>
              <input className="fdx-input" id="fdxPhotoUrl" type="text" disabled aria-disabled="true" placeholder="In Development" />
              <button className="fdx-file-btn" type="button" disabled aria-disabled="true">Choose file</button>
              <span className="fdx-indev-note">In Development</span>
            </div>
          </div>

          <label className="fdx-label" htmlFor="fdxWhat">What did you eat?</label>
          <textarea className="fdx-input fdx-textarea" id="fdxWhat" rows={2} placeholder="e.g. Grilled chicken salad with avocado" maxLength={2000}
                    value={form.what} onChange={(event) => onWhat(event.target.value)} />

          <label className="fdx-label" htmlFor="fdxTime">Time you ate <span className="fdx-req">(required)</span></label>
          <input className="fdx-input fdx-time" id="fdxTime" type="time" required value={form.time}
                 onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, time: value })); }} />

          {/* Deterministic macro ESTIMATE from the description (the prototype's
              fixed food table and fallback), clearly labelled. */}
          <div className="fdx-macros" id="fdxMacros" hidden={!macros}>
            <span className="fdx-label">Estimated macros</span>
            <div className="fdx-macro-chips">
              <span className="fdx-chip fdx-chip--p">Protein <b id="fdxMacP">{macros?.protein_g ?? 0}</b>g</span>
              <span className="fdx-chip fdx-chip--c">Carbs <b id="fdxMacC">{macros?.carbs_g ?? 0}</b>g</span>
              <span className="fdx-chip fdx-chip--f">Fat <b id="fdxMacF">{macros?.fat_g ?? 0}</b>g</span>
              <span className="fdx-chip fdx-chip--k"><b id="fdxMacK">{macros?.kcal ?? 0}</b> kcal</span>
            </div>
            <p className="fdx-macro-note">Prototype estimate from your description &mdash; not a nutritional analysis or a live AI service.</p>
          </div>

          <fieldset className="fdx-feelings">
            <legend className="fdx-label">How did you feel before you ate? <span className="fdx-req">&mdash; choose all that apply</span></legend>
            <div className="fdx-feel-grid" id="fdxFeelings">
              {(day?.feelings ?? FEELINGS).map((feeling) => {
                const on = feelings.includes(feeling);
                return (
                  <button key={feeling} className={`fdx-feel${on ? " on" : ""}`} type="button" data-feel={feeling} aria-pressed={on}
                          onClick={() => toggleFeeling(feeling)}>{feeling}</button>
                );
              })}
            </div>
          </fieldset>

          <label className="fdx-label" htmlFor="fdxNotes">Any other notes</label>
          <textarea className="fdx-input fdx-textarea" id="fdxNotes" rows={2} placeholder="Anything worth remembering about this meal" maxLength={2000}
                    value={form.notes} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, notes: value })); }} />

          <button className="btn-primary fdx-add" id="fdxAdd" type="button" onClick={() => void submit()}>{editing ? "Update Entry" : "Add Entry"}</button>
          <p className="fdx-err" id="fdxErr" role="alert" hidden={!error}>{error}</p>
        </section>

        {/* ================= right: the day ================= */}
        <section ref={rightRef} className={`fdx-panel fdx-right${rightReveal}`} aria-labelledby="fdxRightTitle">
          <div className="fdx-day-head">
            <h2 className="fdx-panel-title" id="fdxRightTitle">Your day</h2>
            <div className="fdx-date-nav">
              <button className="fdx-date-arrow" id="fdxPrevDay" type="button" aria-label="Previous day" onClick={() => goTo(shift(date, -1))}>&lsaquo;</button>
              <input className="fdx-input fdx-date" id="fdxDate" type="date" aria-label="Diary date" value={date}
                     onChange={(event) => { if (event.target.value) goTo(event.target.value); }} />
              <button className="fdx-date-arrow" id="fdxNextDay" type="button" aria-label="Next day" onClick={() => goTo(shift(date, 1))}>&rsaquo;</button>
            </div>
          </div>

          <div className="fdx-summary" id="fdxSummary" aria-live="polite">
            {/* one text node per run, as the prototype's innerHTML has, so the text shapes (kerns) identically */}
            {meals.length > 0 && totals && <><b>{meals.length}</b>{` meal${meals.length === 1 ? "" : "s"} logged · Protein `}<b>{`${totals.protein_g}g`}</b>{" · Carbs "}<b>{`${totals.carbs_g}g`}</b>{" · Fat "}<b>{`${totals.fat_g}g`}</b>{" · "}<b>{totals.kcal}</b>{" kcal "}<span className="fdx-summary-note">(prototype estimates)</span></>}
          </div>

          <div className="fdx-empty" id="fdxEmpty" hidden={meals.length > 0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11.6 5.2C9.3 3.1 6.1 2.2 3.9 2.3 2.4 2.4 1.3 2.9 1.3 3.9v12.9c0 .9 1.1 1.3 2.6 1.6 3.1.6 6 1.5 7.7 2 1.7-.5 4.6-1.4 7.7-2 1.5-.3 2.6-.7 2.6-1.6V3.9c0-1-1.1-1.5-2.6-1.6-2.2-.1-5.4.8-7.7 2.9z" /><path d="M11.6 5.2v15.2" /></svg>
            <p>No entries for the day, start logging in.</p>
          </div>

          <div className="fdx-meals" id="fdxMeals" data-testid="diary-meals">
            {meals.map((meal, i) => (
              <article className="fdx-meal" key={meal.id}>
                <div className="fdx-meal-top">
                  <span className="fdx-meal-time">{meal.meal_time}</span>
                  <span className="fdx-meal-macros">{`P ${meal.protein_g}g · C ${meal.carbs_g}g · F ${meal.fat_g}g · ${meal.kcal} kcal`}</span>
                </div>
                <p className="fdx-meal-what">{meal.description}</p>
                {meal.feelings.length > 0 && <div className="fdx-meal-feels">{meal.feelings.map((f) => <span key={f}>{f}</span>)}</div>}
                {meal.notes && <p className="fdx-meal-notes">{meal.notes}</p>}
                <div className="fdx-meal-actions">
                  <button className="fdx-meal-btn" data-fdx-edit={i} type="button" onClick={() => startEdit(meal)}>Edit</button>
                  <button className="fdx-meal-btn fdx-meal-btn--danger" data-fdx-rm={i} type="button" onClick={() => void remove(meal)}>Remove</button>
                </div>
              </article>
            ))}
          </div>

          <div className="fdx-day-actions">
            <button className="btn-ghost fdx-action" id="fdxFeedback" type="button" onClick={() => void askFeedback()}>Give me feedback</button>
            <button className="btn-primary fdx-action" id="fdxSaveDay" type="button" onClick={() => void saveDay()}>Save</button>
            <button className="btn-ghost fdx-action" id="fdxHistoryBtn" type="button" aria-expanded={historyOpen} aria-controls="fdxHistory"
                    onClick={() => setHistoryOpen((open) => !open)}>History</button>
          </div>
          <p className="fdx-savednote" id="fdxSavedNote" role="status" hidden={!savedNote}>Day saved.</p>

          <div className="fdx-feedback-out" id="fdxFeedbackOut" hidden={feedback === null}>
            <p id="fdxFeedbackText">{feedback}</p>
            <p className="fdx-macro-note">Prototype-generated feedback &mdash; based on fixed rules over your saved entries, not a live AI service.</p>
          </div>

          <div className="fdx-history" id="fdxHistory" hidden={!historyOpen}>
            <h3>History</h3>
            <div id="fdxHistoryDays">
              {day && day.history.length > 0 ? day.history.map((row) => (
                <button className="fdx-hist-row" key={row.entry_date} data-fdx-day={row.entry_date} type="button"
                        onClick={() => { setDate(row.entry_date); setHistoryOpen(false); }}>
                  <b>{row.entry_date}</b><span>{`${row.meals} meal${row.meals === 1 ? "" : "s"} · ~${row.kcal} kcal${row.saved ? " · saved" : ""}`}</span>
                </button>
              )) : <p className="fdx-macro-note">No saved days yet.</p>}
            </div>
            {/* The prototype's read-only "earlier entries" table holds rows from
                its retired browser-only format; the application never had
                that format, so the block stays empty and hidden. */}
            <div id="fdxHistoryLegacy" hidden>
              <h4>Earlier diary entries</h4>
              <p className="fdx-macro-note">Saved in the previous table format and kept exactly as written.</p>
              <div className="fdx-legacy-table" id="fdxLegacyRows" />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
