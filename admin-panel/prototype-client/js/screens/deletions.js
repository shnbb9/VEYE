/* ============================================================================
   Members → Deletions
   ----------------------------------------------------------------------------
   The console's Deletions view (platform/web app/admin/members/deletions):
   members who deleted their own member profile. Oversight only — ids, states
   and dates, never what was removed. The console cannot start a deletion for
   a member, cannot pause or undo one, and can only retry one that stopped on
   an error. Deletion is not deactivation: access closed the moment the member
   asked, and it never reopens.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const S = window.Veye.S;
const H = window.Veye.H;
const esc = window.Veye.UI.esc;

const STATE_LABELS = {
  requested: 'Requested',
  access_closed: 'Access closed, deletion queued',
  purging: 'Deleting',
  purge_blocked: 'Deletion paused after an error — it will be retried',
  erased: 'Deleted',
};
const TONE = { erased: 'live', purge_blocked: 'attention', purging: 'draft', access_closed: 'draft', requested: 'draft' };

let error = '';

function render(outlet) {
  const rows = [...S.get().erasures].sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1));
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Deletions', crumbs: [{ label: 'Home', route: '/home' }, { label: 'Members', route: '/members' }, { label: 'Deletions' }],
      desc: 'Members who deleted their member profile. You see that it happened and whether it finished — never what was removed.' })}
    ${H.subnav(window.Veye.MEMBER_VIEWS, 'deletions')}
    ${H.errorbar(error)}
    <div class="card">
      ${rows.length === 0 ? `<div class="card__body">${H.emptyState({ icon: 'shield', title: 'No deletions',
        msg: 'When a member deletes their profile from Settings, it is listed here.' })}</div>` : `
      <div class="table-wrap"><table class="table table--rows" data-testid="deletions-table">
        <caption class="sr-only">Deletion requests</caption>
        <thead><tr>
          <th scope="col">Reference</th><th scope="col">Scope</th><th scope="col">State</th>
          <th scope="col" data-col-priority="medium">Requested</th><th scope="col" data-col-priority="low">Finished</th>
          <th scope="col"><span class="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `<tr data-testid="deletion-row">
            <td class="mono">${esc(r.request_id.slice(0, 8))}…</td>
            <td>${r.scope === 'member_data' ? 'Member data (console access kept)' : 'Member profile and account'}</td>
            <td>${H.chip(STATE_LABELS[r.state] || r.state, TONE[r.state])}
              ${r.failure_category ? `<div class="cell-sub">Stopped at ${esc(r.failure_category)} (attempt ${r.attempts})</div>` : ''}</td>
            <td data-col-priority="medium">${esc(H.fmtDate(r.requested_at))}</td>
            <td data-col-priority="low">${r.completed_at ? esc(H.fmtDate(r.completed_at)) : '<span class="t-muted">—</span>'}</td>
            <td style="text-align:right">${r.state === 'purge_blocked'
              ? `<button class="btn btn--secondary btn--sm" type="button" data-retry="${r.request_id}" data-testid="deletion-retry">Retry</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>
  </div>`;

  outlet.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => {
    outlet.querySelectorAll('[data-retry]').forEach((x) => { x.disabled = true; });
    b.textContent = 'Retrying…';
    const id = b.dataset.retry;
    setTimeout(() => {
      // The retry resumes after the last stage that finished; this time the
      // object store answers, the purge completes and the receipt is queued.
      const at = S.now();
      S.set({ erasures: S.get().erasures.map((r) => (r.request_id === id
        ? { ...r, state: 'erased', completed_at: at, attempts: r.attempts + 1, failure_category: null, stage: 'receipt_queued' } : r)) });
      S.audit('erasure.retried', 'erasure_request', id, { from_state: 'purge_blocked' });
      error = '';
      render(outlet);
    }, 650);
  }));
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.deletions = { render: (outlet) => { error = ''; render(outlet); } };

})();
