"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/member/member-chrome";
import { useSession } from "@/components/session";
import { askSprout, clearConversation, getCompanionSession, sendFeedback, type CompanionSession, type Message, type Source } from "@/lib/companion-api";
import {
  FIRST_TIME_FLOW, PROGRESS_GUIDE_FLOW, answerFlow, askInFlow, getFlowSession, getGuidedOverview, pauseFlow, restartFlow, routeForAction,
  skipFlow, startFlow, type FlowSummary, type GuidedOverview, type Step,
} from "@/lib/guided-flows-api";
import { prefersReducedMotion } from "@/lib/member-format";

/* The approved Veye Companion view (build/dashboard.html, #view-bot): hero
   with the status pill, the full-width chat panel, quick replies, and the
   input bar with the "+" shortcut menu. Free conversation goes through the API
   pipeline (policy gate → approved knowledge → filtered context → provider →
   safety). Guided experiences — Cara's decision trees — run on the server
   (GuidedFlowService); this page renders the current step as Sprout bubbles,
   offers the step's options as buttons, and performs only the structured UI
   actions the server names. */

type Row = Message & { pending?: boolean; typed?: boolean; guided?: boolean };

const OUTCOME_NOTE: Record<string, string> = {
  prohibited: "Sprout does not give amounts or medical answers — a coach confirms those.",
  escalated: "Sprout handed this conversation to a person from the Veye team.",
  off_topic: "That question is outside what Sprout can help with.",
  unavailable: "Sprout could not generate a reply just now.",
};

const FLOW_LABEL: Record<string, string> = { [FIRST_TIME_FLOW]: "Introduction to the Veye program", [PROGRESS_GUIDE_FLOW]: "Progress Tracker Guide" };

let rowSeq = 0;
const localId = (prefix: string) => `${prefix}-${Date.now()}-${++rowSeq}`;
const sproutRow = (content: string, extra: Partial<Row> = {}): Row =>
  ({ id: localId("sprout"), role: "sprout", content, outcome: null, sources: [], feedback: null, created_at: new Date().toISOString(), typed: false, guided: true, ...extra });
const memberRow = (content: string): Row =>
  ({ id: localId("member"), role: "member", content, outcome: null, sources: [], feedback: null, created_at: new Date().toISOString(), typed: true, guided: true });

export default function CompanionPage() {
  return <Suspense fallback={null}><CompanionView /></Suspense>;
}

function CompanionView() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const initial = (useSession().account?.first_name?.[0] ?? "").toUpperCase();
  const [session, setSession] = useState<CompanionSession | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [guided, setGuided] = useState<GuidedOverview | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingNav = useRef<number | null>(null);

  const refreshGuided = useCallback(() => getGuidedOverview().then(setGuided).catch(() => setGuided(null)), []);

  useEffect(() => {
    let cancelled = false;
    getCompanionSession().then((data) => {
      if (cancelled) return;
      setSession(data);
      setRows(data.conversation.messages.map((m) => ({ ...m, typed: true })));
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Sprout is not available right now."); });
    void refreshGuided();
    return () => { cancelled = true; };
  }, [refreshGuided]);

  // Arriving with ?flow=<key> (from the dashboard offer, My Progress, or a START_FLOW action) starts or resumes that flow.
  const requestedFlow = params.get("flow");
  useEffect(() => {
    if (!requestedFlow || !guided) return;
    if (guided.flows.some((f) => f.key === requestedFlow)) void openFlow(requestedFlow, "start");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedFlow, guided !== null]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [rows, thinking]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);

  useEffect(() => () => { if (pendingNav.current) window.clearTimeout(pendingNav.current); }, []);

  /* ---------------- guided experiences ---------------- */
  function applyStep(next: Step, echo?: string) {
    const additions: Row[] = [];
    if (echo) additions.push(memberRow(echo));
    next.messages.forEach((text) => additions.push(sproutRow(text)));
    if (next.clarification) additions.push(sproutRow(next.clarification));
    if (next.node && !next.clarification) additions.push(sproutRow(next.node.text));
    if (next.status === "paused" && !next.node) additions.push(sproutRow("I have saved where we are — start the guide again whenever you are ready and we will pick up from here."));
    setRows((current) => [...current, ...additions]);
    setStep(next);
    void refreshGuided();
    // Structured UI actions only: the server names an application area, this page owns the route.
    for (const action of next.actions) {
      if (action.type === "START_FLOW" && action.target) {
        const target = action.target;
        pendingNav.current = window.setTimeout(() => { void openFlow(target, "start"); }, 900);
      } else {
        const route = routeForAction(action);
        if (route) pendingNav.current = window.setTimeout(() => router.push(route), 1400);
      }
    }
  }

  async function openFlow(key: string, mode: "start" | "restart" | "resume") {
    if (flowBusy) return;
    setFlowBusy(true); setError("");
    try {
      if (mode === "resume") {
        const current = await getFlowSession(key);
        if (current && (current.status === "in_progress" || current.status === "paused")) { applyStep(await startFlow(key)); return; }
      }
      applyStep(mode === "restart" ? await restartFlow(key) : await startFlow(key));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The guided experience could not start.");
    } finally { setFlowBusy(false); }
  }

  async function choose(key: string, label: string) {
    if (!step || flowBusy) return;
    setFlowBusy(true); setError("");
    try { applyStep(await answerFlow(step.flow_key, { choice: key }), label); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sprout could not record that choice."); }
    finally { setFlowBusy(false); }
  }

  async function pause() {
    if (!step) return;
    try { const paused = await pauseFlow(step.flow_key); setStep(paused); setRows((c) => [...c, sproutRow("Paused. Start the guide again whenever you like and we will continue from this step.")]); void refreshGuided(); }
    catch { toast.flash("Could not pause the guide"); }
  }

  async function explore() {
    try {
      const skipped = await skipFlow(FIRST_TIME_FLOW);
      setStep(null);
      setRows((c) => [...c, memberRow("I would like to explore on my own."), ...skipped.messages.map((m) => sproutRow(m))]);
      void refreshGuided();
    } catch { toast.flash("Could not save that choice"); }
  }

  const awaiting = step && step.status === "in_progress" && step.node && step.node.type !== "COMPLETE" ? step.node : null;

  /* ---------------- free conversation ---------------- */
  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking || !session) return;
    setError("");
    // A step is waiting: a question (ends with ?) goes to Sprout and the step stays; anything else answers the step.
    if (awaiting && step) {
      const isQuestion = /\?\s*$/.test(trimmed);
      if (!isQuestion) {
        setFlowBusy(true);
        try { applyStep(await answerFlow(step.flow_key, { text: trimmed }), trimmed); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Sprout could not read that reply."); }
        finally { setFlowBusy(false); }
        return;
      }
      const optimistic: Row = { ...memberRow(trimmed), guided: false, pending: true };
      setRows((current) => [...current, optimistic]);
      setThinking(true);
      try {
        const { reply, step: same } = await askInFlow(step.flow_key, trimmed);
        setRows((current) => [
          ...current.filter((row) => row.id !== optimistic.id),
          { ...optimistic, id: reply.member_message_id, pending: false },
          { id: reply.reply_message_id, role: "sprout", content: reply.reply, outcome: reply.outcome, sources: reply.sources, feedback: null, created_at: new Date().toISOString(), typed: false },
          sproutRow(`Back to where we were: ${same.node?.text ?? ""}`),
        ]);
        setStep(same);
      } catch (reason) {
        setRows((current) => current.filter((row) => row.id !== optimistic.id));
        setError(reason instanceof Error ? reason.message : "Sprout could not answer just now.");
      } finally { setThinking(false); }
      return;
    }
    const optimistic: Row = { id: localId("pending"), role: "member", content: trimmed, outcome: null, sources: [], feedback: null, created_at: new Date().toISOString(), pending: true, typed: true };
    setRows((current) => [...current, optimistic]);
    setThinking(true);
    try {
      const reply = await askSprout(trimmed, session.conversation.id);
      setRows((current) => [
        ...current.filter((row) => row.id !== optimistic.id),
        { ...optimistic, id: reply.member_message_id, pending: false },
        { id: reply.reply_message_id, role: "sprout", content: reply.reply, outcome: reply.outcome, sources: reply.sources, feedback: null, created_at: new Date().toISOString(), typed: false },
      ]);
      setSession((current) => current ? { ...current, conversation: { ...current.conversation, id: reply.conversation_id, message_count: current.conversation.message_count + 2 } } : current);
    } catch (reason) {
      setRows((current) => current.filter((row) => row.id !== optimistic.id));
      setError(reason instanceof Error ? reason.message : "Sprout could not answer just now.");
    } finally { setThinking(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = input;
    setInput("");
    void send(text);
    inputRef.current?.focus();
  }

  async function clear() {
    try {
      const conversation = await clearConversation();
      setRows([]);
      setSession((current) => current ? { ...current, conversation, welcome: current.welcome } : current);
    } catch { toast.flash("Could not clear the conversation"); }
  }

  async function rate(message: Row, rating: "helpful" | "not_helpful", reason?: string) {
    try {
      const feedback = await sendFeedback(message.id, rating, reason);
      setRows((current) => current.map((row) => (row.id === message.id ? { ...row, feedback } : row)));
      toast.flash(rating === "helpful" ? "Marked as helpful" : "Thank you — feedback noted");
    } catch { toast.flash("Feedback could not be saved"); }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => toast.flash("Message copied")).catch(() => toast.flash("Copy is not available"));
  }

  const status = thinking ? "thinking" : speaking ? "speaking" : "online";
  const label = thinking ? "Thinking" : speaking ? "Speaking" : session && !session.enabled ? "Offline" : "Online";
  const showQuick = session !== null && rows.length === 0 && !awaiting;
  const name = session?.name ?? "Sprout";
  const flowsAvailable = guided?.flows ?? [];

  return (
    <>
      <header className="bot-hero fade-in">
        <div className="bot-hero-text">
          <span className="mood-eyebrow">Veye Companion</span>
          <h1>Meet <span className="bot-name-highlight">{name}</span>, your Veye companion</h1>
          <p>Ask me anything &mdash; meal ideas, stress tips, supplement timing, progress check-ins. I&rsquo;m here whenever you need a nudge.</p>
        </div>
        <div className="bot-status" data-state={status}>
          <span className="status-dot" />
          <span className="status-label">{label}</span>
        </div>
      </header>

      <div className="bot-layout fade-in d1">
        <section className="chat-panel">
          <header className="chat-panel-head">
            <div className="chat-panel-title"><span className="status-mini-dot" />Conversation</div>
            <button className="chat-clear" type="button" aria-label="Clear chat" onClick={() => void clear()}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h10M6 5V3h4v2M5 5v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V5" /></svg>
              Clear
            </button>
          </header>

          {step && step.status !== "skipped" && (
            <div className="guided-bar" role="status" aria-live="polite">
              <span className="guided-bar__label">
                <span className="guided-bar__dot" aria-hidden="true" />
                {step.flow_title}{step.section_title ? <> &middot; {step.section_title}</> : null}
                {step.status === "paused" && <> &middot; paused</>}
                {step.status === "completed" && <> &middot; complete</>}
              </span>
              <span className="guided-bar__actions">
                {step.status === "in_progress" && <button type="button" className="guided-bar__btn" onClick={() => void pause()}>Pause</button>}
                {step.status === "paused" && <button type="button" className="guided-bar__btn" onClick={() => void openFlow(step.flow_key, "start")}>Resume</button>}
                {step.status === "completed" && <button type="button" className="guided-bar__btn" onClick={() => void openFlow(step.flow_key, "restart")}>Start again</button>}
                <button type="button" className="guided-bar__btn guided-bar__btn--quiet" onClick={() => setStep(null)} aria-label="Hide the guide bar">Close</button>
              </span>
            </div>
          )}

          <div className="chat-thread" ref={threadRef} aria-live="polite">
            {session && rows.length === 0 && !thinking && (
              <BotRow content={session.welcome} typed={false} onTypingChange={setSpeaking} />
            )}
            {rows.map((row) => row.role === "member"
              ? <UserRow key={row.id} row={row} initial={initial} onCopy={copy} />
              : <BotRow key={row.id} row={row} content={row.content} typed={row.typed !== false} onTypingChange={setSpeaking}
                        onRate={row.guided ? undefined : (rating, reason) => void rate(row, rating, reason)} onCopy={copy} />)}
            {thinking && (
              <div className="msg-row bot msg-typing" id="typingIndicator">
                <div className="msg-avatar">🌱</div>
                <div className="msg-bubble"><span className="dot" /><span className="dot" /><span className="dot" /></div>
              </div>
            )}
            {error && <p className="chat-error" role="alert">{error}</p>}
            {session && !session.enabled && <p className="chat-error" role="status">Sprout is switched off at the moment.</p>}
          </div>

          {/* Step options: Cara's decision trees are yes/no by design, so the branches are explicit buttons. */}
          {awaiting && (
            <div className="quick-replies guided-choices" id="guidedChoices">
              <span className="qr-label">{awaiting.type === "QUESTION" ? "When you're ready:" : "Choose:"}</span>
              {awaiting.type === "QUESTION"
                ? <button className="qr-btn qr-btn--guided" type="button" disabled={flowBusy} onClick={() => void choose("", awaiting.answer_label ?? "Continue")}>{awaiting.answer_label ?? "Continue"}</button>
                : awaiting.choices.map((choice) => (
                  <button key={choice.key} className="qr-btn qr-btn--guided" type="button" disabled={flowBusy} onClick={() => void choose(choice.key, choice.label)}>{choice.label}</button>
                ))}
            </div>
          )}

          {/* Guided experiences available when nothing is waiting */}
          {!awaiting && guided && flowsAvailable.length > 0 && (
            <div className="quick-replies guided-offer" id="guidedOffer">
              <span className="qr-label">{guided.first_arrival_offer ? "New here?" : "Guided experiences:"}</span>
              {guided.first_arrival_offer ? (
                <>
                  <button className="qr-btn qr-btn--guided" type="button" disabled={flowBusy} onClick={() => void openFlow(FIRST_TIME_FLOW, "start")}>Guide me</button>
                  <button className="qr-btn" type="button" disabled={flowBusy} onClick={() => void explore()}>Explore on my own</button>
                </>
              ) : flowsAvailable.map((flow) => <FlowChip key={flow.key} flow={flow} busy={flowBusy} onOpen={openFlow} />)}
            </div>
          )}

          <div className={`quick-replies${showQuick ? "" : " hidden"}`} id="quickReplies">
            <span className="qr-label">Try asking:</span>
            {(session?.quick_prompts ?? []).map((prompt) => (
              <button key={prompt.id} className="qr-btn" type="button" onClick={() => void send(prompt.prompt)}>{prompt.label}</button>
            ))}
          </div>

          <form className="chat-input" id="chatForm" onSubmit={submit}>
            <div ref={menuRef} style={{ display: "contents" }}>
              <button type="button" className="chat-attach" aria-label="Open quick actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="4" x2="10" y2="16" /><line x1="4" y1="10" x2="16" y2="10" /></svg>
              </button>
              <div className="chat-add-menu" role="menu" hidden={!menuOpen}>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void openFlow(PROGRESS_GUIDE_FLOW, "start"); }}>Progress Tracker Guide</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void openFlow(FIRST_TIME_FLOW, "start"); }}>Introduction to Veye</button>
                <button type="button" role="menuitem" onClick={() => router.push("/app/food-diary")}>Add a food diary entry</button>
                <button type="button" role="menuitem" onClick={() => router.push("/app/mood")}>Log today&rsquo;s mood</button>
                <button type="button" role="menuitem" onClick={() => router.push("/app/progress")}>View My Progress</button>
              </div>
            </div>
            <input ref={inputRef} id="chatInput" type="text" autoComplete="off" maxLength={500}
                   placeholder={awaiting ? "Type an answer, or ask a question ending with ?" : `Ask ${name} anything…`}
                   value={input} onChange={(event) => setInput(event.target.value)} disabled={session ? !session.enabled : false} />
            <button type="submit" className="chat-send" aria-label="Send message" disabled={thinking || flowBusy || !input.trim()}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 10 L18 2 L14 18 L10 12 L2 10 Z" /><line x1="10" y1="12" x2="18" y2="2" /></svg>
            </button>
          </form>
        </section>
      </div>
    </>
  );
}

function FlowChip({ flow, busy, onOpen }: { flow: FlowSummary; busy: boolean; onOpen: (key: string, mode: "start" | "restart" | "resume") => Promise<void> }) {
  const session = flow.session;
  const label = FLOW_LABEL[flow.key] ?? flow.title;
  if (session?.status === "in_progress" || session?.status === "paused") {
    return <button className="qr-btn qr-btn--guided" type="button" disabled={busy} onClick={() => void onOpen(flow.key, "start")}>{session.status === "paused" ? "Resume" : "Continue"}: {label}</button>;
  }
  if (session?.status === "completed") {
    return <button className="qr-btn" type="button" disabled={busy} onClick={() => void onOpen(flow.key, "restart")}>{label} again</button>;
  }
  return <button className="qr-btn qr-btn--guided" type="button" disabled={busy} onClick={() => void onOpen(flow.key, "start")}>{label}</button>;
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function UserRow({ row, initial, onCopy }: { row: Row; initial: string; onCopy: (text: string) => void }) {
  return (
    <div className="msg-row user" style={row.pending ? { opacity: 0.7 } : undefined}>
      <div className="msg-avatar">{initial || "•"}</div>
      <div className="msg-content">
        <div className="msg-bubble">{row.content}</div>
        <div className="msg-meta">
          <span className="msg-time">{timeOf(row.created_at)}</span>
          <span className="msg-actions"><button type="button" className="msg-action" onClick={() => onCopy(row.content)}>Copy</button></span>
        </div>
      </div>
    </div>
  );
}

function BotRow({ row, content, typed, onTypingChange, onRate, onCopy }: {
  row?: Row; content: string; typed: boolean; onTypingChange: (typing: boolean) => void;
  onRate?: (rating: "helpful" | "not_helpful", reason?: string) => void; onCopy?: (text: string) => void;
}) {
  const [shown, setShown] = useState(typed ? content : "");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    if (typed) { setShown(content); return; }
    if (prefersReducedMotion()) { setShown(content); return; }
    let index = 0;
    let frame = 0;
    onTypingChange(true);
    const tick = () => {
      index = Math.min(content.length, index + 2);
      setShown(content.slice(0, index));
      if (index < content.length) frame = window.setTimeout(tick, 16);
      else onTypingChange(false);
    };
    tick();
    return () => { window.clearTimeout(frame); onTypingChange(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, typed]);

  const helpful = row?.feedback?.rating === "helpful";
  const note = row?.outcome ? OUTCOME_NOTE[row.outcome] : undefined;
  const sources: Source[] = row?.sources ?? [];

  return (
    <div className="msg-row bot">
      <div className="msg-avatar">🌱</div>
      <div className="msg-content">
        <div className="msg-bubble"><span className="msg-typewriter">{shown}</span></div>
        {note && <p className="msg-note">{note}</p>}
        {sources.length > 0 && (
          <div className="msg-sources">
            <button type="button" className="msg-action msg-sources__toggle" aria-expanded={sourcesOpen} onClick={() => setSourcesOpen((open) => !open)}>
              Sources · {sources.length}
            </button>
            {sourcesOpen && (
              <ul className="msg-sources__list">
                {sources.map((source) => (
                  <li key={source.chunk_id}>{source.title} <span className="msg-sources__meta">v{source.source_version} · match {Math.round(source.score * 100)}%</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
        {row && (
          <>
            <div className="msg-meta">
              <span className="msg-time">{timeOf(row.created_at)}</span>
              <span className="msg-actions">
                <button type="button" className="msg-action" onClick={() => onCopy?.(content)}>Copy</button>
                {onRate && <button type="button" className="msg-action" aria-pressed={helpful} onClick={() => onRate("helpful")}>Helpful</button>}
                {onRate && <button type="button" className="msg-action" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((open) => !open)}>Feedback</button>}
              </span>
            </div>
            {onRate && (
              <div className="msg-feedback" hidden={!feedbackOpen}>
                {["Not relevant", "Incorrect", "Other"].map((reason) => (
                  <button key={reason} type="button" onClick={() => { setFeedbackOpen(false); onRate("not_helpful", reason); }}>{reason}</button>
                ))}
              </div>
            )}
            {row.feedback && row.feedback.rating === "not_helpful" && <p className="msg-note">Feedback noted{row.feedback.reason ? `: ${row.feedback.reason}` : ""}.</p>}
          </>
        )}
      </div>
    </div>
  );
}
