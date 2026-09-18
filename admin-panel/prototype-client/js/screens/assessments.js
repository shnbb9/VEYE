/* ============================================================================
   Assessments & Scoring — the index
   ----------------------------------------------------------------------------
   v2 keeps all five instruments and removes almost everything else from the
   first screen. The unresolved-decision banner is now one status line that opens
   the full explanation in a drawer, and the questionnaire comparison table has
   moved behind "How scoring differs".

   The working model is unchanged: Edit → Preview and test → Save. No approval
   queue, no publisher, no draft-versus-live pair.
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
  const hn = st.healthNumber;

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: 'Assessments & Scoring',
      desc: 'Everything that turns a member’s answers into a number: the questions, their weights, the bands and the formulas.',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Assessments & Scoring' }],
      where: 'assessments',
      actions: `<button class="btn btn--secondary" id="compareBtn">${icon('columns', { size: 18 })} How scoring differs</button>`,
    })}

    <!-- The floor question was resolved by the client on 20 Aug 2026. -->
    <div class="statusstrip" style="--strip-tone:var(--status-positive)">
      <span class="statusstrip__icon">${icon('check-circle', { size: 18 })}</span>
      <span class="statusstrip__text"><b>No open scoring questions</b> — the Health Number floor was resolved to 1 on 20 Aug 2026.</span>
      <button class="btn btn--secondary btn--sm" id="openQ">Read the detail</button>
    </div>

    <div class="instruments">
      ${st.assessments.map((a) => `
        <a class="instr" href="${R.href('/assessments/' + a.key)}" style="text-decoration:none;color:inherit">
          <span class="instr__name">
            <span class="instr__icon">${icon(a.icon, { size: 20 })}</span>
            <span style="min-width:0">
              <span class="t-strong" style="font-size:var(--fs-card-title);display:block">${esc(a.name)}</span>
              <span class="instr__desc">${esc(a.desc)}</span>
            </span>
          </span>
          <span class="instr__versions">
            <span class="vslot vslot--live">
              <span class="vslot__label">In use</span>
              <span class="vslot__v">${esc(a.version)}</span>
              <span class="vslot__meta">since ${esc(a.updated)}</span>
            </span>
            <span class="vslot">
              <span class="vslot__label">Members scored</span>
              <span class="vslot__v">${H.n(a.members)}</span>
              <span class="vslot__meta">${a.warn ? 'One open question' : 'No open questions'}</span>
            </span>
          </span>
          <span class="btn btn--secondary btn--sm">Open</span>
        </a>`).join('')}
    </div>
  </div>`;

  outlet.querySelector('#openQ').addEventListener('click', () => {
    UI.drawer({
      eyebrow: 'Resolved by the client',
      title: 'The published floor is 1',
      desc: 'Resolved ' + (hn.floor ? hn.floor.resolved : '20 Aug 2026') + ' by Nile Site Health Number Interpretation and Formula.docx.',
      body: `<p style="font-size:15px;color:var(--text-body)">${esc(hn.floor ? hn.floor.note : 'The published minimum Health Number is 1.')}</p>
        <div class="notice notice--quiet" style="margin-top:16px">${icon('info', { size: 18 })}
          <div>Nothing in this console converts, rounds or re-derives the scale. The same change
          resolved Q5 (tired / poor focus) to 0.5 for Yes.</div></div>
        <div class="table-wrap" style="margin-top:16px"><table class="table table--compact">
          <caption class="sr-only">What the resolution means</caption>
          <thead><tr><th scope="col">Raw total</th><th scope="col">Published number</th>
            <th scope="col">Band shown</th></tr></thead>
          <tbody>
            <tr><th scope="row">−1 (all zeros + moderate or heavy exercise)</th><td>1.0</td><td>Good Health</td></tr>
            <tr><th scope="row">0 or 0.5</th><td>1.0</td><td>Good Health</td></tr>
            <tr><th scope="row">1 and above</th><td>Unchanged</td><td>By band</td></tr>
          </tbody></table></div>`,
      foot: `<a class="btn btn--primary" href="${R.href('/assessments/health-number')}">Open the Health Number</a>`,
    });
  });

  outlet.querySelector('#compareBtn').addEventListener('click', () => {
    UI.drawer({
      eyebrow: 'Assessments & Scoring',
      title: 'How scoring differs',
      desc: 'The three questionnaires are separate instruments with separate scoring and separate records.',
      body: `<div class="table-wrap"><table class="table">
          <caption class="sr-only">The three questionnaires compared</caption>
          <thead><tr><th scope="col">Instrument</th><th scope="col">Questions</th><th scope="col">Produces</th>
            <th scope="col">Direction</th></tr></thead>
          <tbody>
            <tr><th scope="row">Health Number</th><td>12, of which 9 score</td><td>0 to 10, one of four bands</td>
              <td>Lower is better</td></tr>
            <tr><th scope="row">Simple Health Quiz</th><td>8 yes/no</td><td>A count of Yes and No answers</td>
              <td>Fewer Yes is better</td></tr>
            <tr><th scope="row">Health Assessment</th><td>11, each scoring 1, 2 or 3</td><td>11 to 33, one of six bands</td>
              <td>Lower is better</td></tr>
          </tbody>
        </table></div>
        <div class="notice notice--quiet" style="margin-top:20px">${icon('info', { size: 18 })}
          <div>They are never combined, they each keep their own dated history, and the Simple Health Quiz
          never creates or changes a Health Number.</div></div>`,
    });
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.assessments = { render };

})();
