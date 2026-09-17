// VEYE — onboarding auth: password visibility toggle + remember-me persistence
document.addEventListener('click', function (e) {
  var btn = e.target.closest('.field__eye');
  if (!btn) return;
  var field = btn.closest('.field');
  var input = field && field.querySelector('input');
  if (!input) return;
  var reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  btn.classList.toggle('is-on', reveal);
  btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
});

(function () {
  function nameFromEmail(email) {
    return email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // Login: prefill the remembered email, if any.
  var loginForm = document.querySelector('.auth__form[data-auth="login"]');
  if (loginForm) {
    try {
      var saved = JSON.parse(localStorage.getItem('veye_user') || 'null');
      var emailInput = loginForm.querySelector('input[name="email"]');
      if (saved && saved.email && emailInput) emailInput.value = saved.email;
    } catch (e) {}
  }

  // Signup: pre-fill the address typed at the onboarding result gate. Prototype
  // only — the value is read once from sessionStorage and the key is cleared, so
  // it never persists beyond the visit and nothing is transmitted.
  var signupForm = document.querySelector('.auth__form[data-auth="signup"]');
  if (signupForm) {
    try {
      var prefill = sessionStorage.getItem('veye_prefill_email');
      if (prefill) {
        var signupEmail = signupForm.querySelector('input[name="email"]');
        if (signupEmail && !signupEmail.value) signupEmail.value = prefill;
        sessionStorage.removeItem('veye_prefill_email');
      }
    } catch (e) {}
  }

  /** Storage-aware navigation, so the file:// fallback keeps carrying the
   *  onboarding state. Falls back to a plain assignment if the engine is absent. */
  function go(href) {
    var CALC = window.VeyeCalculations;
    if (CALC && CALC.storage && typeof CALC.storage.navigate === 'function') CALC.storage.navigate(href);
    else window.location.href = href;
  }

  // Login + signup submit.
  //
  // Both forms carry action="dashboard.html" method="get" as a no-JS fallback,
  // but a GET submit puts every field — including `password` and
  // `confirmPassword` — into the dashboard's URL. There is no backend and the
  // dashboard reads no query parameters at all, so the submit is intercepted
  // here and turned into a plain navigation.
  //
  // The password fields are never read, never stored and never travel anywhere.
  // Only identity metadata is kept, and only when Remember me is ticked.
  document.querySelectorAll('.auth__form[data-auth]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var isSignup = form.getAttribute('data-auth') === 'signup';
      var value = function (name) {
        var input = form.querySelector('[name="' + name + '"]');
        return input ? input.value.trim() : '';
      };

      var email = value('email');
      var rememberInput = form.querySelector('input[name="remember"]');
      var remember = !rememberInput || rememberInput.checked;

      try {
        if (email && remember) {
          var first = isSignup ? value('firstName') : '';
          var last = isSignup ? value('lastName') : '';
          var full = (first + ' ' + last).trim();
          var record = { email: email, name: full || nameFromEmail(email),
                         signedInAt: new Date().toISOString() };
          if (first) record.firstName = first;
          if (last) record.lastName = last;
          // Optional demographics (client request). These inputs deliberately
          // carry no `name`, so the no-JS GET fallback never serializes them.
          var phoneEl = isSignup ? document.getElementById('signupPhone') : null;
          var zipEl = isSignup ? document.getElementById('signupZip') : null;
          if (phoneEl && phoneEl.value.trim()) record.phone = phoneEl.value.trim();
          if (zipEl && zipEl.value.trim()) record.zip = zipEl.value.trim();
          localStorage.setItem('veye_user', JSON.stringify(record));
        } else if (rememberInput && !rememberInput.checked) {
          localStorage.removeItem('veye_user');
        }
      } catch (err) {}

      go('dashboard.html');
    });
  });
})();


// ---------------------------------------------------------------------------
// Password recovery — PROTOTYPE flow (client, Functional Edits 260821).
// Three routes: reset by email, reset by text, contact support. Nothing is
// sent anywhere: the confirmation step says so explicitly, and the password
// fields above remain untouched by all of this.
(function () {
  var dlg = document.getElementById('pwDialog');
  var openBtn = document.getElementById('forgotPwBtn');
  if (!dlg || !openBtn || typeof dlg.showModal !== 'function') return;

  var steps = dlg.querySelectorAll('.pwd__step');
  function show(step) {
    steps.forEach(function (s2) { s2.hidden = s2.getAttribute('data-pw-step') !== step; });
    var focus = dlg.querySelector('.pwd__step:not([hidden]) button, .pwd__step:not([hidden]) input, .pwd__step:not([hidden]) a');
    if (focus) focus.focus();
  }

  openBtn.addEventListener('click', function () {
    // convenience prefill from the sign-in form / remembered account
    try {
      var emailField = document.querySelector('.auth__form input[name="email"]');
      var pw = document.getElementById('pwEmail');
      if (pw && emailField && emailField.value) pw.value = emailField.value;
      var saved = JSON.parse(localStorage.getItem('veye_user') || 'null');
      var ph = document.getElementById('pwPhone');
      if (ph && saved && saved.phone) ph.value = saved.phone;
    } catch (e) {}
    show('menu');
    dlg.showModal();
  });
  document.getElementById('pwClose').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  dlg.querySelectorAll('.pwd__opt').forEach(function (opt) {
    opt.addEventListener('click', function () { show(opt.getAttribute('data-pw')); });
  });
  dlg.querySelectorAll('[data-pw-back]').forEach(function (b) {
    b.addEventListener('click', function () { show('menu'); });
  });

  function finish(msg) {
    document.getElementById('pwDoneMsg').textContent = msg;
    show('done');
  }
  document.getElementById('pwSendEmail').addEventListener('click', function () {
    var input = document.getElementById('pwEmail');
    var err = document.getElementById('pwEmailErr');
    var ok = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(input.value.trim());
    err.hidden = ok;
    if (!ok) { input.focus(); return; }
    finish('In the live product, a reset link would now be emailed to ' + input.value.trim() + '.');
  });
  document.getElementById('pwSendText').addEventListener('click', function () {
    var input = document.getElementById('pwPhone');
    var err = document.getElementById('pwPhoneErr');
    var digits = input.value.replace(/[^0-9]/g, '');
    var ok = digits.length >= 7;
    err.hidden = ok;
    if (!ok) { input.focus(); return; }
    finish('In the live product, a one-time sign-in code would now be texted to ' + input.value.trim() + '.');
  });
  document.getElementById('pwDone').addEventListener('click', function () { dlg.close(); });
})();
