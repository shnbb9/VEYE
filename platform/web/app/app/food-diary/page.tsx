"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/member/member-chrome";
import { addMeal, getDiaryDay, localDateKey, removeMeal, updateMeal, type DiaryDay, type Meal } from "@/lib/member-api";

/* The approved Food Diary (build/dashboard.html, #view-food-diary): log a meal
   on the left — what, the required time, how you felt before eating, notes —
   and read the day on the right with a date switcher and History. Entries
   persist per member on the server. The prototype's keyword "macro
   estimates" and rule-based feedback were labelled placeholders and how the
   Companion should analyse entries is an open client question, so this
   screen records and shows entries and says so honestly. */

const EMPTY = { description: "", meal_time: "", feelings: [] as string[], notes: "" };

export default function FoodDiaryPage() {
  const toast = useToast();
  const [date, setDate] = useState(localDateKey());
  const [day, setDay] = useState<DiaryDay | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Meal | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async (key: string) => {
    try { setDay(await getDiaryDay(key)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Your diary could not be loaded."); }
  }, []);
  useEffect(() => { void load(date); }, [date, load]);

  function shiftDay(delta: number) {
    const [y, m, d] = date.split("-").map(Number);
    setDate(localDateKey(new Date(y, m - 1, d + delta)));
  }

  function toggleFeeling(feeling: string) {
    setForm((current) => ({ ...current, feelings: current.feelings.includes(feeling) ? current.feelings.filter((f) => f !== feeling) : [...current.feelings, feeling] }));
  }

  function startEdit(meal: Meal) {
    setEditing(meal);
    setForm({ description: meal.description, meal_time: meal.meal_time, feelings: meal.feelings, notes: meal.notes });
    setError("");
    document.getElementById("fdxWhat")?.focus();
  }

  async function submit() {
    setError("");
    if (!form.description.trim()) { setError("Please describe what you ate."); return; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.meal_time)) { setError("Please enter the time you ate."); return; }
    setBusy(true);
    try {
      const input = { entry_date: date, meal_time: form.meal_time, description: form.description.trim(), feelings: form.feelings, notes: form.notes.trim() };
      setDay(editing ? await updateMeal(editing.id, input) : await addMeal(input));
      setForm(EMPTY);
      setEditing(null);
      toast.flash(editing ? "Entry updated" : "Entry added");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The entry could not be saved.");
    } finally { setBusy(false); }
  }

  async function remove(meal: Meal) {
    try {
      setDay(await removeMeal(meal.id));
      if (editing?.id === meal.id) { setEditing(null); setForm(EMPTY); }
      toast.flash("Entry removed");
    } catch (reason) {
      toast.flash(reason instanceof Error ? reason.message : "The entry could not be removed");
    }
  }

  const meals = day?.meals ?? [];
  const feelings = day?.feelings ?? ["Hungry", "Very hungry", "Not hungry", "Stressed", "Relaxed", "Tired", "Energized", "Rushed", "Bored"];

  return (
    <>
      <h1 className="fd-title">Food Diary</h1>
      <p className="fdx-blurb">Note the time, what you ate and how you felt before you ate on the left, and your day summary will update on the right.</p>

      <div className="fdx-layout">
        <section className="fdx-panel fdx-left" aria-labelledby="fdxLeftTitle">
          <h2 className="fdx-panel-title" id="fdxLeftTitle">{editing ? "Edit this meal" : "Log a meal"}</h2>

          <div className="fdx-photo">
            <button className="fdx-photo-btn" type="button" disabled aria-disabled="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V9.5A1.5 1.5 0 0 1 4 8z" /><circle cx="12" cy="14" r="3.6" /></svg>
              Snap a photo
              <span className="fdx-indev-tag">Not connected yet</span>
            </button>
            <p className="fdx-macro-note">Meal photos need a client decision on storage and review before they are collected.</p>
          </div>

          <label className="fdx-label" htmlFor="fdxWhat">What did you eat?</label>
          <textarea className="fdx-input fdx-textarea" id="fdxWhat" rows={2} placeholder="e.g. Grilled chicken salad with avocado" value={form.description}
                    onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, description: value })); }} maxLength={2000} />

          <label className="fdx-label" htmlFor="fdxTime">Time you ate <span className="fdx-req">(required)</span></label>
          <input className="fdx-input fdx-time" id="fdxTime" type="time" required value={form.meal_time} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, meal_time: value })); }} />

          <fieldset className="fdx-feelings">
            <legend className="fdx-label">How did you feel before you ate? <span className="fdx-req">&mdash; choose all that apply</span></legend>
            <div className="fdx-feel-grid" id="fdxFeelings">
              {feelings.map((feeling) => (
                <button key={feeling} className={`fdx-feel${form.feelings.includes(feeling) ? " on" : ""}`} type="button" data-feel={feeling}
                        aria-pressed={form.feelings.includes(feeling)} onClick={() => toggleFeeling(feeling)}>{feeling}</button>
              ))}
            </div>
          </fieldset>

          <label className="fdx-label" htmlFor="fdxNotes">Any other notes</label>
          <textarea className="fdx-input fdx-textarea" id="fdxNotes" rows={2} placeholder="Anything worth remembering about this meal" value={form.notes}
                    onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, notes: value })); }} maxLength={2000} />

          <div className="fdx-form-actions">
            <button className="btn-primary fdx-add" id="fdxAdd" type="button" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : editing ? "Update Entry" : "Add Entry"}</button>
            {editing && <button className="btn-ghost fdx-add" type="button" onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel edit</button>}
          </div>
          {error && <p className="fdx-err" id="fdxErr" role="alert">{error}</p>}
        </section>

        <section className="fdx-panel fdx-right" aria-labelledby="fdxRightTitle">
          <div className="fdx-day-head">
            <h2 className="fdx-panel-title" id="fdxRightTitle">Your day</h2>
            <div className="fdx-date-nav">
              <button className="fdx-date-arrow" id="fdxPrevDay" type="button" aria-label="Previous day" onClick={() => shiftDay(-1)}>&lsaquo;</button>
              <input className="fdx-input fdx-date" id="fdxDate" type="date" aria-label="Diary date" value={date} max={localDateKey()} onChange={(event) => event.target.value && setDate(event.target.value)} />
              <button className="fdx-date-arrow" id="fdxNextDay" type="button" aria-label="Next day" disabled={date >= localDateKey()} onClick={() => shiftDay(1)}>&rsaquo;</button>
            </div>
          </div>

          <div className="fdx-summary" id="fdxSummary" aria-live="polite">
            {meals.length > 0 && <><b>{meals.length}</b> meal{meals.length === 1 ? "" : "s"} logged &middot; saved to your account</>}
          </div>

          {meals.length === 0 && (
            <div className="fdx-empty" id="fdxEmpty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11.6 5.2C9.3 3.1 6.1 2.2 3.9 2.3 2.4 2.4 1.3 2.9 1.3 3.9v12.9c0 .9 1.1 1.3 2.6 1.6 3.1.6 6 1.5 7.7 2 1.7-.5 4.6-1.4 7.7-2 1.5-.3 2.6-.7 2.6-1.6V3.9c0-1-1.1-1.5-2.6-1.6-2.2-.1-5.4.8-7.7 2.9z" /><path d="M11.6 5.2v15.2" /></svg>
              <p>No entries for the day, start logging in.</p>
            </div>
          )}

          <div className="fdx-meals" id="fdxMeals" data-testid="diary-meals">
            {meals.map((meal) => (
              <article className="fdx-meal" key={meal.id}>
                <div className="fdx-meal-top">
                  <span className="fdx-meal-time">{meal.meal_time}</span>
                </div>
                <p className="fdx-meal-what">{meal.description}</p>
                {meal.feelings.length > 0 && <div className="fdx-meal-feels">{meal.feelings.map((f) => <span key={f}>{f}</span>)}</div>}
                {meal.notes && <p className="fdx-meal-notes">{meal.notes}</p>}
                <div className="fdx-meal-actions">
                  <button className="fdx-meal-btn" type="button" onClick={() => startEdit(meal)}>Edit</button>
                  <button className="fdx-meal-btn fdx-meal-btn--danger" type="button" onClick={() => void remove(meal)}>Remove</button>
                </div>
              </article>
            ))}
          </div>

          <p className="fdx-macro-note">Entries save as you add them. Nutritional analysis and Sprout&rsquo;s feedback on your diary are a client decision still to come &mdash; nothing here estimates macros or judges a meal.</p>

          <div className="fdx-day-actions">
            <button className="btn-ghost fdx-action" id="fdxHistoryBtn" type="button" aria-expanded={historyOpen} aria-controls="fdxHistory" onClick={() => setHistoryOpen((open) => !open)}>
              History{day ? ` (${day.days_logged})` : ""}
            </button>
          </div>

          {historyOpen && (
            <div className="fdx-history" id="fdxHistory">
              <h3>History</h3>
              <div id="fdxHistoryDays">
                {day && day.history.length > 0 ? day.history.map((row) => (
                  <button className="fdx-hist-row" key={row.entry_date} data-fdx-day={row.entry_date} type="button" onClick={() => { setDate(row.entry_date); setHistoryOpen(false); }}>
                    <b>{row.entry_date}</b><span>{row.meals} meal{row.meals === 1 ? "" : "s"}</span>
                  </button>
                )) : <p className="fdx-macro-note">No saved days yet.</p>}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
