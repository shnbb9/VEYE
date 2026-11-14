"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useToast } from "@/components/member/member-chrome";
import {
  getFoodChecklist, getFoodChecklistCatalog, saveFoodChecklist,
  type FoodChecklist, type FoodChecklistCatalog, type FoodCustomFood, type FoodCustomTier,
} from "@/lib/member-api";
import { prefersReducedMotion } from "@/lib/member-format";

/* Food Choices exactly as the approved prototype shows it (build/dashboard.html,
   view-food-choices): the four illustrated category cards, and for each a
   checklist of the foods the member commonly eats, a custom food with the
   member's own Best / Fair / Limit label, the category note's "I got it", and
   "Save category choices". The owner chose this screen over the HOW TO meal
   builder on 14 Nov 2026.

   The lists come from the API (`checklist.py`, taken from the prototype
   itself), never from a copy here. What the member does is saved to their own
   record as they do it — the prototype kept it in the browser; here it
   belongs to the member's account, so it follows them and is erased with it.

   Headings: the prototype's cards are h3 under the page's h1. Here they are h2
   (the audit in e2e/responsive.spec.ts refuses a skipped level), styled by a
   copy of the prototype's own h3 rule in member.css, so nothing moves. */

type Local = {
  selections: Record<string, string[]>;
  custom: Record<string, FoodCustomFood[]>;
  gotit: Record<string, boolean>;
};

const EMPTY: Local = { selections: {}, custom: {}, gotit: {} };

const ARROW = (
  <span className="fc-arrow" aria-hidden="true">
    <svg viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13" cy="13" r="12.2" />
      <path d="M7 13h13M16.5 9.5 20 13l-3.5 3.5" />
    </svg>
  </span>
);

/* The overview cards' words are the prototype's markup, as Cara approved it. */
const TILES: { key: string; image: string; title: string; text: string; cta: string }[] = [
  {
    key: "proteins", image: "/assets/web/img/fc-proteins.png?v=2", title: "Proteins", cta: "Choose your Proteins",
    text: "Proteins contain amino acids that are important building blocks for muscles and cells. Proteins are also important for satiety — letting the body know you have eaten and feel full. 30g of protein has the same effect in the body as new GLP1 weight loss drugs. In addition, protein in sufficient quantities helps activate hormones that burn fat and decrease inflammation.",
  },
  {
    key: "fats", image: "/assets/web/img/fc-fats.png?v=2", title: "Fats", cta: "Choose your Fats",
    text: "Healthy fats support hormones, brain function, and long-lasting energy. Prioritize monounsaturated Omega-9 fats like olive oil, avocado, almonds, and macadamia nuts. Avoid trans fats and limit pro-inflammatory Omega-6 vegetable oils. The right fats help signal satiety and support cell health.",
  },
  {
    key: "favorable_carbs", image: "/assets/web/img/fc-fav.png?v=2", title: "Favorable Carbohydrates", cta: "Choose your Carbs",
    text: "Carbohydrates are the energy source for the brain, and a “no carb” diet can be harmful. All carbohydrates become blood sugar, and favorable carbohydrates are best for controlling blood sugar, therefore insulin, and therefore inflammation.",
  },
  {
    key: "unfavorable_carbs", image: "/assets/web/img/fc-unfav.png?v=2", title: "Unfavorable Carbohydrates", cta: "Choose your Carbs",
    text: "Unfavorable Carbohydrates enter the bloodstream quickly as sugar, and make the brain very happy. This is why it is easy to have carbohydrate addiction, your brain loves the sugar. The resulting spike in insulin causes an increase in inflammation — which can lead to disease. It is important to limit unfavorable carbohydrates.",
  },
];

const TIER_TAG: Record<string, string> = { super: "★★★", very: "★★", best: "Best", fair: "Fair", avoid: "Avoid" };
const tagText = (tier: string) => TIER_TAG[tier] ?? "Limit";
const customTagText = (tier: string) => (tier === "best" ? "Best" : tier === "fair" ? "Fair" : "Limit");
const CUSTOM_TIERS: { tier: FoodCustomTier; label: string }[] = [
  { tier: "best", label: "Best" }, { tier: "fair", label: "Fair" }, { tier: "limit", label: "Limit" },
];

function fromSaved(saved: FoodChecklist): Local {
  return { selections: saved.selections, custom: saved.custom, gotit: saved.gotit };
}

function toInput(local: Local) {
  return {
    selections: local.selections,
    custom: Object.fromEntries(Object.entries(local.custom)
      .map(([key, foods]) => [key, foods.map((food) => ({ name: food.name, tier: food.tier }))])),
    gotit: local.gotit,
  };
}

function scrollMainToTop() {
  document.querySelector<HTMLElement>(".main")?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

export default function FoodChoicesPage() {
  const toast = useToast();
  const [catalog, setCatalog] = useState<FoodChecklistCatalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [state, setState] = useState<Local>(EMPTY);
  const [active, setActive] = useState("proteins");
  const [detailOpen, setDetailOpen] = useState(false);
  const [tierInfoOpen, setTierInfoOpen] = useState(false);
  // Like the prototype, the custom-food row is one control shared by the four
  // categories: its text, label choice and messages stay when you switch.
  const [customName, setCustomName] = useState("");
  const [customTier, setCustomTier] = useState<FoodCustomTier | null>(null);
  const [hintShown, setHintShown] = useState(false);
  const [note, setNote] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const customInput = useRef<HTMLInputElement>(null);

  /* ---- saving --------------------------------------------------------------
     Every change is saved as it happens, one request at a time and always the
     newest state, so a quick run of ticks can never land out of order and put
     back an older list. A failed save is said; the next change or "Save
     category choices" sends the newest state again. */
  const latest = useRef<{ version: number; data: Local }>({ version: 0, data: EMPTY });
  const savedVersion = useRef(0);
  const running = useRef(false);
  const waiters = useRef<{ version: number; resolve: () => void; reject: (reason: unknown) => void }[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([getFoodChecklistCatalog(), getFoodChecklist()])
      .then(([lists, saved]) => {
        if (!alive) return;
        const local = fromSaved(saved);
        latest.current = { version: 0, data: local };
        setCatalog(lists);
        setState(local);
      })
      .catch(() => { if (alive) setLoadError("Food Choices could not be loaded. Please try again later."); });
    return () => { alive = false; };
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const settle = (upTo: number, outcome: { ok: true } | { ok: false; reason: unknown }) => {
      waiters.current = waiters.current.filter((waiter) => {
        if (waiter.version > upTo) return true;
        if (outcome.ok) waiter.resolve(); else waiter.reject(outcome.reason);
        return false;
      });
    };
    try {
      while (latest.current.version > savedVersion.current) {
        const { version, data } = latest.current;
        try {
          await saveFoodChecklist(toInput(data));
          savedVersion.current = version;
          settle(version, { ok: true });
        } catch (reason) {
          settle(version, { ok: false, reason });
          toast.flash("Your food choices could not be saved. Please try again.");
          // A newer change made meanwhile is tried once more; otherwise stop
          // until the member changes something or presses Save.
          if (latest.current.version === version) break;
        }
      }
    } finally {
      running.current = false;
    }
  }, [toast]);

  const persist = useCallback((next: Local): Promise<void> => {
    const version = latest.current.version + 1;
    latest.current = { version, data: next };
    setState(next);
    const done = new Promise<void>((resolve, reject) => { waiters.current.push({ version, resolve, reject }); });
    void drain();
    return done;
  }, [drain]);

  const ready = catalog !== null;
  const category = catalog?.categories.find((entry) => entry.key === active) ?? null;
  const label = category?.label ?? TILES.find((tile) => tile.key === active)?.title ?? "";
  const selected = new Set(state.selections[active] ?? []);
  const custom = state.custom[active] ?? [];
  const gotit = !!state.gotit[active];

  function openDetail(key: string) {
    setActive(key);
    setTierInfoOpen(false);
    setDetailOpen(true);
    scrollMainToTop();
  }

  function closeDetail() {
    setDetailOpen(false);
    scrollMainToTop();
  }

  function toggleFood(name: string) {
    if (!ready) return;
    const current = latest.current.data;
    const list = new Set(current.selections[active] ?? []);
    if (list.has(name)) list.delete(name); else list.add(name);
    void persist({ ...current, selections: { ...current.selections, [active]: Array.from(list) } }).catch(() => undefined);
  }

  function onFoodKey(event: KeyboardEvent<HTMLDivElement>, name: string) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggleFood(name);
    }
  }

  function toggleGotIt() {
    if (!ready) return;
    setTierInfoOpen(false); // the prototype redraws the card, which closes the tier note
    const current = latest.current.data;
    void persist({ ...current, gotit: { ...current.gotit, [active]: !current.gotit[active] } }).catch(() => undefined);
  }

  async function addCustom() {
    if (!ready) return;
    const value = customName.trim();
    if (!value) { customInput.current?.focus(); return; }
    if (!customTier) { setHintShown(true); return; } // the label is required
    const current = latest.current.data;
    const foods = current.custom[active] ?? [];
    const next = foods.some((food) => food.name === value)
      ? foods
      : [...foods, { name: value, tier: customTier, status: "pending" as const }];
    setCustomName("");
    setCustomTier(null);
    try {
      await persist({ ...current, custom: { ...current.custom, [active]: next } });
      setNote(`“${value}” was added to your list and is ready to use.`);
    } catch {
      setNote("");
    }
  }

  function removeCustom(name: string) {
    const current = latest.current.data;
    const foods = (current.custom[active] ?? []).filter((food) => food.name !== name);
    void persist({ ...current, custom: { ...current.custom, [active]: foods } }).catch(() => undefined);
  }

  async function saveCategory() {
    if (!ready) return;
    try {
      await persist({ ...latest.current.data });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1400);
    } catch {
      /* the failure has been said */
    }
  }

  return (
    <>
      {/* Overview: 2x2 illustrated category cards */}
      <section className="fc-overview" id="fcOverview" hidden={detailOpen}>
        <h1 className="fc-overview-title fade-in">Food Choices</h1>
        <div className="fc-overview-grid fade-in d1">
          {TILES.map((tile) => (
            <article className="fc-card-tile" data-cat={tile.key} key={tile.key}>
              <div className="fc-tile-illu">
                <img src={tile.image} alt="" />
              </div>
              <h2>{tile.title}</h2>
              <p>{tile.text}</p>
              <button className="fc-tile-cta" data-cat-cta={tile.key} type="button" onClick={() => openDetail(tile.key)}>
                {tile.cta} {ARROW}
              </button>
            </article>
          ))}
        </div>
      </section>

      {/* Detail panel: opens when a Choose your … button is clicked */}
      <section className="fc-detail" id="fcDetail" hidden={!detailOpen}>
        <header className="quiz-topbar fade-in">
          <button className="quiz-back" id="fcDetailBack" type="button" onClick={closeDetail}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10,3 5,8 10,13" /></svg>
            Back to Food Choices
          </button>
        </header>

        <div className="fc-card fc-content fade-in d1">
          <h2 className="fc-content-title" id="fcContentTitle">{`${label} `}
            <button className="fc-tier-info" id="fcTierInfoBtn" type="button" aria-expanded={tierInfoOpen}
              aria-controls="fcTierInfoPanel" aria-label="What the tiers mean" onClick={() => setTierInfoOpen((open) => !open)}>i</button>
          </h2>
          <div className="fc-tier-panel" id="fcTierInfoPanel" hidden={!tierInfoOpen}>{category?.tier_info ?? ""}</div>
          <div className="fc-info-box" id="fcInfoBox">
            <p id="fcInfoText">{category?.info ?? ""}</p>
            <button className={`fc-info-cta${gotit ? " done" : ""}`} id="fcGotIt" type="button" onClick={toggleGotIt}>
              {gotit ? "Got it ✓" : "I got it"}
            </button>
          </div>

          <div className="fc-select-label">Select foods you commonly eat</div>
          {loadError ? <p className="fc-custom-hint" role="alert">{loadError}</p> : null}
          <div className="fc-food-grid" id="fcFoodGrid">
            {category?.groups.flatMap((group) => group.items.map((name) => (
              <div key={name} className={`fc-food-row${selected.has(name) ? " checked" : ""}`} data-name={name}
                data-tier={group.tier} title={group.label} role="checkbox" aria-checked={selected.has(name)} tabIndex={0}
                onClick={() => toggleFood(name)} onKeyDown={(event) => onFoodKey(event, name)}>
                <span className="fc-check"></span>
                <span className="fc-food-label">{name}</span>
                <span className={`fc-food-tag fc-tag-${group.tier}`}>{tagText(group.tier)}</span>
              </div>
            )))}
          </div>

          <div className="fc-custom-section">
            <div className="fc-custom-label">Add custom food</div>
            <div className="fc-custom-row">
              <input ref={customInput} type="text" id="fcCustomInput" placeholder="Type a custom food" aria-label="Custom food name"
                value={customName} onChange={(event) => setCustomName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addCustom(); } }} />
              <div className="fc-tier-pick" role="group" aria-label="Choose a tier for this food">
                {CUSTOM_TIERS.map((entry) => (
                  <button key={entry.tier} className={`fc-tier-btn${customTier === entry.tier ? " selected" : ""}`} data-fc-tier={entry.tier}
                    type="button" onClick={() => { setCustomTier(entry.tier); setHintShown(false); }}>{entry.label}</button>
                ))}
              </div>
              <button className="fc-save-btn" id="fcCustomAdd" type="button" style={{ padding: "10px 20px", borderRadius: 8 }}
                onClick={() => void addCustom()}>Add</button>
            </div>
            <p className="fc-custom-hint" id="fcCustomHint" hidden={!hintShown}>Choose Best, Fair or Limit for this food before adding it.</p>
            <p className="fc-custom-note" id="fcCustomNote" hidden={!note}>{note}</p>
            <div className="fc-custom-list" id="fcCustomList">
              {custom.map((food) => (
                <span className="fc-custom-chip" key={food.name}>{food.name}
                  <span className={`fc-food-tag fc-tag-${food.tier}`}>{customTagText(food.tier)}</span>
                  {food.status === "pending" ? <span className="fc-pending" title="Not reviewed by the Veye team yet.">Pending Review</span> : null}
                  <button type="button" aria-label={`Remove ${food.name}`} onClick={() => removeCustom(food.name)}>&times;</button>
                </span>
              ))}
            </div>
          </div>

          <div className="fc-content-foot">
            <button className="fc-save-btn" id="fcSave" type="button" onClick={() => void saveCategory()}>
              {savedFlash ? "Saved ✓" : "Save category choices"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
