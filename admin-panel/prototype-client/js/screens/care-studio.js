/* ============================================================================
   Care Studio
   ----------------------------------------------------------------------------
   The console's Care Studio (platform/web app/admin/care/page.tsx): the
   configurable member content — Fitness, Supplements, Resources — as
   metadata with a Draft → Published → Archived lifecycle. Members see
   Published items in their sections, in display order. A video is a YouTube
   address today; an uploaded video is a future object-storage field and is
   shown disabled, as in the console.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const KINDS = ['fitness', 'supplement', 'resource'];
const KIND_LABELS = { fitness: 'Fitness', supplement: 'Supplements', resource: 'Resources' };
const ITEM_LABELS = { fitness: 'fitness', supplement: 'supplement', resource: 'resource' };
const TYPES = ['video', 'program', 'article', 'link', 'copy'];
const TYPE_LABEL = { video: 'YouTube video', program: 'External program', article: 'Article', link: 'Link', copy: 'Educational copy' };
const DESCRIPTIONS = {
  fitness: "Cara's recommendations as VEYE cards: programs open externally, videos embed privacy-enhanced.",
  supplement: 'Approved educational copy with cautions and references. Dosage is chosen by condition, never inferred from a tracker.',
  resource: 'The four Resources cards stay Coming Soon until their content is supplied.',
};

let error = '';

function render(outlet, route) {
  const kind = KINDS.includes(route.params.kind) ? route.params.kind : 'fitness';
  const all = S.get().careItems;
  const items = all.filter((i) => i.kind === kind).sort((a, b) => a.display_order - b.display_order || (a.created_at < b.created_at ? -1 : 1));
  const count = (k, status) => all.filter((i) => i.kind === k && i.status === status).length;

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Care Studio',
      desc: 'The member content Veye configures: fitness recommendations, supplement education and resources. Draft it, publish it, retire it.',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Care Studio' }],
      actions: `<button class="btn btn--primary" type="button" id="newItem">${icon('plus', { size: 18 })} New ${ITEM_LABELS[kind]} item</button>` })}
    ${H.errorbar(error)}
    ${H.subnav(KINDS.map((k) => ({ key: k, label: KIND_LABELS[k], route: '/care/' + k, count: count(k, 'Published') })), kind)}

    <div class="kpis" style="margin-bottom:var(--s-5)">
      <div class="kpi"><span class="kpi__label">${icon('check-circle', { size: 16 })} Published</span><span class="kpi__value">${count(kind, 'Published')}</span><span class="kpi__note">visible to members now</span></div>
      <div class="kpi"><span class="kpi__label">${icon('edit', { size: 16 })} Draft</span><span class="kpi__value">${count(kind, 'Draft')}</span><span class="kpi__note">not shown to members</span></div>
      <div class="kpi"><span class="kpi__label">${icon('lock', { size: 16 })} Archived</span><span class="kpi__value">${count(kind, 'Archived')}</span><span class="kpi__note">retired, kept for reference</span></div>
    </div>

    <div class="card">
      <div class="card__head"><div><h2 class="card__title">${KIND_LABELS[kind]}</h2><p class="t-support">${esc(DESCRIPTIONS[kind])}</p></div></div>
      <div class="card__body card__body--flush">
        ${items.length === 0 ? '<p class="empty-row">Nothing here yet.</p>' : `
        <div class="table-wrap"><table class="table table--rows" data-testid="care-table">
          <thead><tr><th scope="col">Order</th><th scope="col">Item</th><th scope="col" data-col-priority="medium">Type</th><th scope="col" data-col-priority="low">Updated</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            ${items.map((item) => `<tr>
              <td class="t-num">${item.display_order}</td>
              <td><div class="cell-primary">${esc(item.title)}</div><div class="cell-sub">${esc(item.category || '—')}${item.youtube_url ? ' · ' + esc(item.youtube_url) : item.external_url ? ' · ' + esc(item.external_url) : ''}</div></td>
              <td data-col-priority="medium">${TYPE_LABEL[item.content_type]}</td>
              <td data-col-priority="low">${esc(H.fmtDate(item.updated_at))}<div class="cell-sub">${esc(item.updated_by || '')}</div></td>
              <td>${H.chip(item.status)}</td>
              <td style="text-align:right;white-space:nowrap">
                ${item.status !== 'Archived' ? `<button class="btn btn--secondary btn--sm" type="button" data-edit="${item.id}">Edit</button>` : ''}
                ${item.status === 'Draft' ? `<button class="btn btn--primary btn--sm" type="button" style="margin-left:6px" data-act="publish" data-id="${item.id}">Publish</button>` : ''}
                ${item.status === 'Published' ? `<button class="btn btn--ghost btn--sm" type="button" style="margin-left:6px" data-act="unpublish" data-id="${item.id}">Unpublish</button>` : ''}
                ${item.status !== 'Archived' ? `<button class="btn btn--ghost btn--sm" type="button" style="margin-left:6px" data-act="archive" data-id="${item.id}">Archive</button>` : ''}
                ${item.status === 'Archived' ? `<button class="btn btn--secondary btn--sm" type="button" data-act="restore" data-id="${item.id}">Restore to draft</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
      <div class="card__foot"><span class="t-support">Published items appear in the member's ${KIND_LABELS[kind]} section in display order. Uploaded video (object storage) is a future field: today a video is a YouTube address.</span></div>
    </div>
  </div>`;

  outlet.querySelector('#newItem').addEventListener('click', () => openEditor(null, kind, items.length + 1, outlet, route));
  outlet.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditor(all.find((i) => i.id === b.dataset.edit), kind, 0, outlet, route)));
  outlet.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    outlet.querySelectorAll('[data-act]').forEach((x) => { x.disabled = true; });
    const action = b.dataset.act;
    const next = { publish: 'Published', unpublish: 'Draft', archive: 'Archived', restore: 'Draft' }[action];
    setTimeout(() => {
      const at = S.now();
      const me = S.me().name;
      let saved = null;
      S.set({ careItems: S.get().careItems.map((i) => {
        if (i.id !== b.dataset.id) return i;
        saved = { ...i, status: next, updated_at: at, updated_by: me,
          published_at: action === 'publish' ? at : i.published_at, published_by: action === 'publish' ? me : i.published_by };
        return saved;
      }) });
      S.audit('care.' + action, 'care_content_item', saved.id, { kind: saved.kind, title: saved.title, status: saved.status });
      error = '';
      render(outlet, route);
    }, 300);
  }));
}

function openEditor(item, kind, order, outlet, route) {
  const form = item
    ? { kind: item.kind, title: item.title, description: item.description, category: item.category || '', content_type: item.content_type,
        youtube_url: item.youtube_url || '', external_url: item.external_url || '', body: item.body, cautions: item.cautions || '',
        references: item.references || '', display_order: item.display_order }
    : { kind, title: '', description: '', category: '', content_type: 'copy', youtube_url: '', external_url: '', body: '', cautions: '', references: '', display_order: order };

  const fieldsHtml = () => `
    <div class="stack gap-5">
      ${H.field({ id: 'ci-kind', label: 'Area', type: 'select', options: KINDS.map((k) => [k, KIND_LABELS[k]]), value: form.kind })}
      ${H.field({ id: 'ci-title', label: 'Title', value: form.title })}
      ${H.field({ id: 'ci-category', label: 'Category', value: form.category, hint: 'e.g. Martial Arts &amp; Boxing, Omega 3, Resources' })}
      ${H.field({ id: 'ci-type', label: 'Content type', type: 'select', options: TYPES.map((t) => [t, TYPE_LABEL[t]]), value: form.content_type })}
      ${H.field({ id: 'ci-desc', label: 'Description', type: 'textarea', rows: 3, value: form.description, hint: 'The short line on the member card.' })}
      ${form.content_type === 'video' || form.youtube_url ? H.field({ id: 'ci-yt', label: 'YouTube address', value: form.youtube_url, placeholder: 'https://youtu.be/…', hint: 'Embeds through youtube-nocookie.com, lazily, without autoplay.' }) : ''}
      ${['program', 'link'].includes(form.content_type) || form.external_url ? H.field({ id: 'ci-ext', label: 'External address', value: form.external_url, placeholder: 'https://…', hint: 'Opens in a new tab; never framed.' }) : ''}
      ${H.field({ id: 'ci-body', label: form.kind === 'supplement' ? 'Approved educational copy' : 'Body', type: 'textarea', rows: 6, value: form.body,
        hint: form.kind === 'supplement' ? 'Client-approved wording only.' : 'Longer text shown when the item opens.' })}
      ${form.kind === 'supplement' ? H.field({ id: 'ci-cautions', label: 'Cautions / disclaimer', type: 'textarea', rows: 3, value: form.cautions })
        + H.field({ id: 'ci-refs', label: 'References', type: 'textarea', rows: 3, value: form.references, hint: 'Citations pending clinical review.' }) : ''}
      ${H.field({ id: 'ci-video-key', label: 'Uploaded video (future)', value: '', disabled: true, hint: "Object-storage key once Veye's object store is chosen. Not used by the member product yet." })}
      <div class="field" style="max-width:120px">
        <label for="ci-order">Display order</label>
        <input class="input" id="ci-order" type="number" min="0" value="${form.display_order}">
      </div>
    </div>`;

  UI.drawer({
    eyebrow: 'Care Studio',
    title: item ? `Edit · ${esc(item.title)}` : `New ${ITEM_LABELS[kind]} item`,
    desc: item ? `${esc(item.status)} · last updated ${esc(H.fmtDate(item.updated_at))}` : 'Saved as a draft; publish it when it is ready.',
    body: `<div id="ciFields">${fieldsHtml()}</div>`,
    foot: `<button class="btn btn--primary" type="button" id="ciSave" data-testid="care-save">${item ? 'Save changes' : 'Create draft'}</button>
      <button class="btn btn--ghost" type="button" id="ciCancel">Cancel</button>
      <span class="field__error" id="ciError" style="margin-left:auto" hidden></span>`,
    onMount: (ref) => {
      const host = ref.el.querySelector('#ciFields');
      const read = () => {
        const v = (id) => { const el = host.querySelector('#' + id); return el ? el.value : undefined; };
        form.kind = v('ci-kind'); form.title = v('ci-title'); form.category = v('ci-category'); form.content_type = v('ci-type');
        form.description = v('ci-desc'); form.body = v('ci-body');
        if (v('ci-yt') !== undefined) form.youtube_url = v('ci-yt');
        if (v('ci-ext') !== undefined) form.external_url = v('ci-ext');
        if (v('ci-cautions') !== undefined) form.cautions = v('ci-cautions');
        if (v('ci-refs') !== undefined) form.references = v('ci-refs');
        form.display_order = Number(v('ci-order')) || 0;
      };
      const wire = () => {
        ['ci-kind', 'ci-type'].forEach((id) => host.querySelector('#' + id).addEventListener('change', () => { read(); host.innerHTML = fieldsHtml(); wire(); }));
      };
      wire();
      ref.el.querySelector('#ciCancel').addEventListener('click', () => ref.close());
      ref.el.querySelector('#ciSave').addEventListener('click', () => {
        read();
        const err = ref.el.querySelector('#ciError');
        const fail = (text) => { err.textContent = text; err.hidden = false; };
        err.hidden = true;
        if (!form.title.trim()) return fail('Give the item a title.');
        const yt = form.youtube_url.trim();
        const ext = form.external_url.trim();
        if (yt && !/^https:\/\//.test(yt)) return fail('Enter a full web address starting with https://');
        if (yt && !/^https:\/\/((www\.|m\.)?youtube\.com|youtu\.be)\//.test(yt)) return fail('The YouTube address must be on youtube.com or youtu.be.');
        if (ext && !/^https:\/\/\S+\.\S+/.test(ext)) return fail('Enter a full web address starting with https://');
        H.busy(ref.el.querySelector('#ciSave'), 'Saving…', () => {
          const at = S.now();
          const me = S.me().name;
          const values = { kind: form.kind, title: form.title.trim(), description: form.description, category: form.category.trim() || null,
            content_type: form.content_type, youtube_url: yt || null, external_url: ext || null, body: form.body,
            cautions: form.kind === 'supplement' ? (form.cautions.trim() || null) : (item ? item.cautions : null),
            references: form.kind === 'supplement' ? (form.references.trim() || null) : (item ? item.references : null),
            display_order: form.display_order, updated_at: at, updated_by: me };
          let saved;
          if (item) {
            S.set({ careItems: S.get().careItems.map((i) => (i.id === item.id ? (saved = { ...i, ...values }) : i)) });
            S.audit('care.update', 'care_content_item', item.id, { kind: values.kind, title: values.title, status: item.status });
          } else {
            saved = { id: S.newId(), ...values, video_object_key: null, status: 'Draft', source: null, created_at: at, published_at: null, published_by: null };
            S.set({ careItems: [...S.get().careItems, saved] });
            S.audit('care.create', 'care_content_item', saved.id, { kind: saved.kind, title: saved.title, status: 'Draft' });
          }
          ref.close();
          render(outlet, route);
        });
      });
    },
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens['care-studio'] = { render: (outlet, route) => { error = ''; render(outlet, route); } };

})();
