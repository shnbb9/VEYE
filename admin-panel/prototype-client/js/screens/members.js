/* ============================================================================
   Members — the directory, Progress & trends, and Invitations
   ----------------------------------------------------------------------------
   The console's three member lists (platform/web app/admin/members, /trends,
   /invitations). The strip above the directory finds people who started and
   did not finish — different groups, kept apart. The table is shared
   (components/member-cells.js).
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const H = window.Veye.H;
const M = window.Veye.MC;
const UI = window.Veye.UI;
const esc = UI.esc;

const MEMBER_VIEWS = [
  { key: 'members', label: 'Members', route: '/members' },
  { key: 'trends', label: 'Progress & trends', route: '/members/trends' },
  { key: 'invitations', label: 'Invitations', route: '/members/invitations' },
  { key: 'prospects', label: 'Prospects', route: '/members/prospects' },
  { key: 'deletions', label: 'Deletions', route: '/members/deletions' },
];
const DEFAULTS = { q: '', status: 'any', onboarding: 'any', active: 'any', sharing: 'any', trend: 'any', within: '', archived: 'exclude', sort: 'name', direction: 'asc', page: 1 };
const TREND_DEFAULTS = { ...DEFAULTS, sort: 'trend', direction: 'desc' };
const CRUMBS = [{ label: 'Home', route: '/home' }, { label: 'Members', route: '/members' }];
const addButton = `<button class="btn btn--primary" type="button" data-testid="add-member">${icon('plus', { size: 18 })} Add a member</button>`;

/* ------------------------------------------------------------- directory -- */
function directory(outlet) {
  const st = S.get();
  const people = st.members.filter((m) => !m.archivedAt);
  const state = { query: { ...DEFAULTS } };
  const mini = (value, label, attrs, tag = 'button') => `<${tag} class="mini" ${attrs}><span class="mini__n">${value}</span><span class="mini__l">${label}</span></${tag}>`;
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Members', desc: `Everyone using Veye — ${people.length} member${people.length === 1 ? '' : 's'}.`, crumbs: [CRUMBS[0], { label: 'Members' }], actions: addButton })}
    ${H.subnav(MEMBER_VIEWS, 'members')}
    <div class="minirow minirow--links" data-testid="unfinished" role="group" aria-label="Started and not finished">
      ${mini(st.prospects.filter((p) => ['unverified', 'verified', 'pending_claim'].includes(p.status)).length, 'Took the quiz, no account', `href="${R.href('/members/prospects')}" style="text-decoration:none;color:inherit"`, 'a')}
      ${mini(people.filter((m) => !m.emailVerified).length, 'Registered, email not verified', 'type="button" data-testid="show-unverified"')}
      ${mini(people.filter((m) => m.emailVerified && m.onboarding !== 'Complete').length, 'Verified, quiz not taken', 'type="button" data-testid="show-incomplete"')}
      ${mini(st.memberInvitations.filter((i) => M.statusOf(i) === 'pending').length, 'Invited, not joined yet', `href="${R.href('/members/invitations')}" style="text-decoration:none;color:inherit"`, 'a')}
    </div>
    <div id="memberTable"></div>
  </div>`;
  const list = M.table(outlet.querySelector('#memberTable'), state, { defaults: DEFAULTS });
  outlet.querySelector('[data-testid="show-unverified"]').addEventListener('click', () => list.set({ status: 'unverified', onboarding: 'any' }));
  outlet.querySelector('[data-testid="show-incomplete"]').addEventListener('click', () => list.set({ status: 'any', onboarding: 'not_started' }));
  outlet.querySelector('[data-testid="add-member"]').addEventListener('click', () => M.invite(sent));
}

/* ----------------------------------------------------- progress & trends -- */
const CARDS = [
  { key: 'improved', label: 'Improved', note: 'The latest number is lower', icon: 'check-circle' },
  { key: 'unchanged', label: 'No change', note: 'The latest two are the same', icon: 'activity' },
  { key: 'worsened', label: 'Increased (worse)', note: 'The latest number is higher', icon: 'alert-circle' },
];

function trends(outlet) {
  const state = { query: { ...TREND_DEFAULTS } };
  const counts = {};
  S.get().members.filter((m) => !m.archivedAt).forEach((m) => { const t = M.trendOf(m).state; counts[t] = (counts[t] || 0) + 1; });
  const n = (key) => counts[key] || 0;
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Member progress and trends', desc: 'How each member’s Health Number changed between their two latest dated results.', crumbs: [...CRUMBS, { label: 'Progress & trends' }] })}
    ${H.subnav(MEMBER_VIEWS, 'trends')}
    <div class="notice notice--quiet">${icon('info', { size: 18 })}<div>On the Health Number <b>lower is better</b>. A trend describes that number only — it is not a medical conclusion. It shows only for members who share their health records, and only when both results were scored by the same version of the calculation.</div></div>
    <div class="kpis kpis--quad" data-testid="trend-cards" style="margin-block:var(--s-5)">
      ${CARDS.map((c) => `<button class="kpi kpi--button" type="button" aria-pressed="false" data-trend-card="${c.key}" data-testid="trend-${c.key}">
        <span class="kpi__label">${icon(c.icon, { size: 16 })} ${c.label}</span><span class="kpi__value">${n(c.key)}</span><span class="kpi__note">${c.note}</span></button>`).join('')}
      <div class="kpi" data-testid="trend-unknown"><span class="kpi__label">${icon('users', { size: 16 })} No comparison</span>
        <span class="kpi__value">${n('first') + n('none') + n('not_comparable')}</span>
        <span class="kpi__note">${n('first')} with one result · ${n('none')} with none · ${n('not_shared')} more not shared</span></div>
    </div>
    <div id="memberTable"></div>
  </div>`;
  const pressed = () => outlet.querySelectorAll('[data-trend-card]').forEach((b) => b.setAttribute('aria-pressed', String(state.query.trend === b.dataset.trendCard)));
  const list = M.table(outlet.querySelector('#memberTable'), state, { trendsView: true, defaults: TREND_DEFAULTS, onChange: pressed });
  outlet.querySelectorAll('[data-trend-card]').forEach((b) => b.addEventListener('click', () => list.set({ trend: state.query.trend === b.dataset.trendCard ? 'any' : b.dataset.trendCard })));
}

/* ----------------------------------------------------------- invitations -- */
const INV_STATUS = [['any', 'Any status'], ['pending', 'Pending'], ['accepted', 'Accepted'], ['expired', 'Expired'], ['revoked', 'Withdrawn']];
const INV_SORT = [['newest', 'Newest first'], ['oldest', 'Oldest first']];
const INV_LABEL = Object.fromEntries(INV_STATUS);
const INV_TONE = { pending: 'info', accepted: 'live', expired: 'archived', revoked: 'archived' };
const DELIVERY = { sent: 'Email accepted by the mail server', failed: 'The email was not sent' };
let inv = { q: '', status: 'any', sort: 'newest', notice: '' };

function sent(invitation) {
  inv.notice = invitation.delivery === 'sent' ? `Invitation sent to ${invitation.email}.`
    : `The invitation to ${invitation.email} was saved, but the email was not sent${invitation.delivery_error ? `: ${invitation.delivery_error}` : ''}.`;
  if (R.currentRoute().path === '/members/invitations') invitations(document.getElementById('main-content'));
  else R.navigate('/members/invitations?sent=1');
}

function invitations(outlet) {
  const all = S.get().memberInvitations;
  const q = inv.q.trim().toLowerCase();
  const list = all.filter((i) => inv.status === 'any' || M.statusOf(i) === inv.status)
    .filter((i) => !q || `${i.email} ${i.name}`.toLowerCase().includes(q))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1) * (inv.sort === 'newest' ? 1 : -1));
  const select = (id, label, options, value) => `<div class="field" style="margin:0"><label class="sr-only" for="${id}">${label}</label>
    <select class="select input--sm" id="${id}">${options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Invitations', desc: 'People invited to become members, and what became of each invitation.', crumbs: [...CRUMBS, { label: 'Invitations' }], actions: addButton })}
    ${H.subnav(MEMBER_VIEWS, 'invitations')}
    ${inv.notice ? `<p class="notice notice--quiet" role="status" data-testid="invitations-notice">${esc(inv.notice)}</p>` : ''}
    <div class="minirow minirow--figures" data-testid="invitation-counts">
      ${['pending', 'accepted', 'expired', 'revoked'].map((k) => `<div class="mini"><span class="mini__n">${all.filter((i) => M.statusOf(i) === k).length}</span><span class="mini__l">${INV_LABEL[k]}</span></div>`).join('')}
    </div>
    <div class="card">
      <div class="findbar">
        <div class="search" style="flex:1 1 260px;max-width:360px;position:relative">
          <span class="search__icon">${icon('search', { size: 18 })}</span><label class="sr-only" for="invSearch">Search invitations</label>
          <input class="search__input" id="invSearch" type="search" placeholder="Search by email or name" value="${esc(inv.q)}"></div>
        <div class="findbar__filters">${select('invStatus', 'Status', INV_STATUS, inv.status)}${select('invSort', 'Order', INV_SORT, inv.sort)}</div>
      </div>
      ${list.length ? '' : `<div class="card__body">${H.emptyState({ icon: 'mail', title: 'No invitations here', msg: inv.q || inv.status !== 'any' ? 'Try another search or status.' : 'Add a member to send the first one.' })}</div>`}
      <div class="rows" data-testid="invitations-list">
        ${list.map((i) => {
          const status = M.statusOf(i);
          const open = status === 'pending' || status === 'expired';
          return `<div class="rowitem" data-testid="invitation-row" style="grid-template-columns:auto minmax(0,1fr) auto">
            <span class="rowitem__icon">${icon('mail', { size: 18 })}</span>
            <div style="min-width:0">
              <div class="rowitem__title">${esc(i.name || i.email)} ${H.chip(INV_LABEL[status], INV_TONE[status])}</div>
              ${i.name ? `<div class="rowitem__meta">${esc(i.email)}</div>` : ''}
              <div class="rowitem__meta">Invited by ${esc(i.invited_by)} · ${esc(H.fmtDate(i.created_at))}${i.sent_count > 1 ? ` · sent ${i.sent_count} times` : ''}${status === 'pending' ? ` · works until ${esc(H.fmtDate(i.expires_at))}` : ''}${i.accepted_at ? ` · accepted ${esc(H.fmtDate(i.accepted_at))}` : ''}</div>
              ${status === 'pending' ? `<div class="rowitem__meta">${DELIVERY[i.delivery] || esc(i.delivery)}${i.delivery_error ? ' · ' + esc(i.delivery_error) : ''}</div>` : ''}
            </div>
            <div class="rowitem__side row gap-2 wrap" style="justify-content:flex-end">
              ${i.member_id && S.member(i.member_id) ? `<a class="btn btn--secondary btn--sm" href="${R.href('/members/' + i.member_id)}">Open member<span class="sr-only"> ${esc(i.email)}</span></a>` : ''}
              ${open ? `<button class="btn btn--secondary btn--sm" type="button" data-resend="${i.id}" aria-label="Send the invitation to ${esc(i.email)} again">Send again</button>
                <button class="btn btn--danger-quiet btn--sm" type="button" data-revoke="${i.id}" aria-label="Withdraw the invitation to ${esc(i.email)}">Withdraw</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;

  const update = (id, fn) => S.set({ memberInvitations: S.get().memberInvitations.map((i) => (i.id === id ? fn({ ...i }) : i)) }, { silent: true });
  outlet.querySelector('[data-testid="add-member"]').addEventListener('click', () => M.invite(sent));
  outlet.querySelector('#invSearch').addEventListener('input', (e) => { inv.q = e.target.value; invitations(outlet); const el = outlet.querySelector('#invSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  outlet.querySelector('#invStatus').addEventListener('change', (e) => { inv.status = e.target.value; invitations(outlet); });
  outlet.querySelector('#invSort').addEventListener('change', (e) => { inv.sort = e.target.value; invitations(outlet); });
  outlet.querySelectorAll('[data-resend]').forEach((b) => b.addEventListener('click', () => H.busy(b, 'Sending…', () => {
    const invitation = all.find((i) => i.id === b.dataset.resend);
    const result = S.deliver(invitation.email);
    update(invitation.id, (i) => ({ ...i, sent_count: i.sent_count + 1, expires_at: new Date(Date.now() + 7 * M.DAY).toISOString(), delivery: result.status, delivery_error: result.detail }));
    S.audit('member_invitation.resent', 'member_invitation', invitation.id, { delivery: result.status });
    sent({ ...invitation, delivery: result.status, delivery_error: result.detail });
  })));
  outlet.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    const invitation = all.find((i) => i.id === b.dataset.revoke);
    const r = await UI.confirm({ title: 'Withdraw this invitation?', message: `The link sent to ${esc(invitation.email)} stops working.`, reversible: 'You can invite them again.', confirmLabel: 'Withdraw', danger: true });
    if (!r.ok) return;
    update(invitation.id, (i) => ({ ...i, revoked_at: S.now() }));
    S.audit('member_invitation.revoked', 'member_invitation', invitation.id, {});
    inv.notice = `The invitation to ${invitation.email} was withdrawn.`;
    invitations(outlet);
  }));
}

window.Veye.MEMBER_VIEWS = MEMBER_VIEWS;
window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.members = { render: directory };
window.Veye.screens['member-trends'] = { render: trends };
window.Veye.screens['member-invitations'] = { render: (outlet, route) => { inv = { q: '', status: 'any', sort: 'newest', notice: route.query.sent ? inv.notice : '' }; invitations(outlet); } };

})();
