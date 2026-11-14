/* ============================================================================
   Members → Prospects
   ----------------------------------------------------------------------------
   The console's Prospects view (platform/web app/admin/members/prospects):
   visitors who saved an assessment result without signing up. Metadata only —
   the address masked, the status, when it was saved and until when. The
   answers and the Health Number are not shown to anyone in the console:
   agreeing to storage is not agreeing to be read. A prospect cannot be asked
   to share health data either; that becomes possible only after sign-up and
   email verification, from Member 360.

   Search matches a WHOLE address only, as the API's does: a prefix search over
   people who never signed up would make this list a way to discover them.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const STATUS_LABELS = { unverified: 'Unverified prospect', verified: 'Verified prospect', pending_claim: 'Pending claim',
  claimed: 'Registered member', expired: 'Expired', erased: 'Deleted' };
const ACTIVE = ['unverified', 'verified', 'pending_claim'];
const STATUS_OPTIONS = [['', 'Any status'], ['active', 'Not registered (active)'], ['unverified', 'Unverified prospect'], ['verified', 'Verified prospect'],
  ['pending_claim', 'Pending claim'], ['claimed', 'Registered member'], ['expired', 'Expired'], ['erased', 'Deleted']];
const SORTS = [['captured_desc', 'Newest first'], ['captured_asc', 'Oldest first'], ['expires_asc', 'Expiring soonest']];
const TONES = { unverified: 'draft', verified: 'info', pending_claim: 'attention', claimed: 'live', expired: 'archived', erased: 'archived' };
const EVENT_LABELS = {
  captured: 'Saved by the visitor', email_verified: 'Address confirmed from its mailbox',
  linked_at_signup: 'Linked to a new account, waiting for the address to be proven', claimed: "Added to the member's own record",
  purged: 'Retention elapsed; answers and address removed', erased: 'Deleted', link_resent: 'A new link was sent',
  retention_shortened: 'Expiry moved earlier by a shorter retention policy',
};
const SHARING_NOTE = 'Sharing is available after sign-up and email verification.';
const PAGE_SIZE = 25;

/* ------------------------------------------------------------ shared rules */
const expired = (p) => !!p.expires_at && Date.parse(p.expires_at) <= Date.now();
/** What the record is now, even if the cleanup has not caught up. */
const effective = (p) => (ACTIVE.includes(p.status) && expired(p) ? 'expired' : p.status);
function mask(email) {
  if (!email || !email.includes('@')) return '—';
  const [local, domain] = email.split('@');
  return `${local.length > 2 ? local.slice(0, 2) : local.slice(0, 1)}•••@${domain}`;
}
function retentionLabel(p) {
  if (p.retention_mode === 'forever') return 'Until deleted';
  return p.retention_days ? `${p.retention_days} days` : '—';
}
/** The policy's own label (app/prospects/retention.py). */
function policyLabel(policy) {
  if (policy.mode === 'never') return 'Never (preview only, nothing saved)';
  if (policy.mode === 'forever') return 'Forever (until deleted)';
  return `${policy.days} days`;
}
function counts() {
  const rows = S.get().prospects;
  const now = Date.now();
  const awaiting = rows.filter((p) => ACTIVE.includes(p.status) && expired(p)).length;
  const by = (s) => rows.filter((p) => p.status === s).length;
  return {
    unregistered: rows.filter((p) => ACTIVE.includes(p.status)).length - awaiting,
    unverified: by('unverified'), verified: by('verified'), pending_claim: by('pending_claim'), registered: by('claimed'),
    expired: by('expired') + awaiting, deleted: by('erased'),
    expiring_within_7_days: rows.filter((p) => ACTIVE.includes(p.status) && p.expires_at && Date.parse(p.expires_at) > now && Date.parse(p.expires_at) <= now + 7 * 864e5).length,
    awaiting_purge: awaiting,
  };
}
function keptUntil(p) {
  const s = effective(p);
  if (s === 'claimed') return '<span class="t-muted">In the member’s own record</span>';
  if (s === 'erased') return '<span class="t-muted">Deleted</span>';
  if (s === 'expired') return '<span class="t-muted">Expired</span>';
  if (!p.expires_at) return 'Until deleted';
  return esc(H.fmtDate(p.expires_at));
}
const savingEnabled = () => S.get().retention.mode !== 'never' && S.get().retention.encryption_ready;

/* ---------------------------------------------------------------- screen */
let query = { q: '', status: '', sort: 'captured_desc', page: 1 };
let notice = '';

function list() {
  let rows = S.get().prospects.slice();
  if (query.status === 'active') rows = rows.filter((p) => ACTIVE.includes(p.status) && !expired(p));
  else if (query.status === 'expired') rows = rows.filter((p) => p.status === 'expired' || (ACTIVE.includes(p.status) && expired(p)));
  else if (query.status) rows = rows.filter((p) => p.status === query.status && !(ACTIVE.includes(p.status) && expired(p)));
  const q = query.q.trim().toLowerCase();
  if (q) rows = rows.filter((p) => p.email && p.email.toLowerCase() === q);
  const order = {
    captured_asc: (a, b) => (a.captured_at < b.captured_at ? -1 : 1),
    expires_asc: (a, b) => (a.expires_at === b.expires_at ? 0 : !a.expires_at ? 1 : !b.expires_at ? -1 : a.expires_at < b.expires_at ? -1 : 1),
  }[query.sort] || ((a, b) => (a.captured_at < b.captured_at ? 1 : -1));
  return rows.sort(order);
}

function render(outlet) {
  const c = counts();
  const policy = S.get().retention;
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Prospects', crumbs: [{ label: 'Home', route: '/home' }, { label: 'Members', route: '/members' }, { label: 'Prospects' }],
      desc: 'Visitors who saved their assessment result without signing up. You see when and until when — never their answers or their Health Number.' })}
    ${H.subnav(window.Veye.MEMBER_VIEWS, 'prospects')}
    ${notice ? `<p class="t-support" role="status" data-testid="prospects-notice">${esc(notice)}</p>` : ''}

    <div class="minirow" data-testid="prospects-counts">
      <div class="mini"><span class="mini__n">${c.unregistered}</span><span class="mini__l">Not registered</span></div>
      <div class="mini"><span class="mini__n">${c.pending_claim}</span><span class="mini__l">Pending claim</span></div>
      <div class="mini"><span class="mini__n">${c.registered}</span><span class="mini__l">Registered</span></div>
      <div class="mini"><span class="mini__n">${c.expired}</span><span class="mini__l">Expired</span></div>
      <div class="mini"><span class="mini__n">${c.deleted}</span><span class="mini__l">Deleted</span></div>
    </div>

    <div class="notice${savingEnabled() ? ' notice--quiet' : ''}" data-testid="prospects-policy">
      ${icon('shield', { size: 18 })}
      <div>
        ${savingEnabled()
          ? `Visitors can save a result for <strong>${esc(policyLabel(policy))}</strong>.`
          : `Saving is <strong>off</strong> (${esc(policyLabel(policy))}): the result gate shows the number without storing anything.`}
        Change it in <a href="${R.href('/settings/product?focus=privacy-prospects')}">Settings → Product settings → Privacy &amp; prospects</a>.
        ${c.expiring_within_7_days ? ` ${c.expiring_within_7_days} saved result(s) expire within 7 days.` : ''}
      </div>
    </div>

    <div class="card">
      <div class="findbar">
        <div class="search" style="flex:1 1 260px;max-width:360px;position:relative">
          <span class="search__icon">${icon('search', { size: 18 })}</span>
          <label class="sr-only" for="pSearch">Find by full email address</label>
          <input class="search__input" id="pSearch" type="search" placeholder="Full email address" value="${esc(query.q)}" data-testid="prospects-search">
        </div>
        <div class="findbar__filters">
          <div class="field" style="margin:0">
            <label class="sr-only" for="pStatus">Status</label>
            <select class="select input--sm" id="pStatus" data-testid="prospects-status">
              ${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === query.status ? 'selected' : ''}>${esc(l)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin:0">
            <label class="sr-only" for="pSort">Sort</label>
            <select class="select input--sm" id="pSort" data-testid="prospects-sort">
              ${SORTS.map(([v, l]) => `<option value="${v}" ${v === query.sort ? 'selected' : ''}>${esc(l)}</option>`).join('')}
            </select>
          </div>
        </div>
        <span class="findbar__spacer"></span>
        <span class="t-support">Search matches a whole address only.</span>
      </div>
      <div id="pResults"></div>
    </div>
  </div>`;

  const set = (patch) => { query = { ...query, ...patch, page: 1 }; paint(outlet); };
  outlet.querySelector('#pSearch').addEventListener('input', (e) => set({ q: e.target.value }));
  outlet.querySelector('#pStatus').addEventListener('change', (e) => set({ status: e.target.value }));
  outlet.querySelector('#pSort').addEventListener('change', (e) => set({ sort: e.target.value }));
  paint(outlet);
}

function paint(outlet) {
  const host = outlet.querySelector('#pResults');
  const all = list();
  if (!all.length) {
    host.innerHTML = `<div class="card__body">${H.emptyState({ icon: 'users',
      title: query.q || query.status ? 'No saved results match' : 'No saved results yet',
      msg: savingEnabled() ? 'A visitor appears here after ticking the box to save their result.'
        : "Saving is switched off, so visitors' results are shown to them and not stored." })}</div>`;
    return;
  }
  const rows = all.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE);
  host.innerHTML = `
    <div class="table-wrap table-wrap--sticky">
      <table class="table table--rows" data-testid="prospects-table">
        <caption class="sr-only">Prospects, ${rows.length} of ${all.length} shown</caption>
        <thead><tr>
          <th scope="col">Saved by</th>
          <th scope="col">Status</th>
          <th scope="col" data-col-priority="medium">Saved</th>
          <th scope="col">Kept until</th>
          <th scope="col" data-col-priority="low">Registered as</th>
          <th scope="col"><span class="sr-only">Details</span></th>
        </tr></thead>
        <tbody>
          ${rows.map((p) => {
            const s = effective(p);
            const m = p.registered_member_id ? S.member(p.registered_member_id) : null;
            return `<tr data-testid="prospect-row">
              <td><div class="cell-primary">${esc(mask(p.email))}</div><div class="cell-sub">${p.email_verified ? 'Address confirmed' : 'Address not confirmed'}</div></td>
              <td style="white-space:nowrap">${H.chip(STATUS_LABELS[s], TONES[s])}</td>
              <td data-col-priority="medium">${esc(H.fmtDate(p.captured_at))}</td>
              <td>${keptUntil(p)}</td>
              <td data-col-priority="low">${s === 'claimed' && m ? `<a href="${R.href('/members/' + m.id)}">${esc(m.name)}</a>` : '<span class="t-muted">—</span>'}</td>
              <td style="text-align:right"><button class="btn btn--secondary btn--sm" type="button" data-open="${p.id}" data-testid="prospect-open">Details<span class="sr-only"> for ${esc(mask(p.email))}</span></button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="pager__info">Showing ${rows.length} of ${all.length}</span>
      <span class="t-support">${SHARING_NOTE}</span>
    </div>`;
  host.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.open, outlet)));
}

function openDrawer(id, outlet) {
  const p = S.get().prospects.find((x) => x.id === id);
  if (!p) return;
  const s = effective(p);
  const removable = !['erased', 'expired', 'claimed'].includes(s);
  const ref = UI.drawer({
    eyebrow: 'Prospects',
    title: esc(mask(p.email)),
    desc: 'What happened to this saved result. Its answers and Health Number are not shown to anyone in the console.',
    body: `<div class="stack gap-4" data-testid="prospect-detail">
      <dl class="facts">
        <div class="fact"><dt>Status</dt><dd>${H.chip(STATUS_LABELS[s], TONES[s])}</dd></div>
        <div class="fact"><dt>Saved</dt><dd>${esc(H.fmtDate(p.captured_at))}</dd></div>
        <div class="fact"><dt>Kept until</dt><dd>${keptUntil(p)}</dd></div>
        <div class="fact"><dt>Retention agreed</dt><dd>${esc(retentionLabel(p))} (policy v${p.retention_policy_version})</dd></div>
        <div class="fact"><dt>Notice agreed to</dt><dd class="mono">${esc(p.consent_version)}</dd></div>
        <div class="fact"><dt>Health data sharing</dt><dd>${SHARING_NOTE}</dd></div>
      </dl>
      <div>
        <div class="t-eyebrow">History</div>
        <ol class="rows" data-testid="prospect-events">
          ${p.events.map((e) => `<li class="rowitem">
            <span class="rowitem__icon">${icon('activity', { size: 16 })}</span>
            <div><div class="rowitem__title">${esc(EVENT_LABELS[e.event_type] || e.event_type)}</div><div class="rowitem__meta">${esc(H.fmtDate(e.at))} · ${esc(e.actor_type)}</div></div>
          </li>`).join('')}
        </ol>
      </div>
      <form class="stack gap-3" id="eraseForm" method="post" hidden>
        <p class="t-support">Deleting removes the sealed answers, the result and the address now. Only the fact that a record existed stays, without anything that identifies the visitor. This cannot be undone.</p>
        <div class="field">
          <label class="field__label" for="eraseReason">Why (optional, kept in the audit log)</label>
          <input class="input" id="eraseReason" maxlength="200" placeholder="e.g. Asked by phone on 14 Nov">
        </div>
        <div class="row gap-2">
          <button class="btn btn--danger" type="submit" id="eraseConfirm" data-testid="prospect-erase-confirm">Delete permanently</button>
          <button class="btn btn--ghost" type="button" id="eraseCancel">Cancel</button>
        </div>
      </form>
    </div>`,
    foot: `${removable ? '<button class="btn btn--danger-quiet" type="button" id="eraseOpen" data-testid="prospect-erase-open">Delete this saved result</button>' : ''}
      <button class="btn btn--ghost" type="button" id="drawerClose">Close</button>`,
    onMount: (r) => {
      const form = r.el.querySelector('#eraseForm');
      const openBtn = r.el.querySelector('#eraseOpen');
      r.el.querySelector('#drawerClose').addEventListener('click', () => r.close());
      if (openBtn) openBtn.addEventListener('click', () => { form.hidden = false; openBtn.hidden = true; r.el.querySelector('#eraseReason').focus(); });
      r.el.querySelector('#eraseCancel').addEventListener('click', () => { form.hidden = true; if (openBtn) openBtn.hidden = false; });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const reason = r.el.querySelector('#eraseReason').value.trim();
        H.busy(r.el.querySelector('#eraseConfirm'), 'Deleting…', () => {
          const at = S.now();
          // Removes the address with the result: only the fact of the record stays.
          S.set({ prospects: S.get().prospects.map((x) => (x.id === id ? { ...x, status: 'erased', erased_at: at, email: null,
            events: [...x.events, { event_type: 'erased', actor_type: 'administrator', at, policy_version: null }] } : x)) });
          S.audit('prospect.erased', 'prospect', id, reason ? { reason: reason.slice(0, 200) } : { reason: '' });
          notice = 'The saved result from that visitor was deleted.';
          r.close();
          render(outlet);
        });
      });
    },
  });
  return ref;
}

window.Veye.prospects = { STATUS_LABELS, ACTIVE, counts, effective, policyLabel, expired };
window.Veye.screens = window.Veye.screens || {};
/* Arriving at the screen starts without a notice; the erase handler re-renders
   internally so its own notice survives that one paint. */
window.Veye.screens.prospects = { render: (outlet) => { notice = ''; render(outlet); } };

})();
