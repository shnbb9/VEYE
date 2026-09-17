/* ============================================================================
   Member 360
   ----------------------------------------------------------------------------
   Five areas: Overview, Storyline, Assessments, Nutrition & Plans, Messages.

   Consent and legal acceptance appear as plain member information, not as a
   governance console. Health figures are shown exactly as the member's records
   hold them — nothing is recomputed, and no screen converts between scales.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const TABS = [
  { key: 'overview',   label: 'Overview' },
  { key: 'storyline',  label: 'Storyline' },
  { key: 'assessments', label: 'Assessments' },
  { key: 'nutrition',  label: 'Nutrition & Plans' },
  { key: 'messages',   label: 'Messages' },
];

function render(outlet, route) {
  const id = route.params.id;
  const tab = route.params.tab || 'overview';
  const m = S.member(id);

  if (!m) {
    outlet.innerHTML = `<div class="page">
      ${H.pageHead({ title: 'That member was not found',
        crumbs: [{ label: 'Home', route: '/home' }, { label: 'Members', route: '/members' }, { label: 'Not found' }],
        desc: `No member in the directory has the id <code>${esc(id)}</code>. They may have been removed, or the link may be out of date.` })}
      <div class="card"><div class="card__body">${H.emptyState({
        icon: 'users', title: 'Try the directory',
        msg: 'The directory has a search across names, email addresses and member ids.',
        action: `<a class="btn btn--primary" href="${R.href('/members')}">Go to the member directory</a>`,
      })}</div></div></div>`;
    return;
  }

  if (!TABS.some((t) => t.key === tab)) {
    outlet.innerHTML = `<div class="page">
      ${H.pageHead({ title: esc(m.name),
        crumbs: [{ label: 'Home', route: '/home' }, { label: 'Members', route: '/members' }, { label: m.name }],
        desc: `This member record has no section called <code>${esc(tab)}</code>.` })}
      <div class="card"><div class="card__body">${H.emptyState({
        icon: 'compass', title: 'Pick one of the five sections',
        msg: 'Overview, Storyline, Assessments, Nutrition &amp; Plans and Messages.',
        action: `<a class="btn btn--primary" href="${R.href('/members/' + id + '/overview')}">Open the overview</a>`,
      })}</div></div></div>`;
    return;
  }

  const d = S.detail(id) || {};
  const tone = H.hnTone(m.hn);
  const pct = m.hn == null ? 0 : Math.max(4, Math.min(100, (1 - m.hn / 10) * 100));
  const toneColor = { ok: 'var(--status-positive)', warn: 'var(--status-attention)', risk: 'var(--status-significant)', neutral: 'var(--line-strong)' }[tone];

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: m.name,
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Members', route: '/members' }, { label: m.name }],
      where: 'members',
    })}

    <section class="m360">
      <div class="m360__who">
        <div class="row gap-4" style="align-items:center">
          <span class="avatar avatar--lg">${esc(m.initials)}</span>
          <div style="min-width:0">
            <div class="m360__id">${esc(m.id)} · joined ${esc(m.joined)} · ${esc(m.city)}</div>
            <div class="row gap-2 wrap" style="margin-top:6px">
              ${H.chip(m.status)}
              <span class="tag">${esc(m.subscription)}</span>
              ${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
            </div>
          </div>
        </div>
        <!-- Contact and account facts are reference, not the answer to "what is
             happening with this member". They open on demand. -->
        <details class="disclose" style="margin-top:var(--s-5)">
          <summary>${icon('chevron-right', { size: 15 })} Member details</summary>
          <dl class="facts" style="margin-top:var(--s-4)">
            <div class="fact"><dt>Email</dt><dd>${esc(m.email)}</dd></div>
            <div class="fact"><dt>Phone</dt><dd>${esc(m.phone)}</dd></div>
            <div class="fact"><dt>Date of birth</dt><dd>${esc(m.dob)}</dd></div>
            <div class="fact"><dt>Last active</dt><dd>${esc(m.lastActive)}</dd></div>
            <div class="fact"><dt>Plan</dt><dd>${esc(m.subscription)}</dd></div>
            <div class="fact"><dt>Legal documents accepted</dt><dd>${esc(m.consent)}</dd></div>
          </dl>
          ${m.consent !== 'Current' ? `<div class="notice notice--warn" style="margin-top:var(--s-4)">
            ${icon('alert-circle', { size: 18 })}
            <div>This member has not accepted the newest version of one or more documents. They are asked at their next sign-in.</div>
          </div>` : ''}
          <p class="qualify">${icon('info', { size: 14 })} Document versions and acceptance counts are managed in Content → Legal Documents.</p>
        </details>
      </div>
      <div class="m360__hn">
        <div class="arc">
          <div class="arc__dial" data-ring style="--pct:${pct.toFixed(0)};--tone:${toneColor}">
            <div class="arc__inner">
              <div class="arc__val">${m.hn == null ? '—' : m.hn.toFixed(1)}</div>
              <div class="arc__scale">of 10</div>
            </div>
          </div>
          <div style="min-width:0">
            <div class="t-eyebrow">Health Number</div>
            <div class="t-strong" style="margin-top:2px">${esc(m.hnBand)}</div>
            <p class="t-support" style="margin-top:4px">${esc(H.hnTrendWords(m.hnTrend))}</p>
            <p class="t-support">Taken ${esc(m.hnTaken)}</p>
          </div>
        </div>
        <!-- The two actions a coach reaches for stay visible. Everything else is
             one menu away, so the header does not read as a toolbar. -->
        <div class="m360__actions" style="margin-top:var(--s-6)">
          <button class="btn btn--primary btn--sm" id="msgBtn">${icon('send', { size: 16 })} Message</button>
          <button class="btn btn--secondary btn--sm" id="planBtn">${icon('calendar-check', { size: 16 })} Assign a plan</button>
          <div class="menu-wrap">
            <button class="btn btn--ghost btn--sm" id="moreBtn" aria-label="More actions for ${esc(m.name)}">
              ${icon('more-horizontal', { size: 16 })} More</button>
          </div>
        </div>
      </div>
    </section>

    ${H.subnav(TABS.map((t) => ({ ...t, route: '/members/' + id + '/' + t.key })), tab)}

    <div id="tabBody"></div>
  </div>`;

  const body = outlet.querySelector('#tabBody');
  ({ overview, storyline, assessments, nutrition, messages })[tab](body, m, d);

  wireActions(outlet, m);
}

/* --------------------------------------------------------------- overview -- */
function overview(host, m, d) {
  const st = S.get();
  const prog = st.programs.find((p) => p.name === m.program);
  const moods = (d.mood || []).slice(-14);
  const items = st.attention.filter((a) => a.memberId === m.id);

  host.innerHTML = `
    ${items.length ? `<div class="notice notice--warn" style="margin-bottom:var(--s-5)">
      ${icon('alert-triangle', { size: 18 })}
      <div><b>${items.length} thing${items.length === 1 ? '' : 's'} waiting on this member</b><br>
      ${items.map((i) => esc(i.title)).join(' · ')}</div>
    </div>` : ''}

    <!-- The first thing below the member header on every viewport. One reveal
         for the whole block: the rows and cards inside it move with it. -->
    <div class="hgrid" data-reveal>
      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Where they are</h2></div></div>
          <div class="card__body">
            <div class="minirow">
              <div class="mini"><span class="mini__n">${esc(m.onboarding)}</span><span class="mini__l">Onboarding</span></div>
              <div class="mini"><span class="mini__n">${m.program ? esc(m.program) : 'None'}</span><span class="mini__l">Program</span></div>
              <div class="mini"><span class="mini__n">${m.adherence == null ? '—' : m.adherence + '%'}</span><span class="mini__l">Plan adherence</span></div>
              <div class="mini"><span class="mini__n">${esc(m.subscription)}</span><span class="mini__l">Subscription</span></div>
            </div>
            ${prog ? `<div style="margin-top:var(--s-6)">
              <div class="row-between"><span class="t-support">${esc(prog.name)} · ${prog.weeks} weeks</span>
                <a class="btn btn--ghost btn--sm" href="${R.href('/care/program/' + prog.id)}">Open the program</a></div>
              <div class="weeks" style="margin-top:var(--s-3)">
                ${Array.from({ length: prog.weeks }, (_, i) => {
                  const done = Math.round((m.adherence || 0) / 100 * prog.weeks);
                  return `<i class="${i < done ? '' : i === done ? 'low' : 'miss'}" style="height:${i < done ? 100 : i === done ? 60 : 22}%"></i>`;
                }).join('')}
              </div>
              <p class="qualify">${icon('info', { size: 14 })} The weekly strip is modelled from the recorded adherence figure, not from week-by-week data.</p>
            </div>` : `<p class="t-support" style="margin-top:var(--s-5)">No program is assigned yet.</p>`}
          </div>
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Health Number over time</h2>
            <p class="t-support">A lower number is better on this scale.</p></div></div>
          <div class="card__body" id="hnChart"></div>
        </div>
      </div>

      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Recent activity</h2>
            <p class="t-support">The last few things this member did.</p></div>
            <a class="btn btn--ghost btn--sm" href="${R.href('/members/' + m.id + '/storyline')}">Full storyline</a></div>
          <div class="card__body card__body--flush">
            ${(d.storyline || []).length ? `<div class="rows">${(d.storyline || []).slice(0, 4).map((e) => `
              <div class="rowitem" style="grid-template-columns:36px minmax(0,1fr);padding:14px 20px">
                <span class="rowitem__icon" style="width:32px;height:32px">${icon(STORY_ICON[e.kind] || 'note', { size: 16 })}</span>
                <div><div class="rowitem__title" style="font-weight:500;font-size:var(--fs-support)">${esc(e.text)}</div>
                  <div class="rowitem__meta">${esc(e.at)}</div></div>
              </div>`).join('')}</div>`
            : `<div class="card__body"><p class="t-support">Nothing recorded yet.</p></div>`}
          </div>
        </div>
      </div>
    </div>`;

  /* The Health Number trend uses the shared interactive chart layer. */
  const chartHost = host.querySelector('#hnChart');
  const hist = [...(d.hnHistory || [])].reverse();
  chartHost.innerHTML = hist.length > 1
    ? window.Veye.C.markup({
        id: 'hn-' + m.id, type: 'line', height: 170,
        labels: hist.map((h) => h.date),
        series: [{ key: 'hn', label: 'Health Number', unit: '', values: hist.map((h) => h.score) }],
        min: 0, max: 10,
        readoutLabel: 'taken',
        alt: 'Health Number over time for this member. Lower is better.',
        tableSummary: 'View the results as a table',
        tableHead: ['Taken', 'Health Number', 'Band'],
        tableRows: hist.map((h) => { const b = S.hnBand(h.score);
          return [esc(h.date), h.score.toFixed(1), esc(b ? b.label : '—')]; }),
        tableCaption: 'Health Number history',
      })
    : H.emptyState({ icon: 'gauge', title: 'Not enough results to draw a trend',
        msg: 'A trend appears once this member has taken the assessment twice.' });
  window.Veye.M.scan(chartHost);
}

const STORY_ICON = { health: 'droplet', assessment: 'clipboard', care: 'calendar-check',
                     companion: 'sprout', life: 'smile', account: 'user-check' };

/* -------------------------------------------------------------- storyline -- */
function storyline(host, m, d) {
  const KINDS = [
    { key: 'health', label: 'Health' }, { key: 'assessment', label: 'Assessments' },
    { key: 'care', label: 'Care' }, { key: 'companion', label: 'Companion' },
    { key: 'life', label: 'Daily' }, { key: 'account', label: 'Account' },
  ];
  const notes = S.get().memberNotes.filter((x) => x.memberId === m.id)
    .map((x) => ({ at: x.at, kind: 'care', text: 'Note from ' + x.who + ': ' + x.text }));
  const all = notes.concat(d.storyline || []);
  const on = new Set(KINDS.map((k) => k.key));

  const moods = (d.mood || []).slice(-28);
  const low = moods.filter((v) => v <= 2).length;

  host.innerHTML = `
    <!-- Mood lives here in v2. It is a record of what this member did day by day,
         which is what a storyline is; on Overview it competed with the question
         "what needs attention". -->
    ${moods.length ? `<div class="card" style="margin-bottom:var(--grid-gutter)">
      <div class="card__head">
        <div><h2 class="card__title">Mood, last ${moods.length} days</h2>
          <p class="t-support">Average ${(moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(1)} out of 5.
            ${low} low day${low === 1 ? '' : 's'}.</p></div>
      </div>
      <div class="card__body">
        <!-- Icon plus colour plus a word in the title, so the meaning does not
             depend on an emoji font or on colour alone. -->
        <div class="moodrow">
          ${moods.map((v, i) => `<span class="moodday moodday--${v}"
            title="Day ${i + 1}: ${esc(H.MOOD[v].word)}">${icon(H.MOOD[v].icon, { size: 13 })}
            <span class="sr-only">Day ${i + 1}: ${esc(H.MOOD[v].word)}</span></span>`).join('')}
        </div>
        <div class="moodkey">
          ${[5, 4, 3, 2, 1].map((v) => `<span class="moodkey__item">
            <span class="moodday moodday--${v}" aria-hidden="true">${icon(H.MOOD[v].icon, { size: 12 })}</span>
            ${esc(H.MOOD[v].word)}</span>`).join('')}
        </div>
        ${H.chartAlt('View mood entries as a table', ['Day', 'Rating out of 5', 'Meaning'],
          moods.map((v, i) => ['Day ' + (i + 1), String(v), esc(H.MOOD[v].word)]), 'Mood entries')}
      </div>
    </div>` : ''}

    <div class="card">
      <div class="card__head">
        <div><h2 class="card__title">Everything, newest first</h2>
          <p class="t-support">Assessments, health entries, care activity, Companion conversations and account changes in one line.</p></div>
        <div class="sl-legend" id="slLegend">
          ${KINDS.map((k) => `<button class="sl-legend__btn" aria-pressed="true" data-kind="${k.key}">
            <span class="sl-legend__swatch"></span>${esc(k.label)}</button>`).join('')}
        </div>
      </div>
      <div class="card__body">
        <div class="storyline" id="slBody"><span class="storyline__axis"></span></div>
      </div>
    </div>`;

  const bodyEl = host.querySelector('#slBody');
  const mark = { health: 'health', assessment: 'health', care: 'care', companion: 'care', life: 'life', account: 'admin' };
  const ic = { health: 'droplet', assessment: 'clipboard', care: 'calendar-check', companion: 'sprout', life: 'smile', account: 'user-check' };

  function paint() {
    const rows = all.filter((e) => on.has(e.kind));
    bodyEl.innerHTML = `<span class="storyline__axis"></span>` + (rows.length
      ? rows.map((e) => `<div class="sl-item">
          <div class="sl-item__when">${esc(e.at)}</div>
          <div class="sl-item__mark sl-item__mark--${mark[e.kind] || 'admin'}">${icon(ic[e.kind] || 'note', { size: 16 })}</div>
          <div class="sl-item__body">
            <div class="sl-item__title">${esc(KINDS.find((k) => k.key === e.kind) ? KINDS.find((k) => k.key === e.kind).label : e.kind)}</div>
            <div class="sl-item__text">${esc(e.text)}</div>
          </div>
        </div>`).join('')
      : `<div style="padding:var(--s-6) 0 0 132px">${H.emptyState({
          icon: 'filter', title: 'Nothing matches those filters',
          msg: 'Turn one of the categories above back on.' })}</div>`);
  }
  paint();

  host.querySelectorAll('#slLegend button').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.kind;
      const now = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', String(!now));
      if (now) on.delete(k); else on.add(k);
      paint();
    });
  });
}

/* ------------------------------------------------------------ assessments -- */
function assessments(host, m, d) {
  const b = (d.biomarkers || [])[0];
  const rs = b && Array.isArray(b.ratioResults) ? b.ratioResults : [];

  host.innerHTML = `
    <div class="hgrid" data-reveal>
      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Blood markers</h2>
            <p class="t-support">${b ? 'Most recent submission, ' + esc(b.date) + '.' : 'None submitted yet.'}</p></div>
            ${b ? `<a class="btn btn--ghost btn--sm" href="${R.href('/assessments/markers')}">Marker definitions</a>` : ''}
          </div>
          <div class="card__body${b ? ' card__body--flush' : ''}">
            ${b ? `<div class="table-wrap"><table class="table table--compact">
              <caption class="sr-only">Blood markers submitted ${esc(b.date)}</caption>
              <thead><tr><th scope="col">Marker</th><th scope="col">Value</th><th scope="col">Unit</th></tr></thead>
              <tbody>
                <tr><th scope="row">Total cholesterol</th><td>${b.tc}</td><td>mg/dL</td></tr>
                <tr><th scope="row">HDL</th><td>${b.hdl}</td><td>mg/dL</td></tr>
                <tr><th scope="row">Triglycerides</th><td>${b.tg}</td><td>mg/dL</td></tr>
                <tr><th scope="row">Fasting glucose</th><td>${b.glucose}</td><td>mg/dL</td></tr>
                <tr><th scope="row">Fasting insulin</th><td>${b.insulin}</td><td>µIU/mL</td></tr>
                <tr><th scope="row">Arachidonic acid</th><td>${b.aa}</td><td>%</td></tr>
                <tr><th scope="row">EPA</th><td>${b.epa}</td><td>%</td></tr>
                <tr><th scope="row">HbA1c</th><td>${b.hba1c}</td><td>%</td></tr>
              </tbody></table></div>`
            : H.emptyState({ icon: 'droplet', title: 'No blood markers yet',
                msg: 'Markers appear here once the member submits them or a laboratory import brings them in.' })}
          </div>
        </div>

        ${b ? `<div class="card">
          <div class="card__head"><div><h2 class="card__title">Recorded ratio results</h2>
            <p class="t-support">Results saved with this marker submission. This console does not recalculate them.</p></div></div>
          <div class="card__body card__body--flush">
            ${rs.length ? `<div class="table-wrap"><table class="table table--compact">
              <caption class="sr-only">Recorded ratio results and goals</caption>
              <thead><tr><th scope="col">Ratio</th><th scope="col">Result</th><th scope="col">Goal</th>
                <th scope="col">Against goal</th></tr></thead>
              <tbody>${rs.map((r) => `<tr>
                <th scope="row">${esc(r.name)}</th>
                <td class="t-num">${r.value == null ? '—' : r.value}</td>
                <td>${esc(r.goal)}</td>
                <td>${r.status === 'Inside goal' ? `<span class="chip chip--live">${icon('check', { size: 13 })} Inside goal</span>`
                           : `<span class="chip chip--attention">${icon('alert-circle', { size: 13 })} Outside goal</span>`}</td>
              </tr>`).join('')}</tbody>
            </table></div>` : `<p class="t-support">No stored calculated results were supplied with this marker submission.</p>`}
          </div>
          <div class="card__foot">
            <span class="t-support">Supplement amounts are chosen by condition, never from how many results sit outside their goal.</span>
          </div>
        </div>` : ''}
      </div>

      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Health Number</h2></div>
            <a class="btn btn--ghost btn--sm" href="${R.href('/assessments/health-number')}">Definition</a></div>
          <div class="card__body">
            ${(d.hnHistory || []).length ? `<div class="table-wrap"><table class="table table--compact">
              <caption class="sr-only">Health Number results</caption>
              <thead><tr><th scope="col">Taken</th><th scope="col">Result</th><th scope="col">Band</th></tr></thead>
              <tbody>${d.hnHistory.map((h) => {
                const band = S.hnBand(h.score);
                return `<tr><th scope="row">${esc(h.date)}</th><td class="t-num">${h.score.toFixed(1)}</td>
                  <td>${esc(band ? band.label : '—')}</td></tr>`;
              }).join('')}</tbody></table></div>`
            : `<p class="t-support">Not completed yet.</p>`}
          </div>
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Simple Health Quiz</h2>
            <p class="t-support">A count of Yes and No answers. Fewer Yes answers over time indicates improvement.</p></div></div>
          <div class="card__body">
            ${(d.quiz || []).length ? `<div class="table-wrap"><table class="table table--compact">
              <caption class="sr-only">Simple Health Quiz results</caption>
              <thead><tr><th scope="col">Taken</th><th scope="col">Result</th></tr></thead>
              <tbody>${d.quiz.map((q) => `<tr><th scope="row">${esc(q.date)}</th>
                <td>${q.no} No / ${q.yes} Yes</td></tr>`).join('')}</tbody></table></div>
              <p class="qualify">${icon('info', { size: 14 })} This quiz produces no score, no status tier and no supplement amount, and it never changes a Health Number.</p>`
            : `<p class="t-support">Not taken yet.</p>`}
          </div>
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Health Assessment</h2></div></div>
          <div class="card__body">
            ${(d.hsr || []).length ? `<div class="table-wrap"><table class="table table--compact">
              <caption class="sr-only">Health Assessment results</caption>
              <thead><tr><th scope="col">Taken</th><th scope="col">Total</th><th scope="col">Band</th></tr></thead>
              <tbody>${d.hsr.map((r) => {
                const band = S.get().statusReport.bands.find((x) => r.total >= x.from && r.total <= x.to);
                return `<tr><th scope="row">${esc(r.date)}</th><td class="t-num">${r.total} of 33</td>
                  <td>${esc(band ? band.label : '—')}</td></tr>`;
              }).join('')}</tbody></table></div>`
            : `<p class="t-support">Not taken yet.</p>`}
          </div>
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">BMI and body composition</h2></div></div>
          <div class="card__body">
            ${d.body ? `<dl class="facts">
                <div class="fact"><dt>Body fat</dt><dd>${d.body.bodyFat}%</dd></div>
                <div class="fact"><dt>BMI</dt><dd>${d.body.bmi}</dd></div>
                <div class="fact"><dt>Measured</dt><dd>${esc(d.body.date)}</dd></div>
                <div class="fact"><dt>Table used</dt><dd>${esc(d.body.sex)}</dd></div>
              </dl>
              <p class="qualify">${icon('info', { size: 14 })} Body fat comes from the supplied lookup table for this sex. BMI is reported separately and is not part of that table.</p>`
            : `<p class="t-support">No measurements recorded.</p>`}
          </div>
        </div>
      </div>
    </div>`;
}

/* --------------------------------------------------------------- nutrition -- */
function nutrition(host, m) {
  const st = S.get();
  const prog = st.programs.find((p) => p.name === m.program);
  const steps = prog ? st.programSteps.filter((s) => s.programId === prog.id) : [];
  const seed = m.id.charCodeAt(m.id.length - 1);
  /* A stand-in for what this member ticked on Food Choices. Taken from the real
     catalogue so the four portals below are the member's own four, and thinned
     deterministically per member so two records do not look identical. */
  const portals = st.foodPortals || [];
  const picked = (portalKey) => st.foods
    .filter((f) => f.portal === portalKey)
    .filter((_, i) => (i + seed) % 4 === 0)
    .slice(0, 6);
  const diary = [
    { date: '13 Aug 2026', meal: 'Breakfast', food: 'Greek yoghurt, walnuts', source: 'Member' },
    { date: '13 Aug 2026', meal: 'Lunch', food: 'Wild salmon, broccoli, olive oil', source: 'Member' },
    { date: '13 Aug 2026', meal: 'Dinner', food: 'Chicken thigh, sweet potato, spinach', source: 'Member' },
    { date: '12 Aug 2026', meal: 'Breakfast', food: 'Pasture eggs, avocado', source: 'Member' },
    { date: '12 Aug 2026', meal: 'Snack', food: 'Almond butter', source: 'Companion suggestion, accepted' },
  ];

  host.innerHTML = `
    <div class="hgrid" data-reveal>
      <div class="stack gap-5">
        <div class="card">
          <div class="card__head">
            <div><h2 class="card__title">Current plan</h2>
              <p class="t-support">${prog ? esc(prog.name) + ' · ' + prog.weeks + ' weeks · ' + esc(prog.version) : 'No plan assigned.'}</p></div>
            <button class="btn btn--secondary btn--sm" id="assignHere">${prog ? 'Change plan' : 'Assign a plan'}</button>
          </div>
          <div class="card__body${steps.length ? ' card__body--flush' : ''}">
            ${steps.length ? `<div class="steps">${steps.slice(0, 8).map((s) => `
              <div class="step">
                <span class="step__day">W${s.week}</span>
                <div><div class="step__name">${esc(s.title)}</div><div class="step__note">${esc(s.type)} · ${esc(s.timing)} · ${esc(s.detail)}</div></div>
                <span class="tag">${esc(s.timing)}</span>
              </div>`).join('')}</div>`
            : H.emptyState({ icon: 'calendar-check', title: 'No plan yet',
                msg: 'Assign a program and its steps appear here.' })}
          </div>
          ${steps.length > 8 ? `<div class="card__foot"><span class="t-support">Showing 8 of ${steps.length} steps.</span>
            <a class="btn btn--ghost btn--sm" href="${R.href('/care/program/' + prog.id)}">Open the full program</a></div>` : ''}
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Food diary</h2>
            <p class="t-support">The most recent entries. Members can correct their own rows.</p></div>
            <button class="btn btn--ghost btn--sm" id="diaryExport">${icon('download', { size: 16 })} Export</button></div>
          <div class="card__body card__body--flush">
            <div class="table-wrap"><table class="table table--compact">
              <caption class="sr-only">Recent food diary entries</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Meal</th><th scope="col">What was eaten</th>
                <th scope="col" data-col-priority="low">Source</th></tr></thead>
              <tbody>${diary.map((r) => `<tr><th scope="row">${esc(r.date)}</th><td>${esc(r.meal)}</td>
                <td>${esc(r.food)}</td><td data-col-priority="low" class="t-support">${esc(r.source)}</td></tr>`).join('')}</tbody>
            </table></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Food choices</h2>
          <p class="t-support">What this member picked in the four portals on their dashboard.</p></div>
          <a class="btn btn--ghost btn--sm" href="${R.href('/care/library/catalogue')}">Catalogue</a></div>
        <div class="card__body">
          ${portals.map((p) => {
            const list = picked(p.key);
            return `<div style="margin-bottom:var(--s-5)">
              <div class="t-eyebrow">${esc(p.label)}</div>
              <div class="row gap-2 wrap" style="margin-top:6px">
                ${list.length ? list.map((f) => `<span class="tag">${esc(f.name)}</span>`).join('')
                  : '<span class="t-support">Nothing chosen in this portal yet.</span>'}
              </div></div>`;
          }).join('')}
          <p class="qualify">${icon('info', { size: 14 })} The portals and the groups inside them are the
            member product's own. They are administered in Care Studio → Food Library.</p>
        </div>
      </div>
    </div>`;

  host.querySelector('#assignHere').addEventListener('click', () => assignPlan(m));
  host.querySelector('#diaryExport').addEventListener('click', () => {
    UI.toast({ title: 'Diary export prepared', message: '5 entries for ' + m.name + '. In the real console the file downloads here.' });
  });
}

/* --------------------------------------------------------------- messages -- */
function messages(host, m) {
  const t = S.thread(m.id);

  host.innerHTML = `
    <div class="card" style="max-width:820px">
      <div class="card__head"><div><h2 class="card__title">Messages with ${esc(m.name)}</h2>
        <p class="t-support">${t ? 'Last message ' + esc(t.last) : 'No messages yet.'}</p></div></div>
      <div class="card__body">
        ${t ? `<div class="convo" style="padding:0">
          ${[...t.messages].reverse().map((x) => `
            <div class="msg msg--${x.who === 'member' ? 'member' : 'companion'}">
              <div class="msg__meta">${x.who === 'member' ? esc(m.name) : esc(x.from || 'Veye team')} · ${esc(x.at)}</div>
              <div class="msg__bubble">${esc(x.text)}</div>
            </div>`).join('')}
        </div>` : H.emptyState({ icon: 'messages', title: 'No messages yet',
            msg: 'Anything you send appears here and in the member’s dashboard.' })}
      </div>
      <div class="card__foot" style="display:block">
        <form id="replyForm">
          <div class="field">
            <label for="reply">Reply to ${esc(m.name)}</label>
            <textarea class="textarea" id="reply" rows="3" placeholder="Write a reply…"></textarea>
            <p class="field__error" id="reply-err" hidden></p>
          </div>
          <div class="row gap-3" style="margin-top:var(--s-3);justify-content:flex-end">
            <button type="button" class="btn btn--secondary" id="templateBtn">Use a template</button>
            <button type="submit" class="btn btn--primary" id="sendBtn">${icon('send', { size: 16 })} Send</button>
          </div>
        </form>
      </div>
    </div>`;

  const form = host.querySelector('#replyForm');
  const ta = host.querySelector('#reply');

  host.querySelector('#templateBtn').addEventListener('click', () => {
    UI.modal({
      title: 'Message templates',
      body: `<div class="rows">${[
        ['Check in after an assessment', 'I had a look at your latest results. Nothing to worry about — shall we go through it on Friday?'],
        ['Nudge a stalled plan', 'Your plan is ready whenever you are. The first day takes about ten minutes to build.'],
        ['Answer a supplement question', 'Amounts depend on your situation, so let us go through it together rather than me guessing here.'],
      ].map(([name, text], i) => `<div class="rowitem">
          <span class="rowitem__icon">${icon('file-text', { size: 18 })}</span>
          <div><div class="rowitem__title">${esc(name)}</div><div class="rowitem__meta">${esc(text)}</div></div>
          <div class="rowitem__side"><button class="btn btn--secondary btn--sm" data-tpl="${i}">Use</button></div>
        </div>`).join('')}</div>`,
      actions: [{ label: 'Close', variant: 'secondary', value: 'close' }],
      onClose: () => {},
    }).el.querySelectorAll('[data-tpl]').forEach((b, i, all) => {
      b.addEventListener('click', () => {
        ta.value = [
          'I had a look at your latest results. Nothing to worry about — shall we go through it on Friday?',
          'Your plan is ready whenever you are. The first day takes about ten minutes to build.',
          'Amounts depend on your situation, so let us go through it together rather than me guessing here.',
        ][+b.dataset.tpl];
        b.closest('.modal-scrim').remove();
        document.body.style.overflow = '';
        ta.focus();
      });
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    const err = host.querySelector('#reply-err');
    if (!text) {
      ta.setAttribute('aria-invalid', 'true');
      err.innerHTML = icon('alert-circle', { size: 14 }) + ' Write something before sending.';
      err.hidden = false;
      ta.focus();
      return;
    }
    err.hidden = true;
    ta.removeAttribute('aria-invalid');
    H.withSaving(host.querySelector('#sendBtn'), () => {
      const st = S.get();
      const threads = st.threads.slice();
      let th = threads.find((x) => x.memberId === m.id);
      if (!th) { th = { id: 'TH-' + m.id, memberId: m.id, unread: 0, last: 'Just now', messages: [] }; threads.push(th); }
      th.messages = [{ who: 'admin', at: 'Just now', from: st.me.name, text }, ...th.messages];
      th.last = 'Just now';
      th.unread = 0;
      S.set({ threads });
      S.note('Messaged ' + m.name);
      messages(host, m);
      UI.toast({ title: 'Message sent', message: 'In production, ' + m.name + ' would see it in their dashboard. Nothing leaves this prototype.' });
    });
  });
}

/* -------------------------------------------------------------- header actions */
function assignPlan(m) {
  const st = S.get();
  const live = st.programs.filter((p) => p.status === 'Live');
  UI.modal({
    title: 'Assign a plan to ' + m.name,
    body: `${H.field({ id: 'ap-plan', label: 'Program', type: 'select', options: live.map((p) => p.name) })}
      ${H.field({ id: 'ap-start', label: 'Start date', type: 'date', value: '2026-08-17' })}
      ${H.field({ id: 'ap-note', label: 'Note to the member', type: 'textarea', rows: 3,
        placeholder: 'Optional. Sent with the assignment.' })}`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: 'Assign the plan', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const name = ref.el.querySelector('#ap-plan').value;
        const members = S.get().members.map((x) => x.id === m.id ? { ...x, program: name, adherence: x.adherence == null ? 0 : x.adherence } : x);
        S.set({ members });
        S.note('Assigned ' + name + ' to ' + m.name);
        UI.toast({ title: 'Plan assigned', message: m.name + ' now has ' + name + '.' });
        R.navigate('/members/' + m.id + '/nutrition');
      } },
    ],
  });
}

function wireActions(outlet, m) {
  /* On any other tab this navigates. On the Messages tab itself navigation is a
     no-op, so the button would look live and do nothing — there it puts the
     cursor in the reply box instead. */
  outlet.querySelector('#msgBtn').addEventListener('click', () => {
    const reply = outlet.querySelector('#reply');
    if (reply) { reply.focus(); reply.scrollIntoView({ block: 'center' }); return; }
    R.navigate('/members/' + m.id + '/messages');
  });
  outlet.querySelector('#planBtn').addEventListener('click', () => assignPlan(m));

  /* Everything secondary moves behind one menu, so the header reads as two
     decisions rather than a toolbar of four. */
  UI.attachMenu(outlet.querySelector('#moreBtn'), () => `
    <button class="menu__item" data-value="note">${icon('note', { size: 18 })} Add a note</button>
    <button class="menu__item" data-value="export">${icon('download', { size: 18 })} Export record</button>
    <div class="menu__sep"></div>
    <a class="menu__item" href="${R.href('/members/' + m.id + '/assessments')}" data-value="assess">${icon('clipboard', { size: 18 })} Assessment results</a>
    <a class="menu__item" href="${R.href('/members/' + m.id + '/storyline')}" data-value="story">${icon('history', { size: 18 })} Full storyline</a>`,
    (value) => { if (value === 'note') addNote(m); if (value === 'export') exportRecord(m); });
}

function addNote(m) {
  UI.modal({
      title: 'Add a note',
      desc: 'Notes are visible to the Veye team and appear on the storyline. The member does not see them.',
      body: H.field({ id: 'nt-text', label: 'Note', type: 'textarea', rows: 4, required: true,
        placeholder: 'What should the next person to open this record know?' }),
      actions: [
        { label: 'Cancel', variant: 'secondary', value: false },
        { label: 'Save the note', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
          const text = ref.el.querySelector('#nt-text').value.trim();
          if (!text) { H.fieldError(ref.el, 'nt-text', 'A note needs some words in it.'); return false; }
          const st = S.get();
          S.set({ memberNotes: [{ memberId: m.id, who: st.me.name, at: 'Just now', text }, ...st.memberNotes] });
          S.note('Added a note on ' + m.name);
          UI.toast({ title: 'Note saved', message: 'It is on the storyline.' });
          R.navigate('/members/' + m.id + '/storyline');
        } },
      ],
    });
}

function exportRecord(m) {
  UI.confirm({
    title: 'Export this member record?',
    message: 'A spreadsheet of ' + m.name + '’s profile, assessment results, blood markers, mood entries and diary rows.',
    reversible: 'In this prototype nothing leaves the browser.',
    confirmLabel: 'Export the record',
  }).then((r) => {
    if (r.ok) UI.toast({ title: 'Export prepared', message: m.name + '’s record. In the real console the file downloads here.' });
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens['member-360'] = { render };

})();
