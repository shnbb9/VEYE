"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Chip, Icon, PageHead, Subnav, fmtDate } from "@/components/admin/admin-chrome";
import {
  REQUEST_STATUS_LABELS,
  getMember360,
  memberAccountAction,
  memberPhotoUrl,
  requestHealthPermission,
  type Member360,
  type MemberAccountAction,
} from "@/lib/admin-console-api";

/* Member 360 (admin prototype screens/member-360.js): the member header with
   the Health Number dial, then Overview · Assessments · Companion · Account.
   Health figures are shown exactly as the member's records hold them —
   nothing is recomputed, no screen converts between scales, and no
   administrator can change a historical result. */

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "assessments", label: "Assessments" },
  { key: "journal", label: "Mood & Diary" },
  { key: "companion", label: "Companion" },
  { key: "requests", label: "Requests" },
  { key: "account", label: "Account" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function hnTone(value: number | null): string {
  if (value === null) return "var(--line-strong)";
  if (value <= 3) return "var(--status-positive)";
  if (value <= 6) return "var(--status-attention)";
  return "var(--status-significant)";
}

/* Health Data Sharing Permission, from the console's side. The API withholds
   every health record until the member shares, so this banner explains an
   empty Member 360 rather than letting it read as an inactive member. Asking
   is the only thing the console can do here. */
function SharingBanner({ member, memberId, onAsked }: { member: Member360; memberId: string; onAsked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asked, setAsked] = useState(false);

  if (member.shares_health_data) {
    return (
      <div className="notice notice--quiet" data-testid="sharing-banner">
        <Icon name="shield" size={18} />
        <div>
          <strong>{member.sharing_label}.</strong> This member has chosen to share their saved results with the
          Veye team. They can stop at any time, and the records close again immediately.
        </div>
      </div>
    );
  }

  const alreadyAsked = member.sharing_state === "requested" || asked;
  const explanation = {
    not_requested: "This member has not been asked to share their health records yet.",
    requested: "This member has been asked and has not answered yet.",
    declined: "This member was asked and chose not to share.",
    revoked: "This member shared before and has since stopped.",
    granted: "",
  }[member.sharing_state];

  return (
    <div className="notice" data-testid="sharing-banner">
      <Icon name="shield" size={18} />
      <div style={{ minWidth: 0 }}>
        <strong>Health records are not shared.</strong> {explanation}{" "}
        Their Health Number, body composition, blood markers, questionnaires, moods and food diary are not sent to
        this console — the tabs below are empty for that reason, not because nothing was recorded. Name, email and
        their messages to Veye are not covered by sharing and stay visible so the team can answer them.
        {error && <p className="t-support" style={{ color: "#A8402D", marginTop: 6 }}>{error}</p>}
        <div style={{ marginTop: 10 }}>
          <button className="btn btn--secondary btn--sm" type="button" disabled={busy || alreadyAsked}
                  data-testid="sharing-ask"
                  onClick={() => {
                    setBusy(true); setError("");
                    requestHealthPermission(memberId)
                      .then(() => { setAsked(true); onAsked(); })
                      .catch((reason) => setError(reason instanceof Error ? reason.message : "That request could not be sent."))
                      .finally(() => setBusy(false));
                  }}>
            {busy ? "Asking…" : alreadyAsked ? "Already asked — waiting for their answer" : "Ask this member to share"}
          </button>
        </div>
      </div>
    </div>
  );
}


export default function Member360Page() {
  return <Suspense fallback={null}><Member360View /></Suspense>;
}

function Member360View() {
  const params = useParams<{ memberId: string }>();
  const search = useSearchParams();
  const memberId = params.memberId;
  const tab: Tab = (TABS.find((t) => t.key === search.get("tab"))?.key ?? "overview");
  const [member, setMember] = useState<Member360 | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    getMember360(memberId).then(setMember)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "That member could not be loaded."));
  }, [memberId]);

  useEffect(() => { reload(); }, [reload]);

  if (error) {
    return (
      <div className="page">
        <PageHead title="That member was not found" crumbs={[{ label: "Home", href: "/admin" }, { label: "Members", href: "/admin/members" }, { label: "Not found" }]} desc={error} />
        <div className="card"><div className="card__body"><div className="state"><span className="state__icon"><Icon name="users" /></span><div className="state__title">Try the directory</div><p className="state__msg">The directory has a search across names, email addresses and member ids.</p><Link className="btn btn--primary" href="/admin/members">Go to the member directory</Link></div></div></div>
      </div>
    );
  }
  if (!member) return <div className="page"><p className="loading-row">Loading the member…</p></div>;

  const profile = member.profile;
  const hn = profile.health_number;
  const pct = hn === null ? 0 : Math.max(4, Math.min(100, (1 - hn / 10) * 100));
  const trackers = [
    { label: "Health Number", count: member.health_number.length, latest: member.health_number[0]?.completed_at },
    { label: "Body Composition", count: member.body_composition.length, latest: member.body_composition[0]?.completed_at },
    { label: "Blood Markers", count: member.blood_markers.length, latest: member.blood_markers[0]?.completed_at },
    { label: "Health Assessment", count: member.health_assessment.length, latest: member.health_assessment[0]?.completed_at },
    { label: "Simple Quiz", count: member.simple_quiz.length, latest: member.simple_quiz[0]?.completed_at },
  ];

  return (
    <div className="page">
      <PageHead title={profile.name} crumbs={[{ label: "Home", href: "/admin" }, { label: "Members", href: "/admin/members" }, { label: profile.name }]} />

      <section className="m360">
        <div className="m360__who">
          <div className="row gap-4" style={{ alignItems: "center" }}>
            {profile.has_photo && profile.photo_version
              ? <span className="avatar avatar--lg avatar--photo" data-testid="m360-photo"><img src={memberPhotoUrl(profile.member_id, profile.photo_version)} alt="" crossOrigin="use-credentials" /></span>
              : <span className="avatar avatar--lg">{profile.initials}</span>}
            <div style={{ minWidth: 0 }}>
              <div className="m360__id">{profile.email} · joined {fmtDate(profile.joined_at)}</div>
              <div className="row gap-2 wrap" style={{ marginTop: 6 }}>
                <Chip label={profile.is_active ? "Active" : "Inactive"} tone={profile.is_active ? "live" : "archived"} />
                <span className="tag">{profile.email_verified ? "Email verified" : "Email unverified"}</span>
                {profile.is_synthetic && <span className="tag">Synthetic demo account</span>}
                {profile.admin_access && <span className="tag">Also has admin access</span>}
              </div>
            </div>
          </div>
          <details className="disclose" style={{ marginTop: "var(--s-5)" }}>
            <summary><Icon name="chevron-right" size={15} /> Member details</summary>
            <dl className="facts" style={{ marginTop: "var(--s-4)" }}>
              <div className="fact"><dt>Email</dt><dd>{profile.email}</dd></div>
              <div className="fact"><dt>Phone</dt><dd>{member.phone ?? "—"}</dd></div>
              <div className="fact"><dt>Postal code</dt><dd>{member.postal_code ?? "—"}</dd></div>
              <div className="fact"><dt>Last active</dt><dd>{profile.last_active_at ? fmtDate(profile.last_active_at) : "Never"}</dd></div>
              <div className="fact"><dt>Onboarding</dt><dd>{profile.onboarding}</dd></div>
              <div className="fact"><dt>Member id</dt><dd className="mono">{profile.member_id}</dd></div>
            </dl>
          </details>
        </div>
        <div className="m360__hn">
          <div className="arc">
            <div className="arc__dial" style={{ "--pct": pct.toFixed(0), "--tone": hnTone(hn) } as React.CSSProperties}>
              <div className="arc__inner">
                <div className="arc__val">{hn === null ? "—" : Number(hn).toFixed(1)}</div>
                <div className="arc__scale">of 10</div>
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="t-eyebrow">Health Number</div>
              <div className="t-strong" style={{ marginTop: 2 }}>
                {member.shares_health_data ? (profile.health_number_status ?? "Not completed") : "Not shared"}
              </div>
              <p className="t-support" style={{ marginTop: 4 }}>A lower number is better on this scale.</p>
              <p className="t-support">
                {!member.shares_health_data
                  ? "Withheld until this member shares their records."
                  : profile.health_number_at ? `Taken ${fmtDate(profile.health_number_at)}` : "No Health Number saved yet."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <SharingBanner member={member} memberId={memberId} onAsked={reload} />

      <Subnav items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/admin/members/${memberId}?tab=${t.key}` }))} active={tab} />

      {tab === "overview" && (
        <div className="grid grid--main-side">
          <div className="stack gap-5">
            <div className="card">
              <div className="card__head"><div><h2 className="card__title">Where they are</h2></div></div>
              <div className="card__body">
                <div className="minirow">
                  <div className="mini"><span className="mini__n">{profile.onboarding}</span><span className="mini__l">Onboarding</span></div>
                  <div className="mini"><span className="mini__n">{profile.trackers_completed} of 5</span><span className="mini__l">Trackers with results</span></div>
                  <div className="mini"><span className="mini__n">{member.guided_sessions.length}</span><span className="mini__l">Guided sessions</span></div>
                  <div className="mini"><span className="mini__n">{member.conversations.length}</span><span className="mini__l">Sprout conversations</span></div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card__head"><div><h2 className="card__title">Health Number over time</h2><p className="t-support">A lower number is better on this scale.</p></div></div>
              <div className="card__body">
                {member.health_number.length ? (
                  <div className="bars">
                    {[...member.health_number].reverse().map((row) => (
                      <div className="bar" key={row.attempt_id}>
                        <span className="bar__label">{fmtDate(row.completed_at)}</span>
                        <span className="bar__track"><span className="bar__fill" style={{ width: `${Math.max(4, (Number(row.displayed_score) / 10) * 100)}%`, background: hnTone(Number(row.displayed_score)) }} /></span>
                        <span className="bar__n">{Number(row.displayed_score).toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="t-support">No Health Number saved yet.</p>}
              </div>
            </div>
          </div>
          <div className="stack gap-5">
            <div className="card">
              <div className="card__head"><div><h2 className="card__title">Progress trackers</h2><p className="t-support">Results saved, and the latest date.</p></div></div>
              <div className="card__body">
                <dl className="kv">
                  {trackers.map((t) => <span key={t.label} style={{ display: "contents" }}><dt>{t.label}</dt><dd>{t.count ? `${t.count} · latest ${fmtDate(t.latest)}` : <span className="t-muted">Not started</span>}</dd></span>)}
                </dl>
              </div>
              <div className="card__foot"><Link className="btn btn--secondary btn--sm" href={`/admin/members/${memberId}?tab=assessments`}>Open Assessments</Link><Link className="btn btn--ghost btn--sm" href={`/admin/members/${memberId}?tab=journal`}>Mood & Diary</Link></div>
            </div>
            <div className="card">
              <div className="card__head"><div><h2 className="card__title">Journal & requests</h2><p className="t-support">Non-clinical entries and messages from this member.</p></div></div>
              <div className="card__body">
                <dl className="kv">
                  <dt>Mood entries</dt><dd>{member.mood_entries.length ? `${member.mood_entries.length} · latest ${member.mood_entries[0].entry_date} (${member.mood_entries[0].mood_label})` : <span className="t-muted">Not started</span>}</dd>
                  <dt>Food Diary</dt><dd>{member.food_diary_days ? `${member.food_diary_days} day${member.food_diary_days === 1 ? "" : "s"} · latest ${member.food_diary[0]?.entry_date ?? ""}` : <span className="t-muted">Not started</span>}</dd>
                  <dt>Requests</dt><dd>{member.requests.length ? `${member.requests.length} · ${member.requests.filter((r) => r.status !== "resolved").length} open` : <span className="t-muted">None</span>}</dd>
                </dl>
              </div>
            </div>
            <div className="notice notice--quiet"><Icon name="info" size={18} /><div>Not connected to the application yet: {member.not_connected.join(", ")}. These sections show honest empty states in the member product.</div></div>
          </div>
        </div>
      )}

      {tab === "assessments" && <AssessmentsTab member={member} />}

      {tab === "journal" && (
        <div className="grid grid--2" data-testid="m360-journal">
          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Mood Tracker</h2><p className="t-support">One mood a day with an optional note. Balance score: the client's 30-day formula (positive 100 · neutral 50 · tired/sad 25 · stressed/angry 0).</p></div><span className="tag">{member.mood_entries.length} entr{member.mood_entries.length === 1 ? "y" : "ies"}</span></div>
            <div className="card__body">
              <dl className="kv">
                <dt>Logged this month</dt><dd>{member.mood_stats.days_logged_this_month}</dd>
                <dt>Day streak</dt><dd>{member.mood_stats.day_streak}</dd>
                <dt>Most felt</dt><dd>{member.mood_stats.top_mood_label ?? <span className="t-muted">—</span>}</dd>
                <dt>Balance score</dt><dd>{member.mood_stats.balance_score === null ? <span className="t-muted">— (no entries in the last 30 days)</span> : `${member.mood_stats.balance_score}% over ${member.mood_stats.balance_entries} day${member.mood_stats.balance_entries === 1 ? "" : "s"}`}</dd>
              </dl>
            </div>
            <div className="card__body card__body--flush">
              {member.mood_entries.length ? (
                <div className="table-wrap"><table className="table table--compact">
                  <thead><tr><th scope="col">Day</th><th scope="col">Mood</th><th scope="col">Note</th></tr></thead>
                  <tbody>{member.mood_entries.slice(0, 31).map((m) => <tr key={m.id}><td>{m.entry_date}</td><td>{m.mood_label}</td><td className="t-support">{m.note || "—"}</td></tr>)}</tbody>
                </table></div>
              ) : <p className="t-support" style={{ padding: 20 }}>No mood logged yet.</p>}
            </div>
          </div>
          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Food Diary</h2><p className="t-support">Meal entries as the member wrote them. No nutritional analysis is computed — that is a client decision.</p></div><span className="tag">{member.food_diary_days} day{member.food_diary_days === 1 ? "" : "s"} logged</span></div>
            <div className="card__body card__body--flush">
              {member.food_diary.length ? (
                <div className="table-wrap"><table className="table table--compact">
                  <thead><tr><th scope="col">Day</th><th scope="col">Time</th><th scope="col">Meal</th><th scope="col">Felt before</th></tr></thead>
                  <tbody>{member.food_diary.map((m) => <tr key={m.id}><td className="t-nowrap">{m.entry_date}</td><td className="t-nowrap">{m.meal_time}</td><td>{m.description}{m.notes ? <div className="cell-sub">{m.notes}</div> : null}</td><td className="t-support">{m.feelings.join(", ") || "—"}</td></tr>)}</tbody>
                </table></div>
              ) : <p className="t-support" style={{ padding: 20 }}>No diary entry yet.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="card" data-testid="m360-requests">
          <div className="card__head"><div><h2 className="card__title">Requests</h2><p className="t-support">Contact Us messages, Help questions and Join Beta submissions from this member.</p></div><Link className="btn btn--secondary btn--sm" href="/admin/requests">Open Requests & Inbox</Link></div>
          <div className="card__body card__body--flush">
            {member.requests.length ? (
              <div className="table-wrap"><table className="table table--compact">
                <thead><tr><th scope="col">Received</th><th scope="col">Kind</th><th scope="col">Subject</th><th scope="col">Answered</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>{member.requests.map((r) => (
                  <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{r.kind_label}</td><td>{r.subject || r.message.slice(0, 60)}</td>
                    {/* Whether this person was actually written back to, not only
                        whether somebody marked the request resolved. */}
                    <td>{r.replies.length === 0 ? <span className="t-support">Not yet</span> : fmtDate(r.replies[r.replies.length - 1].created_at)}</td>
                    <td><Chip label={REQUEST_STATUS_LABELS[r.status]} tone={r.status === "resolved" ? "live" : r.status === "new" ? "attention" : "info"} /></td><td style={{ textAlign: "right" }}><Link className="btn btn--secondary btn--sm" href={`/admin/requests?view=all&id=${r.id}`}>Open</Link></td></tr>
                ))}</tbody>
              </table></div>
            ) : <p className="t-support" style={{ padding: 20 }}>No request from this member.</p>}
          </div>
        </div>
      )}

      {tab === "companion" && (
        <div className="stack gap-5">
          <div className="card">
            <div className="card__head"><div><h2 className="card__title"><Icon name="sprout" /> Guided experiences</h2><p className="t-support">Sprout's guided flows and where this member is in each.</p></div></div>
            <div className="card__body card__body--flush">
              {member.guided_sessions.length ? (
                <div className="table-wrap"><table className="table table--compact">
                  <thead><tr><th scope="col">Flow</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Step</th><th scope="col">Updated</th></tr></thead>
                  <tbody>{member.guided_sessions.map((s, i) => (
                    <tr key={`${s.flow_key}-${i}`}><td>{s.flow_title}</td><td>v{s.flow_version}</td><td><Chip label={s.status.replace("_", " ")} tone={s.status === "completed" ? "live" : s.status === "skipped" ? "archived" : "draft"} /></td><td className="mono">{s.current_node}</td><td className="t-nowrap">{fmtDate(s.updated_at)}</td></tr>
                  ))}</tbody>
                </table></div>
              ) : <p className="t-support" style={{ padding: 20 }}>No guided session yet.</p>}
            </div>
            <div className="card__foot"><Link className="btn btn--ghost btn--sm" href="/admin/companion/settings/guided-experiences">Guided Experiences <Icon name="chevron-right" size={16} /></Link></div>
          </div>
          <div className="card">
            <div className="card__head"><div><h2 className="card__title"><Icon name="messages" /> Conversations</h2><p className="t-support">Sprout conversations with this member. Transcripts open in Companion → Conversations.</p></div></div>
            <div className="card__body card__body--flush">
              {member.conversations.length ? (
                <div className="table-wrap"><table className="table table--compact">
                  <thead><tr><th scope="col">Started</th><th scope="col">Last message</th><th scope="col">Messages</th><th scope="col">Review</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
                  <tbody>{member.conversations.map((c) => (
                    <tr key={c.id}><td className="t-nowrap">{fmtDate(c.started_at)}</td><td className="t-nowrap">{fmtDate(c.last_message_at)}</td><td>{c.message_count}</td><td>{c.flagged ? <Chip label={c.reviewed_at ? "reviewed" : "needs review"} tone={c.reviewed_at ? "live" : "attention"} /> : <span className="t-muted">—</span>}</td><td style={{ textAlign: "right" }}><Link className="btn btn--secondary btn--sm" href={`/admin/companion/conversations?conversation=${c.id}`}>Open</Link></td></tr>
                  ))}</tbody>
                </table></div>
              ) : <p className="t-support" style={{ padding: 20 }}>No conversation yet.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "account" && (
        <div className="stack gap-5">
          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Account</h2><p className="t-support">Identity and access facts. Administrator access is provisioned by the system, never self-served.</p></div></div>
            <div className="card__body">
              <dl className="kv">
                <dt>Name</dt><dd>{profile.name}</dd>
                <dt>Email</dt><dd>{member.account.email} · {member.account.email_verified ? "verified" : "not verified"}</dd>
                {member.account.pending_email && <><dt>Pending email</dt><dd>{member.account.pending_email} · waiting for the member to confirm from that mailbox</dd></>}
                <dt>Account id</dt><dd className="mono">{profile.account_id}</dd>
                <dt>Member id</dt><dd className="mono">{profile.member_id}</dd>
                <dt>Member portal</dt><dd>Yes — this account owns a member profile</dd>
                <dt>Admin console</dt><dd>{member.account.admin_access ? "Yes — managed under Settings → Administrators" : "No"}</dd>
                <dt>Status</dt><dd>{member.account.is_active ? "Active" : `Deactivated${member.account.deactivated_at ? ` on ${fmtDate(member.account.deactivated_at)}` : ""}`}{member.account.is_synthetic ? " · synthetic local demo account" : ""}</dd>
                <dt>Signed in now</dt><dd>{member.account.active_sessions === 0 ? "No live session" : `${member.account.active_sessions} session${member.account.active_sessions === 1 ? "" : "s"}`}{member.account.last_session_at ? ` · last seen ${fmtDate(member.account.last_session_at)}` : ""}</dd>
                <dt>Joined</dt><dd>{fmtDate(profile.joined_at)}</dd>
                <dt>Last active</dt><dd>{profile.last_active_at ? fmtDate(profile.last_active_at) : "Never"}</dd>
              </dl>
            </div>
          </div>
          <AccountActions member={member} onChanged={reload} />
        </div>
      )}
    </div>
  );
}

/* What an administrator may do to a member's SIGN-IN account. Deliberately
   small: switch the account off or back on, and re-send the two emails the
   member may need. No administrator ever sets or sees a password, and nothing
   here touches a stored assessment result. */
function AccountActions({ member, onChanged }: { member: Member360; onChanged: () => void }) {
  const [busy, setBusy] = useState<MemberAccountAction | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const account = member.account;
  const name = member.profile.name;

  async function run(action: MemberAccountAction, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action); setNotice(""); setError("");
    try {
      const result = await memberAccountAction(member.profile.member_id, action);
      const failed = result.delivery && result.delivery.status !== "sent";
      setNotice(failed
        ? `${result.message} The email could not be sent: ${result.delivery?.detail ?? "mail service unavailable"}.`
        : result.message);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That action could not be completed.");
    } finally { setBusy(null); }
  }

  if (account.admin_access) {
    return (
      <div className="card" data-testid="m360-account-actions">
        <div className="card__head"><div><h2 className="card__title">Account actions</h2></div></div>
        <div className="card__body">
          <div className="notice notice--quiet"><Icon name="info" size={18} /><div>
            {name} also has console access, so this account is managed under{" "}
            <Link href="/admin/settings?section=administrators">Settings → Administrators</Link>, where the
            last-administrator guard lives.
          </div></div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" data-testid="m360-account-actions">
      <div className="card__head">
        <div><h2 className="card__title">Account actions</h2>
          <p className="t-support">Access and email only. Results stay read-only, and a password is always chosen by the member.</p></div>
      </div>
      <div className="card__body card__body--flush">
        {error && <p className="errorbar">{error}</p>}
        {notice && <p className="t-support" role="status" style={{ padding: "12px 20px 0" }} data-testid="account-action-notice">{notice}</p>}
        <div className="rows">
          <div className="rowitem">
            <span className={`rowitem__icon${account.is_active ? "" : " rowitem__icon--off"}`}><Icon name="lock" size={18} /></span>
            <div>
              <div className="rowitem__title">{account.is_active ? "Deactivate account" : "Reactivate account"}</div>
              <div className="rowitem__meta">
                {account.is_active
                  ? "Signs them out everywhere at once and refuses their password until reactivated. Their saved results are kept."
                  : `Deactivated${account.deactivated_at ? ` on ${fmtDate(account.deactivated_at)}` : ""}. Reactivating lets them sign in with the password they already had.`}
              </div>
            </div>
            {account.is_active ? (
              <button className="btn btn--danger-quiet btn--sm" type="button" disabled={busy !== null} data-testid="account-deactivate"
                      onClick={() => void run("deactivate", `Deactivate ${name}? They are signed out at once and cannot sign in until reactivated.`)}>
                {busy === "deactivate" ? "Working…" : "Deactivate"}
              </button>
            ) : (
              <button className="btn btn--secondary btn--sm" type="button" disabled={busy !== null} data-testid="account-reactivate"
                      onClick={() => void run("reactivate")}>
                {busy === "reactivate" ? "Working…" : "Reactivate"}
              </button>
            )}
          </div>

          <div className="rowitem">
            <span className={`rowitem__icon${account.email_verified ? " rowitem__icon--off" : ""}`}><Icon name="mail" size={18} /></span>
            <div>
              <div className="rowitem__title">Verification email</div>
              <div className="rowitem__meta">
                {account.email_verified
                  ? `${account.email} is already verified, so there is nothing to resend.`
                  : `Sends a fresh verification link to ${account.email}. It works once and expires in 48 hours.`}
              </div>
            </div>
            <button className="btn btn--secondary btn--sm" type="button" data-testid="account-resend-verification"
                    disabled={busy !== null || account.email_verified || !account.is_active}
                    onClick={() => void run("resend-verification")}>
              {busy === "resend-verification" ? "Sending…" : "Resend"}
            </button>
          </div>

          <div className="rowitem">
            <span className="rowitem__icon"><Icon name="shield" size={18} /></span>
            <div>
              <div className="rowitem__title">Password reset link</div>
              <div className="rowitem__meta">
                Emails {account.email} the ordinary single-use reset link (30 minutes). You never see or choose their password.
              </div>
            </div>
            <button className="btn btn--secondary btn--sm" type="button" data-testid="account-send-reset"
                    disabled={busy !== null || !account.is_active}
                    onClick={() => void run("send-password-reset", `Email ${name} a password-reset link?`)}>
              {busy === "send-password-reset" ? "Sending…" : "Send reset link"}
            </button>
          </div>
        </div>
      </div>
      {member.account_activity.length > 0 && (
        <div className="card__body card__body--flush" data-testid="account-history">
          <div className="t-eyebrow" style={{ padding: "16px 20px 0" }}>Account history</div>
          <div className="rows">
            {member.account_activity.map((row) => (
              <div className="rowitem" key={row.id}>
                <span className="rowitem__icon"><Icon name="clipboard" size={18} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="rowitem__title">{row.label}</div>
                  <div className="rowitem__meta">by {row.actor_name}</div>
                </div>
                <span className="t-support" style={{ whiteSpace: "nowrap" }}>{fmtDate(row.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="card__foot"><span className="t-support">Every action here is written to the admin audit log.</span></div>
    </div>
  );
}

function AssessmentsTab({ member }: { member: Member360 }) {
  return (
    <div className="stack gap-5">
      <div className="notice notice--quiet"><Icon name="lock" size={18} /><div>Historical results are read-only. Each row is the calculation as it was saved on that day (with its calculation version); nothing here is re-scored.</div></div>

      <ResultCard title="Health Number" description="12 questions · 1–10, lower is better." count={member.health_number.length}
        head={["Date", "Number", "Band", "Category", "Version"]}
        rows={member.health_number.map((r) => [fmtDate(r.completed_at), Number(r.displayed_score).toFixed(1), r.status, r.category, r.calculation_version])} />

      <ResultCard title="Body Composition" description="Standard BMI plus the client's body-fat tables." count={member.body_composition.length}
        head={["Date", "Sex", "BMI", "Body fat", "Fat mass", "Lean mass", "Version"]}
        rows={member.body_composition.map((r) => [fmtDate(r.completed_at), r.sex, r.bmi === null ? "—" : String(r.bmi), r.body_fat_available ? `${r.body_fat_percent}%` : (r.unavailable_reason ? "not available" : "—"), r.fat_mass_lb === null ? "—" : `${r.fat_mass_lb} lb`, r.lean_mass_lb === null ? "—" : `${r.lean_mass_lb} lb`, r.calculation_version])} />

      <ResultCard title="Blood Markers" description="Ratios with goal flags and the client's supplement suggestion." count={member.blood_markers.length}
        head={["Date", "TG/HDL", "HOMA-IR", "AA/EPA", "HbA1c", "In range", "Suggestion", "Version"]}
        rows={member.blood_markers.map((r) => {
          const flags = Object.values(r.in_range).filter((v) => v !== null);
          return [fmtDate(r.completed_at), fmtNum(r.tg_hdl), fmtNum(r.homa_ir), fmtNum(r.aa_epa), r.markers.hba1c === null || r.markers.hba1c === undefined ? "—" : `${r.markers.hba1c}%`, `${flags.filter(Boolean).length} of ${flags.length}`, r.recommendation.state === "ok" ? `EPA/DHA ${r.recommendation.epa_dha_dose}` : r.recommendation.state === "review" ? "requires review" : "—", r.calculation_version];
        })} />

      <ResultCard title="Health Assessment" description="11 questions scoring 1–3 · total 11–33, lower is better · EPA/DHA suggestion by score." count={member.health_assessment.length}
        head={["Date", "Total", "Band", "EPA/DHA", "Version"]}
        rows={member.health_assessment.map((r) => [fmtDate(r.completed_at), `${r.total} / 33`, r.status, r.epa_dha_dose, r.calculation_version])} />

      <ResultCard title="Simple Quiz" description="8 yes/no questions · a dated count. Never creates or changes a Health Number." count={member.simple_quiz.length}
        head={["Date", "Result", "Yes", "No", "Version"]}
        rows={member.simple_quiz.map((r) => [fmtDate(r.completed_at), r.summary, String(r.yes_count), String(r.no_count), r.calculation_version])} />
    </div>
  );
}

function fmtNum(value: number | null): string {
  return value === null || value === undefined ? "—" : Number(value).toFixed(2);
}

function ResultCard({ title, description, count, head, rows }: { title: string; description: string; count: number; head: string[]; rows: string[][] }) {
  return (
    <div className="card" data-testid={`m360-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="card__head"><div><h2 className="card__title">{title}</h2><p className="t-support">{description}</p></div><span className="tag">{count} result{count === 1 ? "" : "s"} · System managed</span></div>
      <div className="card__body card__body--flush">
        {rows.length ? (
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr>{head.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
          </table></div>
        ) : <p className="t-support" style={{ padding: 20 }}>Not started.</p>}
      </div>
    </div>
  );
}
