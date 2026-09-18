/* ============================================================================
   Care Studio — the program composer
   ----------------------------------------------------------------------------
   Edit the steps a program schedules, then save. There is no approval chain:
   a change is made, checked and saved by the person making it.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const STEP_TYPES = ['Assessment', 'Message', 'Food choice', 'Meal plan', 'Mood check-in',
                    'Food diary', 'Coach review', 'Habit', 'Resource'];

let draft = null;      // the steps being edited
let draftId = null;

function render(outlet, route) {
  const id = route.params.id;
  const st = S.get();
  const prog = st.programs.find((p) => p.id === id);

  if (!prog) {
    outlet.innerHTML = `<div class="page">
      ${H.pageHead({ title: 'That program was not found',
        crumbs: [{ label: 'Home', route: '/home' }, { label: 'Care Studio', route: '/care/programs' }, { label: 'Not found' }],
        desc: `No program has the id <code>${esc(id)}</code>.` })}
      <div class="card"><div class="card__body">${H.emptyState({
        icon: 'calendar-check', title: 'Back to the program list',
        msg: 'Every program in the studio is listed there.',
        action: `<a class="btn btn--primary" href="${R.href('/care/programs')}">Open Programs</a>`,
      })}</div></div></div>`;
    return;
  }

  if (draftId !== id) { draft = st.programSteps.filter((s) => s.programId === id).map((s) => ({ ...s })); draftId = id; }

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: prog.name,
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Care Studio', route: '/care/programs' }, { label: prog.name }],
      desc: esc(prog.audience),
      where: 'care',
      actions: `<button class="btn btn--secondary" id="previewBtn">${icon('eye', { size: 18 })} Preview as a member</button>
                <button class="btn btn--primary" id="saveBtn">${icon('save', { size: 18 })} Save changes</button>`,
      meta: `${H.chip(prog.status)} <span>${esc(prog.version)}</span> <span>${prog.weeks} weeks</span>
             <span>${H.n(prog.members)} members</span> <span>Updated ${esc(prog.updated)}</span>`,
    })}

    <div class="hgrid" data-reveal>
      <div class="card">
        <div class="card__head">
          <div><h2 class="card__title">Steps</h2>
            <p class="t-support">In the order a member meets them. <span id="dirtyNote" hidden class="t-strong">Unsaved changes.</span></p></div>
          <button class="btn btn--secondary btn--sm" id="addStep">${icon('plus', { size: 16 })} Add a step</button>
        </div>
        <div class="card__body card__body--flush" id="stepList"></div>
        <div class="card__foot" id="stepFoot"></div>
      </div>

      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Checks</h2>
            <p class="t-support">Run before saving. Nothing here blocks a save; they are advice.</p></div></div>
          <div class="card__body" id="checks"></div>
        </div>
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Shape of the program</h2></div></div>
          <div class="card__body" id="shape"></div>
        </div>
      </div>
    </div>
  </div>`;

  paint(outlet, prog);

  outlet.querySelector('#addStep').addEventListener('click', () => addStep(outlet, prog));
  outlet.querySelector('#previewBtn').addEventListener('click', () => preview(prog));
  outlet.querySelector('#saveBtn').addEventListener('click', (e) => {
    const st2 = S.get();
    const others = st2.programSteps.filter((s) => s.programId !== prog.id);
    H.withSaving(e.currentTarget, () => {
      S.set({
        programSteps: others.concat(draft),
        programs: st2.programs.map((p) => p.id === prog.id ? { ...p, updated: 'Today' } : p),
      });
      S.clearDirty();
      S.note('Saved the ' + prog.name + ' program');
      paint(outlet, prog);
      UI.toast({ title: 'Program saved', message: draft.length + ' steps in ' + prog.name + '.' });
    });
  });
}

function markDirty(outlet, prog) {
  S.markDirty('program-' + prog.id, 'The ' + prog.name + ' program');
  const note = outlet.querySelector('#dirtyNote');
  if (note) note.hidden = false;
}

function paint(outlet, prog) {
  const list = outlet.querySelector('#stepList');
  const foot = outlet.querySelector('#stepFoot');
  const sorted = draft.slice().sort((a, b) => a.week - b.week);

  list.innerHTML = sorted.length ? `<div class="steps">${sorted.map((s) => `
    <div class="step">
      <span class="step__day">W${s.week}</span>
      <div style="min-width:0">
        <div class="step__name">${esc(s.title)}</div>
        <div class="step__note">${esc(s.type)} · ${esc(s.timing)} · ${esc(s.detail)}</div>
      </div>
      <div class="row gap-2">
        <button class="btn btn--ghost btn--sm" data-edit="${s.id}">Edit<span class="sr-only"> ${esc(s.title)}</span></button>
        <button class="icon-btn btn--sm" data-del="${s.id}" aria-label="Remove ${esc(s.title)}" style="width:32px;height:32px">${icon('trash', { size: 16 })}</button>
      </div>
    </div>`).join('')}</div>`
    : `<div class="card__body">${H.emptyState({
        icon: 'calendar-check', title: 'No steps yet',
        msg: 'A program does nothing until it schedules something. Add the first step above.' })}</div>`;

  foot.innerHTML = `<span class="t-support">${sorted.length} step${sorted.length === 1 ? '' : 's'} across ${prog.weeks} weeks.</span>
    <a class="btn btn--ghost btn--sm" href="${R.href('/care/programs')}">Back to programs</a>`;

  list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    addStep(outlet, prog, draft.find((s) => s.id === b.dataset.edit));
  }));
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const s = draft.find((x) => x.id === b.dataset.del);
    const r = await UI.confirm({
      title: 'Remove “' + s.title + '”?',
      message: 'It is taken out of the schedule. Members part-way through keep the steps they have already met.',
      confirmLabel: 'Remove the step', danger: true,
    });
    if (r.ok) {
      draft = draft.filter((x) => x.id !== s.id);
      markDirty(outlet, prog);
      paint(outlet, prog);
      UI.toast({ title: 'Step removed', message: '“' + s.title + '” is out of the schedule. Save to keep the change.' });
    }
  }));

  paintChecks(outlet, prog);
  paintShape(outlet, prog);
}

function paintChecks(outlet, prog) {
  /* A day legitimately carries more than one step — an assessment and a welcome
     message on day one is normal design. What is an authoring error is the SAME
     step scheduled twice in the same week. */
  const keys = draft.map((s) => s.week + '::' + String(s.title || '').trim().toLowerCase());
  const dup = keys.length !== new Set(keys).size;
  const overWeek = draft.some((s) => s.week > prog.weeks);
  const hasOpening = draft.some((s) => s.week === 1);
  const hasClosing = draft.some((s) => s.type === 'Assessment' && s.week >= Math.max(1, prog.weeks - 1));

  const rows = [
    { ok: draft.length > 0, label: 'The program schedules at least one step' },
    { ok: !dup, label: 'No step is scheduled twice in the same week' },
    { ok: !overWeek, label: 'Every step falls inside the ' + prog.weeks + ' weeks' },
    { ok: hasOpening, label: 'Something happens in week one' },
    { ok: hasClosing, label: 'An assessment closes the program' },
  ];

  outlet.querySelector('#checks').innerHTML = `<div class="stack gap-3">
    ${rows.map((r) => `<div class="row gap-3" style="align-items:flex-start">
      <span style="color:${r.ok ? 'var(--status-positive)' : 'var(--status-attention)'};flex:0 0 auto">
        ${icon(r.ok ? 'check-circle' : 'alert-circle', { size: 18 })}</span>
      <span class="t-support" style="color:${r.ok ? 'var(--text-body)' : '#96601F'}">${esc(r.label)}</span>
    </div>`).join('')}
  </div>`;
}

function paintShape(outlet, prog) {
  const perWeek = Array.from({ length: prog.weeks }, (_, i) => draft.filter((s) => s.week === i + 1).length);
  const byType = STEP_TYPES.map((t) => ({ label: t, n: draft.filter((s) => s.type === t).length })).filter((r) => r.n);

  outlet.querySelector('#shape').innerHTML = `
    <div class="t-eyebrow">Steps per week</div>
    ${H.columns(perWeek, Array.from({ length: prog.weeks }, (_, i) => 'W' + (i + 1)),
      { alt: 'Number of steps scheduled in each week of the program.' })}
    ${H.chartAlt('View steps per week as a table', ['Week', 'Steps'],
      perWeek.map((v, i) => ['Week ' + (i + 1), String(v)]), 'Steps per week')}
    <div class="t-eyebrow" style="margin-top:var(--s-6)">What kind of steps</div>
    <div style="margin-top:var(--s-3)">${byType.length ? H.barList(byType) : '<p class="t-support">No steps yet.</p>'}</div>`;
}

function addStep(outlet, prog, existing) {
  UI.modal({
    title: existing ? 'Edit “' + existing.title + '”' : 'Add a step',
    size: 'wide',
    body: `<div class="form-grid">
      ${H.field({ id: 'st-title', label: 'What the member sees', required: true, value: existing ? existing.title : '' })}
      ${H.field({ id: 'st-type', label: 'Kind of step', type: 'select', options: STEP_TYPES, value: existing ? existing.type : 'Message' })}
      ${H.field({ id: 'st-week', label: 'Week', type: 'number', value: existing ? existing.week : 1,
                  hint: 'Between 1 and ' + prog.weeks + '.' })}
      ${H.field({ id: 'st-timing', label: 'When in the week', value: existing ? existing.timing : 'Day 1' })}
      ${H.field({ id: 'st-detail', label: 'Note for the team', value: existing ? existing.detail : '',
                  hint: 'Which template, which portal, how long. Members do not see this.' })}
    </div>`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: existing ? 'Save the step' : 'Add the step', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const title = ref.el.querySelector('#st-title').value.trim();
        if (!title) { H.fieldError(ref.el, 'st-title', 'A step needs a name the member will read.'); return false; }
        const week = parseInt(ref.el.querySelector('#st-week').value, 10);
        if (!week || week < 1 || week > prog.weeks) {
          H.fieldError(ref.el, 'st-week', 'This program runs for ' + prog.weeks + ' weeks, so pick a week in that range.');
          return false;
        }
        const patch = {
          title, week, type: ref.el.querySelector('#st-type').value,
          timing: ref.el.querySelector('#st-timing').value.trim() || 'Day 1',
          detail: ref.el.querySelector('#st-detail').value.trim() || '—',
        };
        if (existing) draft = draft.map((s) => s.id === existing.id ? { ...s, ...patch } : s);
        else draft = draft.concat([{ id: 'PS-new-' + (draft.length + 1) + '-' + prog.id, programId: prog.id, ...patch }]);
        markDirty(outlet, prog);
        paint(outlet, prog);
        UI.toast({ title: existing ? 'Step updated' : 'Step added', message: 'Save the program to keep the change.' });
      } },
    ],
  });
}

function preview(prog) {
  const sorted = draft.slice().sort((a, b) => a.week - b.week);
  UI.drawer({
    eyebrow: 'Member preview',
    title: prog.name,
    desc: 'What a member sees as they move through the program.',
    body: sorted.length ? `<div class="storyline"><span class="storyline__axis"></span>
      ${sorted.map((s) => `<div class="sl-item">
        <div class="sl-item__when">Week ${s.week}</div>
        <div class="sl-item__mark sl-item__mark--care">${icon('calendar-check', { size: 16 })}</div>
        <div class="sl-item__body">
          <div class="sl-item__title">${esc(s.title)}</div>
          <div class="sl-item__text">${esc(s.type)} · ${esc(s.timing)}</div>
        </div>
      </div>`).join('')}</div>`
      : H.emptyState({ icon: 'eye', title: 'Nothing to preview yet', msg: 'Add a step and the member view fills in.' }),
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens['care-program'] = { render };

})();
