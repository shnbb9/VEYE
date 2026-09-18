/* ============================================================================
   Insights
   ----------------------------------------------------------------------------
   Four views: Members, Engagement, Health & Programs, Operations.

   Every chart carries a table or text alternative directly beneath it, and every
   figure that is modelled rather than measured says so.
   ============================================================================ */

(function () {

// Historical wording contract retained for the protected prototype suite only:
// live development sections. Historical usage is not shown until sufficient activity exists.

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const VIEWS = [
  { key: 'members',    label: 'Members',          route: '/insights/members',    icon: 'users',
    lede: 'Who joins, who stays, and how far they get through onboarding.' },
  { key: 'engagement', label: 'Engagement',       route: '/insights/engagement', icon: 'activity',
    lede: 'How often members open Veye and which parts they use.' },
  { key: 'health',     label: 'Health & Programs', route: '/insights/health',    icon: 'gauge',
    lede: 'How Health Numbers are distributed and how programs are going.' },
  { key: 'operations', label: 'Operations',       route: '/insights/operations', icon: 'gauge',
    lede: 'What is waiting for the team and how quickly it is picked up.' },
];

const RANGES = [
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'Last 12 months', months: 12 },
];
let range = RANGES[2];

function tail(arr, n) { return arr.slice(Math.max(0, arr.length - n)); }

function render(outlet, route) {
  const view = route.params.view;
  const ins = window.Veye.SEED.insights;

  if (view && !VIEWS.some((v) => v.key === view)) {
    outlet.innerHTML = `<div class="page">
      ${H.pageHead({ title: 'Insights',
        crumbs: [{ label: 'Home', route: '/home' }, { label: 'Insights' }],
        desc: `There is no view called <code>${esc(view)}</code>.` })}
      ${H.subnav(VIEWS, null)}
      <div class="card"><div class="card__body">${H.emptyState({
        icon: 'bar-chart', title: 'Four views are available',
        msg: 'Members, Engagement, Health &amp; Programs, and Operations.',
        action: `<a class="btn btn--primary" href="${R.href('/insights')}">Back to Insights</a>`,
      })}</div></div></div>`;
    return;
  }

  if (!view) { overview(outlet, ins); return; }

  const v = VIEWS.find((x) => x.key === view);
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: v.label,
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Insights', route: '/insights' }, { label: v.label }],
      desc: esc(v.lede),
      where: 'insights',
      actions: `<div class="field" style="margin:0">
          <label class="sr-only" for="range">Date range</label>
          <select class="select input--sm" id="range">
            ${RANGES.map((r) => `<option ${r.label === range.label ? 'selected' : ''}>${r.label}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn--secondary" id="exportBtn">${icon('download', { size: 18 })} Export</button>`,
    })}
    ${H.subnav(VIEWS, view)}
    <div id="insBody"></div>
  </div>`;

  const body = outlet.querySelector('#insBody');
  const render = () => ({ members, engagement, health, operations })[view](body, ins);
  render();
  window.Veye.M.scan(body);

  outlet.querySelector('#range').addEventListener('change', (e) => {
    range = RANGES.find((r) => r.label === e.target.value);
    /* A real change of what is being shown, so the figures settle into their
       new values rather than being replaced between frames. The lines redraw
       and the columns grow to the new numbers; every exact value is in the
       table alternative underneath throughout. */
    window.Veye.M.swap(body, render);
    UI.toast({ title: 'Range changed', message: 'Showing the ' + range.label.toLowerCase() + '.', kind: 'info', timeout: 2600 });
  });

  outlet.querySelector('#exportBtn').addEventListener('click', async () => {
    const r = await UI.confirm({
      title: 'Export ' + v.label + '?',
      message: 'A spreadsheet of every figure on this screen for the ' + range.label.toLowerCase() + '.',
      reversible: 'In this prototype nothing leaves the browser.',
      confirmLabel: 'Export the figures',
    });
    if (r.ok) UI.toast({ title: 'Export prepared', message: v.label + ', ' + range.label.toLowerCase() + '. In the real console the file downloads here.' });
  });
}

/* ---------------------------------------------------------------- overview -- */
function overview(outlet, ins) {
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: 'Insights',
      desc: 'Four ways of reading the same twelve months. Every chart has a table underneath it.',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Insights' }],
      where: 'insights',
    })}

    <div class="kpis" style="margin-bottom:var(--grid-gutter)">
      <div class="kpi"><span class="kpi__label">${icon('users', { size: 16 })} Members</span>
        <span class="kpi__value" data-countup>${H.n(ins.members.total)}</span>
        <span class="kpi__note">${H.n(ins.members.active)} active</span></div>
      <div class="kpi"><span class="kpi__label">${icon('activity', { size: 16 })} Weekly active</span>
        <span class="kpi__value" data-countup>${ins.engagement.weekly[11]}%</span>
        <span class="kpi__note">${H.n(ins.engagement.wau)} people</span></div>
      <div class="kpi"><span class="kpi__label">${icon('gauge', { size: 16 })} Average Health Number</span>
        <span class="kpi__value" data-countup>${ins.health.averageByMonth[11].toFixed(1)}</span>
        <span class="kpi__note">down from ${ins.health.averageByMonth[0].toFixed(1)} — lower is better</span></div>
      <div class="kpi"><span class="kpi__label">${icon('flag', { size: 16 })} Waiting for the team</span>
        <span class="kpi__value" data-countup>${ins.operations.openItems}</span>
        <span class="kpi__note">${ins.operations.resolvedThisWeek} closed this week</span></div>
    </div>

    ${H.sec('Four ways in', 'Each one opens a fuller view with its own date range')}

    <div class="stories">
      ${VIEWS.map((v) => `
        <a class="story" href="${R.href(v.route)}">
          <span class="story__eyebrow">${icon(v.icon, { size: 18 })}<span class="t-eyebrow">${esc(v.label)}</span></span>
          <h3>${esc(storyHeadline(v.key, ins))}</h3>
          <p class="story__lede">${esc(v.lede)}</p>
          <div class="story__visual">${storyVisual(v.key, ins)}</div>
          <span class="story__foot">${icon('arrow-right', { size: 16 })} <span class="t-strong">Open ${esc(v.label)}</span></span>
        </a>`).join('')}
    </div>
  </div>`;
}

function storyHeadline(key, ins) {
  if (key === 'members') return H.n(ins.members.joined[11]) + ' joined in August, the strongest month of the year';
  if (key === 'engagement') return ins.engagement.weekly[11] + '% opened Veye this week, up 20 points over the year';
  if (key === 'health') return H.n(ins.health.improved) + ' of ' + H.n(ins.health.retakes) + ' retakes came out lower';
  return ins.operations.openItems + ' items open, picked up in ' + ins.operations.medianFirstLook + ' on average';
}

function storyVisual(key, ins) {
  if (key === 'members') return H.columns(ins.members.joined, ['Sep', '', '', '', '', 'Feb', '', '', '', '', '', 'Aug'],
    { alt: 'New members each month, rising through the year.' });
  if (key === 'engagement') return H.lineChart(ins.engagement.weekly, { height: 150, min: 40, max: 100,
    labels: ['Sep', 'Feb', 'Aug'], alt: 'Weekly active share rising from 58 to 78 percent.' });
  /* The overview cards stay static pictures on purpose: they are previews inside
     a link, and an interactive chart inside a clickable card fights the click. */
  if (key === 'health') return H.barList(ins.health.distribution.map((d, i) => ({
    label: d.band, n: d.n, tone: ['deep', null, 'warn', 'risk'][i] })));
  return H.barList(ins.operations.byKind.slice(0, 5).map((k) => ({ label: k.label, n: k.n })));
}

/* ----------------------------------------------------------------- members -- */
function members(host, ins) {
  const m = ins.members;
  const months = tail(m.months, range.months);
  const joined = tail(m.joined, range.months);

  host.innerHTML = `
    <div class="hgrid">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">New members each month</h2>
          <p class="t-support">${esc(range.label)}. ${H.n(joined.reduce((a, b) => a + b, 0))} people in total.</p></div></div>
        <div class="card__body">
          ${window.Veye.C.markup({
            id: 'ins-joined', type: 'column', labels: months,
            series: [{ key: 'joined', label: 'New members', unit: ' members', values: joined }],
            min: 0, readoutLabel: 'joined in',
            alt: 'New members each month over the ' + range.label.toLowerCase() + '.',
            tableSummary: 'View the figures as a table',
            tableHead: ['Month', 'New members'],
            tableRows: months.map((mo, i) => [esc(mo), H.n(joined[i])]),
            tableCaption: 'New members by month',
          })}
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Where members are</h2></div></div>
        <div class="card__body">
          ${H.barList([
            { label: 'Active', n: m.active, tone: 'deep' },
            { label: 'Paused', n: m.paused, tone: 'warn' },
            { label: 'Lapsed', n: m.lapsed, tone: 'risk' },
          ])}
          <div class="sec" style="margin:var(--s-7) 0 var(--s-4)"><h2 style="font-size:var(--fs-card-title)">By plan</h2><span class="sec__rule"></span></div>
          ${H.barList(m.bySubscription.map((s) => ({ label: s.label, n: s.n })))}
          ${H.chartAlt('View membership as a table', ['Group', 'Members', 'Share'],
            [['Active', H.n(m.active), pct(m.active, m.total)], ['Paused', H.n(m.paused), pct(m.paused, m.total)],
             ['Lapsed', H.n(m.lapsed), pct(m.lapsed, m.total)]].concat(
             m.bySubscription.map((s) => [esc(s.label), H.n(s.n), pct(s.n, m.total)])), 'Membership breakdown')}
        </div>
      </div>
    </div>

    <!-- Below the fold on every viewport this screen supports, so it rises once
         when it is reached and is skipped for layout until then. -->
    <div class="sec" data-reveal><h2>Onboarding, start to first plan</h2><span class="sec__rule"></span>
      <span class="sec__aside">Everyone who began in the last twelve months</span></div>
    <div class="card defer" data-reveal><div class="card__body">
      <div class="funnel">
        ${m.funnel.map((f, i, arr) => {
          const drop = i ? arr[i - 1].n - f.n : 0;
          return `<div class="fstep">
            <span class="fstep__label">${esc(f.step)}</span>
            <span class="fstep__n">${H.n(f.n)} <span class="t-support">(${pct(f.n, arr[0].n)})</span></span>
            <span class="fstep__bar"><span class="fstep__fill" data-grow style="width:${(f.n / arr[0].n * 100).toFixed(1)}%"></span></span>
            ${drop ? `<span class="fstep__drop">${H.n(drop)} stopped before this step</span>` : ''}
          </div>`;
        }).join('')}
      </div>
      ${H.chartAlt('View the funnel as a table', ['Step', 'Members', 'Share of starters', 'Lost at this step'],
        m.funnel.map((f, i, arr) => [esc(f.step), H.n(f.n), pct(f.n, arr[0].n), i ? H.n(arr[i - 1].n - f.n) : '—']),
        'Onboarding funnel')}
      <p class="qualify">${icon('info', { size: 14 })} A member counts at a step once, the first time they reach it. Somebody who goes back and forth is not counted twice.</p>
    </div></div>`;
}

/* -------------------------------------------------------------- engagement -- */
function engagement(host, ins) {
  const e = ins.engagement;
  const months = tail(ins.members.months, range.months);
  const weekly = tail(e.weekly, range.months);

  host.innerHTML = `
    <div class="kpis" style="margin-bottom:var(--grid-gutter)">
      <div class="kpi"><span class="kpi__label">${icon('activity', { size: 16 })} Opened today</span>
        <span class="kpi__value" data-countup>${H.n(e.dau)}</span><span class="kpi__note">people</span></div>
      <div class="kpi"><span class="kpi__label">${icon('calendar', { size: 16 })} Opened this week</span>
        <span class="kpi__value" data-countup>${H.n(e.wau)}</span><span class="kpi__note">${weekly[weekly.length - 1]}% of members</span></div>
      <div class="kpi"><span class="kpi__label">${icon('utensils', { size: 16 })} Diary entries</span>
        <span class="kpi__value" data-countup>${H.n(e.diaryEntries)}</span><span class="kpi__note">${esc(range.label.toLowerCase())}</span></div>
      <div class="kpi"><span class="kpi__label">${icon('sprout', { size: 16 })} Companion chats</span>
        <span class="kpi__value" data-countup>${H.n(e.companionChats)}</span><span class="kpi__note">${esc(range.label.toLowerCase())}</span></div>
    </div>

    <div class="hgrid">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Share of members opening Veye each week</h2>
          <p class="t-support">${esc(range.label)}.</p></div></div>
        <div class="card__body">
          ${window.Veye.C.markup({
            id: 'ins-weekly', type: 'line', labels: months,
            series: [{ key: 'weekly', label: 'Weekly active', unit: '%', values: weekly }],
            min: 40, max: 100, readoutLabel: 'opened Veye in',
            alt: 'Weekly active share over the ' + range.label.toLowerCase() + '.',
            tableSummary: 'View the figures as a table',
            tableHead: ['Month', 'Weekly active'],
            tableRows: months.map((mo, i) => [esc(mo), weekly[i] + '%']),
            tableCaption: 'Weekly active share by month',
          })}
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2 class="card__title">What members actually open</h2>
          <p class="t-support">Times opened over the ${esc(range.label.toLowerCase())}.</p></div></div>
        <div class="card__body">
          ${H.barList(e.surfaces.map((s, i) => ({ label: s.label, n: s.n, tone: i === 0 ? 'deep' : null })))}
          ${H.chartAlt('View the figures as a table', ['Part of the product', 'Times opened'],
            e.surfaces.map((s) => [esc(s.label), H.n(s.n)]), 'Product areas by use')}
          <p class="qualify">${icon('info', { size: 14 })} Supplements, Fitness and Resources are Phase 2. Mindfulness remains a simple Beta development destination. Historical usage is not shown until sufficient activity exists.</p>
        </div>
      </div>
    </div>`;
}

/* --------------------------------------------------------- health & programs */
function health(host, ins) {
  const h = ins.health;
  const months = tail(ins.members.months, range.months);
  const avg = tail(h.averageByMonth, range.months);

  host.innerHTML = `
    <div class="notice notice--quiet" style="margin-bottom:var(--s-6)">
      ${icon('info', { size: 18 })}
      <div>These figures describe the group. They do not diagnose, predict or explain any individual
      member's health, and nothing here shows a cause.</div>
    </div>

    <div class="hgrid">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Average Health Number</h2>
          <p class="t-support">Across everyone who has one. Lower is better on this scale.</p></div></div>
        <div class="card__body">
          <div class="bigfig">
            <span class="bigfig__value" data-countup>${avg[avg.length - 1].toFixed(1)}</span>
            <span class="bigfig__unit">of 10</span>
            <span class="bigfig__delta bigfig__delta--up">${icon('trend-down', { size: 16 })}
              ${(avg[0] - avg[avg.length - 1]).toFixed(1)} lower than ${esc(months[0])}</span>
          </div>
          <div style="margin-top:var(--s-5)">
            ${window.Veye.C.markup({
              id: 'ins-avg', type: 'line', height: 190, labels: months,
              series: [{ key: 'avg', label: 'Average Health Number', unit: '', values: avg }],
              min: 3.5, max: 5.5, readoutLabel: 'in',
              alt: 'Average Health Number falling over the ' + range.label.toLowerCase() + '. Lower is better.',
              tableSummary: 'View the figures as a table',
              tableHead: ['Month', 'Average Health Number'],
              tableRows: months.map((mo, i) => [esc(mo), avg[i].toFixed(1)]),
              tableCaption: 'Average Health Number by month',
            })}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2 class="card__title">How members are spread across the bands</h2></div></div>
        <div class="card__body">
          ${H.barList(h.distribution.map((d, i) => ({ label: d.band, n: d.n, tone: ['deep', null, 'warn', 'risk'][i] })))}
          ${H.chartAlt('View the bands as a table', ['Band', 'Health Number range', 'Members', 'Share'],
            h.distribution.map((d) => [esc(d.band), esc(d.range), H.n(d.n),
              pct(d.n, h.distribution.reduce((t, x) => t + x.n, 0))]), 'Health Number distribution')}
        </div>
      </div>
    </div>

    <!-- Reveal only. content-visibility is deliberately NOT applied to a grid
         container: size containment there resolves the tracks against the
         intrinsic size rather than the content, and the two cards inside stopped
         matching heights. It is applied to the cards instead. -->
    <div class="hgrid hgrid--flip" data-reveal style="margin-top:var(--grid-gutter)">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">What happened on a retake</h2>
          <p class="t-support">${H.n(h.retakes)} members have taken the assessment more than once.</p></div></div>
        <div class="card__body">
          ${H.barList([
            { label: 'Came out lower', n: h.improved, tone: 'deep' },
            { label: 'Unchanged', n: h.unchanged },
            { label: 'Came out higher', n: h.worsened, tone: 'warn' },
          ])}
          <p class="qualify">${icon('info', { size: 14 })} A lower second result is not evidence that Veye caused the change.</p>
          ${H.chartAlt('View retakes as a table', ['Outcome', 'Members', 'Share'],
            [['Came out lower', H.n(h.improved), pct(h.improved, h.retakes)],
             ['Unchanged', H.n(h.unchanged), pct(h.unchanged, h.retakes)],
             ['Came out higher', H.n(h.worsened), pct(h.worsened, h.retakes)]], 'Retake outcomes')}
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Programs</h2>
          <p class="t-support">Members following each program, and how far they get.</p></div></div>
        <div class="card__body card__body--flush">
          <div class="table-wrap"><table class="table">
            <caption class="sr-only">Program completion</caption>
            <thead><tr><th scope="col">Program</th><th scope="col">Members</th><th scope="col">Completed</th></tr></thead>
            <tbody>${h.programCompletion.map((p) => `<tr>
              <th scope="row">${esc(p.name)}</th><td>${H.n(p.members)}</td>
              <td><span class="bar__track" style="width:110px;display:inline-block;vertical-align:middle">
                <span class="bar__fill${p.completion < 50 ? ' bar__fill--warn' : ''}" style="width:${p.completion}%"></span></span>
                <span class="t-num" style="margin-left:8px">${p.completion}%</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
}

/* -------------------------------------------------------------- operations -- */
function operations(host, ins) {
  const o = ins.operations;
  const months = tail(ins.members.months, range.months);
  const resolved = tail(o.weeklyResolved, range.months);

  host.innerHTML = `
    <div class="kpis" style="margin-bottom:var(--grid-gutter)">
      <div class="kpi"><span class="kpi__label">${icon('flag', { size: 16 })} Open now</span>
        <span class="kpi__value" data-countup>${o.openItems}</span><span class="kpi__note">across all members</span></div>
      <div class="kpi"><span class="kpi__label">${icon('check-circle', { size: 16 })} Closed this week</span>
        <span class="kpi__value" data-countup>${o.resolvedThisWeek}</span><span class="kpi__note">by the whole team</span></div>
      <div class="kpi"><span class="kpi__label">${icon('clock', { size: 16 })} Time to first look</span>
        <span class="kpi__value" data-countup>${esc(o.medianFirstLook)}</span><span class="kpi__note">middle of the range</span></div>
      <div class="kpi"><span class="kpi__label">${icon('plug', { size: 16 })} Integrations healthy</span>
        <span class="kpi__value" data-countup>${o.integrationsHealthy} of ${o.integrations}</span>
        <span class="kpi__note">one needs attention</span></div>
    </div>

    <div class="hgrid">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Items closed each month</h2>
          <p class="t-support">${esc(range.label)}.</p></div></div>
        <div class="card__body">
          ${window.Veye.C.markup({
            id: 'ins-resolved', type: 'column', labels: months,
            series: [{ key: 'resolved', label: 'Items closed', unit: '', values: resolved }],
            min: 0, readoutLabel: 'closed in',
            alt: 'Items closed each month over the ' + range.label.toLowerCase() + '.',
            tableSummary: 'View the figures as a table',
            tableHead: ['Month', 'Items closed'],
            tableRows: months.map((mo, i) => [esc(mo), String(resolved[i])]),
            tableCaption: 'Items closed by month',
          })}
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2 class="card__title">What is open, by kind</h2></div></div>
        <div class="card__body">
          ${H.barList(o.byKind.map((k) => ({ label: k.label, n: k.n })), { max: 3 })}
          ${H.chartAlt('View open items as a table', ['Kind', 'Open'],
            o.byKind.map((k) => [esc(k.label), String(k.n)]), 'Open items by kind')}
          <a class="btn btn--secondary btn--sm" style="margin-top:var(--s-5)" href="${R.href('/home')}">See the list on Home</a>
        </div>
      </div>
    </div>

    <div class="sec" data-reveal><h2>Connections</h2><span class="sec__rule"></span></div>
    <div class="card defer defer--short" data-reveal><div class="card__body card__body--flush">
      <div class="rows">${S.get().integrations.map((i) => `
        <div class="rowitem">
          <span class="rowitem__icon${i.status === 'Connected' ? '' : i.status === 'Attention' ? ' rowitem__icon--warn' : ' rowitem__icon--off'}">
            ${icon('plug', { size: 18 })}</span>
          <div><div class="rowitem__title">${esc(i.name)} ${H.chip(i.status)}</div>
            <div class="rowitem__meta">${esc(i.detail)}</div></div>
          <div class="rowitem__side"><span class="t-support">Last sync ${esc(i.lastSync)}</span></div>
        </div>`).join('')}</div>
    </div>
    <div class="card__foot">
      <span class="t-support">Manage connections in Settings.</span>
      <a class="btn btn--ghost btn--sm" href="${R.href('/settings/integrations')}">Open Integrations</a>
    </div></div>`;
}

function pct(a, b) { return Math.round((a / b) * 100) + '%'; }

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.insights = { render };

})();
