/* ============================================================================
   Members — the directory
   ----------------------------------------------------------------------------
   Deliberately still a table. A directory is the one place in this console where
   density is the point, so v2 refines it rather than turning it into cards:
   a sticky header, a real focus and hover treatment on rows, an active-filter
   count with one-click clear, a filter drawer instead of a crowded control row
   on a phone, and Last active sorted by actual date.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const DEFAULTS = { status: 'Any status', onboarding: 'Any onboarding', active: 'Any time' };
const view = { q: '', ...DEFAULTS, sort: 'name', dir: 1 };

const OPTIONS = {
  status: ['Any status', 'Active', 'Paused'],
  onboarding: ['Any onboarding', 'Complete', 'In progress', 'Not started'],
  active: ['Any time', 'Today', 'This week', 'Longer ago', 'Never'],
};

function onboardingBucket(m) {
  if (m.onboarding === 'Complete') return 'Complete';
  if (m.onboarding === 'Not started') return 'Not started';
  return 'In progress';
}

/* Buckets from the real timestamp, not from the text of the date. */
function activeBucket(m) {
  const t = H.parseWhen(m.lastActive);
  if (!t) return 'Never';
  const days = (H.parseWhen('14 Aug 2026') - t) / 86400000;
  if (days < 1) return 'Today';
  if (days < 7) return 'This week';
  return 'Longer ago';
}

function activeFilterCount() {
  return ['status', 'onboarding', 'active'].filter((k) => view[k] !== DEFAULTS[k]).length
    + (view.q.trim() ? 1 : 0);
}

function filtered() {
  const st = S.get();
  const q = view.q.trim().toLowerCase();
  const rows = st.members.filter((m) => {
    if (q && !(m.name + ' ' + m.email + ' ' + m.id + ' ' + (m.program || '')).toLowerCase().includes(q)) return false;
    if (view.status !== DEFAULTS.status && m.status !== view.status) return false;
    if (view.onboarding !== DEFAULTS.onboarding && onboardingBucket(m) !== view.onboarding) return false;
    if (view.active !== DEFAULTS.active && activeBucket(m) !== view.active) return false;
    return true;
  });
  const key = view.sort;
  rows.sort((a, b) => {
    let x, y;
    if (key === 'hn') { x = a.hn == null ? 99 : a.hn; y = b.hn == null ? 99 : b.hn; }
    else if (key === 'active') { x = H.parseWhen(a.lastActive); y = H.parseWhen(b.lastActive); }
    else { x = String(a[key] || '').toLowerCase(); y = String(b[key] || '').toLowerCase(); }
    return x < y ? -view.dir : x > y ? view.dir : 0;
  });
  return rows;
}

function reset() { view.q = ''; Object.assign(view, DEFAULTS); }

function render(outlet) {
  const st = S.get();

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: 'Members',
      desc: `Everyone using Veye. ${H.n(st.members.length)} in this prototype; the live product holds ${H.n(window.Veye.SEED.insights.members.total)}.`,
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Members' }],
      where: 'members',
      actions: `<button class="btn btn--secondary" id="exportBtn">${icon('download', { size: 18 })} Export</button>
                <button class="btn btn--primary" id="addBtn">${icon('user-plus', { size: 18 })} Add member</button>`,
    })}

    <div class="card">
      <div class="findbar">
        <div class="search" style="flex:1 1 260px;max-width:360px;position:relative">
          <span class="search__icon">${icon('search', { size: 18 })}</span>
          <label class="sr-only" for="mSearch">Search members</label>
          <input class="search__input" id="mSearch" type="search" placeholder="Search by name, email or member id" value="${esc(view.q)}">
        </div>

        <!-- Desktop keeps the three selects inline. -->
        <div class="findbar__filters">
          ${select('fStatus', 'Member status', 'status')}
          ${select('fOnboarding', 'Onboarding status', 'onboarding')}
          ${select('fActive', 'Last activity', 'active')}
        </div>

        <!-- A phone gets one button into a drawer instead of a crowded row. -->
        <button class="btn btn--secondary btn--sm findbar__drawerbtn" id="filterDrawerBtn">
          ${icon('filter', { size: 16 })} Filters<span id="fCountSm"></span>
        </button>

        <span class="findbar__spacer"></span>
        <span class="filtercount" id="fCount" hidden></span>
        <button class="btn btn--ghost btn--sm" id="clearBtn" hidden>Clear</button>
      </div>
      <div id="mResults"></div>
    </div>
  </div>`;

  outlet.querySelector('#addBtn').addEventListener('click', window.Veye.addMember);
  outlet.querySelector('#exportBtn').addEventListener('click', () => {
    const rows = filtered();
    UI.confirm({
      title: 'Export this list?',
      message: `${rows.length} member${rows.length === 1 ? '' : 's'} would be written to a spreadsheet: name, member id, email, Health Number, program, last activity and status.`,
      reversible: 'In this prototype nothing leaves the browser.',
      confirmLabel: 'Export ' + rows.length + ' members',
    }).then((r) => {
      if (r.ok) UI.toast({ title: 'Export prepared', message: rows.length + ' members. In the real console the file downloads here.' });
    });
  });

  const q = outlet.querySelector('#mSearch');
  q.addEventListener('input', () => { view.q = q.value; paint(outlet); });
  ['fStatus:status', 'fOnboarding:onboarding', 'fActive:active'].forEach((pair) => {
    const [id, key] = pair.split(':');
    outlet.querySelector('#' + id).addEventListener('change', (e) => { view[key] = e.target.value; paint(outlet); });
  });
  outlet.querySelector('#clearBtn').addEventListener('click', () => {
    reset();
    render(outlet);
    outlet.querySelector('#mSearch').focus();
    UI.toast({ title: 'Filters cleared', kind: 'info', timeout: 2400 });
  });
  outlet.querySelector('#filterDrawerBtn').addEventListener('click', () => openFilterDrawer(outlet));

  paint(outlet);
}

function select(id, label, key) {
  return `<div class="field" style="margin:0">
    <label class="sr-only" for="${id}">${label}</label>
    <select class="select input--sm" id="${id}">
      ${OPTIONS[key].map((o) => `<option ${o === view[key] ? 'selected' : ''}>${o}</option>`).join('')}
    </select>
  </div>`;
}

/* The phone filter drawer. Same three filters, room to read them. */
function openFilterDrawer(outlet) {
  UI.drawer({
    eyebrow: 'Members',
    title: 'Filters',
    desc: 'Narrow the directory. The list updates as you choose.',
    body: `<div class="stack gap-5">
      ${H.field({ id: 'dStatus', label: 'Member status', type: 'select', options: OPTIONS.status, value: view.status })}
      ${H.field({ id: 'dOnboarding', label: 'Onboarding status', type: 'select', options: OPTIONS.onboarding, value: view.onboarding })}
      ${H.field({ id: 'dActive', label: 'Last activity', type: 'select', options: OPTIONS.active, value: view.active })}
      <p class="t-support" id="dCount"></p>
    </div>`,
    foot: `<button class="btn btn--secondary" id="dClear">Clear all</button>
           <button class="btn btn--primary" id="dDone">Show results</button>`,
    onMount: (ref) => {
      const count = ref.el.querySelector('#dCount');
      const refresh = () => { count.textContent = filtered().length + ' of ' + S.get().members.length + ' members match.'; };
      [['dStatus', 'status'], ['dOnboarding', 'onboarding'], ['dActive', 'active']].forEach(([id, key]) => {
        ref.el.querySelector('#' + id).addEventListener('change', (e) => {
          view[key] = e.target.value; refresh(); paint(outlet);
        });
      });
      refresh();
      ref.el.querySelector('#dClear').addEventListener('click', () => {
        reset(); ref.close(); render(outlet);
        UI.toast({ title: 'Filters cleared', kind: 'info', timeout: 2400 });
      });
      ref.el.querySelector('#dDone').addEventListener('click', () => { ref.close(); render(outlet); });
    },
  });
}

function paint(outlet) {
  const rows = filtered();
  const host = outlet.querySelector('#mResults');
  const total = S.get().members.length;
  const n = activeFilterCount();

  // filter count + clear
  const countEl = outlet.querySelector('#fCount');
  const clearEl = outlet.querySelector('#clearBtn');
  const smEl = outlet.querySelector('#fCountSm');
  countEl.hidden = clearEl.hidden = n === 0;
  countEl.textContent = n + (n === 1 ? ' filter' : ' filters') + ' active';
  smEl.textContent = n ? ' (' + n + ')' : '';

  if (!rows.length) {
    host.innerHTML = `<div class="card__body">${H.emptyState({
      icon: 'search',
      title: 'No members match those filters',
      msg: 'Try a shorter search, or clear one of the three filters above.',
      action: `<button class="btn btn--secondary" id="emptyClear">Clear all filters</button>`,
    })}</div>`;
    host.querySelector('#emptyClear').addEventListener('click', () => {
      reset(); render(outlet); UI.toast({ title: 'Filters cleared', kind: 'info', timeout: 2400 });
    });
    return;
  }

  const th = (key, label, priority) => `
    <th scope="col" ${priority ? `data-col-priority="${priority}"` : ''}
        ${view.sort === key ? `aria-sort="${view.dir === 1 ? 'ascending' : 'descending'}"` : ''}>
      <button class="th-sort" data-sort="${key}" aria-label="Sort by ${esc(label)}">
        ${esc(label)} ${view.sort === key ? icon(view.dir === 1 ? 'chevron-up' : 'chevron-down', { size: 14 }) : ''}
      </button></th>`;

  host.innerHTML = `
    <div class="table-wrap table-wrap--sticky">
      <table class="table table--rows">
        <caption class="sr-only">Members, ${rows.length} of ${total} shown</caption>
        <thead><tr>
          ${th('name', 'Member')}
          ${th('hn', 'Health Number')}
          ${th('program', 'Program', 'medium')}
          ${th('onboarding', 'Onboarding', 'low')}
          ${th('active', 'Last active', 'medium')}
          ${th('status', 'Status')}
          <th scope="col"><span class="sr-only">Open</span></th>
        </tr></thead>
        <tbody>
          ${rows.map((m) => `<tr>
            <td>
              <div class="person">
                <span class="avatar avatar--sm">${esc(m.initials)}</span>
                <div style="min-width:0">
                  <div class="cell-primary">${esc(m.name)}</div>
                  <div class="cell-sub">${esc(m.id)} · ${esc(m.email)}</div>
                </div>
              </div>
            </td>
            <td>${m.hn == null
                  ? '<span class="t-muted">Not completed</span>'
                  : `<span class="t-num">${m.hn.toFixed(1)}</span> <span class="cell-sub">${esc(m.hnBand)}</span>`}</td>
            <td data-col-priority="medium">${m.program ? esc(m.program) : '<span class="t-muted">None</span>'}</td>
            <td data-col-priority="low">${esc(m.onboarding)}</td>
            <td data-col-priority="medium">${esc(m.lastActive)}</td>
            <td>${H.chip(m.status)}</td>
            <td style="text-align:right">
              <a class="btn btn--secondary btn--sm" href="${R.href('/members/' + m.id + '/overview')}">Open<span class="sr-only"> ${esc(m.name)}</span></a>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="pager__info">Showing ${rows.length} of ${total} members</span>
      <span class="t-support">A lower Health Number is better.</span>
    </div>`;

  host.querySelectorAll('[data-sort]').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      if (view.sort === k) view.dir = -view.dir; else { view.sort = k; view.dir = 1; }
      paint(outlet);
    });
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.members = { render };

})();
