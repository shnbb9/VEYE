/* ============================================================================
   Veye Admin Console — shared rendering helpers
   ----------------------------------------------------------------------------
   The prototype's copies of the console's page primitives
   (platform/web components/admin/admin-chrome.tsx: PageHead, Subnav, Chip,
   EmptyState, Metric, fmtDate), so every screen is built from the same parts
   the real console uses.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const esc = window.Veye.UI.esc;

/* ------------------------------------------------------------ page header -- */
/** @param {object} o { title, desc (html), crumbs:[{label,route}], actions:html } */
function pageHead(o = {}) {
  const crumbs = (o.crumbs || []).map((c, i, arr) => {
    const last = i === arr.length - 1;
    return last || !c.route
      ? `<span aria-current="page">${esc(c.label)}</span>`
      : `<span><a href="${R.href(c.route)}">${esc(c.label)}</a><span class="breadcrumb__sep"> › </span></span>`;
  }).join('');

  return `
    <div class="page__head">
      ${crumbs ? `<nav class="breadcrumb" aria-label="Breadcrumb">${crumbs}</nav>` : ''}
      <div class="page__title-row">
        <div class="page__titles">
          <h1>${esc(o.title || '')}</h1>
          ${o.desc ? `<p class="page__desc">${o.desc}</p>` : ''}
        </div>
        ${o.actions ? `<div class="page__actions">${o.actions}</div>` : ''}
      </div>
    </div>`;
}

/**
 * Section navigation, as the console's Subnav renders it: the tab strip, plus
 * the labelled selector that the stylesheet shows instead below 768px (the
 * console gained the selector on 15 Nov 2026; this prototype always had it).
 */
let navSeq = 0;
function subnav(items, activeKey) {
  const id = 'sn' + (++navSeq);
  const current = items.find((i) => i.key === activeKey);
  return `<nav class="subnav" aria-label="Section">
    ${items.map((i) => `<a class="subnav__btn${i.key === activeKey ? ' is-active' : ''}"
        href="${R.href(i.route)}" ${i.key === activeKey ? 'aria-current="page"' : ''}>${esc(i.label)}${i.count != null && i.count > 0 ? `<span class="subnav__count">${i.count}</span>` : ''}</a>`).join('')}
  </nav>
  <div class="sectionpick">
    <label class="sectionpick__label" for="${id}">Section</label>
    <select class="select sectionpick__select" id="${id}" data-sectionnav>
      ${items.map((i) => `<option value="${esc(i.route)}" ${i.key === activeKey ? 'selected' : ''}>${esc(i.label)}${i.count ? ' (' + i.count + ')' : ''}</option>`).join('')}
      ${current ? '' : '<option selected disabled>Choose a section</option>'}
    </select>
  </div>`;
}

/* ------------------------------------------------------------------ chips --
   The console's own tone map (admin-chrome.tsx CHIP_TONE): a label it does not
   list is drawn in the draft tone — "Published" included. */
const CHIP_TONE = {
  Active: 'live', Inactive: 'draft', Draft: 'draft', Archived: 'archived', ingested: 'live', failed: 'error', pending: 'draft',
  answered: 'live', prohibited: 'attention', escalated: 'attention', off_topic: 'draft', unavailable: 'error', support: 'info', safety: 'attention',
  allow: 'live', prohibit: 'attention', escalate: 'error', helpful: 'live', not_helpful: 'attention', pass: 'live',
  enabled: 'live', disabled: 'archived', sent: 'live', skipped: 'draft',
};
function chip(label, tone, extra = '') {
  const t = tone || CHIP_TONE[label] || 'draft';
  return `<span class="chip chip--${t}${extra ? ' ' + extra : ''}">${esc(String(label).replace(/_/g, ' '))}</span>`;
}

/* --------------------------------------------------------------- states --- */
function emptyState(o = {}) {
  return `<div class="state">
    <span class="state__icon">${icon(o.icon || 'inbox')}</span>
    <div class="state__title">${esc(o.title || 'Nothing here yet')}</div>
    ${o.msg ? `<p class="state__msg">${o.msg}</p>` : ''}
    ${o.action || ''}
  </div>`;
}

function errorbar(message) { return message ? `<p class="errorbar" role="alert">${esc(message)}</p>` : ''; }

function metric(label, value, note, tone) {
  return `<div class="metric">
    <span class="metric__icon${tone ? ` metric__icon--${tone}` : ''}">${icon('activity', { size: 18 })}</span>
    <div class="metric__body">
      <span class="metric__label">${esc(label)}</span>
      <span class="metric__value">${value}</span>
      ${note ? `<span class="metric__delta">${esc(note)}</span>` : ''}
    </div>
  </div>`;
}

/* ---------------------------------------------------------- form controls -- */
function field(o = {}) {
  const id = o.id || 'f-' + Math.random().toString(36).slice(2, 7);
  const control = o.type === 'textarea'
    ? `<textarea class="textarea" id="${id}" name="${id}" rows="${o.rows || 4}"
         ${o.required ? 'required' : ''} ${o.readonly ? 'readonly' : ''} ${o.maxlength ? `maxlength="${o.maxlength}"` : ''}
         placeholder="${esc(o.placeholder || '')}">${esc(o.value || '')}</textarea>`
    : o.type === 'select'
      ? `<select class="select" id="${id}" name="${id}">${(o.options || []).map((op) => {
          const [value, label] = Array.isArray(op) ? op : [op, op];
          return `<option value="${esc(value)}" ${String(value) === String(o.value) ? 'selected' : ''}>${esc(label)}</option>`;
        }).join('')}</select>`
      : `<input class="input" id="${id}" name="${id}" type="${o.type || 'text'}"
           value="${esc(o.value == null ? '' : o.value)}" ${o.required ? 'required' : ''}
           ${o.readonly ? 'readonly' : ''} ${o.disabled ? 'disabled' : ''} ${o.maxlength ? `maxlength="${o.maxlength}"` : ''}
           ${o.autocomplete ? `autocomplete="${o.autocomplete}"` : ''}
           placeholder="${esc(o.placeholder || '')}">`;
  return `<div class="field">
    <label for="${id}">${esc(o.label || '')}${o.required ? ' <span class="t-muted">(required)</span>' : ''}</label>
    ${control}
    ${o.hint ? `<span class="field__hint" id="${id}-hint">${o.hint}</span>` : ''}
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

/**
 * The console's "busy" pattern: the button says what it is doing ("Saving…"),
 * everything finishes a beat later, and the result is written on the screen.
 */
function busy(btn, label, work, delay = 420) {
  if (!btn) { work(); return; }
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = label;
  setTimeout(() => {
    if (document.contains(btn)) { btn.disabled = false; btn.innerHTML = original; }
    work();
  }, delay);
}

/* ---------------------------------------------------------------- dates ----
   Exactly the console's fmtDate: the browser's own locale, day, short month,
   year, hour and minute — so the prototype reads the same dates the same way. */
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function monthLabel(month) {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}
/** The last twelve calendar months, oldest first, as YYYY-MM. */
function lastTwelveMonths() {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
function monthOf(iso) { const t = new Date(iso); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; }
/** The API's UTC wording (strftime "%d %b %Y"), used in the sharing-eligibility sentence. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function utcDay(iso) { const t = new Date(iso); return `${String(t.getUTCDate()).padStart(2, '0')} ${MON[t.getUTCMonth()]} ${t.getUTCFullYear()}`; }
function utcDayTime(iso) { const t = new Date(iso); return `${utcDay(iso)}, ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`; }

/* ------------------------------------------------------------------ misc --- */
function n(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return `${(parts[0] || '')[0] || ''}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase() || '?';
}
function plural(count, one, many) { return `${count} ${count === 1 ? one : (many || one + 's')}`; }

/** An avatar: the person's picture when there is one, their initials when not. */
function avatar(person, size = '') {
  const cls = `avatar${size ? ' avatar--' + size : ''}`;
  const src = person && (size === 'lg' ? (person.photo && person.photo.full) : (person.photo && person.photo.thumb));
  return src
    ? `<span class="${cls} avatar--photo"><img src="${src}" alt=""></span>`
    : `<span class="${cls}">${esc(person.initials || initialsOf(person.name))}</span>`;
}

window.Veye.H = {
  pageHead, subnav, chip, CHIP_TONE, emptyState, errorbar, metric,
  field, fieldError, clearErrors, busy,
  fmtDate, monthLabel, lastTwelveMonths, monthOf, utcDay, utcDayTime,
  n, initialsOf, plural, avatar, esc,
};

})();
