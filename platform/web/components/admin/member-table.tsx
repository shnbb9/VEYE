"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chip, Icon } from "@/components/admin/admin-chrome";
import { HealthNumberCell, SHARING_OPTIONS, SharingChip, TREND_OPTIONS, TrendCell, fmtDay } from "@/components/admin/member-cells";
import { listMembers, type MembersPage, type MembersQuery } from "@/lib/admin-console-api";

/* One member table, two screens: the directory, and Progress & trends (which
   adds the time range and opens sorted on the change). Search, filters,
   sorting and paging are all the API's, so every count on screen is about the
   same rows. A slower earlier answer never replaces a newer one. */

const STATUS = [["any", "Any status"], ["active", "Active"], ["inactive", "Inactive"], ["unverified", "Email unverified"]] as const;
const ONBOARDING = [["any", "Any onboarding"], ["complete", "Complete"], ["not_started", "Not started"]] as const;
const ACTIVE = [["any", "Any time"], ["week", "This week"], ["month", "This month"], ["longer", "Longer ago"], ["never", "Never"]] as const;
const ARCHIVED = [["exclude", "Active members"], ["include", "Include archived"], ["only", "Archived only"]] as const;
const WITHIN = [["", "Result at any time"], ["30", "Result in the last 30 days"], ["90", "Result in the last 90 days"], ["365", "Result in the last year"]] as const;

export function useMembers(initial: MembersQuery) {
  const first = useRef(initial);
  const [query, setQuery] = useState<MembersQuery>(initial);
  const [page, setPage] = useState<MembersPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      listMembers(query)
        .then((next) => { if (live) { setPage(next); setError(""); } })
        .catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : "The directory could not be loaded."); });
    }, query.q ? 200 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  const set = useCallback((patch: Partial<MembersQuery>) => setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 })), []);
  const clear = useCallback(() => setQuery(first.current), []);
  const reload = useCallback(() => setQuery((current) => ({ ...current })), []);
  return { query, page, error, set, clear, reload };
}

type Props = ReturnType<typeof useMembers> & { trendsView?: boolean };

export function MemberTable({ query, page, error, set, clear, trendsView }: Props) {
  const active = [query.status !== "any", query.onboarding !== "any", query.active !== "any", query.sharing !== "any", query.trend !== "any",
    query.archived !== "exclude", Boolean(query.result_within), Boolean(query.q?.trim())].filter(Boolean).length;
  const sortBy = (sort: NonNullable<MembersQuery["sort"]>) =>
    set({ sort, direction: query.sort === sort && query.direction === "asc" ? "desc" : "asc" });

  const th = (key: NonNullable<MembersQuery["sort"]>, label: string, priority?: string) => (
    <th scope="col" data-col-priority={priority} aria-sort={query.sort === key ? (query.direction === "asc" ? "ascending" : "descending") : undefined}>
      <button className="th-sort" type="button" onClick={() => sortBy(key)} aria-label={`Sort by ${label}`}>{label} {query.sort === key && <Icon name={query.direction === "asc" ? "chevron-right" : "chevron-left"} size={14} />}</button>
    </th>
  );
  const pick = (id: string, label: string, value: string, options: readonly (readonly [string, string])[], on: (value: string) => void) => (
    <div className="field" style={{ margin: 0 }}>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select className="select input--sm" id={id} value={value} onChange={(event) => on(event.target.value)}>
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </div>
  );
  const pages = page ? Math.max(1, Math.ceil(page.total / page.page_size)) : 1;

  return (
    <div className="card">
      <div className="findbar">
        <div className="search" style={{ flex: "1 1 260px", maxWidth: 360, position: "relative" }}>
          <span className="search__icon"><Icon name="search" size={18} /></span>
          <label className="sr-only" htmlFor="mSearch">Search members</label>
          <input className="search__input" id="mSearch" type="search" placeholder="Search by name, email or member id" value={query.q ?? ""} onChange={(event) => set({ q: event.target.value })} />
        </div>
        <div className="findbar__filters">
          {pick("fStatus", "Member status", query.status ?? "any", STATUS, (v) => set({ status: v as MembersQuery["status"] }))}
          {pick("fSharing", "Health sharing", query.sharing ?? "any", SHARING_OPTIONS, (v) => set({ sharing: v as MembersQuery["sharing"] }))}
          {pick("fOnboarding", "Onboarding status", query.onboarding ?? "any", ONBOARDING, (v) => set({ onboarding: v as MembersQuery["onboarding"] }))}
          {trendsView
            ? pick("fWithin", "Result date", query.result_within ? String(query.result_within) : "", WITHIN, (v) => set({ result_within: v ? Number(v) : undefined }))
            : pick("fActive", "Last activity", query.active ?? "any", ACTIVE, (v) => set({ active: v as MembersQuery["active"] }))}
          {pick("fTrend", "Trend", query.trend ?? "any", TREND_OPTIONS, (v) => set({ trend: v as MembersQuery["trend"] }))}
          {pick("fArchived", "Archived members", query.archived ?? "exclude", ARCHIVED, (v) => set({ archived: v as MembersQuery["archived"] }))}
        </div>
        <span className="findbar__spacer" />
        {active > 0 && <span className="filtercount">{active} filter{active === 1 ? "" : "s"} active</span>}
        {active > 0 && <button className="btn btn--ghost btn--sm" type="button" onClick={clear}>Clear</button>}
      </div>

      {!page && !error && <p className="loading-row">Loading the directory…</p>}
      {page && page.rows.length === 0 && (
        <div className="card__body">
          <div className="state">
            <span className="state__icon"><Icon name="search" /></span>
            <div className="state__title">No members match those filters</div>
            <p className="state__msg">Try a shorter search, or clear one of the filters above.</p>
            <button className="btn btn--secondary" type="button" onClick={clear}>Clear all filters</button>
          </div>
        </div>
      )}
      {page && page.rows.length > 0 && (
        <>
          <div className="table-wrap members-table">
            <table className="table table--rows" data-testid="members-table">
              <caption className="sr-only">Members, {page.rows.length} of {page.total} shown</caption>
              <thead><tr>
                {th("name", "Member")}
                {th("health_number", "Health Number")}
                {th("sharing", "Health sharing")}
                <th scope="col" data-col-priority="low">Onboarding</th>
                {th("trend", "Trend", trendsView ? undefined : "medium")}
                {th("last_active", "Last active", "medium")}
                {!trendsView && th("joined", "Joined", "low")}
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Open</span></th>
              </tr></thead>
              <tbody>
                {page.rows.map((member) => (
                  <tr key={member.member_id} data-member={member.member_id}>
                    <td>
                      <div className="person">
                        <span className="avatar avatar--sm">{member.initials}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="cell-primary">{member.name}{member.admin_access && <span className="tag">admin access</span>}</div>
                          <div className="cell-sub">{member.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><HealthNumberCell member={member} /></td>
                    <td className="t-nowrap"><SharingChip member={member} /></td>
                    <td data-col-priority="low">{member.onboarding}</td>
                    <td data-col-priority={trendsView ? undefined : "medium"}><TrendCell trend={member.trend} /></td>
                    <td className="t-nowrap" data-col-priority="medium">{member.last_active_at ? fmtDay(member.last_active_at) : <span className="t-muted">Never</span>}</td>
                    {!trendsView && <td className="t-nowrap" data-col-priority="low">{fmtDay(member.joined_at)}</td>}
                    <td>{member.archived_at ? <Chip label="Archived" tone="archived" />
                      : <Chip label={member.is_active ? (member.email_verified ? "Active" : "Unverified") : "Inactive"} tone={member.is_active ? (member.email_verified ? "live" : "draft") : "archived"} />}</td>
                    <td style={{ textAlign: "right" }}><Link className="btn btn--secondary btn--sm" href={`/admin/members/${member.member_id}`}>Open<span className="sr-only"> {member.name}</span></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="pager__info">Showing {page.rows.length} of {page.total} members</span>
            <span className="t-support">A lower Health Number is better.</span>
            {pages > 1 && (
              <span className="row gap-2">
                <button className="btn btn--ghost btn--sm" type="button" disabled={page.page <= 1} onClick={() => set({ page: page.page - 1 })}>Previous</button>
                <span className="t-support">Page {page.page} of {pages}</span>
                <button className="btn btn--ghost btn--sm" type="button" disabled={page.page >= pages} onClick={() => set({ page: page.page + 1 })}>Next</button>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
