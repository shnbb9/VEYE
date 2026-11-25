/* ============================================================================
   Assessments
   ----------------------------------------------------------------------------
   The console's Assessments (platform/web app/admin/assessments): the five
   instruments with their pinned calculation version, members scored and
   results saved. The calculation logic is SYSTEM MANAGED — weights, bands and
   formulas are not editable anywhere in this console, and no administrator
   can edit a stored result.

   Counts include only members who share their health records: one result on
   a row is still that member's record, and a list of every attempt would be
   the easiest way to read around Member 360.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const H = window.Veye.H;
const esc = window.Veye.UI.esc;

const INSTRUMENTS = [
  { key: 'health_number', name: 'Health Number', version: '1.5.0',
    description: '12 questions; 1–10, lower is better; four bands. Onboarding and the dedicated My Progress assessment.' },
  { key: 'body_composition', name: 'Body Composition', version: '1.0.0',
    description: "Standard BMI plus the client's body-fat tables (female constants, male lookup). Unsupported combinations report not available." },
  { key: 'blood_markers', name: 'Blood Markers', version: '1.0.0',
    description: "TG/HDL, HOMA-IR, AA/EPA and HbA1c with goal flags; supplement suggestion by the client's table." },
  { key: 'health_assessment', name: 'Health Assessment', version: 'health-assessment-2026-08-25-v2',
    description: '11 questions scoring 1–3; total 11–33, lower is better; six bands; EPA/DHA suggestion by score.' },
  { key: 'simple_quiz', name: 'Simple Quiz', version: 'simple-quiz-2026-08-20-v1',
    description: '8 yes/no questions; a dated count. Never creates or changes a Health Number.' },
];
const ICONS = { health_number: 'activity', body_composition: 'users', blood_markers: 'clipboard', health_assessment: 'file-text', simple_quiz: 'check-circle' };

/** One instrument with its counts, over sharing members only. */
function instrument(key) {
  const def = INSTRUMENTS.find((i) => i.key === key);
  if (!def) return null;
  const allowed = S.get().members.filter(S.shares);
  const attempts = allowed.flatMap((m) => m.records[key]);
  const last = attempts.map((a) => a.completed_at).sort().pop() || null;
  return { ...def, calculation_owner: 'System managed', attempts_total: attempts.length,
    members_scored: allowed.filter((m) => m.records[key].length).length, last_completed_at: last,
    starts: S.get().assessmentStarts[key][0], unfinished: S.get().assessmentStarts[key][1] };
}

let compare = false;

function render(outlet) {
  const list = INSTRUMENTS.map((i) => instrument(i.key));
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Assessments',
      desc: "Everything that turns a member's answers into a number, and every result it has produced. Questions, weights, bands and formulas are system managed and read-only here.",
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Assessments' }],
      actions: '<button class="btn btn--secondary" type="button" id="compareBtn">How scoring differs</button>' })}

    <div class="statusstrip" style="--strip-tone:var(--status-positive)">
      <span class="statusstrip__icon">${icon('lock', { size: 18 })}</span>
      <span class="statusstrip__text"><b>System managed</b> — deterministic calculations with pinned versions. Historical results are never re-scored, and no administrator can edit a stored result.</span>
    </div>

    ${compare ? `<div class="card" style="margin-bottom:var(--s-5)">
      <div class="card__head"><div><h2 class="card__title">How scoring differs</h2><p class="t-support">The three questionnaires are separate instruments with separate scoring and separate records.</p></div></div>
      <div class="card__body card__body--flush">
        <div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Instrument</th><th scope="col">Questions</th><th scope="col">Produces</th><th scope="col">Direction</th></tr></thead>
          <tbody>
            <tr><th scope="row">Health Number</th><td>12, of which 9 score</td><td>1 to 10, one of four bands</td><td>Lower is better</td></tr>
            <tr><th scope="row">Simple Quiz</th><td>8 yes/no</td><td>A count of Yes and No answers</td><td>Fewer Yes is better</td></tr>
            <tr><th scope="row">Health Assessment</th><td>11, each scoring 1, 2 or 3</td><td>11 to 33, one of six bands</td><td>Lower is better</td></tr>
          </tbody>
        </table></div>
      </div>
      <div class="card__foot"><span class="t-support">They are never combined, each keeps its own dated history, and the Simple Quiz never creates or changes a Health Number.</span></div>
    </div>` : ''}

    <div class="instruments" data-testid="instruments">
      ${list.map((i) => `<a class="instr instr--three" href="${R.href('/assessments/' + i.key)}" style="text-decoration:none;color:inherit">
        <span class="instr__name">
          <span class="instr__icon">${icon(ICONS[i.key] || 'clipboard', { size: 20 })}</span>
          <span style="min-width:0">
            <span class="t-strong" style="font-size:var(--fs-card-title);display:block">${esc(i.name)}</span>
            <span class="instr__desc">${esc(i.description)}</span>
          </span>
        </span>
        <span class="instr__versions instr__versions--three">
          <span class="vslot vslot--live">
            <span class="vslot__label">Calculation</span>
            <span class="vslot__v">${esc(i.version)}</span>
            <span class="vslot__meta">${esc(i.calculation_owner)}</span>
          </span>
          <span class="vslot">
            <span class="vslot__label">Members scored</span>
            <span class="vslot__v">${i.members_scored}</span>
            <span class="vslot__meta">${i.attempts_total} result${i.attempts_total === 1 ? '' : 's'}${i.last_completed_at ? ' · last ' + esc(H.fmtDate(i.last_completed_at)) : ''}</span>
          </span>
          <span class="vslot" data-testid="unfinished-${i.key}">
            <span class="vslot__label">Started, not finished</span>
            <span class="vslot__v">${i.unfinished}</span>
            <span class="vslot__meta">of ${i.starts} started</span>
          </span>
        </span>
        <span class="btn btn--secondary btn--sm">Open</span>
      </a>`).join('')}
    </div>
  </div>`;

  outlet.querySelector('#compareBtn').addEventListener('click', () => { compare = !compare; render(outlet); });
}

window.Veye.instrument = instrument;
window.Veye.INSTRUMENTS = INSTRUMENTS;
window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.assessments = { render: (outlet) => { compare = false; render(outlet); } };

})();
