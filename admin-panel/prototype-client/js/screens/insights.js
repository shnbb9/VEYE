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

/* Overall member retention and how long members stay (Cara, 25 Nov 2026).
   Every figure carries its definition. Program retention, correlations and
   the chart builder are Phase 2. */
const BUCKETS = [['Same day', 0, 0], ['1–7 days', 1, 7], ['8–30 days', 8, 30], ['1–3 months', 31, 90], ['3–6 months', 91, 180], ['6–12 months', 181, 365], ['Over a year', 366, Infinity]];
function retention(people) {
  const DAY = 864e5, now = Date.now();
  const days = (iso) => Math.floor((now - Date.parse(iso)) / DAY);
  const share = (part, whole) => `${Math.round((part / whole) * 100)}%`;
  const active = (n) => people.filter((m) => m.lastActiveAt && days(m.lastActiveAt) <= n).length;
  const back = (n) => { const eligible = people.filter((m) => days(m.joinedAt) >= n); return { eligible: eligible.length, returned: eligible.filter((m) => m.firstReturnDay && m.firstReturnDay <= n).length }; };
  const judged = people.filter((m) => days(m.joinedAt) >= 30);
  const stayed = judged.map((m) => (m.lastActiveAt ? Math.max(0, Math.floor((Date.parse(m.lastActiveAt) - Date.parse(m.joinedAt)) / DAY)) : 0)).sort((a, b) => a - b);
  const bars = BUCKETS.map(([label, lo, hi]) => ({ label, members: stayed.filter((d) => d >= lo && d <= hi).length }));
  const tallest = Math.max(1, ...bars.map((b) => b.members));
  const median = stayed.length ? stayed[Math.floor(stayed.length / 2)] : 0;
  const steps = [['Joined', people.length], ['Verified their email', people.filter((m) => m.emailVerified).length], ['Took the Health Number quiz', people.filter((m) => m.onboarding === 'Complete').length], ['Chose foods', people.filter((m) => m.choseFoods).length]];
  return `<section data-testid="retention" aria-labelledby="retentionTitle" style="margin-top:var(--s-6)">
    <h2 class="card__title" id="retentionTitle">Retention</h2>
    <p class="t-support">From the days members opened Veye. Sample data.</p>
    <div class="kpis kpis--quad" style="margin-top:var(--s-4)">
      <div class="kpi"><span class="kpi__label">Joined</span><span class="kpi__value">${people.filter((m) => days(m.joinedAt) <= 30).length}</span><span class="kpi__note">in the last 30 days, of ${people.length} members</span></div>
      <div class="kpi"><span class="kpi__label">Active</span><span class="kpi__value">${active(30)}</span><span class="kpi__note">opened Veye in the last 30 days · ${active(7)} in the last 7</span></div>
      ${[7, 30].map((n) => { const r = back(n); return `<div class="kpi"><span class="kpi__label">Came back within ${n} days</span><span class="kpi__value">${r.eligible ? share(r.returned, r.eligible) : '—'}</span><span class="kpi__note">${r.returned} of ${r.eligible} who joined at least ${n} days ago opened it again on a later day</span></div>`; }).join('')}
    </div>
    <div class="grid grid--2" style="margin-top:var(--s-5)">
      <div class="card"><div class="card__head"><div><h3 class="card__title">How long members stay</h3><p class="t-support">Days from joining to the last day a member opened Veye, for members who joined at least 30 days ago.</p></div></div>
        <div class="card__body"><ul class="histogram" aria-label="How long ${stayed.length} members stayed">${bars.map((b) => `<li><span class="histogram__n">${b.members}</span><span class="histogram__bar" style="height:${Math.max(b.members ? 6 : 0, Math.round((b.members / tallest) * 100))}%" aria-hidden="true"></span><span class="histogram__label">${b.label}</span></li>`).join('')}</ul>
          <p class="t-support" style="margin-top:var(--s-3)">${stayed.length} members · half stayed ${median} days or longer.</p>
          <p class="t-support" style="margin-top:var(--s-3)">Inactive: ${people.length - active(30)} member${people.length - active(30) === 1 ? ' has' : 's have'} not opened Veye in the last 30 days.</p></div></div>
      <div class="card" data-testid="getting-started"><div class="card__head"><div><h3 class="card__title">Getting started</h3><p class="t-support">How far members have got after joining, and where they stopped.</p></div></div>
        <div class="card__body"><div class="bars bars--wide">${steps.map(([label, n]) => `<div class="bar"><span class="bar__label">${label}</span><span class="bar__track"><span class="bar__fill bar__fill--deep" style="width:${share(n, people.length)}"></span></span><span class="bar__n">${n}<span class="t-muted"> · ${people.length - n} not yet</span></span></div>`).join('')}</div></div></div>
    </div>
  </section>`;
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
  const people = st.members.filter((m) => !m.archivedAt);
  // The food diary is not part of the sharing choice (Cara, 25 Nov 2026).
  const diaryEntries = people.reduce((t, m) => t + m.diary.length, 0);
  const diaryMembers = people.filter((m) => m.diary.length).length;
  const total = people.length;
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

    ${retention(people)}

    <div class="grid grid--2" style="margin-top:var(--s-6)">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">New members by month</h2><p class="t-support">Member profiles created, last twelve months.</p></div></div>
        <div class="card__body">${monthBars(membersByMonth)}</div>
      </div>
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Tracker usage</h2><p class="t-support">Members with at least one saved result. The bar is their share of all ${total} members.</p></div></div>
        <div class="card__body"><div class="bars bars--wide">
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
    <p class="t-support" style="margin-top:var(--s-4)">Generated ${esc(H.fmtDate(new Date().toISOString()))}. Synthetic demonstration data.</p>
  </div>`;
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.insights = { render };

})();
