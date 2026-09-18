/* ============================================================================
   Content
   ----------------------------------------------------------------------------
   Five sections: Website, Dashboard Content, Resources & Media, Notifications
   and Legal Documents.

   Resources & Media is LIVE (20 Aug 2026): the member Resources screen is open
   with four Coming Soon cards, and this section edits them.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const MODES = [
  { key: 'website',       label: 'Website',           route: '/content/website' },
  { key: 'dashboard',     label: 'Dashboard Content', route: '/content/dashboard' },
  /* Live since 20 Aug 2026 — the member Resources screen and its four cards. */
  { key: 'resources',     label: 'Resources & Media', route: '/content/resources' },
  { key: 'notifications', label: 'Notifications',     route: '/content/notifications' },
  { key: 'legal',         label: 'Legal Documents',   route: '/content/legal' },
];

function render(outlet, route) {
  const mode = route.params.mode || 'website';
  const real = MODES.map((m) => m.key);

  /* Resources has its own renderer as a retained Phase 2 reference. */
  if (mode === 'resources') { resourcesLive(outlet); return; }

  if (!real.includes(mode)) {
    outlet.innerHTML = `<div class="page">
      ${H.pageHead({ title: 'Content',
        crumbs: [{ label: 'Home', route: '/home' }, { label: 'Content' }],
        desc: `Content has no section called <code>${esc(mode)}</code>.` })}
      ${H.subnav(MODES, null)}
      <div class="card"><div class="card__body">${H.emptyState({
        icon: 'compass', title: 'Pick a section above',
        msg: 'Website, dashboard content, notifications and legal documents.',
        action: `<a class="btn btn--primary" href="${R.href('/content/website')}">Open Website</a>`,
      })}</div></div></div>`;
    return;
  }

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: 'Content',
      desc: 'Every word members and visitors read, from the announcement bar to the privacy policy.',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Content' }],
      where: 'content',
      actions: headActions(mode),
    })}
    ${H.subnav(MODES, mode)}
    <div id="ctBody"></div>
  </div>`;

  const body = outlet.querySelector('#ctBody');
  ({ website, dashboard, notifications, legal })[mode](body);

  const add = outlet.querySelector('#addBtn');
  if (add) add.addEventListener('click', () => ({
    dashboard: () => editDashboard(null, body),
    notifications: () => editNotice(null, body),
    legal: () => newLegal(body),
  })[mode]());
}

function headActions(mode) {
  if (mode === 'dashboard') return `<button class="btn btn--primary" id="addBtn">${icon('plus', { size: 18 })} New item</button>`;
  if (mode === 'notifications') return `<button class="btn btn--primary" id="addBtn">${icon('plus', { size: 18 })} New notice</button>`;
  if (mode === 'legal') return `<button class="btn btn--primary" id="addBtn">${icon('plus', { size: 18 })} New document</button>`;
  return '';
}

/* ------------------------------------------------------------------ website -- */
function website(host) {
  const st = S.get();

  host.innerHTML = `
    <section class="lead">
      <div>
        <h2>The public site</h2>
        <p>These are the parts of veye.com the team changes most: the announcement bar, the home page
           sections, the pricing wording and the help content. Editing here changes what a visitor reads.</p>
      </div>
      <div class="minirow" style="min-width:250px">
        <div class="mini"><span class="mini__n">${st.website.length}</span><span class="mini__l">Sections</span></div>
        <div class="mini"><span class="mini__n">${st.website.filter((w) => w.status === 'Draft').length}</span><span class="mini__l">In draft</span></div>
      </div>
    </section>

    <div class="card defer" data-reveal><div class="card__body card__body--flush">
      <div class="rows">${st.website.map((w) => `
        <div class="rowitem">
          <span class="rowitem__icon">${icon('file-text', { size: 18 })}</span>
          <div>
            <div class="rowitem__title">${esc(w.section)} ${H.chip(w.status)}</div>
            <div class="rowitem__meta">${esc(w.where)} · updated ${esc(w.updated)}</div>
            <div class="rowitem__meta">${esc(w.fields[0].value.slice(0, 96))}${w.fields[0].value.length > 96 ? '…' : ''}</div>
          </div>
          <div class="rowitem__side">
            <button class="btn btn--ghost btn--sm" data-prev="${w.id}">Preview</button>
            <button class="btn btn--secondary btn--sm" data-edit="${w.id}">Edit<span class="sr-only"> ${esc(w.section)}</span></button>
          </div>
        </div>`).join('')}</div>
    </div></div>`;

  host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    editWebsite(S.get().website.find((w) => w.id === b.dataset.edit), host);
  }));
  host.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => {
    const w = S.get().website.find((x) => x.id === b.dataset.prev);
    UI.drawer({
      eyebrow: 'Preview', title: w.section, desc: w.where,
      body: `<div class="card"><div class="card__body">
        ${w.fields.map((f) => `<div style="margin-bottom:20px">
          <div class="t-eyebrow">${esc(f.label)}</div>
          <p style="margin-top:6px;font-size:${f.type === 'short' ? '20px' : '15px'};color:var(--text-body);${f.type === 'short' ? 'font-family:var(--font-display);font-weight:600;' : ''}">${esc(f.value)}</p>
        </div>`).join('')}
      </div></div>
      <p class="t-support" style="margin-top:16px">This is the wording only. The live page applies the site's own layout and imagery.</p>`,
    });
  }));
}

/* Editing a website section is a split view on a wide screen: the fields on the
   left, a live preview of the same wording on the right. On a phone the preview
   is one button away instead, because a split of two half-width columns is worse
   than either one alone. */
function editWebsite(w, host) {
  const previewHtml = (get) => `<div class="wpreview">
      <div class="wpreview__chrome">${esc(w.where)}</div>
      <div class="wpreview__body">
        ${w.fields.map((f, i) => `<div class="wpreview__field">
          <span class="t-eyebrow">${esc(f.label)}</span>
          <p class="${f.type === 'short' ? 'wpreview__head' : 'wpreview__text'}">${esc(get(i))}</p>
        </div>`).join('')}
      </div>
    </div>`;

  UI.drawer({
    eyebrow: 'Website section',
    title: w.section,
    desc: w.where,
    body: `<div class="splitedit">
      <div class="splitedit__form stack gap-5" id="wsFields">
        ${w.fields.map((f, i) => H.field({
          id: 'wf-' + i, label: f.label, type: f.type === 'text' ? 'textarea' : 'text', rows: 3, value: f.value,
        })).join('')}
        ${H.field({ id: 'wf-status', label: 'Status', type: 'select', options: ['Live', 'Draft'], value: w.status,
          hint: 'A draft is not shown to visitors.' })}
        <button class="btn btn--secondary splitedit__previewbtn" id="wsPreviewBtn">
          ${icon('eye', { size: 16 })} Preview these words</button>
      </div>
      <div class="splitedit__preview" id="wsPreview">${previewHtml((i) => w.fields[i].value)}</div>
    </div>`,
    foot: `<button class="btn btn--secondary" id="wsCancel">Cancel</button>
           <button class="btn btn--primary" id="wsSave">Save changes</button>`,
    onMount: (ref) => {
      const preview = ref.el.querySelector('#wsPreview');
      const read = (i) => ref.el.querySelector('#wf-' + i).value;
      const refresh = () => { preview.innerHTML = previewHtml(read); };
      w.fields.forEach((_, i) => ref.el.querySelector('#wf-' + i).addEventListener('input', refresh));

      ref.el.querySelector('#wsPreviewBtn').addEventListener('click', () => {
        UI.modal({
          title: 'Preview — ' + w.section, desc: w.where, size: 'wide',
          body: previewHtml(read),
          actions: [{ label: 'Close', variant: 'secondary', value: 'close', autofocus: true }],
        });
      });

      ref.el.querySelector('#wsCancel').addEventListener('click', () => ref.close());
      ref.el.querySelector('#wsSave').addEventListener('click', (e) => {
        const empty = w.fields.findIndex((_, i) => !ref.el.querySelector('#wf-' + i).value.trim());
        if (empty > -1) { H.fieldError(ref.el, 'wf-' + empty, 'This part of the page cannot be left blank.'); return; }
        H.withSaving(e.currentTarget, () => {
          const st = S.get();
          S.set({ website: st.website.map((x) => x.id === w.id ? {
            ...x, updated: 'Today', status: ref.el.querySelector('#wf-status').value,
            fields: x.fields.map((f, i) => ({ ...f, value: ref.el.querySelector('#wf-' + i).value.trim() })),
          } : x) });
          S.note('Edited the ' + w.section + ' website section');
          ref.close();
          website(host);
          UI.toast({ title: 'Website updated', message: w.section + ' is saved.' });
        });
      });
    },
  });
}

/* -------------------------------------------------------- dashboard content -- */
function dashboard(host) {
  const st = S.get();
  const groups = ['Daily tip', 'Personal tip', 'Feature card', 'Section notice', 'Help content'];

  host.innerHTML = `
    <section class="lead">
      <div>
        <h2>Inside the member dashboard</h2>
        <p>Tips, feature wording, help content and the Coming Soon labels. Personal tips are shown to
           members who match a rule; everything else is shown to everyone.</p>
      </div>
    </section>
    ${groups.map((g, gi) => {
      const rows = st.dashboardContent.filter((d) => d.kind === g);
      if (!rows.length) return '';
      /* Every group is skipped by the browser until it is near the viewport —
         that costs nothing and the reserved height keeps the scrollbar steady.

         Only the groups from the third down RISE, though. The first two are on
         screen when the route arrives, so animating them would be animating
         something the reader is already looking at, and five staggered groups
         reads as a queue rather than an arrival. Three reveals, one screen. */
      return `${H.sec(g, rows.length + ' item' + (rows.length === 1 ? '' : 's'))}
        <div class="contentgrid defer defer--short"${gi >= 2 ? ' data-reveal' : ''}>
          ${rows.map((d) => `
            <article class="ccard">
              <div class="ccard__band ${d.kind === 'Personal tip' ? 'ccard__band--article' : d.kind === 'Section notice' ? 'ccard__band--recipe' : ''}">
                ${icon(d.kind === 'Help content' ? 'help' : d.kind === 'Section notice' ? 'clock' : 'sparkle-off', { size: 24 })}
              </div>
              <div class="ccard__body">
                <div class="row gap-2 wrap" style="align-items:center">
                  <h3 style="font-size:var(--fs-body-lg)">${esc(d.title)}</h3>
                </div>
                <p class="t-support" style="margin-top:6px">${esc(d.body)}</p>
                <p class="t-support" style="margin-top:8px"><b>Shown to:</b> ${esc(d.audience)}</p>
              </div>
              <div class="ccard__foot">
                <span>${esc(d.updated)}</span>
                <button class="btn btn--ghost btn--sm" data-dc="${d.id}">Edit<span class="sr-only"> ${esc(d.title)}</span></button>
              </div>
            </article>`).join('')}
        </div>`;
    }).join('')}`;

  host.querySelectorAll('[data-dc]').forEach((b) => b.addEventListener('click', () => {
    editDashboard(S.get().dashboardContent.find((d) => d.id === b.dataset.dc), host);
  }));
}

function editDashboard(existing, host) {
  UI.modal({
    title: existing ? 'Edit “' + existing.title + '”' : 'New dashboard item',
    size: 'wide',
    body: `<div class="form-grid form-grid--1">
      ${H.field({ id: 'dc-title', label: 'Title', required: true, value: existing ? existing.title : '' })}
      ${H.field({ id: 'dc-body', label: 'Wording', type: 'textarea', rows: 3, value: existing ? existing.body : '' })}
      ${H.field({ id: 'dc-kind', label: 'Kind', type: 'select', value: existing ? existing.kind : 'Daily tip',
        options: ['Daily tip', 'Personal tip', 'Feature card', 'Help content'] })}
      ${H.field({ id: 'dc-aud', label: 'Shown to', value: existing ? existing.audience : 'Everyone',
        hint: 'A personal tip needs a rule, for example “Answered No to sleeping well”.' })}
    </div>
    <div class="notice notice--quiet" style="margin-top:16px">${icon('info', { size: 18 })}
      <div>Keep dashboard wording non-medical. Nothing here should read as a diagnosis or a promise
      about an outcome.</div></div>`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: existing ? 'Save changes' : 'Create the item', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const title = ref.el.querySelector('#dc-title').value.trim();
        if (!title) { H.fieldError(ref.el, 'dc-title', 'Give it a title.'); return false; }
        const body = ref.el.querySelector('#dc-body').value.trim();
        if (!body) { H.fieldError(ref.el, 'dc-body', 'Write the wording members will read.'); return false; }
        const patch = { title, body, kind: ref.el.querySelector('#dc-kind').value,
          audience: ref.el.querySelector('#dc-aud').value.trim() || 'Everyone', updated: 'Today', status: 'Live' };
        const st = S.get();
        S.set({ dashboardContent: existing
          ? st.dashboardContent.map((d) => d.id === existing.id ? { ...d, ...patch } : d)
          : [{ id: 'DC-' + (st.dashboardContent.length + 20), ...patch }].concat(st.dashboardContent) });
        S.note((existing ? 'Edited' : 'Created') + ' dashboard content “' + title + '”');
        dashboard(host);
        UI.toast({ title: existing ? 'Item saved' : 'Item created', message: title + ' is live on the dashboard.' });
      } },
    ],
  });
}

/* --------------------------------------------------------------- resources -- */
function resourcesLive(outlet) {
  const st = S.get();
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: 'Content',
      desc: 'Every word members and visitors read, from the announcement bar to the privacy policy.',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Content' }, { label: 'Resources & Media' }],
      where: 'content',
    })}
    ${H.subnav(MODES, 'resources')}
    <section class="lead">
      <div><div class="row gap-3" style="align-items:center"><h2>Resources &amp; Media</h2><span class="chip chip--draft">Phase 2</span></div>
      <p>The Resources destination is planned after the Beta. Its earlier prototype cards and draft articles are preserved, but this console does not present them as live member content.</p></div>
    </section>
    <div class="card" data-reveal><div class="card__head"><div><h2 class="card__title">Preserved reference content</h2><p class="t-support">These four themes came from the approved website direction and will be revisited for Phase 2.</p></div></div>
      <div class="card__body card__body--flush"><div class="rows">
      ${st.memberSections.resources.cards.slice().sort((a,b)=>a.order-b.order).map(c=>`<div class="rowitem"><span class="rowitem__icon rowitem__icon--off">${icon('file-text',{size:18})}</span><div><div class="rowitem__title">${esc(c.title)}</div><div class="rowitem__meta">${esc(c.desc)}</div></div><span class="chip chip--draft">Phase 2</span></div>`).join('')}
      </div></div><div class="card__foot"><span class="t-support">No publishing or member-visibility control is available until this feature is brought into scope.</span></div></div>
  </div>`;
  return;
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: 'Content',
      desc: 'Every word members and visitors read, from the announcement bar to the privacy policy.',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Content' }, { label: 'Resources & Media' }],
      where: 'content',
    })}
    ${H.subnav(MODES, 'resources')}

    <section class="lead">
      <div>
        <div class="row gap-3" style="align-items:center">
          <h2>Resources &amp; Media</h2>
          <span class="chip chip--live">Live for members</span>
        </div>
        <p>The member Resources screen is open and says
           &ldquo;${esc(st.memberSections.resources.devNote)}&rdquo; Its four cards below carry the client
           copy; each is marked Coming Soon until its content is ready.</p>
      </div>
    </section>

    <div class="card" data-reveal>
      <div class="card__head"><div><h2 class="card__title">The four member cards</h2>
        <p class="t-support">Exactly what a member reads on Resources. Reorder with the arrows; the
          Coming Soon buttons on the member screen stay disabled until a card is switched live.</p></div></div>
      <div class="card__body card__body--flush">
        <div class="rows" id="resCards">
          ${st.memberSections.resources.cards.slice().sort((a, b) => a.order - b.order).map((c, i2, arr) => `
          <div class="rowitem">
            <span class="rowitem__icon">${icon('file-text', { size: 18 })}</span>
            <div>
              <div class="rowitem__title">${esc(c.title)}</div>
              <div class="rowitem__meta">${esc(c.desc.slice(0, 110))}&hellip;</div>
            </div>
            <div class="rowitem__side">
              ${H.chip(c.status)}
              <button class="btn btn--ghost btn--sm" data-rc-up="${c.id}" ${i2 === 0 ? 'disabled' : ''} aria-label="Move ${esc(c.title)} up">&uarr;</button>
              <button class="btn btn--ghost btn--sm" data-rc-down="${c.id}" ${i2 === arr.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(c.title)} down">&darr;</button>
              <button class="btn btn--secondary btn--sm" data-rc-edit="${c.id}">Edit<span class="sr-only"> ${esc(c.title)}</span></button>
            </div>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card defer defer--short" data-reveal style="margin-top:var(--grid-gutter)">
      <div class="card__head"><div><h2 class="card__title">Articles, downloads and videos</h2>
        <p class="t-support">Drafts waiting for the cards to open. Nothing has been deleted.</p></div></div>
      <div class="card__body card__body--flush">
        <div class="table-wrap"><table class="table">
          <caption class="sr-only">Resource drafts</caption>
          <thead><tr><th scope="col">Title</th><th scope="col">Kind</th><th scope="col">Last updated</th><th scope="col">State</th></tr></thead>
          <tbody>${st.resources.map((r) => `<tr>
            <th scope="row">${esc(r.title)}</th><td>${esc(r.kind)}</td><td>${esc(r.updated)}</td>
            <td>${H.chip(r.status)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>
  </div>`;

  wireResourceCards(outlet);
}

/* ------------------------------------------------ member resource cards ----- */
function wireResourceCards(outlet) {
  const rerender = () => { render(outlet, { params: { mode: 'resources' }, path: '/content/resources' }); window.Veye.M.scan(outlet); };
  const move = (id, dir) => {
    const st = S.get();
    const cards = st.memberSections.resources.cards.slice().sort((a, b) => a.order - b.order);
    const i = cards.findIndex((c) => c.id === id);
    const swap = i + dir;
    if (swap < 0 || swap >= cards.length) return;
    const a = cards[i], b = cards[swap];
    const t = a.order; a.order = b.order; b.order = t;
    S.set({ memberSections: { ...st.memberSections, resources: { ...st.memberSections.resources, cards } } });
    S.note('Reordered the member resource cards');
    rerender();
  };
  outlet.querySelectorAll('[data-rc-up]').forEach((b) => b.addEventListener('click', () => move(b.dataset.rcUp, -1)));
  outlet.querySelectorAll('[data-rc-down]').forEach((b) => b.addEventListener('click', () => move(b.dataset.rcDown, 1)));
  outlet.querySelectorAll('[data-rc-edit]').forEach((b) => b.addEventListener('click', () => {
    const st = S.get();
    const card = st.memberSections.resources.cards.find((c) => c.id === b.dataset.rcEdit);
    UI.drawer({
      eyebrow: 'Member resource card',
      title: card.title,
      desc: 'Exactly what the member reads on this card.',
      body: `<div class="stack gap-5">
        ${H.field({ id: 'rc-title', label: 'Title', required: true, value: card.title })}
        ${H.field({ id: 'rc-desc', label: 'Description', type: 'textarea', rows: 5, value: card.desc })}
        ${H.field({ id: 'rc-status', label: 'Status', type: 'select', value: card.status,
                    options: ['Coming Soon', 'Live'],
                    hint: 'Coming Soon keeps the member button disabled with no arrow.' })}
      </div>`,
      foot: `<button class="btn btn--primary" id="rcSave">Save changes</button>`,
      onMount: (ref) => {
        ref.el.querySelector('#rcSave').addEventListener('click', () => {
          const title = ref.el.querySelector('#rc-title').value.trim();
          if (!title) { H.fieldError(ref.el, 'rc-title', 'A card needs a title.'); return; }
          const cards = st.memberSections.resources.cards.map((c) => c.id === card.id
            ? { ...c, title, desc: ref.el.querySelector('#rc-desc').value.trim(),
                status: ref.el.querySelector('#rc-status').value } : c);
          S.set({ memberSections: { ...st.memberSections, resources: { ...st.memberSections.resources, cards } } });
          S.note('Edited the member resource card ' + title);
          ref.close();
          UI.toast({ title: 'Card saved', message: 'In production, ' + title + ' is what members would read. Prototype: saved in this browser only.' });
          wireResourceCards(outlet);
          render(outlet, { params: { mode: 'resources' }, path: '/content/resources' });
          window.Veye.M.scan(outlet);
        });
      },
    });
  }));
}

/* ----------------------------------------------------------- notifications -- */
function notifications(host) {
  const st = S.get();

  host.innerHTML = `
    <section class="lead">
      <div>
        <h2>Notices members receive</h2>
        <p>In-app notices and email notices. Draft one, preview it, then make it active. There is no
           approval step and no audience permission tree — the audience is a plain description.</p>
      </div>
      <div class="minirow" style="min-width:250px">
        <div class="mini"><span class="mini__n">${st.notices.filter((n) => n.status === 'Active').length}</span><span class="mini__l">Active</span></div>
        <div class="mini"><span class="mini__n">${st.notices.filter((n) => n.status === 'Draft').length}</span><span class="mini__l">Draft</span></div>
      </div>
    </section>

    <div class="card"><div class="card__body card__body--flush">
      <div class="rows">${st.notices.map((n) => `
        <div class="rowitem">
          <span class="rowitem__icon${n.status === 'Active' ? '' : ' rowitem__icon--off'}">
            ${icon(n.channel === 'Email' ? 'send' : 'megaphone', { size: 18 })}</span>
          <div>
            <div class="rowitem__title">${esc(n.title)} ${H.chip(n.status)}</div>
            <div class="rowitem__meta">${esc(n.body)}</div>
            <div class="rowitem__meta">${esc(n.channel)} · ${esc(n.audience)} · updated ${esc(n.updated)}</div>
          </div>
          <div class="rowitem__side">
            <button class="btn btn--ghost btn--sm" data-prev="${n.id}">Preview</button>
            <button class="btn btn--secondary btn--sm" data-edit="${n.id}">Edit<span class="sr-only"> ${esc(n.title)}</span></button>
            <button class="btn btn--ghost btn--sm" data-toggle="${n.id}">${n.status === 'Active' ? 'Turn off' : 'Turn on'}</button>
          </div>
        </div>`).join('')}</div>
    </div></div>`;

  host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    editNotice(S.get().notices.find((n) => n.id === b.dataset.edit), host);
  }));
  host.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => {
    const n = S.get().notices.find((x) => x.id === b.dataset.prev);
    UI.modal({
      title: 'Preview', desc: n.channel === 'Email' ? 'As it arrives by email' : 'As it appears in the dashboard',
      body: `<div class="card"><div class="card__body">
        <div class="t-eyebrow">${esc(n.channel)}</div>
        <h3 style="margin-top:6px">${esc(n.title)}</h3>
        <p style="margin-top:8px;color:var(--text-body)">${esc(n.body)}</p>
      </div></div>
      <p class="t-support" style="margin-top:12px">Shown to: ${esc(n.audience)}.</p>`,
      actions: [{ label: 'Close', variant: 'secondary', value: 'close', autofocus: true }],
    });
  }));
  host.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const st2 = S.get();
    const n = st2.notices.find((x) => x.id === b.dataset.toggle);
    const next = n.status === 'Active' ? 'Inactive' : 'Active';
    S.set({ notices: st2.notices.map((x) => x.id === n.id ? { ...x, status: next, updated: 'Today' } : x) });
    S.note((next === 'Active' ? 'Turned on' : 'Turned off') + ' the notice “' + n.title + '”');
    notifications(host);
    UI.toast({ title: next === 'Active' ? 'Notice is on' : 'Notice is off',
      message: next === 'Active' ? esc(n.audience) + ' will see it.' : 'Members no longer see it.' });
  }));
}

function editNotice(existing, host) {
  UI.modal({
    title: existing ? 'Edit “' + existing.title + '”' : 'New notice',
    size: 'wide',
    body: `<div class="form-grid form-grid--1">
      ${H.field({ id: 'no-title', label: 'Title', required: true, value: existing ? existing.title : '' })}
      ${H.field({ id: 'no-body', label: 'Message', type: 'textarea', rows: 3, value: existing ? existing.body : '' })}
      ${H.field({ id: 'no-channel', label: 'Where it appears', type: 'select', options: ['In-app', 'Email'],
        value: existing ? existing.channel : 'In-app' })}
      ${H.field({ id: 'no-aud', label: 'Who sees it', value: existing ? existing.audience : 'Everyone' })}
      ${H.field({ id: 'no-status', label: 'State', type: 'select', options: ['Draft', 'Active', 'Scheduled', 'Inactive'],
        value: existing ? existing.status : 'Draft' })}
    </div>`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: existing ? 'Save the notice' : 'Create the notice', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const title = ref.el.querySelector('#no-title').value.trim();
        if (!title) { H.fieldError(ref.el, 'no-title', 'Give the notice a title.'); return false; }
        const body = ref.el.querySelector('#no-body').value.trim();
        if (!body) { H.fieldError(ref.el, 'no-body', 'Write the message members will read.'); return false; }
        const patch = { title, body, channel: ref.el.querySelector('#no-channel').value,
          audience: ref.el.querySelector('#no-aud').value.trim() || 'Everyone',
          status: ref.el.querySelector('#no-status').value, updated: 'Today' };
        const st = S.get();
        S.set({ notices: existing
          ? st.notices.map((n) => n.id === existing.id ? { ...n, ...patch } : n)
          : [{ id: 'NO-' + (st.notices.length + 20), ...patch }].concat(st.notices) });
        S.note((existing ? 'Edited' : 'Created') + ' the notice “' + title + '”');
        notifications(host);
        UI.toast({ title: existing ? 'Notice saved' : 'Notice created' });
      } },
    ],
  });
}

/* --------------------------------------------------------- legal documents -- */
function legal(host) {
  const st = S.get();

  host.innerHTML = `
    <div class="notice notice--warn" style="margin-bottom:var(--s-6)">
      ${icon('alert-triangle', { size: 18 })}
      <div><b>The wording below is placeholder prototype content.</b> It shows how the console manages
      versions, publishing and re-acceptance. The text members actually agree to has to be drafted and
      approved by legal counsel, and nothing here should be presented as a finished policy.</div>
    </div>

    <div class="card"><div class="card__body card__body--flush">
      <div class="rows">${st.legalDocs.map((d) => `
        <div class="rowitem">
          <span class="rowitem__icon${d.state === 'Published' ? '' : ' rowitem__icon--warn'}">${icon('shield-check', { size: 18 })}</span>
          <div>
            <div class="rowitem__title">${esc(d.title)} ${H.chip(d.state)}</div>
            <div class="rowitem__meta">${esc(d.category)} · ${esc(d.version)} · effective ${esc(d.effective)}</div>
            <div class="rowitem__meta">
              ${H.n(d.accepted)} of ${H.n(d.of)} members have accepted this version
              <span class="bar__track" style="width:120px;display:inline-block;vertical-align:middle;margin-left:8px">
                <span class="bar__fill${d.accepted / d.of < 0.95 ? ' bar__fill--warn' : ''}" data-grow style="width:${(d.accepted / d.of * 100).toFixed(0)}%"></span></span>
            </div>
          </div>
          <div class="rowitem__side">
            <button class="btn btn--ghost btn--sm" data-prev="${d.id}">Preview</button>
            <button class="btn btn--ghost btn--sm" data-dl="${d.id}">Download</button>
            <button class="btn btn--secondary btn--sm" data-edit="${d.id}">Edit<span class="sr-only"> ${esc(d.title)}</span></button>
            <button class="btn btn--secondary btn--sm" data-more="${d.id}">More</button>
          </div>
        </div>`).join('')}</div>
    </div></div>`;

  const find = (id) => S.get().legalDocs.find((d) => d.id === id);

  host.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => {
    const d = find(b.dataset.prev);
    UI.modal({
      title: d.title, desc: `${d.version} · effective ${d.effective} · ${d.state}`, size: 'wide',
      body: `<div class="doctext">${esc(d.body)}</div>`,
      actions: [{ label: 'Close', variant: 'secondary', value: 'close', autofocus: true }],
    });
  }));

  host.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => {
    const d = find(b.dataset.dl);
    UI.toast({ title: 'Download prepared', message: d.title + ' ' + d.version + '. In the real console the file downloads here.' });
  }));

  host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editLegal(find(b.dataset.edit), host)));

  host.querySelectorAll('[data-more]').forEach((b) => {
    UI.attachMenu(b, () => {
      const d = find(b.dataset.more);
      return `
        <button class="menu__item" data-value="publish" ${d.state === 'Published' ? 'aria-disabled="true"' : ''}>
          ${icon('upload', { size: 18 })} Publish this version</button>
        <button class="menu__item" data-value="reaccept">${icon('user-check', { size: 18 })} Require members to accept again</button>
        <button class="menu__item" data-value="upload">${icon('upload', { size: 18 })} Replace with a file</button>
        <div class="menu__sep"></div>
        <button class="menu__item" data-value="history">${icon('history', { size: 18 })} Previous versions</button>`;
    }, async (value) => {
      const d = find(b.dataset.more);
      if (value === 'publish') await publish(d, host);
      if (value === 'reaccept') await reaccept(d, host);
      if (value === 'upload') replaceFile(d, host);
      if (value === 'history') history(d, host);
    });
  });
}

async function publish(d, host) {
  const r = await UI.confirm({
    title: 'Publish ' + d.title + ' ' + d.version + '?',
    message: 'In production, it would become the version members see and agree to from today. In this prototype nothing is published outside this browser.',
    impact: 'The previous version stays in the history and keeps its own acceptance record.',
    reversible: 'You can restore an earlier version afterwards.',
    confirmLabel: 'Publish this version',
  });
  if (!r.ok) return;
  const st = S.get();
  S.set({ legalDocs: st.legalDocs.map((x) => x.id === d.id
    ? { ...x, state: 'Published', effective: 'Today', version: x.version.replace(' draft', ''), updated: 'Today' } : x) });
  S.note('Published ' + d.title + ' ' + d.version);
  legal(host);
  UI.toast({ title: 'Published', message: 'In production, ' + d.title + ' would be the version members see. Prototype: saved in this browser only.' });
}

async function reaccept(d, host) {
  const r = await UI.confirm({
    title: 'Ask every member to accept again?',
    message: H.n(d.of) + ' members are asked to read and accept ' + d.title + ' the next time they sign in.',
    impact: 'Until a member accepts, they see the acceptance screen before their dashboard.',
    confirmLabel: 'Require acceptance again',
    requireReason: true,
  });
  if (!r.ok) return;
  const st = S.get();
  S.set({ legalDocs: st.legalDocs.map((x) => x.id === d.id ? { ...x, accepted: 0 } : x) });
  S.note('Required re-acceptance of ' + d.title + ' — ' + r.reason);
  legal(host);
  UI.toast({ title: 'Re-acceptance required', message: 'In production, ' + H.n(d.of) + ' members would be asked at their next sign-in. Prototype: saved in this browser only.' });
}

function replaceFile(d, host) {
  UI.modal({
    title: 'Replace ' + d.title,
    desc: 'Upload the approved wording as a file, or paste it in.',
    size: 'wide',
    body: `<div class="field">
        <label for="lg-file">Document file</label>
        <input class="input" id="lg-file" type="file" accept=".pdf,.docx,.txt,.md">
        <p class="field__hint">PDF, Word, plain text or Markdown. Nothing is uploaded in this prototype.</p>
      </div>
      ${H.field({ id: 'lg-version', label: 'New version number', value: nextVersion(d.version), required: true })}
      ${H.field({ id: 'lg-effective', label: 'Effective date', type: 'date', value: '2026-09-01' })}`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: 'Replace the document', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const v = ref.el.querySelector('#lg-version').value.trim();
        if (!v) { H.fieldError(ref.el, 'lg-version', 'Give the new version a number.'); return false; }
        const st = S.get();
        S.set({ legalDocs: st.legalDocs.map((x) => x.id === d.id ? {
          ...x, version: v + ' draft', state: 'Draft', updated: 'Today',
          history: [{ version: d.version, effective: d.effective, note: 'Replaced by ' + v + '.' }].concat(x.history),
        } : x) });
        S.note('Replaced ' + d.title + ' with ' + v);
        legal(host);
        UI.toast({ title: 'Document replaced', message: v + ' is a draft. Publish it when the wording is approved.' });
      } },
    ],
  });
}

function nextVersion(v) {
  const m = String(v).match(/v(\d+)\.(\d+)/);
  return m ? 'v' + m[1] + '.' + (parseInt(m[2], 10) + 1) : 'v1.0';
}

function history(d, host) {
  UI.drawer({
    eyebrow: 'Previous versions',
    title: d.title,
    desc: 'Restoring brings back that wording as a new draft.',
    body: d.history.length ? `<div class="rows">${d.history.map((h) => `
      <div class="rowitem">
        <span class="rowitem__icon rowitem__icon--off">${icon('history', { size: 18 })}</span>
        <div><div class="rowitem__title">${esc(h.version)}</div>
          <div class="rowitem__meta">Effective ${esc(h.effective)} · ${esc(h.note)}</div></div>
        <div class="rowitem__side"><button class="btn btn--secondary btn--sm" data-r="${esc(h.version)}">Restore</button></div>
      </div>`).join('')}</div>`
      : H.emptyState({ icon: 'history', title: 'No previous versions', msg: 'This is the first version of the document.' }),
    onMount: (ref) => {
      ref.el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
        const v = b.dataset.r;
        const r = await UI.confirm({
          title: 'Restore ' + v + '?',
          message: 'The wording from ' + v + ' comes back as a draft. Nothing changes for members until you publish it.',
          confirmLabel: 'Restore ' + v,
        });
        if (!r.ok) return;
        S.note('Restored ' + d.title + ' ' + v);
        ref.close();
        legal(host);
        UI.toast({ title: 'Version restored', message: v + ' is now a draft.' });
      }));
    },
  });
}

function editLegal(d, host) {
  UI.drawer({
    eyebrow: 'Legal document',
    title: d.title,
    desc: d.version + ' · ' + d.state,
    body: `<div class="stack gap-5">
      ${H.field({ id: 'ld-title', label: 'Title', value: d.title, required: true })}
      ${H.field({ id: 'ld-cat', label: 'Category', type: 'select', options: ['Terms', 'Privacy', 'Consent'], value: d.category })}
      ${H.field({ id: 'ld-version', label: 'Version', value: d.version })}
      ${H.field({ id: 'ld-effective', label: 'Effective date', value: d.effective })}
      ${H.field({ id: 'ld-body', label: 'Wording', type: 'textarea', rows: 12, value: d.body,
        hint: 'Placeholder prototype content. Replace with counsel-approved wording before launch.' })}
    </div>`,
    foot: `<button class="btn btn--secondary" id="ldCancel">Cancel</button>
           <button class="btn btn--primary" id="ldSave">Save as draft</button>`,
    onMount: (ref) => {
      ref.el.querySelector('#ldCancel').addEventListener('click', () => ref.close());
      ref.el.querySelector('#ldSave').addEventListener('click', (e) => {
        const title = ref.el.querySelector('#ld-title').value.trim();
        if (!title) { H.fieldError(ref.el, 'ld-title', 'A document needs a title.'); return; }
        H.withSaving(e.currentTarget, () => {
          const st = S.get();
          S.set({ legalDocs: st.legalDocs.map((x) => x.id === d.id ? {
            ...x, title, category: ref.el.querySelector('#ld-cat').value,
            version: ref.el.querySelector('#ld-version').value.trim(),
            effective: ref.el.querySelector('#ld-effective').value.trim(),
            body: ref.el.querySelector('#ld-body').value, state: 'Draft', updated: 'Today',
          } : x) });
          S.note('Edited the ' + title + ' document');
          ref.close();
          legal(host);
          UI.toast({ title: 'Saved as a draft', message: 'Publish it when the wording is approved.' });
        });
      });
    },
  });
}

function newLegal(host) {
  UI.modal({
    title: 'New legal document',
    body: `${H.field({ id: 'nl-title', label: 'Title', required: true, placeholder: 'Cookie Notice' })}
      ${H.field({ id: 'nl-cat', label: 'Category', type: 'select', options: ['Terms', 'Privacy', 'Consent'] })}
      <p class="t-support" style="margin-top:12px">It starts as an empty draft. Members see nothing until it is published.</p>`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: 'Create the document', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const title = ref.el.querySelector('#nl-title').value.trim();
        if (!title) { H.fieldError(ref.el, 'nl-title', 'A document needs a title.'); return false; }
        const st = S.get();
        S.set({ legalDocs: st.legalDocs.concat([{
          id: 'LD-' + (st.legalDocs.length + 1), title, category: ref.el.querySelector('#nl-cat').value,
          version: 'v0.1 draft', effective: 'Not set', state: 'Draft', accepted: 0, of: st.legalDocs[0].of,
          updated: 'Today', body: 'PROTOTYPE CONTENT — NOT LEGAL TEXT.\n\nWrite the approved wording here.',
          history: [],
        }]) });
        S.note('Created the ' + title + ' document');
        legal(host);
        UI.toast({ title: 'Document created', message: title + ' is an empty draft.' });
      } },
    ],
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.content = { render };

})();
