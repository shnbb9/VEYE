"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Answers, HealthResult, NO_OTHER_PLANS, SCREENS, Screen, TOTAL_QUESTIONS, YesNo,
  initialAnswers, isAnswered, questionReached, toApiAnswers,
} from "@/lib/health-number";
import { apiPath } from "@/lib/api-base";
import { describeDetail } from "@/lib/api";
import { PENDING_ANSWERS_KEY, PREFILL_EMAIL_KEY } from "@/lib/auth-keys";
import { useSession } from "@/components/session";

/* The approved onboarding assessment (build/onboarding.html + js/quiz.js +
   styles/quiz.css, Figma Desk Onboard B–J): fixed-coordinate header with the
   twelve-segment progress pill, top-anchored question titles, white option
   cards with the square/round check, PREVIOUS / NEXT, and the ring result.
   The stylesheets are the prototype's own files served from /onboarding-css.
   Scoring is the API's — nothing is calculated in the browser. */

// Progress bar geometry from the Figma frames + "progress.png", rescaled so the
// twelve canonical Health Number questions fill the same 384px track.
const SEG_END = [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384];
const SEG_COL = ["#B7E355", "#ADDC48", "#A5D538", "#9BCA30", "#90BE29", "#85B422",
                 "#7EAA1B", "#709815", "#59731F", "#364A08", "#8AA0A8", "#A5CBD9"];

type ResultView = { result: HealthResult; stored: boolean };

export default function Onboarding() {
  const router = useRouter();
  const session = useSession();
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [phase, setPhase] = useState<"q" | "result">("q");
  const [result, setResult] = useState<ResultView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gateOpen, setGateOpen] = useState(false);

  const screen = SCREENS[idx];
  const reached = questionReached(idx);
  const answered = isAnswered(screen, answers);

  function update(patch: Partial<Answers> | ((current: Answers) => Partial<Answers>)) {
    setAnswers((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }));
    setError("");
  }

  async function next() {
    if (phase === "result" || !answered) return;
    if (idx < SCREENS.length - 1) { setIdx(idx + 1); window.scrollTo(0, 0); return; }
    // Last question answered. A signed-in member's result is calculated and
    // stored by the API straight away; a visitor sees the approved email gate
    // first, and the number is calculated (not stored) by the same service -
    // it is attached to the account at sign-up.
    const signedInMember = session.status === "ready" && session.member !== null;
    if (!signedInMember) { setGateOpen(true); return; }
    await calculate(true);
  }

  async function calculate(store: boolean) {
    setBusy(true); setError("");
    try {
      const response = await fetch(apiPath(store ? "/api/v1/health-number/calculate" : "/api/v1/health-number/preview"), {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: toApiAnswers(answers) }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { detail?: unknown } | null;
        throw new Error(describeDetail(detail?.detail) ?? "Your Health Number could not be calculated right now. Please try again.");
      }
      setResult({ result: await response.json(), stored: store });
      setPhase("result");
      window.scrollTo(0, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your Health Number could not be calculated right now. Please try again.");
    } finally { setBusy(false); }
  }

  function gateDone(email: string) {
    try {
      sessionStorage.setItem(PREFILL_EMAIL_KEY, email);
      sessionStorage.setItem(PENDING_ANSWERS_KEY, JSON.stringify(answers));
    } catch { /* storage unavailable: sign-up still works, without the pre-fill */ }
    setGateOpen(false);
    void calculate(false);
  }

  function prev() {
    if (phase === "result") return;          // the header back control is hidden on the result
    if (idx > 0) setIdx(idx - 1); else router.push("/");
  }

  function signUp() {
    router.push("/signup");
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Teachers:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <link rel="stylesheet" href="/onboarding-css/tokens.css" />
      <link rel="stylesheet" href="/onboarding-css/base.css" />
      <link rel="stylesheet" href="/onboarding-css/quiz.css" />
      <link rel="stylesheet" href="/onboarding-css/onboarding-app.css" />

      <div className="quiz">
        <div className="quiz__topbar" />
        <img className="quiz__watermark" src="/assets/web/svg/quiz-hex.svg" alt="" />
        <div className="quiz__peach" />

        <div className="quiz__header">
          <Link className="quiz__logo" href="/" aria-label="Veye home"><img src="/assets/web/wp/veye-id.svg" alt="Veye" /></Link>
          <div className="quiz__progress" style={{ visibility: phase === "q" ? "visible" : "hidden" }}>
            <button className="quiz__back" type="button" aria-label="Back" onClick={prev}>
              <svg viewBox="0 0 15 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 7H1.6M6.6 1.8L1.4 7l5.2 5.2"/></svg>
            </button>
            <div className="quiz__track" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_QUESTIONS} aria-valuenow={reached}>
              {phase === "q" && Array.from({ length: Math.min(reached, SEG_END.length) }, (_, i) => (
                // lightest/shortest on top, so every step keeps its own rounded band
                <span key={`s${i}`} className="pseg" style={{ width: SEG_END[i], background: SEG_COL[i], zIndex: 20 - i }} />
              ))}
              {phase === "q" && Array.from({ length: Math.min(reached, SEG_END.length) }, (_, i) => (
                <span key={`n${i}`} className="pnum" style={{ left: ((i ? SEG_END[i - 1] : 0) + SEG_END[i]) / 2, color: i < 4 ? "#446514" : "#F6FFE8" }}>{i + 1}</span>
              ))}
            </div>
            <span className="quiz__count">{phase === "q" ? `${reached}/${TOTAL_QUESTIONS}` : ""}</span>
          </div>
        </div>

        <main className={`quiz__main${phase === "q" && screen.type === "yesno" ? " quiz__main--yn" : ""}`}>
          {phase === "q" ? (
            <>
              <Question screen={screen} answers={answers} update={update} />
              {error && <p className="quiz__error" role="alert">{error}</p>}
              <div className="quiz__nav">
                <button className="quiz__btn quiz__btn--prev" type="button" onClick={prev} disabled={busy}>Previous</button>
                <button className="quiz__btn quiz__btn--next" type="button" onClick={next} disabled={!answered || busy}>{busy ? "Calculating" : "Next"}</button>
              </div>
            </>
          ) : result && <Result view={result} onSignUp={signUp} />}
        </main>
      </div>
      {gateOpen && <EmailGate onClose={() => setGateOpen(false)} onDone={gateDone} />}
    </>
  );
}

/* ---------- result-ready email gate (build/js/quiz.js openEmailGate) ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function EmailGate({ onClose, onDone }: { onClose: () => void; onDone: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onEsc = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  function go() {
    const value = email.trim();
    if (!value) { setErr("Please enter your email address."); inputRef.current?.focus(); return; }
    if (!EMAIL_RE.test(value)) { setErr("Please enter a valid email address."); inputRef.current?.focus(); return; }
    onDone(value);
  }

  return (
    <div className="hn-modal" role="dialog" aria-modal="true" aria-labelledby="hnModalTitle" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="hn-modal__card">
        <button type="button" className="hn-modal__close" aria-label="Close" onClick={onClose}>&times;</button>
        <h2 className="hn-modal__title" id="hnModalTitle">Your Health Number is Ready</h2>
        <p className="hn-modal__copy">Enter your email address to view your Health Number.</p>
        <label className="hn-modal__label" htmlFor="hnEmail">Email Address</label>
        <input ref={inputRef} className={`hn-modal__input${err ? " is-invalid" : ""}`} id="hnEmail" type="email" inputMode="email" autoComplete="email"
               placeholder="you@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setErr(""); }}
               onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); go(); } }} />
        <p className="hn-modal__err" id="hnErr" role="alert">{err}</p>
        <button type="button" className="quiz__btn quiz__btn--next hn-modal__cta" onClick={go}>View My Health Number</button>
      </div>
    </div>
  );
}

/* ---------- option cards ---------- */

function Opt({ label, selected, radio, onSelect }: { label: string; selected: boolean; radio?: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`opt${radio ? " opt--radio" : ""}${selected ? " selected" : ""}`} aria-pressed={selected} onClick={onSelect}>
      <span>{label}</span><span className="opt__check" />
    </button>
  );
}

function OtherOpt({ selected, radio, placeholder, value, onSelect, onText }: {
  selected: boolean; radio?: boolean; placeholder: string; value: string; onSelect: () => void; onText: (value: string) => void;
}) {
  // "Other" row — tan chip + separate white input (WordPress). The chip is the
  // prototype's first-child <span> (its stylesheet keys off that), made
  // keyboard-operable; typing also ticks Other, so its score applies once.
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); }
  };
  return (
    <div className={`opt${radio ? " opt--radio" : ""} opt--other${selected ? " selected" : ""}`}>
      <span role="button" tabIndex={0} aria-pressed={selected} onClick={onSelect} onKeyDown={onKey}>Other</span>
      <input aria-label={placeholder} placeholder={placeholder} value={value} maxLength={240} onChange={(event) => onText(event.target.value)} />
      <span className="opt__check" />
    </div>
  );
}

function YesNoRow({ value, onChange, sub }: { value: YesNo | ""; onChange: (value: YesNo) => void; sub?: string }) {
  return (
    <div className="quiz__options quiz__options--yn" data-sleep={sub}>
      <Opt label="Yes" radio selected={value === "yes"} onSelect={() => onChange("yes")} />
      <Opt label="No" radio selected={value === "no"} onSelect={() => onChange("no")} />
    </div>
  );
}

type Update = (patch: Partial<Answers> | ((current: Answers) => Partial<Answers>)) => void;

function Question({ screen, answers, update }: { screen: Screen; answers: Answers; update: Update }) {
  if (screen.type === "checkbox") {
    const key = screen.id;
    const chosen = answers[key];
    const otherKey = key === "goals" ? "goalsOther" : "plansOther";
    const exclusive = screen.type === "checkbox" && "exclusive" in screen ? screen.exclusive : null;
    const toggle = (label: string) => update((current) => {
      const now = current[key];
      let next = now.includes(label) ? now.filter((item) => item !== label) : [...now, label];
      // "No other plans" is mutually exclusive with any named plan (XLSX R23).
      if (exclusive) {
        if (label === exclusive && next.includes(exclusive)) next = [exclusive];
        else if (label !== exclusive) next = next.filter((item) => item !== exclusive);
      }
      const patch: Record<string, unknown> = { [key]: next };
      // Un-ticking Other drops its write-in text too, so no orphaned metadata is saved.
      if (!next.includes("Other")) patch[otherKey] = "";
      return patch as Partial<Answers>;
    });
    const typeOther = (text: string) => update((current) => {
      const now = current[key];
      const next = now.includes("Other") ? now : [...now.filter((item) => item !== exclusive), "Other"];
      return { [key]: next, [otherKey]: text } as Partial<Answers>;
    });
    return (
      <>
        <h2 className="quiz__title">{screen.title}</h2>
        <div className="quiz__options">
          {screen.options.map((label) => <Opt key={label} label={label} selected={chosen.includes(label)} onSelect={() => toggle(label)} />)}
          <OtherOpt selected={chosen.includes("Other")} placeholder={screen.otherWriteIn} value={answers[otherKey]} onSelect={() => toggle("Other")} onText={typeOther} />
          {exclusive && <Opt label={exclusive} selected={chosen.includes(exclusive)} onSelect={() => toggle(exclusive)} />}
        </div>
      </>
    );
  }

  if (screen.type === "radio") {
    return (
      <>
        <h2 className="quiz__title">{screen.title}</h2>
        <div className="quiz__options">
          {screen.options.map((label) => <Opt key={label} label={label} radio selected={answers.activity === label} onSelect={() => update({ activity: label })} />)}
        </div>
      </>
    );
  }

  if (screen.type === "yesno") {
    return (
      <>
        <h2 className="quiz__title">{screen.title}</h2>
        <YesNoRow value={answers[screen.id]} onChange={(value) => update({ [screen.id]: value } as Partial<Answers>)} />
      </>
    );
  }

  if (screen.type === "sleep") {
    const sleep = answers.sleep;
    // Functional patches: the three sleep controls share one object and must
    // not overwrite each other when answered in quick succession.
    const setSleep = (field: "enough" | "well" | "hours", value: string) =>
      update((current) => ({ sleep: { ...current.sleep, [field]: value } }));
    return (
      <>
        <div className="sleep-q"><h3>Do you feel like you get enough sleep?</h3><YesNoRow sub="enough" value={sleep.enough} onChange={(value) => setSleep("enough", value)} /></div>
        <div className="sleep-q"><h3>Do you sleep well?</h3><YesNoRow sub="well" value={sleep.well} onChange={(value) => setSleep("well", value)} /></div>
        <div className="sleep-q"><h3>How many hours do you sleep per night?</h3>
          <div style={{ textAlign: "center" }}>
            <input className="num-input" aria-label="Hours of sleep per night" inputMode="decimal" placeholder="Enter sleep hours" value={sleep.hours} onChange={(event) => setSleep("hours", event.target.value)} />
          </div>
        </div>
      </>
    );
  }

  // radioOther: diet / source
  const value = answers[screen.id];
  const setChoice = (choice: string) => update((current) => ({ [screen.id]: { ...current[screen.id], choice } } as Partial<Answers>));
  return (
    <>
      <h2 className="quiz__title">{screen.title}</h2>
      <div className="quiz__options">
        {screen.options.map((label) => <Opt key={label} label={label} radio selected={value.choice === label} onSelect={() => setChoice(label)} />)}
        <OtherOpt radio selected={value.choice === "Other"} placeholder={screen.otherPlaceholder} value={value.other}
          onSelect={() => setChoice("Other")}
          onText={(text) => update(() => ({ [screen.id]: { choice: "Other", other: text } } as Partial<Answers>))} />
      </div>
    </>
  );
}

/* ---------- result ---------- */

function Result({ view, onSignUp }: { view: ResultView; onSignUp: () => void }) {
  const [declined, setDeclined] = useState(false);
  const { result, stored } = view;
  const number = Number(result.displayed_score).toFixed(1);
  const pct = Math.round(result.displayed_score / 10 * 100);
  return (
    <div className="result">
      <h2 className="result__title">Your Health Number</h2>
      <div className="result__ring" style={{ "--pct": `${pct}%` } as React.CSSProperties}><b>{number}</b></div>
      <p className="result__scale">On a scale of 1 to 10, where 1 is very healthy and 10 is very unhealthy, your health number is <strong>{number}</strong>.</p>
      <p className="result__blurb">{result.interpretation}</p>
      {stored ? (
        <div className="result__actions">
          <Link className="quiz__btn quiz__btn--next" href="/app">Go to dashboard</Link>
        </div>
      ) : !declined ? (
        // Seeing the number does not sign anyone in: Sign Up is offered, and
        // declining keeps the result on screen (build/js/quiz.js renderResult).
        <div className="result__actions">
          <button className="quiz__btn quiz__btn--next" type="button" onClick={onSignUp}>Sign Up</button>
          <button className="quiz__btn quiz__btn--prev" type="button" onClick={() => setDeclined(true)}>Not now</button>
        </div>
      ) : (
        <p className="result__note">Your Health Number stays on this screen &mdash; you can create an account whenever you are ready. <Link href="/">Back to Veye</Link></p>
      )}
      <p className="result__version">Calculation version {result.calculation_version}</p>
    </div>
  );
}
