"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Chip, Icon, PageHead, Subnav, fmtDate } from "@/components/admin/admin-chrome";
import { Drawer } from "@/components/admin/drawer";
import { MEMBER_VIEWS } from "@/components/admin/member-views";
import { eraseProspect, getProspect, listProspects, type ProspectDetail, type ProspectRow, type ProspectsPage } from "@/lib/prospects-api";

/* Prospects (architecture V2 §2.4): visitors who saved an assessment result
   without signing up. Metadata only — the address masked, the status, when it
   was saved and until when. The answers and the Health Number are not on this
   wire at all: agreeing to storage is not agreeing to be read, and an
   administrator's console access is not a reason to open them. A prospect
   cannot be asked to share health data either; that becomes possible only
   after sign-up and email verification, from Member 360. */

const STATUS_OPTIONS = [
  ["", "Any status"], ["active", "Not registered (active)"], ["unverified", "Unverified prospect"], ["verified", "Verified prospect"],
  ["pending_claim", "Pending claim"], ["claimed", "Registered member"], ["expired", "Expired"], ["erased", "Deleted"],
] as const;
const SORTS = [["captured_desc", "Newest first"], ["captured_asc", "Oldest first"], ["expires_asc", "Expiring soonest"]] as const;
const TONES: Record<string, string> = { unverified: "draft", verified: "info", pending_claim: "attention", claimed: "live", expired: "archived", erased: "archived" };

export default function ProspectsPage() {
  const [query, setQuery] = useState({ q: "", status: "", sort: "captured_desc", page: 1 });
  const [page, setPage] = useState<ProspectsPage | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    setError("");
    return listProspects({ q: query.q.trim() || undefined, status: query.status || undefined, sort: query.sort, page: query.page })
      .then(setPage)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Prospects could not be loaded."));
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  const set = (patch: Partial<typeof query>) => setQuery((current) => ({ ...current, ...patch, page: 1 }));
  const counts = page?.counts ?? {};

  return (
    <div className="page">
      <PageHead title="Prospects" crumbs={[{ label: "Home", href: "/admin" }, { label: "Members", href: "/admin/members" }, { label: "Prospects" }]}
                desc="Visitors who saved their assessment result without signing up. You see when and until when — never their answers or their Health Number." />
      <Subnav items={MEMBER_VIEWS} active="prospects" />
      {error && <p className="errorbar">{error}</p>}
      {notice && <p className="t-support" role="status" data-testid="prospects-notice">{notice}</p>}

      <div className="minirow" data-testid="prospects-counts">
        <div className="mini"><span className="mini__n">{counts.unregistered ?? "—"}</span><span className="mini__l">Not registered</span></div>
        <div className="mini"><span className="mini__n">{counts.pending_claim ?? "—"}</span><span className="mini__l">Pending claim</span></div>
        <div className="mini"><span className="mini__n">{counts.registered ?? "—"}</span><span className="mini__l">Registered</span></div>
        <div className="mini"><span className="mini__n">{counts.expired ?? "—"}</span><span className="mini__l">Expired</span></div>
        <div className="mini"><span className="mini__n">{counts.deleted ?? "—"}</span><span className="mini__l">Deleted</span></div>
      </div>

      {page && (
        <div className={`notice${page.saving_enabled ? " notice--quiet" : ""}`} data-testid="prospects-policy">
          <Icon name="shield" size={18} />
          <div>
            {page.saving_enabled
              ? <>Visitors can save a result for <strong>{page.retention_label}</strong>.</>
              : <>Saving is <strong>off</strong> ({page.retention_label}): the result gate shows the number without storing anything.</>}{" "}
            Change it in <Link href="/admin/settings?section=product#privacy-prospects">Settings → Product settings → Privacy &amp; prospects</Link>.
            {counts.expiring_within_7_days ? ` ${counts.expiring_within_7_days} saved result(s) expire within 7 days.` : ""}
          </div>
        </div>
      )}

      <div className="card">
        <div className="findbar">
          <div className="search" style={{ flex: "1 1 260px", maxWidth: 360, position: "relative" }}>
            <span className="search__icon"><Icon name="search" size={18} /></span>
            <label className="sr-only" htmlFor="pSearch">Find by full email address</label>
            <input className="search__input" id="pSearch" type="search" placeholder="Full email address" value={query.q}
                   onChange={(event) => set({ q: event.target.value })} data-testid="prospects-search" />
          </div>
          <div className="findbar__filters">
            <div className="field" style={{ margin: 0 }}>
              <label className="sr-only" htmlFor="pStatus">Status</label>
              <select className="select input--sm" id="pStatus" value={query.status} onChange={(event) => set({ status: event.target.value })} data-testid="prospects-status">
                {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="sr-only" htmlFor="pSort">Sort</label>
              <select className="select input--sm" id="pSort" value={query.sort} onChange={(event) => set({ sort: event.target.value })} data-testid="prospects-sort">
                {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
          <span className="findbar__spacer" />
          <span className="t-support">Search matches a whole address only.</span>
        </div>

        {page === null && !error && <p className="loading-row">Loading prospects…</p>}
        {page && page.rows.length === 0 && (
          <div className="card__body">
            <div className="state">
              <span className="state__icon"><Icon name="users" /></span>
              <div className="state__title">{query.q || query.status ? "No saved results match" : "No saved results yet"}</div>
              <p className="state__msg">{page.saving_enabled
                ? "A visitor appears here after ticking the box to save their result."
                : "Saving is switched off, so visitors' results are shown to them and not stored."}</p>
            </div>
          </div>
        )}
        {page && page.rows.length > 0 && (
          <>
            <div className="table-wrap table-wrap--sticky">
              <table className="table table--rows" data-testid="prospects-table">
                <caption className="sr-only">Prospects, {page.rows.length} of {page.total} shown</caption>
                <thead><tr>
                  <th scope="col">Saved by</th>
                  <th scope="col">Status</th>
                  <th scope="col" data-col-priority="medium">Saved</th>
                  <th scope="col">Kept until</th>
                  <th scope="col" data-col-priority="low">Registered as</th>
                  <th scope="col"><span className="sr-only">Details</span></th>
                </tr></thead>
                <tbody>
                  {page.rows.map((row) => (
                    <tr key={row.id} data-testid="prospect-row">
                      <td><div className="cell-primary">{row.email_masked}</div><div className="cell-sub">{row.email_verified ? "Address confirmed" : "Address not confirmed"}</div></td>
                      <td style={{ whiteSpace: "nowrap" }}><Chip label={row.status_label} tone={TONES[row.status]} /></td>
                      <td data-col-priority="medium">{fmtDate(row.captured_at)}</td>
                      <td>{keptUntil(row)}</td>
                      <td data-col-priority="low">{row.registered_member
                        ? <Link href={`/admin/members/${row.registered_member.member_id}`}>{row.registered_member.name}</Link>
                        : <span className="t-muted">—</span>}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn btn--secondary btn--sm" type="button" onClick={() => setOpen(row.id)} data-testid="prospect-open">
                          Details<span className="sr-only"> for {row.email_masked}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="pager__info">Showing {page.rows.length} of {page.total}</span>
              <span className="t-support">{page.rows[0]?.sharing_note}</span>
              {page.total > page.page_size && (
                <span className="row gap-2">
                  <button className="btn btn--ghost btn--sm" type="button" disabled={page.page <= 1} onClick={() => setQuery((c) => ({ ...c, page: c.page - 1 }))}>Previous</button>
                  <button className="btn btn--ghost btn--sm" type="button" disabled={page.page * page.page_size >= page.total} onClick={() => setQuery((c) => ({ ...c, page: c.page + 1 }))}>Next</button>
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {open && <ProspectDrawer id={open} onClose={() => setOpen(null)} onErased={(message) => { setOpen(null); setNotice(message); void load(); }} />}
    </div>
  );
}

function keptUntil(row: Pick<ProspectRow, "status" | "expires_at" | "retention_label">) {
  if (row.status === "claimed") return <span className="t-muted">In the member&rsquo;s own record</span>;
  if (row.status === "erased") return <span className="t-muted">Deleted</span>;
  if (row.status === "expired") return <span className="t-muted">Expired</span>;
  if (!row.expires_at) return "Until deleted";
  return fmtDate(row.expires_at);
}

function ProspectDrawer({ id, onClose, onErased }: { id: string; onClose: () => void; onErased: (message: string) => void }) {
  const [detail, setDetail] = useState<ProspectDetail | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getProspect(id).then(setDetail).catch((reason) => setError(reason instanceof Error ? reason.message : "This record could not be loaded."));
  }, [id]);

  async function erase(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const row = await eraseProspect(id, reason.trim());
      onErased(`The saved result from ${row.email_masked === "—" ? "that visitor" : row.email_masked} was deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "It could not be deleted.");
    } finally { setBusy(false); }
  }

  const removable = detail && !["erased", "expired", "claimed"].includes(detail.status);
  return (
    <Drawer eyebrow="Prospects" title={detail ? detail.email_masked : "Saved result"} onClose={onClose}
            desc="What happened to this saved result. Its answers and Health Number are not shown to anyone in the console."
            foot={<>
              {removable && !confirming && <button className="btn btn--danger-quiet" type="button" onClick={() => setConfirming(true)} data-testid="prospect-erase-open">Delete this saved result</button>}
              <button className="btn btn--ghost" type="button" onClick={onClose}>Close</button>
            </>}>
      {error && <p className="errorbar">{error}</p>}
      {!detail && !error && <p className="loading-row">Loading…</p>}
      {detail && (
        <div className="stack gap-4" data-testid="prospect-detail">
          <dl className="facts">
            <div className="fact"><dt>Status</dt><dd><Chip label={detail.status_label} tone={TONES[detail.status]} /></dd></div>
            <div className="fact"><dt>Saved</dt><dd>{fmtDate(detail.captured_at)}</dd></div>
            <div className="fact"><dt>Kept until</dt><dd>{keptUntil(detail)}</dd></div>
            <div className="fact"><dt>Retention agreed</dt><dd>{detail.retention_label} (policy v{detail.retention_policy_version})</dd></div>
            <div className="fact"><dt>Notice agreed to</dt><dd className="mono">{detail.consent_version}</dd></div>
            <div className="fact"><dt>Health data sharing</dt><dd>{detail.sharing_note}</dd></div>
          </dl>
          <div>
            <div className="t-eyebrow">History</div>
            <ol className="rows" data-testid="prospect-events">
              {detail.events.map((event, index) => (
                <li className="rowitem" key={`${event.at}-${index}`}>
                  <span className="rowitem__icon"><Icon name="activity" size={16} /></span>
                  <div><div className="rowitem__title">{event.label}</div><div className="rowitem__meta">{fmtDate(event.at)} · {event.actor_type}</div></div>
                </li>
              ))}
            </ol>
          </div>
          {confirming && (
            <form className="stack gap-3" method="post" onSubmit={(event) => void erase(event)}>
              <p className="t-support">Deleting removes the sealed answers, the result and the address now. Only the fact that a record existed stays, without anything that identifies the visitor. This cannot be undone.</p>
              <div className="field">
                <label className="field__label" htmlFor="eraseReason">Why (optional, kept in the audit log)</label>
                <input className="input" id="eraseReason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Asked by phone on 14 Nov" />
              </div>
              <div className="row gap-2">
                <button className="btn btn--danger" type="submit" disabled={busy} data-testid="prospect-erase-confirm">{busy ? "Deleting…" : "Delete permanently"}</button>
                <button className="btn btn--ghost" type="button" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </Drawer>
  );
}
