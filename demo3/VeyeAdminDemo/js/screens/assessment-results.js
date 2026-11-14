/* ============================================================================
   Assessments → one instrument's results
   ----------------------------------------------------------------------------
   The console's instrument page (platform/web app/admin/assessments/[key]):
   member, result, date and calculation version, searchable by member. Read
   only; the calculation itself is system managed. Only members who share
   their health records are listed — the same question Member 360 asks.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const H = window.Veye.H;
const esc = window.Veye.UI.esc;

const PAGE_SIZE = 25;
let state = { key: null, q: '', page: 1 };

function rows(key) {
  const needle = state.q.trim().toLowerCase();
  return S.get().members.filter(S.shares)
    .flatMap((m) => m.records[key].map((a) => ({ m, a })))
    .filter(({ m }) => !needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle))
    .sort((x, y) => (x.a.completed_at < y.a.completed_at ? 1 : -1));
}

function render(outlet, route) {
  const key = route.params.key;
  state = { key, q: '', page: 1 };   // a fresh visit starts with no search, as the console's does
  const instrument = window.Veye.instrument(key);

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: instrument ? instrument.name : 'Assessment', desc: instrument ? esc(instrument.description) : '',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Assessments', route: '/assessments' }, { label: instrument ? instrument.name : '…' }] })}
    ${instrument ? '' : H.errorbar('The results could not be loaded.')}
    ${instrument ? `<div class="kpis" style="margin-bottom:var(--s-5)">
      <div class="kpi"><span class="kpi__label">${icon('lock', { size: 16 })} Calculation</span><span class="kpi__value" style="font-size:20px">${esc(instrument.version)}</span><span class="kpi__note">${esc(instrument.calculation_owner)} · read-only</span></div>
      <div class="kpi"><span class="kpi__label">${icon('users', { size: 16 })} Members scored</span><span class="kpi__value">${instrument.members_scored}</span><span class="kpi__note">distinct members with a result</span></div>
      <div class="kpi"><span class="kpi__label">${icon('clipboard', { size: 16 })} Results saved</span><span class="kpi__value">${instrument.attempts_total}</span><span class="kpi__note">${instrument.last_completed_at ? 'latest ' + esc(H.fmtDate(instrument.last_completed_at)) : 'none yet'}</span></div>
    </div>` : ''}
    <div class="card">
      <div class="findbar">
        <div class="search" style="flex:1 1 260px;max-width:360px;position:relative">
          <span class="search__icon">${icon('search', { size: 18 })}</span>
          <label class="sr-only" for="aSearch">Search by member</label>
          <input class="search__input" id="aSearch" type="search" placeholder="Search by member name or email" value="${esc(state.q)}">
        </div>
      </div>
      <div id="aResults"></div>
    </div>
  </div>`;

  outlet.querySelector('#aSearch').addEventListener('input', (e) => { state.q = e.target.value; state.page = 1; paint(outlet, key, !!instrument); });
  paint(outlet, key, !!instrument);
}

function paint(outlet, key, known) {
  const host = outlet.querySelector('#aResults');
  if (!known) { host.innerHTML = ''; return; }
  const all = rows(key);
  if (!all.length) { host.innerHTML = `<p class="empty-row">No results${state.q ? ' match that search' : ' saved yet'}.</p>`; return; }
  const page = all.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  host.innerHTML = `
    <div class="table-wrap table-wrap--sticky">
      <table class="table table--rows" data-testid="attempts-table">
        <thead><tr><th scope="col">Member</th><th scope="col">Result</th><th scope="col">Date</th><th scope="col" data-col-priority="low">Calculation version</th><th scope="col"><span class="sr-only">Open</span></th></tr></thead>
        <tbody>
          ${page.map(({ m, a }) => `<tr>
            <td><div class="cell-primary">${esc(m.name)}</div><div class="cell-sub">${esc(m.email)}</div></td>
            <td>${esc(window.Veye.resultSummary(key, a))}</td>
            <td>${esc(H.fmtDate(a.completed_at))}</td>
            <td data-col-priority="low" class="mono">${esc(a.calculation_version)}</td>
            <td style="text-align:right"><a class="btn btn--secondary btn--sm" href="${R.href('/members/' + m.id + '/assessments')}">Member 360</a></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="pager__info">Showing ${page.length} of ${all.length} results</span>
      ${all.length > PAGE_SIZE ? `<span class="row gap-2">
        <button class="btn btn--ghost btn--sm" type="button" id="prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
        <button class="btn btn--ghost btn--sm" type="button" id="next" ${state.page * PAGE_SIZE >= all.length ? 'disabled' : ''}>Next</button>
      </span>` : ''}
    </div>`;
  const prev = host.querySelector('#prev');
  if (prev) prev.addEventListener('click', () => { state.page -= 1; paint(outlet, key, true); });
  const next = host.querySelector('#next');
  if (next) next.addEventListener('click', () => { state.page += 1; paint(outlet, key, true); });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens['assessment-results'] = { render };

})();
