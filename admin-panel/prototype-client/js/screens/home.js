/* ============================================================================
   Home — today, and only today
   ----------------------------------------------------------------------------
   v2 narrows Home to five things: a greeting with four quick actions, four
   headline figures, one interactive trend, a compact priority rail, and a
   one-line health summary that links to Insights.

   The full onboarding funnel and the full Health Number analysis have moved to
   Insights, where they belong. Home carries a preview of each, not a copy —
   telling the same analytical story twice was most of what made this screen
   long.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

function render(outlet) {
  const st = S.get();
  const ins = window.Veye.SEED.insights;
  const attention = st.attention;
  const high = attention.filter((a) => a.priority === 'High').length;
  const onboardingRate = Math.round((ins.members.funnel[2].n / ins.members.funnel[0].n) * 100);
  const avgNow = ins.health.averageByMonth[11];
  const avgThen = ins.health.averageByMonth[0];

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Home', where: 'home' })}

    <section class="lead">
      <div>
        <p class="hero__date">${esc(window.Veye.TODAY_LABEL)}</p>
        <h2>Good morning, ${esc(st.me.name.split(' ')[0])}</h2>
        <p>${attention.length} things are waiting for someone to look at, ${high} of them marked high.
           Everything else is running normally.</p>
      </div>
      <div class="quick" style="min-width:230px">
        <button class="quick__btn" id="qaAdd">${icon('user-plus')}<span>Add a member</span>${icon('chevron-right', { size: 16 })}</button>
        <a class="quick__btn" href="${R.href('/members')}">${icon('users')}<span>View all members</span>${icon('chevron-right', { size: 16 })}</a>
        <a class="quick__btn" href="${R.href('/content/website')}">${icon('edit')}<span>Edit website content</span>${icon('chevron-right', { size: 16 })}</a>
        <a class="quick__btn" href="${R.href('/companion/conversations')}">${icon('sprout')}<span>Review Companion messages</span>${icon('chevron-right', { size: 16 })}</a>
      </div>
    </section>

    <!-- Four figures. A 2x2 block on a phone rather than four full-width cards,
         so the trend below is still within the first useful scroll. -->
    <div class="kpis kpis--quad">
      <div class="kpi">
        <span class="kpi__label">${icon('users', { size: 16 })} Active members</span>
        <span class="kpi__value" data-countup>${H.n(ins.members.active)}</span>
        <span class="kpi__note">of ${H.n(ins.members.total)} total</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">${icon('activity', { size: 16 })} Used Veye this week</span>
        <span class="kpi__value" data-countup>${ins.engagement.weekly[11]}%</span>
        <span class="kpi__note">up from ${ins.engagement.weekly[10]}% last week</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">${icon('route', { size: 16 })} Finish onboarding</span>
        <span class="kpi__value" data-countup>${onboardingRate}%</span>
        <span class="kpi__note">${H.n(ins.members.funnel[2].n)} of ${H.n(ins.members.funnel[0].n)}</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">${icon('flag', { size: 16 })} Needs attention</span>
        <span class="kpi__value" data-countup>${attention.length}</span>
        <span class="kpi__note">${high} high · first look ${esc(ins.operations.medianFirstLook)}</span>
      </div>
    </div>

    <!-- The trend carries the strongest visual weight; the priority rail beside
         it is deliberately narrower. -->
    <div class="hgrid hgrid--anchor" data-reveal style="margin-top:var(--grid-gutter)">
      <div class="card card--anchor">
        <div class="card__head">
          <div>
            <h2 class="card__title">Members and engagement</h2>
            <p class="t-support">Twelve months to August 2026.</p>
          </div>
          <div class="modeswitch" role="tablist" aria-label="Choose a series">
            <button class="modeswitch__btn" role="tab" id="tabJoin" aria-selected="true" aria-controls="trendPanel">New members</button>
            <button class="modeswitch__btn" role="tab" id="tabEng" aria-selected="false" aria-controls="trendPanel">Weekly active</button>
          </div>
        </div>
        <div class="card__body" id="trendPanel" role="tabpanel" aria-labelledby="tabJoin"></div>
      </div>

      <div class="card">
        <div class="card__head">
          <div>
            <h2 class="card__title">Needs attention</h2>
            <p class="t-support">Oldest first.</p>
          </div>
          <button class="btn btn--ghost btn--sm" id="allAttention">See all ${attention.length}</button>
        </div>
        <div class="card__body card__body--flush">
          <div class="attn">
            ${attention.slice(0, 5).map((a) => `
              <a class="attn__row" href="${R.href(a.memberId ? '/members/' + a.memberId + '/overview' : '/settings/integrations')}">
                <span class="attn__dot attn__dot--${a.priority.toLowerCase()}">${icon(kindIcon(a.kind), { size: 15 })}</span>
                <span>
                  <span class="attn__title">${esc(a.title)}</span>
                  <span class="attn__meta">${esc(a.member === '—' ? 'Whole system' : a.member)} · ${esc(a.age)}</span>
                </span>
                <span class="chip chip--${a.priority === 'High' ? 'high' : a.priority === 'Medium' ? 'medium' : 'low'}">${esc(a.priority)}</span>
              </a>`).join('')}
          </div>
        </div>
        <div class="card__foot">
          <span class="t-support">5 of ${attention.length}</span>
          <a class="btn btn--ghost btn--sm" href="${R.href('/insights/operations')}">Operations insights</a>
        </div>
      </div>
    </div>

    <!-- One compact summary. The full analysis lives in Insights. -->
    <section class="summary defer defer--short" data-reveal style="margin-top:var(--grid-gutter)">
      <div class="summary__main">
        <span class="t-eyebrow">Health and programs</span>
        <p class="summary__line">The average Health Number moved from <b>${avgThen.toFixed(1)}</b> to
          <b>${avgNow.toFixed(1)}</b> over twelve months. On this scale a lower number is better.
          Of ${H.n(ins.health.retakes)} people who retook the assessment, <b>${H.n(ins.health.improved)}</b> came out lower.</p>
        <p class="qualify">${icon('info', { size: 14 })} A description of the group, not a judgement about any individual.</p>
      </div>
      <div class="summary__figs">
        <div class="mini"><span class="mini__n" data-countup>${avgNow.toFixed(1)}</span><span class="mini__l">Average Health Number</span></div>
        <div class="mini"><span class="mini__n" data-countup>${H.n(ins.health.improved)}</span><span class="mini__l">Retakes that improved</span></div>
        <div class="mini"><span class="mini__n" data-countup>${Math.round(ins.health.programCompletion.reduce((t, p) => t + p.completion, 0) / ins.health.programCompletion.length)}%</span><span class="mini__l">Average program completion</span></div>
      </div>
      <div class="summary__go">
        <a class="btn btn--secondary" href="${R.href('/insights/health')}">Open Health &amp; Programs${icon('arrow-right', { size: 16 })}</a>
        <a class="btn btn--ghost" href="${R.href('/insights/members')}">Onboarding funnel${icon('arrow-right', { size: 16 })}</a>
      </div>
    </section>
  </div>`;

  /* ---- the switchable trend ---- */
  const panel = outlet.querySelector('#trendPanel');
  const tabJoin = outlet.querySelector('#tabJoin');
  const tabEng = outlet.querySelector('#tabEng');

  function drawTrend(which) {
    const joins = which === 'join';
    const series = joins ? ins.members.joined : ins.engagement.weekly;
    panel.innerHTML = window.Veye.C.markup({
      id: 'homeTrend',
      type: joins ? 'column' : 'line',
      labels: ins.members.months,
      series: [{
        key: joins ? 'joined' : 'weekly',
        label: joins ? 'New members' : 'Weekly active',
        unit: joins ? ' members' : '%',
        values: series,
      }],
      min: joins ? 0 : 40,
      max: joins ? Math.max(...series) + 20 : 100,
      readoutLabel: joins ? 'joined in' : 'opened Veye in',
      alt: joins
        ? 'New members each month over twelve months, rising from 64 in September to 126 in August.'
        : 'Share of members who opened Veye each week, rising from 58 percent to 78 percent over twelve months.',
      tableSummary: 'View these figures as a table',
      tableHead: ['Month', joins ? 'New members' : 'Weekly active'],
      tableRows: ins.members.months.map((m, i) => [esc(m), joins ? H.n(series[i]) : series[i] + '%']),
      tableCaption: joins ? 'New members by month' : 'Weekly active share by month',
    });
    panel.setAttribute('aria-labelledby', joins ? 'tabJoin' : 'tabEng');
    tabJoin.setAttribute('aria-selected', String(joins));
    tabEng.setAttribute('aria-selected', String(!joins));
    window.Veye.M.scan(panel);
  }
  drawTrend('join');
  tabJoin.addEventListener('click', () => drawTrend('join'));
  tabEng.addEventListener('click', () => drawTrend('eng'));

  /* ---- quick actions ---- */
  outlet.querySelector('#qaAdd').addEventListener('click', addMember);
  outlet.querySelector('#allAttention').addEventListener('click', () => {
    UI.drawer({
      eyebrow: 'Needs attention',
      title: 'Everything waiting',
      desc: `${attention.length} items across all members.`,
      body: `<div class="rows">${attention.map((a) => `
        <div class="rowitem">
          <span class="rowitem__icon ${a.priority === 'High' ? 'rowitem__icon--warn' : ''}">${icon(kindIcon(a.kind), { size: 18 })}</span>
          <div>
            <div class="rowitem__title">${esc(a.title)}</div>
            <div class="rowitem__meta">${esc(a.detail)}</div>
            <div class="rowitem__meta">${esc(a.member === '—' ? 'Whole system' : a.member)} · due ${esc(a.due)}</div>
          </div>
          <div class="rowitem__side">
            ${a.memberId ? `<a class="btn btn--secondary btn--sm" href="${R.href('/members/' + a.memberId + '/overview')}">Open member</a>` : ''}
          </div>
        </div>`).join('')}</div>`,
    });
  });
}

function kindIcon(kind) {
  return {
    'Blood markers': 'droplet', Companion: 'sprout', Onboarding: 'route', Mood: 'smile',
    Plan: 'calendar-check', Message: 'messages', Billing: 'credit-card',
    Assessment: 'clipboard', System: 'plug',
  }[kind] || 'flag';
}

/* Add a member. Shared by Home and the member directory. */
function addMember() {
  UI.modal({
    title: 'Add a member',
    desc: 'They receive an invitation and complete onboarding themselves.',
    body: `${H.field({ id: 'nm-name', label: 'Full name', required: true, placeholder: 'Alex Rivera' })}
      ${H.field({ id: 'nm-email', label: 'Email address', type: 'email', required: true, placeholder: 'alex@example.com' })}
      ${H.field({ id: 'nm-plan', label: 'Starting plan', type: 'select', options: ['Trial', 'DIY', 'Guided'] })}
      <p class="t-support" style="margin-top:12px">Nothing is emailed in this prototype. The member appears in the directory with onboarding not started.</p>`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: 'Add member', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const name = ref.el.querySelector('#nm-name').value.trim();
        const email = ref.el.querySelector('#nm-email').value.trim();
        const plan = ref.el.querySelector('#nm-plan').value;
        if (!name) { H.fieldError(ref.el, 'nm-name', 'A name is needed so the directory is readable.'); return false; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { H.fieldError(ref.el, 'nm-email', 'Enter a complete email address.'); return false; }
        if (S.get().members.some((m) => m.email.toLowerCase() === email.toLowerCase())) {
          H.fieldError(ref.el, 'nm-email', 'A member already uses that email address.'); return false;
        }
        const st = S.get();
        const id = 'HM-' + String(3000 + st.members.length).padStart(6, '0');
        const m = {
          id, name, initials: H.initials(name), email, joined: 'Today', joinedTs: Date.now(),
          hn: null, hnTrend: null, hnBand: 'Not completed', hnTaken: '—',
          lastActive: 'Not yet', lastActiveTs: 0, onboarding: 'Not started',
          subscription: plan, status: 'Active', consent: 'Pending', program: null, adherence: null,
          attention: 0, tags: ['New'], dob: '—', phone: '—', city: '—',
        };
        const detail = { biomarkers: [], mood: [], quiz: [], hsr: [], body: null, hnHistory: [],
          storyline: [{ at: 'Today', kind: 'account', text: 'Added to the directory and invited.' }] };
        S.set({ members: [m, ...st.members], memberDetail: { ...st.memberDetail, [id]: detail } });
        S.note('Added member ' + name);
        UI.toast({ title: 'Member added', message: name + ' is in the directory. Their invitation would go out now.' });
        R.navigate('/members/' + id + '/overview');
      } },
    ],
  });
}

window.Veye.addMember = addMember;
window.Veye.kindIcon = kindIcon;
window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.home = { render };

})();
