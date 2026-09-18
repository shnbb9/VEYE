/* ============================================================================
   Companion
   ----------------------------------------------------------------------------
   Two areas: what Companion is allowed to say, and what it has been saying.

   No model version, no policy version, no review targets and no incident
   register. Veye Companion does not diagnose, treat or prevent anything, and
   nothing on this screen suggests otherwise.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const MODES = [
  { key: 'conversations', label: 'Conversations', route: '/companion/conversations' },
  { key: 'settings',      label: 'Companion settings', route: '/companion/settings' },
];

let selected = null;
const convView = { q: '', filter: 'Needs review' };

function render(outlet, route) {
  const mode = route.params.mode || 'conversations';
  const st = S.get();

  if (!MODES.some((m) => m.key === mode)) {
    outlet.innerHTML = `<div class="page">
      ${H.pageHead({ title: 'Companion',
        crumbs: [{ label: 'Home', route: '/home' }, { label: 'Companion' }],
        desc: `Companion has no section called <code>${esc(mode)}</code>.` })}
      ${H.subnav(MODES, null)}
      <div class="card"><div class="card__body">${H.emptyState({
        icon: 'sprout', title: 'Two sections are available',
        msg: 'Conversations, and Companion settings.',
        action: `<a class="btn btn--primary" href="${R.href('/companion/conversations')}">Open Conversations</a>`,
      })}</div></div></div>`;
    return;
  }

  const flagged = st.conversations.filter((c) => c.flagged && !c.reviewed).length;

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: 'Companion',
      desc: `${esc(st.companion.name)} is the companion members talk to inside Veye. It answers from their own plan, diary and assessments.`,
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Companion' }],
      where: 'companion',
      actions: mode === 'settings'
        ? `<button class="btn btn--secondary" id="previewBtn">${icon('eye', { size: 18 })} Preview</button>
           <button class="btn btn--primary" id="saveBtn">${icon('save', { size: 18 })} Save changes</button>`
        : '',
    })}
    ${H.subnav(MODES.map((m) => m.key === 'conversations' ? { ...m, count: flagged || undefined } : m), mode)}
    <div id="cBody"></div>
  </div>`;

  const body = outlet.querySelector('#cBody');
  if (mode === 'settings') { settings(body, outlet); } else { conversations(body); }
}

/* ----------------------------------------------------------------- settings -- */
function settings(host, outlet) {
  const st = S.get();
  const c = st.companion;

  host.innerHTML = `
    <div class="hgrid" data-reveal>
      <div class="stack gap-5">
        <div class="card">
          <div class="card__head">
            <div><h2 class="card__title">Is Companion on?</h2>
              <p class="t-support">When it is off, members see the rest of their dashboard as normal and Companion is simply absent.</p></div>
            <label class="switch">
              <input type="checkbox" id="cEnabled" ${c.enabled ? 'checked' : ''}>
              <span class="switch__track"></span>
              <span class="check__text">${c.enabled ? 'On for everyone' : 'Off'}</span>
            </label>
          </div>
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">What Companion says</h2></div></div>
          <div class="card__body stack gap-5">
            ${H.field({ id: 'cWelcome', label: 'Opening message', type: 'textarea', rows: 3, value: c.welcome,
              hint: 'The first thing a member reads when they open Companion.' })}
            ${H.field({ id: 'cSafe', label: 'When a question needs a person', type: 'textarea', rows: 3, value: c.safeResponse,
              hint: 'Used for anything about an amount, a symptom or a medicine.' })}
            ${H.field({ id: 'cFallback', label: 'When the question is off-topic', type: 'textarea', rows: 3, value: c.fallback,
              hint: 'Used when the question has nothing to do with Veye.' })}
          </div>
        </div>

        <div class="card">
          <div class="card__head">
            <div><h2 class="card__title">Quick prompts</h2>
              <p class="t-support">The suggestions a member can tap instead of typing.</p></div>
            <button class="btn btn--secondary btn--sm" id="addPrompt">${icon('plus', { size: 16 })} Add a prompt</button>
          </div>
          <div class="card__body card__body--flush">
            <div class="rows">${c.prompts.map((p) => `
              <div class="rowitem">
                <span class="rowitem__icon${p.active ? '' : ' rowitem__icon--off'}">${icon('messages', { size: 18 })}</span>
                <div><div class="rowitem__title">${esc(p.label)}</div>
                  <div class="rowitem__meta">Asks: ${esc(p.prompt)}</div></div>
                <div class="rowitem__side">
                  <label class="switch">
                    <input type="checkbox" data-prompt="${p.id}" ${p.active ? 'checked' : ''}>
                    <span class="switch__track"></span>
                    <span class="sr-only">Show “${esc(p.label)}” to members</span>
                  </label>
                  <button class="btn btn--ghost btn--sm" data-editp="${p.id}">Edit<span class="sr-only"> ${esc(p.label)}</span></button>
                </div>
              </div>`).join('')}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2 class="card__title">What Companion may talk about</h2>
          <p class="t-support">Anything outside this list gets the off-topic wording, or is handed to a person.</p></div></div>
        <div class="card__body card__body--flush">
          <div class="rows">${c.topics.map((t) => `
            <div class="rowitem" style="grid-template-columns:44px minmax(0,1fr) auto">
              <span class="rowitem__icon${t.allowed ? '' : ' rowitem__icon--warn'}">
                ${icon(t.allowed ? 'check-circle' : 'lock', { size: 18 })}</span>
              <div><div class="rowitem__title">${esc(t.label)}</div>
                ${t.why ? `<div class="rowitem__meta">${esc(t.why)}</div>` : ''}</div>
              <div class="rowitem__side">
                <label class="switch">
                  <input type="checkbox" data-topic="${t.id}" ${t.allowed ? 'checked' : ''}>
                  <span class="switch__track"></span>
                  <span class="sr-only">Allow “${esc(t.label)}”</span>
                </label>
              </div>
            </div>`).join('')}</div>
        </div>
        <div class="card__foot" style="display:block">
          <div class="notice notice--quiet">${icon('info', { size: 18 })}
            <div>Companion does not diagnose, treat or prevent any condition. Questions about symptoms,
            medicines or amounts are always handed to a person.</div></div>
          <div class="notice notice--quiet" style="margin-top:12px">${icon('file-text', { size: 18 })}
            <div><b>Approved sources only.</b> Companion may use the member's plan, diary and assessment history plus client-approved VEYE educational content. API keys, model secrets and prompt engineering are not managed here.</div></div>
        </div>
      </div>
    </div>

    <section class="card" id="knowledgeSources" style="margin-top:var(--s-5)" data-reveal>
      <div class="card__head">
        <div><h2 class="card__title">Knowledge Sources</h2>
          <p class="t-support">Approved sources Companion may draw on. These are product records only — no files, indexing, credentials or model settings are managed here.</p></div>
        <button class="btn btn--primary btn--sm" id="addSource">${icon('plus', { size: 16 })} Add source</button>
      </div>
      <div class="card__body card__body--flush">
        <div class="rows">${(c.knowledgeSources || []).map((source) => `
          <div class="rowitem" style="grid-template-columns:44px minmax(0,1fr) auto">
            <span class="rowitem__icon${source.status === 'Active' ? '' : ' rowitem__icon--off'}">${icon('file-text', { size: 18 })}</span>
            <div><div class="rowitem__title">${esc(source.title)}</div>
              <div class="rowitem__meta">${esc(source.type)} · ${esc(source.scope)}</div>
              <div class="rowitem__meta">${source.reference ? esc(source.reference) + ' · ' : ''}Updated ${esc(source.updated)}</div></div>
            <div class="rowitem__side row gap-2 wrap">
              ${H.chip(source.status)}
              <button class="btn btn--ghost btn--sm" data-edit-source="${source.id}">View / edit</button>
              ${source.status === 'Archived'
                ? `<button class="btn btn--ghost btn--sm" data-source-restore="${source.id}">Restore</button>`
                : `<button class="btn btn--ghost btn--sm" data-source-toggle="${source.id}">${source.status === 'Active' ? 'Deactivate' : 'Activate'}</button>
                  <button class="btn btn--ghost btn--sm" data-source-archive="${source.id}">Archive</button>`}
            </div>
          </div>`).join('')}</div>
      </div>
      <div class="card__foot"><span class="t-support">Archiving keeps the source record and its history. It does not permanently delete it.</span></div>
    </section>`;

  const dirty = () => S.markDirty('companion', 'Companion settings');

  host.querySelector('#cEnabled').addEventListener('change', (e) => {
    S.set({ companion: { ...S.get().companion, enabled: e.target.checked } });
    settings(host, outlet);
    UI.toast({ title: e.target.checked ? 'Companion is on' : 'Companion is off',
      message: (e.target.checked ? 'In production, members could open it from their dashboard.' : 'In production, members would no longer see Companion.') + ' Prototype: saved in this browser only.', kind: 'info' });
  });

  ['cWelcome', 'cSafe', 'cFallback'].forEach((id) => {
    host.querySelector('#' + id).addEventListener('input', dirty);
  });

  host.querySelectorAll('[data-prompt]').forEach((b) => b.addEventListener('change', () => {
    const stx = S.get();
    S.set({ companion: { ...stx.companion, prompts: stx.companion.prompts.map((p) =>
      p.id === b.dataset.prompt ? { ...p, active: b.checked } : p) } });
    settings(host, outlet);
    UI.toast({ title: b.checked ? 'Prompt shown' : 'Prompt hidden', kind: 'info', timeout: 2600 });
  }));

  host.querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('change', () => {
    const stx = S.get();
    S.set({ companion: { ...stx.companion, topics: stx.companion.topics.map((t) =>
      t.id === b.dataset.topic ? { ...t, allowed: b.checked } : t) } });
    settings(host, outlet);
    UI.toast({ title: b.checked ? 'Topic allowed' : 'Topic blocked', kind: 'info', timeout: 2600 });
  }));

  host.querySelectorAll('[data-editp]').forEach((b) => b.addEventListener('click', () => {
    const p = S.get().companion.prompts.find((x) => x.id === b.dataset.editp);
    editPrompt(p, host, outlet);
  }));

  host.querySelector('#addPrompt').addEventListener('click', () => editPrompt(null, host, outlet));

  host.querySelector('#addSource').addEventListener('click', () => editSource(null, host, outlet));
  host.querySelectorAll('[data-edit-source]').forEach((b) => b.addEventListener('click', () => {
    const source = S.get().companion.knowledgeSources.find((x) => x.id === b.dataset.editSource);
    editSource(source, host, outlet);
  }));
  host.querySelectorAll('[data-source-toggle]').forEach((b) => b.addEventListener('click', () => {
    const stx = S.get();
    const sources = stx.companion.knowledgeSources.map((source) => source.id === b.dataset.sourceToggle
      ? { ...source, status: source.status === 'Active' ? 'Inactive' : 'Active', updated: 'Just now' } : source);
    S.set({ companion: { ...stx.companion, knowledgeSources: sources } });
    S.note((b.textContent.trim() === 'Activate' ? 'Activated' : 'Deactivated') + ' a Companion knowledge source');
    settings(host, outlet);
    UI.toast({ title: b.textContent.trim() === 'Activate' ? 'Source activated' : 'Source deactivated', message: 'The source status was saved in this browser.' });
  }));
  host.querySelectorAll('[data-source-archive]').forEach((b) => b.addEventListener('click', async () => {
    const source = S.get().companion.knowledgeSources.find((x) => x.id === b.dataset.sourceArchive);
    const answer = await UI.confirm({ title: 'Archive this source?', message: '“' + source.title + '” will be retained as an archived record and will not be permanently deleted.', confirmLabel: 'Archive source' });
    if (!answer.ok) return;
    const stx = S.get();
    S.set({ companion: { ...stx.companion, knowledgeSources: stx.companion.knowledgeSources.map((item) => item.id === source.id ? { ...item, status: 'Archived', updated: 'Just now' } : item) } });
    S.note('Archived Companion knowledge source “' + source.title + '”');
    settings(host, outlet);
    UI.toast({ title: 'Source archived', message: 'The archived record remains available for review.' });
  }));
  host.querySelectorAll('[data-source-restore]').forEach((b) => b.addEventListener('click', () => {
    const source = S.get().companion.knowledgeSources.find((x) => x.id === b.dataset.sourceRestore);
    const stx = S.get();
    S.set({ companion: { ...stx.companion, knowledgeSources: stx.companion.knowledgeSources.map((item) => item.id === source.id ? { ...item, status: 'Inactive', updated: 'Just now' } : item) } });
    S.note('Restored Companion knowledge source “' + source.title + '” as inactive');
    settings(host, outlet);
    UI.toast({ title: 'Source restored as inactive', message: 'Review it, then activate it when it is ready. The archived history remains in this browser.' });
  }));

  const prev = outlet.querySelector('#previewBtn');
  if (prev) prev.addEventListener('click', () => previewCompanion(host));

  const save = outlet.querySelector('#saveBtn');
  if (save) save.addEventListener('click', (e) => {
    H.withSaving(e.currentTarget, () => {
      const stx = S.get();
      S.set({ companion: { ...stx.companion,
        welcome: host.querySelector('#cWelcome').value.trim(),
        safeResponse: host.querySelector('#cSafe').value.trim(),
        fallback: host.querySelector('#cFallback').value.trim() } });
      S.clearDirty();
      S.note('Saved Companion settings');
      UI.toast({ title: 'Companion settings saved', message: 'In production, members would see the new wording. Prototype: saved in this browser only.' });
    });
  });
}

function editSource(existing, host, outlet) {
  const types = ['VEYE educational document', 'FAQ / Help', 'Nutrition reference', 'Food Choices reference', 'Companion guidance'];
  const statuses = existing && existing.status === 'Archived' ? ['Archived'] : ['Draft', 'Inactive', 'Active'];
  UI.modal({
    title: existing ? 'View / edit source' : 'Add source',
    desc: 'Record simple product metadata. Adding a source does not upload a file or connect it to an AI system.',
    body: `${H.field({ id: 'ks-title', label: 'Source title', required: true, value: existing ? existing.title : '' })}
      ${H.field({ id: 'ks-type', label: 'Source type', type: 'select', value: existing ? existing.type : types[0], options: types })}
      ${H.field({ id: 'ks-reference', label: 'Filename or URL label (optional)', value: existing ? existing.reference : '', hint: 'A label only — no file or URL is uploaded or fetched.' })}
      ${H.field({ id: 'ks-scope', label: 'Scope', required: true, value: existing ? existing.scope : '', hint: 'What member questions this source supports.' })}
      ${H.field({ id: 'ks-description', label: 'Short description', type: 'textarea', rows: 3, value: existing ? existing.description : '' })}
      ${H.field({ id: 'ks-status', label: 'Initial status', type: 'select', value: existing ? existing.status : 'Draft', options: statuses })}`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: existing ? 'Save source' : 'Add source', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const title = ref.el.querySelector('#ks-title').value.trim();
        const scope = ref.el.querySelector('#ks-scope').value.trim();
        if (!title) { H.fieldError(ref.el, 'ks-title', 'Give this source a clear title.'); return false; }
        if (!scope) { H.fieldError(ref.el, 'ks-scope', 'Describe what this source covers.'); return false; }
        const st = S.get();
        const source = {
          id: existing ? existing.id : 'KS-' + (st.companion.knowledgeSources.length + 1),
          title, type: ref.el.querySelector('#ks-type').value,
          reference: ref.el.querySelector('#ks-reference').value.trim(), scope,
          description: ref.el.querySelector('#ks-description').value.trim(),
          status: ref.el.querySelector('#ks-status').value, updated: 'Just now',
        };
        const knowledgeSources = existing
          ? st.companion.knowledgeSources.map((item) => item.id === existing.id ? source : item)
          : st.companion.knowledgeSources.concat([source]);
        S.set({ companion: { ...st.companion, knowledgeSources } });
        S.note((existing ? 'Updated' : 'Added') + ' Companion knowledge source “' + title + '”');
        settings(host, outlet);
        UI.toast({ title: existing ? 'Source saved' : 'Source added', message: 'The metadata was saved in this browser.' });
      } },
    ],
  });
}

function editPrompt(existing, host, outlet) {
  UI.modal({
    title: existing ? 'Edit “' + existing.label + '”' : 'Add a quick prompt',
    body: `${H.field({ id: 'qp-label', label: 'What the member taps', required: true, value: existing ? existing.label : '' })}
      ${H.field({ id: 'qp-prompt', label: 'What it asks Companion', type: 'textarea', rows: 2,
        value: existing ? existing.prompt : '', hint: 'Members never see this wording.' })}`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: existing ? 'Save the prompt' : 'Add the prompt', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const label = ref.el.querySelector('#qp-label').value.trim();
        if (!label) { H.fieldError(ref.el, 'qp-label', 'Give the prompt a label members will read.'); return false; }
        const prompt = ref.el.querySelector('#qp-prompt').value.trim() || label;
        const st = S.get();
        const prompts = existing
          ? st.companion.prompts.map((p) => p.id === existing.id ? { ...p, label, prompt } : p)
          : st.companion.prompts.concat([{ id: 'QP-' + (st.companion.prompts.length + 1), label, prompt, active: true }]);
        S.set({ companion: { ...st.companion, prompts } });
        S.note((existing ? 'Edited' : 'Added') + ' Companion prompt “' + label + '”');
        settings(host, outlet);
        UI.toast({ title: existing ? 'Prompt saved' : 'Prompt added' });
      } },
    ],
  });
}

function previewCompanion(host) {
  const c = S.get().companion;
  const welcome = host.querySelector('#cWelcome') ? host.querySelector('#cWelcome').value : c.welcome;
  const safe = host.querySelector('#cSafe') ? host.querySelector('#cSafe').value : c.safeResponse;
  UI.drawer({
    eyebrow: 'Preview',
    title: 'What a member sees',
    desc: 'Companion as it opens on the member dashboard.',
    body: `<div class="convo" style="padding:0">
        <div class="msg msg--companion">
          <div class="msg__meta"><span class="sprout" style="display:inline-grid;vertical-align:middle">${icon('sprout', { size: 16 })}</span> ${esc(c.name)}</div>
          <div class="msg__bubble">${esc(welcome)}</div>
        </div>
      </div>
      <div class="row gap-2 wrap" style="margin-top:16px">
        ${c.prompts.filter((p) => p.active).map((p) => `<span class="tag">${esc(p.label)}</span>`).join('')}
      </div>
      <div class="sec" style="margin:28px 0 12px"><h2 style="font-size:var(--fs-card-title)">If they ask about an amount</h2><span class="sec__rule"></span></div>
      <div class="convo" style="padding:0">
        <div class="msg msg--member"><div class="msg__meta">Member</div>
          <div class="msg__bubble">How much omega-3 should I take?</div></div>
        <div class="msg msg--companion"><div class="msg__meta">${esc(c.name)}</div>
          <div class="msg__bubble">${esc(safe)}</div></div>
      </div>`,
  });
}

/* ------------------------------------------------------------ conversations -- */
function conversations(host) {
  const st = S.get();

  /* v2 is two panes, not three. The right column in v1 repeated "why this was
     held" — wording that already sits inside the held-response panel — and stole
     width from the conversation itself. Member context is now a drawer opened
     from the conversation header. */
  host.innerHTML = `
    <div class="review2">
      <div class="card">
        <div class="findbar" style="padding:var(--s-4)">
          <div class="search" style="flex:1 1 100%;position:relative">
            <span class="search__icon">${icon('search', { size: 18 })}</span>
            <label class="sr-only" for="cvSearch">Search conversations</label>
            <input class="search__input" id="cvSearch" type="search" placeholder="Search members and messages" value="${esc(convView.q)}">
          </div>
          <div class="modeswitch" style="width:100%;justify-content:space-between">
            ${['Needs review', 'Reviewed', 'All'].map((f) => `<button class="modeswitch__btn" data-f="${f}"
              aria-selected="${convView.filter === f}">${f}</button>`).join('')}
          </div>
        </div>
        <div class="flaglist" id="cvList"></div>
        <div class="card__foot">
          <span class="t-support">Use J and K, or the arrow keys, to move between conversations.</span>
        </div>
      </div>
      <div class="card" id="cvDetail"></div>
    </div>`;

  const q = host.querySelector('#cvSearch');
  q.addEventListener('input', () => { convView.q = q.value; paintList(host); });
  host.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    convView.filter = b.dataset.f;
    host.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.f === convView.filter)));
    paintList(host);
  }));

  paintList(host);
}

function listed() {
  const st = S.get();
  const q = convView.q.trim().toLowerCase();
  return st.conversations.filter((c) => {
    if (convView.filter === 'Needs review' && !(c.flagged && !c.reviewed)) return false;
    if (convView.filter === 'Reviewed' && !c.reviewed) return false;
    if (q && !(c.member + ' ' + c.messages.map((m) => m.text).join(' ')).toLowerCase().includes(q)) return false;
    return true;
  });
}

function paintList(host) {
  const rows = listed();
  const list = host.querySelector('#cvList');

  if (!rows.length) {
    list.innerHTML = `<div style="padding:var(--s-6)">${H.emptyState({
      icon: convView.filter === 'Needs review' ? 'check-circle' : 'search',
      title: convView.filter === 'Needs review' ? 'Nothing waiting for review' : 'No conversations match',
      msg: convView.filter === 'Needs review'
        ? 'Every held reply has been read by a person.'
        : 'Try a shorter search, or switch the filter to All.',
    })}</div>`;
    paintDetail(host, null);
    return;
  }

  if (!selected || !rows.some((r) => r.id === selected)) selected = rows[0].id;

  list.innerHTML = rows.map((c) => `
    <button class="flag${c.id === selected ? ' is-active' : ''}" data-c="${c.id}">
      <span class="flag__top">
        <span class="flag__who">${esc(c.member)}</span>
        ${c.flagged && !c.reviewed ? '<span class="chip chip--attention chip--sm">Needs review</span>'
          : c.reviewed ? '<span class="chip chip--live chip--sm">Reviewed</span>' : '<span class="chip chip--sm">Normal</span>'}
      </span>
      <span class="flag__why">${esc(c.messages[0].text)}</span>
      <span class="t-support" style="display:block;margin-top:4px">${esc(c.at)}</span>
    </button>`).join('');

  list.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
    selected = b.dataset.c;
    paintList(host);
  }));

  /* Keyboard movement through the queue. J/K and the arrow keys both work, and
     the newly selected conversation takes focus so a keyboard reviewer never
     loses their place. */
  const step = (delta) => {
    const idx = rows.findIndex((r) => r.id === selected);
    const next = rows[Math.max(0, Math.min(rows.length - 1, idx + delta))];
    if (!next || next.id === selected) return;
    selected = next.id;
    paintList(host);
    const btn = host.querySelector(`[data-c="${selected}"]`);
    if (btn) { btn.focus(); btn.scrollIntoView({ block: 'nearest' }); }
  };
  list.addEventListener('keydown', (e) => {
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
  });
  host.__cvStep = step;

  paintDetail(host, S.get().conversations.find((c) => c.id === selected));
}

function paintDetail(host, c) {
  const detail = host.querySelector('#cvDetail');

  if (!c) {
    detail.innerHTML = `<div class="card__body">${H.emptyState({
      icon: 'messages', title: 'Nothing selected', msg: 'Pick a conversation on the left.' })}</div>`;
    return;
  }

  const held = c.messages.find((m) => m.held);
  const member = S.member(c.memberId);
  const feedback = c.feedback || { rating: null, comment: null, submittedAt: null, reviewed: false };
  const feedbackLabel = feedback.rating === 'helpful' ? 'Helpful' : feedback.rating === 'not-helpful' ? 'Not helpful' : 'No member feedback';

  detail.innerHTML = `
    <div class="card__head">
      <div><h2 class="card__title">${esc(c.member)}</h2><p class="t-support">${esc(c.at)}</p></div>
      <div class="row gap-2">
        ${c.reviewed ? '<span class="chip chip--live">Reviewed</span>' : ''}
        ${member ? `<button class="btn btn--ghost btn--sm" id="cvCtx">${icon('users', { size: 16 })} Member context</button>` : ''}
        <button class="icon-btn btn--sm" id="cvPrev" aria-label="Previous conversation" style="width:32px;height:32px">${icon('chevron-up', { size: 16 })}</button>
        <button class="icon-btn btn--sm" id="cvNext" aria-label="Next conversation" style="width:32px;height:32px">${icon('chevron-down', { size: 16 })}</button>
      </div>
    </div>
    <div class="convo convo--wide">
      ${c.messages.map((m, i) => {
        /* A reply that is still held never entered the conversation, so the
           transcript marks its position rather than printing it. The one
           readable copy lives in the decision panel below, with the reason and
           the actions beside it. Once a decision has been taken the reply is
           part of the conversation and is shown in full, here and only here. */
        if (m.held && !c.reviewed) return `
        <div class="msg msg--companion msg--heldmark msg--reveal" style="--d:${i * 70}ms">
          <div class="msg__meta">Sprout</div>
          <p class="msg__marker">${icon('lock', { size: 13 })} A reply was drafted here and held. It is below, with the decision.</p>
        </div>`;
        return `
        <div class="msg msg--${m.who === 'member' ? 'member' : 'companion'} msg--reveal" style="--d:${i * 70}ms">
          <div class="msg__meta">${m.who === 'member' ? esc(c.member) : 'Sprout'}${m.held ? ' · released after review' : ''}</div>
          <div class="msg__bubble">${esc(m.text)}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="panel" style="margin:0 var(--s-5) var(--s-4)">
      <div class="row gap-3 wrap" style="align-items:center;justify-content:space-between">
        <div><div class="t-eyebrow">Member feedback</div><p class="t-support">${feedbackLabel}${feedback.submittedAt ? ' · submitted ' + esc(feedback.submittedAt) : ''}${feedback.reviewed ? ' · reviewed by Cara' : ''}</p>
          ${feedback.comment ? `<p class="t-support" style="margin-top:8px">“${esc(feedback.comment)}”</p>` : ''}</div>
        ${feedback.rating && !feedback.reviewed ? '<button class="btn btn--secondary btn--sm" id="markFeedbackReviewed">Mark feedback reviewed</button>' : ''}
      </div>
    </div>
    <!-- Response decisions are pinned to the workspace so they do not scroll
         away behind a long conversation. -->
    ${held && !c.reviewed ? `<div class="held held--pinned">
      <span class="held__label">${icon('lock', { size: 14 })} Held — the member has not seen this</span>
      <div class="held__text">${esc(held.text)}</div>
      <p class="t-support" style="margin-top:12px">${esc(c.why)}</p>
      <div class="row gap-3 wrap" style="margin-top:16px">
        <button class="btn btn--primary btn--sm" id="cvSend">Send it as written</button>
        <button class="btn btn--secondary btn--sm" id="cvEdit">Edit and send</button>
        <button class="btn btn--danger-quiet btn--sm" id="cvHand">Hand to a person instead</button>
      </div>
    </div>` : `<div class="card__foot">
      ${c.reviewed ? `<span class="t-support">${c.why ? esc(c.why) : 'Nothing was held in this conversation.'}</span>`
        : `<span class="t-support">Nothing was held here. This is an ordinary conversation.</span>`}
      ${!c.reviewed && c.flagged ? `<button class="btn btn--secondary btn--sm" id="cvDone">Mark reviewed</button>` : ''}
    </div>`}`;

  /* Member context, on demand, from the conversation header. */
  const ctxBtn = detail.querySelector('#cvCtx');
  const feedbackReviewed = detail.querySelector('#markFeedbackReviewed');
  if (feedbackReviewed) feedbackReviewed.addEventListener('click', () => {
    S.set({ conversations: S.get().conversations.map((item) => item.id === c.id
      ? { ...item, feedback: { ...item.feedback, reviewed: true } } : item) });
    S.note('Marked member feedback reviewed for ' + c.member);
    paintList(host);
    UI.toast({ title: 'Feedback marked reviewed', message: 'The existing member feedback is now marked reviewed in this browser.' });
  });
  if (ctxBtn) ctxBtn.addEventListener('click', () => {
    UI.drawer({
      eyebrow: 'Member context',
      title: member.name,
      desc: member.id,
      body: `<div class="row gap-3" style="align-items:center">
          <span class="avatar avatar--lg">${esc(member.initials)}</span>
          <div style="min-width:0"><div class="t-strong">${esc(member.name)}</div>
            <div class="t-support">${esc(member.email)}</div></div>
        </div>
        <dl class="facts" style="margin-top:var(--s-6)">
          <div class="fact"><dt>Health Number</dt><dd>${member.hn == null ? 'Not completed' : member.hn.toFixed(1) + ' — ' + esc(member.hnBand)}</dd></div>
          <div class="fact"><dt>Program</dt><dd>${member.program ? esc(member.program) : 'None'}</dd></div>
          <div class="fact"><dt>Plan</dt><dd>${esc(member.subscription)}</dd></div>
          <div class="fact"><dt>Last active</dt><dd>${esc(member.lastActive)}</dd></div>
        </dl>`,
      foot: `<a class="btn btn--primary" href="${R.href('/members/' + member.id + '/overview')}">Open the member record</a>`,
    });
  });

  detail.querySelector('#cvPrev').addEventListener('click', () => host.__cvStep && host.__cvStep(-1));
  detail.querySelector('#cvNext').addEventListener('click', () => host.__cvStep && host.__cvStep(1));

  const markReviewed = (msg) => {
    S.set({ conversations: S.get().conversations.map((x) => x.id === c.id ? { ...x, reviewed: true } : x) });
    S.note('Reviewed a Companion conversation with ' + c.member);
    paintList(host);
    UI.toast({ title: 'Marked reviewed', message: msg });
  };

  const b1 = detail.querySelector('#cvSend');
  if (b1) b1.addEventListener('click', () => markReviewed('In production, the reply would be delivered to ' + c.member + '. Nothing leaves this prototype.'));

  const b2 = detail.querySelector('#cvEdit');
  if (b2) b2.addEventListener('click', () => {
    UI.modal({
      title: 'Edit before sending',
      desc: 'In production, the member would see exactly what you send.',
      body: H.field({ id: 'ed-text', label: 'Reply', type: 'textarea', rows: 5, value: held.text }),
      actions: [
        { label: 'Cancel', variant: 'secondary', value: false },
        { label: 'Send the edited reply', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
          const v = ref.el.querySelector('#ed-text').value.trim();
          if (!v) { H.fieldError(ref.el, 'ed-text', 'A reply cannot be empty.'); return false; }
          markReviewed('In production, your edited reply would go to ' + c.member + '. Nothing leaves this prototype.');
        } },
      ],
    });
  });

  const b3 = detail.querySelector('#cvHand');
  if (b3) b3.addEventListener('click', async () => {
    const r = await UI.confirm({
      title: 'Hand this to a person?',
      message: 'The held reply is discarded and ' + c.member + ' is told someone from the team will pick it up.',
      confirmLabel: 'Hand it over',
    });
    if (r.ok) markReviewed(c.member + ' has been told a person will reply.');
  });

  const b4 = detail.querySelector('#cvDone');
  if (b4) b4.addEventListener('click', () => markReviewed('Nothing needed changing.'));
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.companion = { render };

})();
