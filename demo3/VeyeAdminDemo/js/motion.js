/* ============================================================================
   Veye Admin Console — motion and deferred rendering
   ----------------------------------------------------------------------------
   One IntersectionObserver drives everything that should happen "shortly before
   this comes into view": chart entrance drawing, progress reveals and the
   one-time metric count-up.

   Two rules hold throughout:

   1. Nothing here is required for the content to be correct. Every value is
      already in the DOM before any animation runs, so a reader who never sees
      the motion — reduced motion, an old browser, a printout — loses nothing.
   2. Nothing here waits on a timer to pretend work is happening. Deferred means
      "do the real work later", never "delay so it feels busy".
   ============================================================================ */

(function () {

/* Two ways to be still, and either one is enough: the operating system's own
   preference, or this administrator choosing Reduce motion in Your profile →
   Display. There is no third value that turns motion back ON — a setting that
   overrode `prefers-reduced-motion: reduce` would be a setting that makes
   somebody ill, so it does not exist. */
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  || document.documentElement.classList.contains('is-motion-reduced');

/* One observer for the whole application. Elements opt in with data-reveal and
   are unobserved the moment they fire — every effect happens once. */
const handlers = new Map();
let seq = 0;

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const fn = handlers.get(e.target.dataset.revealId);
        io.unobserve(e.target);
        handlers.delete(e.target.dataset.revealId);
        if (fn) fn(e.target);
      });
    }, { rootMargin: '120px 0px', threshold: 0.01 })
  : null;

/**
 * Run `fn` once, shortly before `el` scrolls into view.
 * Without IntersectionObserver — or with reduced motion — it runs immediately,
 * so behaviour never depends on the observer existing.
 */
function onceVisible(el, fn) {
  if (!el) return;
  if (!io) { fn(el); return; }
  const id = 'rv' + (++seq);
  el.dataset.revealId = id;
  handlers.set(id, fn);
  io.observe(el);
}

/* ------------------------------------------------------------- count-up ----
   A metric counts to its value once. The final text is already in the element,
   so this reads the target from the DOM and puts it back exactly as it was. */
function countUp(el) {
  const finalText = el.textContent;
  const m = finalText.match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  if (!m) return;
  const [, prefix, numStr, suffix] = m;
  const target = parseFloat(numStr.replace(/,/g, ''));
  if (!isFinite(target)) return;
  const decimals = (numStr.split('.')[1] || '').length;
  const grouped = numStr.indexOf(',') > -1;
  const fmt = (v) => {
    let s = v.toFixed(decimals);
    if (grouped) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return prefix + s + suffix;
  };

  const DURATION = 620;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / DURATION);
    // ease-out cubic: fast first, settles gently on the real number
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(target * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = finalText;        // exact original, never a rounding
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------ bar reveal ---
   A bar or ring is rendered at its true width, then grown into it from zero. */
function growBar(el) {
  const w = el.style.width;
  if (!w) return;
  el.style.setProperty('--grow-to', w);
  el.style.width = '0%';
  requestAnimationFrame(() => {
    el.style.transition = 'width 620ms cubic-bezier(.2,.8,.2,1)';
    el.style.width = w;
  });
  el.addEventListener('transitionend', function done() {
    el.style.transition = '';
    el.removeEventListener('transitionend', done);
  });
}

function growRing(el) {
  const pct = el.style.getPropertyValue('--pct');
  if (!pct) return;
  el.style.setProperty('--pct', '0');
  requestAnimationFrame(() => {
    el.style.transition = '--pct 720ms cubic-bezier(.2,.8,.2,1)';
    el.style.setProperty('--pct', pct);
    // Browsers that cannot transition a custom property simply land on the
    // final value immediately, which is the correct fallback.
    setTimeout(() => { el.style.setProperty('--pct', pct); }, 40);
  });
}

/* ------------------------------------------------------------- reveal -----
   A major below-fold section rises into place the first time it is reached.
   Once per element, and only for whole sections — never a table row, a form
   field or a repeated card. */
function reveal(el) {
  el.classList.add('reveal--in');
}

/* ------------------------------------------------------------- section ink -
   The underline under the active section travels to the section you chose.

   The subnav is rebuilt on every route change, so there is no element left to
   move — the bar has to be told where it used to be. `inkMemo` remembers the
   last position per navigation, identified by its own labels, so returning to
   a screen family picks the journey up where it left off. A navigation seen
   for the first time simply places the bar, with no movement to fake. */
const inkMemo = new Map();

function ink(nav) {
  const active = nav.querySelector('[aria-current="page"]');
  if (!active) return;

  const key = [...nav.children].map((c) => c.textContent.trim()).join('|');
  let bar = nav.querySelector('.subnav__ink');
  if (!bar) {
    bar = document.createElement('span');
    bar.className = 'subnav__ink';
    bar.setAttribute('aria-hidden', 'true');
    nav.appendChild(bar);
  }
  nav.classList.add('has-ink');

  const nb = nav.getBoundingClientRect();
  const ab = active.getBoundingClientRect();
  /* Measured against the nav, and from the active item's own bottom edge, so a
     navigation that has wrapped onto two rows underlines the right row. */
  const to = { left: ab.left - nb.left + nav.scrollLeft, width: ab.width, top: ab.bottom - nb.top - 2 };
  const from = inkMemo.get(key);
  inkMemo.set(key, to);

  const place = (p) => { bar.style.left = p.left + 'px'; bar.style.width = p.width + 'px'; bar.style.top = p.top + 'px'; };

  if (!from || reduced()) { bar.style.transition = 'none'; place(to); return; }

  bar.style.transition = 'none';
  place(from);
  void bar.offsetWidth;                       // commit the start position
  requestAnimationFrame(() => {
    bar.style.transition = 'left 260ms var(--ease-out), width 260ms var(--ease-out), top 200ms var(--ease-out)';
    place(to);
  });
}

/* ---------------------------------------------------------------- swap -----
   Re-render a region after a real change — a date range, a series, a section —
   so the new content settles in rather than replacing the old between frames.
   `render` does the actual work; everything here is presentation.

   Under reduced motion this is a plain synchronous re-render, so the change is
   immediate and nothing is lost. */
function swap(host, render) {
  if (!host) return;
  if (reduced() || !host.animate) { render(); scan(host); return; }

  host.style.transition = 'opacity 110ms linear';
  host.style.opacity = '0.35';
  setTimeout(() => {
    render();
    host.style.transition = 'opacity 220ms ' + 'cubic-bezier(.16,.84,.32,1)';
    host.style.opacity = '1';
    scan(host);
    setTimeout(() => { host.style.transition = ''; host.style.opacity = ''; }, 260);
  }, 110);
}

/* ---------------------------------------------------------------- scan -----
   Called after every route render. Finds everything that opted in and arranges
   for it to happen once. */
function scan(root) {
  if (!root) return;
  const still = reduced();

  root.querySelectorAll('.subnav').forEach(ink);

  /* Table first. A <details> cannot be opened from a stylesheet, so the
     preference is applied here — once per render, as a default the reader is
     still free to close. The chart is untouched and stays where it was. */
  if (document.documentElement.classList.contains('is-table-first')) {
    root.querySelectorAll('details.chart-alt:not([data-tablefirst])').forEach((d) => {
      d.setAttribute('data-tablefirst', '');
      d.open = true;
    });
  }

  root.querySelectorAll('[data-reveal]:not([data-motion-done])').forEach((el) => {
    el.setAttribute('data-motion-done', '');
    if (still) { el.classList.add('reveal--in'); return; }
    el.classList.add('reveal');
    onceVisible(el, reveal);
  });

  root.querySelectorAll('[data-countup]:not([data-motion-done])').forEach((el) => {
    el.setAttribute('data-motion-done', '');
    if (still) return;
    onceVisible(el, countUp);
  });

  root.querySelectorAll('[data-grow]:not([data-motion-done])').forEach((el) => {
    el.setAttribute('data-motion-done', '');
    if (still) return;
    onceVisible(el, growBar);
  });

  root.querySelectorAll('[data-ring]:not([data-motion-done])').forEach((el) => {
    el.setAttribute('data-motion-done', '');
    if (still) return;
    onceVisible(el, growRing);
  });

  /* Charts hydrate their interaction and draw themselves shortly before they are
     seen. Under reduced motion they hydrate straight away with no drawing. */
  root.querySelectorAll('[data-chart]:not([data-chart-ready])').forEach((el) => {
    /* '1', not '' — an empty attribute value is falsy through `dataset`, which
       makes "is this hydrated?" read as no even when it is. */
    el.setAttribute('data-chart-ready', '1');
    const hydrate = () => { if (window.Veye.C) window.Veye.C.hydrate(el, { animate: !still }); };
    if (still) hydrate(); else onceVisible(el, hydrate);
  });
}

window.Veye = window.Veye || { screens: {} };
window.Veye.M = { scan, swap, onceVisible, reduced };

})();
