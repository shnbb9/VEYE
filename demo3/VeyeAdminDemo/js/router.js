/* ============================================================================
   Veye Admin — hash router
   Every screen has a stable deep link and browser Back/Forward works. Routes
   carry :params and support nested member tabs (#/members/:id/:tab).
   ============================================================================ */

(function () {

const routes = [];
let notFoundHandler = null;
let beforeNavigate = null;   // returns false to veto (unsaved-change guard)
let current = { path: '', params: {}, query: {} };
const listeners = new Set();

/** Register a route. Pattern segments beginning ':' are params. */
function route(pattern, handler, meta = {}) {
  const parts = pattern.split('/').filter(Boolean);
  routes.push({ pattern, parts, handler, meta });
}

function setNotFound(fn) { notFoundHandler = fn; }
function setGuard(fn) { beforeNavigate = fn; }
function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function currentRoute() { return current; }

function parseHash() {
  let h = location.hash.replace(/^#/, '');
  if (!h) h = '/home';
  const [pathPart, queryPart] = h.split('?');
  const query = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((v, k) => { query[k] = v; });
  }
  return { path: pathPart, parts: pathPart.split('/').filter(Boolean), query };
}

function match(parts) {
  let wildcard = null;
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const rp = r.parts[i];
      if (rp.startsWith(':')) { params[rp.slice(1)] = decodeURIComponent(parts[i]); }
      else if (rp !== parts[i]) { ok = false; break; }
    }
    if (ok) return { r, params };
  }
  return wildcard;
}

let pendingHash = null;
let firstRender = true;

async function resolve() {
  const { path, parts, query } = parseHash();

  // Unsaved-change guard. The guard may return false to cancel; we then restore
  // the previous hash without re-entering resolve().
  if (beforeNavigate && current.path && path !== current.path) {
    const allowed = await beforeNavigate(path, current.path);
    if (allowed === false) {
      pendingHash = '#' + current.path;
      location.hash = pendingHash;
      return;
    }
  }
  if (pendingHash && location.hash === pendingHash) { pendingHash = null; return; }

  const hit = match(parts);
  current = { path, params: hit ? hit.params : {}, query, meta: hit ? hit.r.meta : {} };

  const outlet = document.getElementById('main-content');
  if (!outlet) return;

  try {
    if (hit) await hit.r.handler(outlet, current);
    else if (notFoundHandler) await notFoundHandler(outlet, current);
  } catch (err) {
    console.error('[router] screen failed:', path, err);
    outlet.innerHTML = `<div class="page"><div class="card"><div class="state state--error">
      <div class="state__icon"></div>
      <p class="state__title">This screen could not be displayed</p>
      <p class="state__msg">${String(err.message || err)}</p>
      <button class="btn btn--secondary" onclick="location.reload()">Reload the prototype</button>
    </div></div></div>`;
  }

  // Move focus to the page heading so keyboard and screen-reader users land in
  // the new content rather than staying on the link they activated.
  //
  // NOT on the first render. On a fresh page load nobody has navigated, and
  // taking focus there puts the browser's Tab sequence past the skip link — so
  // the first Tab landed inside the page instead of on "Skip to main content".
  const h1 = outlet.querySelector('h1');
  if (h1) {
    h1.setAttribute('tabindex', '-1');
    if (!firstRender) h1.focus({ preventScroll: true });
  }
  firstRender = false;
  outlet.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

  listeners.forEach((fn) => fn(current));
}

function navigate(path, { replace = false } = {}) {
  const h = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === h) { resolve(); return; }
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
}

function start() {
  window.addEventListener('hashchange', resolve);
  resolve();
}

/** Build a hash href for use in real anchors — never href="#". */
function href(path) {
  return '#' + (path.startsWith('/') ? path : '/' + path);
}

window.Veye = window.Veye || { screens: {} };
window.Veye.R = { route, setNotFound, setGuard, onChange, currentRoute, navigate, start, href };

})();
