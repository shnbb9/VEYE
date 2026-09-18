/* ============================================================================
   Veye Admin Console — shell and routing
   ----------------------------------------------------------------------------
   Eight primary destinations, one account menu, and no role model anywhere.
   Every administrator sees this same navigation.

   The shell disappears completely on the login route: a signed-out visitor sees
   the authentication screen and nothing else.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const esc = UI.esc;

/* --------------------------------------------------------------- navigation --
   The order is the order the client approved. Flat, eight items, no groups —
   the rail stays quiet enough to read at a glance. */
const NAV = [
  { id: 'home',        label: 'Home',                icon: 'home',       route: '/home' },
  { id: 'members',     label: 'Members',             icon: 'users',      route: '/members' },
  { id: 'care',        label: 'Care Studio',         icon: 'utensils',   route: '/care' },
  { id: 'assessments', label: 'Assessments & Scoring', icon: 'clipboard', route: '/assessments' },
  { id: 'companion',   label: 'Companion',           icon: 'sprout',     route: '/companion', badge: 'companion' },
  { id: 'requests',    label: 'Requests & Inbox',     icon: 'messages',   route: '/requests', badge: 'requests' },
  { id: 'content',     label: 'Content',             icon: 'file-text',  route: '/content' },
  { id: 'insights',    label: 'Insights',            icon: 'bar-chart',  route: '/insights' },
  { id: 'settings',    label: 'Settings',            icon: 'settings',   route: '/settings' },
];

/* Route pattern → screen key in window.Veye.screens. */
const SCREENS = {
  '/login': 'login',
  '/home': 'home',
  '/members': 'members',
  '/members/:id': 'member-360',
  '/members/:id/:tab': 'member-360',
  '/care': 'care-studio',
  '/care/:mode': 'care-studio',
  /* Registered before the generic three-segment pattern below is irrelevant —
     both carry a literal in the middle, so they cannot collide. */
  '/care/library/:sub': 'care-studio',
  '/care/program/:id': 'care-program',
  '/assessments': 'assessments',
  '/assessments/:key': 'assessment-editor',
  '/assessments/:key/:panel': 'assessment-editor',
  '/companion': 'companion',
  '/companion/:mode': 'companion',
  '/requests': 'requests',
  '/requests/:mode': 'requests',
  '/content': 'content',
  '/content/:mode': 'content',
  '/insights': 'insights',
  '/insights/:view': 'insights',
  '/settings': 'settings',
  '/settings/:section': 'settings',
  '/profile': 'profile',
  '/profile/:panel': 'profile',
};

/* Which rail item lights up for a given path. */
function sectionFor(path) {
  if (path.startsWith('/members')) return 'members';
  if (path.startsWith('/care')) return 'care';
  if (path.startsWith('/assessments')) return 'assessments';
  if (path.startsWith('/companion')) return 'companion';
  if (path.startsWith('/requests')) return 'requests';
  if (path.startsWith('/content')) return 'content';
  if (path.startsWith('/insights')) return 'insights';
  if (path.startsWith('/settings')) return 'settings';
  if (path.startsWith('/home')) return 'home';
  return '';
}

/* The latest delivery brief supersedes the earlier prototype note: Supplements,
   Fitness and Resources remain Phase 2. Mindfulness keeps its current simple
   development notice until Cara supplies the Beta content. */

/** The phone section selector emitted alongside every tab strip. Every option
 *  carries a plain route now that no section is held for Phase 2. */
function wireSectionNav(root) {
  root.querySelectorAll('[data-sectionnav]:not([data-snwired])').forEach((sel) => {
    sel.setAttribute('data-snwired', '');
    sel.addEventListener('change', () => {
      if (sel.value) R.navigate(sel.value);
    });
  });
}

/* ------------------------------------------------------------------- rail -- */
function renderRail() {
  const st = S.get();
  const rail = document.getElementById('rail');
  const path = R.currentRoute().path || '/home';
  const active = sectionFor(path);

  const badges = {
    companion: st.conversations.filter((c) => c.flagged && !c.reviewed).length,
    requests: 5,
  };

  rail.innerHTML = `
    <a class="rail__brand" href="${R.href('/home')}" aria-label="Veye Admin Console — go to Home">
      <img src="assets/img/veye-logo.png" alt="Veye" width="108" height="34">
    </a>
    <div class="rail__org">
      <b>${esc(st.org.name)}</b>
      <span class="rail__sub">Admin Console</span>
    </div>
    <div class="rail__nav">
      <ul class="rail__list">
        ${NAV.map((n) => {
          const count = n.badge ? badges[n.badge] : 0;
          return `<li><a class="nav-link${active === n.id ? ' is-active' : ''}" href="${R.href(n.route)}"
            ${active === n.id ? 'aria-current="page"' : ''}>
            ${icon(n.icon)}<span>${n.label}</span>
            ${count ? `<span class="nav-link__badge">${count}<span class="sr-only"> items to review</span></span>` : ''}
          </a></li>`;
        }).join('')}
      </ul>
    </div>
    <div class="rail__foot">
      <button class="rail__collapse" id="railCollapse">
        ${icon('panel-left')}<span>Collapse menu</span>
      </button>
    </div>`;

  const btn = rail.querySelector('#railCollapse');
  btn.setAttribute('aria-label', st.railCollapsed ? 'Expand the menu' : 'Collapse the menu');
  btn.addEventListener('click', () => {
    S.set({ railCollapsed: !S.get().railCollapsed });
    document.getElementById('app').classList.toggle('is-rail-collapsed', S.get().railCollapsed);
    renderRail();
  });

  // Choosing a destination on a phone closes the slide-over.
  rail.querySelectorAll('.nav-link, .rail__brand').forEach((a) => {
    a.addEventListener('click', () => document.getElementById('app').classList.remove('is-rail-open'));
  });
}

/* ----------------------------------------------------------------- topbar -- */
function renderTopbar() {
  const st = S.get();
  const bar = document.getElementById('topbar');

  bar.innerHTML = `
    <button class="icon-btn" id="railToggleSm" aria-label="Open the menu">${icon('menu')}</button>

    <!-- Desktop keeps the full field. On a phone a 120px-wide input says nothing
         about what it does, so it collapses to one clear icon that opens a
         full-width sheet. -->
    <button class="icon-btn topbar__searchbtn" id="searchSheetBtn" aria-label="Search members and screens">
      ${icon('search')}
    </button>

    <div class="search" role="search">
      <span class="search__icon">${icon('search', { size: 18 })}</span>
      <label class="sr-only" for="globalSearch">Search members and destinations</label>
      <input class="search__input" id="globalSearch" type="search" autocomplete="off"
             placeholder="Search members, screens and settings">
      <div class="results" id="searchResults" hidden></div>
    </div>

    <div class="topbar__spacer"></div>

    <div class="topbar__tools">
      <button class="btn btn--ghost btn--sm" id="helpBtn">${icon('help', { size: 18 })}<span>Help</span></button>
      <div class="menu-wrap">
        <button class="icon-btn who" id="profileBtn" style="width:auto;padding:2px 8px 2px 2px">
          <span class="avatar">${esc(st.me.initials)}</span>
          <span class="who__text"><span class="who__name">${esc(st.me.name)}</span></span>
          ${icon('chevron-down', { size: 16 })}
          <span class="sr-only">Account menu</span>
        </button>
      </div>
    </div>`;

  bar.querySelector('#railToggleSm').addEventListener('click', () => {
    document.getElementById('app').classList.toggle('is-rail-open');
  });

  bar.querySelector('#helpBtn').addEventListener('click', openHelp);
  bar.querySelector('#searchSheetBtn').addEventListener('click', openSearchSheet);

  UI.attachMenu(
    bar.querySelector('#profileBtn'),
    () => `
      <div class="menu__label">${esc(st.me.name)}<br><span class="t-support">${esc(st.me.email)}</span></div>
      <a class="menu__item" href="${R.href('/profile')}" data-value="profile">${icon('user-cog', { size: 18 })} Your profile</a>
      <a class="menu__item" href="${R.href('/settings/product')}" data-value="org">${icon('settings', { size: 18 })} Product settings</a>
      <div class="menu__sep"></div>
      <button class="menu__item" data-value="help">${icon('help', { size: 18 })} Help and support</button>
      <button class="menu__item" data-value="reset">${icon('refresh', { size: 18 })} Reset the sample data</button>
      <div class="menu__sep"></div>
      <button class="menu__item menu__item--danger" data-value="signout">${icon('log-out', { size: 18 })} Sign out</button>
      <!-- Environment lives here rather than under the logo: a "Prototype" badge
           beside the brand makes the whole console look unfinished. -->
      <div class="menu__env">${esc(st.org.name)} · prototype data, nothing is live</div>`,
    async (value) => {
      if (value === 'help') return openHelp();
      if (value === 'reset') {
        const r = await UI.confirm({
          title: 'Reset the sample data?',
          message: 'Every edit made in this prototype is discarded and the sample content returns to how it started.',
          reversible: 'Nothing outside this browser is affected.',
          confirmLabel: 'Reset the sample data',
        });
        if (r.ok) {
          S.resetDemoData();
          R.navigate('/home');
          UI.toast({ title: 'Sample data reset', message: 'Everything is back to its starting state.' });
        }
        return;
      }
      if (value === 'signout') {
        S.set({ signedIn: false });
        R.navigate('/login');
      }
    }
  );

  wireSearch(bar);

  // A subtle rule appears under the bar once the page has scrolled.
  const onScroll = () => bar.classList.toggle('is-stuck', window.scrollY > 4);
  window.removeEventListener('scroll', window.__veyeScroll || (() => {}));
  window.__veyeScroll = onScroll;
  window.addEventListener('scroll', onScroll);
  onScroll();
}

/* Consistent help: the same dialog, reachable the same way, on every screen. */
function openHelp() {
  const st = S.get();
  UI.modal({
    title: 'Help and support',
    desc: 'The same help is available from every screen in the console.',
    body: `
      <div class="helpgrid">
        <div class="helpcard">
          <h3>Ask the Veye team</h3>
          <p class="t-support">Email ${esc(st.org.supportEmail)} or call ${esc(st.org.supportPhone)}. We answer on weekdays, Pacific time.</p>
        </div>
        <div class="helpcard">
          <h3>Finding your way around</h3>
          <p class="t-support">The destinations on the left cover members, care, assessments, Companion, requests, content and reporting. Your own account lives under your name, top right.</p>
        </div>
        <div class="helpcard">
          <h3>Sections under development</h3>
          <p class="t-support">Supplements, Fitness and Resources are Phase 2 and are not active management areas in this Beta console. Mindfulness keeps a simple development notice.</p>
        </div>
        <div class="helpcard">
          <h3>This is a prototype</h3>
          <p class="t-support">Every member, message and figure here is invented. Nothing is sent, charged or published, and changes live only in this browser.</p>
        </div>
      </div>`,
    actions: [{ label: 'Close', variant: 'secondary', value: 'close', autofocus: true }],
  });
}

/* ---------------------------------------------------------- global search --
   One matcher, two presentations: an inline dropdown on desktop and a
   full-width sheet on a phone. */

const DESTS = NAV.map((n) => ({ label: n.label, sub: 'Destination', route: n.route }))
  .concat([
    { label: 'Your profile', sub: 'Account', route: '/profile' },
    { label: 'Requests & Inbox', sub: 'Member support', route: '/requests' },
    { label: 'Feature availability', sub: 'Settings', route: '/settings/features' },
    { label: 'Product settings', sub: 'Settings', route: '/settings/product' },
    { label: 'Legal documents', sub: 'Content', route: '/content/legal' },
    { label: 'Website content', sub: 'Content', route: '/content/website' },
    { label: 'Notifications', sub: 'Content', route: '/content/notifications' },
    { label: 'Health Number', sub: 'Assessments & Scoring', route: '/assessments/health-number' },
    { label: 'Blood markers and ratios', sub: 'Assessments & Scoring', route: '/assessments/markers' },
    { label: 'Food Library', sub: 'Care Studio', route: '/care/library' },
    { label: 'Member plans', sub: 'Care Studio', route: '/care/plans' },
  ]);

function searchFor(raw) {
  const q = String(raw).trim().toLowerCase();
  if (q.length < 2) return null;
  const members = S.get().members
    .filter((m) => (m.name + ' ' + m.email + ' ' + m.id).toLowerCase().includes(q))
    .slice(0, 6)
    .map((m) => ({ label: m.name, sub: m.id + ' · ' + m.email, route: '/members/' + m.id + '/overview' }));
  const dests = DESTS.filter((d) => (d.label + ' ' + d.sub).toLowerCase().includes(q)).slice(0, 6);
  return members.concat(dests);
}

function resultRows(hits, term) {
  if (!hits.length) {
    return `<p class="results__none">Nothing matches “${esc(term)}”. Try a member name, an email address or a screen name.</p>`;
  }
  return hits.map((h) => `
    <a class="results__row" href="${R.href(h.route)}">
      <span class="results__label">${esc(h.label)}</span>
      <span class="results__sub">${esc(h.sub)}</span>
    </a>`).join('');
}

function wireSearch(bar) {
  const input = bar.querySelector('#globalSearch');
  const out = bar.querySelector('#searchResults');

  function close() { out.hidden = true; out.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); }

  function run() {
    const hits = searchFor(input.value);
    if (!hits) return close();
    out.innerHTML = resultRows(hits, input.value.trim());
    out.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    out.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { input.value = ''; close(); }));
  }

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'searchResults');
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; close(); }
    if (e.key === 'ArrowDown' && !out.hidden) { e.preventDefault(); const f = out.querySelector('a'); if (f) f.focus(); }
    if (e.key === 'Enter') { const f = out.querySelector('a'); if (f) { e.preventDefault(); f.click(); } }
  });
  document.addEventListener('mousedown', (e) => {
    if (!bar.querySelector('.search').contains(e.target)) close();
  }, true);
}

/** The phone search sheet. A real dialog: focus trapped, Escape closes it, and
 *  focus returns to the icon that opened it. */
function openSearchSheet() {
  const ref = UI.modal({
    title: 'Search',
    desc: 'Members, screens and settings.',
    size: 'wide',
    body: `<div class="sheetsearch">
        <span class="sheetsearch__icon">${icon('search', { size: 18 })}</span>
        <label class="sr-only" for="sheetQ">Search members and screens</label>
        <input class="input" id="sheetQ" type="search" autocomplete="off" data-autofocus
               placeholder="Start typing a name or a screen">
      </div>
      <div class="results results--sheet" id="sheetOut" role="listbox" aria-label="Search results">
        <p class="results__none">Type at least two letters.</p>
      </div>`,
    actions: [{ label: 'Close', variant: 'secondary', value: 'close' }],
  });

  const q = ref.el.querySelector('#sheetQ');
  const out = ref.el.querySelector('#sheetOut');

  const run = () => {
    const hits = searchFor(q.value);
    out.innerHTML = hits === null
      ? '<p class="results__none">Type at least two letters.</p>'
      : resultRows(hits, q.value.trim());
    out.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => ref.close()));
  };
  q.addEventListener('input', run);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); const f = out.querySelector('a'); if (f) f.focus(); }
    if (e.key === 'Enter') { const f = out.querySelector('a'); if (f) { e.preventDefault(); f.click(); } }
  });
}

/* ---------------------------------------------------- where does this appear --
   One control per screen, in the page header, rather than a paragraph of
   explanation on every card. It answers the only question that was genuinely
   unanswerable before: does what I change here reach a member?

   The content is SEED.whereShown; the three effect words are the same three the
   control map in docs/qa uses, so the screen and the document cannot disagree. */
const EFFECT = {
  control: { word: 'Consumer control', tone: 'live', icon: 'users' },
  view: { word: 'Operational view', tone: 'info', icon: 'bar-chart' },
  admin: { word: 'Admin-only', tone: 'draft', icon: 'settings' },
};

function openWhere(key) {
  const w = window.Veye.SEED.whereShown[key];
  if (!w) { console.warn('[where] unknown screen:', key); return; }
  UI.drawer({
    eyebrow: 'Where does this appear?',
    title: w.title,
    desc: w.lede,
    body: `<div class="stack gap-4">
      <div class="rows" style="border:1px solid var(--line);border-radius:var(--r-field)">
        ${w.rows.map(([what, effect, where]) => {
          const e = EFFECT[effect];
          return `<div class="rowitem" style="grid-template-columns:32px minmax(0,1fr);padding:14px 16px">
            <span class="rowitem__icon" style="width:30px;height:30px">${icon(e.icon, { size: 15 })}</span>
            <div>
              <div class="rowitem__title">${esc(what)}</div>
              <div style="margin:4px 0 2px"><span class="chip chip--${e.tone}">${e.word}</span></div>
              <div class="rowitem__meta">${esc(where)}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <p class="t-support"><b>Consumer control</b> changes something a member or a visitor sees.
        <b>Operational view</b> is counted from what members did and changes nothing.
        <b>Admin-only</b> affects administrators or administration.</p>
      <p class="qualify">${icon('info', { size: 14 })} Prototype mapping — the member app is not
        connected and nothing is sent, charged or published; every change is saved in this browser
        only. This describes what each control would reach in production through the content,
        configuration and messaging services.</p>
    </div>`,
  });
}

function wireWhere(root) {
  root.querySelectorAll('[data-where]:not([data-wwired])').forEach((el) => {
    el.setAttribute('data-wwired', '');
    el.addEventListener('click', () => openWhere(el.dataset.where));
  });
}

/* ------------------------------------------------------- display preferences --
   Four choices from Your profile → Display, applied as classes on the ROOT
   element rather than on #app, because modals, drawers, menus and toasts are
   appended to <body> and would otherwise be left out.

   Navigation is not among them here: the expanded/collapsed choice already
   lives in `railCollapsed`, which the rail's own Collapse button writes. The
   Display panel sets that same key. */
function applyDisplay() {
  const d = S.get().me.display || {};
  const root = document.documentElement;
  root.classList.toggle('is-density-compact', d.density === 'compact');
  root.classList.toggle('is-motion-reduced', d.motion === 'reduce');
  root.classList.toggle('is-table-first', d.data === 'table');
}

/* -------------------------------------------------------------- chrome mode --
   Signed out, the console shows nothing but the login composition. */
function applyChrome(path) {
  const authed = path !== '/login';
  document.body.classList.toggle('is-auth-screen', !authed);
  document.getElementById('rail').hidden = !authed;
  document.getElementById('topbar').hidden = !authed;
  if (authed) {
    renderRail();
    renderTopbar();
    document.getElementById('app').classList.toggle('is-rail-collapsed', S.get().railCollapsed);
  } else {
    document.getElementById('rail').innerHTML = '';
    document.getElementById('topbar').innerHTML = '';
    document.getElementById('app').classList.remove('is-rail-collapsed', 'is-rail-open');
  }
}

/* ------------------------------------------------------------ route wiring -- */
function register() {
  Object.keys(SCREENS).forEach((pattern) => {
    R.route(pattern, async (outlet, route) => {
      const key = SCREENS[pattern];
      const screen = window.Veye.screens[key];

      // Everything except the login screen requires a signed-in session.
      if (key !== 'login' && !S.get().signedIn) { R.navigate('/login', { replace: false }); return; }
      if (key === 'login' && S.get().signedIn) { R.navigate('/home'); return; }

      applyChrome(route.path);

      if (!screen) throw new Error('Screen "' + key + '" is not loaded.');
      outlet.innerHTML = '';
      await screen.render(outlet, route);
      wireSectionNav(outlet);
      wireWhere(outlet);
      enterContent(outlet);
      if (window.Veye.M) window.Veye.M.scan(outlet);
      announce(outlet);
    });
  });

  R.setNotFound((outlet, route) => {
    applyChrome(route.path);
    outlet.innerHTML = `
      <div class="page">
        <div class="page__head"><div class="page__title-row"><div class="page__titles">
          <h1>That screen does not exist</h1>
          <p class="page__desc">Nothing in this console answers to <code>#${esc(route.path)}</code>. It may be an old link, or a typo in the address.</p>
        </div></div></div>
        <div class="card"><div class="card__body">
          <div class="state">
            <div class="state__icon">${icon('compass', { size: 28 })}</div>
            <p class="state__title">Try one of the eight destinations</p>
            <p class="state__msg">Every screen in the console is reachable from the menu on the left.</p>
            <div class="row gap-3 wrap" style="justify-content:center;margin-top:4px">
              <a class="btn btn--primary" href="${R.href('/home')}">Go to Home</a>
              <a class="btn btn--secondary" href="${R.href('/members')}">Go to Members</a>
            </div>
          </div>
        </div></div>
      </div>`;
    announce(outlet);
  });

  /* Unsaved-change guard. Screens call S.markDirty() when an editor has pending
     edits, and the guard offers to stay before the route changes. */
  R.setGuard(async () => {
    const d = S.get().dirty;
    if (!d) return true;
    const r = await UI.confirm({
      title: 'Leave without saving?',
      message: `${esc(d.label)} has changes that have not been saved. Leaving now discards them.`,
      confirmLabel: 'Leave and discard',
      cancelLabel: 'Stay on this screen',
      danger: true,
    });
    if (r.ok) { S.clearDirty(); return true; }
    return false;
  });
}

/* ------------------------------------------------------- route transition --
   The route CONTENT fades and rises. The rail and the top bar are fixed chrome
   and stay put — animating them on every navigation makes the shell feel loose
   rather than responsive. Reduced motion skips it entirely. */
function enterContent(outlet) {
  const target = outlet.firstElementChild;
  if (!target) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* The heading block and the first three content blocks arrive a beat apart.
     Four, and no further: a stagger that runs down a whole page stops reading
     as arrival and starts reading as a queue. Rows, fields, chips and repeated
     cards are never staggered — they are inside these blocks and move with
     them. */
  const blocks = [];
  for (const el of target.children) {
    if (el.classList.contains('subnav') || el.classList.contains('sectionpick')) continue;
    blocks.push(el);
    if (blocks.length === 4) break;
  }
  blocks.forEach((el, i) => el.style.setProperty('--enter-i', i));
  blocks.forEach((el) => el.classList.add('route-block'));

  target.classList.add('route-enter');
  // Force a style read so the starting state is committed before the class flips.
  void target.offsetHeight;
  requestAnimationFrame(() => target.classList.add('route-enter--in'));

  target.addEventListener('transitionend', function done(e) {
    /* transitionend bubbles, and the staggered blocks are children. Only the
       page's own transition ends the entrance. */
    if (e.target !== target) return;
    target.classList.remove('route-enter', 'route-enter--in');
    target.removeEventListener('transitionend', done);
  });
  /* The last block finishes after the page does. Clear the block state on its
     own schedule so nothing is left mid-transition if a transitionend is
     dropped — which happens when a route change interrupts one. */
  setTimeout(() => {
    blocks.forEach((el) => { el.classList.remove('route-block'); el.style.removeProperty('--enter-i'); });
  }, 700);
}

/** Tell assistive technology which screen just loaded. */
function announce(outlet) {
  const h1 = outlet.querySelector('h1');
  const live = document.getElementById('a11y-live');
  if (h1 && live) live.textContent = h1.textContent.trim() + ' — screen loaded';
}

/* ------------------------------------------------------------------- boot -- */
window.Veye.NAV = NAV;
window.Veye.openHelp = openHelp;
window.Veye.applyDisplay = applyDisplay;
window.Veye.openWhere = openWhere;
window.Veye.wireWhere = wireWhere;

applyDisplay();
register();
R.onChange(() => { if (S.get().signedIn) renderRail(); });
R.start();

})();
