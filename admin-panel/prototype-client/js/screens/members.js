/* ============================================================================
   Members — the directory
   ----------------------------------------------------------------------------
   The console's directory (platform/web app/admin/members/page.tsx): a table,
   because density is the point. Search across name, email and member id;
   three filters; sortable columns; Open → Member 360. Members · Prospects ·
   Deletions are the three views of the Members area.

   The Health Number column is the record only when the member shares their
   health records with the Veye team. The API withholds it otherwise — before
   filtering and sorting, so neither can be used to infer it — and the console
   then shows "Not completed", exactly as here.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const H = window.Veye.H;
const esc = window.Veye.UI.esc;

const MEMBER_VIEWS = [
  { key: 'members', label: 'Members', route: '/members' },
  { key: 'prospects', label: 'Prospects', route: '/members/prospects' },
  { key: 'deletions', label: 'Deletions', route: '/members/deletions' },
];
const STATUS = [['any', 'Any status'], ['active', 'Active'], ['inactive', 'Inactive'], ['unverified', 'Email unverified']];
const ONBOARDING = [['any', 'Any onboarding'], ['complete', 'Complete'], ['not_started', 'Not started']];
const ACTIVE = [['any', 'Any time'], ['week', 'This week'], ['month', 'This month'], ['longer', 'Longer ago'], ['never', 'Never']];
const DEFAULT = { q: '', status: 'any', onboarding: 'any', active: 'any', sort: 'name', direction: 'asc', page: 1 };
const PAGE_SIZE = 25;
let query = { ...DEFAULT };

/** A directory row as the API's MemberRow carries it, sharing applied. */
function row(m) {
  const shares = S.shares(m);
  const latest = m.records.health_number[0] || null;
  return {
    member_id: m.id, name: m.name, email: m.email, initials: m.initials, photo: m.photo, admin_access: m.adminAccess,
    joined_at: m.joinedAt, email_verified: m.emailVerified, is_active: m.isActive, last_active_at: m.lastActiveAt,
    onboarding: m.onboarding,
    trackers_completed: ['health_number', 'body_composition', 'blood_markers', 'health_assessment', 'simple_quiz'].filter((k) => m.records[k].length).length,
    health_number: shares && latest ? Number(latest.displayed_score) : null,
    health_number_status: shares && latest ? latest.status : null,
  };
}

function rows() {
  const now = Date.now();
  let out = S.get().members.map(row);
  const needle = query.q.trim().toLowerCase();
  if (needle) out = out.filter((r) => r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle) || r.member_id.includes(needle));
  if (query.status === 'active') out = out.filter((r) => r.is_active);
  else if (query.status === 'inactive') out = out.filter((r) => !r.is_active);
  else if (query.status === 'unverified') out = out.filter((r) => !r.email_verified);
  if (query.onboarding === 'complete') out = out.filter((r) => r.onboarding === 'Complete');
  else if (query.onboarding === 'not_started') out = out.filter((r) => r.onboarding !== 'Complete');
  const age = (r) => (r.last_active_at ? now - Date.parse(r.last_active_at) : null);
  if (query.active === 'week') out = out.filter((r) => age(r) !== null && age(r) <= 7 * 864e5);
  else if (query.active === 'month') out = out.filter((r) => age(r) !== null && age(r) <= 30 * 864e5);
  else if (query.active === 'longer') out = out.filter((r) => age(r) !== null && age(r) > 30 * 864e5);
  else if (query.active === 'never') out = out.filter((r) => r.last_active_at === null);
  const key = {
    name: (r) => r.name.toLowerCase(),
    joined: (r) => r.joined_at,
    health_number: (r) => (r.health_number === null ? [1, 0] : [0, r.health_number]),
    last_active: (r) => r.last_active_at || '1970-01-01T00:00:00.000Z',
  }[query.sort];
  out.sort((a, b) => {
    const x = key(a), y = key(b);
    const c = Array.isArray(x) ? (x[0] - y[0]) || (x[1] - y[1]) : (x < y ? -1 : x > y ? 1 : 0);
    return query.direction === 'asc' ? c : -c;
  });
  return out;
}

function render(outlet) {
  const total = S.get().members.length;
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Members', desc: `Everyone using Veye on this local stack — ${total} member${total === 1 ? '' : 's'}.`,
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Members' }] })}
    ${H.subnav(MEMBER_VIEWS, 'members')}
    <div class="card">
      <div class="findbar">
        <div class="search" style="flex:1 1 260px;max-width:360px;position:relative">
          <span class="search__icon">${icon('search', { size: 18 })}</span>
          <label class="sr-only" for="mSearch">Search members</label>
          <input class="search__input" id="mSearch" type="search" placeholder="Search by name, email or member id" value="${esc(query.q)}">
        </div>
        <div class="findbar__filters">
          ${select('fStatus', 'Member status', STATUS, query.status)}
          ${select('fOnboarding', 'Onboarding status', ONBOARDING, query.onboarding)}
          ${select('fActive', 'Last activity', ACTIVE, query.active)}
        </div>
        <span class="findbar__spacer"></span>
        <span class="filtercount" id="fCount" hidden></span>
        <button class="btn btn--ghost btn--sm" type="button" id="clearBtn" hidden>Clear</button>
      </div>
      <div id="mResults"></div>
    </div>
  </div>`;

  const set = (patch) => { query = { ...query, ...patch, page: 1 }; paint(outlet); };
  outlet.querySelector('#mSearch').addEventListener('input', (e) => set({ q: e.target.value }));
  outlet.querySelector('#fStatus').addEventListener('change', (e) => set({ status: e.target.value }));
  outlet.querySelector('#fOnboarding').addEventListener('change', (e) => set({ onboarding: e.target.value }));
  outlet.querySelector('#fActive').addEventListener('change', (e) => set({ active: e.target.value }));
  outlet.querySelector('#clearBtn').addEventListener('click', () => { query = { ...DEFAULT }; render(outlet); });
  paint(outlet);
}

function select(id, label, options, value) {
  return `<div class="field" style="margin:0">
    <label class="sr-only" for="${id}">${label}</label>
    <select class="select input--sm" id="${id}">${options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>`;
}

function paint(outlet) {
  const all = rows();
  const host = outlet.querySelector('#mResults');
  const filters = (query.status !== 'any' ? 1 : 0) + (query.onboarding !== 'any' ? 1 : 0) + (query.active !== 'any' ? 1 : 0) + (query.q.trim() ? 1 : 0);
  const count = outlet.querySelector('#fCount');
  count.hidden = outlet.querySelector('#clearBtn').hidden = filters === 0;
  count.textContent = `${filters} filter${filters === 1 ? '' : 's'} active`;

  if (!all.length) {
    host.innerHTML = `<div class="card__body">${H.emptyState({ icon: 'search', title: 'No members match those filters',
      msg: 'Try a shorter search, or clear one of the three filters above.',
      action: '<button class="btn btn--secondary" type="button" id="emptyClear">Clear all filters</button>' })}</div>`;
    host.querySelector('#emptyClear').addEventListener('click', () => { query = { ...DEFAULT }; render(outlet); });
    return;
  }

  const pageRows = all.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE);
  const th = (key, label, priority) => `
    <th scope="col" ${priority ? `data-col-priority="${priority}"` : ''} ${query.sort === key ? `aria-sort="${query.direction === 'asc' ? 'ascending' : 'descending'}"` : ''}>
      <button class="th-sort" type="button" data-sort="${key}" aria-label="Sort by ${label}">${label} ${query.sort === key ? icon(query.direction === 'asc' ? 'chevron-right' : 'chevron-left', { size: 14 }) : ''}</button>
    </th>`;

  host.innerHTML = `
    <div class="table-wrap table-wrap--sticky">
      <table class="table table--rows" data-testid="members-table">
        <caption class="sr-only">Members, ${pageRows.length} of ${all.length} shown</caption>
        <thead><tr>
          ${th('name', 'Member')}
          ${th('health_number', 'Health Number')}
          <th scope="col" data-col-priority="medium">Trackers</th>
          <th scope="col" data-col-priority="low">Onboarding</th>
          ${th('last_active', 'Last active', 'medium')}
          ${th('joined', 'Joined', 'low')}
          <th scope="col">Status</th>
          <th scope="col"><span class="sr-only">Open</span></th>
        </tr></thead>
        <tbody>
          ${pageRows.map((m) => `<tr>
            <td>
              <div class="person">
                ${H.avatar(m, 'sm')}
                <div style="min-width:0">
                  <div class="cell-primary">${esc(m.name)}${m.admin_access ? '<span class="tag" style="margin-left:8px">admin access</span>' : ''}</div>
                  <div class="cell-sub">${esc(m.email)}</div>
                </div>
              </div>
            </td>
            <td>${m.health_number === null ? '<span class="t-muted">Not completed</span>'
              : `<span class="t-num">${m.health_number.toFixed(1)}</span> <span class="cell-sub">${esc(m.health_number_status)}</span>`}</td>
            <td data-col-priority="medium">${m.trackers_completed} of 5</td>
            <td data-col-priority="low">${esc(m.onboarding)}</td>
            <td data-col-priority="medium">${m.last_active_at ? esc(H.fmtDate(m.last_active_at)) : '<span class="t-muted">Never</span>'}</td>
            <td data-col-priority="low">${esc(H.fmtDate(m.joined_at))}</td>
            <td>${H.chip(m.is_active ? (m.email_verified ? 'Active' : 'Unverified') : 'Inactive', m.is_active ? (m.email_verified ? 'live' : 'draft') : 'archived')}</td>
            <td style="text-align:right"><a class="btn btn--secondary btn--sm" href="${R.href('/members/' + m.member_id)}">Open<span class="sr-only"> ${esc(m.name)}</span></a></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="pager__info">Showing ${pageRows.length} of ${all.length} members</span>
      <span class="t-support">A lower Health Number is better.</span>
      ${all.length > PAGE_SIZE ? `<span class="row gap-2">
        <button class="btn btn--ghost btn--sm" type="button" id="prevPage" ${query.page <= 1 ? 'disabled' : ''}>Previous</button>
        <button class="btn btn--ghost btn--sm" type="button" id="nextPage" ${query.page * PAGE_SIZE >= all.length ? 'disabled' : ''}>Next</button>
      </span>` : ''}
    </div>`;

  host.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    const sort = b.dataset.sort;
    query = { ...query, sort, direction: query.sort === sort && query.direction === 'asc' ? 'desc' : 'asc', page: 1 };
    paint(outlet);
  }));
  const prev = host.querySelector('#prevPage');
  if (prev) prev.addEventListener('click', () => { query.page -= 1; paint(outlet); });
  const next = host.querySelector('#nextPage');
  if (next) next.addEventListener('click', () => { query.page += 1; paint(outlet); });
}

window.Veye.MEMBER_VIEWS = MEMBER_VIEWS;
window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.members = { render };

})();
