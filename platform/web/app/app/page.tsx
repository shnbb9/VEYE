"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  getBloodMarkersHistory, getBodyCompositionHistory, getHealthAssessmentHistory, getHealthNumberHistory, getSimpleQuizHistory,
  type BloodMarkersHistory, type BodyCompositionHistory, type HealthAssessmentHistory, type HealthNumberHistoryItem, type SimpleQuizHistory,
} from "@/lib/api";
import { FIRST_TIME_FLOW, PROGRESS_GUIDE_FLOW, getGuidedOverview, skipFlow, type GuidedOverview } from "@/lib/guided-flows-api";
import { getMood, getPublishedContent, getSupportDetails, myRequests, sendMemberRequest, type MemberRequest, type MoodOverview, type SupportDetails } from "@/lib/member-api";
import { displayHealthNumber, prefersReducedMotion } from "@/lib/member-format";
import { useToast } from "@/components/member/member-chrome";
import { ContactUsDialog } from "@/components/member/contact-us-dialog";
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
  const [assessment, setAssessment] = useState<HealthAssessmentHistory | null>(null);
  const [quiz, setQuiz] = useState<SimpleQuizHistory | null>(null);
  const [guided, setGuided] = useState<GuidedOverview | null>(null);
  const [mood, setMood] = useState<MoodOverview | null>(null);
  const [dailyTip, setDailyTip] = useState<string | null | undefined>(undefined); // undefined = loading, null = none published
  const [support, setSupport] = useState<SupportDetails | null>(null);
  const [requests, setRequests] = useState<MemberRequest[] | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [betaBusy, setBetaBusy] = useState(false);
  const toast = useToast();
  const firstName = useSession().member?.first_name ?? "";

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getHealthNumberHistory(), getBodyCompositionHistory(), getBloodMarkersHistory(), getHealthAssessmentHistory(), getSimpleQuizHistory()]).then(([hn, bc, bm, ha, sq]) => {
      if (cancelled) return;
      if (hn.status === "fulfilled") {
        setHealth(hn.value.latest ? { kind: "taken", latest: hn.value.latest } : { kind: "untaken" });
      } else {
        setHealth({ kind: "error", message: (hn.reason as Error).message });
      }
      if (bc.status === "fulfilled") setBody(bc.value);
      if (bm.status === "fulfilled") setBlood(bm.value);
      if (ha.status === "fulfilled") setAssessment(ha.value);
      if (sq.status === "fulfilled") setQuiz(sq.value);
      // Overall Progress counts the five My Progress modules that hold a saved
      // result — all five are connected to the application now.
      const done = [hn, bc, bm, ha, sq].filter((r) => r.status === "fulfilled" && r.value.latest).length;
      setModulesDone(done);
    });
    getGuidedOverview().then((data) => { if (!cancelled) setGuided(data); }).catch(() => { /* Sprout offer simply stays generic */ });
    // The rest of the member's state: today's mood, the published daily tip,
    // the support address the console maintains, and the member's own requests.
    getMood().then((data) => { if (!cancelled) setMood(data); }).catch(() => { /* the Mood card rests */ });
    getPublishedContent("member_copy").then((entries) => {
      if (!cancelled) setDailyTip(entries.find((entry) => entry.key === "daily_health_tip")?.body ?? null);
    }).catch(() => { if (!cancelled) setDailyTip(null); });
    getSupportDetails().then((data) => { if (!cancelled) setSupport(data); }).catch(() => { /* the card keeps its approved address */ });
    myRequests().then((rows) => { if (!cancelled) setRequests(rows); }).catch(() => { if (!cancelled) setRequests([]); });
    return () => { cancelled = true; };
  }, []);

  const betaRequest = requests?.find((r) => r.kind === "join_beta") ?? null;
  async function joinBeta() {
    setBetaBusy(true);
    try {
      const sent = await sendMemberRequest({ kind: "join_beta", page: "/app" });
      setRequests(await myRequests());
      toast.flash(sent.already_open ? "Your Beta request is already with us" : "Thank you — your Beta request has been sent");
    } catch (reason) {
      toast.flash(reason instanceof Error ? reason.message : "The request could not be sent");
    } finally { setBetaBusy(false); }
  }

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
          <article className="card beta-card fade-in d2" data-testid="beta-card">
            <h2 className="beta-card__title"><img className="beta-card__icon" src="/assets/web/img/ic-beta.svg" alt="" />Join the Beta Test</h2>
            <img className="beta-card__art" src="/assets/web/img/dash-rocket.png" alt="People launching the Veye beta" />
            <p>When you Join the Veye Beta Test, you can experience our innovative platform, and take proactive measures in managing your health through a tailored nutrition program that goes beyond mere weight loss.</p>
            <div className="beta-card__actions">
              {betaRequest ? (
                <p className="beta-card__status" data-testid="beta-status">
                  {betaRequest.status === "resolved" ? "Your Beta request has been handled." : `Beta request sent ${new Date(betaRequest.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${betaRequest.status_label}`}
                </p>
              ) : (
                <button className="beta-card__btn" type="button" disabled={betaBusy} onClick={() => void joinBeta()} data-testid="beta-join">
                  {betaBusy ? "Sending…" : "Join the Beta Test"}
                </button>
              )}
            </div>
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
          <div className="card tip-card fade-in d3" data-testid="daily-tip">
            <div className="tip-icon-wrap"><img src="/assets/web/img/ic-daily.png" alt="" /></div>
            <h3>Daily Health tip</h3>
            {dailyTip === undefined && <p>&nbsp;</p>}
            {dailyTip && <TypedTip index={0}>{dailyTip}</TypedTip>}
            {dailyTip === null && <p className="tip-muted">Veye has not published a daily tip yet. Tips are written and published in the Veye console and appear here the moment one goes live.</p>}
          </div>

          <div className="card tip-card fade-in d4" data-testid="personal-tip">
            <div className="tip-icon-wrap"><img src="/assets/web/img/ic-personal.png" alt="" /></div>
            <h3>Personal tip</h3>
            <p className="tip-muted">Personal tips arrive with the Veye Companion release, once the client has defined how they are derived from your trackers. Nothing here is generated yet.</p>
            <span className="tip-proto">Not connected yet</span>
          </div>

          <div className="help-pair fade-in d5">
            <button className="mini-card mini-card--button" type="button" onClick={() => setContactOpen(true)} data-testid="contact-us">
              <div className="mini-card-icon">
                <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="9.5" width="30" height="21" rx="3.4"/><path d="M6.6 11.8 20 22l13.4-10.2"/></svg>
              </div>
              <div className="mini-card-label">Contact Us</div>
              <div className="mini-card-sub" data-testid="support-email">{support?.support_email ?? "contact@veye.co"}</div>
            </button>
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
          <Link className="activity-half" href="/app/mood" aria-label="Open the Mood Tracker" data-testid="mood-card">
            <div className="lbl">Mood</div>
            <div className="val">{mood?.latest ? `${MOOD_EMOJI[mood.latest.mood]} ${mood.latest.mood_label}` : "—"}</div>
            <div className="sub">{mood?.latest ? `last logged ${mood.latest.entry_date.slice(5).replace("-", "/")}` : "not logged yet"}</div>
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
        <TrackerGraph blood={blood} body={body} assessment={assessment} quiz={quiz} />
      </section>

      <ContactUsDialog open={contactOpen} supportEmail={support?.support_email ?? "contact@veye.co"} supportPhone={support?.support_phone ?? ""}
                       onClose={() => setContactOpen(false)} onSent={() => { setContactOpen(false); void myRequests().then(setRequests).catch(() => undefined); toast.flash("Thank you — your message has been sent to Veye"); }} />
    </>
  );
}

const MOOD_EMOJI: Record<string, string> = { happy: "😊", excited: "🤩", calm: "😌", neutral: "😐", tired: "😴", stressed: "😫", sad: "😔", angry: "😡" };

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
