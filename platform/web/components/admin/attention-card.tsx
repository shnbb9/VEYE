"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Chip, EmptyState, Icon, fmtDate } from "@/components/admin/admin-chrome";
import { PriorityChip } from "@/components/admin/member-cells";
import { getAttention, type AttentionItem, type AttentionPage, type AttentionQuery } from "@/lib/admin-console-api";

/* Home → Needs your attention (Cara, 15 Nov): messages and handed-over Sprout
   conversations in one list. It owns nothing — every row opens where the
   message lives — and it keeps "somebody read it" apart from "somebody
   answered it". */

const LABEL: Record<AttentionItem["state"], string> = {
  reply_needed: "Reply needed", reply_failed: "Reply not delivered", review_needed: "Review needed",
  replied: "Replied, not resolved", reviewed: "Reviewed, not resolved", resolved: "Resolved",
};
const TONE: Record<AttentionItem["state"], string> = {
  reply_needed: "attention", reply_failed: "error", review_needed: "attention", replied: "info", reviewed: "info", resolved: "live",
};
const SHOW: { key: NonNullable<AttentionQuery["state"]>; label: string }[] = [
  { key: "waiting", label: "Waiting" }, { key: "replied", label: "Replied" }, { key: "reviewed", label: "Reviewed" }, { key: "resolved", label: "Resolved" },
];
const href = (item: AttentionItem) => item.source === "request" ? `/admin/requests?view=all&id=${item.id}` : `/admin/companion/conversations?conversation=${item.id}`;

export function AttentionCard() {
  const [query, setQuery] = useState<AttentionQuery>({ state: "waiting", who: "any", priority: "any", page: 1, page_size: 6 });
  const [page, setPage] = useState<AttentionPage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getAttention(query).then((next) => { if (live) { setPage(next); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [query]);

  const set = (patch: Partial<AttentionQuery>) => setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  const pages = page ? Math.max(1, Math.ceil(page.total / page.page_size)) : 1;

  return (
    <section className="card" data-testid="attention" aria-labelledby="attentionTitle" style={{ marginTop: "var(--s-6)" }}>
      <div className="card__head">
        <div><h2 className="card__title" id="attentionTitle"><Icon name="inbox" /> Needs your attention</h2>
          <p className="t-support">Messages nobody has answered and questions Sprout handed to a person. Importance first, then the oldest.</p></div>
      </div>
      <div className="findbar">
        <div className="modeswitch" role="tablist" aria-label="Which items">
          {SHOW.map((item) => (
            <button key={item.key} className="modeswitch__btn" type="button" role="tab" aria-selected={query.state === item.key} onClick={() => set({ state: item.key })}>
              {item.label}{page ? ` (${page.counts[item.key] ?? 0})` : ""}
            </button>
          ))}
        </div>
        <span className="findbar__spacer" />
        <div className="findbar__filters">
          <div className="field" style={{ margin: 0 }}><label className="sr-only" htmlFor="attWho">From</label>
            <select className="select input--sm" id="attWho" value={query.who} onChange={(event) => set({ who: event.target.value as AttentionQuery["who"] })}>
              <option value="any">From anyone</option><option value="member">From active members</option><option value="visitor">From visitors</option>
            </select></div>
          <div className="field" style={{ margin: 0 }}><label className="sr-only" htmlFor="attPriority">Importance</label>
            <select className="select input--sm" id="attPriority" value={query.priority} onChange={(event) => set({ priority: event.target.value as AttentionQuery["priority"] })}>
              <option value="any">Any importance</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="unassigned">Not set</option>
            </select></div>
        </div>
      </div>
      {failed && <p className="t-support" style={{ padding: 20 }} role="alert">This list could not be loaded. Requests &amp; Inbox and Companion still work.</p>}
      {!page && !failed && <p className="loading-row">Loading…</p>}
      {page && !failed && page.rows.length === 0 && <div className="card__body"><EmptyState icon="check-circle" title={query.state === "waiting" ? "Nothing is waiting" : "Nothing here"} msg={query.state === "waiting" ? "Every message has been answered and every handed-over conversation has been read." : "No item is in this state."} /></div>}
      {page && !failed && page.rows.length > 0 && (
        <div className="rows" data-testid="attention-list">
          {page.rows.map((item) => (
            <div className="rowitem" key={`${item.source}-${item.id}`} data-testid="attention-row" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
              <span className="rowitem__icon"><Icon name={item.source === "request" ? "mail" : "sprout"} size={18} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="rowitem__title">{item.title} <Chip label={LABEL[item.state]} tone={TONE[item.state]} /> <PriorityChip priority={item.priority} /></div>
                <div className="rowitem__meta">{item.person}{item.person_kind === "visitor" ? " (visitor)" : item.person_kind === "former" ? " (no longer a member)" : ""} · {fmtDate(item.at)}</div>
                {item.detail && <div className="rowitem__meta">{item.detail}</div>}
              </div>
              <div className="rowitem__side"><Link className="btn btn--secondary btn--sm" href={href(item)}>{item.source === "request" ? "Open request" : "Review conversation"}<span className="sr-only"> from {item.person}</span></Link></div>
            </div>
          ))}
        </div>
      )}
      <div className="card__foot" style={{ justifyContent: "space-between" }}>
        <span className="t-support">Importance is set by the team. It is not medical triage.</span>
        {pages > 1 && (
          <span className="row gap-2">
            <button className="btn btn--ghost btn--sm" type="button" disabled={(query.page ?? 1) <= 1} onClick={() => set({ page: (query.page ?? 1) - 1 })}>Previous</button>
            <span className="t-support">Page {page?.page} of {pages}</span>
            <button className="btn btn--ghost btn--sm" type="button" disabled={(query.page ?? 1) >= pages} onClick={() => set({ page: (query.page ?? 1) + 1 })}>Next</button>
          </span>
        )}
      </div>
    </section>
  );
}
