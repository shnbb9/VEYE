/* ============================================================================
   Finance — a Phase 2 concept, with illustrative figures
   ----------------------------------------------------------------------------
   Cara approved the layout on 25 Nov 2026: one sidebar item, two tabs, a
   placeholder for now. The real console shows the same screen with dashes,
   because nothing is billed and a dash means "not measured". This demo shows
   the concept filled in, under a label that cannot be dismissed. Every figure
   below is invented and belongs to no real person, plan or payment.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const H = window.Veye.H;
const esc = window.Veye.UI.esc;

const TABS = [{ key: 'revenue', label: 'Revenue', route: '/finance' }, { key: 'plans', label: 'Plans & Members', route: '/finance?tab=plans' }];
const PLANS = [
  { name: 'Digital', color: '#446514', share: 56.3, revenue: 232180, change: 6.9, members: 406, months: 9.4 },
  { name: 'Digital+', color: '#A9CB7C', share: 27.4, revenue: 113010, change: 13.1, members: 178, months: 7.1 },
  { name: 'Premium', color: '#F3D3B0', share: 16.3, revenue: 67390, change: 10.4, members: 88, months: 11.8 },
];
const SERIES = {
  Day: [['Mon', 1780], ['Tue', 1910], ['Wed', 1845], ['Thu', 2020], ['Fri', 1960], ['Sat', 1490], ['Sun', 1425]],
  Week: [['6 Oct', 11900], ['13 Oct', 12250], ['20 Oct', 12040], ['27 Oct', 12830], ['3 Nov', 13010], ['10 Nov', 13620]],
  Month: [['May', 231000], ['Jun', 275500], ['Jul', 291000], ['Aug', 312400], ['Sep', 338900], ['Oct', 379600], ['Nov', 412580]],
  Quarter: [['Q4 2025', 512000], ['Q1 2026', 588000], ['Q2 2026', 701500], ['Q3 2026', 942300]],
  Year: [['2024', 1180000], ['2025', 1905000], ['2026', 3021000]],
};
const MIX = [['May', 128, 64, 39], ['Jun', 154, 76, 45.5], ['Jul', 163, 80, 48], ['Aug', 176, 85.4, 51], ['Sep', 190.9, 93, 55], ['Oct', 213, 104.6, 62], ['Nov', 232.18, 113.01, 67.39]];
const EXCEPTIONS = [['alert-circle', 42, 'Failed payments', -11.8], ['refresh', 7, 'Refunds', -36.4], ['info', 18, 'Overdue invoices', -21.7]];
const ACTIVITY = [['14 Nov 2026', 'Robert Williams', 'Digital+', 89, 'Paid'], ['14 Nov 2026', 'Cara Morgan', 'Premium', 129, 'Paid'], ['13 Nov 2026', 'Daniel Kim', 'Digital', 59, 'Paid'],
  ['13 Nov 2026', 'Aisha Bello', 'Digital+', 89, 'Paid'], ['12 Nov 2026', 'Sophie Patel', 'Premium', 129, 'Refunded'], ['12 Nov 2026', 'Peter Novak', 'Digital', 59, 'Failed']];
const MOVEMENT = [['Digital → Digital+', 23], ['Digital+ → Premium', 9], ['Digital+ → Digital', 6], ['Premium → Digital+', 3], ['Cancelled', 14]];
const money = (v) => '$' + H.n(Math.round(v));
const signed = (v, unit = '%') => `<span class="chip ${v >= 0 ? 'chip--live' : ''} chip--sm">${v >= 0 ? '↑ +' : '↓ −'}${Math.abs(v)}${unit}</span>`;

let period = 'Month';

const kpi = (glyph, label, value, change, unit) => `<div class="kpi"><span class="kpi__label">${icon(glyph, { size: 16 })} ${label}</span>
  <span class="kpi__value">${value}</span><span class="kpi__note">${change === undefined ? '' : signed(change, unit) + ' on the period before'}</span></div>`;
const card = (title, desc, body, extra = '') => `<div class="card"><div class="card__head"><div><h2 class="card__title">${title}</h2><p class="t-support">${desc}</p></div>${extra}</div>${body}</div>`;

/* One line on a scale that starts at zero; every value is printed. */
function line(rows) {
  const W = 640, HH = 240, L = 62, Rr = 16, T = 26, B = 34;
  const top = Math.max(...rows.map((r) => r[1])) * 1.15;
  const x = (i) => L + 22 + (i * (W - L - Rr - 44)) / Math.max(1, rows.length - 1);
  const y = (v) => HH - B - (v / top) * (HH - T - B);
  const points = rows.map((r, i) => `${x(i).toFixed(1)},${y(r[1]).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${HH}" width="100%" role="img" aria-label="Illustrative revenue: ${esc(rows.map((r) => `${r[0]} ${money(r[1])}`).join(', '))}">
    ${[0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - Rr}" y1="${y(top * f / 1.15)}" y2="${y(top * f / 1.15)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(top * f / 1.15) + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">${money(top * f / 1.15)}</text>`).join('')}
    <polygon points="${x(0)},${y(0)} ${points} ${x(rows.length - 1)},${y(0)}" fill="#DCEBC8" opacity=".75"/>
    <polyline points="${points}" fill="none" stroke="#446514" stroke-width="2.4"/>
    ${rows.map((r, i) => `<circle cx="${x(i)}" cy="${y(r[1])}" r="4" fill="${i === rows.length - 1 ? '#446514' : '#fff'}" stroke="#446514" stroke-width="2"/>
      <text x="${x(i)}" y="${y(r[1]) - 10}" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--ink-heading)">${money(r[1])}</text>
      <text x="${x(i)}" y="${HH - 10}" text-anchor="middle" font-size="11" fill="var(--text-muted)">${esc(r[0])}</text>`).join('')}
  </svg>`;
}

function donut() {
  let at = 0;
  const rings = PLANS.map((p) => { const seg = `<circle r="54" cx="80" cy="80" fill="none" stroke="${p.color}" stroke-width="24" pathLength="100" stroke-dasharray="${p.share} ${100 - p.share}" stroke-dashoffset="${-at}" transform="rotate(-90 80 80)"/>`; at += p.share; return seg; }).join('');
  return `<div class="row gap-5 wrap" style="align-items:center">
    <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Illustrative share of revenue by plan">${rings}
      <text x="80" y="78" text-anchor="middle" font-size="16" font-weight="700" fill="var(--ink-heading)">$412,580</text><text x="80" y="95" text-anchor="middle" font-size="11" fill="var(--text-muted)">revenue</text></svg>
    <dl class="kv" style="flex:1 1 180px">${PLANS.map((p) => `<dt><span class="finance-key" style="background:${p.color}"></span>${p.name}</dt><dd>${p.share}% (${money(p.revenue)})</dd>`).join('')}</dl></div>`;
}

function stacked() {
  const top = Math.max(...MIX.map((m) => m[1] + m[2] + m[3]));
  return `<ul class="finance-stack" aria-label="Illustrative monthly revenue by plan, in thousands of dollars">${MIX.map((m) => `<li>
    <span class="finance-stack__n">$${Math.round(m[1] + m[2] + m[3])}K</span>
    <span class="finance-stack__bar" style="height:${((m[1] + m[2] + m[3]) / top) * 100}%" aria-hidden="true">${[3, 2, 1].map((i) => `<i style="flex:${m[i]} 0 0;background:${PLANS[i - 1].color}"></i>`).join('')}</span>
    <span class="finance-stack__l">${m[0]}</span></li>`).join('')}</ul>
    <p class="t-support row gap-4 wrap">${PLANS.map((p) => `<span><span class="finance-key" style="background:${p.color}"></span>${p.name}</span>`).join('')}</p>`;
}

const bars = (rows, max, text) => `<div class="bars bars--wide">${rows.map(([label, value]) => `<div class="bar"><span class="bar__label">${esc(label)}</span>
  <span class="bar__track"><span class="bar__fill bar__fill--deep" style="width:${Math.max(3, (value / max) * 100)}%"></span></span><span class="bar__n">${text(value)}</span></div>`).join('')}</div>`;

function revenue() {
  return `<div data-testid="finance-revenue">
    <div class="kpis kpis--quad" style="margin-top:var(--s-5)">
      ${kpi('bar-chart', 'Total revenue', '$412,580', 8.7)}${kpi('activity', 'New revenue this month', '$56,240', 12.4)}
      ${kpi('users', 'Avg. revenue per paid member', '$84.40', 4.6)}${kpi('check-circle', 'Paid invoices rate', '98.6%', 1.1, ' pp')}
    </div>
    <div class="grid grid--2" style="margin-top:var(--s-5)">
      ${card('Revenue by plan tier', 'Share of total revenue (last 3 months)', `<div class="card__body">${donut()}</div>`)}
      ${card('Revenue over time', `Total revenue by ${period.toLowerCase()}`, `<div class="card__body">${line(SERIES[period])}</div>`,
        `<div class="modeswitch" role="tablist" aria-label="Period">${Object.keys(SERIES).map((p) => `<button class="modeswitch__btn" type="button" role="tab" aria-selected="${p === period}" data-period="${p}">${p}</button>`).join('')}</div>`)}
      ${card('Monthly revenue by plan', 'Revenue over time, by plan tier', `<div class="card__body">${stacked()}</div>`)}
      ${card('Period-over-period revenue change', 'Compared with the period before (most recent month)', `<div class="card__body">${bars([['Total revenue', 8.7], ...PLANS.map((p) => [p.name, p.change])], 14, (v) => `+${v}%`)}</div>`)}
      ${card('Billing exceptions', 'Items that may need attention (current month)', `<div class="card__body"><dl class="kv finance-exceptions" style="grid-template-columns:auto 1fr">${EXCEPTIONS.map(([g, n, l, c]) => `<dt>${icon(g, { size: 16 })} ${l}</dt><dd><b>${n}</b> ${signed(c)}</dd>`).join('')}</dl></div>`)}
      ${card('Recent billing activity', 'The latest payments and changes', `<div class="table-wrap"><table class="table table--compact"><thead><tr><th scope="col">Date</th><th scope="col">Member</th><th scope="col">Plan</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead>
        <tbody>${ACTIVITY.map((a) => `<tr><td class="t-nowrap">${a[0]}</td><td>${esc(a[1])}</td><td>${a[2]}</td><td>$${a[3].toFixed(2)}</td><td>${H.chip(a[4], a[4] === 'Paid' ? 'live' : a[4] === 'Failed' ? 'error' : 'attention')}</td></tr>`).join('')}</tbody></table></div>`)}
    </div>
  </div>`;
}

function plans() {
  return `<div data-testid="finance-plans">
    <div class="kpis kpis--quad" style="margin-top:var(--s-5)">
      ${kpi('users', 'Active paid members', '672', 5.2)}${PLANS.map((p) => kpi('heart', p.name, String(p.members), p.change)).join('')}
    </div>
    <div class="grid grid--2" style="margin-top:var(--s-5)">
      ${card('Plan distribution', 'Active paid members by plan', `<div class="card__body">${bars(PLANS.map((p) => [p.name, p.members]), 406, (v) => `${v} · ${Math.round((v / 672) * 100)}%`)}</div>`)}
      ${card('Plan movement', 'Members who moved between plans this month', `<div class="card__body">${bars(MOVEMENT, 23, (v) => String(v))}</div>`)}
      ${card('Typical time in a plan', 'Half of the members stay at least this long', `<div class="card__body">${bars(PLANS.map((p) => [p.name, p.months]), 12, (v) => `${v} months`)}</div>`)}
      ${card('Members by plan', 'Each paid member and their current plan', `<div class="table-wrap"><table class="table table--compact"><thead><tr><th scope="col">Member</th><th scope="col">Plan</th><th scope="col">Since</th><th scope="col">Next payment</th></tr></thead>
        <tbody>${[['Cara Morgan', 'Premium', '4 Jun 2026', '4 Dec 2026'], ['Robert Williams', 'Digital+', '18 Mar 2026', '18 Dec 2026'], ['Aisha Bello', 'Digital+', '12 Jul 2026', '12 Dec 2026'], ['Daniel Kim', 'Digital', '11 Jul 2026', '11 Dec 2026'], ['Peter Novak', 'Digital', '24 Sep 2025', '24 Dec 2026']]
          .map((r) => `<tr>${r.map((c, i) => (i ? `<td class="t-nowrap">${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody></table></div>`)}
    </div>
  </div>`;
}

function render(outlet, route) {
  const tab = route.query.tab === 'plans' ? 'plans' : 'revenue';
  outlet.innerHTML = `<div class="page">
    ${H.pageHead({ title: 'Finance', desc: 'A future home for subscriptions, revenue and plan movement.', crumbs: [{ label: 'Home', route: '/home' }, { label: 'Finance' }],
      actions: '<span class="chip chip--attention" data-testid="finance-phase">Planned for Phase 2</span>' })}
    ${H.subnav(TABS, tab)}
    <div class="notice finance-illustrative" data-testid="finance-illustrative">${icon('info', { size: 18 })}<div><b>Illustrative data.</b> Every price, payment, plan and name on this screen is invented to show the layout. Nobody pays for Veye today and nothing is connected.</div></div>
    ${tab === 'revenue' ? revenue() : plans()}
  </div>`;
  outlet.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { period = b.dataset.period; render(outlet, route); outlet.querySelector(`[data-period="${period}"]`).focus(); }));
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.finance = { render: (outlet, route) => { period = 'Month'; render(outlet, route); } };

})();
