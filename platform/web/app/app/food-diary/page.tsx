"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { ask } from "@/components/confirm-dialog";
import { DiaryCalendar } from "@/components/member/diary-calendar";
import { useToast } from "@/components/member/member-chrome";
import { useExitGhost } from "@/components/use-exit-ghost";
import { useModalDialog } from "@/components/use-modal-dialog";
import dialog from "@/components/avatar-crop-dialog.module.css";
import { addDays, isDayKey, shortDay } from "@/lib/diary-dates";
import {
  addMeal, addMealPhoto, addMealPhotoFromLink, estimateMacros, getDiaryDay, getDiaryFeedback, localDateKey, mealPhotoUrl,
  removeMeal, removeMealPhoto, saveDiaryDay, updateMeal,
  type DiaryDay, type DiaryHistoryDay, type Macros, type Meal,
} from "@/lib/member-api";
import { prefersReducedMotion } from "@/lib/member-format";
import "../prototype-type.css";

/* The approved Food Diary (build/dashboard.html, #view-food-diary), reproduced
   element for element: log a meal on the left — the photo row, what you ate
   with the live prototype macro estimate, the required time, how you felt and
   notes — and the day on the right with its date switcher, the summary, Give
   me feedback, Save and History. Every value is read from and written to the
   member's account; the estimate and the feedback are the prototype's own
   rules, calculated by the API.

   The photo row works since 15 Nov 2026 (it said "In Development"): Snap a
   photo (the phone's camera, or the webcam on a computer), Choose file, or a
   link the API fetches once and keeps its own copy of — the browser never
   loads the link itself. The meal is saved first and its photo after, so a
   refused photo never loses the meal.

   History is a list or a month (25 Nov 2026). The open day is in the address,
   so a reload and the Back button come back to it; which view was open is kept
   for this tab only. */

const CameraCapture = dynamic(() => import("@/components/member/camera-capture").then((m) => m.CameraCapture), { ssr: false });

const FEELINGS = ["Hungry", "Very hungry", "Not hungry", "Stressed", "Relaxed", "Tired", "Energized", "Rushed", "Bored"];
const EMPTY = { what: "", time: "", notes: "" };
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 10_000_000;

type PendingPhoto = { blob: Blob; name: string; url: string };

/** A phone or tablet opens its own camera from the file input; a computer gets the webcam dialog. */
function prefersNativeCamera(): boolean {
  return window.matchMedia?.("(pointer: coarse)").matches || !navigator.mediaDevices?.getUserMedia;
}

/** The day in the address, if it is one. */
function dayInAddress(): string {
  const asked = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("date");
  return isDayKey(asked) ? asked : localDateKey();
}

// How History was left, for this tab. A convenience: nothing depends on it.
type HistoryView = { open: boolean; view: "list" | "calendar" };
const VIEW_KEY = "veye_diary_history";
function keptView(): HistoryView {
  try {
    const kept = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null") as Partial<HistoryView> | null;
    return { open: kept?.open === true, view: kept?.view === "calendar" ? "calendar" : "list" };
  } catch { return { open: false, view: "list" }; }
}
function keepView(view: HistoryView) {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* it is only remembered, never needed */ }
}

const said = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

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
  return <Suspense fallback={null}><FoodDiary /></Suspense>;
}

function FoodDiary() {
  const inAddress = useSearchParams().get("date");
  const [leftRef, leftReveal] = useReveal("left");
  const [rightRef, rightReveal] = useReveal("right");
  const toast = useToast();
  const today = localDateKey();
  const [date, setDate] = useState(dayInAddress);
  const [day, setDay] = useState<DiaryDay | null>(null);
  // Every logged or saved day, kept while another day loads so neither the
  // list nor the month empties in between.
  const [days, setDays] = useState<DiaryHistoryDay[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const [feelings, setFeelings] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [macros, setMacros] = useState<Macros | null>(null);
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryView>(keptView);
  const [acting, setActing] = useState<string | null>(null);   // the button waiting for its answer
  // The photo that goes with the entry being written: a file or snapshot
  // (shown from the device), or a link (fetched by the API on save).
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const [link, setLink] = useState("");
  const [dropPhoto, setDropPhoto] = useState(false);
  const [camera, setCamera] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<Meal | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const estimateTurn = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = useRef(date);
  const body = useRef<HTMLDivElement>(null);
  const dayTitle = useRef<HTMLHeadingElement>(null);
  const [hold, setHold] = useState(0);      // the day's height, kept while the next one loads

  // renderFdxDay: a new day (or a changed one) hides the previous feedback. An
  // answer about a day that is no longer open updates History and nothing else.
  const show = useCallback((next: DiaryDay) => {
    setDays(next.history);
    if (next.entry_date !== open.current) return;
    setDay(next);
    setFeedback(null);
    setHold(0);
  }, []);

  useEffect(() => {
    let live = true;
    open.current = date;
    setLoadError("");
    setFeedback(null);      // what was said of the last day is not said of this one
    setSavedNote(false);
    getDiaryDay(date)
      .then((next) => { if (live) show(next); })
      .catch((reason) => { if (live) { setLoadError(said(reason, "Your diary could not be loaded.")); setHold(0); } });
    return () => { live = false; };
  }, [date, attempt, show]);

  // The open day is in the address, without a step in the browser's history
  // for every day looked at.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (date === localDateKey()) url.searchParams.delete("date"); else url.searchParams.set("date", date);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [date, inAddress]);

  useEffect(() => { keepView(history); }, [history]);

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

  /* Opening another day. A meal that is being written keeps what was typed (it
     has no day until it is added, and the form says which day that will be). A
     meal that is being EDITED belongs to this day: leaving it asks first, if
     anything was changed, and then takes its words out of the form with it. */
  async function goTo(next: string): Promise<boolean> {
    if (next === date || saving) return false;
    if (editing) {
      if (editChanged() && !(await ask({
        title: "Leave without saving this meal?", text: "What you changed has not been saved yet.",
        confirm: "Leave without saving", cancel: "Keep editing", danger: true }))) {
        document.getElementById("fdxWhat")?.focus();
        return false;
      }
      stopEditing();
      clearForm();
    }
    setHold(body.current?.offsetHeight ?? 0);
    setDate(next);
    return true;
  }

  function editChanged(): boolean {
    const meal = editingMeal;
    if (!meal) return false;
    return form.what !== meal.description || form.time !== meal.meal_time || form.notes !== meal.notes
      || feelings.length !== meal.feelings.length || feelings.some((f) => !meal.feelings.includes(f))
      || pending !== null || link.trim() !== "" || dropPhoto;
  }

  function clearForm() {
    setForm(EMPTY);
    setFeelings([]);
    estimateTurn.current++;
    setMacros(null);
    setError("");
  }

  /** From the month: the day opens above it, so bring its title into view if it is not. */
  async function openFromCalendar(next: string, byPointer: boolean) {
    const opened = next === date || await goTo(next);
    if (opened && byPointer) dayTitle.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  // ---- the photo row ----------------------------------------------------------
  const clearPending = useCallback(() => {
    setPending((current) => { if (current) URL.revokeObjectURL(current.url); return null; });
  }, []);
  useEffect(() => () => clearPending(), [clearPending]);

  function resetPhoto() {
    clearPending();
    setLink("");
    setDropPhoto(false);
  }

  function takePhoto(blob: Blob, name: string) {
    setError("");
    if (!PHOTO_TYPES.includes(blob.type)) { setError("Please choose a JPG, PNG or WebP image."); return; }
    if (blob.size > PHOTO_MAX_BYTES) { setError("The photo is too large. Please use an image under 10 MB."); return; }
    clearPending();
    setPending({ blob, name, url: URL.createObjectURL(blob) });
    setLink("");          // the last thing chosen is the photo
    setDropPhoto(false);
  }

  function fromInput(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (file) takePhoto(file, file.name);
  }

  function snap() {
    if (prefersNativeCamera()) captureInput.current?.click();
    else setCamera(true);
  }

  function onLink(value: string) {
    setLink(value);
    if (value.trim()) { clearPending(); setDropPhoto(false); }
  }

  /* A photo chosen while editing belongs to that meal: leaving the edit must
     not carry it, or "remove photo", onto the next meal written. */
  function stopEditing() {
    if (editing) resetPhoto();
    setEditing(null);
  }

  const editingMeal = editing ? (day?.meals.find((meal) => meal.id === editing) ?? null) : null;

  async function startEdit(meal: Meal) {
    if (editing && editing !== meal.id && editChanged() && !(await ask({
      title: "Leave without saving this meal?", text: "What you changed in the other meal has not been saved yet.",
      confirm: "Leave without saving", cancel: "Keep editing", danger: true }))) return;
    setEditing(meal.id);
    setForm({ what: meal.description, time: meal.meal_time, notes: meal.notes });
    setFeelings(meal.feelings);
    resetPhoto();
    preview(meal.description);
    document.getElementById("fdxWhat")?.focus();
  }

  async function submit() {
    const what = form.what.trim();
    if (!what) { setError("Describe what you ate first."); document.getElementById("fdxWhat")?.focus(); return; }
    if (!form.time) { setError("The time you ate is required."); document.getElementById("fdxTime")?.focus(); return; }
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const input = { entry_date: date, meal_time: form.time, description: what, feelings, notes: form.notes.trim() };
      let next = editing ? await updateMeal(editing, input) : await addMeal(input);
      // The API says which entry it made. Guessing it from the list once put a
      // photo on a meal logged from another device.
      const id = editing ?? next.created_id ?? null;
      // The meal is saved; now its photo. A refused photo keeps the meal and
      // leaves the form on it, so the link or file can be fixed and updated.
      try {
        if (id && pending) next = await addMealPhoto(id, pending.blob, pending.name);
        else if (id && link.trim()) next = await addMealPhotoFromLink(id, link.trim());
        else if (id && editing && dropPhoto) next = await removeMealPhoto(id);
      } catch (reason) {
        show(next);
        setEditing(id);
        const removing = !pending && !link.trim();
        setError(`Your meal is saved, but the photo was not ${removing ? "removed" : "added"}: ${reason instanceof Error ? reason.message : "please try again."}`);
        return;
      }
      show(next);
      toast.flash(editing ? "Meal updated" : "Meal added");
      setEditing(null);
      resetPhoto();
      clearForm();
    } catch (reason) {
      setError(said(reason, "The entry could not be saved."));
    } finally { busy.current = false; setSaving(false); }
  }

  /** One press, one request: a second one waits for the first to be answered. */
  async function act(name: string, work: () => Promise<void>, problem: string) {
    if (busy.current) return;
    busy.current = true;
    setActing(name);
    try { await work(); }
    catch (reason) { setError(said(reason, problem)); }
    finally { busy.current = false; setActing(null); }
  }

  const remove = (meal: Meal) => act(`remove:${meal.id}`, async () => {
    show(await removeMeal(meal.id));
    if (editing === meal.id) { stopEditing(); clearForm(); }
    toast.flash("Meal removed");
  }, "The entry could not be removed.");

  const saveDay = () => act("save", async () => {
    const next = await saveDiaryDay(date);
    setDays(next.history);
    if (next.entry_date === open.current) setDay(next);
    setSavedNote(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedNote(false), 2200);
  }, "The day could not be saved.");

  const askFeedback = () => act("feedback", async () => {
    const asked = date;
    const { text } = await getDiaryFeedback(asked);
    if (asked === open.current) setFeedback(text);
  }, "Feedback is not available right now.");

  const ready = day?.entry_date === date;
  const waiting = !ready && !loadError;
  const meals = ready ? day.meals : [];
  const totals = ready ? day.totals : null;

  return (
    <>
      <h1 className="fd-title">Food Diary</h1>
      <p className="fdx-blurb">Note the time, macronutrient content, and how you felt before you ate on the left, and your day summary will update on the right.</p>
      <p className="fdx-blurb fdx-visible" data-testid="diary-visible">The Veye team can see your food diary and its photos, so they can help you.</p>

      <div className="fdx-layout">
        {/* ================= left: log a meal ================= */}
        {/* inert while saving: what is typed during a slow photo fetch would be cleared with the form */}
        <section ref={leftRef} className={`fdx-panel fdx-left${leftReveal}`} aria-labelledby="fdxLeftTitle" inert={saving}>
          <h2 className="fdx-panel-title" id="fdxLeftTitle">Log a meal</h2>

          <div className="fdx-photo">
            <button className="fdx-photo-btn" type="button" onClick={snap} data-testid="diary-snap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V9.5A1.5 1.5 0 0 1 4 8z" /><circle cx="12" cy="14" r="3.6" /></svg>
              Snap a photo
            </button>
            <div className="fdx-photo-sub">
              <label className="fdx-label fdx-label--muted" htmlFor="fdxPhotoUrl">Meal photo url</label>
              <input className="fdx-input" id="fdxPhotoUrl" type="url" inputMode="url" autoComplete="off" placeholder="Paste a link to a picture"
                     maxLength={2048} value={link} onChange={(event) => onLink(event.target.value)} data-testid="diary-photo-link" />
              <button className="fdx-file-btn" type="button" onClick={() => fileInput.current?.click()}>Choose file</button>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden
                     onChange={(event) => fromInput(event.currentTarget)} data-testid="diary-photo-file" />
              <input ref={captureInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden
                     onChange={(event) => fromInput(event.currentTarget)} data-testid="diary-photo-capture" />
            </div>
            {(pending || link.trim() || (editingMeal?.photo_version && !dropPhoto) || dropPhoto) && (
              <div className="fdx-photo-preview" data-testid="diary-photo-pending">
                {pending ? (
                  <><img src={pending.url} alt="The photo for this meal" /><p>Added when you {editing ? "update" : "add"} the entry.</p>
                    <button className="fdx-photo-clear" type="button" onClick={clearPending}>Remove</button></>
                ) : link.trim() ? (
                  <><p>Veye fetches the picture at this link and keeps its own copy when you {editing ? "update" : "add"} the entry.</p>
                    <button className="fdx-photo-clear" type="button" onClick={() => setLink("")}>Remove</button></>
                ) : dropPhoto ? (
                  <><p>The photo will be removed when you update the entry.</p>
                    <button className="fdx-photo-clear" type="button" onClick={() => setDropPhoto(false)}>Keep it</button></>
                ) : editingMeal?.photo_version ? (
                  <><img src={mealPhotoUrl(editingMeal.id, editingMeal.photo_version)} alt="This meal's photo" />
                    <p>This meal&rsquo;s photo. Choose another to replace it.</p>
                    <button className="fdx-photo-clear" type="button" onClick={() => setDropPhoto(true)}>Remove photo</button></>
                ) : null}
              </div>
            )}
          </div>
          {camera && (
            <CameraCapture onCancel={() => setCamera(false)}
                           onUse={(photo) => { setCamera(false); takePhoto(photo, "camera.jpg"); }}
                           onChooseFile={() => { setCamera(false); fileInput.current?.click(); }} />
          )}

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

          {date !== today && (
            <p className="fdx-macro-note fdx-target" data-testid="diary-target">{editing ? "From" : "This will be added to"} {shortDay(date)}.</p>
          )}
          <button className="btn-primary fdx-add" id="fdxAdd" type="button" disabled={saving} aria-busy={saving} onClick={() => void submit()}>{saving ? "Saving…" : editing ? "Update Entry" : "Add Entry"}</button>
          <p className="fdx-err" id="fdxErr" role="alert" hidden={!error}>{error}</p>
        </section>

        {/* ================= right: the day ================= */}
        <section ref={rightRef} className={`fdx-panel fdx-right${rightReveal}`} aria-labelledby="fdxRightTitle">
          <div className="fdx-day-head">
            <h2 className="fdx-panel-title" id="fdxRightTitle" ref={dayTitle}>Your day</h2>
            <div className="fdx-date-nav">
              <button className="fdx-date-arrow" id="fdxPrevDay" type="button" aria-label="Previous day" onClick={() => void goTo(addDays(date, -1))}>&lsaquo;</button>
              <input className="fdx-input fdx-date" id="fdxDate" type="date" aria-label="Diary date" value={date}
                     onChange={(event) => { if (isDayKey(event.target.value)) void goTo(event.target.value); }} />
              <button className="fdx-date-arrow" id="fdxNextDay" type="button" aria-label="Next day" onClick={() => void goTo(addDays(date, 1))}>&rsaquo;</button>
            </div>
          </div>

          {/* The day, and only this day: nothing of the last one stays while it
              loads, and the panel keeps its height so nothing jumps. */}
          <div className="fdx-daybody" ref={body} style={hold ? { minHeight: hold } : undefined} aria-busy={waiting} data-testid="diary-day" data-day={date}>
          {waiting && <DaySkeleton />}
          {loadError && (
            <div className="fdx-loaderr" role="alert">
              <p>{loadError}</p>
              <button className="btn-ghost fdx-action" type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            </div>
          )}

          <div className="fdx-summary" id="fdxSummary" aria-live="polite">
            {/* one text node per run, as the prototype's innerHTML has, so the text shapes (kerns) identically */}
            {meals.length > 0 && totals && <><b>{meals.length}</b>{` meal${meals.length === 1 ? "" : "s"} logged · Protein `}<b>{`${totals.protein_g}g`}</b>{" · Carbs "}<b>{`${totals.carbs_g}g`}</b>{" · Fat "}<b>{`${totals.fat_g}g`}</b>{" · "}<b>{totals.kcal}</b>{" kcal "}<span className="fdx-summary-note">(prototype estimates)</span></>}
          </div>

          <div className="fdx-empty" id="fdxEmpty" hidden={!ready || meals.length > 0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11.6 5.2C9.3 3.1 6.1 2.2 3.9 2.3 2.4 2.4 1.3 2.9 1.3 3.9v12.9c0 .9 1.1 1.3 2.6 1.6 3.1.6 6 1.5 7.7 2 1.7-.5 4.6-1.4 7.7-2 1.5-.3 2.6-.7 2.6-1.6V3.9c0-1-1.1-1.5-2.6-1.6-2.2-.1-5.4.8-7.7 2.9z" /><path d="M11.6 5.2v15.2" /></svg>
            <p>No entries for the day, start logging in.</p>
          </div>

          <div className="fdx-meals" id="fdxMeals" data-testid="diary-meals">
            {meals.map((meal, i) => (
              <article className={`fdx-meal${editing === meal.id ? " is-editing" : ""}`} key={meal.id}>
                <div className="fdx-meal-top">
                  <span className="fdx-meal-time">{meal.meal_time}</span>
                  <span className="fdx-meal-macros">{`P ${meal.protein_g}g · C ${meal.carbs_g}g · F ${meal.fat_g}g · ${meal.kcal} kcal`}</span>
                </div>
                <p className="fdx-meal-what">{meal.description}</p>
                {meal.photo_version && (
                  <button className="fdx-meal-photo" type="button" onClick={() => setViewing(meal)} data-testid="diary-meal-photo"
                          aria-label={`Open the photo of: ${meal.description}`}>
                    <img src={mealPhotoUrl(meal.id, meal.photo_version)} alt="" loading="lazy" />
                  </button>
                )}
                {meal.feelings.length > 0 && <div className="fdx-meal-feels">{meal.feelings.map((f) => <span key={f}>{f}</span>)}</div>}
                {meal.notes && <p className="fdx-meal-notes">{meal.notes}</p>}
                <div className="fdx-meal-actions">
                  <button className="fdx-meal-btn" data-fdx-edit={i} type="button" disabled={acting !== null || saving} onClick={() => void startEdit(meal)}>Edit</button>
                  <button className="fdx-meal-btn fdx-meal-btn--danger" data-fdx-rm={i} type="button" disabled={acting !== null || saving} aria-busy={acting === `remove:${meal.id}`}
                          onClick={() => void remove(meal)}>{acting === `remove:${meal.id}` ? "Removing…" : "Remove"}</button>
                </div>
              </article>
            ))}
          </div>
          </div>

          <div className="fdx-day-actions">
            <button className="btn-ghost fdx-action" id="fdxFeedback" type="button" disabled={!ready || acting !== null} aria-busy={acting === "feedback"} onClick={() => void askFeedback()}>Give me feedback</button>
            <button className="btn-primary fdx-action" id="fdxSaveDay" type="button" disabled={!ready || acting !== null} aria-busy={acting === "save"} onClick={() => void saveDay()}>Save</button>
            <button className="btn-ghost fdx-action" id="fdxHistoryBtn" type="button" aria-expanded={history.open} aria-controls="fdxHistory"
                    onClick={() => setHistory((now) => ({ ...now, open: !now.open }))}>History</button>
          </div>
          <p className="fdx-savednote" id="fdxSavedNote" role="status" hidden={!savedNote}>Day saved.</p>

          <div className="fdx-feedback-out" id="fdxFeedbackOut" hidden={feedback === null}>
            <p id="fdxFeedbackText">{feedback}</p>
            <p className="fdx-macro-note">Prototype-generated feedback &mdash; based on fixed rules over your saved entries, not a live AI service.</p>
          </div>

          <div className="fdx-history" id="fdxHistory" hidden={!history.open}>
            <div className="fdx-history-head">
              <h3>History</h3>
              <div className="fdx-views" role="group" aria-label="Show history as">
                <button className="fdx-view" type="button" aria-label="List view" title="List view" aria-pressed={history.view === "list"}
                        onClick={() => setHistory({ open: true, view: "list" })} data-testid="diary-view-list">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" /></svg>
                </button>
                <button className="fdx-view" type="button" aria-label="Calendar view" title="Calendar view" aria-pressed={history.view === "calendar"}
                        onClick={() => setHistory({ open: true, view: "calendar" })} data-testid="diary-view-calendar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 9.8h17M8 3v4M16 3v4M8 13.6h.01M12 13.6h.01M16 13.6h.01M8 16.8h.01M12 16.8h.01" /></svg>
                </button>
              </div>
            </div>
            {/* Mounted once it has been asked for, so the month opens on the day that is open. */}
            {history.open && history.view === "calendar" && (
              <DiaryCalendar selected={date} today={today} days={days} onSelect={(next, byPointer) => void openFromCalendar(next, byPointer)} />
            )}
            <div id="fdxHistoryDays" className="fdx-history-days" hidden={history.view !== "list"}>
              {days && days.length > 0 ? days.map((row) => (
                <button className={`fdx-hist-row${row.entry_date === date ? " is-open" : ""}`} key={row.entry_date} data-fdx-day={row.entry_date} type="button"
                        aria-current={row.entry_date === date ? "date" : undefined}
                        onClick={() => void goTo(row.entry_date).then((opened) => { if (opened || row.entry_date === date) setHistory((now) => ({ ...now, open: false })); })}>
                  <b>{row.entry_date}</b><span>{`${row.meals} meal${row.meals === 1 ? "" : "s"} · ~${row.kcal} kcal${row.saved ? " · saved" : ""}`}</span>
                </button>
              )) : days && <p className="fdx-macro-note">No saved days yet.</p>}
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
      {viewing?.photo_version && <PhotoViewer meal={viewing} version={viewing.photo_version} onClose={() => setViewing(null)} />}
    </>
  );
}

/* The shape of a day, once it has been worth waiting for: a day that answers at
   once is never preceded by a flash of grey. */
function DaySkeleton() {
  return (
    <div className="fdx-wait" role="status">
      <span className="sr-status">Opening the day…</span>
      <span className="skel" aria-hidden="true" /><span className="skel" aria-hidden="true" />
    </div>
  );
}

/* A meal's photo at full size, over the page. */
function PhotoViewer({ meal, version, onClose }: { meal: Meal; version: string; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  useModalDialog(true, card, onClose, "[data-photo-close]");
  useExitGhost(overlay);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={dialog.overlay} ref={overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={dialog.card} ref={card} role="dialog" aria-modal="true" aria-label={`Photo of ${meal.description}`} data-testid="diary-photo-view">
        <img src={mealPhotoUrl(meal.id, version, "full")} alt={meal.description} style={{ width: "100%", borderRadius: 12, display: "block" }} />
        <p className={dialog.sub} style={{ marginTop: 12, marginBottom: 0 }}>{`${meal.meal_time} · ${meal.description}`}</p>
        <div className={dialog.actions}>
          <button type="button" className="btn-primary" onClick={onClose} data-photo-close>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
