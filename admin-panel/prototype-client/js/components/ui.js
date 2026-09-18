/* ============================================================================
   Veye Admin — overlay and feedback primitives
   Modal, drawer, confirmation, toast and menu. Every overlay traps focus,
   restores it to the control that opened it, and closes on Escape. Backdrop
   click closes low-risk overlays only.
   ============================================================================ */

(function () {

const icon = window.Veye.icon;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* How long an overlay is left in the DOM after close() so its exit can run.
   Kept in step with the transition in motion.css. Under reduced motion the
   transition is removed and the node simply waits this long before going —
   invisible either way, because it is already transparent and inert. */
const OVERLAY_EXIT = 200;

let openStack = [];

function trap(container, e) {
  if (e.key !== 'Tab') return;
  const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function mountOverlay({ scrimClass, html, closeOnScrim, onClose, labelledBy }) {
  const opener = document.activeElement;
  const scrim = document.createElement('div');
  scrim.className = scrimClass;
  scrim.innerHTML = html;
  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';

  const panel = scrim.firstElementChild;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  if (labelledBy) panel.setAttribute('aria-labelledby', labelledBy);

  const entry = { scrim, panel, opener, onClose };
  openStack.push(entry);

  const keyHandler = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    trap(panel, e);
  };
  scrim.addEventListener('keydown', keyHandler);

  if (closeOnScrim) {
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  }

  function close(result) {
    if (!openStack.includes(entry)) return;
    openStack = openStack.filter((x) => x !== entry);
    scrim.removeEventListener('keydown', keyHandler);
    if (!openStack.length) document.body.style.overflow = '';

    /* Focus goes back to the opener straight away — before the exit finishes —
       so a keyboard user is never left with focus on a panel that is leaving.
       The panel is made inert for the same reason: while it is animating out it
       must not be reachable by Tab or a pointer. */
    if (opener && document.contains(opener)) opener.focus();
    scrim.setAttribute('aria-hidden', 'true');
    scrim.style.pointerEvents = 'none';
    scrim.classList.remove('is-open');
    scrim.classList.add('is-closing');
    setTimeout(() => scrim.remove(), OVERLAY_EXIT);

    if (onClose) onClose(result);
  }
  entry.close = close;

  /* Open on the next frame so there is a start state to move from. Reduced
     motion lands on the open state in the same frame — see motion.css. */
  requestAnimationFrame(() => scrim.classList.add('is-open'));

  // Focus the first sensible control inside the overlay.
  requestAnimationFrame(() => {
    const target = panel.querySelector('[data-autofocus]')
      || panel.querySelector(FOCUSABLE);
    if (target) target.focus();
    else { panel.setAttribute('tabindex', '-1'); panel.focus(); }
  });

  return { el: panel, close };
}

/* ------------------------------------------------------------------- modal */
/**
 * @param {object} o  { title, desc, body, actions:[{label,variant,value,autofocus,onClick}],
 *                      size, closeOnScrim, onClose }
 */
function modal(o = {}) {
  const id = 'mdl-' + Math.random().toString(36).slice(2, 8);
  const sizeCls = o.size === 'wide' ? ' modal--wide' : o.size === 'xwide' ? ' modal--xwide' : '';
  const actions = (o.actions || [{ label: 'Close', variant: 'secondary', value: 'close' }]);
  const html = `
    <div class="modal${sizeCls}">
      <div class="modal__head">
        <div>
          <h2 id="${id}" style="font-size:20px">${o.title || ''}</h2>
          ${o.desc ? `<p class="t-support" style="margin-top:6px">${o.desc}</p>` : ''}
        </div>
        <button class="icon-btn" data-close aria-label="Close dialog">${icon('x')}</button>
      </div>
      <div class="modal__body">${o.body || ''}</div>
      <div class="modal__foot${o.footSplit ? ' modal__foot--split' : ''}">
        ${actions.map((a, i) => `<button class="btn btn--${a.variant || 'secondary'}"
            data-act="${i}" ${a.autofocus ? 'data-autofocus' : ''} ${a.disabled ? 'disabled' : ''}>${a.label}</button>`).join('')}
      </div>
    </div>`;

  const ref = mountOverlay({
    scrimClass: 'modal-scrim', html, labelledBy: id,
    closeOnScrim: o.closeOnScrim !== false, onClose: o.onClose,
  });

  ref.el.querySelector('[data-close]').addEventListener('click', () => ref.close('close'));
  ref.el.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = actions[+btn.dataset.act];
      if (a.onClick) {
        const keep = a.onClick(ref);
        if (keep === false) return;      // handler asked to stay open (validation)
      }
      ref.close(a.value ?? a.label);
    });
  });
  return ref;
}

/* ------------------------------------------------------------- confirmation
   Names the object, the impact, whether it can be undone, and captures a reason
   when the action is destructive or high-impact. The confirm label says what
   happens — never "Yes". */
function confirm(o = {}) {
  return new Promise((resolve) => {
    const needReason = !!o.requireReason;
    const body = `
      <p style="font-size:15px;color:var(--text-body)">${o.message || ''}</p>
      ${o.impact ? `<div class="notice notice--warn" style="margin-top:16px">
          ${icon('alert-triangle', { size: 18 })}<div><b>What this affects</b><br>${o.impact}</div></div>` : ''}
      ${o.reversible ? `<p class="t-support" style="margin-top:12px">${o.reversible}</p>` : ''}
      ${needReason ? `<div class="field" style="margin-top:16px">
          <label for="cfm-reason">Reason <span class="t-muted">(recorded in the audit trail)</span></label>
          <textarea class="textarea" id="cfm-reason" rows="3" placeholder="Why is this change being made?"></textarea>
          <p class="field__error" id="cfm-err" hidden>${icon('alert-circle', { size: 14 })} A reason is required.</p>
        </div>` : ''}`;

    const ref = modal({
      title: o.title || 'Confirm',
      body,
      closeOnScrim: false,     // high-risk overlays do not dismiss on backdrop
      actions: [
        { label: o.cancelLabel || 'Cancel', variant: 'secondary', value: false },
        {
          label: o.confirmLabel || 'Confirm', variant: o.danger ? 'danger' : 'primary', value: true,
          onClick: (r) => {
            if (needReason) {
              const ta = r.el.querySelector('#cfm-reason');
              if (!ta.value.trim()) {
                ta.setAttribute('aria-invalid', 'true');
                r.el.querySelector('#cfm-err').hidden = false;
                ta.focus();
                return false;
              }
              ref._reason = ta.value.trim();
            }
          },
        },
      ],
      onClose: (v) => resolve(v === true ? { ok: true, reason: ref._reason || '' } : { ok: false }),
    });
  });
}

/* ------------------------------------------------------------------ drawer */
function drawer(o = {}) {
  const id = 'drw-' + Math.random().toString(36).slice(2, 8);
  const html = `
    <aside class="drawer">
      <div class="drawer__head">
        <div style="min-width:0">
          ${o.eyebrow ? `<span class="t-eyebrow">${o.eyebrow}</span>` : ''}
          <h2 id="${id}" style="font-size:20px;margin-top:2px">${o.title || ''}</h2>
          ${o.desc ? `<p class="t-support" style="margin-top:4px">${o.desc}</p>` : ''}
        </div>
        <button class="icon-btn" data-close aria-label="Close panel">${icon('x')}</button>
      </div>
      <div class="drawer__body">${o.body || ''}</div>
      ${o.foot ? `<div class="drawer__foot">${o.foot}</div>` : ''}
    </aside>`;

  const ref = mountOverlay({
    scrimClass: 'drawer-scrim', html, labelledBy: id,
    closeOnScrim: true, onClose: o.onClose,
  });
  ref.el.querySelector('[data-close]').addEventListener('click', () => ref.close());
  if (o.onMount) o.onMount(ref);
  return ref;
}

/* ------------------------------------------------------------------- toast */
let toastRegion = null;

function ensureRegion() {
  if (toastRegion && document.contains(toastRegion)) return toastRegion;
  toastRegion = document.createElement('div');
  toastRegion.className = 'toast-region';
  toastRegion.setAttribute('role', 'status');
  toastRegion.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastRegion);
  return toastRegion;
}

/**
 * Confirms object, action and next state. Undo is offered only where it is
 * genuinely safe, so the caller must opt in explicitly.
 */
function toast({ title, message, kind = 'success', undo = null, timeout = 5200 }) {
  const region = ensureRegion();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  const ic = kind === 'error' ? 'alert-circle' : kind === 'info' ? 'info' : 'check-circle';
  el.innerHTML = `
    <span class="toast__icon">${icon(ic, { size: 20 })}</span>
    <div class="toast__body">
      <div class="toast__title">${title}</div>
      ${message ? `<div class="toast__msg">${message}</div>` : ''}
      ${undo ? `<div class="toast__actions"><button class="btn btn--ghost btn--sm" data-undo>Undo</button></div>` : ''}
    </div>
    <button class="icon-btn btn--sm" data-x aria-label="Dismiss notification" style="width:28px;height:28px">${icon('x', { size: 16 })}</button>
    ${timeout ? '<span class="toast__timer" aria-hidden="true"><i></i></span>' : ''}`;
  region.appendChild(el);

  /* Entrance on the next frame so the browser has a start state to move from. */
  requestAnimationFrame(() => el.classList.add('toast--in'));

  let dead = false;
  const kill = () => {
    if (dead) return;
    dead = true;
    clearTimeout(timer);
    el.classList.remove('toast--in');
    el.classList.add('toast--out');
    /* Wait for the exit, but never leave a node behind if the transition does
       not fire — reduced motion removes it entirely. */
    setTimeout(() => el.remove(), 220);
  };

  el.querySelector('[data-x]').addEventListener('click', kill);
  if (undo) el.querySelector('[data-undo]').addEventListener('click', () => { undo(); kill(); });

  /* The countdown pauses while the toast is hovered or holds focus, so
     reaching for Undo or the close control cannot be beaten by the timer. */
  let timer = timeout ? setTimeout(kill, timeout) : null;
  const bar = el.querySelector('.toast__timer i');
  if (timeout) {
    if (bar) bar.style.animationDuration = timeout + 'ms';
    let remaining = timeout, started = Date.now();
    const hold = () => {
      if (dead || timer === null) return;
      clearTimeout(timer); timer = null;
      remaining -= Date.now() - started;
      if (bar) bar.style.animationPlayState = 'paused';
    };
    const resume = () => {
      if (dead || timer !== null) return;
      started = Date.now();
      timer = setTimeout(kill, Math.max(600, remaining));
      if (bar) bar.style.animationPlayState = 'running';
    };
    el.addEventListener('mouseenter', hold);
    el.addEventListener('mouseleave', resume);
    el.addEventListener('focusin', hold);
    el.addEventListener('focusout', resume);
  }

  return { close: kill };
}

/* -------------------------------------------------------------------- menu
   A lightweight popup menu anchored to a trigger button. Escape closes it and
   focus returns to the trigger. */
function attachMenu(trigger, buildHtml, onSelect) {
  let panel = null;

  function close() {
    if (!panel) return;
    /* Let the menu fade out, but detach it from the page first: it stops being
       reachable, stops receiving events, and the reference is dropped, so a
       second open() cannot collide with a menu that is still leaving. */
    const leaving = panel;
    panel = null;
    leaving.setAttribute('aria-hidden', 'true');
    leaving.style.pointerEvents = 'none';
    leaving.classList.add('is-closing');
    setTimeout(() => leaving.remove(), 150);
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function outside(e) { if (panel && !panel.contains(e.target) && !trigger.contains(e.target)) close(); }
  function onKey(e) {
    if (e.key === 'Escape') { close(); trigger.focus(); }
    if (panel && e.key === 'Tab') trap(panel, e);
  }

  function open() {
    close();
    panel = document.createElement('div');
    panel.className = 'menu';
    panel.setAttribute('role', 'menu');
    panel.innerHTML = typeof buildHtml === 'function' ? buildHtml() : buildHtml;
    trigger.parentElement.style.position = trigger.parentElement.style.position || 'relative';
    trigger.parentElement.appendChild(panel);
    trigger.setAttribute('aria-expanded', 'true');
    panel.querySelectorAll('[data-value]').forEach((item) => {
      item.setAttribute('role', 'menuitem');
      item.addEventListener('click', (e) => {
        if (item.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
        close();
        if (onSelect) onSelect(item.dataset.value, item);
      });
    });
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
    const first = panel.querySelector(FOCUSABLE);
    if (first) first.focus();
  }

  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    panel ? close() : open();
  });
  return { open, close };
}

/** Escape any string used inside innerHTML. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window.Veye = window.Veye || { screens: {} };
window.Veye.UI = { modal, confirm, drawer, toast, attachMenu, esc };

})();
