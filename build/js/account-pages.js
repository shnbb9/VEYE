/* ============================================================================
   VEYE — standalone account pages in the Sign-in frame (PROTOTYPE)
   ----------------------------------------------------------------------------
   Owner decisions, 14 Nov 2026. Two pages the application has and the approved
   prototype did not, with the application's own words:

     account-deleted.html  /account-deleted  (app/account-deleted/page.tsx)
     saved-result.html     /saved-result     (app/saved-result/page.tsx)

   Demo state only — nothing here calls a service or sends an email. The
   deletion receipt (`veye_deletion`) is left by the dashboard's deletion
   dialog; the saved result is js/saved-result.js. Every navigation is a plain
   link (the calculation engine's carrier keeps file:// working); the one
   hand-off to the dashboard ("add it to my account") is tab-scoped
   sessionStorage, read once by dashboard.html.
   ========================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function queryValue(name) {
    var m = new RegExp('(?:^|[?&])' + name + '=([^&#]*)').exec(window.location.search);
    try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; }
  }

  /* ---------------------------------------------------- account-deleted -- */
  (function () {
    var page = document.getElementById('accountDeleted');
    if (!page) return;
    var title = document.getElementById('accountDeletedTitle');
    var back = page.querySelector('.btn');
    function add(html) { back.insertAdjacentHTML('beforebegin', html); }

    var ref = queryValue('ref');
    if (!/^[0-9a-f-]{36}$/i.test(ref)) {
      add('<p class="auth__status" role="alert">This page needs the reference from your deletion.</p>');
      return;
    }
    var receipt = null;
    try { receipt = JSON.parse(localStorage.getItem('veye_deletion') || 'null'); } catch (e) {}
    if (!receipt || receipt.ref !== ref) {
      add('<p class="auth__status" role="alert">No deletion with that reference.</p>');
      return;
    }
    // The prototype's deletion finishes at once, as the application's usually
    // does (its purge runs straight after the request): state "Deleted".
    title.textContent = 'Your member profile is deleted';
    add('<p class="auth__status"><b>Deleted.</b> Finished ' +
          esc(new Date(receipt.completedAt || receipt.requestedAt).toLocaleString()) + '.</p>' +
        '<p class="auth__notice">Reference <code>' + esc(ref) + '</code>. Keep it if you want to ask us about this deletion. ' +
        'We have also emailed you a receipt, which contains no health information.</p>');
  })();

  /* ------------------------------------------------------- saved-result -- */
  (function () {
    var page = document.getElementById('savedResultPage');
    var SR = window.VeyeSavedResult;
    if (!page || !SR) return;
    var title = page.querySelector('.auth__title');

    function clear() { while (title.nextSibling) page.removeChild(title.nextSibling); }
    // A remembered sign-in stands for "signed in as a member" in this prototype.
    function signedIn() {
      try { var u = JSON.parse(localStorage.getItem('veye_user') || 'null'); return !!(u && u.email); } catch (e) { return false; }
    }
    function handOff() { try { sessionStorage.setItem('veye_open_view', 'saved-result'); } catch (e) {} }

    function showSaved(rec) {
      clear();
      page.insertAdjacentHTML('beforeend',
        '<p class="auth__subtitle">' + (rec.emailVerified ? 'Address confirmed' : 'Saved') + '</p>' +
        '<p class="auth__status">Your Health Number result is saved for ' + esc(rec.emailMasked) + ' ' +
          esc(SR.formatUntil(rec)) + '. To keep it in your own history, add it to a Veye account that uses this same address.</p>' +
        (signedIn()
          ? '<a class="btn btn--primary btn--mt" href="dashboard.html" data-handoff>Add it to my account</a>'
          : '<a class="btn btn--primary btn--mt" href="signup.html">Create an account</a>' +
            '<p class="auth__links">Already a member? <a href="login.html" data-handoff>Sign in to add it</a>.</p>') +
        '<p class="auth__links"><button type="button" class="auth__link-button" data-erase>Delete my saved result</button></p>');
      page.querySelectorAll('[data-handoff]').forEach(function (a) { a.addEventListener('click', handOff); });
      page.querySelector('[data-erase]').addEventListener('click', function () {
        if (!window.confirm(SR.TEXT.eraseConfirm)) return;
        SR.erase();
        showErased(SR.TEXT.erased);
      });
    }

    function showErased(message) {
      clear();
      page.insertAdjacentHTML('beforeend',
        '<p class="auth__subtitle">Deleted</p>' +
        '<p class="auth__status">' + esc(message) + '</p>' +
        '<a class="btn btn--primary btn--mt" href="index.html">Back to Veye</a>');
    }

    // The link did not lead anywhere: say so, and offer a new one by email.
    function showGone(message) {
      clear();
      page.insertAdjacentHTML('beforeend',
        '<p class="auth__subtitle">That did not work</p>' +
        '<p class="auth__status">' + esc(message) + ' A saved result is kept only as long as the notice you agreed to ' +
          'said, and a link stops working once it has been used to add the result to an account.</p>' +
        '<form method="post" novalidate data-recover>' +
          '<div class="auth__fields"><div class="field">' +
            '<input class="field__input" type="email" autocomplete="email" placeholder="The address you saved it under" aria-label="Email address">' +
          '</div></div>' +
          '<button type="submit" class="btn btn--primary btn--mt">Email me a new link</button>' +
        '</form>' +
        '<p class="auth__links"><a href="onboarding.html">Take the assessment again</a></p>');
      var form = page.querySelector('[data-recover]');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var value = form.querySelector('input').value.trim();
        var text = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(value) ? SR.TEXT.recover : 'Please enter a valid email address.';
        var note = page.querySelector('[data-recover-note]');
        if (!note) {
          form.insertAdjacentHTML('afterend', '<p class="auth__notice" role="status" data-recover-note></p>');
          note = page.querySelector('[data-recover-note]');
        }
        note.textContent = text;
      });
    }

    // Opening the emailed link confirms the address (the application's
    // /prospects/confirm); a used, deleted or expired result is "no longer
    // available", and no result at all means this page was opened without one.
    var rec = SR.read();
    if (!rec) showGone('This page needs the link from your email.');
    else if (!SR.active(rec)) showGone(SR.TEXT.notAvailable);
    else showSaved(SR.confirmEmail());
  })();
})();
