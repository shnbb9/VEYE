/* ============================================================================
   Profile settings
   ----------------------------------------------------------------------------
   The signed-in administrator's own account, reached from "Your profile" in the
   account menu. It is deliberately its own route: it is not Administrators and
   it is not Organization.

   v2 splits one long page into three panels — Personal, Notifications,
   Security & sessions — so only one is on screen at a time. Nothing was removed;
   Save stays with whichever panel is open.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const PANELS = [
  { key: 'personal', label: 'Personal', route: '/profile/personal' },
  { key: 'notifications', label: 'Notifications', route: '/profile/notifications' },
  { key: 'security', label: 'Security & sessions', route: '/profile/security' },
  /* Display is a fourth PANEL, not a ninth destination. Nothing about how one
     administrator wants the console drawn belongs in the primary navigation. */
  { key: 'display', label: 'Display', route: '/profile/display' },
];

function render(outlet, route) {
  const panel = route.params.panel || 'personal';
  const me = S.get().me;

  if (!PANELS.some((p) => p.key === panel)) {
    outlet.innerHTML = `<div class="page">
      ${H.pageHead({ title: 'Your profile',
        crumbs: [{ label: 'Home', route: '/home' }, { label: 'Your profile' }],
        desc: `Your profile has no section called <code>${esc(panel)}</code>.` })}
      ${H.subnav(PANELS, null)}
      <div class="card"><div class="card__body">${H.emptyState({
        icon: 'user-cog', title: 'Four sections are available',
        msg: 'Personal, Notifications, Security &amp; sessions, and Display.',
        action: `<a class="btn btn--primary" href="${R.href('/profile/personal')}">Open Personal</a>`,
      })}</div></div></div>`;
    return;
  }

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({
      title: 'Your profile',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Your profile' }],
      desc: 'Your own account: how you sign in, how you are contacted, how dates are shown to you, and how the console is drawn.',
      where: 'profile',
      meta: `<span>${esc(me.name)}</span> <span>${esc(me.email)}</span>
             <span>Two-step verification ${esc(me.mfa === 'Enabled' ? 'on' : 'not set up')}</span>`,
    })}
    ${H.subnav(PANELS, panel)}
    <div id="profBody"></div>
  </div>`;

  ({ personal, notifications, security, display })[panel](outlet.querySelector('#profBody'), me);
}

/* ------------------------------------------------------------------ personal */
function personal(host, me) {
  host.innerHTML = `
    <div class="card" style="max-width:820px">
      <div class="card__head"><div><h2 class="card__title">About you</h2>
        <p class="t-support">Your name appears on anything you change and on messages you send.</p></div></div>
      <div class="card__body">
        <div class="row gap-6 wrap" style="align-items:center;margin-bottom:var(--s-6)">
          <span class="avatarbig" id="avatarPreview">${esc(me.initials)}</span>
          <div class="field" style="margin:0;flex:1 1 240px">
            <label for="pf-avatar">Change your picture</label>
            <input class="input" id="pf-avatar" type="file" accept="image/png,image/jpeg">
            <p class="field__hint">Nothing is uploaded in this prototype. Your initials are used until you add one.</p>
          </div>
        </div>

        <form id="profForm" novalidate>
          <div class="form-grid">
            ${H.field({ id: 'pf-name', label: 'Full name', value: me.name, required: true, autocomplete: 'name' })}
            ${H.field({ id: 'pf-email', label: 'Email address', type: 'email', value: me.email, required: true, autocomplete: 'email',
              hint: 'You sign in with this address.' })}
            ${H.field({ id: 'pf-phone', label: 'Phone', value: me.phone, autocomplete: 'tel',
              hint: 'Used only if somebody on the team needs to reach you.' })}
            ${H.field({ id: 'pf-tz', label: 'Your timezone', type: 'select', value: me.timezone,
              options: ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Kolkata'] })}
            ${H.field({ id: 'pf-date', label: 'Date format', type: 'select', value: me.dateFormat,
              options: ['D MMM YYYY', 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] })}
          </div>
          <div class="row gap-3" style="margin-top:var(--s-6);justify-content:flex-end">
            <button type="button" class="btn btn--secondary" id="profUndo">Undo changes</button>
            <button type="submit" class="btn btn--primary" id="profSave">Save changes</button>
          </div>
        </form>
      </div>
    </div>`;

  const form = host.querySelector('#profForm');

  host.querySelector('#pf-name').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (v) host.querySelector('#avatarPreview').textContent = H.initials(v);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    H.clearErrors(form);
    const name = form.querySelector('#pf-name').value.trim();
    if (!name) return H.fieldError(form, 'pf-name', 'A name is needed so the team knows who made a change.');
    const email = form.querySelector('#pf-email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return H.fieldError(form, 'pf-email', 'Enter a complete email address.');
    const phone = form.querySelector('#pf-phone').value.trim();
    if (phone && !/^[+\d][\d\s()-]{5,}$/.test(phone)) return H.fieldError(form, 'pf-phone', 'That does not look like a phone number. Leave it blank if you would rather not give one.');

    H.withSaving(form.querySelector('#profSave'), () => {
      const st = S.get();
      S.set({
        me: { ...st.me, name, email, phone, initials: H.initials(name),
          timezone: form.querySelector('#pf-tz').value, dateFormat: form.querySelector('#pf-date').value },
        admins: st.admins.map((a) => a.id === st.me.id ? { ...a, name, email, initials: H.initials(name) } : a),
      });
      S.note('Updated their own profile');
      R.navigate('/profile/personal');
      UI.toast({ title: 'Profile saved', message: 'Your details are updated across the console.' });
    });
  });

  host.querySelector('#profUndo').addEventListener('click', () => {
    R.navigate('/profile/personal');
    UI.toast({ title: 'Changes undone', kind: 'info', timeout: 2400 });
  });
}

/* ------------------------------------------------------------- notifications */
function notifications(host, me) {
  host.innerHTML = `
    <div class="hgrid" data-reveal style="max-width:1100px">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">When we email you</h2>
          <p class="t-support">These are about the console, not about members’ own notifications.</p></div></div>
        <div class="card__body">
          <div class="prefs">
            ${prefRow('email-attention', 'Something needs attention', 'A held Companion reply, a failed import or a member flagged for a first look.', me.emailPrefs.attention)}
            ${prefRow('email-weekly', 'A weekly summary', 'One email each Monday with the numbers from Insights.', me.emailPrefs.weekly)}
            ${prefRow('email-product', 'Product news from Veye', 'New features and changes to the console.', me.emailPrefs.product)}
            ${prefRow('email-security', 'Security notices', 'A new sign-in, a password change or a new administrator. Always on.', me.emailPrefs.security, true)}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2 class="card__title">What you see in the console</h2></div></div>
        <div class="card__body">
          <div class="prefs">
            ${prefRow('app-attention', 'Items needing attention', 'A count beside Members and on Home.', me.appPrefs.attention)}
            ${prefRow('app-messages', 'New member messages', 'A count beside Companion.', me.appPrefs.messages)}
            ${prefRow('app-mentions', 'When somebody names you in a note', '', me.appPrefs.mentions)}
            ${prefRow('app-content', 'When content changes', 'Somebody edits the website, a tip or a legal document.', me.appPrefs.contentChanges)}
          </div>
          <p class="qualify" style="margin-top:var(--s-6)">${icon('info', { size: 14 })}
            These save as you change them, so there is nothing to submit.</p>
        </div>
      </div>
    </div>`;

  const bind = (id, group, key) => {
    host.querySelector('#' + id).addEventListener('change', (e) => {
      const st = S.get();
      S.set({ me: { ...st.me, [group]: { ...st.me[group], [key]: e.target.checked } } });
      UI.toast({ title: e.target.checked ? 'Turned on' : 'Turned off', kind: 'info', timeout: 2400 });
    });
  };
  bind('email-attention', 'emailPrefs', 'attention');
  bind('email-weekly', 'emailPrefs', 'weekly');
  bind('email-product', 'emailPrefs', 'product');
  bind('app-attention', 'appPrefs', 'attention');
  bind('app-messages', 'appPrefs', 'messages');
  bind('app-mentions', 'appPrefs', 'mentions');
  bind('app-content', 'appPrefs', 'contentChanges');
}

/* ----------------------------------------------------------------- security */
function security(host, me) {
  host.innerHTML = `
    <div class="hgrid" data-reveal style="max-width:1100px">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Signing in</h2></div></div>
        <div class="card__body">
          <dl class="facts" style="grid-template-columns:minmax(0,1fr)">
            <div class="fact"><dt>Password</dt><dd>Last changed 2 June 2026</dd></div>
            <div class="fact"><dt>Two-step verification</dt>
              <dd>${me.mfa === 'Enabled'
                ? `<span class="chip chip--live">${icon('check', { size: 13 })} On</span> <span class="t-support">${esc(me.mfaMethod)}</span>`
                : `<span class="chip chip--attention">Not set up</span>`}</dd></div>
          </dl>
          <div class="row gap-3 wrap" style="margin-top:var(--s-5)">
            <button class="btn btn--secondary btn--sm" id="pwBtn">Change password</button>
            <button class="btn btn--ghost btn--sm" id="mfaBtn">${me.mfa === 'Enabled' ? 'Manage two-step' : 'Set up two-step'}</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Recent sessions</h2>
          <p class="t-support">Where your account is signed in.</p></div></div>
        <div class="card__body card__body--flush">
          <div class="rows">${me.sessions.map((s) => `
            <div class="rowitem" style="grid-template-columns:36px minmax(0,1fr);padding:14px 20px">
              <span class="rowitem__icon${s.current ? '' : ' rowitem__icon--off'}" style="width:32px;height:32px">
                ${icon(s.current ? 'check-circle' : 'clock', { size: 16 })}</span>
              <div>
                <div class="rowitem__title" style="font-size:var(--fs-support)">${esc(s.device)}${s.current ? ' <span class="chip chip--live chip--sm">This one</span>' : ''}</div>
                <div class="rowitem__meta">${esc(s.where)} · started ${esc(s.started)}</div>
              </div>
            </div>`).join('')}</div>
        </div>
        <div class="card__foot">
          <button class="btn btn--danger-quiet btn--sm" id="signOutAll">Sign out everywhere else</button>
        </div>
      </div>
    </div>`;

  host.querySelector('#pwBtn').addEventListener('click', changePassword);
  host.querySelector('#mfaBtn').addEventListener('click', manageMfa);

  host.querySelector('#signOutAll').addEventListener('click', async () => {
    const r = await UI.confirm({
      title: 'Sign out everywhere else?',
      message: 'Every other session ends immediately. You stay signed in here.',
      confirmLabel: 'Sign out the others', danger: true,
    });
    if (!r.ok) return;
    const st = S.get();
    S.set({ me: { ...st.me, sessions: st.me.sessions.filter((s) => s.current) } });
    S.note('Signed out their other sessions');
    R.navigate('/profile/security');
    UI.toast({ title: 'Other sessions ended', message: 'You are signed in on this device only.' });
  });
}

/* ------------------------------------------------------------------ display --
   How this administrator wants the console drawn. Four choices, no theme
   builder, no colour picker, no dark mode: each one is a real answer to a real
   complaint, and each takes effect the moment it is chosen.

   The controls are native radios in a fieldset, styled as a segmented bar. That
   is what gives arrow-key movement, the group name in a screen reader and a
   real focus ring, none of which a row of buttons would have. */
/* What `me.display` holds, and nothing else. The navigation choice is
   deliberately absent: it lives in `railCollapsed`, which the rail's own
   Collapse button writes, and a second copy of it here would drift. It is
   restored alongside these by RAIL_DEFAULT. */
const DISPLAY_DEFAULTS = { density: 'comfortable', motion: 'system', data: 'visual' };
const RAIL_DEFAULT = false;

function segbar(name, value, options) {
  return `<div class="segbar" role="none">
    ${options.map((o) => `<label class="segbar__opt">
      <input type="radio" name="${name}" value="${o.value}" ${o.value === value ? 'checked' : ''}>
      <span class="segbar__face">
        <span class="segbar__label">${esc(o.label)}</span>
        <span class="segbar__note">${esc(o.note)}</span>
      </span>
    </label>`).join('')}
  </div>`;
}

function display(host) {
  const d = { ...DISPLAY_DEFAULTS, ...(S.get().me.display || {}) };
  const railCollapsed = S.get().railCollapsed;
  const osStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  host.innerHTML = `
    <div class="card" style="max-width:860px">
      <div class="card__head"><div><h2 class="card__title">How the console looks to you</h2>
        <p class="t-support">Yours alone. None of these reach a member, another administrator, or anything
          the member product shows.</p></div></div>
      <div class="card__body">
        <div class="stack gap-6">

          <fieldset class="dset">
            <legend class="dset__legend">Density</legend>
            <p class="dset__desc">How much room table rows, list rows and form stacks take.
              Buttons, switches and the sign-in screen are never compressed.</p>
            ${segbar('dsp-density', d.density, [
              { value: 'comfortable', label: 'Comfortable', note: 'Default' },
              { value: 'compact', label: 'Compact', note: 'More rows on screen' },
            ])}
          </fieldset>

          <fieldset class="dset">
            <legend class="dset__legend">Navigation</legend>
            <p class="dset__desc">Whether the menu on the left shows its labels. On a phone the menu is a
              slide-over and this makes no difference to it.</p>
            ${segbar('dsp-rail', railCollapsed ? 'collapsed' : 'expanded', [
              { value: 'expanded', label: 'Expanded', note: 'Labels beside the icons' },
              { value: 'collapsed', label: 'Collapsed', note: 'Icons only' },
            ])}
          </fieldset>

          <fieldset class="dset" data-reveal>
            <legend class="dset__legend">Motion</legend>
            <p class="dset__desc">Entrances, count-ups and chart drawing. There is no setting that turns
              motion on against your operating system — this can only add stillness.</p>
            ${segbar('dsp-motion', d.motion, [
              { value: 'system', label: 'System default', note: osStill ? 'Your system asks for reduced motion' : 'Follow your device' },
              { value: 'reduce', label: 'Reduce motion', note: 'Everything appears at once' },
            ])}
            ${osStill ? `<p class="qualify">${icon('info', { size: 14 })}
              Your operating system already asks for reduced motion, so the console is still either way.</p>` : ''}
          </fieldset>

          <fieldset class="dset">
            <legend class="dset__legend">Data presentation</legend>
            <p class="dset__desc">Every chart in this console carries the same figures as a table beneath it.
              This decides whether that table starts open. The chart is shown either way.</p>
            ${segbar('dsp-data', d.data, [
              { value: 'visual', label: 'Visual first', note: 'Chart, table one click away' },
              { value: 'table', label: 'Table first', note: 'Figures open, chart still there' },
            ])}
          </fieldset>

        </div>
      </div>
      <div class="card__foot">
        <span class="t-support">Saved as you choose them, in this browser.</span>
        <button class="btn btn--secondary btn--sm" id="dspReset">Restore display defaults</button>
      </div>
    </div>`;

  /* Each choice writes state, re-applies the classes and re-renders whatever the
     change is visible in, so it takes effect on this screen and not on the next
     navigation. */
  const commit = (patch, railTo) => {
    const st = S.get();
    const next = { ...st, me: { ...st.me, display: { ...DISPLAY_DEFAULTS, ...st.me.display, ...patch } } };
    if (railTo !== undefined) next.railCollapsed = railTo;
    S.set(next);
    window.Veye.applyDisplay();
    document.getElementById('app').classList.toggle('is-rail-collapsed', S.get().railCollapsed);
  };

  const on = (name, fn) => host.querySelectorAll(`input[name="${name}"]`).forEach((r) =>
    r.addEventListener('change', () => { if (r.checked) fn(r.value); }));

  on('dsp-density', (v) => { commit({ density: v }); UI.toast({ title: v === 'compact' ? 'Compact density' : 'Comfortable density', kind: 'info', timeout: 2400 }); });
  on('dsp-rail', (v) => { commit({}, v === 'collapsed'); UI.toast({ title: v === 'collapsed' ? 'Menu collapsed' : 'Menu expanded', kind: 'info', timeout: 2400 }); });
  on('dsp-motion', (v) => {
    commit({ motion: v });
    UI.toast({ title: v === 'reduce' ? 'Motion reduced' : 'Motion follows your system', kind: 'info', timeout: 2400 });
  });
  on('dsp-data', (v) => {
    commit({ data: v });
    UI.toast({ title: v === 'table' ? 'Tables open first' : 'Charts first', kind: 'info', timeout: 2400 });
  });

  host.querySelector('#dspReset').addEventListener('click', () => {
    const before = { display: { ...DISPLAY_DEFAULTS, ...(S.get().me.display || {}) }, rail: S.get().railCollapsed };
    commit({ ...DISPLAY_DEFAULTS }, RAIL_DEFAULT);
    S.note('Restored their display defaults');
    R.navigate('/profile/display');
    UI.toast({
      title: 'Display defaults restored',
      message: 'Comfortable, expanded menu, system motion, charts first.',
      undo: () => {
        const st = S.get();
        S.set({ ...st, me: { ...st.me, display: before.display }, railCollapsed: before.rail });
        window.Veye.applyDisplay();
        document.getElementById('app').classList.toggle('is-rail-collapsed', before.rail);
        R.navigate('/profile/display');
        UI.toast({ title: 'Display preferences put back', kind: 'info', timeout: 2400 });
      },
    });
  });
}

function prefRow(id, label, desc, checked, locked) {
  return `<label class="pref" for="${id}">
    <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}
           style="margin-top:3px;accent-color:var(--green-primary)">
    <span>
      <span class="pref__label">${esc(label)}</span>
      ${desc ? `<span class="pref__desc">${esc(desc)}</span>` : ''}
    </span>
  </label>`;
}

function changePassword() {
  UI.modal({
    title: 'Change your password',
    body: `${H.field({ id: 'pw-old', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' })}
      ${H.field({ id: 'pw-new', label: 'New password', type: 'password', required: true, autocomplete: 'new-password',
        hint: 'At least twelve characters. A phrase you can remember beats a short jumble.' })}
      ${H.field({ id: 'pw-again', label: 'New password again', type: 'password', required: true, autocomplete: 'new-password' })}
      <div class="notice notice--quiet" style="margin-top:16px">${icon('info', { size: 18 })}
        <div>Nothing is stored in this prototype. In the real console this changes your password and ends
        every other session.</div></div>`,
    actions: [
      { label: 'Cancel', variant: 'secondary', value: false },
      { label: 'Change the password', variant: 'primary', value: true, autofocus: true, onClick: (ref) => {
        const oldPw = ref.el.querySelector('#pw-old').value;
        const a = ref.el.querySelector('#pw-new').value;
        const b = ref.el.querySelector('#pw-again').value;
        if (!oldPw) { H.fieldError(ref.el, 'pw-old', 'Enter your current password.'); return false; }
        if (a.length < 12) { H.fieldError(ref.el, 'pw-new', 'Use at least twelve characters.'); return false; }
        if (a !== b) { H.fieldError(ref.el, 'pw-again', 'The two new passwords do not match.'); return false; }
        S.note('Changed their password');
        UI.toast({ title: 'Password changed', message: 'Nothing was stored — this is a prototype.' });
      } },
    ],
  });
}

function manageMfa() {
  const me = S.get().me;
  UI.modal({
    title: me.mfa === 'Enabled' ? 'Two-step verification' : 'Set up two-step verification',
    desc: me.mfa === 'Enabled' ? 'On, using ' + me.mfaMethod + '.' : 'A second step at sign-in, on top of your password.',
    body: `<div class="rows">
        <div class="rowitem" style="grid-template-columns:40px minmax(0,1fr) auto;padding:16px 0">
          <span class="rowitem__icon">${icon('key', { size: 18 })}</span>
          <div><div class="rowitem__title">Authenticator app</div>
            <div class="rowitem__meta">A six-digit code from an app on your phone.</div></div>
          <div class="rowitem__side">${me.mfa === 'Enabled' ? '<span class="chip chip--live">In use</span>' : '<span class="chip chip--draft">Not set up</span>'}</div>
        </div>
        <div class="rowitem" style="grid-template-columns:40px minmax(0,1fr) auto;padding:16px 0">
          <span class="rowitem__icon rowitem__icon--off">${icon('messages', { size: 18 })}</span>
          <div><div class="rowitem__title">Text message</div>
            <div class="rowitem__meta">A code sent to your phone.</div></div>
          <div class="rowitem__side"><span class="chip chip--draft">Not set up</span></div>
        </div>
      </div>
      <div class="notice notice--quiet" style="margin-top:16px">${icon('info', { size: 18 })}
        <div>This prototype does not set up or verify anything. It shows where two-step verification
        lives in the real console.</div></div>`,
    actions: [{ label: 'Close', variant: 'secondary', value: 'close', autofocus: true }],
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.profile = { render };

})();
