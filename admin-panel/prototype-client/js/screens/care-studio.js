/* ============================================================================
   Care Studio
   ----------------------------------------------------------------------------
   v2 reduces the visible secondary navigation from seven items to three:

     Programs · Food Library · Member Plans

   The food catalogue, custom foods and meal templates are three views of one
   subject, so they nest inside Food Library rather than each claiming a slot in
   the top row — which on a phone had become a two-line strip of tabs.

   Supplements, Fitness and Resources are Phase 2 references. Mindfulness is
   the only simple Beta development notice editable from the "Development
   sections" area at the foot of Programs.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const MODES = [
  { key: 'programs', label: 'Programs',     route: '/care/programs' },
  { key: 'library',  label: 'Food Library', route: '/care/library' },
  { key: 'plans',    label: 'Member plans', route: '/care/plans' },
];

const LIBRARY = [
  { key: 'catalogue', label: 'Food catalogue', route: '/care/library/catalogue' },
  { key: 'custom',    label: 'Custom foods',   route: '/care/library/custom' },
  { key: 'templates', label: 'Meal templates', route: '/care/library/templates' },
];

/* The catalogue filter. `portal` and `group` hold keys, not labels, because the
   labels are the member's own wording and must never become an identifier. */
const foodView = { q: '', portal: '', group: '', status: 'All' };

/* The standing a group has in the member's own list, used for the pill beside
   the group name. Every pill carries the group's words as well as its colour. */
const TIER_TONE = { super: 'live', very: 'live', best: 'live', fair: 'draft', poor: 'attention', avoid: 'error' };

const progView = { status: 'Live and draft' };
const PROG_STATUS = ['Live and draft', 'All statuses', 'Live', 'Draft', 'Paused', 'Archived'];

function render(outlet, route) {
  const sub = route.params.sub;

  /* `/care/library/:sub` carries the word `library` as a LITERAL segment, so the
     router fills in :sub and nothing else — there is no :mode to read. Deriving
     the mode from params.mode alone therefore fell through to the default and
     rendered Programs at all three nested Food Library addresses.

     The presence of :sub is itself proof of which pattern matched, because only
     the library pattern declares it. */
  const mode = sub !== undefined ? 'library' : (route.params.mode || 'programs');

  /* /care/library/:sub — the nested Food Library views. */
  if (mode === 'library' && sub !== undefined) {
    if (!LIBRARY.some((l) => l.key === sub)) return notFound(outlet, 'library', sub);
    return shell(outlet, 'library', () => libraryView(sub));
  }
  if (!MODES.some((m) => m.key === mode)) return notFound(outlet, 'mode', mode);

  shell(outlet, mode, () => {
    if (mode === 'library') return libraryView('catalogue');
    return mode;
  });
}

function notFound(outlet, kind, what) {
  outlet.innerHTML = `<div class="page">
    ${H.pageHead({ title: 'Care Studio',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Care Studio' }],
      desc: `Care Studio has no section called <code>${esc(what)}</code>.` })}
    ${H.subnav(MODES, null)}
    <div class="card"><div class="card__body">${H.emptyState({
      icon: 'compass', title: 'Pick a section above',
      msg: 'Programs, the Food Library and member plans.',
      action: `<a class="btn btn--primary" href="${R.href('/care/programs')}">Open Programs</a>`,
    })}</div></div></div>`;
}

function shell(outlet, mode, bodyKind) {
  const kind = bodyKind();
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: 'Care Studio',
      desc: 'The food catalogue, the meal templates built from it, and the programs members follow.',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Care Studio' }],
      where: 'care',
      actions: headActions(kind),
    })}
    ${H.subnav(MODES, mode)}
    <div id="careBody"></div>
  </div>`;

  const body = outlet.querySelector('#careBody');
  if (mode === 'library') library(body, kind);
  else if (mode === 'plans') plans(body);
  else programs(body);

  wireHead(outlet, kind);
}

function libraryView(sub) { return 'lib:' + sub; }

function headActions(kind) {
  if (kind === 'programs') return `<button class="btn btn--primary" id="newProgram">${icon('plus', { size: 18 })} New program</button>`;
  if (kind === 'lib:catalogue') return `<button class="btn btn--primary" id="newFood">${icon('plus', { size: 18 })} Add a food</button>`;
  if (kind === 'lib:templates') return `<button class="btn btn--primary" id="newTemplate">${icon('plus', { size: 18 })} New template</button>`;
  if (kind === 'plans') return `<button class="btn btn--primary" id="newPlan">${icon('plus', { size: 18 })} Create a member plan</button>`;
  return '';
}

function wireHead(outlet, kind) {
  const b = (id, fn) => { const el = outlet.querySelector('#' + id); if (el) el.addEventListener('click', fn); };
  b('newProgram', newProgram);
  b('newFood', () => editFood(null, outlet.querySelector('#libBody')));
  b('newTemplate', newTemplate);
  b('newPlan', createMemberPlan);
}

/* ---------------------------------------------------------------- programs -- */
function programs(host) {
  const st = S.get();
  const live = st.programs.filter((p) => p.status === 'Live');
  const shown = st.programs.filter((p) => {
    if (progView.status === 'All statuses') return true;
    if (progView.status === 'Live and draft') return p.status === 'Live' || p.status === 'Draft';
    return p.status === progView.status;
  });
  const hidden = st.programs.length - shown.length;

  host.innerHTML = `
    <section class="lead">
      <div>
        <h2>${live.length} programs are running</h2>
        <p>${H.n(live.reduce((t, p) => t + p.members, 0))} members are following one. A program is a schedule of
           assessments, meals, prompts and coach checkpoints — open one to change its steps.</p>
      </div>
      <div class="minirow" style="min-width:280px">
        <div class="mini"><span class="mini__n" data-countup>${live.length}</span><span class="mini__l">Live</span></div>
        <div class="mini"><span class="mini__n" data-countup>${st.programs.filter((p) => p.status === 'Draft').length}</span><span class="mini__l">Draft</span></div>
        <div class="mini"><span class="mini__n" data-countup>${Math.round(live.reduce((t, p) => t + p.completion, 0) / live.length)}%</span><span class="mini__l">Average completion</span></div>
      </div>
    </section>

    <!-- Live and draft first. Paused and archived are still one choice away, but
         they are not what anyone opens this screen to see. -->
    <div class="sec">
      <h2>Programs</h2><span class="sec__rule"></span>
      <span class="sec__aside">
        <label class="sr-only" for="pStatus">Status</label>
        <select class="select input--sm" id="pStatus">
          ${PROG_STATUS.map((s) => `<option ${s === progView.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </span>
    </div>

    <div class="gallery">
      ${shown.map((p) => `
        <article class="tile">
          <div class="tile__top">
            <span class="tile__icon">${icon('calendar-check', { size: 20 })}</span>
            ${H.chip(p.status)}
          </div>
          <h3>${esc(p.name)}</h3>
          <p class="tile__desc">${esc(p.audience)}</p>
          <dl class="tile__stats">
            <div class="tile__stat"><dt>Members</dt><dd>${H.n(p.members)}</dd></div>
            <div class="tile__stat"><dt>Weeks</dt><dd>${p.weeks}</dd></div>
            <div class="tile__stat"><dt>Completed</dt><dd>${p.completion == null ? '—' : p.completion + '%'}</dd></div>
          </dl>
          <div class="tile__foot">
            <span class="tile__meta">${esc(p.version)} · updated ${esc(p.updated)}</span>
            <a class="btn btn--secondary btn--sm" href="${R.href('/care/program/' + p.id)}">Open<span class="sr-only"> ${esc(p.name)}</span></a>
          </div>
        </article>`).join('')}
    </div>
    ${hidden ? `<p class="t-support" style="margin-top:var(--s-4)">${hidden} paused or archived
      program${hidden === 1 ? '' : 's'} not shown. Change the status filter above to see ${hidden === 1 ? 'it' : 'them'}.</p>` : ''}

    <!-- Beta and Phase 2 member destinations. -->
    <section class="future defer defer--short" data-reveal>
      <div class="future__head">
        <span class="t-eyebrow">Development sections</span>
        <span class="chip chip--draft">Beta scope</span>
      </div>
      <p class="future__lede">Supplements and Fitness are preserved as Phase 2 references. Mindfulness keeps its simple Beta development notice. Resources is listed under Content as Phase 2.</p>
      <div class="future__items">
        <div class="future__item" aria-disabled="true">
          <span class="future__icon">${icon('pill', { size: 20 })}</span>
          <span class="future__body">
            <span class="future__name">Supplements</span>
            <span class="future__desc">Phase 2 — reference guidance is preserved; management is not active in this Beta.</span>
          </span>
          <span class="chip chip--draft">Phase 2</span>
        </div>
        <div class="future__item" aria-disabled="true">
          <span class="future__icon">${icon('dumbbell', { size: 20 })}</span>
          <span class="future__body">
            <span class="future__name">Fitness</span>
            <span class="future__desc">Phase 2 — final workout content and media remain deferred until after Beta.</span>
          </span>
          <span class="chip chip--draft">Phase 2</span>
        </div>
        <button class="future__item" data-devsec="mindfulness">
          <span class="future__icon">${icon('sprout', { size: 20 })}</span>
          <span class="future__body">
            <span class="future__name">Mindfulness</span>
            <span class="future__desc">The In Development notice and its description.</span>
          </span>
          ${icon('chevron-right', { size: 16 })}
        </button>
      </div>
    </section>`;

  host.querySelector('#pStatus').addEventListener('change', (e) => {
    progView.status = e.target.value;
    programs(host);
    wireDevSections(host);
    window.Veye.M.scan(host);
  });

  wireDevSections(host);
}

/* ------------------------------------------------------------ food library --
   The Food Library administers the member's Food Choices screen, so it uses that
   screen's own shape: four portals, in the member's order, each with its own
   groups. Nothing here invents a nutrition taxonomy — see the header on
   SEED.foodPortals in mock-data.js. */

function portals() { return S.get().foodPortals || []; }
function portalOf(key) { return portals().find((p) => p.key === key) || null; }
function groupOf(food) {
  const p = portalOf(food.portal);
  return p ? p.groups.find((g) => g.key === food.group) || null : null;
}

function library(host, kind) {
  const sub = kind.split(':')[1] || 'catalogue';
  const st = S.get();

  host.innerHTML = `
    <section class="lead">
      <div>
        <h2>Food Library</h2>
        <p>Everything members choose between on Food Choices, and the day templates built from it.
           ${H.n(st.foods.length)} foods across ${portals().length} member portals,
           ${st.mealTemplates.length} templates, and
           ${st.customFoods.length} diary entries the catalogue did not recognise.</p>
      </div>
    </section>

    <!-- Nested navigation. Three views of one subject, one level down. -->
    ${H.subnav(LIBRARY, sub)}
    <div id="libBody"></div>`;

  const body = host.querySelector('#libBody');
  ({ catalogue: food, custom: customFoods, templates })[sub](body);
}

/* ---------------------------------------------------------------- catalogue --
   Progressive disclosure, three steps: the four portal cards say what exists and
   filter; the table lists what the filter left; the drawer holds one food's
   detail. Nothing puts every definition on the first screen. */
function food(host) {
  const st = S.get();

  host.innerHTML = `
    <div class="portals" role="group" aria-label="Member portals — choose one to filter the catalogue">
      ${portals().map((p) => {
        const count = st.foods.filter((f) => f.portal === p.key).length;
        const on = foodView.portal === p.key;
        return `<div class="portal${on ? ' is-on' : ''}">
          <button class="portal__pick" type="button" data-portal="${esc(p.key)}" aria-pressed="${on}">
            <span class="portal__n" data-countup>${count}</span>
            <span class="portal__label">${esc(p.label)}</span>
            <span class="portal__info">${esc(p.memberInfo)}</span>
            <span class="portal__groups">${p.groups.length} groups${on ? ' · filtering' : ''}</span>
          </button>
          <button class="portal__edit btn btn--ghost btn--sm" type="button" data-pdesc="${esc(p.key)}">
            ${icon('edit', { size: 14 })} Edit description
          </button>
        </div>`;
      }).join('')}
    </div>

    <div class="card" data-reveal>
      <div class="findbar">
        <div class="search" style="flex:1 1 240px;max-width:340px;position:relative">
          <span class="search__icon">${icon('search', { size: 18 })}</span>
          <label class="sr-only" for="fdSearch">Search foods</label>
          <input class="search__input" id="fdSearch" type="search" placeholder="Search foods and aliases" value="${esc(foodView.q)}">
        </div>
        <div class="field" style="margin:0">
          <label class="sr-only" for="fdPortal">Member portal</label>
          <select class="select input--sm" id="fdPortal">
            <option value="">All portals</option>
            ${portals().map((p) => `<option value="${esc(p.key)}" ${p.key === foodView.portal ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label class="sr-only" for="fdGroup">Tier or group</label>
          <select class="select input--sm" id="fdGroup" ${foodView.portal ? '' : 'disabled'}>
            <option value="">${foodView.portal ? 'All groups in this portal' : 'Choose a portal first'}</option>
            ${(portalOf(foodView.portal) ? portalOf(foodView.portal).groups : []).map((g) =>
              `<option value="${esc(g.key)}" ${g.key === foodView.group ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label class="sr-only" for="fdStatus">Status</label>
          <select class="select input--sm" id="fdStatus">
            ${['All', 'Live', 'Review', 'Draft'].map((o) => `<option ${o === foodView.status ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn--ghost btn--sm" id="fdClear" ${foodView.q || foodView.portal || foodView.status !== 'All' ? '' : 'hidden'}>Clear filters</button>
      </div>
      <div id="fdRows"></div>
    </div>`;

  const repaint = () => window.Veye.M.swap(host.querySelector('#fdRows'), () => paintFood(host));

  const q = host.querySelector('#fdSearch');
  q.addEventListener('input', () => { foodView.q = q.value; repaint(); });

  host.querySelectorAll('[data-portal]').forEach((b) => b.addEventListener('click', () => {
    /* Choosing the portal that is already filtering clears it — a card that
       cannot be switched off is a trap. */
    foodView.portal = foodView.portal === b.dataset.portal ? '' : b.dataset.portal;
    foodView.group = '';
    food(host);
    window.Veye.M.scan(host);
  }));

  host.querySelectorAll('[data-pdesc]').forEach((b) => b.addEventListener('click',
    () => editPortalDescription(portalOf(b.dataset.pdesc), host)));

  host.querySelector('#fdPortal').addEventListener('change', (e) => {
    foodView.portal = e.target.value; foodView.group = '';
    food(host); window.Veye.M.scan(host);
  });
  host.querySelector('#fdGroup').addEventListener('change', (e) => { foodView.group = e.target.value; repaint(); });
  host.querySelector('#fdStatus').addEventListener('change', (e) => { foodView.status = e.target.value; repaint(); });
  host.querySelector('#fdClear').addEventListener('click', () => {
    foodView.q = ''; foodView.portal = ''; foodView.group = ''; foodView.status = 'All';
    food(host); window.Veye.M.scan(host);
  });

  paintFood(host);
}

function matchesFilter(f) {
  const q = foodView.q.trim().toLowerCase();
  if (q && !(f.name + ' ' + f.aliases).toLowerCase().includes(q)) return false;
  if (foodView.portal && f.portal !== foodView.portal) return false;
  if (foodView.group && f.group !== foodView.group) return false;
  if (foodView.status !== 'All' && f.status !== foodView.status) return false;
  return true;
}

function paintFood(host) {
  const st = S.get();
  const rows = st.foods.filter(matchesFilter);
  const el = host.querySelector('#fdRows');

  if (!rows.length) {
    el.innerHTML = `<div class="card__body">${H.emptyState({
      icon: 'search', title: 'No foods match',
      msg: 'Try a shorter search, or clear the portal and status filters.' })}</div>`;
    return;
  }

  /* One table, two presentations. Below 768px CSS turns each row into a stacked
     card and the `data-label` on every cell becomes its heading, so a phone
     gets the same seven pieces of information rather than a narrowed subset. */
  el.innerHTML = `
    <div class="table-wrap"><table class="table table--rows table--stack">
      <caption class="sr-only">Food catalogue, ${rows.length} of ${st.foods.length} shown</caption>
      <thead><tr>
        <th scope="col">Food</th>
        <th scope="col">Member portal</th>
        <th scope="col">Tier / group</th>
        <th scope="col">Aliases</th>
        <th scope="col">Used by</th>
        <th scope="col">Status</th>
        <th scope="col"><span class="sr-only">Action</span></th>
      </tr></thead>
      <tbody>${rows.map((f) => {
        const p = portalOf(f.portal), g = groupOf(f);
        return `<tr>
        <td data-label="Food"><div class="cell-primary">${esc(f.name)}</div>
            ${f.origin === 'admin' ? '<div class="cell-sub"><span class="chip chip--review chip--sm">Admin-created</span></div>' : ''}</td>
        <td data-label="Member portal">${p ? esc(p.label) : '<span class="t-muted">Not set</span>'}</td>
        <td data-label="Tier / group">${g
          ? `<span class="chip chip--${TIER_TONE[g.tier] || 'draft'}">${esc(g.label)}</span>`
          : '<span class="t-muted">Not set</span>'}</td>
        <td data-label="Aliases">${f.aliases ? esc(f.aliases) : '<span class="t-muted">None</span>'}</td>
        <td data-label="Used by">${H.n(f.usage)} members</td>
        <td data-label="Status">${H.chip(f.status)}</td>
        <td data-label="Action" style="text-align:right"><button class="btn btn--ghost btn--sm" data-edit="${f.id}">Edit<span class="sr-only"> ${esc(f.name)}</span></button></td>
      </tr>`; }).join('')}</tbody>
    </table></div>
    <div class="pager"><span class="pager__info">Showing ${rows.length} of ${st.foods.length} foods.
      Every “used by” figure is invented, like everything else in this prototype.</span></div>`;

  el.querySelectorAll('[data-edit]').forEach((b) => {
    b.addEventListener('click', () => editFood(st.foods.find((f) => f.id === b.dataset.edit), host));
  });
}

/* The paragraph a member reads at the top of a portal on Food Choices. */
function editPortalDescription(p, host) {
  if (!p) return;
  UI.drawer({
    eyebrow: 'Member portal',
    title: p.label,
    desc: 'What a member reads at the top of this portal.',
    body: `<div class="stack gap-5">
      <div class="notice notice--quiet">${icon('info', { size: 18 })}
        <div><b>This copy is on the member's screen.</b> It appears under
        “${esc(p.label)}” on the member dashboard's Food Choices, above the groups
        they pick from. The group names themselves come from the Veye food list and
        are not edited here.</div></div>
      ${H.field({ id: 'pd-info', label: 'Description shown to members', type: 'textarea', rows: 5, value: p.memberInfo })}
      <div>
        <div class="t-eyebrow">Groups in this portal</div>
        <div class="rows" style="margin-top:8px;border:1px solid var(--line);border-radius:var(--r-field)">
          ${p.groups.map((g) => `<div class="rowitem" style="padding:12px 16px">
            <span class="rowitem__icon">${icon('utensils', { size: 16 })}</span>
            <div><div class="rowitem__title">${esc(g.label)}</div>
              <div class="rowitem__meta">${S.get().foods.filter((f) => f.group === g.key).length} foods</div></div>
            <div class="rowitem__side"></div>
          </div>`).join('')}
        </div>
      </div>
    </div>`,
    foot: `<button class="btn btn--primary" id="pdSave">Save changes</button>`,
    onMount: (ref) => {
      ref.el.querySelector('#pdSave').addEventListener('click', () => {
        const memberInfo = ref.el.querySelector('#pd-info').value.trim();
        if (!memberInfo) { H.fieldError(ref.el, 'pd-info', 'Members need something to read here.'); return; }
        S.set({ foodPortals: S.get().foodPortals.map((x) => x.key === p.key ? { ...x, memberInfo } : x) });
        S.note('Edited the ' + p.label + ' portal description');
        ref.close();
        UI.toast({ title: 'Portal description saved', message: 'In production, members would see the new wording on Food Choices. Prototype: saved in this browser only.' });
        food(host); window.Veye.M.scan(host);
      });
    },
  });
}

function editFood(existing, host, opts = {}) {
  const first = portals()[0];
  const startPortal = existing ? existing.portal : (first ? first.key : '');
  const startGroup = existing ? existing.group : (first && first.groups[0] ? first.groups[0].key : '');

  const groupOptions = (portalKey, selected) => {
    const p = portalOf(portalKey);
    return (p ? p.groups : []).map((g) =>
      `<option value="${esc(g.key)}" ${g.key === selected ? 'selected' : ''}>${esc(g.label)}</option>`).join('');
  };

  UI.drawer({
    eyebrow: existing ? (existing.origin === 'admin' ? 'Admin-created food' : 'Food from the Veye list') : 'New food',
    title: existing ? existing.name : 'Add a food',
    desc: 'A food’s classification is its portal and its group — that is exactly what the member sees.',
    body: `<div class="stack gap-5">
      ${H.field({ id: 'fd-name', label: 'Name', required: true,
                  value: existing ? existing.name : (opts.prefillName || ''),
                  hint: 'The words the member reads in the portal.' })}

      <div class="field">
        <label for="fd-portal">Member portal</label>
        <select class="select" id="fd-portal">
          ${portals().map((p) => `<option value="${esc(p.key)}" ${p.key === startPortal ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
        <p class="field__hint">One of the four portals on the member's Food Choices screen.</p>
      </div>

      <div class="field">
        <label for="fd-group">Tier or group</label>
        <select class="select" id="fd-group">${groupOptions(startPortal, startGroup)}</select>
        <p class="field__hint" id="fd-group-hint">The groups offered here change with the portal.</p>
        <p class="field__error" id="fd-group-err" hidden></p>
      </div>

      ${H.field({ id: 'fd-alias', label: 'Also written as', value: existing ? existing.aliases : '',
                  hint: 'Comma separated, and maintained here rather than taken from the Veye food list. Used to match what a member types into the Food Diary.' })}
      ${H.field({ id: 'fd-diets', label: 'Dietary compatibility', value: existing ? existing.diets : '',
                  hint: 'Leave blank unless it is genuinely known. The Veye food list does not record it.' })}
      ${H.field({ id: 'fd-status', label: 'Status', type: 'select', value: existing ? existing.status : 'Live',
                  options: ['Live', 'Review', 'Draft'] })}
      ${H.field({ id: 'fd-note', label: 'Note for administrators', type: 'textarea', rows: 3,
                  value: existing ? existing.note : '',
                  hint: 'Never shown to members.' })}

      ${existing && existing.origin === 'admin' ? `<div class="notice notice--quiet">${icon('info', { size: 18 })}
        <div>This food is not on the Veye food list — somebody added it here. Its portal and
        group were chosen by an administrator.</div></div>` : ''}
      ${existing ? `<p class="t-support">Used by ${H.n(existing.usage)} members. Moving a food to another
        portal changes where every one of them finds it.</p>` : ''}
    </div>`,
    foot: `<button class="btn btn--primary" id="fdSave">${existing ? 'Save changes' : 'Add the food'}</button>`,
    onMount: (ref) => {
      const portalSel = ref.el.querySelector('#fd-portal');
      const groupSel = ref.el.querySelector('#fd-group');

      /* The portal decides which groups exist. Rebuilding the list here is what
         makes it impossible to file a fat under "Starchy Vegetables". */
      portalSel.addEventListener('change', () => {
        groupSel.innerHTML = groupOptions(portalSel.value, null);
        ref.el.querySelector('#fd-group-hint').textContent =
          'Groups in ' + (portalOf(portalSel.value) || { label: '' }).label + '.';
      });

      ref.el.querySelector('#fdSave').addEventListener('click', () => {
        H.clearErrors(ref.el);
        const name = ref.el.querySelector('#fd-name').value.trim();
        if (!name) { H.fieldError(ref.el, 'fd-name', 'A food needs a name.'); return; }
        const patch = {
          name,
          portal: portalSel.value,
          group: groupSel.value,
          aliases: ref.el.querySelector('#fd-alias').value.trim(),
          diets: ref.el.querySelector('#fd-diets').value.trim(),
          status: ref.el.querySelector('#fd-status').value,
          note: ref.el.querySelector('#fd-note').value.trim(),
        };
        const st = S.get();
        const foods = existing
          ? st.foods.map((f) => f.id === existing.id ? { ...f, ...patch } : f)
          /* Anything created here is admin-created by definition: the Veye food
             list is fixed, so a new name cannot have come from it. */
          : [{ id: 'FD-A' + String(st.foods.length + 1).padStart(2, '0'), usage: 0, origin: 'admin', ...patch }, ...st.foods];
        S.set({ foods });
        S.note((existing ? 'Edited food ' : 'Added food ') + name);
        ref.close();
        UI.toast({ title: existing ? 'Food saved' : 'Food added',
          message: name + ' is in ' + (portalOf(patch.portal) || { label: 'the catalogue' }).label + '.' });
        if (opts.onSaved) return opts.onSaved(name);
        if (host) { food(host); window.Veye.M.scan(host); }
        else R.navigate('/care/library/catalogue');
      });
    },
  });
}

/* ------------------------------------------------------------- custom foods --
   A working queue, not a catalogue. Nothing in it is on any member's Food
   Choices screen, and nothing gets there until somebody here promotes it. */
function customFoods(host) {
  const st = S.get();

  host.innerHTML = `
    <div class="notice notice--quiet" style="margin-bottom:var(--s-5)">${icon('info', { size: 18 })}
      <div><b>Administrators only.</b> These are words members typed into their Food Diary that no
      name and no alias in the catalogue matched. A member never sees this list, and an entry here is
      not a food: it appears on Food Choices only if somebody matches it to a catalogue food or
      creates one from it.</div></div>

    <div class="card">
      <div class="card__head"><div>
        <h2 class="card__title">${st.customFoods.length} entries the catalogue does not recognise</h2>
        <p class="t-support">Matching, creating or rejecting one clears it for everyone who typed it.</p>
      </div></div>
      <div class="card__body card__body--flush">
        ${st.customFoods.length ? `<div class="rows">${st.customFoods.map((c) => `
          <div class="rowitem">
            <span class="rowitem__icon rowitem__icon--warn">${icon('utensils', { size: 18 })}</span>
            <div>
              <div class="rowitem__title">“${esc(c.entered)}”</div>
              <div class="rowitem__meta">Typed ${c.count} times by ${c.members} member${c.members === 1 ? '' : 's'}</div>
              <div class="rowitem__meta">Suggestion: ${esc(c.suggestion)}</div>
            </div>
            <div class="rowitem__side">
              <button class="btn btn--secondary btn--sm" data-match="${c.id}">Match</button>
              <button class="btn btn--secondary btn--sm" data-create="${c.id}">Create food</button>
              <button class="btn btn--ghost btn--sm" data-reject="${c.id}">Reject</button>
            </div>
          </div>`).join('')}</div>`
        : H.emptyState({ icon: 'check-circle', title: 'Nothing waiting',
            msg: 'Every custom entry has been matched, created or rejected.' })}
      </div>
    </div>`;

  const resolve = (id, verb, msg, extra) => {
    const st2 = S.get();
    const item = st2.customFoods.find((c) => c.id === id);
    S.set({ customFoods: st2.customFoods.filter((c) => c.id !== id) });
    S.note(verb + ' custom entry “' + item.entered + '”');
    UI.toast({ title: msg, message: (extra ? extra + ' ' : '') + '“' + item.entered + '” cleared for ' + item.members + ' member' + (item.members === 1 ? '' : 's') + '.' });
    customFoods(host);
    window.Veye.M.scan(host);
  };

  host.querySelectorAll('[data-match]').forEach((b) => b.addEventListener('click', () => {
    const c = S.get().customFoods.find((x) => x.id === b.dataset.match);
    UI.modal({
      title: 'Match “' + c.entered + '”',
      desc: 'Every member who typed this sees the matched food instead.',
      /* Grouped by portal, because a name on its own does not say where the
         member will find it. Hand-written rather than H.field, which carries
         plain strings and cannot express the grouping. */
      body: `<div class="field">
        <label for="cm-food">Match to</label>
        <select class="select" id="cm-food">
          ${portals().map((p) => `<optgroup label="${esc(p.label)}">
            ${S.get().foods.filter((f) => f.portal === p.key)
              .map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}
          </optgroup>`).join('')}
        </select>
        <p class="field__hint">The entry is added to that food's aliases, so the same wording matches next time.</p>
      </div>`,
      actions: [
        { label: 'Cancel', variant: 'secondary', value: false },
        { label: 'Match', variant: 'primary', value: true, autofocus: true,
          onClick: (ref) => {
            const id = ref.el.querySelector('#cm-food').value;
            const st2 = S.get();
            const target = st2.foods.find((f) => f.id === id);
            if (!target) return false;
            /* Add what the member wrote as an alias, so the next member who
               types it is matched without anybody looking at this queue. */
            const aliases = target.aliases
              ? (target.aliases.split(',').map((s) => s.trim()).includes(c.entered)
                  ? target.aliases : target.aliases + ', ' + c.entered)
              : c.entered;
            S.set({ foods: st2.foods.map((f) => f.id === id ? { ...f, aliases } : f) });
            resolve(c.id, 'Matched', 'Entry matched', 'Added to ' + target.name + ' as an alias.');
          } },
      ],
    });
  }));
  /* Creating opens the same drawer as any other new food, so the portal and the
     group are a real choice rather than something invented on the member's
     behalf. Anything created this way is marked admin-created. */
  host.querySelectorAll('[data-create]').forEach((b) => b.addEventListener('click', () => {
    const c = S.get().customFoods.find((x) => x.id === b.dataset.create);
    editFood(null, null, {
      prefillName: c.entered,
      onSaved: () => resolve(c.id, 'Created a food from', 'New food created'),
    });
  }));
  host.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
    const c = S.get().customFoods.find((x) => x.id === b.dataset.reject);
    const r = await UI.confirm({
      title: 'Reject “' + c.entered + '”?',
      message: 'It stays in the member’s diary as free text but is never offered as a food.',
      confirmLabel: 'Reject the entry', danger: true,
    });
    if (r.ok) resolve(c.id, 'Rejected', 'Entry rejected');
  }));
}

/* ----------------------------------------------------------- meal templates -- */
function templates(host) {
  const st = S.get();
  host.innerHTML = `
    <div class="notice notice--quiet" style="margin-bottom:var(--s-5)">${icon('info', { size: 18 })}
      <div><b>A template is a shape, not a menu.</b> It names the meal slots in a day — the slots are
      filled from the foods that member has already selected on Food Choices, so two members following
      the same template eat different food. Templates feed <b>Meal Planning</b> on the member dashboard.</div></div>
    ${H.sec('Meal templates', st.mealTemplates.length + ' templates · ' + H.n(st.mealTemplates.reduce((t, x) => t + x.uses, 0)) + ' days built from them')}
    <div class="gallery" data-reveal>
      ${st.mealTemplates.map((t) => `
        <article class="tile">
          <div class="tile__top">
            <span class="tile__icon tile__icon--food">${icon('utensils', { size: 20 })}</span>
            ${H.chip(t.status)}
          </div>
          <h3>${esc(t.name)}</h3>
          <p class="tile__desc">${esc(t.slots)}</p>
          <dl class="tile__stats">
            <div class="tile__stat"><dt>Suits</dt><dd>${esc(t.diets)}</dd></div>
            <div class="tile__stat"><dt>Used</dt><dd>${H.n(t.uses)}</dd></div>
            <div class="tile__stat"><dt>Slots</dt><dd>${t.slots.split(',').length}</dd></div>
          </dl>
          <div class="tile__foot">
            <span class="tile__meta">Template ${esc(t.id)}</span>
            <button class="btn btn--secondary btn--sm" data-tpl="${t.id}">Edit<span class="sr-only"> ${esc(t.name)}</span></button>
          </div>
        </article>`).join('')}
    </div>`;

  host.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
    const t = st.mealTemplates.find((x) => x.id === b.dataset.tpl);
    UI.drawer({
      eyebrow: 'Meal template',
      title: t.name,
      desc: t.slots,
      body: `<div class="stack gap-5">
        ${H.field({ id: 'mt-name', label: 'Name', value: t.name })}
        ${H.field({ id: 'mt-diets', label: 'Suits which preferences', value: t.diets })}
        <div>
          <div class="t-eyebrow">Meal slots</div>
          <div class="rows" style="margin-top:8px;border:1px solid var(--line);border-radius:var(--r-field)">
            ${t.slots.split(',').map((s) => `<div class="rowitem" style="padding:12px 16px">
              <span class="rowitem__icon">${icon('utensils', { size: 16 })}</span>
              <div><div class="rowitem__title">${esc(s.trim())}</div>
                <div class="rowitem__meta">Filled from the member's own food choices</div></div>
              <div class="rowitem__side"></div>
            </div>`).join('')}
          </div>
        </div>
        <p class="t-support">Used by ${H.n(t.uses)} members. Changing a template does not change days a member has already built.</p>
      </div>`,
      foot: `<button class="btn btn--primary" id="mtSave">Save changes</button>`,
      onMount: (ref) => {
        ref.el.querySelector('#mtSave').addEventListener('click', () => {
          const name = ref.el.querySelector('#mt-name').value.trim();
          if (!name) { H.fieldError(ref.el, 'mt-name', 'A template needs a name.'); return; }
          S.set({ mealTemplates: S.get().mealTemplates.map((x) => x.id === t.id
            ? { ...x, name, diets: ref.el.querySelector('#mt-diets').value.trim() } : x) });
          S.note('Edited meal template ' + name);
          ref.close();
          UI.toast({ title: 'Template saved', message: name + ' is updated.' });
          R.navigate('/care/library/templates');
        });
      },
    });
  }));
}

function newTemplate() {
  UI.modal({
    title: 'New meal template',
    body: `${H.field({ id: 'nt-name', label: 'Name', required: true, placeholder: 'Weekend Day' })}
      ${H.field({ id: 'nt-slots', label: 'Meal slots', value: 'Breakfast, Lunch, Dinner', hint: 'Comma separated.' })}
      ${H.field({ id: 'nt-diets', label: 'Suits which preferences', type: 'select', options: ['All', 'Vegetarian', 'Vegan', 'Pescatarian'] })}`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: 'Create the template', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const name = ref.el.querySelector('#nt-name').value.trim();
        if (!name) { H.fieldError(ref.el, 'nt-name', 'A template needs a name.'); return false; }
        const st = S.get();
        S.set({ mealTemplates: [...st.mealTemplates, {
          id: 'MT-' + (st.mealTemplates.length + 1), name,
          slots: ref.el.querySelector('#nt-slots').value.trim(),
          diets: ref.el.querySelector('#nt-diets').value, uses: 0, status: 'Draft',
        }] });
        S.note('Created meal template ' + name);
        UI.toast({ title: 'Template created', message: name + ' starts as a draft.' });
        R.navigate('/care/library/templates');
      } },
    ],
  });
}

/* ----------------------------------------------- development-section editors --
   Mindfulness is the sole Beta notice that has an editable member-facing line. */
function wireDevSections(host) {
  host.querySelectorAll('[data-devsec]:not([data-dswired])').forEach((b) => {
    b.setAttribute('data-dswired', '');
    b.addEventListener('click', () => editDevSection(b.dataset.devsec, host));
  });
}

function editDevSection(key, host) {
  if (key === 'supplements' || key === 'fitness') {
    UI.toast({ title: 'Phase 2', message: 'This area is preserved for later and is not managed in the Beta console.', kind: 'info' });
    return;
  }
  if (key !== 'mindfulness') return;
  const st = S.get();
  const sec = st.memberSections.mindfulness;
  if (!sec) return;
  UI.drawer({
    eyebrow: 'Beta development notice',
    title: 'Mindfulness',
    desc: 'The simple In Development destination shown to members.',
    body: `<div class="stack gap-5">
      ${H.field({ id: 'ds-note', label: 'Headline', value: sec.devNote })}
      ${H.field({ id: 'ds-body', label: 'Description', type: 'textarea', rows: 3, value: sec.body })}
    </div>`,
    foot: `<button class="btn btn--primary" id="dsSave">Save changes</button>`,
    onMount: (ref) => {
      ref.el.querySelector('#dsSave').addEventListener('click', () => {
        S.set({ memberSections: { ...st.memberSections, mindfulness: { ...sec,
          devNote: ref.el.querySelector('#ds-note').value.trim(),
          body: ref.el.querySelector('#ds-body').value.trim() } } });
        S.note('Edited the member Mindfulness development notice');
        ref.close();
        UI.toast({ title: 'Mindfulness notice saved', message: 'The change was saved in this browser.' });
      });
    },
  });
}

/* ------------------------------------------------------------- member plans -- */
function plans(host) {
  const st = S.get();
  const withPlan = st.members.filter((m) => m.program);
  const without = st.members.filter((m) => !m.program && m.status === 'Active');

  host.innerHTML = `
    <div class="hgrid" data-reveal>
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Members following a plan</h2>
          <p class="t-support">${withPlan.length} of ${st.members.length}.</p></div></div>
        <div class="card__body card__body--flush">
          <div class="table-wrap"><table class="table table--rows">
            <caption class="sr-only">Members and the plan they are following</caption>
            <thead><tr><th scope="col">Member</th><th scope="col">Plan</th>
              <th scope="col" data-col-priority="medium">Adherence</th><th scope="col"><span class="sr-only">Open</span></th></tr></thead>
            <tbody>${withPlan.map((m) => `<tr>
              <td><div class="cell-primary">${esc(m.name)}</div><div class="cell-sub">${esc(m.id)}</div></td>
              <td>${esc(m.program)}</td>
              <td data-col-priority="medium">${m.adherence == null ? '—' : `
                <span class="bar__track" style="width:90px;display:inline-block;vertical-align:middle"><span class="bar__fill${m.adherence < 40 ? ' bar__fill--warn' : ''}" style="width:${m.adherence}%" data-grow></span></span>
                <span class="t-num" style="margin-left:8px">${m.adherence}%</span>`}</td>
              <td style="text-align:right"><a class="btn btn--ghost btn--sm" href="${R.href('/members/' + m.id + '/nutrition')}">Open<span class="sr-only"> ${esc(m.name)}</span></a></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2 class="card__title">No plan yet</h2>
          <p class="t-support">Active members who are not following anything.</p></div></div>
        <div class="card__body card__body--flush">
          ${without.length ? `<div class="rows">${without.map((m) => `
            <div class="rowitem">
              <span class="rowitem__icon rowitem__icon--off">${icon('user-check', { size: 18 })}</span>
              <div><div class="rowitem__title">${esc(m.name)}</div>
                <div class="rowitem__meta">${esc(m.onboarding)} · last active ${esc(m.lastActive)}</div></div>
              <div class="rowitem__side"><a class="btn btn--secondary btn--sm" href="${R.href('/members/' + m.id + '/nutrition')}">Assign</a></div>
            </div>`).join('')}</div>`
          : H.emptyState({ icon: 'check-circle', title: 'Everyone active has a plan' })}
        </div>
      </div>
    </div>`;
}

function createMemberPlan() {
  const st = S.get();
  UI.modal({
    title: 'Create a member plan',
    desc: 'Pick a member and the program they should follow.',
    body: `${H.field({ id: 'cp-member', label: 'Member', type: 'select',
              options: st.members.filter((m) => m.status === 'Active').map((m) => m.name + ' — ' + m.id) })}
      ${H.field({ id: 'cp-prog', label: 'Program', type: 'select',
              options: st.programs.filter((p) => p.status === 'Live').map((p) => p.name) })}
      ${H.field({ id: 'cp-start', label: 'Start date', type: 'date', value: '2026-08-17' })}`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: 'Create the plan', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const id = ref.el.querySelector('#cp-member').value.split(' — ')[1];
        const prog = ref.el.querySelector('#cp-prog').value;
        S.set({ members: S.get().members.map((m) => m.id === id ? { ...m, program: prog, adherence: m.adherence == null ? 0 : m.adherence } : m) });
        S.note('Created a plan on ' + prog);
        UI.toast({ title: 'Plan created', message: 'Assigned ' + prog + '.' });
        R.navigate('/care/plans');
      } },
    ],
  });
}

function newProgram() {
  UI.modal({
    title: 'New program',
    desc: 'A program is a schedule of steps. You add the steps after creating it.',
    body: `${H.field({ id: 'np-name', label: 'Name', required: true, placeholder: 'Evening Reset' })}
      ${H.field({ id: 'np-aud', label: 'Who it is for', placeholder: 'Members reporting broken sleep' })}
      ${H.field({ id: 'np-weeks', label: 'Length in weeks', type: 'number', value: '6' })}`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: 'Create the program', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const name = ref.el.querySelector('#np-name').value.trim();
        if (!name) { H.fieldError(ref.el, 'np-name', 'A program needs a name.'); return false; }
        const weeks = parseInt(ref.el.querySelector('#np-weeks').value, 10);
        if (!weeks || weeks < 1 || weeks > 52) { H.fieldError(ref.el, 'np-weeks', 'Give a length between 1 and 52 weeks.'); return false; }
        const st = S.get();
        const id = 'PR-' + String(st.programs.length + 10);
        S.set({ programs: [{ id, name, audience: ref.el.querySelector('#np-aud').value.trim() || 'Not set yet',
          status: 'Draft', version: 'v0.1 draft', updated: 'Today', members: 0, completion: null, weeks }, ...st.programs] });
        S.note('Created program ' + name);
        UI.toast({ title: 'Program created', message: name + ' starts as a draft with no steps.' });
        R.navigate('/care/program/' + id);
      } },
    ],
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens['care-studio'] = { render };

})();
