/* ============================================================================
   Settings — Your account · Administrators · Product settings · Feature states
   ----------------------------------------------------------------------------
   The console's Settings (platform/web app/admin/settings/page.tsx): the small
   set of account and product controls the Beta needs.

   Administrators are provisioned by invitation, but there are still no roles,
   teams or permission levels: every administrator gets the same console. Two
   guards hold whatever the screen does: nobody may switch off their own
   access, and the last active administrator cannot be switched off.

   Your picture is processed here in the browser — cropped, scaled and
   re-encoded, which drops location and camera details — and never leaves it.
   Product settings carries the two V2 cards, Privacy & prospects and Health
   sharing (js/screens/settings-cards.js).
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const MODES = [
  { key: 'account', label: 'Your account', route: '/settings/account' },
  { key: 'administrators', label: 'Administrators', route: '/settings/administrators' },
  { key: 'product', label: 'Product settings', route: '/settings/product' },
  { key: 'features', label: 'Feature states', route: '/settings/features' },
];
const INVITATION_LABELS = { accepted: 'Accepted', pending: 'Invitation sent', expired: 'Invitation expired', seeded: 'System account' };
const INVITATION_TONES = { accepted: 'live', pending: 'draft', expired: 'attention', seeded: 'archived' };

let ui = {};

function render(outlet, route) {
  const mode = (MODES.find((m) => m.key === route.params.section) || MODES[0]).key;
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Settings', desc: 'The small set of account and product controls the Beta needs.', crumbs: [{ label: 'Home', route: '/home' }, { label: 'Settings' }] })}
    ${H.subnav(MODES, mode)}
    <div id="setBody"></div>
  </div>`;
  const body = outlet.querySelector('#setBody');
  ({ account, administrators, product, features })[mode](body, outlet, route);
}

/* ============================================================ YOUR ACCOUNT == */
function describeSessions(rows) {
  if (rows.length <= 1) return 'This console session only.';
  const others = rows.filter((r) => !r.current);
  const consoles = others.filter((r) => r.portal === 'admin').length;
  const members = others.length - consoles;
  const parts = [];
  if (consoles) parts.push(`${consoles} other console ${consoles === 1 ? 'session' : 'sessions'}`);
  if (members) parts.push(`${members} member application ${members === 1 ? 'session' : 'sessions'}`);
  return `${rows.length} sessions in all: this one, plus ${parts.join(' and ')}.`;
}

const memberAppNote = () => UI.modal({
  title: 'The member application',
  body: '<p class="t-support">Members — and you, with your own member profile — sign in to the Veye application at /login: a separate door with its own session, showing only your own records. It is not part of this console prototype.</p>',
  actions: [{ label: 'Close', variant: 'secondary', value: 'close', autofocus: true }],
});

function account(host, outlet, route) {
  const me = S.me();
  const memberAccess = !!me.memberId && !!S.member(me.memberId);
  const sessions = S.get().mySessions;
  host.innerHTML = `
    <div class="hgrid hgrid--flip" data-testid="settings-account">
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">${esc(me.firstName)} ${esc(me.lastName)}</h2><p class="t-support">Administrator</p></div>
          ${H.avatar(me, 'lg')}</div>
        <div class="card__body stack gap-5">
          <div class="row gap-2 wrap" style="align-items:center">
            <input type="file" id="photoInput" accept="image/jpeg,image/png,image/webp" hidden data-testid="admin-photo-input">
            <button class="btn btn--secondary btn--sm" type="button" id="photoChange" data-testid="admin-photo-change">${me.photo ? 'Change picture' : 'Add a picture'}</button>
            ${me.photo ? '<button class="btn btn--ghost btn--sm" type="button" id="photoRemove" data-testid="admin-photo-remove">Remove</button>' : ''}
            <span class="t-support">JPG, PNG or WebP, up to 2 MB. Location and camera details are removed.</span>
          </div>
          ${ui.photoNote ? `<p class="${ui.photoNote.tone === 'error' ? 'errorbar' : 't-support'}" role="status" data-testid="admin-photo-note">${esc(ui.photoNote.text)}</p>` : ''}
          <div><div class="t-eyebrow">Email</div><p data-testid="settings-admin-email">${esc(me.email)}</p></div>
          <div><div class="t-eyebrow">Access</div><p>Full VEYE administration${memberAccess ? ' · also holds a member profile (signs into the member application separately at /login)' : ''}</p></div>
          <div data-testid="settings-member-access">
            <div class="t-eyebrow">Member application</div>
            ${memberAccess
              ? '<p>You have your own member profile. <button type="button" class="linkbtn" id="openMemberApp" data-testid="open-member-app">Open the member application</button> — it has its own sign-in, and shows only your own records.</p>'
              : '<p>You do not have a member profile, so <code>/login</code> refuses this account. <button class="btn btn--secondary btn--sm" type="button" id="createProfile" data-testid="create-member-profile">Create my member profile</button></p>'}
          </div>
          <div class="notice notice--quiet">${icon('info', { size: 18 })}<div>This Beta console has one administrator capability. Roles, teams and organisation hierarchies are intentionally not included: every administrator account can do the same things. Who holds that access is managed under <a href="${R.href('/settings/administrators')}">Administrators</a>.</div></div>
        </div>
      </div>
      <div class="card" data-testid="settings-admin-security">
        <div class="card__head"><div><h2 class="card__title">Account security</h2><p class="t-support">Your own password and the places this account is signed in.</p></div></div>
        <div class="card__body card__body--flush"><div class="rows">
          ${ui.changing ? `<form class="rowitem rowitem--form" method="post" id="pwForm" novalidate>
            <span class="rowitem__icon">${icon('lock', { size: 18 })}</span>
            <div class="stack gap-3" style="min-width:0">
              <div class="rowitem__title">Change your password</div>
              <div class="field"><label class="field__label" for="curPw">Current password</label><input class="input" id="curPw" type="password" autocomplete="current-password" required data-testid="admin-password-current"></div>
              <div class="field"><label class="field__label" for="newPw">New password</label><input class="input" id="newPw" type="password" autocomplete="new-password" required data-testid="admin-password-new"></div>
              <div class="field"><label class="field__label" for="confPw">Confirm new password</label><input class="input" id="confPw" type="password" autocomplete="new-password" required data-testid="admin-password-confirm"></div>
              <div class="row gap-2 wrap">
                <button class="btn btn--primary btn--sm" type="submit" id="pwSave" data-testid="admin-password-save">Save new password</button>
                <button class="btn btn--ghost btn--sm" type="button" id="pwCancel">Cancel</button>
              </div>
              <p class="t-support">At least 12 characters. You stay signed in here; every other session of this account ends — including the member application, because the password is the same one.</p>
            </div>
          </form>` : `<div class="rowitem">
            <span class="rowitem__icon">${icon('lock', { size: 18 })}</span>
            <div><div class="rowitem__title">Password</div><div class="rowitem__meta">Change it here with your current one, or have a single-use link emailed to ${esc(me.email)}.</div></div>
            <span class="row gap-2">
              <button class="btn btn--secondary btn--sm" type="button" id="pwOpen" data-testid="admin-open-password">Change password</button>
              <button class="btn btn--ghost btn--sm" type="button" id="pwLink" data-testid="admin-email-link">Email a link</button>
            </span>
          </div>`}
          <div class="rowitem">
            <span class="rowitem__icon">${icon('users', { size: 18 })}</span>
            <div style="min-width:0"><div class="rowitem__title">Where you are signed in</div><div class="rowitem__meta" data-testid="admin-sessions">${esc(describeSessions(sessions))}</div></div>
            ${sessions.some((s) => !s.current) ? '<button class="btn btn--secondary btn--sm" type="button" id="revokeOthers" data-testid="admin-revoke-others">Sign out everywhere else</button>' : '<span></span>'}
          </div>
          <div class="rowitem"><span class="rowitem__icon rowitem__icon--off">${icon('shield', { size: 18 })}</span><div><div class="rowitem__title">Two-step verification</div><div class="rowitem__meta">Built, not live. Google Cloud Identity Platform token verification and the TOTP requirement for this console are implemented and tested; SMS is deliberately not accepted. What remains is the cloud project, the tenant and the browser sign-in half.</div></div>${H.chip('Ready, not live', 'info')}</div>
          <div class="rowitem"><span class="rowitem__icon">${icon('log-out', { size: 18 })}</span><div><div class="rowitem__title">Sign out</div><div class="rowitem__meta">Ends this console session only; a member session in the same browser stays.</div></div><button class="btn btn--secondary btn--sm" type="button" id="signOutRow">Sign out</button></div>
        </div></div>
        <div class="card__foot" id="secFoot" ${ui.securityNote ? '' : 'hidden'}><p class="t-support" role="status" data-testid="admin-security-note">${esc(ui.securityNote || '')}</p></div>
      </div>
    </div>`;

  const again = () => account(host, outlet, route);
  const input = host.querySelector('#photoInput');
  host.querySelector('#photoChange').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const btn = host.querySelector('#photoChange');
    btn.disabled = true; btn.textContent = 'Saving…';
    processPicture(file).then((photo) => {
      const version = Date.now().toString(36);
      S.set({ admins: S.get().admins.map((a) => (a.userId === me.userId ? { ...a, photo, photoVersion: version } : a)) });
      // One picture per sign-in account: the member record shows the same one.
      if (me.memberId) S.updateMember(me.memberId, (x) => { x.photo = photo; x.photoVersion = version; return x; });
      S.audit('account.photo_changed', 'user_account', me.userId, {});
      ui.photoNote = { tone: 'ok', text: 'Your picture is updated.' + (memberAccess ? ' It is the same picture in the member application.' : '') };
      window.Veye.refreshChrome();
      again();
    }).catch((err) => { ui.photoNote = { tone: 'error', text: err.message }; again(); });
  });
  const remove = host.querySelector('#photoRemove');
  if (remove) remove.addEventListener('click', () => H.busy(remove, 'Remove', () => {
    S.set({ admins: S.get().admins.map((a) => (a.userId === me.userId ? { ...a, photo: null, photoVersion: null } : a)) });
    if (me.memberId) S.updateMember(me.memberId, (x) => { x.photo = null; x.photoVersion = null; return x; });
    S.audit('account.photo_removed', 'user_account', me.userId, {});
    ui.photoNote = { tone: 'ok', text: 'Picture removed — your initials are shown instead.' };
    window.Veye.refreshChrome();
    again();
  }, 250));

  const create = host.querySelector('#createProfile');
  if (create) create.addEventListener('click', () => profileDrawer(again));
  const open = host.querySelector('#openMemberApp');
  if (open) open.addEventListener('click', memberAppNote);

  const pwOpen = host.querySelector('#pwOpen');
  if (pwOpen) pwOpen.addEventListener('click', () => { ui.changing = true; ui.securityNote = ''; again(); });
  const pwLink = host.querySelector('#pwLink');
  if (pwLink) pwLink.addEventListener('click', () => H.busy(pwLink, 'Sending…', () => {
    const sent = S.deliver(me.email);
    ui.securityNote = sent.status !== 'sent'
      ? `The password-change link could not be sent: ${sent.detail || 'mail service unavailable'}.`
      : 'A password-change link has been emailed to you (local development mailbox). It works once and expires in 30 minutes.';
    again();
  }));
  const form = host.querySelector('#pwForm');
  if (form) {
    host.querySelector('#pwCancel').addEventListener('click', () => { ui.changing = false; ui.securityNote = ''; again(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const current = host.querySelector('#curPw').value;
      const next = host.querySelector('#newPw').value;
      const confirm = host.querySelector('#confPw').value;
      // A refusal is written under the form without redrawing it, so what was
      // typed stays where it was.
      const note = (text) => {
        ui.securityNote = text;
        host.querySelector('[data-testid="admin-security-note"]').textContent = text;
        host.querySelector('#secFoot').hidden = false;
      };
      if (next.length < 12) return note('Choose a password of at least 12 characters.');
      if (next !== confirm) return note('The two new passwords do not match.');
      H.busy(host.querySelector('#pwSave'), 'Saving…', () => {
        // Every password in this prototype is at least twelve characters, so a
        // shorter "current" one is the wrong one.
        if (current.length < 12) { note('That current password is not right.'); return; }
        if (current === next) { note('Choose a password you have not used here before.'); return; }
        const ended = S.get().mySessions.filter((s) => !s.current).length;
        S.set({ mySessions: S.get().mySessions.filter((s) => s.current) });
        syncSessions();
        ui.changing = false;
        ui.securityNote = 'Your password has been changed.' + (ended ? ` ${ended} other signed-in ${ended === 1 ? 'session was' : 'sessions were'} ended.` : '');
        again();
      });
    });
  }
  const revoke = host.querySelector('#revokeOthers');
  if (revoke) revoke.addEventListener('click', () => H.busy(revoke, 'Signing out…', () => {
    const ended = S.get().mySessions.filter((s) => !s.current).length;
    S.set({ mySessions: S.get().mySessions.filter((s) => s.current) });
    syncSessions();
    ui.securityNote = ended ? `${ended} other ${ended === 1 ? 'session was' : 'sessions were'} signed out.` : 'This is the only place you are signed in.';
    again();
  }));
  host.querySelector('#signOutRow').addEventListener('click', () => window.Veye.signOut());
}

/** The Administrators row counts the console sessions this account holds. */
function syncSessions() {
  const me = S.me();
  const count = S.get().mySessions.filter((s) => s.portal === 'admin').length;
  S.set({ admins: S.get().admins.map((a) => (a.userId === me.userId ? { ...a, activeSessions: count } : a)) });
}

/** Crop to a square and re-encode, which also drops EXIF (location, camera). */
function processPicture(file) {
  return new Promise((resolve, reject) => {
    if (!file.size) return reject(new Error('Choose an image file.'));
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return reject(new Error('Please choose a JPG, PNG or WebP image.'));
    if (file.size > 2 * 1000 * 1000) return reject(new Error('The photo is too large. Please use an image under 2 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const draw = (size) => {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
        return c.toDataURL('image/jpeg', 0.86);
      };
      const photo = { thumb: draw(96), full: draw(256) };
      URL.revokeObjectURL(url);
      resolve(photo);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
    img.src = url;
  });
}

/* Create my member profile: the same account gains its own member profile.
   Not impersonation, and not a way to see anyone else's data. */
function profileDrawer(after) {
  UI.drawer({
    eyebrow: 'Your account',
    title: 'Create my member profile',
    desc: 'A member profile for you personally, on this same account.',
    body: `<form id="memberProfileForm" class="stack gap-4" method="post">
      <ul class="t-support" style="padding-left:18px;margin:0">
        <li>This creates <b>your own</b> member profile. Anything you record in the member application is your personal health data.</li>
        <li>It is not a way to see or act as any other member, and it gives you nothing in the console you do not already have.</li>
        <li>You keep one account and one password; the member application has its own sign-in at <code>/login</code>.</li>
        <li>Your health records follow the same sharing rules as everyone else’s: the console sees them only if you choose to share.</li>
      </ul>
      <label class="row gap-2" style="align-items:flex-start">
        <input type="checkbox" id="mpUnderstood" data-testid="member-profile-understood">
        <span>I understand this creates personal health data about me, and is not impersonation.</span>
      </label>
      <div class="field">
        <label for="mpPassword">Your current password</label>
        <input class="input" id="mpPassword" type="password" autocomplete="current-password" required data-testid="member-profile-password">
        <span class="field__hint">Confirms it is really you before anything changes.</span>
      </div>
      <p class="errorbar" role="alert" id="mpError" hidden></p>
    </form>`,
    foot: `<button class="btn btn--primary" type="submit" form="memberProfileForm" id="mpSubmit" data-testid="member-profile-submit" disabled>Create my member profile</button>
      <button class="btn btn--ghost" type="button" id="mpCancel">Cancel</button>`,
    onMount: (ref) => {
      const el = ref.el;
      const understood = el.querySelector('#mpUnderstood');
      const pw = el.querySelector('#mpPassword');
      const submit = el.querySelector('#mpSubmit');
      const sync = () => { submit.disabled = !understood.checked || !pw.value; };
      understood.addEventListener('change', sync);
      pw.addEventListener('input', sync);
      el.querySelector('#mpCancel').addEventListener('click', () => ref.close());
      el.querySelector('#memberProfileForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const err = el.querySelector('#mpError');
        err.hidden = true;
        if (!understood.checked) { err.textContent = 'Tick the box to confirm you have read this.'; err.hidden = false; return; }
        H.busy(submit, 'Creating…', () => {
          if (pw.value.length < 12) { err.textContent = 'That password is not right.'; err.hidden = false; return; }
          const me = S.me();
          const id = S.newId();
          const at = S.now();
          S.set({ members: [...S.get().members, {
            id, accountId: me.userId, firstName: me.firstName, lastName: me.lastName, name: me.name, initials: H.initialsOf(me.name),
            email: me.email, pendingEmail: null, emailVerified: true, isActive: true, deactivatedAt: null, isSynthetic: true, adminAccess: true,
            joinedAt: at, lastActiveAt: null, onboarding: 'Not started', phone: null, postalCode: null, photo: me.photo, photoVersion: me.photoVersion,
            activeSessions: 0, lastSessionAt: null,
            sharing: { state: 'not_requested', requested_at: null, requested_by_name: '', decided_at: null, revoked_at: null, policy_version: '', delivery: null },
            records: { health_number: [], body_composition: [], blood_markers: [], health_assessment: [], simple_quiz: [] }, mood: [], diary: [], guided: [],
          }], admins: S.get().admins.map((a) => (a.userId === me.userId ? { ...a, memberId: id } : a)) });
          S.audit('account.member_profile_created', 'user_account', me.userId, { member_id: id });
          el.querySelector('.drawer__body').innerHTML = `<div class="stack gap-3" data-testid="member-profile-done">
            <p>Your member profile is ready. Sign in at /login with this same email and password to use the member application.</p>
            <p class="t-support">Your administrator access is unchanged. The two applications stay separate: signing in at <code>/login</code> gives you the member application with your own records; <code>/admin/login</code> gives you this console.</p>
            <button class="btn btn--secondary" type="button" id="mpToMember">Go to the member sign-in</button>
          </div>`;
          el.querySelector('#mpToMember').addEventListener('click', memberAppNote);
          el.querySelector('.drawer__foot').innerHTML = '<button class="btn btn--primary" type="button" id="mpClose">Close</button>';
          el.querySelector('#mpClose').addEventListener('click', () => ref.close());
          after();
        });
      });
    },
  });
}

/* ========================================================== ADMINISTRATORS == */
function adminRows() {
  const me = S.me();
  return S.get().admins.map((a) => ({ ...a, is_self: a.userId === me.userId, also_member: !!a.memberId && !!S.member(a.memberId),
    initials: H.initialsOf(a.name) }));
}

function administrators(host, outlet, route) {
  const rows = adminRows();
  const activity = S.accountActivity({ limit: 8 });
  host.innerHTML = `
    <div class="card" data-testid="settings-administrators">
      <div class="card__head">
        <div><h2 class="card__title">Administrators</h2>
          <p class="t-support">Everyone who can open this console. Administrator access is provisioned here — there is no sign-up for it — and every administrator has exactly the same console.</p></div>
        <button class="btn btn--primary btn--sm" type="button" id="inviteAdmin" data-testid="invite-admin">Invite administrator</button>
      </div>
      <div class="card__body card__body--flush">
        ${H.errorbar(ui.adminError)}
        ${ui.adminNotice ? `<p class="t-support" role="status" style="padding:12px 20px 0" data-testid="admins-notice">${esc(ui.adminNotice)}</p>` : ''}
        <div class="minirow" style="min-width:330px;padding:var(--s-4) var(--s-5) 0" data-testid="admins-counts">
          <div class="mini"><span class="mini__n">${rows.length}</span><span class="mini__l">Administrators</span></div>
          <div class="mini"><span class="mini__n">${rows.filter((r) => r.isActive).length}</span><span class="mini__l">Active</span></div>
          <div class="mini"><span class="mini__n">${rows.filter((r) => r.invitation === 'pending').length}</span><span class="mini__l">Invitation pending</span></div>
        </div>
        <div class="table-wrap"><table class="table table--rows" data-testid="admins-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Invitation</th><th scope="col" data-col-priority="medium">Last active</th><th scope="col">Account</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            ${rows.map((r) => `<tr>
              <td><div class="person">${H.avatar(r, 'sm')}<div style="min-width:0">
                <div class="cell-primary">${esc(r.name)}${r.is_self ? '<span class="tag" style="margin-left:8px">you</span>' : ''}</div>
                ${r.also_member ? '<div class="cell-sub">Also a Veye member</div>' : ''}</div></div></td>
              <td><span class="cell-sub">${esc(r.email)}</span></td>
              <td style="white-space:nowrap">${H.chip(INVITATION_LABELS[r.invitation], INVITATION_TONES[r.invitation])}
                ${r.invitedAt && r.invitation !== 'accepted' ? `<div class="cell-sub">Sent ${esc(H.fmtDate(r.invitedAt))}${r.invitedBy ? ' by ' + esc(r.invitedBy) : ''}</div>` : ''}
                ${r.acceptedAt ? `<div class="cell-sub">Accepted ${esc(H.fmtDate(r.acceptedAt))}</div>` : ''}</td>
              <td data-col-priority="medium">${r.lastActiveAt ? esc(H.fmtDate(r.lastActiveAt)) : '<span class="t-muted">Never</span>'}
                ${r.activeSessions > 0 ? `<div class="cell-sub">${r.activeSessions} signed in now</div>` : ''}</td>
              <td style="white-space:nowrap">${H.chip(r.isActive ? 'Active' : 'Deactivated', r.isActive ? 'live' : 'archived')}
                ${!r.isActive && r.deactivatedAt ? `<div class="cell-sub">${esc(H.fmtDate(r.deactivatedAt))}</div>` : ''}</td>
              <td style="text-align:right;white-space:nowrap">
                ${r.invitation === 'pending' || r.invitation === 'expired'
                  ? `<button class="btn btn--secondary btn--sm" type="button" data-act="resend" data-id="${r.userId}" ${r.isActive ? '' : 'disabled'}>Resend</button>
                     <button class="btn btn--ghost btn--sm" type="button" data-act="revoke-invitation" data-id="${r.userId}" ${r.is_self ? 'disabled' : ''}>Withdraw</button>`
                  : r.isActive
                    ? `<button class="btn btn--danger-quiet btn--sm" type="button" data-act="deactivate" data-id="${r.userId}" ${r.is_self ? 'disabled title="You cannot deactivate your own account"' : ''}>Deactivate</button>`
                    : `<button class="btn btn--secondary btn--sm" type="button" data-act="reactivate" data-id="${r.userId}">Reactivate</button>`}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
      ${activity.length ? `<div class="card__body card__body--flush" data-testid="admins-activity">
        <div class="t-eyebrow" style="padding:16px 20px 0">Recent access changes</div>
        <div class="rows">${activity.map((a) => `<div class="rowitem">
          <span class="rowitem__icon">${icon('shield', { size: 18 })}</span>
          <div style="min-width:0"><div class="rowitem__title">${esc(a.label)}</div><div class="rowitem__meta">${esc(a.email || 'an account')} · by ${esc(a.actor_name)}</div></div>
          <span class="t-support" style="white-space:nowrap">${esc(H.fmtDate(a.at))}</span>
        </div>`).join('')}</div>
      </div>` : ''}
      <div class="card__foot"><span class="t-support">An invitation link works once and expires in 72 hours. Nobody can deactivate their own account, and the last active administrator cannot be deactivated — the console can never be left without a way in. Every action here is recorded above and in the full audit log.</span></div>
    </div>`;

  const again = () => administrators(host, outlet, route);
  host.querySelector('#inviteAdmin').addEventListener('click', () => inviteDrawer(again));
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const row = adminRows().find((r) => r.userId === b.dataset.id);
    const action = b.dataset.act;
    const confirms = {
      'revoke-invitation': { title: 'Withdraw this invitation?', message: `Withdraw the invitation for ${esc(row.email)}? The link stops working immediately.`, confirmLabel: 'Withdraw', danger: true },
      deactivate: { title: 'Deactivate this administrator?', message: `Deactivate ${esc(row.name)}? They are signed out at once and cannot sign in again until reactivated.`, confirmLabel: 'Deactivate', danger: true },
    };
    if (confirms[action]) { const r = await UI.confirm(confirms[action]); if (!r.ok) return; }
    ui.adminNotice = ''; ui.adminError = '';
    const labels = { resend: 'Sending…', deactivate: 'Working…', reactivate: 'Working…', 'revoke-invitation': 'Withdraw' };
    H.busy(b, labels[action], () => {
      const at = S.now();
      const admins = S.get().admins;
      if (action === 'deactivate') {
        if (row.is_self) { ui.adminError = 'You cannot deactivate your own account.'; return again(); }
        const others = admins.filter((a) => a.userId !== row.userId && a.isActive && a.invitation !== 'pending' && a.invitation !== 'expired').length;
        if (others === 0) { ui.adminError = 'This is the last active administrator. Invite another one first.'; return again(); }
        S.set({ admins: admins.map((a) => (a.userId === row.userId ? { ...a, isActive: false, deactivatedAt: at, activeSessions: 0 } : a)) });
        // One sign-in account: switching it off closes the member door too.
        if (row.memberId) S.updateMember(row.memberId, (x) => { x.isActive = false; x.deactivatedAt = at; x.activeSessions = 0; return x; });
        S.audit('administrator.deactivated', 'user_account', row.userId, { email: row.email });
        ui.adminNotice = `${row.name} has been deactivated and signed out.`;
      } else if (action === 'reactivate') {
        S.set({ admins: admins.map((a) => (a.userId === row.userId ? { ...a, isActive: true, deactivatedAt: null } : a)) });
        if (row.memberId) S.updateMember(row.memberId, (x) => { x.isActive = true; x.deactivatedAt = null; return x; });
        S.audit('administrator.reactivated', 'user_account', row.userId, { email: row.email });
        ui.adminNotice = `${row.name} can use the console again.`;
      } else if (action === 'resend') {
        const sent = S.deliver(row.email);
        S.set({ admins: admins.map((a) => (a.userId === row.userId ? { ...a, invitation: 'pending', invitedAt: at, invitedBy: S.me().name } : a)) });
        S.audit('administrator.invitation_resent', 'user_account', row.userId, { email: row.email, delivery: sent.status });
        ui.adminNotice = sent.status !== 'sent' ? `The invitation could not be sent: ${sent.detail || 'mail service unavailable'}.` : `A fresh invitation has been emailed to ${row.email}.`;
      } else {
        if (row.is_self) { ui.adminError = 'You cannot withdraw your own access.'; return again(); }
        // Withdrawing removes console access: the row leaves this list. A
        // member account keeps its member profile; nothing else changes.
        S.set({ admins: admins.filter((a) => a.userId !== row.userId) });
        if (row.memberId) S.updateMember(row.memberId, (x) => { x.adminAccess = false; return x; });
        S.audit('administrator.invitation_revoked', 'user_account', row.userId, { email: row.email });
        ui.adminNotice = `The invitation for ${row.email} has been withdrawn.`;
      }
      again();
    });
  }));
}

function inviteDrawer(after) {
  UI.drawer({
    eyebrow: 'Administrators',
    title: 'Invite an administrator',
    desc: 'They receive a single-use link, choose their own password, and then sign in at /admin/login. You never see or set it.',
    body: `<form id="inviteAdminForm" class="stack gap-4" method="post" novalidate>
      <div class="field"><label for="invFirst">First name</label><input class="input" id="invFirst" required maxlength="120" data-testid="invite-first-name"></div>
      <div class="field"><label for="invLast">Last name</label><input class="input" id="invLast" maxlength="120" data-testid="invite-last-name"><span class="field__hint">Optional</span></div>
      <div class="field"><label for="invEmail">Email address</label><input class="input" id="invEmail" type="email" required data-testid="invite-email"><span class="field__hint">The invitation is sent here; it becomes their sign-in address.</span></div>
      <p class="t-support">Inviting someone who already has a Veye member account adds console access to that same account. They keep one password and sign in through whichever door they need.</p>
    </form>`,
    foot: `<button class="btn btn--primary" type="submit" form="inviteAdminForm" id="invSend" data-testid="invite-send">Send invitation</button>
      <button class="btn btn--ghost" type="button" id="invCancel">Cancel</button>
      <span class="field__error" id="invError" style="margin-left:auto" hidden></span>`,
    onMount: (ref) => {
      const el = ref.el;
      el.querySelector('#invCancel').addEventListener('click', () => ref.close());
      el.querySelector('#inviteAdminForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const err = el.querySelector('#invError');
        const fail = (text) => { err.textContent = text; err.hidden = false; };
        err.hidden = true;
        const first = el.querySelector('#invFirst').value.trim();
        const last = el.querySelector('#invLast').value.trim();
        const email = el.querySelector('#invEmail').value.trim().toLowerCase();
        if (!first) return fail('An administrator needs a first name.');
        if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) return fail('Enter a valid email address.');
        const existing = S.get().admins.find((a) => a.email.toLowerCase() === email);
        if (existing && existing.isActive) return fail('That person already has administrator access.');
        if (existing) return fail('That account is deactivated. Reactivate it before inviting them again.');
        H.busy(el.querySelector('#invSend'), 'Sending…', () => {
          const member = S.get().members.find((m) => m.email.toLowerCase() === email);
          const at = S.now();
          const userId = member ? member.accountId : S.newId();
          const name = member ? member.name : `${first}${last ? ' ' + last : ''}`;
          const row = { userId, firstName: member ? member.firstName : first, lastName: member ? member.lastName : last, name, email,
            invitation: 'pending', invitedAt: at, invitedBy: S.me().name, acceptedAt: null, lastActiveAt: null, activeSessions: 0,
            isActive: true, deactivatedAt: null, memberId: member ? member.id : null, photo: member ? member.photo : null, photoVersion: null };
          S.set({ admins: [...S.get().admins, row] });
          if (member) S.updateMember(member.id, (x) => { x.adminAccess = true; return x; });
          const sent = S.deliver(email);
          S.audit('administrator.invited', 'user_account', userId, { email, new_account: !member, delivery: sent.status });
          ui.adminNotice = sent.status !== 'sent'
            ? `${email} was added, but the invitation email could not be sent: ${sent.detail || 'mail service unavailable'}.`
            : `An invitation has been emailed to ${email}. It works once and expires in 72 hours.`;
          ui.adminError = '';
          ref.close();
          after();
        });
      });
    },
  });
}

/* ========================================================= PRODUCT SETTINGS == */
function supportCard(host) {
  const org = S.get().org;
  host.innerHTML = `
      <form class="card" method="post" id="supportForm" novalidate style="height:100%">
        <div class="card__head"><div><h2 class="card__title">Member support</h2><p class="t-support">The address on the member dashboard’s Contact Us card, and the one Veye’s account emails and request replies tell members to write to. The public Help page is not changed from here.</p></div></div>
        <div class="card__body stack gap-5">
          ${H.errorbar(ui.supportError)}
          <div class="field"><label class="field__label" for="supportEmail">Support email</label><input class="input" id="supportEmail" type="email" required value="${esc(org.supportEmail)}" data-testid="support-email-input"></div>
          <div class="field"><label class="field__label" for="supportPhone">Support phone <span class="t-support">(optional)</span></label><input class="input" id="supportPhone" type="tel" maxlength="40" value="${esc(org.supportPhone)}" data-testid="support-phone-input"></div>
          ${org.supportUpdatedAt ? `<p class="t-support">Last saved ${esc(H.fmtDate(org.supportUpdatedAt))}${org.supportUpdatedBy ? ' by ' + esc(org.supportUpdatedBy) : ''}.</p>` : ''}
          ${ui.supportNotice ? `<p class="t-support" role="status" data-testid="support-saved">${esc(ui.supportNotice)}</p>` : ''}
        </div>
        <div class="card__foot"><button class="btn btn--primary" type="submit" id="supportSave" data-testid="support-save">Save support details</button></div>
      </form>`;
  host.querySelector('#supportForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = host.querySelector('#supportEmail').value.trim().toLowerCase();
    const phone = host.querySelector('#supportPhone').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) { ui.supportError = 'Enter a valid support email address.'; ui.supportNotice = ''; supportCard(host); return; }
    H.busy(host.querySelector('#supportSave'), 'Saving…', () => {
      S.set({ org: { ...S.get().org, supportEmail: email, supportPhone: phone, supportUpdatedAt: S.now(), supportUpdatedBy: S.me().name } });
      S.audit('settings.support.update', 'product_setting', 'support', { support_email: email });
      ui.supportError = '';
      ui.supportNotice = "Support details saved. The member dashboard's Contact Us card reads them on its next load, and account emails and request replies carry them from now on.";
      supportCard(host);
    });
  });
}

function product(host, outlet, route) {
  host.innerHTML = `
    <div class="hgrid" data-testid="settings-product">
      <div id="supportHost"></div>
      <div class="card">
        <div class="card__head"><div><h2 class="card__title">Beta defaults</h2><p class="t-support">Behaviour the console could switch once it exists.</p></div></div>
        <div class="card__body card__body--flush"><div class="rows">
          <div class="rowitem"><span class="rowitem__icon">${icon('edit', { size: 18 })}</span><div><div class="rowitem__title">Daily health tip</div><div class="rowitem__meta">Written and published in <a href="${R.href('/content/member_copy')}">Content → Member copy</a> (key <code>daily_health_tip</code>); the dashboard shows the published text.</div></div>${H.chip('Content', 'live')}</div>
          <div class="rowitem"><span class="rowitem__icon rowitem__icon--off">${icon('bell', { size: 18 })}</span><div><div class="rowitem__title">Tracker reminders</div><div class="rowitem__meta">No reminder is sent yet; members see the same “not connected” note in their Settings. A switch will appear here with the reminder release.</div></div>${H.chip('Not built', 'draft')}</div>
          <div class="rowitem"><span class="rowitem__icon">${icon('sprout', { size: 18 })}</span><div><div class="rowitem__title">Companion review queue</div><div class="rowitem__meta">Sensitive replies are held for review in <a href="${R.href('/companion/settings')}">Companion → Settings</a>, where Sprout’s wording and topic rules live.</div></div>${H.chip('Companion', 'live')}</div>
        </div></div>
      </div>
      <div id="privacyHost" style="grid-column:1 / -1"></div>
      <div id="sharingHost" style="grid-column:1 / -1"></div>
    </div>`;

  supportCard(host.querySelector('#supportHost'));
  window.Veye.privacyCard(host.querySelector('#privacyHost'));
  window.Veye.healthSharingCard(host.querySelector('#sharingHost'));

  if (route.query.focus) {
    const target = host.querySelector('#' + route.query.focus);
    if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }
}

/* =========================================================== FEATURE STATES == */
const STATE_TONE = { available: 'live', holding: 'draft', client_input: 'attention', phase_2: 'archived' };
const STATE_LABELS = { available: 'Available', holding: 'In development', client_input: 'Client input required', phase_2: 'Phase 2' };

function features(host) {
  const st = S.get();
  const published = (k) => st.careItems.filter((i) => i.kind === k && i.status === 'Published').length;
  const activeFlows = st.guidedFlows.filter((f) => f.status === 'Active').length;
  const rows = [
    ['Health Number', 'available', '12-question deterministic assessment with dated history.'],
    ['Body Composition / BMI', 'available', 'Client body-fat tables; unsupported combinations report not available.'],
    ['Blood Test Markers', 'available', 'Member entry, goal flags, client supplement table.'],
    ['Health Assessment', 'available', '11 questions, 11–33 lower is better, EPA/DHA by score.'],
    ['Simple Quiz', 'available', '8 yes/no count; never touches the Health Number.'],
    ['Mood Tracker', 'available', 'One mood per day with a note; Balance score by the client formula.'],
    ['Food Diary', 'available', 'Meal entries, the prototype macro estimate, day Save, rule-based feedback and history.'],
    ['Food Choices', 'available', "The client's four food lists and the HOW TO meal builder, transcribed from AI Chatbot Training.docx (250804) with a paragraph reference on every row. Portion units for p0249 are the one open question."],
    ['Meal Planning', 'available', "Saved days, the client's sample days and date assignment. AI-assisted planning is in development."],
    ['Mindfulness', 'client_input', 'No content supplied; section stays in development.'],
    ['Fitness', 'phase_2', `Phase 2. ${published('fitness')} published Care Studio item(s) and the approved development preview; final scope and content are Phase 2.`],
    ['Supplements', 'phase_2', `Phase 2. ${published('supplement')} published; Vitamin Overview awaits citations. Final scope and content are Phase 2.`],
    ['Resources', 'phase_2', `Phase 2. ${published('resource')} published; the four cards stay Coming Soon until their content is supplied.`],
    ['Veye Companion (Sprout)', 'available', `${activeFlows} guided experience(s) active; local mock provider by default.`],
    ['Requests & Inbox', 'available', 'Contact Us, Help questions and Join Beta land in the console and are answered from it; the reply is emailed and kept on the request.'],
    ['Activity Tracker (Exercise, Meditation)', 'client_input', 'Data source not chosen (manual, phone health, wearable).'],
    ['Production email (Google Workspace)', 'holding', 'Transport selected: Google Workspace SMTP (smtp.gmail.com:587, STARTTLS) from contact@veye.co. Mailpit locally; live delivery pending the rotated credential and a verified send.'],
    ['Production AI provider (Gemini on Google Cloud)', 'holding', 'Provider selected: Gemini on Google Cloud. Integration, covered-service configuration and the BAA gate are outstanding; no member data reaches an external provider today.'],
  ];
  host.innerHTML = `<div class="card" data-testid="settings-features">
    <div class="card__head"><div><h2 class="card__title">Feature states</h2><p class="t-support">Derived from what is built and what the client has supplied — there is no switch here.</p></div></div>
    <div class="card__body card__body--flush">
      <div class="table-wrap"><table class="table table--rows">
        <thead class="sr-only"><tr><th scope="col">Area</th><th scope="col">State</th><th scope="col">Note</th></tr></thead>
        <tbody>${rows.map(([label, state, note]) => `<tr>
          <td><div class="cell-primary">${esc(label)}</div></td>
          <td style="white-space:nowrap">${H.chip(STATE_LABELS[state], STATE_TONE[state])}</td>
          <td class="t-support">${esc(note)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
  </div>`;
}

window.Veye.screens = window.Veye.screens || {};
/* Arriving at Settings starts clean: notes from a previous visit are not shown. */
window.Veye.screens.settings = { render: (outlet, route) => { ui = {}; render(outlet, route); } };

})();
