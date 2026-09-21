"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Chip, Icon, PageHead, fmtDate } from "@/components/admin/admin-chrome";
import { useSession } from "@/components/session";
import { getOverview, type Overview } from "@/lib/admin-api";
import { TRACKER_KEYS, TRACKER_LABELS, getConsoleOverview, type ConsoleOverview } from "@/lib/admin-console-api";

/* Home (admin prototype screens/home.js): greeting with quick actions, four
   headline figures, what has been happening, and the Companion summary —
   every number a PostgreSQL aggregate of the local, synthetic data. No
   revenue, no growth percentages, no clinical conclusions. */

const KIND_LABEL: Record<string, string> = { ...TRACKER_LABELS, companion: "Sprout", guided_flow: "Guided flow", request: "Request" };

export default function AdminHome() {
  const account = useSession().admin;
  const [overview, setOverview] = useState<ConsoleOverview | null>(null);
  const [companion, setCompanion] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getConsoleOverview().then(setOverview).catch((reason) => setError(reason instanceof Error ? reason.message : "The overview could not be loaded."));
    getOverview().then(setCompanion).catch(() => setCompanion(null));
  }, []);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="page">
      <PageHead title="Home" />
      {error && <p className="errorbar">{error}</p>}

      <section className="lead">
        <div>
          <p className="hero__date">{today}</p>
          <h2>{greeting}, {account?.first_name ?? ""}</h2>
          <p>
            {overview
              ? `${overview.members_total} member${overview.members_total === 1 ? "" : "s"} on this local stack, ${overview.members_active_last_7_days} active in the last seven days, ${overview.members_new_last_7_days} new. ${companion && companion.conversations_needing_review > 0 ? `${companion.conversations_needing_review} Sprout conversation${companion.conversations_needing_review === 1 ? "" : "s"} waiting for review.` : "Nothing is waiting for review."}`
              : "Loading today's figures…"}
          </p>
        </div>
        <div className="quick" style={{ minWidth: 230 }}>
          <Link className="quick__btn" href="/admin/members"><Icon name="users" /><span>View all members</span><Icon name="chevron-right" size={16} /></Link>
          <Link className="quick__btn" href="/admin/assessments"><Icon name="clipboard" /><span>Assessment results</span><Icon name="chevron-right" size={16} /></Link>
          <Link className="quick__btn" href="/admin/care"><Icon name="heart" /><span>Edit member content</span><Icon name="chevron-right" size={16} /></Link>
          <Link className="quick__btn" href="/admin/companion/conversations"><Icon name="sprout" /><span>Review Companion messages</span><Icon name="chevron-right" size={16} /></Link>
        </div>
      </section>

      <div className="kpis kpis--quad">
        <div className="kpi">
          <span className="kpi__label"><Icon name="users" size={16} /> Members</span>
          <span className="kpi__value">{overview ? overview.members_total : "—"}</span>
          <span className="kpi__note">{overview ? `${overview.members_verified} with a verified email` : ""}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label"><Icon name="activity" size={16} /> Used Veye this week</span>
          <span className="kpi__value">{overview ? overview.members_active_last_7_days : "—"}</span>
          <span className="kpi__note">{overview ? `${overview.members_new_last_30_days} joined in the last 30 days` : ""}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label"><Icon name="clipboard" size={16} /> Health Numbers</span>
          <span className="kpi__value">{overview ? overview.members_completed.health_number : "—"}</span>
          <span className="kpi__note">{overview ? `members · ${overview.completions.health_number} results saved` : ""}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label"><Icon name="sprout" size={16} /> Guided by Sprout</span>
          <span className="kpi__value">{overview ? overview.guided_sessions_total : "—"}</span>
          <span className="kpi__note">{overview ? `${overview.guided_sessions_in_progress} in progress · ${overview.guided_sessions_completed} completed` : ""}</span>
        </div>
      </div>
      <div className="kpis" style={{ marginTop: "var(--s-4)" }} data-testid="home-inbox-kpis">
        <Link className="kpi" href="/admin/requests" style={{ textDecoration: "none" }}>
          <span className="kpi__label"><Icon name="inbox" size={16} /> Open requests</span>
          <span className="kpi__value" data-testid="home-requests-open">{overview ? overview.requests_open : "—"}</span>
          <span className="kpi__note">{overview ? `${overview.requests_new} new · ${overview.requests_in_progress} in progress` : ""}</span>
        </Link>
        <div className="kpi">
          <span className="kpi__label"><Icon name="activity" size={16} /> Mood entries</span>
          <span className="kpi__value">{overview ? overview.mood_entries_total : "—"}</span>
          <span className="kpi__note">days logged across all members</span>
        </div>
        <div className="kpi">
          <span className="kpi__label"><Icon name="edit" size={16} /> Food Diary entries</span>
          <span className="kpi__value">{overview ? overview.food_diary_entries_total : "—"}</span>
          <span className="kpi__note">meals recorded across all members</span>
        </div>
      </div>

      <div className="grid grid--main-side" style={{ marginTop: "var(--s-6)" }}>
        <div className="stack gap-5">
          <div className="card">
            <div className="card__head"><div><h2 className="card__title"><Icon name="clipboard" /> Progress trackers</h2><p className="t-support">Members with at least one saved result, and results saved in total.</p></div></div>
            <div className="card__body">
              {overview ? (
                <div className="bars">
                  {TRACKER_KEYS.map((key) => {
                    const members = overview.members_completed[key];
                    const pct = overview.members_total ? Math.round((members / overview.members_total) * 100) : 0;
                    return (
                      <div className="bar" key={key}>
                        <span className="bar__label">{TRACKER_LABELS[key]}</span>
                        <span className="bar__track"><span className="bar__fill bar__fill--deep" style={{ width: `${Math.max(pct, members ? 4 : 0)}%` }} /></span>
                        <span className="bar__n">{members} <span className="t-muted">/ {overview.completions[key]}</span></span>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="loading-row">Loading…</p>}
            </div>
            <div className="card__foot"><Link className="btn btn--secondary btn--sm" href="/admin/assessments">Open Assessments</Link><Link className="btn btn--ghost btn--sm" href="/admin/insights">Insights <Icon name="chevron-right" size={16} /></Link></div>
          </div>

          <div className="card">
            <div className="card__head"><div><h2 className="card__title"><Icon name="activity" /> What has been happening</h2><p className="t-support">The latest saved results, Sprout conversations and guided sessions.</p></div></div>
            <div className="card__body">
              {overview ? overview.recent_activity.length ? (
                <div className="timeline">
                  {overview.recent_activity.map((row, index) => (
                    <div className="tl-item" key={`${row.at}-${index}`}>
                      <span className="tl-item__dot" />
                      <div className="tl-item__time">{fmtDate(row.at)}</div>
                      <div className="tl-item__title"><Link href={`/admin/members/${row.member_id}`}>{row.member_name}</Link> · {KIND_LABEL[row.kind] ?? row.kind}</div>
                      <div className="tl-item__body">{row.summary}</div>
                    </div>
                  ))}
                </div>
              ) : <p className="t-support">No member activity yet.</p> : <p className="loading-row">Loading…</p>}
            </div>
          </div>
        </div>

        <div className="stack gap-5">
          <div className="card">
            <div className="card__head"><div><h2 className="card__title"><Icon name="users" /> Recent members</h2></div></div>
            <div className="card__body card__body--flush">
              {overview ? (
                <ul className="stack" style={{ listStyle: "none", margin: 0, padding: "6px 0" }}>
                  {overview.recent_members.map((member) => (
                    <li key={member.member_id}>
                      <Link className="person" href={`/admin/members/${member.member_id}`} style={{ textDecoration: "none", color: "inherit", padding: "10px 20px", display: "flex" }}>
                        <span className="avatar avatar--sm">{member.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}</span>
                        <span style={{ minWidth: 0, marginLeft: 10 }}>
                          <span className="cell-primary">{member.name}</span>
                          <span className="cell-sub">joined {fmtDate(member.joined_at)} · {member.email_verified ? "verified" : "unverified"}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="loading-row" style={{ padding: 16 }}>Loading…</p>}
            </div>
            <div className="card__foot"><Link className="btn btn--secondary btn--sm" href="/admin/members">Open the directory</Link></div>
          </div>

          <div className="card">
            <div className="card__head"><div><h2 className="card__title"><Icon name="sprout" /> Companion</h2><p className="t-support">What Sprout has been saying, and what it may say.</p></div></div>
            <div className="card__body">
              {companion ? (
                <dl className="kv">
                  <dt>Conversations</dt><dd>{companion.conversations_total} · <b>{companion.conversations_needing_review}</b> waiting for review</dd>
                  <dt>Member feedback</dt><dd>{companion.feedback_total} · <b>{companion.feedback_unreviewed}</b> unreviewed</dd>
                  <dt>Knowledge sources</dt><dd>{companion.knowledge_sources_active} retrievable of {companion.knowledge_sources_total}</dd>
                  <dt>Last 7 days</dt><dd>{companion.traces_last_7_days} Sprout turns · {companion.escalations_last_7_days} handed to a person</dd>
                  <dt>Language model</dt><dd>{companion.llm_provider}{companion.llm_model ? ` · ${companion.llm_model}` : ""}</dd>
                  <dt>Langfuse</dt><dd><Chip label={companion.langfuse_status} tone={companion.langfuse_status === "enabled" ? "live" : "archived"} /></dd>
                </dl>
              ) : <p className="loading-row">Loading…</p>}
            </div>
            <div className="card__foot">
              <Link className="btn btn--primary btn--sm" href="/admin/companion/conversations">Open Conversations</Link>
              <Link className="btn btn--ghost btn--sm" href="/admin/companion/settings/guided-experiences">Guided Experiences <Icon name="chevron-right" size={16} /></Link>
            </div>
          </div>

          <div className="notice notice--quiet">
            <Icon name="info" size={18} />
            <div>Every member and conversation here is synthetic local demonstration data. Nothing leaves this machine except by explicit development configuration.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
