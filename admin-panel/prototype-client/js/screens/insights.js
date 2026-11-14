/* ============================================================================
   Insights
   ----------------------------------------------------------------------------
   The console's Insights (platform/web app/admin/insights/page.tsx) — light
   and real: member count and sign-ups by month, tracker usage, guided-flow
   starts and completions, Companion usage and feedback, requests and journal
   use. Every figure is a count; no medical conclusion, no health-outcome
   analytics, no invented trend. Anything taken from a health, mood or food
   record counts only members who share their health records.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const S = window.Veye.S;
const H = window.Veye.H;
const esc = window.Veye.UI.esc;

const STATUS_LABELS = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };

function byMonth(dates) {
  const months = H.lastTwelveMonths();
  const tally = Object.fromEntries(months.map((m) => [m, 0]));
  dates.forEach((d) => { const m = H.monthOf(d); if (m in tally) tally[m] += 1; });
  return months.map((month) => ({ month, count: tally[month] }));
}

function monthBars(series) {
  const max = Math.max(1, ...series.map((m) => m.count));
  return `<div class="bars">${series.map((m) => `<div class="bar">
    <span class="bar__label">${esc(H.monthLabel(m.month))}</span>
    <span class="bar__track"><span class="bar__fill" style="width:${Math.max(m.count ? 4 : 0, Math.round((m.count / max) * 100))}%"></span></span>
    <span class="bar__n">${m.count}</span>
  </div>`).join('')}</div>`;
}

function render(outlet) {
  const st = S.get();
  const KEYS = window.Veye.TRACKER_KEYS;
  const LABELS = window.Veye.TRACKER_LABELS;
  const allowed = st.members.filter(S.shares);
  const attempts = {}; const membersCompleted = {}; const attemptsByMonth = {};
  KEYS.forEach((k) => {
    const rows = allowed.flatMap((m) => m.records[k]);
    attempts[k] = rows.length;
    membersCompleted[k] = allowed.filter((m) => m.records[k].length).length;
    attemptsByMonth[k] = byMonth(rows.map((r) => r.completed_at));
  });
  const membersByMonth = byMonth(st.members.map((m) => m.joinedAt));
  const sessions = st.members.flatMap((m) => m.guided);
  const flows = [...new Set([...st.guidedFlows.map((f) => f.key), ...sessions.map((s) => s.flow_key)])].sort().map((key) => {
    const mine = sessions.filter((s) => s.flow_key === key);
    const flow = st.guidedFlows.find((f) => f.key === key);
    return { flow_key: key, flow_title: flow ? flow.title : key, started: mine.length,
      in_progress: mine.filter((s) => s.status === 'in_progress').length, paused: mine.filter((s) => s.status === 'paused').length,
      completed: mine.filter((s) => s.status === 'completed').length, skipped: mine.filter((s) => s.status === 'skipped').length };
  });
  const messages = st.conversations.reduce((t, c) => t + c.messages.length, 0);
  const helpful = st.feedback.filter((f) => f.rating === 'helpful').length;
  const notHelpful = st.feedback.filter((f) => f.rating === 'not_helpful').length;
  const reqByKind = {}; const reqByStatus = {};
  st.requests.forEach((r) => { reqByKind[r.kind] = (reqByKind[r.kind] || 0) + 1; reqByStatus[r.status] = (reqByStatus[r.status] || 0) + 1; });
  const moodEntries = allowed.reduce((t, m) => t + m.mood.length, 0);
  const moodMembers = allowed.filter((m) => m.mood.length).length;
  const diaryEntries = allowed.reduce((t, m) => t + m.diary.length, 0);
  const diaryMembers = allowed.filter((m) => m.diary.length).length;
  const total = st.members.length;
  const results = KEYS.reduce((t, k) => t + attempts[k], 0);

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Insights', desc: 'How members are using Veye — counts from the database, nothing modelled.', crumbs: [{ label: 'Home', route: '/home' }, { label: 'Insights' }] })}
    <div class="kpis kpis--quad">
      <div class="kpi"><span class="kpi__label">${icon('users', { size: 16 })} Members</span><span class="kpi__value">${total}</span><span class="kpi__note">accounts with a member profile</span></div>
      <div class="kpi"><span class="kpi__label">${icon('clipboard', { size: 16 })} Results saved</span><span class="kpi__value">${results}</span><span class="kpi__note">across the five trackers</span></div>
      <div class="kpi"><span class="kpi__label">${icon('sprout', { size: 16 })} Guided sessions</span><span class="kpi__value">${flows.reduce((t, f) => t + f.started, 0)}</span><span class="kpi__note">${flows.reduce((t, f) => t + f.completed, 0)} completed</span></div>
      <div class="kpi"><span class="kpi__label">${icon('messages', { size: 16 })} Sprout conversations</span><span class="kpi__value">${st.conversations.length}</span><span class="kpi__note">${messages} messages · ${helpful} helpful / ${notHelpful} not helpful</span></div>
    </div>

    <div class="grid grid--2" style="margin-top:var(--s-6)">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">New members by month</h2><p class="t-support">Member profiles created, last twelve months.</p></div></div>
        <div class="card__body">${monthBars(membersByMonth)}</div>
      </div>
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Tracker usage</h2><p class="t-support">Members with at least one saved result. The bar is their share of all ${total} members.</p></div></div>
        <div class="card__body"><div class="bars">
          ${KEYS.map((k) => {
            const members = membersCompleted[k];
            const pct = total ? Math.round((members / total) * 100) : 0;
            return `<div class="bar"><span class="bar__label">${LABELS[k]}</span>
              <span class="bar__track"><span class="bar__fill bar__fill--deep" style="width:${Math.max(pct, members ? 4 : 0)}%"></span></span>
              <span class="bar__n">${members}<span class="t-muted"> of ${total} · ${attempts[k]} saved</span></span></div>`;
          }).join('')}
        </div></div>
      </div>
    </div>

    <div class="grid" style="margin-top:var(--s-5)">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Results saved by month</h2><p class="t-support">Per tracker, last twelve months.</p></div></div>
        <div class="card__body card__body--flush"><div class="table-wrap"><table class="table table--compact">
          <thead><tr><th scope="col">Month</th>${KEYS.map((k) => `<th scope="col">${LABELS[k]}</th>`).join('')}</tr></thead>
          <tbody>${membersByMonth.map((m, i) => `<tr><th scope="row">${esc(H.monthLabel(m.month))}</th>${KEYS.map((k) => `<td>${attemptsByMonth[k][i].count}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div></div>
      </div>
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Guided experiences</h2><p class="t-support">Sprout's guided flows: starts and where they stand.</p></div></div>
        <div class="card__body card__body--flush"><div class="table-wrap"><table class="table table--compact">
          <thead><tr><th scope="col">Flow</th><th scope="col">Started</th><th scope="col">In progress</th><th scope="col">Paused</th><th scope="col">Completed</th><th scope="col">Explored instead</th></tr></thead>
          <tbody>
            ${flows.map((f) => `<tr><th scope="row">${esc(f.flow_title)}</th><td>${f.started}</td><td>${f.in_progress}</td><td>${f.paused}</td><td>${f.completed}</td><td>${f.skipped}</td></tr>`).join('')}
            ${flows.length ? '' : '<tr><td colspan="6" class="t-support">No guided flow is active.</td></tr>'}
          </tbody>
        </table></div></div>
      </div>
    </div>

    <div class="grid grid--2" style="margin-top:var(--s-5)" data-testid="insights-phase1">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Requests &amp; Inbox</h2><p class="t-support">Messages received by month, by kind and by status.</p></div></div>
        <div class="card__body">
          ${monthBars(byMonth(st.requests.map((r) => r.created_at)))}
          <dl class="kv" style="margin-top:var(--s-4)">
            ${Object.entries(reqByKind).map(([k, n]) => `<dt>${esc(window.Veye.REQUEST_KIND_LABELS[k] || k)}</dt><dd>${n}</dd>`).join('')}
            ${Object.entries(reqByStatus).map(([k, n]) => `<dt>${esc(STATUS_LABELS[k] || k)}</dt><dd>${n}</dd>`).join('')}
            ${Object.keys(reqByKind).length ? '' : '<dt>Requests</dt><dd class="t-muted">None yet</dd>'}
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Journal use</h2><p class="t-support">Mood Tracker and Food Diary — entries and how many members use them.</p></div></div>
        <div class="card__body">
          <dl class="kv">
            <dt>Mood entries</dt><dd>${moodEntries} across ${moodMembers} member${moodMembers === 1 ? '' : 's'}</dd>
            <dt>Food Diary entries</dt><dd>${diaryEntries} across ${diaryMembers} member${diaryMembers === 1 ? '' : 's'}</dd>
          </dl>
          <p class="t-support" style="margin-top:var(--s-4)">Counts only. No mood or nutrition conclusion is drawn here.</p>
        </div>
      </div>
    </div>
    <p class="t-support" style="margin-top:var(--s-4)">Generated ${esc(H.fmtDate(new Date().toISOString()))} from the local database. Synthetic demonstration data.</p>
  </div>`;
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.insights = { render };

})();
