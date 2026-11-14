/* ============================================================================
   Sign in, and activating an invitation
   ----------------------------------------------------------------------------
   The console's two doors (platform/web app/admin/login and
   app/admin/accept-invitation). Neither shows the rail or the top bar.

   Signing in: any address that looks like one and any password of at least
   twelve characters — this is a prototype, there is no real account. The
   reset-password path runs in the panel itself, as the console's does.

   Activating an invitation: reached from the prototype chip's menu with the
   pending invitation's id. The invitee chooses a password (never seen by
   anyone at Veye), the invitation becomes Accepted, and they are sent to the
   console sign-in — which signs this prototype out, because the person
   activating is the invitee, not the administrator who invited them.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const FLASH = {
  reset: 'Your password has been changed. Sign in with your new password.',
  'signed-out': 'You are signed out of the admin console.',
  invited: 'Your administrator account is ready. Sign in with the password you just chose.',
};

function media() {
  return `<section class="auth__media">
      <img class="auth__photo" src="assets/img/login-people.jpg" alt="" decoding="async" fetchpriority="high">
      <div class="auth__over">
        <img class="auth__mark" src="assets/img/veye-logo-white.svg" alt="Veye" width="132" height="42" decoding="async">
        <p class="auth__tag">Nutrition Reimagined</p>
        <p class="auth__sub">The console behind the Veye member experience — assessments, plans, content and the people using them.</p>
      </div>
    </section>`;
}

const brand = (step) => `<div class="auth__brand${step ? ' auth-seq__step' : ''}"${step ? ' style="--i:0"' : ''}>
    <img src="assets/img/veye-logo.png" alt="Veye" width="96" height="30" decoding="async">
    <span class="auth__kicker">Admin Console</span>
  </div>`;

function render(outlet, route) {
  const flash = FLASH[route.query.flash] || '';
  let mode = 'sign-in';
  let email = S.get().rememberedEmail || '';

  function paint() {
    const panel = mode === 'sign-in' ? `
      <form class="auth__form auth-seq" id="signin" method="post" novalidate>
        ${brand(true)}
        <div class="auth-seq__step" style="--i:1">
          <h1>Sign in</h1>
          <p class="auth__lede">Welcome back. Use the email address your invitation was sent to.</p>
          ${flash ? `<p class="notice notice--quiet" style="margin-top:12px">${esc(flash)}</p>` : ''}
        </div>
        <div class="auth__fields auth-seq__step" style="--i:2">
          <div class="field">
            <label for="admin-email">Email address <span class="t-muted">(required)</span></label>
            <input class="input" id="admin-email" name="email" type="email" autocomplete="username" required placeholder="you@veye.example" value="${esc(email)}">
          </div>
          <div class="field field--pw">
            <label for="admin-password">Password <span class="t-muted">(required)</span></label>
            <input class="input" id="admin-password" name="password" type="password" autocomplete="current-password" required placeholder="Your password">
            <button class="field__reveal" type="button" id="reveal" aria-label="Show password" aria-pressed="false">${icon('eye', { size: 18 })}</button>
          </div>
        </div>
        <div class="auth__row auth-seq__step" style="--i:3">
          <label class="check"><input type="checkbox" id="admin-remember" checked><span class="check__text">Remember me</span></label>
          <button type="button" class="btn btn--ghost btn--sm" id="forgot">Forgot password?</button>
        </div>
        <p class="field__error" role="alert" id="formErr" hidden></p>
        <button class="btn btn--primary btn--lg btn--block auth__submit auth-seq__step" style="--i:3" type="submit" id="submit">Sign in</button>
        <p class="auth__legal auth-seq__step" style="--i:3">
          By signing in you agree to the Veye <button type="button" class="linkbtn" data-doc="Terms and Conditions">Terms and Conditions</button>
          and <button type="button" class="linkbtn" data-doc="Privacy Policy">Privacy Policy</button>.
          Members sign in to the Veye application at <button type="button" class="linkbtn" data-doc="/login">/login</button>.
        </p>
      </form>` : mode === 'reset' ? `
      <form class="auth__form" id="resetForm" method="post" novalidate>
        ${brand(false)}
        <h1>Reset your password</h1>
        <p class="auth__lede">We will email a single-use link that lets you set a new password. It expires after 30 minutes.</p>
        <div class="auth__fields">
          <div class="field">
            <label for="admin-reset-email">Email address <span class="t-muted">(required)</span></label>
            <input class="input" id="admin-reset-email" type="email" autocomplete="username" required placeholder="you@veye.example" value="${esc(email)}">
          </div>
        </div>
        <p class="field__error" role="alert" id="formErr" hidden></p>
        <button class="btn btn--primary btn--lg btn--block auth__submit" type="submit" id="sendReset">Send the reset link</button>
        <button class="btn btn--ghost btn--block" type="button" style="margin-top:10px" id="back">Back to sign in</button>
      </form>` : `
      <div class="auth__form">
        ${brand(false)}
        <h1>Check your email</h1>
        <p class="auth__lede">If an account exists for that address, a password-reset link has been sent.</p>
        <p class="t-support" style="margin-top:12px">Prototype: nothing was actually sent.</p>
        <button class="btn btn--primary btn--lg btn--block auth__submit" type="button" id="back">Back to sign in</button>
      </div>`;

    outlet.innerHTML = `<div class="auth" data-portal="admin">${media()}<section class="auth__panel">${panel}</section></div>`;
    wire();
  }

  function showError(text) {
    const err = outlet.querySelector('#formErr');
    err.textContent = text;
    err.hidden = !text;
  }

  function wire() {
    const back = outlet.querySelector('#back');
    if (back) back.addEventListener('click', () => { mode = 'sign-in'; paint(); });

    if (mode === 'reset') {
      outlet.querySelector('#resetForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const value = outlet.querySelector('#admin-reset-email').value.trim();
        email = value;
        if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(value)) { showError('Please enter a valid email address.'); return; }
        H.busy(outlet.querySelector('#sendReset'), 'Sending…', () => { mode = 'reset-sent'; paint(); });
      });
      return;
    }
    if (mode !== 'sign-in') return;

    const pw = outlet.querySelector('#admin-password');
    const reveal = outlet.querySelector('#reveal');
    reveal.addEventListener('click', () => {
      const showing = pw.type === 'text';
      pw.type = showing ? 'password' : 'text';
      reveal.setAttribute('aria-pressed', String(!showing));
      reveal.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
    outlet.querySelector('#forgot').addEventListener('click', () => {
      email = outlet.querySelector('#admin-email').value.trim();
      mode = 'reset';
      paint();
    });
    outlet.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => {
      const doc = b.dataset.doc;
      UI.modal({
        title: doc === '/login' ? 'The member sign-in' : doc,
        body: `<p class="t-support">${doc === '/login'
          ? 'Members sign in to the Veye application at /login, a separate door with its own session. It is not part of this console prototype.'
          : `The Veye ${esc(doc)} are published on the public Veye site. They are not part of this console prototype.`}</p>`,
        actions: [{ label: 'Close', variant: 'secondary', value: 'close', autofocus: true }],
      });
    }));

    outlet.querySelector('#signin').addEventListener('submit', (e) => {
      e.preventDefault();
      showError('');
      const value = outlet.querySelector('#admin-email').value.trim();
      const pass = pw.value;
      if (!value || !pass) { showError('Enter your email address and password.'); return; }
      const remember = outlet.querySelector('#admin-remember').checked;
      H.busy(outlet.querySelector('#submit'), 'Signing in…', () => {
        // Any address and any password of twelve or more characters: there is
        // no real account behind this prototype.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || pass.length < 12) {
          showError('That email address and password do not match.');
          return;
        }
        S.set({ signedIn: true, rememberedEmail: remember ? value : '' });
        R.navigate('/home');
      });
    });
  }

  paint();
}

/* ------------------------------------------------------ accept invitation -- */
function renderAccept(outlet, route) {
  const id = route.query.invite || '';
  const row = S.get().admins.find((a) => a.userId === id);
  let loadError = '';
  if (!id) loadError = 'This link is missing its invitation token.';
  else if (!row) loadError = 'This link is not valid. Request a new one.';
  else if (row.invitation === 'accepted') loadError = 'This link has already been used. Request a new one.';
  else if (row.invitation !== 'pending') loadError = 'This link has expired. Request a new one.';
  let done = false;

  function paint() {
    const panel = done ? `
      <div class="auth__form" data-testid="invitation-accepted">
        <h1>Your administrator account is ready</h1>
        <p class="auth__lede">Sign in to the Veye admin console with your new password.</p>
        <button class="btn btn--primary btn--lg btn--block auth__submit" type="button" id="toSignIn">Go to the console sign-in</button>
      </div>` : `
      <form class="auth__form" method="post" novalidate id="acceptForm">
        ${brand(false)}
        <h1>Set your console password</h1>
        ${loadError ? '' : `<p class="auth__lede">${row.invitedBy ? `${esc(row.invitedBy)} invited you` : 'You have been invited'} to the Veye admin console as <strong>${esc(row.email)}</strong>.</p>`}
        ${loadError ? `<div class="notice notice--warn" style="margin-top:12px">${icon('alert-circle', { size: 18 })}<div>${esc(loadError)} Ask an administrator to send a fresh invitation.</div></div>` : ''}
        <div class="auth__fields">
          <div class="field field--pw">
            <label for="newPassword">Password</label>
            <input class="input" id="newPassword" type="password" autocomplete="new-password" placeholder="Choose a password">
          </div>
          <div class="field field--pw">
            <label for="confirmPassword">Confirm password</label>
            <input class="input" id="confirmPassword" type="password" autocomplete="new-password" placeholder="Confirm password">
          </div>
        </div>
        <p class="t-support" style="margin-top:8px">At least 12 characters. Nobody at Veye can see or set it for you.</p>
        <p class="field__error" role="alert" id="formErr" hidden></p>
        <button type="submit" class="btn btn--primary btn--lg btn--block auth__submit" id="activate" ${loadError ? 'disabled' : ''}>Activate my account</button>
        <p class="auth__legal"><a class="linkbtn" href="${R.href('/login')}" id="backToSignIn">Back to the console sign-in</a></p>
      </form>`;
    outlet.innerHTML = `<div class="auth" data-portal="admin">${media()}<section class="auth__panel">${panel}</section></div>`;

    if (done) {
      outlet.querySelector('#toSignIn').addEventListener('click', () => {
        S.set({ signedIn: false });
        R.navigate('/login?flash=invited');
      });
      return;
    }
    const back = outlet.querySelector('#backToSignIn');
    back.addEventListener('click', (e) => { if (S.get().signedIn) { e.preventDefault(); R.navigate('/home'); } });
    outlet.querySelector('#acceptForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const err = outlet.querySelector('#formErr');
      const show = (text) => { err.textContent = text; err.hidden = !text; };
      show('');
      if (loadError) return;
      const pass = outlet.querySelector('#newPassword').value;
      const confirm = outlet.querySelector('#confirmPassword').value;
      if (pass.length < 12) { show('Choose a password of at least 12 characters.'); return; }
      if (pass !== confirm) { show('The two passwords do not match.'); return; }
      H.busy(outlet.querySelector('#activate'), 'Activating…', () => {
        S.set({ admins: S.get().admins.map((a) => (a.userId === row.userId ? { ...a, invitation: 'accepted', acceptedAt: S.now() } : a)) });
        done = true;
        paint();
      });
    });
  }
  paint();
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.login = { render };
window.Veye.screens['accept-invitation'] = { render: renderAccept };

})();
