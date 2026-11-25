/* ============================================================================
   Members — the cells, filters and table that three screens share
   ----------------------------------------------------------------------------
   The console's member-cells.tsx and member-table.tsx: Health sharing replaced
   the Trackers column (Cara, 25 Nov 2026), a trend says what the Health Number
   did between a member's two latest dated results, and importance is a label
   the team sets — it is not medical triage and nothing guesses it.

   Everything taken from a health record is withheld unless the member shares
   it, before filtering and sorting, so neither can be used to infer it.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const H = window.Veye.H;
const UI = window.Veye.UI;
const esc = UI.esc;

const SHARING_LABEL = { not_requested: 'Not requested', requested: 'Requested', granted: 'Shared', declined: 'Declined', revoked: 'Revoked' };
const SHARING_TONE = { not_requested: 'draft', requested: 'info', granted: 'live', declined: 'attention', revoked: 'archived' };
const STATUS = [['any', 'Any status'], ['active', 'Active'], ['inactive', 'Inactive'], ['unverified', 'Email unverified']];
const SHARING = [['any', 'Any health sharing'], ...Object.entries(SHARING_LABEL)];
const ONBOARDING = [['any', 'Any onboarding'], ['complete', 'Complete'], ['not_started', 'Not started']];
const ACTIVE = [['any', 'Any time'], ['week', 'This week'], ['month', 'This month'], ['longer', 'Longer ago'], ['never', 'Never']];
const WITHIN = [['', 'Result at any time'], ['30', 'Result in the last 30 days'], ['90', 'Result in the last 90 days'], ['365', 'Result in the last year']];
const TREND = [['any', 'Any trend'], ['improved', 'Improved'], ['worsened', 'Increased (worse)'], ['unchanged', 'No change'], ['first', 'First result'],
  ['not_comparable', 'Not comparable'], ['none', 'No result'], ['not_shared', 'Not shared']];
const ARCHIVED = [['exclude', 'Active members'], ['include', 'Include archived'], ['only', 'Archived only']];
const PRIORITIES = [['', 'Not set'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
const PRIORITY_TONE = { high: 'error', medium: 'attention', low: 'draft' };
const DAY = 864e5;
const PAGE_SIZE = 25;

const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The two latest dated results of one member — never two versions compared. */
function trendOf(m) {
  if (!S.shares(m)) return { state: 'not_shared' };
  const [now, before] = m.records.health_number;
  if (!now) return { state: 'none' };
  if (!before) return { state: 'first', at: now.completed_at };
  if (now.calculation_version !== before.calculation_version) return { state: 'not_comparable', at: now.completed_at };
  const delta = Math.round((now.displayed_score - before.displayed_score) * 10) / 10;
  return { state: delta < 0 ? 'improved' : delta > 0 ? 'worsened' : 'unchanged', delta, at: now.completed_at, previous_at: before.completed_at };
}

function trendCell(t) {
  const since = t.previous_at ? `<span class="cell-sub t-nowrap">since ${esc(fmtDay(t.previous_at))}</span>` : '';
  const by = Math.abs(t.delta || 0).toFixed(1);
  const two = (chip) => `<span class="trend" data-trend="${t.state}">${chip} ${since}</span>`;
  if (t.state === 'improved') return two(`<span class="chip chip--live"><span aria-hidden="true">↓ </span>${by} lower<span class="sr-only">, improved: lower is better</span></span>`);
  if (t.state === 'worsened') return two(`<span class="chip chip--error"><span aria-hidden="true">↑ </span>${by} higher<span class="sr-only">, worse: lower is better</span></span>`);
  if (t.state === 'unchanged') return two('<span class="chip"><span aria-hidden="true">— </span>No change</span>');
  const word = { first: 'First result', not_comparable: 'Not comparable', none: 'No result yet' }[t.state] || 'Not shared';
  return `<span class="t-muted" data-trend="${t.state}">${word}</span>`;
}

const sharingChip = (state) => `<span class="chip chip--${SHARING_TONE[state]}" data-sharing="${state}">${SHARING_LABEL[state]}</span>`;

function priorityChip(priority) {
  return priority ? `<span class="chip chip--${PRIORITY_TONE[priority]} chip--sm" data-priority="${priority}">${priority[0].toUpperCase() + priority.slice(1)} importance</span>` : '';
}

function prioritySelect(id, value) {
  return `<div class="field" style="margin:0;max-width:220px">
    <label class="t-eyebrow" for="${id}">Importance</label>
    <select class="select" id="${id}" data-testid="priority-select">${PRIORITIES.map(([v, l]) => `<option value="${v}" ${v === (value || '') ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <span class="field__hint">Set by the team. Not medical triage.</span>
  </div>`;
}

/** A directory row as the API's MemberRow carries it, sharing applied. */
function row(m) {
  const shares = S.shares(m);
  const latest = shares ? m.records.health_number[0] || null : null;
  return {
    member_id: m.id, name: m.name, email: m.email, initials: m.initials, photo: m.photo, admin_access: m.adminAccess, joined_at: m.joinedAt,
    email_verified: m.emailVerified, is_active: m.isActive, archived_at: m.archivedAt, last_active_at: m.lastActiveAt, onboarding: m.onboarding,
    sharing_state: m.sharing.state, shares, trend: trendOf(m), result_at: latest ? latest.completed_at : null,
    health_number: latest ? Number(latest.displayed_score) : null, health_number_status: latest ? latest.status : null,
  };
}

function rows(query) {
  const now = Date.now();
  let out = S.get().members.map(row);
  const needle = query.q.trim().toLowerCase();
  if (query.archived !== 'include') out = out.filter((r) => (query.archived === 'only') === !!r.archived_at);
  if (needle) out = out.filter((r) => r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle) || r.member_id.includes(needle));
  if (query.status === 'active') out = out.filter((r) => r.is_active);
  else if (query.status === 'inactive') out = out.filter((r) => !r.is_active);
  else if (query.status === 'unverified') out = out.filter((r) => !r.email_verified);
  if (query.onboarding === 'complete') out = out.filter((r) => r.onboarding === 'Complete');
  else if (query.onboarding === 'not_started') out = out.filter((r) => r.onboarding !== 'Complete' && r.email_verified);
  if (query.sharing !== 'any') out = out.filter((r) => r.sharing_state === query.sharing);
  if (query.trend !== 'any') out = out.filter((r) => r.trend.state === query.trend);
  if (query.within) out = out.filter((r) => r.result_at && Date.parse(r.result_at) >= now - Number(query.within) * DAY);
  const age = (r) => (r.last_active_at ? now - Date.parse(r.last_active_at) : null);
  if (query.active === 'week') out = out.filter((r) => age(r) !== null && age(r) <= 7 * DAY);
  else if (query.active === 'month') out = out.filter((r) => age(r) !== null && age(r) <= 30 * DAY);
  else if (query.active === 'longer') out = out.filter((r) => age(r) !== null && age(r) > 30 * DAY);
  else if (query.active === 'never') out = out.filter((r) => r.last_active_at === null);
  const up = query.direction === 'asc';
  const key = {
    name: (r) => r.name.toLowerCase(), joined: (r) => r.joined_at, last_active: (r) => r.last_active_at || '',
    sharing: (r) => SHARING_LABEL[r.sharing_state],
    health_number: (r) => r.health_number, trend: (r) => (r.trend.delta === undefined ? null : r.trend.delta),
  }[query.sort];
  // Rows with nothing to compare stay at the end, whichever way the column is sorted.
  out.sort((a, b) => {
    const x = key(a), y = key(b);
    if (x === null || y === null) return (x === null) - (y === null) || (a.name < b.name ? -1 : 1);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return (up ? c : -c) || (a.name < b.name ? -1 : 1);
  });
  return out;
}

function pick(id, label, options, value) {
  return `<div class="field" style="margin:0">
    <label class="sr-only" for="${id}">${label}</label>
    <select class="select input--sm" id="${id}">${options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>`;
}

/** The table and its filters. `state.query` is kept by the screen that owns it. */
function table(host, state, { trendsView = false, defaults, onChange = () => {} } = {}) {
  host.innerHTML = `<div class="card">
    <div class="findbar">
      <div class="search" style="flex:1 1 260px;max-width:360px;position:relative">
        <span class="search__icon">${icon('search', { size: 18 })}</span>
        <label class="sr-only" for="mSearch">Search members</label>
        <input class="search__input" id="mSearch" type="search" placeholder="Search by name, email or member id" value="${esc(state.query.q)}">
      </div>
      <div class="findbar__filters">
        ${pick('fStatus', 'Member status', STATUS, state.query.status)}
        ${pick('fSharing', 'Health sharing', SHARING, state.query.sharing)}
        ${pick('fOnboarding', 'Onboarding status', ONBOARDING, state.query.onboarding)}
        ${trendsView ? pick('fWithin', 'Result date', WITHIN, state.query.within) : pick('fActive', 'Last activity', ACTIVE, state.query.active)}
        ${pick('fTrend', 'Trend', TREND, state.query.trend)}
        ${pick('fArchived', 'Archived members', ARCHIVED, state.query.archived)}
      </div>
      <span class="findbar__spacer"></span>
      <span class="filtercount" id="fCount" hidden></span>
      <button class="btn btn--ghost btn--sm" type="button" id="clearBtn" hidden>Clear</button>
    </div>
    <div id="mResults"></div>
  </div>`;

  const set = (patch) => { state.query = { ...state.query, ...patch, page: patch.page || 1 }; paint(); onChange(); };
  const on = (id, event, fn) => { const el = host.querySelector('#' + id); if (el) el.addEventListener(event, (e) => fn(e.target.value)); };
  on('mSearch', 'input', (v) => set({ q: v }));
  on('fStatus', 'change', (v) => set({ status: v }));
  on('fSharing', 'change', (v) => set({ sharing: v }));
  on('fOnboarding', 'change', (v) => set({ onboarding: v }));
  on('fWithin', 'change', (v) => set({ within: v }));
  on('fActive', 'change', (v) => set({ active: v }));
  on('fTrend', 'change', (v) => set({ trend: v }));
  on('fArchived', 'change', (v) => set({ archived: v }));
  const clear = () => { state.query = { ...defaults }; table(host, state, { trendsView, defaults, onChange }); onChange(); };
  host.querySelector('#clearBtn').addEventListener('click', clear);

  function paint() {
    const q = state.query;
    const all = rows(q);
    const out = host.querySelector('#mResults');
    const filters = ['status', 'onboarding', 'sharing', 'trend', 'active', 'within', 'archived'].filter((k) => q[k] !== defaults[k]).length + (q.q.trim() ? 1 : 0);
    const count = host.querySelector('#fCount');
    count.hidden = host.querySelector('#clearBtn').hidden = filters === 0;
    count.textContent = `${filters} filter${filters === 1 ? '' : 's'} active`;
    if (!all.length) {
      out.innerHTML = `<div class="card__body">${H.emptyState({ icon: 'search', title: 'No members match those filters',
        msg: 'Try a shorter search, or clear one of the filters above.',
        action: '<button class="btn btn--secondary" type="button" id="emptyClear">Clear all filters</button>' })}</div>`;
      out.querySelector('#emptyClear').addEventListener('click', clear);
      return;
    }
    const shown = all.slice((q.page - 1) * PAGE_SIZE, q.page * PAGE_SIZE);
    const th = (key, label, priority) => `<th scope="col" ${priority ? `data-col-priority="${priority}"` : ''} ${q.sort === key ? `aria-sort="${q.direction === 'asc' ? 'ascending' : 'descending'}"` : ''}>
      <button class="th-sort" type="button" data-sort="${key}" aria-label="Sort by ${label}">${label} ${q.sort === key ? icon(q.direction === 'asc' ? 'chevron-right' : 'chevron-left', { size: 14 }) : ''}</button></th>`;
    out.innerHTML = `
      <div class="table-wrap members-table">
        <table class="table table--rows" data-testid="members-table">
          <caption class="sr-only">Members, ${shown.length} of ${all.length} shown</caption>
          <thead><tr>
            ${th('name', 'Member')}${th('health_number', 'Health Number')}${th('sharing', 'Health sharing')}
            <th scope="col" data-col-priority="low">Onboarding</th>
            ${th('trend', 'Trend', trendsView ? '' : 'medium')}${th('last_active', 'Last active', 'medium')}
            ${trendsView ? '' : th('joined', 'Joined', 'low')}
            <th scope="col">Status</th><th scope="col"><span class="sr-only">Open</span></th>
          </tr></thead>
          <tbody>${shown.map((m) => `<tr>
            <td><div class="person">${H.avatar(m, 'sm')}<div style="min-width:0">
              <div class="cell-primary">${esc(m.name)}${m.admin_access ? '<span class="tag">admin access</span>' : ''}</div>
              <div class="cell-sub">${esc(m.email)}</div></div></div></td>
            <td>${!m.shares ? '<span class="t-muted">Not shared</span>' : m.health_number === null ? '<span class="t-muted">Not completed</span>'
              : `<span class="t-num">${m.health_number.toFixed(1)}</span> <span class="cell-sub">${esc(m.health_number_status)}</span>`}</td>
            <td class="t-nowrap">${sharingChip(m.sharing_state)}</td>
            <td data-col-priority="low">${esc(m.onboarding)}</td>
            <td ${trendsView ? '' : 'data-col-priority="medium"'}>${trendCell(m.trend)}</td>
            <td class="t-nowrap" data-col-priority="medium">${m.last_active_at ? esc(fmtDay(m.last_active_at)) : '<span class="t-muted">Never</span>'}</td>
            ${trendsView ? '' : `<td class="t-nowrap" data-col-priority="low">${esc(fmtDay(m.joined_at))}</td>`}
            <td>${m.archived_at ? H.chip('Archived', 'archived') : H.chip(m.is_active ? (m.email_verified ? 'Active' : 'Unverified') : 'Inactive', m.is_active ? (m.email_verified ? 'live' : 'draft') : 'archived')}</td>
            <td style="text-align:right"><a class="btn btn--secondary btn--sm" href="${R.href('/members/' + m.member_id)}">Open<span class="sr-only"> ${esc(m.name)}</span></a></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="pager">
        <span class="pager__info">Showing ${shown.length} of ${all.length} members</span>
        <span class="t-support">A lower Health Number is better.</span>
        ${all.length > PAGE_SIZE ? `<span class="row gap-2">
          <button class="btn btn--ghost btn--sm" type="button" id="prevPage" ${q.page <= 1 ? 'disabled' : ''}>Previous</button>
          <span class="t-support">Page ${q.page} of ${Math.ceil(all.length / PAGE_SIZE)}</span>
          <button class="btn btn--ghost btn--sm" type="button" id="nextPage" ${q.page * PAGE_SIZE >= all.length ? 'disabled' : ''}>Next</button></span>` : ''}
      </div>`;
    out.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => set({ sort: b.dataset.sort, direction: q.sort === b.dataset.sort && q.direction === 'asc' ? 'desc' : 'asc' })));
    const prev = out.querySelector('#prevPage'); if (prev) prev.addEventListener('click', () => set({ page: q.page - 1 }));
    const next = out.querySelector('#nextPage'); if (next) next.addEventListener('click', () => set({ page: q.page + 1 }));
  }
  paint();
  return { set: (patch) => { state.query = { ...state.query, ...patch, page: 1 }; table(host, state, { trendsView, defaults, onChange }); onChange(); } };
}

/* Add a member (Cara, 15 Nov): an address and, if known, a name. It sends an
   invitation; it never creates an account or chooses a password. */
function invite(onSent) {
  let ref = null;
  ref = UI.drawer({
    eyebrow: 'Members', title: 'Add a member',
    desc: 'They get an email with a link that works once, choose their own password and open their own dashboard. They can take the Health Number quiz then or later.',
    body: `<form id="inviteMemberForm" method="post" class="stack gap-4" data-testid="invite-member-form" novalidate>
      <p class="errorbar" role="alert" id="imError" hidden></p>
      ${H.field({ id: 'imEmail', label: 'Email address', type: 'email', required: true, maxlength: 320, autocomplete: 'off' })}
      ${H.field({ id: 'imFirst', label: 'First name', maxlength: 120, autocomplete: 'off' })}
      ${H.field({ id: 'imLast', label: 'Last name', maxlength: 120, autocomplete: 'off' })}
      <p class="t-support">Nothing is created until they accept. Accepting does not share any health information with the team, and it is not a paid plan.</p>
    </form>`,
    foot: `<button class="btn btn--ghost" type="button" data-cancel>Cancel</button>
      <button class="btn btn--primary" type="submit" form="inviteMemberForm" data-testid="invite-member-send">Send invitation</button>`,
    onMount: (r) => {
      r.el.querySelector('[data-cancel]').addEventListener('click', () => r.close());
      const form = r.el.querySelector('#inviteMemberForm');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = form.querySelector('#imEmail').value.trim().toLowerCase();
        const problem = r.el.querySelector('#imError');
        const fail = (message) => { problem.textContent = message; problem.hidden = false; };
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Enter an email address.');
        const st = S.get();
        if (st.members.some((m) => m.email.toLowerCase() === email)) return fail('This person is already a member.');
        if (st.memberInvitations.some((i) => i.email === email && statusOf(i) === 'pending')) return fail('An invitation to this address is already waiting.');
        H.busy(r.el.querySelector('[data-testid="invite-member-send"]'), 'Sending…', () => {
          const sent = S.deliver(email);
          const at = S.now();
          const invitation = { id: S.newId(), email, name: `${form.querySelector('#imFirst').value.trim()} ${form.querySelector('#imLast').value.trim()}`.trim(),
            invited_by: S.me().name, created_at: at, expires_at: new Date(Date.now() + 7 * DAY).toISOString(), sent_count: 1,
            accepted_at: null, revoked_at: null, member_id: null, delivery: sent.status, delivery_error: sent.detail };
          S.set({ memberInvitations: [invitation, ...S.get().memberInvitations] }, { silent: true });
          S.audit('member_invitation.sent', 'member_invitation', invitation.id, { delivery: sent.status });
          ref.close();
          onSent(invitation);
        });
      });
    },
  });
}

function statusOf(i) {
  if (i.revoked_at) return 'revoked';
  if (i.accepted_at) return 'accepted';
  return Date.parse(i.expires_at) < Date.now() ? 'expired' : 'pending';
}

window.Veye.MC = { SHARING_LABEL, PRIORITIES, DAY, fmtDay, trendOf, trendCell, sharingChip, priorityChip, prioritySelect, row, rows, table, invite, statusOf };

})();
