"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/member/member-chrome";
import {
  MEAL_TYPES, assignPlanDay, copySampleDay, createPlanDay, deletePlanDay, duplicatePlanDay, getPlanDays, getSampleDays,
  localDateKey, updatePlanDay, type PlanDay, type PlanDayInput, type PlanMeal, type SampleDay,
} from "@/lib/member-api";
import "../prototype-type.css";

/* The approved Meal Planning (build/dashboard.html, #view-your-days and the
   #dayModal / #assignModal / #sampleModal dialogs), reproduced element for
   element: saved days with View/Edit, Duplicate, Delete, Assign to date and
   Use today; Create a day (Manual, or AI-assisted "In development" with the
   guided prompts); the client's sample days copied into an editable day; and
   the Companion planning that is honestly in development. Every day is
   stored on the member's account. */

type DialogId = "dayModal" | "assignModal" | "sampleModal";

const COMPANION_SOON = "Personalised planning with the Veye Companion is in development — coming in a later phase.";

function defaultMeals(): PlanMeal[] {
  return [
    { name: "Breakfast", type: "Meal", time: "07:00", notes: "" },
    { name: "Lunch", type: "Meal", time: "12:30", notes: "" },
    { name: "Dinner", type: "Meal", time: "18:30", notes: "" },
  ];
}

function fmtTime12(t: string): string {
  const [h, mm] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(mm).padStart(2, "0")} ${ap}`;
}

function daySummary(day: PlanDay): string {
  const sorted = [...day.meals].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const summary = sorted.map((m) => `${m.name} ${m.time || ""}`.trim()).join(", ");
  return `${day.meals.length} meals${summary ? " — " + summary : ""}`;
}

/* The prototype's VeyeDialog: remembers the exact opener, locks the .main
   scroll container, moves focus inside (retrying across animation frames),
   Escape closes the topmost dialog only, Tab / Shift+Tab cycle inside it,
   and closing returns focus to the opener — or to a replacement control when
   the opener was re-rendered away. */
function useVeyeDialogs() {
  const stack = useRef<{ id: DialogId; opener: Element | null }[]>([]);
  const [open, setOpen] = useState<Record<DialogId, boolean>>({ dayModal: false, assignModal: false, sampleModal: false });

  const focusables = useCallback((id: string) => {
    const root = document.getElementById(id);
    if (!root) return [] as HTMLElement[];
    return [...root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")]
      .filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
  }, []);

  const enter = useCallback((id: DialogId, preferSel?: string) => {
    const attempt = (n: number) => {
      const dlg = document.getElementById(id);
      if (!dlg || !dlg.classList.contains("open")) return;
      const target = (preferSel && dlg.querySelector<HTMLElement>(preferSel)) || focusables(id)[0];
      target?.focus();
      if (dlg.contains(document.activeElement)) return;
      if (n < 30) requestAnimationFrame(() => attempt(n + 1));
    };
    requestAnimationFrame(() => requestAnimationFrame(() => attempt(0)));
  }, [focusables]);

  const show = useCallback((id: DialogId, preferSel?: string) => {
    stack.current.push({ id, opener: document.activeElement });
    setOpen((current) => ({ ...current, [id]: true }));
    const main = document.querySelector<HTMLElement>(".main");
    if (main) main.style.overflow = "hidden";
    enter(id, preferSel);
  }, [enter]);

  const close = useCallback((id: DialogId, fallback?: () => HTMLElement | null) => {
    const index = stack.current.map((entry) => entry.id).lastIndexOf(id);
    if (index < 0) return;
    const [record] = stack.current.splice(index, 1);
    setOpen((current) => ({ ...current, [id]: false }));
    if (!stack.current.length) {
      const main = document.querySelector<HTMLElement>(".main");
      if (main) main.style.overflow = "";
    }
    requestAnimationFrame(() => {
      const opener = record.opener as HTMLElement | null;
      if (opener && document.contains(opener) && typeof opener.focus === "function") opener.focus();
      else fallback?.()?.focus();
    });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!stack.current.length) return;
      const id = stack.current[stack.current.length - 1].id;
      if (event.key === "Escape") { event.preventDefault(); close(id); return; }
      if (event.key !== "Tab") return;
      const items = focusables(id);
      if (!items.length) return;
      const dlg = document.getElementById(id);
      const first = items[0], last = items[items.length - 1];
      if (dlg && !dlg.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const main = document.querySelector<HTMLElement>(".main");
      if (main) main.style.overflow = "";
    };
  }, [close, focusables]);

  return { open, show, close, enter };
}

/* Dialogs live outside <main> (portalled to <body>), exactly where the
   prototype relocated them so their fixed overlay never paints below the
   sidebar at the collapsed layout. */
function Overlay({ id, open, onBackdrop, children }: { id: DialogId; open: boolean; onBackdrop: () => void; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.body); }, []);
  if (!host) return null;
  return createPortal(
    <div className={`modal-overlay${open ? " open" : ""}`} id={id} aria-hidden={!open}
         onClick={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onBackdrop(); }}>
      {children}
    </div>,
    host,
  );
}

export default function MealPlanningPage() {
  const router = useRouter();
  const toast = useToast();
  const dialogs = useVeyeDialogs();
  const [days, setDays] = useState<PlanDay[] | null>(null);
  const [samples, setSamples] = useState<SampleDay[]>([]);

  // Create / Edit Day dialog
  const [editId, setEditId] = useState<string | null>(null);
  const [mode, setMode] = useState<"manual" | "ai">("manual");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [describe, setDescribe] = useState("");
  const [meals, setMeals] = useState<PlanMeal[]>(defaultMeals());

  // Assign dialog
  const [assignId, setAssignId] = useState<string | null>(null);
  const [assignDate, setAssignDate] = useState("");

  // Sample-day dialog
  const [sampleStep, setSampleStep] = useState<"type" | "option" | "preview">("type");
  const [sampleType, setSampleType] = useState<number | null>(null);
  const [sampleOption, setSampleOption] = useState(0);

  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    getPlanDays().then((result) => { if (live) setDays(result.days); })
      .catch((reason) => { if (live) toast.flash(reason instanceof Error ? reason.message : "Your days could not be loaded."); });
    getSampleDays().then((result) => { if (live) setSamples(result); }).catch(() => { /* the sample dialog stays empty */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    if (busy.current) return null;
    busy.current = true;
    try { return await action(); }
    catch (reason) { window.alert(reason instanceof Error ? reason.message : "That could not be saved right now."); return null; }
    finally { busy.current = false; }
  }

  // ---- saved days ------------------------------------------------------------
  async function duplicateDay(id: string) {
    const result = await run(() => duplicatePlanDay(id));
    if (!result) return;
    setDays(result.days);
    toast.flash("Template duplicated");
  }

  async function deleteDay(id: string) {
    if (!window.confirm("Delete this day?")) return;
    const result = await run(() => deletePlanDay(id));
    if (result) setDays(result.days);
  }

  async function assignDayToDate(id: string, date: string): Promise<boolean> {
    const result = await run(() => assignPlanDay(id, date));
    if (!result) return false;
    setDays(result.days);
    toast.flash("Day assigned to " + date);
    return true;
  }

  // ---- Create / Edit Day ------------------------------------------------------
  function openDayModal(id?: string) {
    const day = id ? days?.find((d) => d.id === id) : undefined;
    if (id && !day) return;
    setEditId(day ? day.id : null);
    setName(day ? day.name : "");
    setNotes(day ? day.notes || "" : "");
    setDescribe(day ? day.describe || "" : "");
    setMode(day ? day.mode || "manual" : "manual");
    setMeals(day ? day.meals.map((m) => ({ ...m })) : defaultMeals());
    dialogs.show("dayModal", "#dayName");      // create AND edit: Day name
  }

  function setMeal(index: number, patch: Partial<PlanMeal>) {
    setMeals((current) => current.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  async function saveDay() {
    const trimmed = name.trim();
    if (!trimmed) { window.alert("Please give this day a name."); return; }
    if (!meals.length) { window.alert("Please add at least one meal."); return; }
    const input: PlanDayInput = { name: trimmed, notes: notes.trim(), describe: describe.trim(), mode, meals: meals.map((m) => ({ ...m })) };
    const wasEdit = editId !== null;
    const result = await run(() => (editId ? updatePlanDay(editId, input) : createPlanDay(input)));
    if (!result) return;
    setDays(result.days);
    dialogs.close("dayModal");
    toast.flash(wasEdit ? "Day updated" : "Day created");
  }

  // ---- Assign -------------------------------------------------------------------
  function openAssignModal(id: string) {
    const day = days?.find((d) => d.id === id);
    setAssignId(id);
    setAssignDate(day?.assigned_date || localDateKey());
    dialogs.show("assignModal", "#assignDate");
  }

  async function confirmAssign() {
    if (!assignDate || !assignId) return;
    const dayId = assignId;               // survives the re-render below
    if (!(await assignDayToDate(dayId, assignDate))) return;
    // the opener was re-rendered: focus the same day's new Assign action
    dialogs.close("assignModal", () => document.querySelector<HTMLElement>(`.day-card [data-assign="${dayId}"]`));
  }

  // ---- Sample day ------------------------------------------------------------------
  function goSampleStep(step: "type" | "option" | "preview") {
    setSampleStep(step);
    // keyboard flow: land on the step's first control
    dialogs.enter("sampleModal", ".sample-step:not([hidden]) button");
  }

  function openSampleModal() {
    setSampleType(null);
    setSampleOption(0);
    setSampleStep("type");
    dialogs.show("sampleModal");
    dialogs.enter("sampleModal", ".sample-step:not([hidden]) button");
  }

  function chooseSampleType(index: number) {
    setSampleType(index);
    if (samples[index].options.length > 1) goSampleStep("option");
    else { setSampleOption(0); goSampleStep("preview"); }
  }

  async function copySample() {
    if (sampleType === null) return;
    const result = await run(() => copySampleDay(samples[sampleType].key, sampleOption));
    if (!result) return;
    setDays(result.days);
    dialogs.close("sampleModal");
    toast.flash("Sample day copied — open View/Edit to make it yours");
  }

  const toFoodDiary = () => router.push("/app/food-diary");
  const assignDay = days?.find((d) => d.id === assignId);
  const chosen = sampleType !== null ? samples[sampleType] : null;
  const chosenOption = chosen ? chosen.options[sampleOption] : null;
  const loaded = days !== null;
  const hasDays = loaded && days.length > 0;

  return (
    <>
      <header className="progress-hero fade-in">
        <div>
          <h1>Meal Planning</h1>
          <p>Plan and reuse your days, then log meals in your Food Diary.</p>
        </div>
        <div className="days-hero-actions">
          <button className="btn-primary" id="daysCreateBtn" type="button" onClick={() => openDayModal()}><span className="plus">+</span> Create a day</button>
          <button className="btn-ghost" id="daysSampleBtn" type="button" onClick={openSampleModal}>Use a sample day</button>
          <button className="btn-ghost" id="daysBotBtn" type="button" onClick={() => toast.flash(COMPANION_SOON)}><span className="bot-i">&#129302;</span> Plan with Veye Companion</button>
        </div>
      </header>

      <h3 className="days-list-title" id="daysListTitle" hidden={!hasDays}>Saved days</h3>
      <div className="days-grid" id="daysGrid" data-testid="days-grid">
        {hasDays && (days ?? []).map((d) => (
          <div className="day-card" data-id={d.id} key={d.id}>
            <div className="day-card-head">
              <h4>{d.name}</h4>
              <button className="day-edit-icon" data-edit={d.id} type="button" aria-label={`View or edit ${d.name}`} onClick={() => openDayModal(d.id)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2 L 14 5 L 5 14 L 1 15 L 2 11 Z" /></svg>View/Edit
              </button>
            </div>
            <span className={`day-status ${d.assigned_date ? "assigned" : ""}`}>{d.assigned_date ? "Assigned on " + d.assigned_date : "Not assigned"}</span>
            {d.notes ? <div className="day-notes">{d.notes}</div> : null}
            <div className="day-summary">{daySummary(d)}</div>
            <div className="day-actions">
              <button className="day-action" data-dup={d.id} type="button" onClick={() => void duplicateDay(d.id)}>
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3.5" y="3.5" width="8" height="8" rx="1" /><path d="M2 9 V 2 H 9" /></svg>
                Duplicate
              </button>
              <button className="day-action danger" data-del={d.id} type="button" onClick={() => void deleteDay(d.id)}>
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4 H 12 M 5 4 V 2 H 9 V 4 M 4 4 V 12 a 1 1 0 0 0 1 1 H 9 a 1 1 0 0 0 1 -1 V 4" /></svg>
                Delete
              </button>
              <button className="day-action assign" data-assign={d.id} type="button" onClick={() => openAssignModal(d.id)}>
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="10" height="9" rx="1" /><line x1="2" y1="6" x2="12" y2="6" /></svg>
                Assign to date
              </button>
              <button className="day-action" data-today={d.id} type="button" onClick={() => void assignDayToDate(d.id, localDateKey())}>Use today</button>
            </div>
          </div>
        ))}
      </div>

      <div className="days-empty" id="daysEmpty" hidden={!loaded || hasDays}>
        <div className="days-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <line x1="8" y1="3" x2="8" y2="7" />
            <line x1="16" y1="3" x2="16" y2="7" />
            <path d="M8 14 L 10.5 16.5 L 16 11" />
          </svg>
        </div>
        <h2 className="days-empty-title">Create your first day</h2>
        <p className="days-empty-sub">Plan a reusable meal template &mdash; weekday, weekend, travel, anything &mdash; then assign it to any date.</p>
        <div className="days-empty-actions">
          <button className="btn-primary" id="daysEmptyCreate" type="button" onClick={() => openDayModal()}><span className="plus">+</span> Create a day</button>
          <button className="btn-ghost" id="daysEmptySample" type="button" onClick={openSampleModal}>Use a sample day</button>
          <button className="btn-ghost" id="daysEmptyBotBtn" type="button" onClick={() => toast.flash(COMPANION_SOON)}><span className="bot-i">&#129302;</span> Plan with Veye Companion</button>
        </div>
        <button className="days-go-diary" id="daysGoDiary" type="button" onClick={toFoodDiary}>Go to Food Diary &rsaquo;</button>
      </div>

      <div className="days-continue-wrap" id="daysContinueWrap" hidden={!hasDays}>
        <button className="days-continue" id="daysContinue" type="button" onClick={toFoodDiary}>Continue to Food Diary</button>
      </div>

      {/* ---- Create / Edit Day ---- */}
      <Overlay id="dayModal" open={dialogs.open.dayModal} onBackdrop={() => dialogs.close("dayModal")}>
        <div className="modal-card day-modal-card" role="dialog" aria-modal="true" aria-labelledby="dayModalTitle">
          <header className="day-modal-header">
            <h3 id="dayModalTitle">{editId ? "Edit day" : "Create a day"}</h3>
            <button className="modal-close day-modal-close" data-close-day type="button" aria-label="Close" onClick={() => dialogs.close("dayModal")}>&times;</button>
          </header>

          <div className="day-modal-body">
            <div className="day-mode-row">
              <label className={`day-mode-opt${mode === "manual" ? " active" : ""}`} data-mode="manual">
                <input type="radio" name="dayMode" value="manual" checked={mode === "manual"} onChange={() => setMode("manual")} />
                <div>
                  <strong>Manual</strong>
                  <small>Fill in meals and timing yourself.</small>
                </div>
              </label>
              <label className={`day-mode-opt${mode === "ai" ? " active" : ""}`} data-mode="ai">
                <input type="radio" name="dayMode" value="ai" checked={mode === "ai"} onChange={() => setMode("ai")} />
                <div>
                  <strong>AI-assisted <em className="mode-soon">In development</em></strong>
                  <small>Personalised suggestions arrive in a later phase. For now the guided prompts below help you plan manually.</small>
                </div>
              </label>
            </div>

            <div className="day-form">
              <div className="day-field">
                <label>Day name</label>
                <input type="text" id="dayName" placeholder="e.g. Regular work day" maxLength={160} value={name} onChange={(event) => setName(event.target.value)} />
              </div>

              <div className="day-field">
                <label>Notes (optional)</label>
                <input type="text" id="dayNotes" placeholder="Optional notes" maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </div>

              <div className="day-field" id="dayDescribeField" hidden={mode === "ai"}>
                <label>Describe your day (optional)</label>
                <textarea id="dayDescribe" rows={3} placeholder="e.g. Work day, early meeting, prefer lighter lunch…" maxLength={4000} value={describe}
                          onChange={(event) => setDescribe(event.target.value)} />
              </div>

              <div className="day-ai-tips" id="dayAiTips" hidden={mode !== "ai"}>
                <strong>Manual guided prompts</strong>
                <ol>
                  <li>What time will you wake up?</li>
                  <li>What is your first meal and when?</li>
                  <li>Which meals are snacks vs main meals?</li>
                  <li>Any meal timing constraints for your day?</li>
                </ol>
              </div>

              <div className="day-field">
                <div className="day-meals-head">
                  <label>Meals</label>
                  <button className="day-add-meal" id="dayAddMeal" type="button"
                          onClick={() => setMeals((current) => [...current, { name: "", type: "Snack", time: "", notes: "" }])}><span className="plus">+</span> Add meal</button>
                </div>
                <div className="day-meals-list" id="dayMealsList">
                  {meals.map((m, i) => (
                    <div className="day-meal-row" data-i={i} key={i}>
                      <input type="text" className="dm-name" placeholder="Meal name" maxLength={120} value={m.name} onChange={(event) => setMeal(i, { name: event.target.value })} />
                      <select className="dm-type" value={m.type} onChange={(event) => setMeal(i, { type: event.target.value })}>
                        {MEAL_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <input type="time" className="dm-time" value={m.time} onChange={(event) => setMeal(i, { time: event.target.value })} />
                      <button className="day-meal-remove" data-rm={i} type="button" aria-label="Remove" onClick={() => setMeals((current) => current.filter((_, j) => j !== i))}>
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3 L 11 11 M 11 3 L 3 11" /></svg>
                      </button>
                      <div className="day-meal-constraints"><textarea className="dm-notes" placeholder="What does this meal consist of? (e.g. Oatmeal, berries, nuts)" maxLength={1000}
                                                                      value={m.notes} onChange={(event) => setMeal(i, { notes: event.target.value })} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <footer className="day-modal-footer">
            <button className="btn-modal btn-modal-ghost" data-close-day type="button" onClick={() => dialogs.close("dayModal")}>Cancel</button>
            <button className="btn-modal btn-modal-primary" id="daySaveBtn" type="button" onClick={() => void saveDay()}>{editId ? "Save changes" : "Create day"}</button>
          </footer>
        </div>
      </Overlay>

      {/* ---- Assign to date ---- */}
      <Overlay id="assignModal" open={dialogs.open.assignModal} onBackdrop={() => dialogs.close("assignModal")}>
        <div className="modal-card assign-modal-card" role="dialog" aria-modal="true" aria-labelledby="assignTitle">
          <button className="modal-close" data-close-assign type="button" aria-label="Close" onClick={() => dialogs.close("assignModal")}>&times;</button>
          <h3 id="assignTitle">{assignId ? `Assign to date: ${assignDay?.name || "Day"}` : "Assign to date"}</h3>
          <div className="day-field" style={{ marginBottom: 22 }}>
            <label htmlFor="assignDate">Date</label>
            <input type="date" id="assignDate" value={assignDate} onChange={(event) => setAssignDate(event.target.value)} />
          </div>
          <div className="assign-modal-actions">
            <button className="btn-modal btn-modal-ghost" data-close-assign type="button" onClick={() => dialogs.close("assignModal")}>Cancel</button>
            <button className="btn-modal btn-modal-primary" id="assignConfirm" type="button" onClick={() => void confirmAssign()}>Assign</button>
          </div>
        </div>
      </Overlay>

      {/* ---- Use a sample day: type -> option (where applicable) -> preview -> copy ---- */}
      <Overlay id="sampleModal" open={dialogs.open.sampleModal} onBackdrop={() => dialogs.close("sampleModal")}>
        <div className="modal-card day-modal-card" role="dialog" aria-modal="true" aria-labelledby="sampleTitle">
          <header className="day-modal-header">
            <h3 id="sampleTitle">Use a sample day</h3>
            <button className="modal-close day-modal-close" data-close-sample type="button" aria-label="Close" onClick={() => dialogs.close("sampleModal")}>&times;</button>
          </header>
          <div className="day-modal-body">
            <div className="sample-step" data-sample-step="type" hidden={sampleStep !== "type"}>
              <p className="sample-sub">Choose the kind of day you want to plan.</p>
              <div className="sample-grid" id="sampleTypeGrid">
                {samples.map((d, i) => (
                  <button className="sample-card" data-sample-type={i} type="button" key={d.key} onClick={() => chooseSampleType(i)}>
                    <b>{d.label}</b>{" "}
                    <span>{d.options.length > 1 ? `${d.options.length} options` : `${d.options[0].meals.filter((m) => m.notes).length} meals`}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="sample-step" data-sample-step="option" hidden={sampleStep !== "option"}>
              <p className="sample-sub" id="sampleOptionSub">{chosen ? `${chosen.label} has ${chosen.options.length} options.` : "This day type has two options."}</p>
              <div className="sample-grid" id="sampleOptionGrid">
                {chosen && chosen.options.length > 1 && chosen.options.map((o, i) => (
                  <button className="sample-card" data-sample-opt={i} type="button" key={i} onClick={() => { setSampleOption(i); goSampleStep("preview"); }}>
                    <b>{o.label}</b><span>{o.meals.filter((m) => m.notes).length} meals</span>
                  </button>
                ))}
              </div>
              <button className="btn-ghost sample-back" data-sample-back="type" type="button" onClick={() => goSampleStep("type")}>Back</button>
            </div>
            <div className="sample-step" data-sample-step="preview" hidden={sampleStep !== "preview"}>
              <h4 className="sample-preview-title" id="samplePreviewTitle">{chosen && chosenOption ? chosen.label + (chosenOption.label ? " — " + chosenOption.label : "") : ""}</h4>
              <p className="sample-sub">You can change the times and the foods as desired after copying.</p>
              <ol className="sample-schedule" id="sampleSchedule">
                {chosenOption?.meals.map((m, i) => (
                  <li key={i}><span className="st">{fmtTime12(m.time)}</span><span className="sn">{m.name}</span><span className="sw">{m.notes}</span></li>
                ))}
              </ol>
              <div className="sample-actions">
                <button className="btn-ghost sample-back" id="sampleBackBtn" type="button"
                        onClick={() => goSampleStep(chosen && chosen.options.length > 1 ? "option" : "type")}>Back</button>
                <button className="btn-primary" id="sampleCopyBtn" type="button" onClick={() => void copySample()}>Copy to my days</button>
              </div>
            </div>
          </div>
        </div>
      </Overlay>
    </>
  );
}
