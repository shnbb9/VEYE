"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Chip, Icon, PageHead, fmtDate } from "@/components/admin/admin-chrome";
import { listMembers, type MembersPage, type MembersQuery } from "@/lib/admin-console-api";

/* Members — the directory (admin prototype screens/members.js): still a
   table, because density is the point. Search across name, email and member
   id; three filters; sortable columns; Open → Member 360. Every row is a
   real account + member profile from PostgreSQL. */

const STATUS = [["any", "Any status"], ["active", "Active"], ["inactive", "Inactive"], ["unverified", "Email unverified"]] as const;
const ONBOARDING = [["any", "Any onboarding"], ["complete", "Complete"], ["not_started", "Not started"]] as const;
const ACTIVE = [["any", "Any time"], ["week", "This week"], ["month", "This month"], ["longer", "Longer ago"], ["never", "Never"]] as const;

export default function MembersPage() {
  const [query, setQuery] = useState<MembersQuery>({ q: "", status: "any", onboarding: "any", active: "any", sort: "name", direction: "asc", page: 1, page_size: 25 });
  const [page, setPage] = useState<MembersPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      listMembers(query).then(setPage).catch((reason) => setError(reason instanceof Error ? reason.message : "The directory could not be loaded."));
    }, query.q ? 200 : 0);
    return () => clearTimeout(timer);
  }, [query]);

  const filters = (query.status !== "any" ? 1 : 0) + (query.onboarding !== "any" ? 1 : 0) + (query.active !== "any" ? 1 : 0) + (query.q?.trim() ? 1 : 0);
  const set = (patch: Partial<MembersQuery>) => setQuery((current) => ({ ...current, ...patch, page: 1 }));
  const sortBy = (sort: MembersQuery["sort"]) => setQuery((current) => ({ ...current, sort, direction: current.sort === sort && current.direction === "asc" ? "desc" : "asc", page: 1 }));
  const clear = () => setQuery({ q: "", status: "any", onboarding: "any", active: "any", sort: "name", direction: "asc", page: 1, page_size: 25 });

  const th = (key: NonNullable<MembersQuery["sort"]>, label: string, priority?: string) => (
    <th scope="col" data-col-priority={priority} aria-sort={query.sort === key ? (query.direction === "asc" ? "ascending" : "descending") : undefined}>
      <button className="th-sort" type="button" onClick={() => sortBy(key)} aria-label={`Sort by ${label}`}>{label} {query.sort === key && <Icon name={query.direction === "asc" ? "chevron-right" : "chevron-left"} size={14} />}</button>
    </th>
  );

  return (
    <div className="page">
      <PageHead title="Members" desc={page ? `Everyone using Veye on this local stack — ${page.total} member${page.total === 1 ? "" : "s"}.` : "Everyone using Veye."} crumbs={[{ label: "Home", href: "/admin" }, { label: "Members" }]} />
      {error && <p className="errorbar">{error}</p>}
      <div className="card">
        <div className="findbar">
          <div className="search" style={{ flex: "1 1 260px", maxWidth: 360, position: "relative" }}>
            <span className="search__icon"><Icon name="search" size={18} /></span>
            <label className="sr-only" htmlFor="mSearch">Search members</label>
            <input className="search__input" id="mSearch" type="search" placeholder="Search by name, email or member id" value={query.q ?? ""} onChange={(event) => set({ q: event.target.value })} />
          </div>
          <div className="findbar__filters">
            <div className="field" style={{ margin: 0 }}>
              <label className="sr-only" htmlFor="fStatus">Member status</label>
              <select className="select input--sm" id="fStatus" value={query.status} onChange={(event) => set({ status: event.target.value as MembersQuery["status"] })}>
                {STATUS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="sr-only" htmlFor="fOnboarding">Onboarding status</label>
              <select className="select input--sm" id="fOnboarding" value={query.onboarding} onChange={(event) => set({ onboarding: event.target.value as MembersQuery["onboarding"] })}>
                {ONBOARDING.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="sr-only" htmlFor="fActive">Last activity</label>
              <select className="select input--sm" id="fActive" value={query.active} onChange={(event) => set({ active: event.target.value as MembersQuery["active"] })}>
                {ACTIVE.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
          <span className="findbar__spacer" />
          {filters > 0 && <span className="filtercount">{filters} filter{filters === 1 ? "" : "s"} active</span>}
          {filters > 0 && <button className="btn btn--ghost btn--sm" type="button" onClick={clear}>Clear</button>}
        </div>

        {!page && !error && <p className="loading-row">Loading the directory…</p>}
        {page && page.rows.length === 0 && (
          <div className="card__body">
            <div className="state">
              <span className="state__icon"><Icon name="search" /></span>
              <div className="state__title">No members match those filters</div>
              <p className="state__msg">Try a shorter search, or clear one of the three filters above.</p>
              <button className="btn btn--secondary" type="button" onClick={clear}>Clear all filters</button>
            </div>
          </div>
        )}
        {page && page.rows.length > 0 && (
          <>
            <div className="table-wrap table-wrap--sticky">
              <table className="table table--rows" data-testid="members-table">
                <caption className="sr-only">Members, {page.rows.length} of {page.total} shown</caption>
                <thead><tr>
                  {th("name", "Member")}
                  {th("health_number", "Health Number")}
                  <th scope="col" data-col-priority="medium">Trackers</th>
                  <th scope="col" data-col-priority="low">Onboarding</th>
                  {th("last_active", "Last active", "medium")}
                  {th("joined", "Joined", "low")}
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Open</span></th>
                </tr></thead>
                <tbody>
                  {page.rows.map((member) => (
                    <tr key={member.member_id}>
                      <td>
                        <div className="person">
                          <span className="avatar avatar--sm">{member.initials}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="cell-primary">{member.name}{member.admin_access && <span className="tag" style={{ marginLeft: 8 }}>admin access</span>}</div>
                            <div className="cell-sub">{member.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>{member.health_number === null ? <span className="t-muted">Not completed</span> : <><span className="t-num">{Number(member.health_number).toFixed(1)}</span> <span className="cell-sub">{member.health_number_status}</span></>}</td>
                      <td data-col-priority="medium">{member.trackers_completed} of 5</td>
                      <td data-col-priority="low">{member.onboarding}</td>
                      <td data-col-priority="medium">{member.last_active_at ? fmtDate(member.last_active_at) : <span className="t-muted">Never</span>}</td>
                      <td data-col-priority="low">{fmtDate(member.joined_at)}</td>
                      <td><Chip label={member.is_active ? (member.email_verified ? "Active" : "Unverified") : "Inactive"} tone={member.is_active ? (member.email_verified ? "live" : "draft") : "archived"} /></td>
                      <td style={{ textAlign: "right" }}><Link className="btn btn--secondary btn--sm" href={`/admin/members/${member.member_id}`}>Open<span className="sr-only"> {member.name}</span></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="pager__info">Showing {page.rows.length} of {page.total} members</span>
              <span className="t-support">A lower Health Number is better.</span>
              {page.total > page.page_size && (
                <span className="row gap-2">
                  <button className="btn btn--ghost btn--sm" type="button" disabled={page.page <= 1} onClick={() => setQuery((c) => ({ ...c, page: (c.page ?? 1) - 1 }))}>Previous</button>
                  <button className="btn btn--ghost btn--sm" type="button" disabled={page.page * page.page_size >= page.total} onClick={() => setQuery((c) => ({ ...c, page: (c.page ?? 1) + 1 }))}>Next</button>
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
