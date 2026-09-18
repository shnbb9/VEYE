"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Chip, EmptyState, Icon, fmtDate } from "@/components/admin/admin-chrome";
import { CompanionPage } from "@/components/admin/companion-page";
import { getConversation, listConversations, reviewConversation, type ConversationDetail, type ConversationSummary } from "@/lib/admin-api";

type Filter = "needs_review" | "reviewed" | "all";
const FILTERS: { key: Filter; label: string }[] = [{ key: "needs_review", label: "Needs review" }, { key: "reviewed", label: "Reviewed" }, { key: "all", label: "All" }];

export default function ConversationsPage() {
  return (
    <Suspense fallback={null}>
      <Conversations />
    </Suspense>
  );
}

function Conversations() {
  const params = useSearchParams();
  const preselect = params.get("conversation");
  const [filter, setFilter] = useState<Filter>(preselect ? "all" : "needs_review");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ConversationSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(preselect);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listConversations(filter, q).then((list) => {
      setRows(list);
      setSelected((current) => (current && list.some((row) => row.id === current) ? current : list[0]?.id ?? null));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Conversations could not be loaded."));
  }, [filter, q]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    getConversation(selected).then(setDetail).catch(() => setDetail(null));
  }, [selected]);

  async function markReviewed() {
    if (!detail) return;
    setBusy(true);
    try {
      await reviewConversation(detail.summary.id);
      load();
      setDetail(await getConversation(detail.summary.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The conversation could not be marked reviewed.");
    } finally { setBusy(false); }
  }

  const needsReview = rows?.filter((row) => row.flagged && !row.reviewed_at).length;

  return (
    <CompanionPage active="conversations" count={needsReview}>
      {error && <p className="errorbar">{error}</p>}
      <div className="review2">
        <div className="card">
          <div className="findbar" style={{ padding: "var(--s-4)" }}>
            <div className="search" style={{ flex: "1 1 100%", position: "relative" }}>
              <span className="search__icon"><Icon name="search" size={18} /></span>
              <label className="sr-only" htmlFor="cvSearch">Search conversations</label>
              <input className="search__input" id="cvSearch" type="search" placeholder="Search members and messages" value={q} onChange={(event) => setQ(event.target.value)} />
            </div>
            <div className="modeswitch" style={{ width: "100%", justifyContent: "space-between" }}>
              {FILTERS.map((item) => (
                <button key={item.key} className="modeswitch__btn" type="button" aria-selected={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}</button>
              ))}
            </div>
          </div>
          <div className="flaglist">
            {rows === null && <p className="loading-row">Loading…</p>}
            {rows && rows.length === 0 && (
              <div style={{ padding: "var(--s-6)" }}>
                <EmptyState icon={filter === "needs_review" ? "check-circle" : "search"} title={filter === "needs_review" ? "Nothing waiting for review" : "No conversations match"}
                            msg={filter === "needs_review" ? "Every conversation handed to a person has been read." : "Try a shorter search, or switch the filter to All."} />
              </div>
            )}
            {rows?.map((row) => (
              <button key={row.id} className={`flag${row.id === selected ? " is-active" : ""}`} type="button" onClick={() => setSelected(row.id)}>
                <span className="flag__top">
                  <span className="flag__who">{row.member_name}</span>
                  {row.flagged && !row.reviewed_at ? <span className="chip chip--attention chip--sm">Needs review</span>
                    : row.reviewed_at ? <span className="chip chip--live chip--sm">Reviewed</span> : <span className="chip chip--sm">Normal</span>}
                </span>
                <span className="flag__why">{row.first_message || "(no member message)"}</span>
                <span className="t-support" style={{ display: "block", marginTop: 4 }}>{fmtDate(row.last_message_at)} · {row.message_count} messages</span>
              </button>
            ))}
          </div>
          <div className="card__foot"><span className="t-support">Reading a conversation changes nothing. Marking it reviewed is recorded in the audit log.</span></div>
        </div>

        <div className="card">
          {!detail ? (
            <div className="card__body"><EmptyState icon="messages" title="Nothing selected" msg="Pick a conversation on the left." /></div>
          ) : (
            <>
              <div className="card__head">
                <div><h2 className="card__title">{detail.summary.member_name}</h2><p className="t-support">{detail.summary.member_email} · started {fmtDate(detail.summary.started_at)}</p></div>
                <div className="row gap-2">
                  {detail.summary.reviewed_at && <span className="chip chip--live">Reviewed</span>}
                  {detail.member.is_synthetic && <span className="chip chip--lime">Synthetic</span>}
                </div>
              </div>
              <div className="panel" style={{ margin: "var(--s-4) var(--s-5) 0" }}>
                <dl className="kv">
                  <dt>Health Number</dt><dd>{detail.member.health_number}</dd>
                  <dt>Member since</dt><dd>{fmtDate(detail.member.member_since)}</dd>
                  <dt>Email</dt><dd>{detail.member.email_verified ? "Verified" : "Not verified"}</dd>
                </dl>
              </div>
              <div className="convo convo--wide">
                {detail.messages.map((message) => (
                  <div key={message.id} className={`msg msg--${message.role === "member" ? "member" : "companion"}`}>
                    <div className="msg__meta">
                      {message.role === "member" ? detail.summary.member_name : "Sprout"}
                      {message.outcome && message.outcome !== "answered" && <> · <Chip label={message.outcome} /></>}
                      {message.policy_decision && message.role === "member" && <> · policy: {message.policy_decision.outcome}{message.policy_decision.category ? ` (${message.policy_decision.category})` : ""}</>}
                    </div>
                    <div className="msg__bubble">{message.content}</div>
                    {message.role === "sprout" && (
                      <div className="msg__sources">
                        {message.sources.length > 0 && <>Sources · {message.sources.length}: {message.sources.map((s) => `${s.title} v${s.source_version}`).join(", ")} · </>}
                        {message.provider ? `${message.provider}${message.model ? ` · ${message.model}` : ""} · ${message.latency_ms ?? 0} ms · safety ${message.safety_result ?? "—"}` : "no model call"}
                        {message.feedback && <> · feedback: {message.feedback.rating.replace("_", " ")}{message.feedback.reason ? ` (${message.feedback.reason})` : ""}</>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {detail.summary.flagged && !detail.summary.reviewed_at ? (
                <div className="held held--pinned">
                  <span className="held__label"><Icon name="lock" size={14} /> Handed to a person</span>
                  <div className="held__text">{detail.summary.flag_reason}</div>
                  <p className="t-support" style={{ marginTop: 12 }}>Sprout sent the member its escalation wording and did not generate an answer. The Veye team follows up outside the Companion.</p>
                  <div className="row gap-3 wrap" style={{ marginTop: 16 }}>
                    <button className="btn btn--primary btn--sm" type="button" onClick={() => void markReviewed()} disabled={busy}>Mark reviewed</button>
                  </div>
                </div>
              ) : (
                <div className="card__foot">
                  <span className="t-support">{detail.summary.reviewed_at ? `Reviewed by ${detail.summary.reviewed_by} on ${fmtDate(detail.summary.reviewed_at)}.` : "Nothing was handed to a person here. This is an ordinary conversation."}</span>
                  {!detail.summary.reviewed_at && <button className="btn btn--secondary btn--sm" type="button" onClick={() => void markReviewed()} disabled={busy}>Mark reviewed</button>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </CompanionPage>
  );
}
