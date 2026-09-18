"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  getBloodMarkersHistory, getBodyCompositionHistory, getHealthNumberHistory,
  type BloodMarkersHistory, type BodyCompositionHistory, type HealthNumberHistoryItem,
} from "@/lib/api";
import { FIRST_TIME_FLOW, PROGRESS_GUIDE_FLOW, getGuidedOverview, skipFlow, type GuidedOverview } from "@/lib/guided-flows-api";
import { displayHealthNumber, prefersReducedMotion } from "@/lib/member-format";
import { useToast } from "@/components/member/member-chrome";
import { TrackerGraph } from "@/components/member/tracker-graph";
import { useSession } from "@/components/session";

/* The approved Dashboard (build/dashboard.html, #view-dashboard): three fixed
   columns — Health Number · Join the Beta Test + Veye Companion · tips and
   help — followed by the Activity Tracker row. Copy and structure are the
   prototype's; the Health Number comes from the persisted API result. */

type HealthState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "untaken" }
  | { kind: "taken"; latest: HealthNumberHistoryItem };

const SCALE_SENTENCE_PREFIX = "On a scale of 1 to 10, where 1 is very healthy and 10 is very unhealthy, your health number is ";

export default function MemberDashboard() {
  const router = useRouter();
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });
  const [modulesDone, setModulesDone] = useState<number | null>(null);
  const [body, setBody] = useState<BodyCompositionHistory | null>(null);
  const [blood, setBlood] = useState<BloodMarkersHistory | null>(null);
  const [guided, setGuided] = useState<GuidedOverview | null>(null);
  const toast = useToast();
  const firstName = useSession().account?.first_name ?? "";

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getHealthNumberHistory(), getBodyCompositionHistory(), getBloodMarkersHistory()]).then(([hn, bc, bm]) => {
      if (cancelled) return;
      if (hn.status === "fulfilled") {
        setHealth(hn.value.latest ? { kind: "taken", latest: hn.value.latest } : { kind: "untaken" });
      } else {
        setHealth({ kind: "error", message: (hn.reason as Error).message });
      }
      if (bc.status === "fulfilled") setBody(bc.value);
      if (bm.status === "fulfilled") setBlood(bm.value);
      // Overall Progress counts the five My Progress modules that hold a saved
      // result. Health Number, Body Composition and Blood Test Markers are the
      // modules connected to the application today; the others cannot have
      // saved results yet.
      const done = (hn.status === "fulfilled" && hn.value.latest ? 1 : 0)
        + (bc.status === "fulfilled" && bc.value.latest ? 1 : 0)
        + (bm.status === "fulfilled" && bm.value.latest ? 1 : 0);
      setModulesDone(done);
    });
    getGuidedOverview().then((data) => { if (!cancelled) setGuided(data); }).catch(() => { /* Sprout offer simply stays generic */ });
    return () => { cancelled = true; };
  }, []);

  // Cara: a new member is offered the guide once ("Guide me" / "Explore on my own");
  // either answer settles it and Sprout stays available for both guided flows later.
  const firstArrival = guided?.first_arrival_offer === true;
  const introSession = guided?.flows.find((f) => f.key === FIRST_TIME_FLOW)?.session ?? null;
  const guideSession = guided?.flows.find((f) => f.key === PROGRESS_GUIDE_FLOW)?.session ?? null;
  async function exploreOnMyOwn() {
    try {
      const step = await skipFlow(FIRST_TIME_FLOW);
      setGuided((current) => current ? { ...current, first_arrival_offer: false } : current);
      toast.flash(step.messages[0] ?? "Explore the dashboard at your own pace.");
    } catch { toast.flash("Explore the dashboard at your own pace."); }
  }

  const taken = health.kind === "taken";
  const number = taken ? displayHealthNumber(health.latest.displayed_score) : null;

  return (
    <>
      <div className="welcome fade-in">
        <h1>Welcome back{firstName ? ` ${firstName}` : ""}</h1>
      </div>

      <div className="grid">
        {/* ============ COLUMN 1: HEALTH NUMBER ============ */}
        <div className="col col--hn">
          <div className={`card health-card hn-anchor${taken ? "" : " is-untaken"} fade-in d1`}>
            <div className="card-title">
              <svg className="card-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-4.5-7-11a7 7 0 0 1 14 0c0 6.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
              Your Veye health number
            </div>

            <div className="hn-anchor-body">
              <Link href="/onboarding" className="health-badge-block health-badge-block--xl" aria-label="Open the Health Number assessment">
                <div className="health-badge health-badge--xl"><span className="health-num"><CountUp value={number} /></span></div>
              </Link>
              <div className="hn-anchor-text">
                {taken && <p className="hn-anchor-scale">{SCALE_SENTENCE_PREFIX}<strong>{number}</strong>.</p>}
                <p className="hn-anchor-desc" role={health.kind === "error" ? "alert" : undefined}>
                  {health.kind === "loading" && "Loading your saved result…"}
                  {health.kind === "error" && health.message}
                  {health.kind === "untaken" && "Complete the Health Number assessment to see your result."}
                  {taken && health.latest.interpretation}
                </p>
                <Link className="hn-anchor-cta" href="/onboarding">
                  {taken ? "Retake the assessment " : "Take the assessment "}
                  <span className="arrow arrow--ring" aria-hidden="true">
                    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="14" cy="14" r="13"/><path d="M6.5 14h14.2M16.6 9.9L20.8 14l-4.2 4.1"/></svg>
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ============ COLUMN 2: BETA + COMPANION ============ */}
        <div className="col col--engagement">
          <article className="card beta-card fade-in d2">
            <h2 className="beta-card__title"><img className="beta-card__icon" src="/assets/web/img/ic-beta.svg" alt="" />Join the Beta Test</h2>
            <img className="beta-card__art" src="/assets/web/img/dash-rocket.png" alt="People launching the Veye beta" />
            <p>When you Join the Veye Beta Test, you can experience our innovative platform, and take proactive measures in managing your health through a tailored nutrition program that goes beyond mere weight loss.</p>
          </article>

          <article className="card dash-companion-card fade-in d3">
            <h2 className="dash-companion-card__title">
              <img className="dash-companion-card__icon" src="/mascot.png" alt="" />
              Veye Companion
            </h2>
            <p>
              {taken
                ? `Hi ${firstName || "there"}, welcome to Veye. Your health number is ${number}. ${health.latest.interpretation} Would you like guided setup, or do you prefer to explore on your own?`
                : `Hi ${firstName || "there"}, welcome to Veye. Complete your Health Number assessment so I can tailor a guided setup, or explore the dashboard on your own.`}
            </p>
            <div className="dash-companion-card__actions">
              {firstArrival || !guided ? (
                <>
                  <Link href={`/app/companion?flow=${FIRST_TIME_FLOW}`} role="button">Guided setup</Link>
                  <button type="button" onClick={() => void exploreOnMyOwn()}>Explore on my own</button>
                </>
              ) : (
                <>
                  {introSession && (introSession.status === "in_progress" || introSession.status === "paused")
                    ? <Link href={`/app/companion?flow=${FIRST_TIME_FLOW}`} role="button">Continue the introduction</Link>
                    : <Link href={`/app/companion?flow=${PROGRESS_GUIDE_FLOW}`} role="button">{guideSession?.status === "completed" ? "Progress Tracker Guide again" : guideSession ? "Continue the Progress Tracker Guide" : "Progress Tracker Guide"}</Link>}
                  <button type="button" onClick={() => router.push("/app/companion")}>Talk to Sprout</button>
                </>
              )}
            </div>
          </article>
        </div>

        {/* ============ COLUMN 3: TIPS + HELP ============ */}
        <div className="col">
          <div className="card tip-card fade-in d3">
            <div className="tip-icon-wrap"><img src="/assets/web/img/ic-daily.png" alt="" /></div>
            <h3>Daily Health tip</h3>
            <TypedTip index={0}>Although you are in moderately good health, incorporating better food choices and implementing some lifestyle changes will help you optimize your health, prevent disease, and slow aging.</TypedTip>
            <span className="tip-proto">Prototype preview</span>
          </div>

          <div className="card tip-card fade-in d4">
            <div className="tip-icon-wrap"><img src="/assets/web/img/ic-personal.png" alt="" /></div>
            <h3>Personal tip</h3>
            <TypedTip index={1}>Sample personal tip of the day. Click to learn more.</TypedTip>
            <span className="tip-proto">Prototype preview</span>
          </div>

          <div className="help-pair fade-in d5">
            <a className="mini-card" href="mailto:contact@veye.co">
              <div className="mini-card-icon">
                <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="9.5" width="30" height="21" rx="3.4"/><path d="M6.6 11.8 20 22l13.4-10.2"/></svg>
              </div>
              <div className="mini-card-label">Contact Us</div>
              <div className="mini-card-sub">contact@veye.co</div>
            </a>
            <Link className="mini-card mini-card--faq" href="/help">
              <div className="mini-card-icon">
                <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="20" cy="20" r="16"/><circle cx="20" cy="20" r="6.4"/><path d="M8.7 8.7l6.8 6.8M31.3 8.7l-6.8 6.8M31.3 31.3l-6.8-6.8M8.7 31.3l6.8-6.8"/></svg>
              </div>
              <div className="mini-card-label mini-card-label--long">Help &amp; FAQs</div>
              <div className="mini-card-sub">Answers for your Veye journey</div>
            </Link>
          </div>
        </div>
      </div>

      {/* Activity Tracker (WordPress dash1a) */}
      <h2 className="activity-title">Activity Tracker</h2>
      <div className="activity-row fade-in">
        <div className="activity-card activity-card--hr" role="group" aria-label="Exercise — in development">
          <div className="activity-icon"><img src="/assets/web/img/act-heart.png" alt="" /></div>
          <div className="activity-info"><div className="lbl">Exercise</div><div className="val val--indev">In Development</div></div>
          <div className="activity-spark"><svg viewBox="0 0 92 34"><path d="M0 17 H2 L3 14 L4 18 L5 32 L8.5 2 L11 20 L13 14 L15 18 L17 17 H40 L41.5 14 L43 18 L45 32 L48.5 2 L51 20 L53 14 L55 18 L57 17 H92"/></svg></div>
        </div>
        <div className="activity-card activity-card--walk" role="group" aria-label="Meditation — in development">
          <div className="activity-icon">
            <svg className="activity-icon-svg" viewBox="0 0 40 40" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="20" cy="9.2" r="3.6"/><path d="M20 13.4v6.2"/><path d="M20 19.6c-3.4 0-6.4 2-7.8 5.2"/><path d="M20 19.6c3.4 0 6.4 2 7.8 5.2"/><path d="M12.2 24.8c-2.6 1.2-4.2 2.9-4.2 4.7 0 1.1.8 2 2.1 2.6"/><path d="M27.8 24.8c2.6 1.2 4.2 2.9 4.2 4.7 0 1.1-.8 2-2.1 2.6"/><path d="M13.6 30.4c1.5 1.4 3.8 2.2 6.4 2.2s4.9-.8 6.4-2.2"/></svg>
          </div>
          <div className="activity-info"><div className="lbl">Meditation</div><div className="val val--indev">In Development</div></div>
          <div className="activity-spark"><svg viewBox="0 0 92 34"><path d="M0 32 L3 30 L6 28 L9 24 L12 21 L15 21 L18 24 L21 28 L24 28 L27 24 L30 16 L33 13 L36 15 L39 20 L42 21 L45 15 L48 5 L51 2 L54 4 L57 9 L60 13 L63 14 L66 13 L69 11 L72 10 L75 11 L78 13 L82 13 L85 11 L88 8 L91 4"/></svg></div>
        </div>
        <div className="activity-card activity-card--run activity-card--split" role="group" aria-label="Overall progress and mood">
          <Link className="activity-half" href="/app/progress" aria-label="Open My Progress">
            <div className="lbl">Overall Progress</div>
            <div className="val">{modulesDone === null ? "—" : `${modulesDone}/5`}</div>
            <div className="sub">{modulesDone === null ? "modules updated" : modulesDone === 0 ? "no modules updated yet" : "modules with saved results"}</div>
            <span className="activity-progress-graph" aria-label="Progress tracker completion graph">
              {[0, 1, 2, 3, 4].map((i) => <i key={i} data-graph-bar={i} className={modulesDone !== null && i < modulesDone ? "is-done" : undefined} />)}
            </span>
          </Link>
          <span className="activity-split-divider" aria-hidden="true" />
          <Link className="activity-half" href="/app/mood" aria-label="Open the Mood Tracker">
            <div className="lbl">Mood</div>
            <div className="val">—</div>
            <div className="sub">not logged yet</div>
          </Link>
        </div>
      </div>

      {/* Progress Trackers line graph (Cara, Progress Trackers Decision Tree): real
          dated results per tracker; unused or unconnected trackers stay at rest. */}
      <section className="card tracker-card fade-in" aria-labelledby="trackerGraphTitle">
        <div className="tracker-card__head">
          <h2 id="trackerGraphTitle" className="activity-title tracker-card__title">Progress Trackers</h2>
          <Link className="tracker-card__link" href={`/app/companion?flow=${PROGRESS_GUIDE_FLOW}`}>Let Sprout guide you</Link>
        </div>
        <TrackerGraph blood={blood} body={body} />
      </section>
    </>
  );
}

/** Counts the badge up to its value once, exactly as the prototype does; the
 *  final one-decimal value is always written, instantly under reduced motion. */
function CountUp({ value }: { value: string | null }) {
  const [shown, setShown] = useState<string>(value ?? "—");
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (value === null) { setShown("—"); return; }
    if (counted.current === value) { setShown(value); return; }
    counted.current = value;
    const target = parseFloat(value);
    if (Number.isNaN(target) || prefersReducedMotion()) { setShown(value); return; }
    const duration = 650;
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown((target * eased).toFixed(1));
      if (k < 1) frame = requestAnimationFrame(step); else setShown(value);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <strong>{shown}</strong>;
}

/** The tip copy "types in" as the dashboard opens (client request). The text
 *  is the stored copy — deterministic, not an AI service — and reduced motion
 *  shows it at once. */
function TypedTip({ children, index }: { children: string; index: number }) {
  const [shown, setShown] = useState(children);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    // Reserve the full paragraph's height first so nothing jumps while typing.
    setMinHeight(ref.current?.offsetHeight);
    let pos = 0;
    let frame = 0;
    const t0 = performance.now() + index * 350;
    setShown("");
    const step = (now: number) => {
      if (now < t0) { frame = requestAnimationFrame(step); return; }
      pos = Math.min(children.length, pos + 2);
      setShown(children.slice(0, pos));
      if (pos < children.length) frame = requestAnimationFrame(step);
      else setMinHeight(undefined);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [children, index]);
  return <p ref={ref} style={minHeight ? { minHeight } : undefined}>{shown}</p>;
}
