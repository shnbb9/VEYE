/* ============================================================================
   Assessments & Scoring — the instrument editors
   ----------------------------------------------------------------------------
   v2 splits each editor into inner panels so only one section is visible at a
   time. The Health Number was the worst density problem in v1: twelve questions,
   every answer chip for all of them, four bands with their full member wording,
   version history and source notes, all in one scroll.

   Health Number:  Questions · Scoring & Bands · Preview & Test · History
   Each other instrument gets the panels its content actually needs.

   Preview and Save sit in a sticky bar so they are reachable from any panel.

   Every weight, band and formula is transcribed from the canonical consumer
   engine. Nothing on this screen re-derives a number.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const KEYS = {
  'health-number': {
    name: 'Health Number', store: 'healthNumber',
    panels: [
      { key: 'questions', label: 'Questions' },
      { key: 'scoring', label: 'Scoring reference' },
      { key: 'test', label: 'Preview & Test' },
      { key: 'history', label: 'History' },
    ],
  },
  'simple-quiz': {
    name: 'Simple Health Quiz', store: 'simpleQuiz',
    panels: [
      { key: 'questions', label: 'Questions' },
      { key: 'test', label: 'Preview & Test' },
      { key: 'history', label: 'History' },
    ],
  },
  'status-report': {
    /* Renamed for members on 20 Aug 2026; the stored key stays. */
    name: 'Health Assessment', store: 'statusReport',
    panels: [
      { key: 'scoring', label: 'Scoring & Bands' },
      { key: 'supplements', label: 'Supplement rows' },
      { key: 'test', label: 'Preview & Test' },
      { key: 'history', label: 'History' },
    ],
  },
  markers: {
    name: 'Blood markers and ratios', store: 'markersMeta',
    panels: [
      { key: 'markers', label: 'Markers' },
      { key: 'ratios', label: 'Ratios & formulas' },
      { key: 'test', label: 'Preview & Test' },
      { key: 'history', label: 'History' },
    ],
  },
  'body-composition': {
    name: 'BMI and body composition', store: 'bodyComposition',
    panels: [
      { key: 'definitions', label: 'Definitions' },
      { key: 'test', label: 'Preview & Test' },
      { key: 'history', label: 'History' },
    ],
  },
};

function render(outlet, route) {
  const key = route.params.key;
  const meta = KEYS[key];

  if (!meta) {
    outlet.innerHTML = `<div class="page">
      ${H.pageHead({ title: 'That instrument was not found',
        crumbs: [{ label: 'Home', route: '/home' }, { label: 'Assessments & Scoring', route: '/assessments' }, { label: 'Not found' }],
        desc: `There is no instrument called <code>${esc(key)}</code>.` })}
      <div class="card"><div class="card__body">${H.emptyState({
        icon: 'clipboard', title: 'Five instruments are available',
        msg: 'The Health Number, the Simple Health Quiz, the Health Assessment, blood markers and body composition.',
        action: `<a class="btn btn--primary" href="${R.href('/assessments')}">Back to Assessments &amp; Scoring</a>`,
      })}</div></div></div>`;
    return;
  }

  const panel = route.params.panel || meta.panels[0].key;
  if (!meta.panels.some((p) => p.key === panel)) {
    outlet.innerHTML = `<div class="page">
      ${H.pageHead({ title: meta.name,
        crumbs: [{ label: 'Home', route: '/home' }, { label: 'Assessments & Scoring', route: '/assessments' }, { label: meta.name }],
        desc: `This editor has no section called <code>${esc(panel)}</code>.` })}
      ${H.subnav(meta.panels.map((p) => ({ ...p, route: '/assessments/' + key + '/' + p.key })), null)}
      <div class="card"><div class="card__body">${H.emptyState({
        icon: 'compass', title: 'Pick a section above',
        msg: meta.panels.map((p) => p.label).join(', ') + '.',
        action: `<a class="btn btn--primary" href="${R.href('/assessments/' + key + '/' + meta.panels[0].key)}">Open ${esc(meta.panels[0].label)}</a>`,
      })}</div></div></div>`;
    return;
  }

  const st = S.get();
  const inst = st[meta.store];
  const listed = st.assessments.find((a) => a.key === key);

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: meta.name,
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Assessments & Scoring', route: '/assessments' }, { label: meta.name }],
      desc: esc(listed ? listed.desc : ''),
      where: 'assessments',
      meta: `<span>${esc(inst.version)}</span> <span>In use since ${esc(inst.effective)}</span>
             <span>${H.n(inst.membersScored)} members scored</span>
             <span>Source: ${esc(inst.source)}</span>`,
    })}

    ${key === 'health-number' ? `<div class="statusstrip statusstrip--sm" style="--strip-tone:var(--status-positive)">
      <span class="statusstrip__icon">${icon('check-circle', { size: 18 })}</span>
      <span class="statusstrip__text"><b>Floor resolved (20 Aug 2026)</b> — the published minimum is 1. A raw
        total below 1 shows as 1 on every member screen.</span>
      <button class="btn btn--ghost btn--sm" id="floorBtn">Detail</button>
    </div>` : ''}

    ${H.subnav(meta.panels.map((p) => ({ ...p, route: '/assessments/' + key + '/' + p.key })), panel)}

    <div id="editorBody"></div>

    <!-- One action bar, reachable from every panel, rather than a Save button
         that scrolls away with whatever section happens to be open. -->
    <div class="actionbar">
      <span class="actionbar__note" id="dirtyNote">All changes saved.</span>
      <button class="btn btn--secondary" id="testBtn">${icon('play', { size: 18 })} Preview and test</button>
      ${key === 'health-number' ? '<span class="chip chip--info">System-managed</span>' : `<button class="btn btn--primary" id="saveBtn">${icon('save', { size: 18 })} Save changes</button>`}
    </div>
  </div>`;

  const body = outlet.querySelector('#editorBody');
  PANELS[key][panel](body, inst, key);

  const floor = outlet.querySelector('#floorBtn');
  if (floor) floor.addEventListener('click', () => openFloor(inst));

  outlet.querySelector('#testBtn').addEventListener('click', () => test(key, S.get()[meta.store]));
  const saveButton = outlet.querySelector('#saveBtn');
  if (saveButton) saveButton.addEventListener('click', (e) => {
    H.withSaving(e.currentTarget, () => {
      S.clearDirty();
      S.note('Saved ' + meta.name);
      const note = outlet.querySelector('#dirtyNote');
      if (note) { note.textContent = 'All changes saved.'; note.classList.remove('is-dirty'); }
      UI.toast({ title: 'Saved', message: meta.name + ' is updated. In production, members would see it from their next assessment. Prototype: saved in this browser only.' });
    });
  });

  if (S.isDirty()) markDirty(outlet);
}

function markDirty(outlet) {
  const note = (outlet || document).querySelector('#dirtyNote');
  if (note) { note.textContent = 'Unsaved changes.'; note.classList.add('is-dirty'); }
}

function openFloor(inst) {
  UI.drawer({
    eyebrow: 'Resolved by the client',
    title: 'The published floor is 1',
    desc: 'Resolved ' + (inst.floor ? inst.floor.resolved : '20 Aug 2026') + ' by Nile Site Health Number Interpretation and Formula.docx.',
    body: `<p style="font-size:15px;color:var(--text-body)">${esc(inst.floor ? inst.floor.note : 'The published minimum Health Number is 1.')}</p>
      <div class="notice notice--quiet" style="margin-top:16px">${icon('info', { size: 18 })}
        <div>Nothing in this console converts, rounds or re-derives the scale. The ceiling stays 10 and lower remains healthier.</div></div>`,
  });
}

/* =========================================================================
   HEALTH NUMBER
   ========================================================================= */

function hnQuestions(host, inst) {
  const scored = inst.questions.filter((q) => q.scored);

  host.innerHTML = `
    <div class="card">
      <div class="card__head">
        <div><h2 class="card__title">Questions</h2>
          <p class="t-support">${inst.questions.length} questions, of which ${scored.length} carry points.
            ${inst.questions.length - scored.length} exist to personalise the plan and score zero.</p></div>
      </div>
      <div class="card__body card__body--flush">
        <!-- One collapsed row per question. v1 printed every answer chip for all
             twelve at once, which was most of the length of this screen. -->
        <div class="qlist">
          ${inst.questions.map((q, i) => `
            <div class="qrow2">
              <span class="qrow2__n">${q.id}</span>
              <div class="qrow2__main">
                <div class="qrow2__q">${esc(q.text)}
                  ${q.onboardingOnly ? '<span class="chip chip--info chip--sm">Onboarding only</span>' : ''}</div>
                <div class="qrow2__meta">
                  <span class="tag">${q.group ? esc(q.group) : 'Not scored'}</span>
                  <span>${q.options.length} answer${q.options.length === 1 ? '' : 's'}</span>
                  <span>${esc(q.type)}</span>
                  <span>${q.scored ? weightRange(q) : 'No points'}</span>
                </div>
              </div>
              <button class="btn btn--secondary btn--sm" data-q="${i}">View<span class="sr-only"> ${esc(q.id)}</span></button>
            </div>`).join('')}
        </div>
      </div>
      <div class="card__foot">
        <span class="t-support">Answer wording is the scoring key. Renaming one here without renaming it in the
          member questionnaire would score that answer zero.</span>
      </div>
    </div>`;

  host.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    editQuestion(inst.questions[+b.dataset.q]);
  }));
}

function weightRange(q) {
  const pts = q.options.map((o) => o.points);
  const lo = Math.min(...pts), hi = Math.max(...pts);
  return lo === hi ? `${lo > 0 ? '+' : ''}${lo}` : `${lo > 0 ? '+' : ''}${lo} to ${hi > 0 ? '+' : ''}${hi}`;
}

function editQuestion(q) {
  UI.drawer({
    eyebrow: 'Health Number · ' + q.id,
    title: q.text.length > 52 ? q.text.slice(0, 52) + '…' : q.text,
    desc: q.scored ? 'Each answer carries a system-managed weight. A lower total is better.' : 'This question carries no points.',
    body: `<div class="notice notice--quiet">${icon('lock', { size: 18 })}<div><b>System-managed definition.</b> This console can review the published calculation but cannot change its questions, weights or bands.</div></div>
      <div class="panel" style="margin-top:16px"><div class="t-eyebrow">Question as the member reads it</div><p style="margin-top:8px">${esc(q.text)}</p></div>
      <div class="sec" data-reveal style="margin:24px 0 12px"><h2 style="font-size:var(--fs-card-title)">Answers</h2><span class="sec__rule"></span></div>
      <div class="table-wrap"><table class="table table--compact">
        <caption class="sr-only">Answer options and their weights</caption>
        <thead><tr><th scope="col">Answer</th><th scope="col" style="width:110px">Weight</th></tr></thead>
        <tbody>${q.options.map((o, i) => `<tr>
          <td>${esc(o.label)}</td>
          <td>${o.points > 0 ? '+' : ''}${o.points}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${q.note ? `<p class="t-support" style="margin-top:12px">${esc(q.note)}</p>` : ''}
      <div class="notice notice--warn" style="margin-top:16px">${icon('alert-triangle', { size: 18 })}
        <div>Changes to calculation logic require a versioned engineering release and parity tests against the approved member engine.</div></div>`,
    actions: [{ label: 'Close', variant: 'secondary', value: 'close', autofocus: true }],
  });
}

function hnScoring(host, inst) {
  host.innerHTML = `
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Result bands</h2>
        <p class="t-support">${esc(inst.direction)} Scale: ${esc(inst.scale)}.</p></div></div>
      <div class="card__body card__body--flush">
        <div class="table-wrap"><table class="table">
          <caption class="sr-only">Health Number bands and their wording</caption>
          <thead><tr><th scope="col">Up to</th><th scope="col">Band</th><th scope="col">What the member reads</th></tr></thead>
          <tbody>${inst.bands.map((b, i) => `<tr>
            <th scope="row">${i === 0 ? '0 to ' : ''}${b.upTo}</th>
            <td class="t-strong">${esc(b.label)}</td>
            <td class="t-support">${esc(b.copy)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>

    <!-- The long one. Below the fold at every width, so it is skipped for layout
         until it is reached and rises once when it arrives. -->
    <div class="card defer" data-reveal style="margin-top:var(--grid-gutter)">
      <div class="card__head"><div><h2 class="card__title">Weights at a glance</h2>
        <p class="t-support">Every scoring answer and what it adds.</p></div></div>
      <div class="card__body card__body--flush">
        <div class="table-wrap"><table class="table table--compact">
          <caption class="sr-only">Every scoring answer and its weight</caption>
          <thead><tr><th scope="col">Question</th><th scope="col">Group</th><th scope="col">Answers and weights</th></tr></thead>
          <tbody>${inst.questions.filter((q) => q.scored).map((q) => `<tr>
            <th scope="row">${q.id}</th><td>${esc(q.group || '—')}</td>
            <td><span class="qrow__opts">${q.options.map((o) => `<span class="opt">${esc(o.label)}
              <b>${o.points > 0 ? '+' : ''}${o.points}</b></span>`).join('')}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card__foot">
        <span class="t-support">${esc(inst.grouping.note)}</span>
        <button class="btn btn--ghost btn--sm" id="groupBtn">How that works</button>
      </div>
    </div>`;

  host.querySelector('#groupBtn').addEventListener('click', () => {
    UI.drawer({
      eyebrow: 'Health Number',
      title: 'Lifestyle and food grouping',
      desc: 'It decides which wording the two middle bands use.',
      body: `<div class="form-grid">
          <div><div class="t-eyebrow">Lifestyle questions</div>
            <div class="row gap-2 wrap" style="margin-top:8px">${inst.grouping.lifestyle.map((q) => `<span class="tag">${q}</span>`).join('')}</div></div>
          <div><div class="t-eyebrow">Food questions</div>
            <div class="row gap-2 wrap" style="margin-top:8px">${inst.grouping.food.map((q) => `<span class="tag">${q}</span>`).join('')}</div></div>
        </div>
        <div class="notice notice--quiet" style="margin-top:16px">${icon('info', { size: 18 })}
          <div>${esc(inst.grouping.rule)}</div></div>`,
    });
  });
}

/* =========================================================================
   SHARED PANELS
   ========================================================================= */

function historyPanel(host, inst, key) {
  host.innerHTML = `
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Version history</h2>
        <p class="t-support">${key === 'health-number' ? 'Published versions are shown for audit. Historical calculations remain read-only.' : 'Restoring brings back that wording and those numbers. Results already stored keep the version that produced them.'}</p></div></div>
      <div class="card__body card__body--flush">
        <div class="rows">
          ${(inst.versions || []).map((v) => `
            <div class="rowitem" style="grid-template-columns:44px minmax(0,1fr) auto">
              <span class="rowitem__icon${v.current ? '' : ' rowitem__icon--off'}">${icon('history', { size: 18 })}</span>
              <div>
                <div class="rowitem__title">${esc(v.version)} ${v.current ? '<span class="chip chip--live">In use</span>' : ''}</div>
                <div class="rowitem__meta">${esc(v.effective)} · ${esc(v.note)}</div>
              </div>
              <div class="rowitem__side">
                ${v.current || key === 'health-number' ? `<span class="t-support">${v.current ? 'Current' : 'Read only'}</span>`
                  : `<button class="btn btn--secondary btn--sm" data-restore="${esc(v.version)}">Restore</button>`}
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="card__foot">
        <span class="t-support">Source: ${esc(inst.source)}. The console displays what the published engine holds
          and never works a value out for itself.</span>
      </div>
    </div>`;

  host.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
    const v = b.dataset.restore;
    const r = await UI.confirm({
      title: 'Restore ' + v + '?',
      message: 'The current wording and weights are replaced by those from ' + v + '.',
      impact: H.n(inst.membersScored) + ' members have been scored with this instrument. Nobody is rescored.',
      confirmLabel: 'Restore ' + v,
    });
    if (r.ok) {
      S.note('Restored ' + v);
      UI.toast({ title: 'Version restored', message: v + ' is now in use.' });
    }
  }));
}

function testPanel(host, inst, key) {
  host.innerHTML = `
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Preview and test</h2>
        <p class="t-support">Run the instrument exactly as a member would meet it. Nothing here changes the
          definition, and no new health logic is introduced.</p></div></div>
      <div class="card__body" id="testHost"></div>
    </div>`;
  buildTest(host.querySelector('#testHost'), key, inst);
}

/* =========================================================================
   SIMPLE QUIZ
   ========================================================================= */

function sqQuestions(host, inst) {
  host.innerHTML = `
    <div class="notice notice--quiet">
      ${icon('info', { size: 18 })}
      <div>${esc(inst.constraint)}</div>
    </div>

    <div class="card" style="margin-top:var(--grid-gutter)">
      <div class="card__head">
        <div><h2 class="card__title">The ${inst.items.length} questions</h2>
          <p class="t-support">${esc(inst.scoring)}</p></div>
        <button class="btn btn--secondary btn--sm" id="addItem">${icon('plus', { size: 16 })} Add a question</button>
      </div>
      <div class="card__body card__body--flush">
        <div class="steps" id="sqList">
          ${inst.items.map((q, i) => `
            <div class="step">
              <span class="step__day">${i + 1}</span>
              <div style="min-width:0">
                <label class="sr-only" for="sq-${i}">Question ${i + 1}</label>
                <input class="input input--sm" id="sq-${i}" value="${esc(q)}" data-item="${i}">
              </div>
              <button class="icon-btn btn--sm" data-del="${i}" aria-label="Remove question ${i + 1}"
                      style="width:32px;height:32px">${icon('trash', { size: 16 })}</button>
            </div>`).join('')}
        </div>
      </div>
      <div class="card__foot">
        <span class="t-support">The result is a count, stored against the date it was taken. No band, no status
          and no supplement amount, because the source defines none.</span>
      </div>
    </div>`;

  host.querySelectorAll('[data-item]').forEach((inp) => inp.addEventListener('input', () => {
    const st = S.get();
    const items = st.simpleQuiz.items.slice();
    items[+inp.dataset.item] = inp.value;
    S.set({ simpleQuiz: { ...st.simpleQuiz, items } }, { silent: true });
    S.markDirty('assessment-simple-quiz', 'The Simple Health Quiz');
    markDirty();
  }));

  host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const i = +b.dataset.del;
    const st = S.get();
    const r = await UI.confirm({
      title: 'Remove question ' + (i + 1) + '?',
      message: '“' + st.simpleQuiz.items[i] + '” is taken out of the quiz. Results already recorded are unchanged.',
      confirmLabel: 'Remove the question', danger: true,
    });
    if (r.ok) {
      S.set({ simpleQuiz: { ...st.simpleQuiz, items: st.simpleQuiz.items.filter((_, j) => j !== i) } });
      S.markDirty('assessment-simple-quiz', 'The Simple Health Quiz');
      sqQuestions(host, S.get().simpleQuiz);
      markDirty();
      UI.toast({ title: 'Question removed', message: 'Use Save changes to keep it.' });
    }
  }));

  host.querySelector('#addItem').addEventListener('click', () => {
    UI.modal({
      title: 'Add a question',
      desc: 'It is answered Yes or No, like the others.',
      body: H.field({ id: 'sq-new', label: 'Question', required: true, placeholder: 'Do you skip breakfast?' }),
      actions: [
        { label: 'Cancel', variant: 'secondary', value: false },
        { label: 'Add the question', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
          const v = ref.el.querySelector('#sq-new').value.trim();
          if (!v) { H.fieldError(ref.el, 'sq-new', 'Write the question first.'); return false; }
          const st = S.get();
          S.set({ simpleQuiz: { ...st.simpleQuiz, items: st.simpleQuiz.items.concat([v]) } });
          S.markDirty('assessment-simple-quiz', 'The Simple Health Quiz');
          sqQuestions(host, S.get().simpleQuiz);
          markDirty();
          UI.toast({ title: 'Question added', message: 'Use Save changes to keep it.' });
        } },
      ],
    });
  });
}

/* =========================================================================
   HEALTH STATUS REPORT
   ========================================================================= */

function srScoring(host, inst) {
  host.innerHTML = `
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">How it is scored</h2></div></div>
      <div class="card__body"><p class="readout">${esc(inst.scoring)} ${esc(inst.scale)}</p></div>
    </div>

    <div class="card" style="margin-top:var(--grid-gutter)">
      <div class="card__head"><div><h2 class="card__title">Inflammation bands</h2></div></div>
      <div class="card__body card__body--flush">
        <div class="table-wrap"><table class="table">
          <caption class="sr-only">Health Assessment bands</caption>
          <thead><tr><th scope="col">Total</th><th scope="col">Band</th><th scope="col">What the member reads</th></tr></thead>
          <tbody>${inst.bands.map((b) => `<tr>
            <th scope="row">${b.from === b.to ? b.from : b.from + ' to ' + b.to}</th>
            <td class="t-strong">${esc(b.label)}</td>
            <td class="t-support">${esc(b.copy)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
}

function srSupplements(host, inst) {
  host.innerHTML = `
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Supplement amounts</h2>
        <p class="t-support">A separate lookup from the bands.</p></div></div>
      <div class="card__body card__body--flush">
        <div class="table-wrap"><table class="table table--compact">
          <caption class="sr-only">Supplement amounts by total</caption>
          <thead><tr><th scope="col">Total</th><th scope="col">EPA</th><th scope="col">Polyphenols</th><th scope="col">Reason given</th></tr></thead>
          <tbody>${inst.dosage.map((d) => `<tr>
            <th scope="row">${d.from} to ${d.to}</th><td>${esc(d.epa)}</td><td>${esc(d.poly)}</td>
            <td class="t-support">${esc(d.note)}</td></tr>`).join('')}
            <tr><th scope="row">${esc(inst.separateRow.condition)}</th><td>${esc(inst.separateRow.epa)}</td>
              <td>${esc(inst.separateRow.poly)}</td><td class="t-support">${esc(inst.separateRow.note)}</td></tr>
          </tbody>
        </table></div>
      </div>
      <div class="card__foot" style="display:block">
        <div class="notice notice--warn">${icon('alert-triangle', { size: 18 })}
          <div><b>The two sets of boundaries do not line up.</b> ${esc(inst.boundaryNote)}
          The last row is a condition, not a score — it is never applied from the total alone.</div></div>
      </div>
    </div>`;
}

/* =========================================================================
   BLOOD MARKERS
   ========================================================================= */

function bmMarkers(host, inst) {
  const st = S.get();
  host.innerHTML = `
    <div class="card">
      <div class="card__head">
        <div><h2 class="card__title">Marker definitions</h2>
          <p class="t-support">Name, unit and the range a member is allowed to enter.</p></div>
        <button class="btn btn--secondary btn--sm" id="addMarker">${icon('plus', { size: 16 })} Add a marker</button>
      </div>
      <div class="card__body card__body--flush">
        <div class="table-wrap"><table class="table table--rows">
          <caption class="sr-only">Blood marker definitions</caption>
          <thead><tr><th scope="col">Marker</th><th scope="col">Unit</th>
            <th scope="col" data-col-priority="low">Also written</th>
            <th scope="col">Accepts</th><th scope="col">Status</th>
            <th scope="col"><span class="sr-only">Edit</span></th></tr></thead>
          <tbody>${st.markers.map((m) => `<tr>
            <th scope="row">${esc(m.name)}</th><td>${esc(m.unit)}</td>
            <td data-col-priority="low" class="t-support">${esc(m.aliases)}</td>
            <td>${m.low} to ${m.high}</td><td>${H.chip(m.status)}</td>
            <td style="text-align:right"><button class="btn btn--ghost btn--sm" data-m="${m.id}">Edit<span class="sr-only"> ${esc(m.name)}</span></button></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card__foot"><span class="t-support">A value outside the accepted range is refused at entry rather than stored and flagged.</span></div>
    </div>`;

  host.querySelector('#addMarker').addEventListener('click', () => editMarker(null, host, inst));
  host.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    editMarker(S.get().markers.find((m) => m.id === b.dataset.m), host, inst);
  }));
}

function bmRatios(host) {
  const st = S.get();
  host.innerHTML = `
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Calculated ratios</h2>
        <p class="t-support">Worked out from the markers. These are the only formulas the product applies.</p></div></div>
      <div class="card__body card__body--flush">
        <div class="table-wrap"><table class="table">
          <caption class="sr-only">Calculated ratios, their formulas and goals</caption>
          <thead><tr><th scope="col">Ratio</th><th scope="col">Formula</th><th scope="col">Goal</th><th scope="col" data-col-priority="low">Rounding</th></tr></thead>
          <tbody>${st.ratios.map((r) => `<tr>
            <th scope="row">${esc(r.name)}
              ${r.entry ? '<span class="chip chip--info chip--sm">' + esc(r.entry) + '</span>' : ''}</th>
            <td>${esc(r.formula)}</td><td>${esc(r.goal)}</td>
            <td data-col-priority="low">${esc(r.rounding)}</td></tr>
            ${r.entryNote ? `<tr><td colspan="4" class="t-support" style="padding-top:0">${icon('info', { size: 14 })} ${esc(r.entryNote)}</td></tr>` : ''}
            ${r.note ? `<tr><td colspan="4" class="t-support" style="padding-top:0">${icon('info', { size: 14 })} ${esc(r.note)}</td></tr>` : ''}`).join('')}</tbody>
        </table></div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--grid-gutter)">
      <div class="card__head"><div><h2 class="card__title">Supplement amounts by condition</h2></div></div>
      <div class="card__body card__body--flush">
        <div class="table-wrap"><table class="table table--compact">
          <caption class="sr-only">EPA amounts by condition</caption>
          <thead><tr><th scope="col">Condition</th><th scope="col">EPA</th></tr></thead>
          <tbody>${window.Veye.SEED.doseByCondition.map((d) => `<tr>
            <th scope="row">${esc(d.condition)}</th><td>${esc(d.epa)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card__foot" style="display:block">
        <div class="notice notice--quiet">${icon('info', { size: 18 })}
          <div>Amounts are chosen by condition. No source defines a rule that turns the <i>number</i> of ratios
          outside their goal into an amount, so the console never derives one.</div></div>
      </div>
    </div>`;
}

function editMarker(existing, host, inst) {
  UI.drawer({
    eyebrow: 'Blood markers',
    title: existing ? 'Edit ' + existing.name : 'Add a marker',
    body: `<div class="stack gap-5">
      ${H.field({ id: 'mk-name', label: 'Name', required: true, value: existing ? existing.name : '' })}
      ${H.field({ id: 'mk-unit', label: 'Unit', value: existing ? existing.unit : 'mg/dL' })}
      ${H.field({ id: 'mk-low', label: 'Lowest accepted value', type: 'number', value: existing ? existing.low : 0 })}
      ${H.field({ id: 'mk-high', label: 'Highest accepted value', type: 'number', value: existing ? existing.high : 100 })}
      ${H.field({ id: 'mk-alias', label: 'Also written as', value: existing ? existing.aliases : '',
                  hint: 'Used to match column names in a laboratory import.' })}
      ${H.field({ id: 'mk-status', label: 'Status', type: 'select', options: ['Live', 'Draft'], value: existing ? existing.status : 'Draft' })}
    </div>`,
    foot: `<button class="btn btn--secondary" id="mkCancel">Cancel</button>
           <button class="btn btn--primary" id="mkSave">${existing ? 'Save the marker' : 'Add the marker'}</button>`,
    onMount: (ref) => {
      ref.el.querySelector('#mkCancel').addEventListener('click', () => ref.close());
      ref.el.querySelector('#mkSave').addEventListener('click', () => {
        const name = ref.el.querySelector('#mk-name').value.trim();
        if (!name) { H.fieldError(ref.el, 'mk-name', 'A marker needs a name.'); return; }
        const low = parseFloat(ref.el.querySelector('#mk-low').value);
        const high = parseFloat(ref.el.querySelector('#mk-high').value);
        if (!(high > low)) { H.fieldError(ref.el, 'mk-high', 'The highest accepted value has to be above the lowest.'); return; }
        const patch = { name, unit: ref.el.querySelector('#mk-unit').value.trim(), low, high,
          aliases: ref.el.querySelector('#mk-alias').value.trim(), status: ref.el.querySelector('#mk-status').value };
        const st = S.get();
        S.set({ markers: existing
          ? st.markers.map((m) => m.id === existing.id ? { ...m, ...patch } : m)
          : st.markers.concat([{ id: 'BM-' + (st.markers.length + 1), ...patch }]) });
        S.markDirty('assessment-markers', 'The blood marker definitions');
        ref.close();
        bmMarkers(host, inst);
        markDirty();
        UI.toast({ title: existing ? 'Marker saved' : 'Marker added', message: 'Use Save changes to keep it.' });
      });
    },
  });
}

/* =========================================================================
   BODY COMPOSITION
   ========================================================================= */

function bcDefinitions(host, inst) {
  host.innerHTML = `
    <div class="notice notice--quiet">${icon('info', { size: 18 })}<div>${esc(inst.note)}</div></div>

    <div class="card" style="margin-top:var(--grid-gutter)">
      <div class="card__head"><div><h2 class="card__title">What is collected, and how body fat is found</h2></div></div>
      <div class="card__body card__body--flush">
        <div class="table-wrap"><table class="table">
          <caption class="sr-only">Body composition inputs by sex</caption>
          <thead><tr><th scope="col">Table</th><th scope="col">Measurements collected</th><th scope="col">How the result is found</th></tr></thead>
          <tbody>${inst.inputs.map((i) => `<tr>
            <th scope="row">${esc(i.sex)}</th><td>${esc(i.fields)}</td><td>${esc(i.method)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card__foot"><span class="t-support">A blank cell in a supplied table means that combination is not supported. The member is told the result is not available; nothing is estimated.</span></div>
    </div>

    <div class="card" style="margin-top:var(--grid-gutter)">
      <div class="card__head"><div><h2 class="card__title">Standard BMI</h2></div></div>
      <div class="card__body">
        <div class="simres">
          <div><div class="t-eyebrow">Formula</div>
            <div class="t-strong" style="margin-top:4px;font-size:var(--fs-body-lg)">${esc(inst.bmi.formula)}</div></div>
        </div>
        <div class="notice notice--warn" style="margin-top:16px">${icon('alert-triangle', { size: 18 })}
          <div>${esc(inst.bmi.note)}</div></div>
      </div>
    </div>`;
}

/* Panel registry. */
const PANELS = {
  'health-number': { questions: hnQuestions, scoring: hnScoring, test: testPanel, history: historyPanel },
  'simple-quiz': { questions: sqQuestions, test: testPanel, history: historyPanel },
  'status-report': { scoring: srScoring, supplements: srSupplements, test: testPanel, history: historyPanel },
  markers: { markers: bmMarkers, ratios: bmRatios, test: testPanel, history: historyPanel },
  'body-composition': { definitions: bcDefinitions, test: testPanel, history: historyPanel },
};

/* =========================================================================
   SIMULATORS
   Rendered inline in the Preview & Test panel, and also available from the
   sticky action bar on any panel via a drawer.
   ========================================================================= */

function buildTest(host, key, inst) {
  if (key === 'health-number') {
    host.innerHTML = `
      <div class="notice notice--quiet">${icon('info', { size: 18 })}
        <div><b>Sample answers.</b> Scores follow the 20 Aug 2026 weights — Q5 at 0.5 — and the
        published floor of 1.</div></div>
      <div class="stack gap-4" style="margin-top:20px">
        ${inst.personas.map((p) => {
          const band = S.hnBand(p.score);
          const pct = Math.max(4, Math.min(100, (1 - p.score / 10) * 100));
          const tone = { ok: 'var(--status-positive)', warn: 'var(--status-attention)', risk: 'var(--status-significant)' }[H.hnTone(p.score)];
          return `<div class="simres">
            <div class="arc__dial" data-ring style="--pct:${pct.toFixed(0)};--tone:${tone};width:76px;height:76px">
              <div class="arc__inner"><div class="arc__val" style="font-size:20px">${p.score.toFixed(1)}</div></div>
            </div>
            <div style="min-width:0">
              <div class="t-strong">${esc(p.name)}</div>
              <div class="simres__band">${esc(band ? band.label : '')}</div>
              <div class="t-support" style="margin-top:6px">${Object.entries(p.answers).map(([q, a]) => esc(q + ': ' + a)).join(' · ')}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    window.Veye.M.scan(host);
    return;
  }

  if (key === 'status-report') {
    host.innerHTML = `${H.field({ id: 'hsr-total', label: 'Total out of 33', type: 'number', value: 24 })}
      <div id="hsrOut" style="margin-top:20px"></div>`;
    const input = host.querySelector('#hsr-total');
    const out = host.querySelector('#hsrOut');
    const draw = () => {
      const t = parseInt(input.value, 10);
      if (isNaN(t) || t < 11 || t > 33) {
        out.innerHTML = `<div class="notice notice--warn">${icon('alert-circle', { size: 18 })}
          <div>The total runs from 11 to 33, because every one of the eleven questions scores at least 1.</div></div>`;
        return;
      }
      const band = inst.bands.find((b) => t >= b.from && t <= b.to);
      const dose = inst.dosage.find((d) => t >= d.from && t <= d.to);
      out.innerHTML = `
        <div class="simres"><div class="bigfig"><span class="bigfig__value">${t}</span><span class="bigfig__unit">of 33</span></div>
          <div style="min-width:0"><div class="t-strong">${esc(band.label)}</div>
          <p class="simres__band" style="margin-top:4px">${esc(band.copy)}</p></div></div>
        <div class="card" style="margin-top:16px"><div class="card__body">
          <div class="t-eyebrow">Supplement row for this total</div>
          <p class="readout" style="margin-top:8px">EPA <b>${esc(dose.epa)}</b>, polyphenols <b>${esc(dose.poly)}</b> — ${esc(dose.note)}.</p>
          <p class="qualify">${icon('info', { size: 14 })} This row uses its own boundaries, which are not the same as the band boundaries.</p>
        </div></div>`;
    };
    input.addEventListener('input', draw);
    draw();
    return;
  }

  if (key === 'simple-quiz') {
    host.innerHTML = `<div class="prefs" id="sqTest">
        ${inst.items.map((q, i) => `<label class="pref" for="sqt-${i}">
          <input type="checkbox" id="sqt-${i}" data-q="${i}">
          <span><span class="pref__label">${esc(q)}</span></span></label>`).join('')}
      </div>
      <div id="sqOut" style="margin-top:20px"></div>`;
    const out = host.querySelector('#sqOut');
    const draw = () => {
      const boxes = [...host.querySelectorAll('[data-q]')];
      const yes = boxes.filter((b) => b.checked).length;
      out.innerHTML = `<div class="simres">
        <div class="bigfig"><span class="bigfig__value">${boxes.length - yes}</span><span class="bigfig__unit">No</span></div>
        <div class="bigfig"><span class="bigfig__value">${yes}</span><span class="bigfig__unit">Yes</span></div>
        <p class="simres__band">${esc(inst.progressNote)}</p></div>`;
    };
    host.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('change', draw));
    draw();
    return;
  }

  if (key === 'markers') {
    host.innerHTML = `<div class="form-grid">
        ${H.field({ id: 'tv-tg', label: 'Triglycerides (mg/dL)', type: 'number', value: 104 })}
        ${H.field({ id: 'tv-hdl', label: 'HDL (mg/dL)', type: 'number', value: 58 })}
        ${H.field({ id: 'tv-glu', label: 'Fasting glucose (mg/dL)', type: 'number', value: 92 })}
        ${H.field({ id: 'tv-ins', label: 'Fasting insulin (µIU/mL)', type: 'number', value: 7.4 })}
        ${H.field({ id: 'tv-aa', label: 'Arachidonic acid (%)', type: 'number', value: 9.2 })}
        ${H.field({ id: 'tv-epa', label: 'EPA (%)', type: 'number', value: 3.1 })}
      </div>
      <div id="tvOut" style="margin-top:20px"></div>`;
    const out = host.querySelector('#tvOut');
    const v = (id) => parseFloat(host.querySelector('#' + id).value);
    const draw = () => {
      const r2 = (x) => Math.round(x * 100) / 100;
      const rows = [
        { name: 'TG / HDL ratio', val: v('tv-hdl') > 0 ? r2(v('tv-tg') / v('tv-hdl')) : null, goal: 'Under 1',
          ok: v('tv-tg') / v('tv-hdl') < 1 },
        { name: 'AA / EPA ratio', val: v('tv-epa') > 0 ? r2(v('tv-aa') / v('tv-epa')) : null, goal: '1.5 to 3',
          ok: v('tv-aa') / v('tv-epa') >= 1.5 && v('tv-aa') / v('tv-epa') <= 3 },
        { name: 'HOMA-IR', val: r2(v('tv-ins') * v('tv-glu') / 405), goal: 'Under 1',
          ok: v('tv-ins') * v('tv-glu') / 405 < 1 },
      ];
      out.innerHTML = `<div class="table-wrap"><table class="table table--compact">
        <caption class="sr-only">Calculated ratios for the values entered</caption>
        <thead><tr><th scope="col">Ratio</th><th scope="col">Result</th><th scope="col">Goal</th><th scope="col">Against goal</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><th scope="row">${esc(r.name)}</th>
          <td class="t-num">${r.val == null || isNaN(r.val) ? '—' : r.val}</td><td>${esc(r.goal)}</td>
          <td>${r.ok ? '<span class="chip chip--live">Inside goal</span>' : '<span class="chip chip--attention">Outside goal</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`;
    };
    host.querySelectorAll('input').forEach((i) => i.addEventListener('input', draw));
    draw();
    return;
  }

  host.innerHTML = `<div class="form-grid">
      ${H.field({ id: 'bc-w', label: 'Weight (pounds)', type: 'number', value: 148 })}
      ${H.field({ id: 'bc-h', label: 'Height (inches)', type: 'number', value: 65 })}
    </div>
    <div id="bcOut" style="margin-top:20px"></div>
    <div class="notice notice--warn" style="margin-top:20px">${icon('alert-triangle', { size: 18 })}
      <div>${esc(inst.bmi.note)}</div></div>`;
  const out = host.querySelector('#bcOut');
  const draw = () => {
    const w = parseFloat(host.querySelector('#bc-w').value);
    const h = parseFloat(host.querySelector('#bc-h').value);
    const bmi = (w > 0 && h > 0) ? Math.round(703 * w / (h * h) * 10) / 10 : null;
    out.innerHTML = `<div class="simres">
      <div class="bigfig"><span class="bigfig__value">${bmi == null ? '—' : bmi}</span><span class="bigfig__unit">BMI</span></div>
      <p class="simres__band">${bmi == null ? 'Enter a weight and a height.' : '703 × ' + w + ' ÷ ' + h + '² = ' + bmi}</p></div>`;
  };
  host.querySelectorAll('input').forEach((i) => i.addEventListener('input', draw));
  draw();
}

/* The sticky-bar Preview opens the same simulator in a drawer. */
function test(key, inst) {
  UI.drawer({
    eyebrow: 'Preview and test',
    title: KEYS[key].name,
    desc: 'The same simulator as the Preview & Test panel.',
    body: '<div id="drawerTest"></div>',
    onMount: (ref) => buildTest(ref.el.querySelector('#drawerTest'), key, inst),
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens['assessment-editor'] = { render };

})();
