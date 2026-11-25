/* ============================================================================
   Veye Admin Console — shell and routing
   ----------------------------------------------------------------------------
   The real console's chrome (platform/web components/admin/admin-chrome.tsx):
   a rail with the brand, ten destinations and Sign out; a top bar with the
   environment chip and the signed-in administrator, whose picture or initials
   open Settings → Your account. No roles anywhere: every administrator sees
   this same navigation.

   One thing here is the prototype's own: the environment chip is a button. It
   opens a small menu that explains this is a prototype and holds "Reset the
   sample data" — which the console does not need and a demo cannot do without.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

/* The console's MAIN_NAV, in its order, with its labels and icons. */
const NAV = [
  { id: 'home',        label: 'Home',             icon: 'home',      route: '/home' },
  { id: 'members',     label: 'Members',          icon: 'users',     route: '/members' },
  { id: 'care',        label: 'Care Studio',      icon: 'heart',     route: '/care' },
  { id: 'assessments', label: 'Assessments',      icon: 'clipboard', route: '/assessments' },
  { id: 'companion',   label: 'Companion',        icon: 'sprout',    route: '/companion/conversations' },
  { id: 'requests',    label: 'Requests & Inbox', icon: 'inbox',     route: '/requests' },
  { id: 'content',     label: 'Content',          icon: 'edit',      route: '/content' },
  { id: 'insights',    label: 'Insights',         icon: 'bar-chart', route: '/insights' },
  { id: 'finance',     label: 'Finance',          icon: 'wallet',    route: '/finance' },
  { id: 'settings',    label: 'Settings',         icon: 'settings',  route: '/settings' },
];

/* Route pattern → screen key in window.Veye.screens. Literal segments are
   registered before the patterns they would otherwise be read as (prospects
   and deletions before a member id). */
const SCREENS = {
  '/login': 'login',
  '/accept-invitation': 'accept-invitation',
  '/home': 'home',
  '/members': 'members',
  '/members/trends': 'member-trends',
  '/members/invitations': 'member-invitations',
  '/members/prospects': 'prospects',
  '/members/deletions': 'deletions',
  '/members/:id': 'member-360',
  '/members/:id/:tab': 'member-360',
  '/care': 'care-studio',
  '/care/fitness-library': 'fitness-library',
  '/care/:kind': 'care-studio',
  '/assessments': 'assessments',
  '/assessments/:key': 'assessment-results',
  '/companion': 'companion',
  '/companion/:mode': 'companion',
  '/companion/settings/guided-experiences': 'companion-guided',
  '/companion/settings/advanced/:page': 'companion-advanced',
  '/requests': 'requests',
  '/content': 'content',
  '/content/:group': 'content',
  '/insights': 'insights',
  '/finance': 'finance',
  '/settings': 'settings',
  '/settings/:section': 'settings',
};

/* Addresses from the August prototype that a bookmark may still hold. Each
   goes to the screen that now covers it rather than to "not found". */
const REDIRECTS = {
  '/profile': () => '/settings/account',
  '/profile/:panel': () => '/settings/account',
  '/insights/:view': () => '/insights',
  '/requests/:mode': () => '/requests',
  '/care/library/:sub': () => '/care',
  '/care/program/:id': () => '/care',
  '/assessments/:key/:panel': (p) => '/assessments/' + p.key,
};

const NO_CHROME = new Set(['login', 'accept-invitation']);

function sectionFor(path) {
  const hit = NAV.find((n) => n.id !== 'home' && path.startsWith('/' + n.id));
  return hit ? hit.id : 'home';
}

function wireSectionNav(root) {
  root.querySelectorAll('[data-sectionnav]:not([data-snwired])').forEach((sel) => {
    sel.setAttribute('data-snwired', '');
    sel.addEventListener('change', () => { if (sel.value) R.navigate(sel.value); });
  });
}

/* ------------------------------------------------------------------- rail -- */
function renderRail() {
  const rail = document.getElementById('rail');
  const active = sectionFor(R.currentRoute().path || '/home');

  rail.innerHTML = `
    <a class="rail__brand" href="${R.href('/home')}" aria-label="Veye Admin Console — go to Home">
      <img src="assets/img/veye-logo.png" alt="Veye" width="108" height="34">
    </a>
    <div class="rail__org">
      <b>Veye</b>
      <span class="rail__sub">Admin Console</span>
    </div>
    <div class="rail__nav">
      <ul class="rail__list">
        ${NAV.map((n) => `<li><a class="nav-link${active === n.id ? ' is-active' : ''}" href="${R.href(n.route)}"
            aria-label="${esc(n.label)}" ${active === n.id ? 'aria-current="page"' : ''}>${icon(n.icon)}<span>${esc(n.label)}</span></a></li>`).join('')}
      </ul>
    </div>
    <div class="rail__foot">
      <button class="rail__collapse" type="button" id="signOutBtn" aria-label="Sign out">${icon('log-out')}<span>Sign out</span></button>
    </div>`;

  rail.querySelector('#signOutBtn').addEventListener('click', signOut);
  // Choosing a destination on a phone closes the slide-over.
  rail.querySelectorAll('.nav-link, .rail__brand').forEach((a) => {
    a.addEventListener('click', () => document.getElementById('app').classList.remove('is-rail-open'));
  });
}

/** Ends the console session only. */
function signOut() {
  S.set({ signedIn: false });
  document.getElementById('app').classList.remove('is-rail-open');
  R.navigate('/login?flash=signed-out');
}

/* ----------------------------------------------------------------- topbar -- */
function renderTopbar() {
  const bar = document.getElementById('topbar');
  const me = S.me();

  bar.innerHTML = `
    <button class="icon-btn" id="railToggleSm" aria-label="Open the menu" type="button">${icon('menu')}</button>
    <div class="topbar__spacer"></div>
    <div class="topbar__tools">
      <div class="menu-wrap">
        <button class="chip chip--lime protochip" id="protoBtn" type="button">Prototype · synthetic data</button>
      </div>
      <a class="who" style="padding:2px 8px 2px 2px;text-decoration:none" href="${R.href('/settings/account')}" aria-label="Your account settings">
        ${H.avatar(me)}
        <span class="who__text"><span class="who__name">${esc(me.firstName)} ${esc(me.lastName)}</span><span class="who__role">Administrator</span></span>
      </a>
    </div>`;

  bar.querySelector('#railToggleSm').addEventListener('click', () => {
    document.getElementById('app').classList.toggle('is-rail-open');
  });

  UI.attachMenu(bar.querySelector('#protoBtn'), () => {
    const pending = S.get().admins.find((a) => a.invitation === 'pending' && a.isActive);
    return `
      <div class="menu__label">A static prototype of the Veye admin console<br>
        <span class="t-support">Every person and figure is invented. Nothing is sent, published or uploaded; changes stay in this browser.</span></div>
      ${pending ? `<a class="menu__item" href="${R.href('/accept-invitation?invite=' + pending.userId)}" data-value="invite">${icon('mail', { size: 18 })} Open ${esc(pending.firstName)}’s invitation link</a>` : ''}
      <button class="menu__item" data-value="reset" type="button">${icon('refresh', { size: 18 })} Reset the sample data</button>`;
  }, async (value) => {
    if (value !== 'reset') return;
    const r = await UI.confirm({
      title: 'Reset the sample data?',
      message: 'Every change made in this prototype is discarded and the sample data is rebuilt as of today.',
      reversible: 'Nothing outside this browser is affected.',
      confirmLabel: 'Reset the sample data',
    });
    if (r.ok) {
      S.resetDemoData();
      R.navigate('/home');
      UI.toast({ title: 'Sample data reset', message: 'Everything is back to its starting state.' });
    }
  });

  // A subtle rule appears under the bar once the page has scrolled.
  const onScroll = () => bar.classList.toggle('is-stuck', window.scrollY > 4);
  window.removeEventListener('scroll', window.__veyeScroll || (() => {}));
  window.__veyeScroll = onScroll;
  window.addEventListener('scroll', onScroll);
  onScroll();
}

/* -------------------------------------------------------------- chrome mode -- */
function applyChrome(key) {
  const chromed = !NO_CHROME.has(key);
  document.body.classList.toggle('is-auth-screen', !chromed);
  document.getElementById('rail').hidden = !chromed;
  document.getElementById('topbar').hidden = !chromed;
  if (chromed) { renderRail(); renderTopbar(); }
  else {
    document.getElementById('rail').innerHTML = '';
    document.getElementById('topbar').innerHTML = '';
    document.getElementById('app').classList.remove('is-rail-open');
  }
}

/* ------------------------------------------------------------ route wiring -- */
function register() {
  Object.keys(REDIRECTS).forEach((pattern) => {
    R.route(pattern, (outlet, route) => { R.navigate(REDIRECTS[pattern](route.params), { replace: true }); });
  });

  Object.keys(SCREENS).forEach((pattern) => {
    R.route(pattern, async (outlet, route) => {
      const key = SCREENS[pattern];
      const screen = window.Veye.screens[key];
      const signedIn = S.get().signedIn;

      // Signing in and activating an invitation are the console's own doors:
      // they sit outside the session guard. Everything else needs a session.
      if (key !== 'login' && key !== 'accept-invitation' && !signedIn) { R.navigate('/login'); return; }
      if (key === 'login' && signedIn) { R.navigate('/home'); return; }

      UI.closeAll();
      applyChrome(key);
      if (!screen) throw new Error('Screen "' + key + '" is not loaded.');
      outlet.innerHTML = '';
      await screen.render(outlet, route);
      wireSectionNav(outlet);
      enterContent(outlet);
      announce(outlet);
    });
  });

  R.setNotFound((outlet, route) => {
    if (!S.get().signedIn) { R.navigate('/login'); return; }
    applyChrome('not-found');
    outlet.innerHTML = `
      <div class="page">
        ${H.pageHead({ title: 'That screen does not exist', crumbs: [{ label: 'Home', route: '/home' }, { label: 'Not found' }],
          desc: `Nothing in this console answers to <code>#${esc(route.path)}</code>. It may be an old link, or a typo in the address.` })}
        <div class="card"><div class="card__body">${H.emptyState({
          icon: 'compass', title: 'Every screen is in the menu on the left',
          msg: 'Home, Members, Care Studio, Assessments, Companion, Requests &amp; Inbox, Content, Insights, Finance and Settings.',
          action: `<a class="btn btn--primary" href="${R.href('/home')}">Go to Home</a>`,
        })}</div></div>
      </div>`;
    announce(outlet);
  });
}

/* ------------------------------------------------------- route transition --
   The route CONTENT fades and rises; the rail and top bar stay put. Reduced
   motion skips it entirely. */
function enterContent(outlet) {
  const target = outlet.firstElementChild;
  if (!target) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const blocks = [];
  for (const el of target.children) {
    if (el.classList.contains('subnav') || el.classList.contains('sectionpick')) continue;
    blocks.push(el);
    if (blocks.length === 4) break;
  }
  blocks.forEach((el, i) => el.style.setProperty('--enter-i', i));
  blocks.forEach((el) => el.classList.add('route-block'));
  target.classList.add('route-enter');
  void target.offsetHeight;
  requestAnimationFrame(() => target.classList.add('route-enter--in'));
  target.addEventListener('transitionend', function done(e) {
    if (e.target !== target) return;
    target.classList.remove('route-enter', 'route-enter--in');
    target.removeEventListener('transitionend', done);
  });
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
window.Veye.signOut = signOut;
window.Veye.refreshChrome = () => { if (!document.getElementById('topbar').hidden) { renderRail(); renderTopbar(); } };

register();
R.onChange(() => { if (S.get().signedIn && !document.getElementById('rail').hidden) renderRail(); });
R.start();

})();
