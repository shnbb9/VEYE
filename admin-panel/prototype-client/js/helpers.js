/* ============================================================================
   Veye Admin Console — shared rendering helpers
   Page scaffolding, chart primitives and the small pieces every screen repeats.
   Charts here always emit an accessible alternative alongside the picture.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const esc = window.Veye.UI.esc;

/* ------------------------------------------------------------ page header -- */
/**
 * @param {object} o { title, desc, crumbs:[{label,route}], actions:html, meta:html }
 */
function pageHead(o = {}) {
  const crumbs = (o.crumbs || []).map((c, i, arr) => {
    const last = i === arr.length - 1;
    return last || !c.route
      ? `<span aria-current="page">${esc(c.label)}</span>`
      : `<a href="${R.href(c.route)}">${esc(c.label)}</a><span class="breadcrumb__sep">›</span>`;
  }).join('');

  return `
    <div class="page__head">
      ${crumbs ? `<nav class="breadcrumb" aria-label="Breadcrumb">${crumbs}</nav>` : ''}
      <div class="page__title-row">
        <div class="page__titles">
          <h1>${esc(o.title || '')}</h1>
          ${o.desc ? `<p class="page__desc">${o.desc}</p>` : ''}
          ${o.where ? `<button type="button" class="linkbtn wherebtn" data-where="${esc(o.where)}">
            ${icon('info', { size: 14 })} Where does this appear?</button>` : ''}
        </div>
        ${o.actions ? `<div class="page__actions">${o.actions}</div>` : ''}
      </div>
      ${o.meta ? `<div class="page__meta">${o.meta}</div>` : ''}
    </div>`;
}

/** Section heading with a rule and an optional aside. */
function sec(title, aside) {
  return `<div class="sec"><h2>${esc(title)}</h2><span class="sec__rule"></span>
    ${aside ? `<span class="sec__aside">${aside}</span>` : ''}</div>`;
}

/**
 * Section navigation. One markup, two presentations.
 *
 * Desktop keeps the tab strip. On a phone the same choices become a labelled
 * selector, because five or six tabs wrapped into a two- or three-row block that
 * pushed the actual screen below the fold. Both are always in the DOM; CSS shows
 * whichever fits, so no JavaScript is needed to keep them in step.
 */
let navSeq = 0;
function subnav(items, activeKey) {
  const id = 'sn' + (++navSeq);
  /* Phase 2 locking ended on 20 Aug 2026 — every section is a real link now,
     and the phone selector carries plain routes. */
  const current = items.find((i) => i.key === activeKey);

  return `<nav class="subnav" aria-label="Section">
    ${items.map((i) => `<a class="subnav__btn${i.key === activeKey ? ' is-active' : ''}"
        href="${R.href(i.route)}" ${i.key === activeKey ? 'aria-current="page"' : ''}>${esc(i.label)}
        ${i.count != null ? `<span class="subnav__count">${i.count}</span>` : ''}</a>`).join('')}
  </nav>
  <div class="sectionpick">
    <label class="sectionpick__label" for="${id}">Section</label>
    <select class="select sectionpick__select" id="${id}" data-sectionnav>
      ${items.map((i) => `<option value="${esc(i.route)}" ${i.key === activeKey ? 'selected' : ''}>${esc(i.label)}${i.count != null ? ' (' + i.count + ')' : ''}</option>`).join('')}
      ${current ? '' : '<option selected disabled>Choose a section</option>'}
    </select>
  </div>`;
}

/* ------------------------------------------------------------------ chips -- */
const CHIP_TONE = {
  Live: 'live', Published: 'live', Active: 'live', Connected: 'live', Accepted: 'live', Complete: 'live',
  Draft: 'draft', Inactive: 'draft', Paused: 'paused', Archived: 'archived', Pending: 'draft',
  Scheduled: 'scheduled', Review: 'review', Attention: 'attention', Deactivated: 'archived',
  'Not connected': 'archived', 'Coming Soon': 'draft', 'In development': 'review',
};
function chip(label, tone) {
  const t = tone || CHIP_TONE[label] || 'draft';
  return `<span class="chip chip--${t}">${esc(label)}</span>`;
}

/* ------------------------------------------------------------------ charts -- */

/** Format a number with thousands separators. */
function n(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/**
 * A line chart with a soft area fill.
 * @param {number[]} series
 * @param {object} o { labels, height, min, max, id, unit }
 */
function lineChart(series, o = {}) {
  const W = 640, H = o.height || 230, padL = 34, padR = 10, padT = 12, padB = 26;
  const lo = o.min != null ? o.min : Math.min(...series);
  const hi = o.max != null ? o.max : Math.max(...series);
  const span = (hi - lo) || 1;
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = (i) => padL + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
  const y = (v) => padT + ih - ((v - lo) / span) * ih;

  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${(padT + ih).toFixed(1)} L${pts.split(' ').join(' L')} L${x(series.length - 1).toFixed(1)},${(padT + ih).toFixed(1)} Z`;
  const gid = 'ga-' + Math.random().toString(36).slice(2, 7);

  const gridY = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const yy = padT + ih - f * ih;
    return `<line class="grid-line" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"/>
            <text class="axis-label" x="4" y="${(yy + 4).toFixed(1)}">${(lo + f * span).toFixed(span < 6 ? 1 : 0)}</text>`;
  }).join('');

  const labels = (o.labels || []).map((l, i, arr) => {
    const idx = Math.round((i / Math.max(1, arr.length - 1)) * (series.length - 1));
    return `<text class="axis-label" x="${x(idx).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}">${esc(l)}</text>`;
  }).join('');

  return `<svg class="lchart${o.height && o.height < 180 ? ' lchart--sm' : ''}" viewBox="0 0 ${W} ${H}"
      preserveAspectRatio="none" role="img" aria-label="${esc(o.alt || 'Trend chart. The same figures are listed in the table below.')}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#BFD9A8" stop-opacity=".55"/>
      <stop offset="100%" stop-color="#BFD9A8" stop-opacity="0"/>
    </linearGradient></defs>
    ${gridY}
    <path d="${area}" fill="url(#${gid})"/>
    <polyline class="line" points="${pts}"/>
    ${series.map((v, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3"/>`).join('')}
    ${labels}
  </svg>`;
}

/** Vertical columns — better than a line where each month is a discrete count. */
function columns(series, labels, o = {}) {
  const hi = Math.max(...series) || 1;
  return `<div class="chartbox">
    <div class="cols" role="img" aria-label="${esc(o.alt || 'Column chart. The same figures are listed in the table below.')}">
      ${series.map((v, i) => `<span class="col"><span class="col__bar${i === series.length - 1 ? ' col__bar--now' : ''}"
        style="height:${Math.max(3, (v / hi) * 100).toFixed(1)}%"></span></span>`).join('')}
    </div>
    <div class="colaxis">${labels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
  </div>`;
}

/** Horizontal labelled bars. rows = [{label, n, tone}]
 *  Each fill carries `data-grow`, so it grows from zero once when it first comes
 *  into view. The width is already correct in the markup, so a reader with
 *  reduced motion — or no JavaScript past this point — sees the finished bar. */
function barList(rows, o = {}) {
  const hi = o.max || Math.max(...rows.map((r) => r.n)) || 1;
  return `<div class="bars">${rows.map((r) => `
    <div class="bar">
      <span class="bar__label">${esc(r.label)}</span>
      <span class="bar__track"><span class="bar__fill${r.tone ? ' bar__fill--' + r.tone : ''}" data-grow
        style="width:${Math.max(2, (r.n / hi) * 100).toFixed(1)}%"></span></span>
      <span class="bar__n">${o.suffix ? r.n + o.suffix : n(r.n)}</span>
    </div>`).join('')}</div>`;
}

/**
 * The accessible alternative that must sit beneath every chart.
 * @param {string} summary  what the disclosure is called
 * @param {string[]} head   column headings
 * @param {Array<string[]>} rows
 */
function chartAlt(summary, head, rows, caption) {
  return `<details class="chart-alt">
    <summary>${esc(summary)}</summary>
    <div class="table-wrap"><table class="table table--compact">
      ${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}
      <thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => i === 0
        ? `<th scope="row">${c}</th>` : `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
  </details>`;
}

/* --------------------------------------------------------------- empties --- */
function emptyState(o = {}) {
  return `<div class="state">
    <div class="state__icon">${icon(o.icon || 'inbox', { size: 28 })}</div>
    <p class="state__title">${esc(o.title || 'Nothing here yet')}</p>
    ${o.msg ? `<p class="state__msg">${o.msg}</p>` : ''}
    ${o.action || ''}
  </div>`;
}

/* ---------------------------------------------------------- form controls -- */
function field(o = {}) {
  const id = o.id || 'f-' + Math.random().toString(36).slice(2, 7);
  const control = o.type === 'textarea'
    ? `<textarea class="textarea" id="${id}" name="${id}" rows="${o.rows || 4}"
         ${o.required ? 'required' : ''} ${o.readonly ? 'readonly' : ''}
         placeholder="${esc(o.placeholder || '')}">${esc(o.value || '')}</textarea>`
    : o.type === 'select'
      ? `<select class="select" id="${id}" name="${id}">${(o.options || []).map((op) =>
          `<option ${op === o.value ? 'selected' : ''}>${esc(op)}</option>`).join('')}</select>`
      : `<input class="input" id="${id}" name="${id}" type="${o.type || 'text'}"
           value="${esc(o.value == null ? '' : o.value)}" ${o.required ? 'required' : ''}
           ${o.readonly ? 'readonly' : ''} ${o.autocomplete ? `autocomplete="${o.autocomplete}"` : ''}
           placeholder="${esc(o.placeholder || '')}">`;
  return `<div class="field">
    <label for="${id}">${esc(o.label || '')}${o.required ? ' <span class="t-muted">(required)</span>' : ''}</label>
    ${control}
    ${o.hint ? `<p class="field__hint" id="${id}-hint">${o.hint}</p>` : ''}
    <p class="field__error" id="${id}-err" hidden></p>
  </div>`;
}

/** Show a field-level validation error and focus it. */
function fieldError(form, id, message) {
  const input = form.querySelector('#' + id);
  const err = form.querySelector('#' + id + '-err');
  if (!input || !err) return;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', id + '-err');
  err.innerHTML = icon('alert-circle', { size: 14 }) + ' ' + esc(message);
  err.hidden = false;
  input.focus();
}
function clearErrors(form) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.field__error').forEach((el) => { el.hidden = true; el.textContent = ''; });
}

/** A save button that shows a short loading state, then reports the result. */
function withSaving(btn, work, doneLabel) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> Saving…`;
  setTimeout(() => {
    btn.disabled = false;
    btn.innerHTML = original;
    work();
    if (doneLabel) window.Veye.UI.toast({ title: doneLabel });
  }, 480);
}

/* ---------------------------------------------------------------- dates ----
   Sorting by a display string groups "09 Aug" after "14 Aug" because it compares
   text, not time. This turns the prototype's date strings into a comparable
   number so a column sorted by date is actually in date order.
   Understands "14 Aug 2026, 07:40", "12 Feb 2026", "Today" and "Not yet". */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
                 jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const NOW = Date.UTC(2026, 7, 14, 8, 30);      // the prototype's fixed "today"

function parseWhen(s) {
  if (!s) return 0;
  const t = String(s).trim();
  if (/^today$/i.test(t)) return NOW;
  if (/^just now$/i.test(t)) return NOW + 1;
  if (/^(not yet|—|-)$/i.test(t)) return 0;
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})(?:,\s*(\d{1,2}):(\d{2}))?/);
  if (!m) return 0;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon == null) return 0;
  return Date.UTC(+m[3], mon, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

/* ------------------------------------------------------------------ misc --- */
function initials(name) {
  return String(name).split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
}

/** Health Number helpers. The scale runs LOW-IS-BETTER, so a fall is a gain. */
function hnTone(score) {
  if (score == null) return 'neutral';
  if (score <= 1) return 'ok';
  if (score <= 3.5) return 'ok';
  if (score <= 6) return 'warn';
  return 'risk';
}
function hnTrendWords(delta) {
  if (delta == null) return 'No earlier result to compare.';
  if (delta === 0) return 'Unchanged since the last check-in.';
  return delta < 0
    ? `Down ${Math.abs(delta).toFixed(1)} since the last check-in — lower is better.`
    : `Up ${delta.toFixed(1)} since the last check-in — higher means more to work on.`;
}

/* Mood markers. v1 used emoji, which render differently on every device and read
   as decoration rather than data. These are the console's own icons plus a word,
   so the meaning survives without colour and without an emoji font. */
const MOOD_FACE = { 1: '😔', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' };   // kept for the member-facing Mood Tracker reference only
const MOOD = {
  1: { icon: 'trend-down', word: 'Low', tone: 'low' },
  2: { icon: 'trend-down', word: 'Below average', tone: 'below' },
  3: { icon: 'sort', word: 'Even', tone: 'even' },
  4: { icon: 'trend-up', word: 'Good', tone: 'good' },
  5: { icon: 'trend-up', word: 'Very good', tone: 'high' },
};

window.Veye.H = {
  pageHead, sec, subnav, chip, lineChart, columns, barList, chartAlt,
  emptyState, field, fieldError, clearErrors, withSaving,
  n, initials, hnTone, hnTrendWords, MOOD_FACE, MOOD, esc, parseWhen,
};

})();
