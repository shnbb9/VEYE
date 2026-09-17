/* ============================================================================
   Sign in
   ----------------------------------------------------------------------------
   A dedicated full-screen authentication experience. The rail and utility bar
   are removed from the page before this renders (see applyChrome in app.js), so
   nothing about the signed-in console is visible to a signed-out visitor.

   There is no role selector, because there are no roles. Nobody chooses their
   own authority at sign-in.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

function render(outlet) {
  const st = S.get();

  outlet.innerHTML = `
  <div class="auth">
    <section class="auth__media">
      <!-- The one large image in the console, and the subject of the screen it
           is on. Deliberately NOT lazy: it is the hero, and deferring it would
           delay the thing this screen is about. Below 900px the panel is
           display:none and the browser skips it anyway. -->
      <img class="auth__photo" src="assets/img/login-people.jpg" alt=""
           decoding="async" fetchpriority="high">
      <div class="auth__over">
        <img class="auth__mark" src="assets/img/veye-logo-white.svg" alt="Veye"
             width="132" height="42" decoding="async">
        <p class="auth__tag">Nutrition Reimagined</p>
        <p class="auth__sub">The console behind the Veye member experience — assessments, plans, content and the people using them.</p>
      </div>
    </section>

    <section class="auth__panel">
      <!-- The entrance runs once, in four groups: the mark, the heading, the
           fields AS ONE, and the primary action. Not per character, not per
           field. auth-seq carries it; reduced motion drops it entirely. -->
      <form class="auth__form auth-seq" id="signin" novalidate>
        <div class="auth__brand auth-seq__step" style="--i:0">
          <img src="assets/img/veye-logo.png" alt="Veye" width="96" height="30" decoding="async">
          <span class="auth__kicker">Admin Console</span>
        </div>

        <div class="auth-seq__step" style="--i:1">
          <h1>Sign in</h1>
          <p class="auth__lede">Welcome back. Use the email address your invitation was sent to.</p>
        </div>

        <div class="auth__fields auth-seq__step" style="--i:2">
          ${H.field({ id: 'email', label: 'Email address', type: 'email', required: true,
                      autocomplete: 'username', value: st.rememberedEmail,
                      placeholder: 'you@veye.example' })}

          <div class="field field--pw">
            <label for="password">Password <span class="t-muted">(required)</span></label>
            <input class="input" id="password" name="password" type="password"
                   autocomplete="current-password" required placeholder="Your password">
            <button class="field__reveal" type="button" id="reveal"
                    aria-label="Show password" aria-pressed="false">${icon('eye', { size: 18 })}</button>
            <p class="field__error" id="password-err" hidden></p>
          </div>
        </div>

        <div class="auth__row auth-seq__step" style="--i:3">
          <label class="check">
            <input type="checkbox" id="remember" ${st.rememberedEmail ? 'checked' : ''}>
            <span class="check__text">Remember me</span>
          </label>
          <button type="button" class="btn btn--ghost btn--sm" id="forgot">Forgot password?</button>
        </div>

        <p class="field__error" id="form-err" hidden></p>

        <button class="btn btn--primary btn--lg btn--block auth__submit auth-seq__step" style="--i:3"
                type="submit" id="submit">Sign in</button>

        <p class="auth__legal auth-seq__step" style="--i:3">
          By signing in you agree to the Veye
          <button type="button" class="linkbtn" id="termsLink">Terms and Conditions</button> and
          <button type="button" class="linkbtn" id="privacyLink">Privacy Policy</button>.
        </p>
      </form>
    </section>
  </div>`;

  const form = outlet.querySelector('#signin');
  const pw = outlet.querySelector('#password');
  const formErr = outlet.querySelector('#form-err');

  /* Show / hide password. */
  const reveal = outlet.querySelector('#reveal');
  reveal.addEventListener('click', () => {
    const showing = pw.type === 'text';
    pw.type = showing ? 'password' : 'text';
    reveal.setAttribute('aria-pressed', String(!showing));
    reveal.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    reveal.innerHTML = icon(showing ? 'eye' : 'eye-off', { size: 18 });
    pw.focus();
  });

  outlet.querySelector('#forgot').addEventListener('click', () => {
    const emailValue = outlet.querySelector('#email').value.trim();
    UI.modal({
      title: 'Reset your password',
      desc: 'We will email a link that lets you set a new password.',
      body: `${H.field({ id: 'reset-email', label: 'Email address', type: 'email', value: emailValue,
                         placeholder: 'you@veye.example', required: true })}
        <p class="t-support" style="margin-top:12px">In this prototype nothing is sent. The real console emails a single-use link that expires after an hour.</p>`,
      actions: [
        { label: 'Cancel', variant: 'secondary', value: false },
        { label: 'Send the reset link', variant: 'primary', value: true, autofocus: true,
          onClick: (ref) => {
            const v = ref.el.querySelector('#reset-email').value.trim();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
              H.fieldError(ref.el, 'reset-email', 'Enter a complete email address.');
              return false;
            }
            UI.toast({ title: 'Reset link sent', message: 'Check ' + v + ' for the link. Nothing was actually sent — this is a prototype.' });
          } },
      ],
    });
  });

  /* Terms and Privacy are real documents in this console. Signed out, they open
     in a reader rather than routing into the authenticated Content screen. */
  const openDoc = (title) => {
    const doc = S.get().legalDocs.find((d) => d.title === title);
    UI.modal({
      title: doc.title,
      desc: `Version ${doc.version} · effective ${doc.effective}`,
      size: 'wide',
      body: `<div class="notice notice--quiet">${icon('info', { size: 18 })}
          <div>This is placeholder wording for the prototype. The text members see must be written and approved by legal counsel.</div>
        </div>
        <div class="doctext" style="margin-top:16px">${esc(doc.body)}</div>`,
      actions: [{ label: 'Close', variant: 'secondary', value: 'close', autofocus: true }],
    });
  };
  outlet.querySelector('#termsLink').addEventListener('click', () => openDoc('Terms and Conditions'));
  outlet.querySelector('#privacyLink').addEventListener('click', () => openDoc('Privacy Policy'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    H.clearErrors(form);
    formErr.hidden = true;

    const email = outlet.querySelector('#email').value.trim();
    const pass = pw.value;

    if (!email) return H.fieldError(form, 'email', 'Enter the email address your invitation was sent to.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return H.fieldError(form, 'email', 'That does not look like a complete email address.');
    if (!pass) {
      pw.setAttribute('aria-invalid', 'true');
      const err = outlet.querySelector('#password-err');
      err.innerHTML = icon('alert-circle', { size: 14 }) + ' Enter your password.';
      err.hidden = false;
      pw.focus();
      return;
    }
    if (pass.length < 6) {
      pw.setAttribute('aria-invalid', 'true');
      const err = outlet.querySelector('#password-err');
      err.innerHTML = icon('alert-circle', { size: 14 } ) + ' That password is too short to be one of ours. Try again, or reset it.';
      err.hidden = false;
      pw.focus();
      return;
    }

    const btn = outlet.querySelector('#submit');
    const remember = outlet.querySelector('#remember').checked;
    H.withSaving(btn, () => {
      S.set({ signedIn: true, rememberedEmail: remember ? email : '' });
      R.navigate('/home');
      UI.toast({ title: 'Signed in', message: 'Welcome back, ' + S.get().me.name.split(' ')[0] + '.' });
    });
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Signing in…';
  });
}

window.Veye = window.Veye || { screens: {} };
window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.login = { render };

})();
