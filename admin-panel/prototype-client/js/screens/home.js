/* ============================================================================
   Home
   ----------------------------------------------------------------------------
   The console's Home (platform/web app/admin/page.tsx): a greeting with four
   quick actions, four headline figures and three inbox figures, the progress
   trackers, what has been happening, recent members and the Companion summary.

   Every number is counted from the prototype's records the way the console's
   API counts them. Anything taken from a health, mood or food record counts
   only members who share their health records with the Veye team — a name
   beside a result is the plainest disclosure there is. No revenue, no growth
   percentages, no clinical conclusions.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const H = window.Veye.H;
const esc = window.Veye.UI.esc;

const TRACKER_KEYS = ['health_number', 'body_composition', 'blood_markers', 'health_assessment', 'simple_quiz'];
const TRACKER_LABELS = { health_number: 'Health Number', body_composition: 'Body Composition', blood_markers: 'Blood Markers', health_assessment: 'Health Assessment', simple_quiz: 'Simple Quiz' };
const KIND_LABEL = { ...TRACKER_LABELS, companion: 'Sprout', guided_flow: 'Guided flow', request: 'Request' };
const REQUEST_KIND_LABELS = { contact_us: 'Contact Us', help_question: 'Help question', join_beta: 'Join Beta' };

/** One stored result, in the words the API's attempt summary uses. */
function resultSummary(kind, a) {
  if (kind === 'health_number') return `${Number(a.displayed_score).toFixed(1)} · ${a.status}`;
  if (kind === 'body_composition') return `${a.bmi != null ? 'BMI ' + a.bmi : 'BMI —'} · ${a.body_fat_percent != null ? a.body_fat_percent + '% body fat' : 'body fat not available'}`;
  if (kind === 'blood_markers') { const known = Object.values(a.in_range).filter((v) => v !== null); return `${known.filter(Boolean).length} of ${known.length} in range`; }
  if (kind === 'health_assessment') return `${a.total} / 33 · ${a.status}`;
  return `${a.no_count} No / ${a.yes_count} Yes`;
}

/** The console's /admin/overview, counted from the prototype's records. */
function overview() {
  const st = S.get();
  const now = Date.now();
  const within = (iso, days) => iso && Date.parse(iso) >= now - days * 864e5;
  const allowed = st.members.filter(S.shares);
  const completions = {}; const membersCompleted = {};
  TRACKER_KEYS.forEach((k) => {
    completions[k] = allowed.reduce((t, m) => t + m.records[k].length, 0);
    membersCompleted[k] = allowed.filter((m) => m.records[k].length).length;
  });
  const sessions = st.members.flatMap((m) => m.guided);
  const names = Object.fromEntries(st.members.map((m) => [m.id, m.name]));

  const activity = [];
  allowed.forEach((m) => TRACKER_KEYS.forEach((k) => m.records[k].forEach((a) => {
    activity.push({ at: a.completed_at, member_id: m.id, member_name: m.name, kind: k, summary: resultSummary(k, a) });
  })));
  st.conversations.forEach((c) => activity.push({ at: c.last_message_at, member_id: c.member_id, member_name: names[c.member_id] || 'Member',
    kind: 'companion', summary: `Sprout conversation · ${c.message_count} messages` }));
  st.members.forEach((m) => m.guided.forEach((g) => activity.push({ at: g.updated_at, member_id: m.id, member_name: m.name,
    kind: 'guided_flow', summary: `${g.flow_title} · ${g.status.replace('_', ' ')}` })));
  st.requests.forEach((r) => activity.push({ at: r.created_at, member_id: r.member_id, member_name: r.name || names[r.member_id] || 'Visitor',
    kind: 'request', summary: `${REQUEST_KIND_LABELS[r.kind]} · ${r.subject || r.message.slice(0, 60)}` }));
  activity.sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    members_total: st.members.length,
    members_verified: st.members.filter((m) => m.emailVerified).length,
    members_new_last_7_days: st.members.filter((m) => within(m.joinedAt, 7)).length,
    members_new_last_30_days: st.members.filter((m) => within(m.joinedAt, 30)).length,
    members_active_last_7_days: st.members.filter((m) => within(m.lastActiveAt, 7)).length,
    completions, members_completed: membersCompleted,
    guided_sessions_total: sessions.length,
    guided_sessions_in_progress: sessions.filter((g) => g.status === 'in_progress' || g.status === 'paused').length,
    guided_sessions_completed: sessions.filter((g) => g.status === 'completed').length,
    requests_open: st.requests.filter((r) => r.status !== 'resolved').length,
    requests_new: st.requests.filter((r) => r.status === 'new').length,
    requests_in_progress: st.requests.filter((r) => r.status === 'in_progress').length,
    mood_entries_total: allowed.reduce((t, m) => t + m.mood.length, 0),
    food_diary_entries_total: allowed.reduce((t, m) => t + m.diary.length, 0),
    recent_members: [...st.members].sort((a, b) => (a.joinedAt < b.joinedAt ? 1 : -1)).slice(0, 6),
    recent_activity: activity.slice(0, 15),
  };
}

/** Companion → overview, as the API's /admin/companion/overview counts it. */
function companionOverview() {
  const st = S.get();
  const week = Date.now() - 7 * 864e5;
  const recent = st.telemetry.filter((t) => Date.parse(t.created_at) >= week);
  return {
    conversations_total: st.conversations.length,
    conversations_needing_review: st.conversations.filter((c) => c.flagged && !c.reviewed_at).length,
    feedback_total: st.feedback.length,
    feedback_unreviewed: st.feedback.filter((f) => !f.reviewed_at).length,
    knowledge_sources_active: st.knowledgeSources.filter((k) => k.status === 'Active' && k.current_document && k.current_document.ingestion_status === 'ingested').length,
    knowledge_sources_total: st.knowledgeSources.length,
    traces_last_7_days: recent.length,
    escalations_last_7_days: recent.filter((t) => t.policy_outcome === 'escalate').length,
    llm_provider: 'mock', llm_model: 'veye-mock-1', langfuse_status: 'disabled',
  };
}

function render(outlet) {
  const me = S.me();
  const o = overview();
  const c = companionOverview();
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const memberLink = (id, name) => (S.member(id) ? `<a href="${R.href('/members/' + id)}">${esc(name)}</a>` : esc(name));

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Home' })}

    <section class="lead">
      <div>
        <p class="hero__date">${esc(today)}</p>
        <h2>${greeting}, ${esc(me.firstName)}</h2>
        <p>${o.members_total} member${o.members_total === 1 ? '' : 's'}, ${o.members_active_last_7_days} active in the last seven days, ${o.members_new_last_7_days} new.
          ${c.conversations_needing_review > 0 ? `${c.conversations_needing_review} Sprout conversation${c.conversations_needing_review === 1 ? '' : 's'} waiting for review.` : 'Nothing is waiting for review.'}</p>
      </div>
      <div class="quick" style="min-width:230px">
        <a class="quick__btn" href="${R.href('/members')}">${icon('users')}<span>View all members</span>${icon('chevron-right', { size: 16 })}</a>
        <a class="quick__btn" href="${R.href('/assessments')}">${icon('clipboard')}<span>Assessment results</span>${icon('chevron-right', { size: 16 })}</a>
        <a class="quick__btn" href="${R.href('/care')}">${icon('heart')}<span>Edit member content</span>${icon('chevron-right', { size: 16 })}</a>
        <a class="quick__btn" href="${R.href('/companion/conversations')}">${icon('sprout')}<span>Review Companion messages</span>${icon('chevron-right', { size: 16 })}</a>
      </div>
    </section>

    <div class="kpis kpis--quad">
      <div class="kpi">
        <span class="kpi__label">${icon('users', { size: 16 })} Members</span>
        <span class="kpi__value">${o.members_total}</span>
        <span class="kpi__note">${o.members_verified} with a verified email</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">${icon('activity', { size: 16 })} Used Veye this week</span>
        <span class="kpi__value">${o.members_active_last_7_days}</span>
        <span class="kpi__note">${o.members_new_last_30_days} joined in the last 30 days</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">${icon('clipboard', { size: 16 })} Health Numbers</span>
        <span class="kpi__value">${o.members_completed.health_number}</span>
        <span class="kpi__note">members · ${o.completions.health_number} results saved</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">${icon('sprout', { size: 16 })} Guided by Sprout</span>
        <span class="kpi__value">${o.guided_sessions_total}</span>
        <span class="kpi__note">${o.guided_sessions_in_progress} in progress · ${o.guided_sessions_completed} completed</span>
      </div>
    </div>
    <div class="kpis" style="margin-top:var(--s-4)" data-testid="home-inbox-kpis">
      <a class="kpi" href="${R.href('/requests')}" style="text-decoration:none">
        <span class="kpi__label">${icon('inbox', { size: 16 })} Open requests</span>
        <span class="kpi__value">${o.requests_open}</span>
        <span class="kpi__note">${o.requests_new} new · ${o.requests_in_progress} in progress</span>
      </a>
      <div class="kpi">
        <span class="kpi__label">${icon('activity', { size: 16 })} Mood entries</span>
        <span class="kpi__value">${o.mood_entries_total}</span>
        <span class="kpi__note">days logged across all members</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">${icon('edit', { size: 16 })} Food Diary entries</span>
        <span class="kpi__value">${o.food_diary_entries_total}</span>
        <span class="kpi__note">meals recorded across all members</span>
      </div>
    </div>

    <div class="grid grid--main-side" style="margin-top:var(--s-6)">
      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">${icon('clipboard')} Progress trackers</h2><p class="t-support">Members with at least one saved result. The bar is their share of all ${o.members_total} members.</p></div></div>
          <div class="card__body">
            <div class="bars">
              ${TRACKER_KEYS.map((key) => {
                const members = o.members_completed[key];
                const pct = o.members_total ? Math.round((members / o.members_total) * 100) : 0;
                return `<div class="bar">
                  <span class="bar__label">${TRACKER_LABELS[key]}</span>
                  <span class="bar__track"><span class="bar__fill bar__fill--deep" style="width:${Math.max(pct, members ? 4 : 0)}%"></span></span>
                  <span class="bar__n">${members}<span class="t-muted"> of ${o.members_total} · ${o.completions[key]} saved</span></span>
                </div>`;
              }).join('')}
            </div>
          </div>
          <div class="card__foot"><a class="btn btn--secondary btn--sm" href="${R.href('/assessments')}">Open Assessments</a><a class="btn btn--ghost btn--sm" href="${R.href('/insights')}">Insights ${icon('chevron-right', { size: 16 })}</a></div>
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">${icon('activity')} What has been happening</h2><p class="t-support">The latest saved results, Sprout conversations and guided sessions.</p></div></div>
          <div class="card__body">
            ${o.recent_activity.length ? `<div class="timeline">
              ${o.recent_activity.map((row) => `<div class="tl-item">
                <span class="tl-item__dot"></span>
                <div class="tl-item__time">${esc(H.fmtDate(row.at))}</div>
                <div class="tl-item__title">${memberLink(row.member_id, row.member_name)} · ${esc(KIND_LABEL[row.kind] || row.kind)}</div>
                <div class="tl-item__body">${esc(row.summary)}</div>
              </div>`).join('')}
            </div>` : '<p class="t-support">No member activity yet.</p>'}
          </div>
        </div>
      </div>

      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">${icon('users')} Recent members</h2></div></div>
          <div class="card__body card__body--flush">
            <ul class="stack" style="list-style:none;margin:0;padding:6px 0">
              ${o.recent_members.map((m) => `<li>
                <a class="person" href="${R.href('/members/' + m.id)}" style="text-decoration:none;color:inherit;padding:10px 20px;display:flex">
                  ${H.avatar({ ...m, initials: H.initialsOf(m.name) }, 'sm')}
                  <span style="min-width:0;margin-left:10px">
                    <span class="cell-primary">${esc(m.name)}</span>
                    <span class="cell-sub">joined ${esc(H.fmtDate(m.joinedAt))} · ${m.emailVerified ? 'verified' : 'unverified'}</span>
                  </span>
                </a>
              </li>`).join('')}
            </ul>
          </div>
          <div class="card__foot"><a class="btn btn--secondary btn--sm" href="${R.href('/members')}">Open the directory</a></div>
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">${icon('sprout')} Companion</h2><p class="t-support">What Sprout has been saying, and what it may say.</p></div></div>
          <div class="card__body">
            <dl class="kv">
              <dt>Conversations</dt><dd>${c.conversations_total} · <b>${c.conversations_needing_review}</b> waiting for review</dd>
              <dt>Member feedback</dt><dd>${c.feedback_total} · <b>${c.feedback_unreviewed}</b> unreviewed</dd>
              <dt>Knowledge sources</dt><dd>${c.knowledge_sources_active} retrievable of ${c.knowledge_sources_total}</dd>
              <dt>Last 7 days</dt><dd>${c.traces_last_7_days} Sprout turns · ${c.escalations_last_7_days} handed to a person</dd>
              <dt>Language model</dt><dd>${esc(c.llm_provider)}${c.llm_model ? ' · ' + esc(c.llm_model) : ''}</dd>
              <dt>Langfuse</dt><dd>${H.chip(c.langfuse_status, c.langfuse_status === 'enabled' ? 'live' : 'archived')}</dd>
            </dl>
          </div>
          <div class="card__foot">
            <a class="btn btn--primary btn--sm" href="${R.href('/companion/conversations')}">Open Conversations</a>
            <a class="btn btn--ghost btn--sm" href="${R.href('/companion/settings/guided-experiences')}">Guided Experiences ${icon('chevron-right', { size: 16 })}</a>
          </div>
        </div>

        <div class="notice notice--quiet">
          ${icon('info', { size: 18 })}
          <div>Every member and conversation here is synthetic local demonstration data. Nothing leaves this machine except by explicit development configuration.</div>
        </div>
      </div>
    </div>
  </div>`;
}

window.Veye.TRACKER_KEYS = TRACKER_KEYS;
window.Veye.TRACKER_LABELS = TRACKER_LABELS;
window.Veye.REQUEST_KIND_LABELS = REQUEST_KIND_LABELS;
window.Veye.resultSummary = resultSummary;
window.Veye.companionOverview = companionOverview;
window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.home = { render };

})();
