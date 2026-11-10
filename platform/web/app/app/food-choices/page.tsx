"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/member/member-chrome";
import {
  answerHowToPlan, discardHowToPlan, getFoodCatalog, getFoodSelections, getHowToPlan,
  saveFoodSelections, startHowToPlan,
  type FoodChoiceCatalog, type FoodChoiceSelections, type FoodOccasion, type FoodSex,
  type HowToAnswer, type HowToPlan,
} from "@/lib/member-api";

/* Food Choices: the client's four food lists, and the HOW TO meal builder from
   `AI Chatbot Training.docx`.

   The screen deliberately holds no food data. Every tier, every portion, every
   piece of advice and the order of the questions come from the API, which
   reads them from the single transcribed source. The prototype's scoring once
   returned 0 because two screens spelled an option differently, so the lists
   are fetched, never retyped.

   What the member can do here:
   - Build a meal or a snack, one question at a time, with the amounts for
     them and the next time to eat worked out.
   - Tick the foods they commonly eat, and add their own under "Other" — which
     is recorded as they wrote it and given no tier or amount, because the
     source supplies those only for the foods on its lists. */

type Tab = "build" | "lists";

const GROUP_TITLE: Record<string, string> = {
  protein: "Proteins",
  carbohydrate: "Carbohydrates",
  fat: "Fats",
};

const STEP_TITLE: Record<string, string> = {
  wake_time: "Your day",
  occasion: "Snack or meal",
  protein: "Protein",
  carbohydrate: "Carbohydrate",
  fat: "Fat",
  confirm: "Does this look right?",
  fix: "What to change",
  continue: "Anything else today?",
  bedtime: "Bedtime",
  complete: "Your day",
};

export default function FoodChoicesPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("build");
  const [plan, setPlan] = useState<HowToPlan | null>(null);
  const [selections, setSelections] = useState<FoodChoiceSelections | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [currentPlan, currentSelections] = await Promise.all([getHowToPlan(), getFoodSelections()]);
      setPlan(currentPlan);
      setSelections(currentSelections);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Food Choices could not be loaded.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      setError("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "That could not be saved.";
      setError(message);
      toast.flash(message);
    } finally {
      setBusy(false);
    }
  }, [toast]);

  return (
    <>
      <h1 className="fd-title">Food Choices</h1>
      <p className="fcx-blurb">
        Build a meal or a snack one choice at a time, with the amounts for you and the time to eat
        next. The lists and the rules are Cara&rsquo;s.
      </p>

      <div className="fcx-tabs" role="tablist" aria-label="Food Choices">
        <button type="button" role="tab" aria-selected={tab === "build"}
          className={`fcx-tab${tab === "build" ? " is-on" : ""}`} onClick={() => setTab("build")}>
          Build a meal
        </button>
        <button type="button" role="tab" aria-selected={tab === "lists"}
          className={`fcx-tab${tab === "lists" ? " is-on" : ""}`} onClick={() => setTab("lists")}>
          My food lists
        </button>
      </div>

      {error ? <p className="fcx-err" role="alert">{error}</p> : null}

      {tab === "build" ? (
        <BuildPanel plan={plan} busy={busy} selections={selections}
          onStart={(sex) => run(async () => { setPlan(await startHowToPlan(sex)); })}
          onAnswer={(answer) => run(async () => { setPlan(await answerHowToPlan(answer)); })}
          onDiscard={() => run(async () => { await discardHowToPlan(); setPlan(null); })} />
      ) : (
        <ListsPanel selections={selections} busy={busy}
          onSave={(input) => run(async () => { setSelections(await saveFoodSelections(input)); })} />
      )}
    </>
  );
}

/* ---- Build a meal (the HOW TO conversation) ------------------------------ */

function BuildPanel({ plan, busy, selections, onStart, onAnswer, onDiscard }: {
  plan: HowToPlan | null;
  busy: boolean;
  selections: FoodChoiceSelections | null;
  onStart: (sex: FoodSex) => void;
  onAnswer: (answer: HowToAnswer) => void;
  onDiscard: () => void;
}) {
  const remembered = selections?.sex === "woman" || selections?.sex === "man" ? selections.sex : "";
  const [sex, setSex] = useState<FoodSex | "">(remembered);
  useEffect(() => { if (remembered) setSex(remembered); }, [remembered]);

  if (!plan) {
    return (
      <section className="fcx-panel">
        <h2 className="fcx-panel__title">Build a meal</h2>
        <p className="fcx-note">
          The food lists give an amount for a woman and an amount for a man, so the plan needs to
          know which to use. Nothing else about you is used here.
        </p>
        <div className="fcx-choices">
          {(["woman", "man"] as FoodSex[]).map((option) => (
            <button key={option} type="button"
              className={`fcx-choice${sex === option ? " is-on" : ""}`}
              onClick={() => setSex(option)}>
              {option === "woman" ? "Woman" : "Man"}
            </button>
          ))}
        </div>
        {!sex ? <p className="fcx-hint">Choose whose amounts to use, then press Start.</p> : null}
        <button type="button" className="btn-primary fcx-action" disabled={!sex || busy}
          title={sex ? undefined : "Not yet - choose a woman's or a man's amounts first"}
          aria-label={sex ? undefined : "Start. Not yet - choose a woman's or a man's amounts first"}
          onClick={() => sex && onStart(sex)}>
          Start
        </button>
      </section>
    );
  }

  return (
    <div className="fcx-grid">
      <section className="fcx-panel">
        <h2 className="fcx-panel__title">{STEP_TITLE[plan.step] ?? "Your meal"}</h2>
        <PromptBlock plan={plan} busy={busy} onAnswer={onAnswer} />
      </section>
      <DayPanel plan={plan} busy={busy} onDiscard={onDiscard} />
    </div>
  );
}

function PromptBlock({ plan, busy, onAnswer }: {
  plan: HowToPlan; busy: boolean; onAnswer: (answer: HowToAnswer) => void;
}) {
  const { prompt } = plan;
  const [time, setTime] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [cooked, setCooked] = useState(false);
  const [other, setOther] = useState("");

  // A new question starts from nothing chosen. `submit` also clears, because
  // a step can repeat with the same id when an answer is refused, and leaving
  // the refused food in the box would send it again with the next answer.
  useEffect(() => { setPicked([]); setOther(""); setTime(""); }, [prompt.step, plan.occasions.length]);

  const toggle = (name: string) =>
    setPicked((current) => current.includes(name) ? current.filter((n) => n !== name) : [...current, name]);

  const submit = (answer: HowToAnswer) => {
    setPicked([]);
    setOther("");
    setTime("");
    onAnswer(answer);
  };

  return (
    <>
      <div data-testid="fc-notes">
        {prompt.notes.map((note, index) => (
          <p key={index} className="fcx-prompt-note">{note}</p>
        ))}
      </div>

      {prompt.recap.length ? (
        <ul className="fcx-recap" data-testid="fc-recap">
          {prompt.recap.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}

      <p className="fcx-ask" data-testid="fc-ask">{prompt.text}</p>

      {prompt.answer === "time" ? (
        <div className="fcx-answer">
          <label className="fcx-label" htmlFor="fcx-time">Time</label>
          <input id="fcx-time" className="fcx-input" type="time" value={time}
            onChange={(event) => setTime(event.target.value)} />
          <button type="button" className="btn-primary fcx-action" disabled={!time || busy}
            title={time ? undefined : "Not yet - give the time first"}
            aria-label={time ? undefined : "Continue. Not yet - give the time first"}
            onClick={() => submit({ time })}>Continue</button>
        </div>
      ) : null}

      {prompt.answer === "choice" ? (
        <div className="fcx-choices">
          {prompt.options.map((option) => (
            <button key={option} type="button" className="fcx-choice" disabled={busy}
              onClick={() => submit({ choice: option })}>
              {CHOICE_LABEL[option] ?? option}
            </button>
          ))}
        </div>
      ) : null}

      {prompt.answer === "foods" ? (
        <div className="fcx-answer">
          <div className="fcx-candidates">
            {prompt.candidates.map((name) => (
              <button key={name} type="button"
                className={`fcx-food${picked.includes(name) ? " is-on" : ""}`}
                onClick={() => toggle(name)}>
                {name}
              </button>
            ))}
          </div>
          <label className="fcx-label" htmlFor="fcx-other">Or name something else from the list</label>
          <input id="fcx-other" className="fcx-input" value={other} placeholder="For example, Cottage cheese"
            onChange={(event) => setOther(event.target.value)} />
          {prompt.step === "protein" ? (
            <label className="fcx-check">
              <input type="checkbox" checked={cooked}
                onChange={(event) => setCooked(event.target.checked)} />
              I will cook it
            </label>
          ) : null}
          <button type="button" className="btn-primary fcx-action"
            disabled={busy || (!picked.length && !other.trim())}
            title={picked.length || other.trim() ? undefined : "Not yet - choose a food first"}
            aria-label={picked.length || other.trim() ? undefined : "Continue. Not yet - choose a food first"}
            onClick={() => submit({
              foods: [...picked, ...(other.trim() ? [other.trim()] : [])],
              ...(prompt.step === "protein" ? { cooked } : {}),
            })}>
            Continue
          </button>
        </div>
      ) : null}

    </>
  );
}

const CHOICE_LABEL: Record<string, string> = {
  meal: "A meal (5 hours)",
  snack: "A snack (2 hours)",
  yes: "Yes, that is right",
  no: "No, change something",
  another: "Plan something else",
  finished: "That is everything",
  protein: "The protein",
  carbohydrate: "The carbohydrate",
  fat: "The fat",
};

function DayPanel({ plan, busy, onDiscard }: { plan: HowToPlan; busy: boolean; onDiscard: () => void }) {
  return (
    <section className="fcx-panel fcx-panel--day">
      <h2 className="fcx-panel__title">Your day</h2>
      {plan.wake_label ? <p className="fcx-note">Up at {plan.wake_label}.</p> : null}
      {plan.occasions.length ? (
        <ol className="fcx-day" data-testid="fc-day">
          {plan.occasions.map((occasion, index) => (
            <li key={index} className={`fcx-day-row${occasion.confirmed ? " is-done" : ""}`}>
              <span className="fcx-day-time">{occasion.at_label ?? "—"}</span>
              <span className="fcx-day-kind">{occasion.kind === "meal" ? "Meal" : "Snack"}</span>
              <span className="fcx-day-foods">
                {[...occasion.proteins, ...occasion.carbohydrates, ...occasion.fats].join(", ") || "choosing…"}
              </span>
            </li>
          ))}
        </ol>
      ) : <p className="fcx-empty">Nothing planned yet.</p>}
      {plan.done_eating_reason
        ? <p className="fcx-prompt-note" data-testid="fc-done">{plan.done_eating_reason}</p>
        : null}
      <button type="button" className="btn-ghost fcx-action" disabled={busy} onClick={onDiscard}>
        {plan.complete ? "Plan another day" : "Start again"}
      </button>
    </section>
  );
}

/* ---- My food lists ------------------------------------------------------- */

function ListsPanel({ selections, busy, onSave }: {
  selections: FoodChoiceSelections | null;
  busy: boolean;
  onSave: (input: { sex?: string; selections?: Record<string, string[]>; write_ins?: Record<string, string[]> }) => void;
}) {
  const [sex, setSex] = useState<FoodSex>("woman");
  const [occasion, setOccasion] = useState<FoodOccasion>("meal");
  const [catalog, setCatalog] = useState<FoodChoiceCatalog | null>(null);
  const [checked, setChecked] = useState<Record<string, string[]>>({ protein: [], carbohydrate: [], fat: [] });
  const [writeIns, setWriteIns] = useState<Record<string, string[]>>({});
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    if (selections?.sex === "woman" || selections?.sex === "man") setSex(selections.sex);
    if (selections) {
      setChecked(selections.selections);
      setWriteIns(selections.write_ins);
    }
  }, [selections]);

  useEffect(() => {
    let live = true;
    getFoodCatalog(sex, occasion)
      .then((result) => { if (live) { setCatalog(result); setCatalogError(""); } })
      .catch((reason) => {
        if (live) setCatalogError(reason instanceof Error ? reason.message : "The food lists could not be loaded.");
      });
    return () => { live = false; };
  }, [sex, occasion]);

  const toggle = (group: string, name: string) =>
    setChecked((current) => {
      const existing = current[group] ?? [];
      return {
        ...current,
        [group]: existing.includes(name) ? existing.filter((n) => n !== name) : [...existing, name],
      };
    });

  const total = useMemo(
    () => Object.values(checked).reduce((sum, names) => sum + names.length, 0),
    [checked],
  );

  return (
    <section className="fcx-panel">
      <div className="fcx-lists-head">
        <h2 className="fcx-panel__title">My food lists</h2>
        <div className="fcx-filters">
          <label className="fcx-label" htmlFor="fcx-sex">Amounts for</label>
          <select id="fcx-sex" className="fcx-select" value={sex}
            onChange={(event) => setSex(event.target.value as FoodSex)}>
            <option value="woman">A woman</option>
            <option value="man">A man</option>
          </select>
          <label className="fcx-label" htmlFor="fcx-occasion">Per</label>
          <select id="fcx-occasion" className="fcx-select" value={occasion}
            onChange={(event) => setOccasion(event.target.value as FoodOccasion)}>
            <option value="meal">Meal</option>
            <option value="snack">Snack</option>
          </select>
        </div>
      </div>

      {catalogError ? <p className="fcx-err" role="alert">{catalogError}</p> : null}

      {catalog ? (
        <>
          <p className="fcx-note">{catalog.notes.not_protein}</p>
          <p className="fcx-note">{catalog.notes.whole_grain}</p>

          {catalog.groups.map((group) => (
            <div key={group.group} className="fcx-group">
              <h3 className="fcx-group__title">{GROUP_TITLE[group.group] ?? group.group}</h3>
              {group.tiers.map((tier) => (
                <div key={tier.tier} className="fcx-tier">
                  <p className="fcx-tier__label">
                    {tier.label}
                    {tier.allowance ? <span className="fcx-allowance">{tier.allowance}</span> : null}
                  </p>
                  <div className="fcx-foods">
                    {tier.foods.map((food) => (
                      <button key={food.name} type="button"
                        className={`fcx-food${(checked[group.group] ?? []).includes(food.name) ? " is-on" : ""}`}
                        onClick={() => toggle(group.group, food.name)}
                        title={food.portion ?? "The food lists give no amount for this one."}>
                        <span>{food.name}</span>
                        <span className="fcx-portion">{food.portion ?? "no amount given"}</span>
                      </button>
                    ))}
                  </div>
                  {/* Keyed by section, not by tier: "best" and "poor" are
                      tier names on both the protein and the fat list. */}
                  <WriteIns section={`${group.group}:${tier.tier}`} label={tier.label}
                    entries={writeIns[`${group.group}:${tier.tier}`] ?? []}
                    onChange={(entries) => setWriteIns((current) => ({
                      ...current, [`${group.group}:${tier.tier}`]: entries,
                    }))} />
                </div>
              ))}
            </div>
          ))}

          <p className="fcx-note">{selections?.write_in_note}</p>
          <div className="fcx-lists-actions">
            <span className="fcx-count">{total} food{total === 1 ? "" : "s"} ticked</span>
            <button type="button" className="btn-primary fcx-action" disabled={busy}
              onClick={() => onSave({ sex, selections: checked, write_ins: writeIns })}>
              Save my lists
            </button>
          </div>
        </>
      ) : catalogError ? null : <p className="fcx-empty">Loading the food lists…</p>}
    </section>
  );
}

function WriteIns({ section, label, entries, onChange }: {
  section: string; label: string; entries: string[]; onChange: (entries: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="fcx-writeins">
      {entries.map((entry) => (
        <span key={entry} className="fcx-writein">
          {entry}
          <button type="button" aria-label={`Remove ${entry}`}
            onClick={() => onChange(entries.filter((e) => e !== entry))}>&times;</button>
        </span>
      ))}
      <input className="fcx-input fcx-input--inline" value={draft} placeholder="Other (write in)"
        aria-label={`Add your own to ${label}`}
        data-section={section}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !draft.trim()) return;
          event.preventDefault();
          onChange([...entries, draft.trim()]);
          setDraft("");
        }} />
    </div>
  );
}
