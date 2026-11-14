/* ============================================================================
   Content
   ----------------------------------------------------------------------------
   The console's Content (platform/web app/admin/content/page.tsx): the words
   the product prints — Help / FAQ and the member educational lines — with a
   Draft → Published → Archived lifecycle. Fitness, Supplements and Resources
   live in Care Studio. Deterministic health scoring is never content and has
   no entry here.

   A Help / FAQ answer must sit under one of the Help page's five chips, so the
   category is a choice, not a free text box.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const GROUPS = ['help_faq', 'member_copy'];
const GROUP_LABELS = { help_faq: 'Help / FAQ', member_copy: 'Member educational copy' };
const HELP_CATEGORIES = ['About Veye', 'Subscription and My Account', 'Diet and Nutrition Terminology', 'Using the Platform', 'Technical Issues'];

let filter = '';
let error = '';

function render(outlet, route) {
  const group = GROUPS.includes(route.params.group) ? route.params.group : 'help_faq';
  const all = S.get().contentEntries;
  const entries = all.filter((e) => e.group === group).sort((a, b) => a.display_order - b.display_order);
  const count = (g, status) => all.filter((e) => e.group === g && e.status === status).length;
  const needle = filter.trim().toLowerCase();
  const shown = entries.filter((e) => !needle || `${e.title} ${e.category || ''} ${e.key}`.toLowerCase().includes(needle));
  const categories = [...new Set(shown.map((e) => e.category || ''))];

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Content', desc: 'The words the product prints: Help / FAQ and the member educational copy. Fitness, Supplements and Resources live in Care Studio.',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Content' }],
      actions: `<button class="btn btn--primary" type="button" id="newEntry">${icon('plus', { size: 18 })} New entry</button>` })}
    ${H.errorbar(error)}
    ${H.subnav(GROUPS.map((g) => ({ key: g, label: GROUP_LABELS[g], route: '/content/' + g, count: count(g, 'Published') })), group)}

    <div class="statusstrip" style="--strip-tone:var(--status-info)">
      <span class="statusstrip__icon">${icon('lock', { size: 18 })}</span>
      <span class="statusstrip__text"><b>Not content:</b> Health Number weights, Health Assessment bands, Simple Quiz counting, body-fat tables and blood-marker goals are system managed. See <a href="${R.href('/assessments')}">Assessments</a>.</span>
    </div>

    <div class="kpis" style="margin-bottom:var(--s-5)">
      <div class="kpi"><span class="kpi__label">${icon('check-circle', { size: 16 })} Published</span><span class="kpi__value">${count(group, 'Published')}</span><span class="kpi__note">${group === 'help_faq' ? 'on the public Help page' : 'printed in the member application'}</span></div>
      <div class="kpi"><span class="kpi__label">${icon('edit', { size: 16 })} Draft</span><span class="kpi__value">${count(group, 'Draft')}</span><span class="kpi__note">not published</span></div>
      <div class="kpi"><span class="kpi__label">${icon('lock', { size: 16 })} Archived</span><span class="kpi__value">${count(group, 'Archived')}</span><span class="kpi__note">retired</span></div>
    </div>

    <div class="card">
      <div class="findbar">
        <div class="search" style="flex:1 1 260px;max-width:360px;position:relative">
          <span class="search__icon">${icon('search', { size: 18 })}</span>
          <label class="sr-only" for="cSearch">Search entries</label>
          <input class="search__input" id="cSearch" type="search" placeholder="Search by title, category or key" value="${esc(filter)}">
        </div>
      </div>
      <div class="card__body card__body--flush">
        ${shown.length === 0 ? `<p class="empty-row">No entries${filter ? ' match that search' : ' yet'}.</p>` : ''}
        ${categories.map((category) => {
          const rows = shown.filter((e) => (e.category || '') === category);
          return `<div>
            ${categories.length > 1 ? `<div class="t-eyebrow" style="padding:14px 20px 4px">${esc(category || 'General')}</div>` : ''}
            <div class="table-wrap"><table class="table table--rows" data-testid="content-table">
              <thead class="sr-only"><tr><th scope="col">Order</th><th scope="col">Entry</th><th scope="col">Updated</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                ${rows.map((e) => `<tr>
                  <td class="t-num" style="width:56px">${e.display_order}</td>
                  <td><div class="cell-primary">${esc(e.title)}</div><div class="cell-sub">${esc(e.body.length > 140 ? e.body.slice(0, 140) + '…' : e.body)}</div><div class="cell-sub mono">${esc(e.key)}</div></td>
                  <td data-col-priority="low" style="white-space:nowrap">${esc(H.fmtDate(e.updated_at))}<div class="cell-sub">${esc(e.updated_by || '')}</div></td>
                  <td>${H.chip(e.status)}</td>
                  <td style="text-align:right;white-space:nowrap">
                    ${e.status !== 'Archived' ? `<button class="btn btn--secondary btn--sm" type="button" data-edit="${e.id}">Edit</button>` : ''}
                    ${e.status === 'Draft' ? `<button class="btn btn--primary btn--sm" type="button" style="margin-left:6px" data-act="publish" data-id="${e.id}">Publish</button>` : ''}
                    ${e.status === 'Published' ? `<button class="btn btn--ghost btn--sm" type="button" style="margin-left:6px" data-act="unpublish" data-id="${e.id}">Unpublish</button>` : ''}
                    ${e.status !== 'Archived' ? `<button class="btn btn--ghost btn--sm" type="button" style="margin-left:6px" data-act="archive" data-id="${e.id}">Archive</button>` : ''}
                    ${e.status === 'Archived' ? `<button class="btn btn--secondary btn--sm" type="button" data-act="restore" data-id="${e.id}">Restore to draft</button>` : ''}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table></div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;

  outlet.querySelector('#cSearch').addEventListener('input', (e) => {
    filter = e.target.value; render(outlet, route);
    const el = outlet.querySelector('#cSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  });
  outlet.querySelector('#newEntry').addEventListener('click', () => openEditor(null, group, entries.length + 1, outlet, route));
  outlet.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditor(all.find((e) => e.id === b.dataset.edit), group, 0, outlet, route)));
  outlet.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    outlet.querySelectorAll('[data-act]').forEach((x) => { x.disabled = true; });
    const action = b.dataset.act;
    const next = { publish: 'Published', unpublish: 'Draft', archive: 'Archived', restore: 'Draft' }[action];
    setTimeout(() => {
      const at = S.now();
      const me = S.me().name;
      let saved;
      S.set({ contentEntries: S.get().contentEntries.map((e) => (e.id === b.dataset.id ? (saved = { ...e, status: next, updated_at: at, updated_by: me,
        published_at: action === 'publish' ? at : e.published_at, published_by: action === 'publish' ? me : e.published_by }) : e)) });
      S.audit('content.' + action, 'content_entry', saved.id, { group: saved.group, key: saved.key, status: saved.status });
      error = '';
      render(outlet, route);
    }, 300);
  }));
}

function openEditor(entry, group, order, outlet, route) {
  const form = entry
    ? { group: entry.group, key: entry.key, category: entry.category || '', title: entry.title, body: entry.body, display_order: entry.display_order }
    : { group, key: '', category: '', title: '', body: '', display_order: order };
  const fields = () => `<div class="stack gap-5">
    ${H.field({ id: 'ce-group', label: 'Group', type: 'select', options: GROUPS.map((g) => [g, GROUP_LABELS[g]]), value: form.group })}
    ${H.field({ id: 'ce-title', label: form.group === 'help_faq' ? 'Question' : 'Title', value: form.title })}
    <div class="field">
      <label for="ce-key">Key</label>
      <input class="input mono" id="ce-key" value="${esc(form.key)}" ${entry ? 'disabled' : ''}>
      <span class="field__hint">Stable identifier the product reads; letters, numbers and underscores.</span>
    </div>
    ${form.group === 'help_faq' ? `<div class="field">
      <label for="ce-category">Category</label>
      <select class="select" id="ce-category" data-testid="content-category">
        <option value="" disabled ${form.category ? '' : 'selected'}>Choose a category…</option>
        ${HELP_CATEGORIES.map((c) => `<option ${c === form.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      <span class="field__hint">The chip this answer appears under on the Help page.</span>
    </div>` : H.field({ id: 'ce-category', label: 'Category', value: form.category, hint: 'Optional grouping.' })}
    <div class="field">
      <label for="ce-body">${form.group === 'help_faq' ? 'Answer' : 'Copy'}</label>
      <textarea class="textarea" id="ce-body" style="min-height:180px">${esc(form.body)}</textarea>
    </div>
    <div class="field" style="max-width:120px"><label for="ce-order">Display order</label><input class="input" id="ce-order" type="number" min="0" value="${form.display_order}"></div>
  </div>`;

  UI.drawer({
    eyebrow: 'Content',
    title: entry ? `Edit · ${esc(entry.title)}` : 'New entry',
    desc: entry ? `${esc(entry.status)} · ${esc(entry.source || '')}` : 'Saved as a draft; publish it when it is ready.',
    body: `<div id="ceFields">${fields()}</div>`,
    foot: `<button class="btn btn--primary" type="button" id="ceSave" data-testid="content-save">${entry ? 'Save changes' : 'Create draft'}</button>
      <button class="btn btn--ghost" type="button" id="ceCancel">Cancel</button>
      <span class="field__error" id="ceError" style="margin-left:auto" hidden></span>`,
    onMount: (ref) => {
      const host = ref.el.querySelector('#ceFields');
      const read = () => {
        form.group = host.querySelector('#ce-group').value; form.title = host.querySelector('#ce-title').value;
        if (!entry) form.key = host.querySelector('#ce-key').value;
        form.category = host.querySelector('#ce-category').value; form.body = host.querySelector('#ce-body').value;
        form.display_order = Number(host.querySelector('#ce-order').value) || 0;
      };
      const wire = () => host.querySelector('#ce-group').addEventListener('change', () => { read(); if (form.group !== 'help_faq' && HELP_CATEGORIES.includes(form.category)) form.category = ''; host.innerHTML = fields(); wire(); });
      wire();
      ref.el.querySelector('#ceCancel').addEventListener('click', () => ref.close());
      ref.el.querySelector('#ceSave').addEventListener('click', () => {
        read();
        const err = ref.el.querySelector('#ceError');
        const fail = (text) => { err.textContent = text; err.hidden = false; };
        err.hidden = true;
        const key = form.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
        if (!form.title.trim()) return fail('Give the entry a title.');
        if (key.length < 2) return fail('Give the entry a key (letters, numbers, underscores).');
        if (form.group === 'help_faq' && !HELP_CATEGORIES.includes(form.category)) {
          return fail("A Help / FAQ entry must use one of the Help page's categories: " + HELP_CATEGORIES.join(', '));
        }
        const clash = S.get().contentEntries.some((e) => e.group === form.group && e.key === key && (!entry || e.id !== entry.id));
        if (clash) return fail('An entry with this key already exists in that group.');
        H.busy(ref.el.querySelector('#ceSave'), 'Saving…', () => {
          const at = S.now();
          const me = S.me().name;
          const values = { group: form.group, key, category: form.category.trim() || null, title: form.title.trim(), body: form.body,
            display_order: form.display_order, updated_at: at, updated_by: me };
          if (entry) {
            S.set({ contentEntries: S.get().contentEntries.map((e) => (e.id === entry.id ? { ...e, ...values } : e)) });
            S.audit('content.update', 'content_entry', entry.id, { group: values.group, key, status: entry.status });
          } else {
            const created = { id: S.newId(), ...values, status: 'Draft', source: null, published_at: null, published_by: null };
            S.set({ contentEntries: [...S.get().contentEntries, created] });
            S.audit('content.create', 'content_entry', created.id, { group: created.group, key, status: 'Draft' });
          }
          ref.close();
          render(outlet, route);
        });
      });
    },
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.content = { render: (outlet, route) => { filter = ''; error = ''; render(outlet, route); } };

})();
