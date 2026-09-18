/* ============================================================================
   Veye Admin Console — the interactive chart layer
   ----------------------------------------------------------------------------
   One reusable module behind every line and column chart in the console. Plain
   SVG built as a string, plain DOM listeners, no library.

   Design rules this layer holds to:

   * An exact value is NEVER hover-only. Every chart carries a readout beside it
     that follows the active point, and the same numbers again as a table.
   * Focus is never trapped. The plot is one Tab stop; arrow keys move within it;
     Tab moves on.
   * The live region is debounced and only speaks while the chart has keyboard
     focus, so moving a mouse across twelve months does not produce twelve
     announcements.
   * Reduced motion removes the drawing and the eased transitions. It removes
     nothing else: tooltip, keyboard traversal, legend and readout all work.
   * Nothing here computes a health value. It draws numbers it is handed.
   ============================================================================ */

(function () {

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Configs live in a small registry rather than a data attribute: the series are
   arrays, and stuffing JSON into markup invites escaping bugs. Bounded so a long
   session cannot grow it without limit. */
const REG = new Map();
let seq = 0;

const SERIES_COLOUR = ['var(--green-primary)', 'var(--status-info)'];

/* ------------------------------------------------------------------ markup --
   Returns a complete, correct, static chart. If hydrate() never runs — no
   JavaScript beyond this point, an old browser, a printout — the reader still
   sees the shape, the summary value and the full table.
   @param {object} cfg
   cfg.type          'line' | 'column'
   cfg.labels        string[]   one per point
   cfg.series        [{ key, label, unit, values:number[] }]
   cfg.min, cfg.max  y bounds (optional)
   cfg.height        px (default 230)
   cfg.readoutLabel  wording between the value and the period, e.g. 'joined in'
   cfg.alt           the static description for assistive technology
   cfg.table*        the alternative table, unchanged from v1
*/
function markup(cfg) {
  const id = cfg.id ? cfg.id + '-' + (++seq) : 'chart-' + (++seq);
  REG.set(id, cfg);
  if (REG.size > 40) REG.delete(REG.keys().next().value);

  const H = cfg.height || 230;
  const multi = cfg.series.length > 1;
  const last = cfg.series[0].values.length - 1;

  const legend = multi ? `
    <div class="chart__legend" role="group" aria-label="Series shown">
      ${cfg.series.map((s, i) => `
        <button class="legend-btn" type="button" data-series="${i}" aria-pressed="true">
          <span class="legend-swatch" style="background:${SERIES_COLOUR[i] || 'var(--sage)'}"></span>${esc(s.label)}
        </button>`).join('')}
    </div>` : '';

  return `
  <div class="chart" data-chart="${id}">
    <div class="chart__readout">
      <span class="chart__readout-value" data-role="value">${fmt(cfg.series[0].values[last], cfg.series[0].unit)}</span>
      <span class="chart__readout-label" data-role="label">${esc(cfg.readoutLabel || '')} ${esc(cfg.labels[last] || '')}</span>
    </div>
    ${legend}
    <div class="chart__plot" data-role="plot">
      <div class="chart__svg" data-role="canvas">${draw(cfg, H)}</div>
      <div class="chart__tip" data-role="tip" aria-hidden="true"></div>
    </div>
    <p class="chart__hint">Point at the chart, or focus it and use the left and right arrow keys, to read any period.</p>
    <span class="sr-only" data-role="live" aria-live="polite"></span>
    ${cfg.tableHead ? tableAlt(cfg) : ''}
  </div>`;
}

function fmt(v, unit) {
  if (v == null) return '—';
  const n = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return unit === '%' ? n + '%' : n + (unit || '');
}

function tableAlt(cfg) {
  return `<details class="chart-alt">
    <summary>${esc(cfg.tableSummary || 'View these figures as a table')}</summary>
    <div class="table-wrap"><table class="table table--compact">
      ${cfg.tableCaption ? `<caption class="sr-only">${esc(cfg.tableCaption)}</caption>` : ''}
      <thead><tr>${cfg.tableHead.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${cfg.tableRows.map((r) => `<tr>${r.map((c, i) => i === 0
        ? `<th scope="row">${c}</th>` : `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
  </details>`;
}

/* -------------------------------------------------------------------- draw -- */
function geometry(cfg, H) {
  const W = 680, padL = 38, padR = 12, padT = 14, padB = 28;
  const all = cfg.series.flatMap((s) => s.values);
  const lo = cfg.min != null ? cfg.min : Math.min(...all, 0);
  const hi = cfg.max != null ? cfg.max : Math.max(...all);
  const span = (hi - lo) || 1;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = cfg.series[0].values.length;
  const x = (i) => cfg.type === 'column'
    ? padL + (iw / n) * (i + 0.5)
    : padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => padT + ih - ((v - lo) / span) * ih;
  return { W, H, padL, padR, padT, padB, lo, hi, span, iw, ih, n, x, y };
}

function draw(cfg, H) {
  const g = geometry(cfg, H);
  const gid = 'ga' + Math.random().toString(36).slice(2, 7);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const yy = g.padT + g.ih - f * g.ih;
    const val = g.lo + f * g.span;
    return `<line class="grid-line" x1="${g.padL}" y1="${yy.toFixed(1)}" x2="${g.W - g.padR}" y2="${yy.toFixed(1)}"/>
      <text class="axis-label" x="6" y="${(yy + 4).toFixed(1)}">${g.span < 6 ? val.toFixed(1) : Math.round(val)}</text>`;
  }).join('');

  const axis = [0, Math.floor((g.n - 1) / 2), g.n - 1].map((i, k, arr) =>
    `<text class="axis-label" x="${g.x(i).toFixed(1)}" y="${g.H - 8}"
       text-anchor="${k === 0 ? 'start' : k === arr.length - 1 ? 'end' : 'middle'}">${esc(cfg.labels[i] || '')}</text>`).join('');

  let body = '';
  if (cfg.type === 'column') {
    const bw = Math.max(4, (g.iw / g.n) * 0.62);
    body = cfg.series[0].values.map((v, i) => {
      const yy = g.y(v), h = Math.max(2, g.padT + g.ih - yy);
      return `<rect class="col-bar${i === g.n - 1 ? ' col-bar--now' : ''}" data-i="${i}"
        x="${(g.x(i) - bw / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4"/>`;
    }).join('');
  } else {
    body = cfg.series.map((s, si) => {
      const pts = s.values.map((v, i) => `${g.x(i).toFixed(1)},${g.y(v).toFixed(1)}`).join(' ');
      const area = si === 0
        ? `<path class="series-area" data-series="0" d="M${g.x(0).toFixed(1)},${(g.padT + g.ih).toFixed(1)} L${pts.split(' ').join(' L')} L${g.x(g.n - 1).toFixed(1)},${(g.padT + g.ih).toFixed(1)} Z" fill="url(#${gid})"/>`
        : '';
      return area + `<polyline class="series-line${si ? ' series-line--b' : ''}" data-series="${si}" points="${pts}"/>`
        + s.values.map((v, i) => `<circle class="series-dot${si ? ' series-dot--b' : ''}" data-series="${si}"
            cx="${g.x(i).toFixed(1)}" cy="${g.y(v).toFixed(1)}" r="2.6"/>`).join('');
    }).join('');
  }

  /* One transparent hit strip per period. This is what makes touch work: a
     finger only has to land in the right column, not on a 3px dot. */
  const hits = Array.from({ length: g.n }, (_, i) => {
    const w = g.iw / g.n;
    const left = cfg.type === 'column' ? g.padL + w * i : g.x(i) - w / 2;
    return `<rect class="col-hit" data-hit="${i}" x="${Math.max(0, left).toFixed(1)}" y="${g.padT}"
      width="${w.toFixed(1)}" height="${g.ih.toFixed(1)}"/>`;
  }).join('');

  const guide = cfg.type === 'line'
    ? `<line class="guide" data-role="guide" x1="0" y1="${g.padT}" x2="0" y2="${(g.padT + g.ih).toFixed(1)}"/>` : '';
  const activeDots = cfg.type === 'line'
    ? cfg.series.map((s, si) => `<circle class="active-dot${si ? ' active-dot--b' : ''}" data-role="active" data-series="${si}" r="5" cx="0" cy="0"/>`).join('')
    : '';

  return `<svg viewBox="0 0 ${g.W} ${g.H}" preserveAspectRatio="none" tabindex="0" role="img"
      aria-label="${esc(cfg.alt || 'Chart. The same figures are listed in the table below.')}"
      style="width:100%;height:${g.H}px;display:block;overflow:visible">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#BFD9A8" stop-opacity=".55"/>
      <stop offset="100%" stop-color="#BFD9A8" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}${body}${guide}${activeDots}${hits}${axis}
  </svg>`;
}

/* ----------------------------------------------------------------- hydrate -- */
function hydrate(el, opts = {}) {
  const cfg = REG.get(el.dataset.chart);
  if (!cfg || el.__veyeChart) return;
  el.__veyeChart = true;

  const svg = el.querySelector('svg');
  const tip = el.querySelector('[data-role="tip"]');
  const plot = el.querySelector('[data-role="plot"]');
  const live = el.querySelector('[data-role="live"]');
  const valueEl = el.querySelector('[data-role="value"]');
  const labelEl = el.querySelector('[data-role="label"]');
  if (!svg) return;

  const H = cfg.height || 230;
  const g = geometry(cfg, H);
  const hidden = new Set();
  let active = -1;
  let keyboard = false;
  let announceTimer = null;

  const visibleSeries = () => cfg.series.map((s, i) => i).filter((i) => !hidden.has(i));

  function firstVisible() { const v = visibleSeries(); return v.length ? v[0] : 0; }

  function setActive(i, fromKeyboard) {
    if (i == null || i < 0 || i >= g.n) return;
    active = i;
    keyboard = !!fromKeyboard;
    el.classList.add('is-active');

    /* The readout is the primary way to read a value. The tooltip repeats it. */
    const s0 = cfg.series[firstVisible()];
    valueEl.textContent = fmt(s0.values[i], s0.unit);
    labelEl.textContent = (cfg.readoutLabel || '') + ' ' + (cfg.labels[i] || '');

    // active point + guide
    const gx = g.x(i);
    const guide = svg.querySelector('[data-role="guide"]');
    if (guide) { guide.setAttribute('x1', gx); guide.setAttribute('x2', gx); }
    svg.querySelectorAll('[data-role="active"]').forEach((dot) => {
      const si = +dot.dataset.series;
      if (hidden.has(si)) { dot.style.display = 'none'; return; }
      dot.style.display = '';
      dot.setAttribute('cx', gx);
      dot.setAttribute('cy', g.y(cfg.series[si].values[i]));
    });
    svg.querySelectorAll('.col-bar').forEach((b) => b.classList.toggle('is-active', +b.dataset.i === i));

    // tooltip, kept inside the plot box
    tip.innerHTML = `<b>${esc(cfg.labels[i] || '')}</b>` + visibleSeries().map((si) => `
      <span class="tip-series"><span class="tip-swatch" style="background:${SERIES_COLOUR[si] || 'var(--sage)'}"></span>
      ${esc(cfg.series[si].label)}: <b style="display:inline">${fmt(cfg.series[si].values[i], cfg.series[si].unit)}</b></span>`).join('');
    const box = plot.getBoundingClientRect();
    const left = (gx / g.W) * box.width;
    const tipW = tip.offsetWidth || 150;
    let x = left - tipW / 2;
    x = Math.max(2, Math.min(box.width - tipW - 2, x));
    tip.style.left = x + 'px';
    tip.style.top = '0px';

    /* Announce only for keyboard use, and only once movement settles. Speaking
       on every mouse pixel would make the chart unusable with a screen reader. */
    if (fromKeyboard) {
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => {
        live.textContent = (cfg.labels[i] || '') + ': ' + visibleSeries()
          .map((si) => cfg.series[si].label + ' ' + fmt(cfg.series[si].values[i], cfg.series[si].unit)).join(', ');
      }, 320);
    }
  }

  function clear() {
    if (keyboard) return;              // keyboard selection survives the mouse leaving
    el.classList.remove('is-active');
    const s0 = cfg.series[firstVisible()];
    const lastI = s0.values.length - 1;
    valueEl.textContent = fmt(s0.values[lastI], s0.unit);
    labelEl.textContent = (cfg.readoutLabel || '') + ' ' + (cfg.labels[lastI] || '');
  }

  /* pointer + touch. pointermove covers mouse, pen and finger in one path. */
  svg.querySelectorAll('[data-hit]').forEach((r) => {
    const i = +r.dataset.hit;
    r.addEventListener('pointerenter', () => setActive(i, false));
    r.addEventListener('pointerdown', (e) => { e.preventDefault(); setActive(i, false); });
  });
  svg.addEventListener('pointerleave', clear);

  /* keyboard: arrows move, Home/End jump, Escape lets go. Tab is untouched, so
     focus is never trapped. */
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setActive(active < 0 ? 0 : Math.min(g.n - 1, active + 1), true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setActive(active < 0 ? g.n - 1 : Math.max(0, active - 1), true); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0, true); }
    else if (e.key === 'End') { e.preventDefault(); setActive(g.n - 1, true); }
    else if (e.key === 'Escape') { keyboard = false; clear(); live.textContent = ''; }
  });
  svg.addEventListener('focus', () => { if (active < 0) setActive(g.n - 1, true); });
  svg.addEventListener('blur', () => { keyboard = false; clear(); });

  /* legend */
  el.querySelectorAll('[data-series]').forEach((btn) => {
    if (btn.tagName !== 'BUTTON') return;
    btn.addEventListener('click', () => {
      const i = +btn.dataset.series;
      const on = btn.getAttribute('aria-pressed') === 'true';
      if (on && visibleSeries().length === 1) return;      // never hide the last one
      if (on) hidden.add(i); else hidden.delete(i);
      btn.setAttribute('aria-pressed', String(!on));
      svg.querySelectorAll(`[data-series="${i}"]`).forEach((n) => {
        if (n.tagName === 'BUTTON') return;
        n.style.display = on ? 'none' : '';
      });
      if (active >= 0) setActive(active, keyboard); else clear();
    });
  });

  if (opts.animate && !reduced()) enter(el, svg, cfg, g);
}

/* Entrance: lines draw, columns grow. Once, and only once. */
function enter(el, svg, cfg, g) {
  if (cfg.type === 'column') {
    svg.querySelectorAll('.col-bar').forEach((bar, i) => {
      bar.style.transformOrigin = 'center bottom';
      bar.style.transform = 'scaleY(0)';
      bar.classList.add('is-growing');
      bar.style.transitionDelay = Math.min(i * 26, 420) + 'ms';
      requestAnimationFrame(() => { bar.style.transform = 'scaleY(1)'; });
    });
    return;
  }
  svg.querySelectorAll('.series-line').forEach((line) => {
    const len = line.getTotalLength ? line.getTotalLength() : 0;
    if (!len) return;
    line.style.strokeDasharray = len;
    line.style.strokeDashoffset = len;
    line.classList.add('is-drawing');
    requestAnimationFrame(() => { line.style.strokeDashoffset = '0'; });
    line.addEventListener('transitionend', function done() {
      line.style.strokeDasharray = '';
      line.classList.remove('is-drawing');
      line.removeEventListener('transitionend', done);
    });
  });
  const area = svg.querySelector('.series-area');
  if (area) {
    area.classList.add('is-fading');
    requestAnimationFrame(() => area.classList.add('is-in'));
  }
  svg.querySelectorAll('.series-dot').forEach((d, i) => {
    d.style.opacity = '0';
    d.style.transition = 'opacity 260ms var(--ease)';
    d.style.transitionDelay = Math.min(300 + i * 24, 780) + 'ms';
    requestAnimationFrame(() => { d.style.opacity = '1'; });
  });
}

window.Veye = window.Veye || { screens: {} };
window.Veye.C = { markup, hydrate };

})();
