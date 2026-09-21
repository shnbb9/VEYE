"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Chip, EmptyState, Icon, PageHead, fmtDate } from "@/components/admin/admin-chrome";
import {
  REQUEST_KIND_LABELS,
  listRequests,
  setRequestStatus,
  type ConsoleRequest,
  type RequestKind,
  type RequestStatus,
  type RequestsPage,
  type RequestsView,
} from "@/lib/admin-console-api";

/* Requests & Inbox (admin prototype screens/requests.js): one simple place for
   Contact Us messages, Help questions and Join Beta submissions — a list with
   Open / All / Resolved, the selected request on the right, and three plain
   status moves. Every row is a real submission from the public site or the
   member application; nothing is emailed from this screen. */

const VIEWS: { key: RequestsView; label: string }[] = [{ key: "open", label: "Open" }, { key: "all", label: "All" }, { key: "resolved", label: "Resolved" }];
const KINDS = Object.keys(REQUEST_KIND_LABELS) as RequestKind[];
const STATUS_TONE: Record<RequestStatus, string> = { new: "attention", in_progress: "info", resolved: "live" };

export default function RequestsPage() {
  return <Suspense fallback={null}><Requests /></Suspense>;
}

function Requests() {
  const search = useSearchParams();
  const initial = search.get("id");
  const [view, setView] = useState<RequestsView>(() => VIEWS.find((v) => v.key === search.get("view"))?.key ?? "open");
  const [kind, setKind] = useState<RequestKind | "">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState<RequestsPage | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [selected, setSelected] = useState<string | null>(initial);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listRequests({ view, kind, q, page: pageNo, page_size: 25 })
      .then((data) => {
        setPage(data);
        setSelected((current) => (current && data.rows.some((r) => r.id === current) ? current : data.rows[0]?.id ?? null));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Requests could not be loaded."));
  }, [view, kind, q, pageNo]);
  useEffect(() => { load(); }, [load]);

  const item = page?.rows.find((r) => r.id === selected) ?? null;
  useEffect(() => { setNote(item?.resolution_note ?? ""); }, [item?.id, item?.resolution_note]);

  async function move(status: RequestStatus) {
    if (!item) return;
    setBusy(true); setError("");
    try {
      const updated = await setRequestStatus(item.id, status, note);
      // Refresh counts and rows, but keep the request just handled on screen
      // even if the current filter no longer includes it.
      const fresh = await listRequests({ view, kind, q, page: pageNo, page_size: 25 });
      const rows = fresh.rows.some((r) => r.id === updated.id) ? fresh.rows.map((r) => (r.id === updated.id ? updated : r)) : [updated, ...fresh.rows];
      setPage({ ...fresh, rows });
      setSelected(updated.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That change could not be saved.");
    } finally { setBusy(false); }
  }

  const counts = page?.counts;

  return (
    <div className="page">
      <PageHead title="Requests & Inbox" desc="One simple place for Contact Us messages, Help questions and Join Beta submissions."
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Requests & Inbox" }]} />
      {error && <p className="errorbar">{error}</p>}

      <section className="lead">
        <div><h2>Member requests</h2><p>Start with the newest messages, mark what you are handling, resolve when done. Replies go out from your own mailbox; this screen sends nothing.</p></div>
        <div className="minirow" style={{ minWidth: 330 }} data-testid="requests-counts">
          <div className="mini"><span className="mini__n">{counts?.new ?? "—"}</span><span className="mini__l">New</span></div>
          <div className="mini"><span className="mini__n">{counts?.in_progress ?? "—"}</span><span className="mini__l">In progress</span></div>
          <div className="mini"><span className="mini__n">{counts?.resolved ?? "—"}</span><span className="mini__l">Resolved</span></div>
        </div>
      </section>

      <div className="review2">
        <div className="card">
          <div className="findbar" style={{ padding: "var(--s-4)", flexWrap: "wrap", gap: 10 }}>
            <div className="modeswitch" role="tablist" aria-label="Which requests">
              {VIEWS.map((v) => (
                <button key={v.key} className="modeswitch__btn" type="button" role="tab" aria-selected={view === v.key} onClick={() => { setView(v.key); setPageNo(1); }}>{v.label}</button>
              ))}
            </div>
            <label className="sr-only" htmlFor="rqKind">Kind</label>
            <select className="select" id="rqKind" value={kind} onChange={(e) => { setKind(e.target.value as RequestKind | ""); setPageNo(1); }} style={{ maxWidth: 170 }}>
              <option value="">All kinds</option>
              {KINDS.map((k) => <option key={k} value={k}>{REQUEST_KIND_LABELS[k]}</option>)}
            </select>
            <div className="search" style={{ flex: "1 1 160px", position: "relative" }}>
              <span className="search__icon"><Icon name="search" size={18} /></span>
              <label className="sr-only" htmlFor="rqSearch">Search requests</label>
              <input className="search__input" id="rqSearch" type="search" placeholder="Name, email or words" value={q} onChange={(e) => { setQ(e.target.value); setPageNo(1); }} />
            </div>
          </div>
          <div className="flaglist" id="rqList" data-testid="requests-list">
            {!page && !error && <p className="loading-row">Loading…</p>}
            {page && page.rows.length === 0 && <div className="card__body"><EmptyState icon="inbox" title="No requests here" msg="Choose another filter, or wait for the next message." /></div>}
            {page?.rows.map((r) => (
              <button key={r.id} className={`flag${r.id === selected ? " is-active" : ""}`} type="button" data-rq={r.id} onClick={() => setSelected(r.id)}>
                <span className="flag__top"><span className="flag__who">{r.name || "Visitor"}</span>{r.status === "new" && <span className="chip chip--attention chip--sm">New</span>}</span>
                <span className="flag__why">{r.subject || r.message.slice(0, 80)}</span>
                <span className="t-support">{r.kind_label} · {fmtDate(r.created_at)}</span>
              </button>
            ))}
          </div>
          {page && page.total > page.page_size && (
            <div className="card__foot" style={{ justifyContent: "space-between" }}>
              <button className="btn btn--ghost btn--sm" type="button" disabled={pageNo <= 1} onClick={() => setPageNo((n) => n - 1)}>Previous</button>
              <span className="t-support">Page {page.page} of {Math.ceil(page.total / page.page_size)}</span>
              <button className="btn btn--ghost btn--sm" type="button" disabled={pageNo >= Math.ceil(page.total / page.page_size)} onClick={() => setPageNo((n) => n + 1)}>Next</button>
            </div>
          )}
        </div>

        <div className="card" id="rqDetail" data-testid="request-detail">
          {!item && <div className="card__body"><EmptyState icon="inbox" title="Nothing selected" msg="Pick a request on the left." /></div>}
          {item && (
            <>
              <div className="card__head">
                <div><h2 className="card__title">{item.subject || item.kind_label}</h2><p className="t-support">{item.name || "Visitor"}{item.email ? ` · ${item.email}` : ""} · {fmtDate(item.created_at)}</p></div>
                <Chip label={item.status_label} tone={STATUS_TONE[item.status]} />
              </div>
              <div className="card__body stack gap-5">
                <div><div className="t-eyebrow">Source</div><p>{item.kind_label} · {item.source === "member" ? "signed-in member" : "public website"}{item.page ? ` · ${item.page}` : ""}</p></div>
                <div><div className="t-eyebrow">Message</div><p style={{ whiteSpace: "pre-wrap" }}>{item.message || <span className="t-support">No message — a Join Beta request carries only the member&rsquo;s identity.</span>}</p></div>
                {item.member_id && <div><div className="t-eyebrow">Member</div><p><Link href={`/admin/members/${item.member_id}`}>Open Member 360</Link></p></div>}
                {(item.handled_by || item.handled_at) && <div><div className="t-eyebrow">Handling</div><p className="t-support">{item.handled_by ?? "—"} · {fmtDate(item.handled_at)}</p></div>}
                <div>
                  <label className="t-eyebrow" htmlFor="rqNote">Internal note</label>
                  <textarea className="textarea" id="rqNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, or what the reply said." data-testid="request-note" />
                </div>
                <div className="notice notice--quiet"><Icon name="info" size={18} /><div>Nothing is emailed from this screen. Reply from your mailbox, then record the outcome here.</div></div>
              </div>
              <div className="card__foot">
                {item.status !== "in_progress" && item.status !== "resolved" && <button className="btn btn--secondary btn--sm" type="button" disabled={busy} onClick={() => move("in_progress")} data-testid="request-progress">Mark in progress</button>}
                {item.status !== "resolved" && <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={() => move("resolved")} data-testid="request-resolve">Resolve</button>}
                {item.status === "resolved" && <button className="btn btn--secondary btn--sm" type="button" disabled={busy} onClick={() => move("new")} data-testid="request-reopen">Reopen</button>}
                {item.status === "in_progress" && <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={() => move("in_progress")}>Save note</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
