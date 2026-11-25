"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Chip, EmptyState, Icon, PageHead, Subnav, fmtDate } from "@/components/admin/admin-chrome";
import { InviteMember } from "@/components/admin/invite-member";
import { MEMBER_VIEWS } from "@/components/admin/member-views";
import { listMemberInvitations, resendMemberInvitation, revokeMemberInvitation, type MemberInvitation, type MemberInvitationsPage } from "@/lib/admin-console-api";

/* Invitations to become a member: who was asked, whether the email left, and
   what became of it. Not the same list as Prospects — those people came on
   their own and were never invited. */

const STATUS = [["any", "Any status"], ["pending", "Pending"], ["accepted", "Accepted"], ["expired", "Expired"], ["revoked", "Withdrawn"]] as const;
const SORT = [["newest", "Newest first"], ["oldest", "Oldest first"], ["email", "By email"]] as const;
const TONE = { pending: "info", accepted: "live", expired: "attention", revoked: "archived" } as const;
const DELIVERY: Record<string, string> = {
  sent: "Email sent", queued: "Email queued", sending: "Email being sent", retry: "Email refused — will be retried", failed: "Email not delivered", skipped: "Email not sent",
};

export default function InvitationsPage() {
  return <Suspense fallback={<div className="page"><p className="loading-row">Loading invitations…</p></div>}><Invitations /></Suspense>;
}

function said(invitation: MemberInvitation): string {
  return invitation.delivery === "sent"
    ? `The invitation is on its way to ${invitation.email}.`
    : `The invitation for ${invitation.email} is saved, but the email has not gone: ${invitation.delivery_error ?? DELIVERY[invitation.delivery ?? ""] ?? "not sent"}.`;
}

function Invitations() {
  const sentId = useSearchParams().get("sent");
  const [query, setQuery] = useState({ q: "", status: "any", sort: "newest", page: 1 });
  const [page, setPage] = useState<MemberInvitationsPage | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [inviting, setInviting] = useState(false);
  const turn = useRef(0);

  const load = useCallback(() => {
    const mine = ++turn.current;
    return listMemberInvitations(query)
      .then((next) => {
        if (mine !== turn.current) return;
        setPage(next);
        const just = sentId ? next.rows.find((row) => row.id === sentId) : null;
        if (just) setNotice((current) => current || said(just));
      })
      .catch((reason) => { if (mine === turn.current) setError(reason instanceof Error ? reason.message : "Invitations could not be loaded."); });
  }, [query, sentId]);
  useEffect(() => { void load(); }, [load]);

  async function act(row: MemberInvitation, action: "resend" | "revoke") {
    if (action === "revoke" && !window.confirm(`Withdraw the invitation to ${row.email}? The link they were sent stops working.`)) return;
    setBusy(row.id); setError(""); setNotice("");
    try {
      const next = await (action === "resend" ? resendMemberInvitation(row.id) : revokeMemberInvitation(row.id));
      setNotice(action === "resend" ? said(next) : `The invitation to ${next.email} is withdrawn.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That could not be done.");
    } finally { setBusy(""); }
  }

  const set = (patch: Partial<typeof query>) => setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  const pages = page ? Math.max(1, Math.ceil(page.total / page.page_size)) : 1;

  return (
    <div className="page">
      <PageHead title="Invitations" desc="People invited to become members, and what became of each invitation."
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Members", href: "/admin/members" }, { label: "Invitations" }]}
                actions={<button className="btn btn--primary" type="button" onClick={() => setInviting(true)} data-testid="add-member"><Icon name="plus" size={18} /> Add a member</button>} />
      <Subnav items={MEMBER_VIEWS} active="invitations" />
      {error && <p className="errorbar" role="alert">{error}</p>}
      {notice && <p className="notice notice--quiet" role="status" data-testid="invitations-notice">{notice}</p>}
      <div className="minirow minirow--figures" data-testid="invitation-counts">
        {(["pending", "accepted", "expired", "revoked"] as const).map((key) => (
          <div className="mini" key={key}><span className="mini__n">{page?.counts[key] ?? "—"}</span><span className="mini__l">{STATUS.find(([k]) => k === key)![1]}</span></div>
        ))}
      </div>
      <div className="card">
        <div className="findbar">
          <div className="search" style={{ flex: "1 1 260px", maxWidth: 360, position: "relative" }}>
            <span className="search__icon"><Icon name="search" size={18} /></span>
            <label className="sr-only" htmlFor="invSearch">Search invitations</label>
            <input className="search__input" id="invSearch" type="search" placeholder="Search by email or name" value={query.q} onChange={(event) => set({ q: event.target.value })} />
          </div>
          <div className="findbar__filters">
            <div className="field" style={{ margin: 0 }}><label className="sr-only" htmlFor="invStatus">Status</label>
              <select className="select input--sm" id="invStatus" value={query.status} onChange={(event) => set({ status: event.target.value })}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field" style={{ margin: 0 }}><label className="sr-only" htmlFor="invSort">Order</label>
              <select className="select input--sm" id="invSort" value={query.sort} onChange={(event) => set({ sort: event.target.value })}>{SORT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          </div>
        </div>
        {!page && !error && <p className="loading-row">Loading invitations…</p>}
        {page && page.rows.length === 0 && <div className="card__body"><EmptyState icon="mail" title="No invitations here" msg={query.q || query.status !== "any" ? "Try another search or status." : "Add a member to send the first one."} /></div>}
        <div className="rows" data-testid="invitations-list">
          {page?.rows.map((row) => (
            <div className="rowitem" key={row.id} data-testid="invitation-row" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
              <span className="rowitem__icon"><Icon name="mail" size={18} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="rowitem__title">{row.name || row.email} <Chip label={row.status_label} tone={TONE[row.status]} /></div>
                {row.name && <div className="rowitem__meta">{row.email}</div>}
                <div className="rowitem__meta">Invited by {row.invited_by || "an administrator"} · {fmtDate(row.created_at)}{row.sent_count > 1 ? ` · sent ${row.sent_count} times` : ""}
                  {row.status === "pending" && ` · works until ${fmtDate(row.expires_at)}`}{row.accepted_at && ` · accepted ${fmtDate(row.accepted_at)}`}</div>
                {row.status === "pending" && row.delivery && <div className="rowitem__meta" data-testid="invitation-delivery">{DELIVERY[row.delivery] ?? row.delivery}{row.delivery !== "sent" && row.delivery_error ? ` · ${row.delivery_error}` : ""}</div>}
              </div>
              <div className="rowitem__side row gap-2 wrap" style={{ justifyContent: "flex-end" }}>
                {row.member_id && <Link className="btn btn--secondary btn--sm" href={`/admin/members/${row.member_id}`}>Open member<span className="sr-only"> {row.email}</span></Link>}
                {(row.status === "pending" || row.status === "expired") && <button className="btn btn--secondary btn--sm" type="button" disabled={busy !== ""} onClick={() => void act(row, "resend")} aria-label={`Send the invitation to ${row.email} again`} data-testid="invitation-resend">{busy === row.id ? "Working…" : "Send again"}</button>}
                {(row.status === "pending" || row.status === "expired") && <button className="btn btn--danger-quiet btn--sm" type="button" disabled={busy !== ""} onClick={() => void act(row, "revoke")} aria-label={`Withdraw the invitation to ${row.email}`} data-testid="invitation-revoke">Withdraw</button>}
              </div>
            </div>
          ))}
        </div>
        {page && pages > 1 && (
          <div className="pager"><span className="pager__info">Page {page.page} of {pages}</span>
            <span className="row gap-2">
              <button className="btn btn--ghost btn--sm" type="button" disabled={page.page <= 1} onClick={() => set({ page: page.page - 1 })}>Previous</button>
              <button className="btn btn--ghost btn--sm" type="button" disabled={page.page >= pages} onClick={() => set({ page: page.page + 1 })}>Next</button>
            </span></div>
        )}
      </div>
      {inviting && <InviteMember onClose={() => setInviting(false)} onSent={(invitation) => { setInviting(false); setNotice(said(invitation)); void load(); }} />}
    </div>
  );
}
