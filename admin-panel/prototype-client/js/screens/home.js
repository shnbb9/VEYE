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
  const people = st.members.filter((m) => !m.archivedAt);
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
    members_total: people.length,
    members_verified: people.filter((m) => m.emailVerified).length,
    members_new_last_7_days: people.filter((m) => within(m.joinedAt, 7)).length,
    members_new_last_30_days: people.filter((m) => within(m.joinedAt, 30)).length,
    members_active_last_7_days: people.filter((m) => within(m.lastActiveAt, 7)).length,
    questions_awaiting: st.requests.filter(window.Veye.awaitingReply).length,
    completions, members_completed: membersCompleted,
    guided_sessions_total: sessions.length,
    guided_sessions_in_progress: sessions.filter((g) => g.status === 'in_progress' || g.status === 'paused').length,
    guided_sessions_completed: sessions.filter((g) => g.status === 'completed').length,
    requests_open: st.requests.filter((r) => r.status !== 'resolved').length,
    requests_new: st.requests.filter((r) => r.status === 'new').length,
    requests_in_progress: st.requests.filter((r) => r.status === 'in_progress').length,
    mood_entries_total: allowed.reduce((t, m) => t + m.mood.length, 0),
    // The food diary is not part of the sharing choice (Cara, 25 Nov 2026).
    food_diary_entries_total: people.reduce((t, m) => t + m.diary.length, 0),
    recent_members: [...people].sort((a, b) => (a.joinedAt < b.joinedAt ? 1 : -1)).slice(0, 6),
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
        <a class="quick__btn" href="${R.href('/assessments')}">${icon('clipboard')}<span>Assessment results</span>${icon('chevron-right', { size: 16 })}</a>
        <a class="quick__btn" href="${R.href('/care')}">${icon('heart')}<span>Edit member content</span>${icon('chevron-right', { size: 16 })}</a>
        <a class="quick__btn" href="${R.href('/companion/conversations')}">${icon('sprout')}<span>Review Companion messages</span>${icon('chevron-right', { size: 16 })}</a>
        <a class="quick__btn" href="${R.href('/requests?view=awaiting_reply')}" data-testid="questions-awaiting">${icon('inbox')}<span>Questions awaiting a reply (${o.questions_awaiting})</span>${icon('chevron-right', { size: 16 })}</a>
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

    <div id="attentionHost"></div>

    <div class="grid grid--main-side" style="margin-top:var(--s-6)">
      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">${icon('clipboard')} Progress trackers</h2><p class="t-support">Members with at least one saved result. The bar is their share of all ${o.members_total} members.</p></div></div>
          <div class="card__body">
            <div class="bars bars--wide">
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
          <div>Every member and conversation here is synthetic demonstration data. Nothing is sent anywhere; changes stay in this browser.</div>
        </div>
      </div>
    </div>
  </div>`;
  attention(outlet.querySelector('#attentionHost'));
}

/* ------------------------------------------------- Needs your attention --
   Messages and handed-over Sprout conversations in one list (Cara, 15 Nov).
   It owns nothing: every row opens where the message lives, and "somebody
   read it" is kept apart from "somebody answered it". */
const ATT_LABEL = { reply_needed: 'Reply needed', reply_failed: 'Reply not delivered', review_needed: 'Review needed', replied: 'Replied, not resolved', reviewed: 'Reviewed, not resolved', resolved: 'Resolved' };
const ATT_TONE = { reply_needed: 'attention', reply_failed: 'error', review_needed: 'attention', replied: 'info', reviewed: 'info', resolved: 'live' };
const ATT_SHOW = [['waiting', 'Waiting'], ['replied', 'Replied'], ['reviewed', 'Reviewed'], ['resolved', 'Resolved']];
const ATT_PAGE = 6;
let att = { state: 'waiting', who: 'any', priority: 'any', page: 1 };

function attentionItems() {
  const st = S.get();
  const items = st.requests.map((r) => {
    const sent = window.Veye.requestState(r);
    const state = r.status === 'resolved' ? 'resolved' : sent === 'failed' ? 'reply_failed' : sent === 'replied' ? 'replied' : 'reply_needed';
    const m = r.member_id && S.member(r.member_id);
    return { source: 'request', id: r.id, state, at: r.created_at, priority: r.priority, person: r.name || r.email || 'Visitor', kind: m && !m.archivedAt ? 'member' : r.member_id ? 'former' : 'visitor',
      title: r.subject || REQUEST_KIND_LABELS[r.kind], detail: [REQUEST_KIND_LABELS[r.kind], r.message.replace(/\s+/g, ' ').slice(0, 120)].filter(Boolean).join(' · ') };
  });
  st.conversations.filter((c) => c.flagged).forEach((c) => {
    const m = S.member(c.member_id);
    items.push({ source: 'conversation', id: c.id, state: c.resolved_at ? 'resolved' : c.reviewed_at ? 'reviewed' : 'review_needed', at: c.last_message_at, priority: c.priority,
      person: m ? m.name : 'Member', kind: m && !m.archivedAt ? 'member' : 'former', title: 'Sprout handed a question to a person', detail: c.flag_reason || '' });
  });
  return items;
}

const attGroup = (state) => (['reply_needed', 'reply_failed', 'review_needed'].includes(state) ? 'waiting' : state);

function attention(host) {
  const rank = { high: 0, medium: 1, low: 2 };
  const filtered = attentionItems().filter((i) => att.who === 'any' || i.kind === att.who).filter((i) => att.priority === 'any' || (i.priority || 'unassigned') === att.priority);
  const count = (key) => filtered.filter((i) => attGroup(i.state) === key).length;
  const list = filtered.filter((i) => attGroup(i.state) === att.state)
    .sort((a, b) => ((rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)) || (a.at < b.at ? -1 : 1));
  const pages = Math.max(1, Math.ceil(list.length / ATT_PAGE));
  att.page = Math.min(att.page, pages);
  const select = (id, label, options, value) => `<div class="field" style="margin:0"><label class="sr-only" for="${id}">${label}</label><select class="select input--sm" id="${id}">${options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  host.innerHTML = `<section class="card" data-testid="attention" aria-labelledby="attentionTitle" style="margin-top:var(--s-6)">
    <div class="card__head"><div><h2 class="card__title" id="attentionTitle">${icon('inbox')} Needs your attention</h2><p class="t-support">Messages nobody has answered and questions Sprout handed to a person. Importance first, then the oldest.</p></div></div>
    <div class="findbar">
      <div class="modeswitch" role="tablist" aria-label="Which items">${ATT_SHOW.map(([k, l]) => `<button class="modeswitch__btn" type="button" role="tab" aria-selected="${att.state === k}" data-att="${k}">${l} (${count(k)})</button>`).join('')}</div>
      <span class="findbar__spacer"></span>
      <div class="findbar__filters">${select('attWho', 'From', [['any', 'From anyone'], ['member', 'From active members'], ['visitor', 'From visitors']], att.who)}${select('attPriority', 'Importance', [['any', 'Any importance'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['unassigned', 'Not set']], att.priority)}</div>
    </div>
    ${list.length ? '' : `<div class="card__body">${H.emptyState({ icon: 'check-circle', title: att.state === 'waiting' ? 'Nothing is waiting' : 'Nothing here', msg: att.state === 'waiting' ? 'Every message has been answered and every handed-over conversation has been read.' : 'No item is in this state.' })}</div>`}
    <div class="rows" data-testid="attention-list">${list.slice((att.page - 1) * ATT_PAGE, att.page * ATT_PAGE).map((i) => `<div class="rowitem" data-testid="attention-row" style="grid-template-columns:auto minmax(0,1fr) auto">
      <span class="rowitem__icon">${icon(i.source === 'request' ? 'mail' : 'sprout', { size: 18 })}</span>
      <div style="min-width:0"><div class="rowitem__title">${esc(i.title)} ${H.chip(ATT_LABEL[i.state], ATT_TONE[i.state])} ${window.Veye.MC.priorityChip(i.priority)}</div>
        <div class="rowitem__meta">${esc(i.person)}${i.kind === 'visitor' ? ' (visitor)' : i.kind === 'former' ? ' (no longer a member)' : ''} · ${esc(H.fmtDate(i.at))}</div>
        ${i.detail ? `<div class="rowitem__meta">${esc(i.detail)}</div>` : ''}</div>
      <div class="rowitem__side"><a class="btn btn--secondary btn--sm" href="${R.href(i.source === 'request' ? '/requests?view=all&id=' + i.id : '/companion/conversations?conversation=' + i.id)}">${i.source === 'request' ? 'Open request' : 'Review conversation'}<span class="sr-only"> from ${esc(i.person)}</span></a></div>
    </div>`).join('')}</div>
    <div class="card__foot" style="justify-content:space-between"><span class="t-support">Importance is set by the team. It is not medical triage.</span>
      ${pages > 1 ? `<span class="row gap-2"><button class="btn btn--ghost btn--sm" type="button" id="attPrev" ${att.page <= 1 ? 'disabled' : ''}>Previous</button><span class="t-support">Page ${att.page} of ${pages}</span><button class="btn btn--ghost btn--sm" type="button" id="attNext" ${att.page >= pages ? 'disabled' : ''}>Next</button></span>` : ''}</div>
  </section>`;
  const set = (patch) => { att = { ...att, page: 1, ...patch }; attention(host); };
  host.querySelectorAll('[data-att]').forEach((b) => b.addEventListener('click', () => { set({ state: b.dataset.att }); host.querySelector(`[data-att="${att.state}"]`).focus(); }));
  host.querySelector('#attWho').addEventListener('change', (e) => { set({ who: e.target.value }); host.querySelector('#attWho').focus(); });
  host.querySelector('#attPriority').addEventListener('change', (e) => { set({ priority: e.target.value }); host.querySelector('#attPriority').focus(); });
  const prev = host.querySelector('#attPrev'); if (prev) prev.addEventListener('click', () => set({ page: att.page - 1 }));
  const next = host.querySelector('#attNext'); if (next) next.addEventListener('click', () => set({ page: att.page + 1 }));
}

/** Whether a person has answered: a reply that never left is not an answer. */
function requestState(r) {
  if (r.replies.some((x) => x.delivery_status === 'sent')) return 'replied';
  return r.replies.length ? 'failed' : 'awaiting';
}

/** A question nobody has answered: Join Beta asks for nothing to be said. */
function awaitingReply(r) { return r.kind !== 'join_beta' && r.status !== 'resolved' && requestState(r) !== 'replied'; }

window.Veye.awaitingReply = awaitingReply;
window.Veye.requestState = requestState;
window.Veye.TRACKER_KEYS = TRACKER_KEYS;
window.Veye.TRACKER_LABELS = TRACKER_LABELS;
window.Veye.REQUEST_KIND_LABELS = REQUEST_KIND_LABELS;
window.Veye.resultSummary = resultSummary;
window.Veye.companionOverview = companionOverview;
window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.home = { render: (outlet) => { att = { state: 'waiting', who: 'any', priority: 'any', page: 1 }; render(outlet); } };

})();
