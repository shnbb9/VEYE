/* ============================================================================
   VEYE — a visitor's saved result before sign-up (PROTOTYPE)
   ----------------------------------------------------------------------------
   Owner decision, 14 Nov 2026. The application offers to save a visitor's
   Health Number only when an owner has switched saving on (retention Never is
   the default; 15/30/45 days or Forever). This prototype has no owner console,
   so the switch is the address: onboarding.html?saving=15|30|45|forever. With
   no switch the onboarding gate is exactly the approved one.

   Demo state only. The record lives in this browser (localStorage
   `veye_saved_result`) and holds no answers and no number: the address the
   visitor typed (to show it masked and to compare it with the member's own),
   the dates and the status. Nothing is sent anywhere and no email goes out.

   Every word a visitor or member reads here is the application's own:
   platform/api/app/prospects/notice.py (the notice and the box),
   platform/api/app/prospects/routes.py + service.py (the messages) and
   platform/web/lib/prospects-api.ts (formatSavedUntil).
   ========================================================================== */
(function (root) {
  'use strict';

  var KEY = 'veye_saved_result';
  var DAY = 86400000;

  var NOTICE_TEMPLATE =
    'We will save your quiz answers and Health Number so you can come back to them or add them to an ' +
    'account. If you do not sign up, we keep them {retention} and then delete them. We will email this ' +
    'address a link to confirm it is yours; we never email your answers or your number. ' +
    'See our Privacy Policy.';
  var CONSENT_LABEL = 'I agree to Veye storing my assessment and contacting me about this result, ' +
    'as described above.';
  var TEXT = {
    notAvailable: 'This link or saved result is no longer available.',
    erased: 'Your saved result and the address you gave have been deleted.',
    recover: 'If a saved result exists for that address, we have emailed a new link to it. ' +
      'The link works only from that mailbox.',
    eraseConfirm: 'Delete your saved result and the email address you gave? This cannot be undone.'
  };

  /** The retention an owner chose, from ?saving=…; null = saving is off. */
  function policyFrom(search) {
    var m = /(?:^|[?&])saving=([^&#]*)/.exec(String(search || ''));
    var v = m ? decodeURIComponent(m[1]).toLowerCase() : '';
    if (v === 'forever') return { mode: 'forever', days: null };
    if (v === '15' || v === '30' || v === '45') return { mode: 'days', days: Number(v) };
    return null;
  }

  /** How long, in the words a visitor reads before agreeing (retention.py). */
  function visitorPhrase(policy) {
    return policy.mode === 'forever' ? 'until you or Veye delete them' : 'for ' + policy.days + ' days';
  }
  function noticeText(policy) { return NOTICE_TEMPLATE.replace('{retention}', visitorPhrase(policy)); }

  function normalise(email) { return String(email || '').trim().toLowerCase(); }
  /** `jo•••@example.com` — the application's mask_email(). */
  function mask(email) {
    var e = normalise(email);
    var at = e.indexOf('@');
    if (at < 0) return '—';
    var local = e.slice(0, at);
    var shown = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
    return shown + '•••@' + e.slice(at + 1);
  }

  function readRaw() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function write(rec) {
    try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) {}
    return rec;
  }
  /** Expiry is enforced on every read, not only by a clean-up. */
  function expired(rec) { return !!(rec && rec.expiresAt && new Date(rec.expiresAt).getTime() <= Date.now()); }
  function active(rec) { return !!rec && (rec.status === 'unverified' || rec.status === 'verified') && !expired(rec); }
  function read() { return readRaw(); }

  /** The visitor ticked the box: keep the result under the current retention. */
  function capture(email, policy) {
    var now = new Date();
    return write({
      email: normalise(email), emailMasked: mask(email), emailVerified: false, status: 'unverified',
      capturedAt: now.toISOString(), retentionMode: policy.mode, retentionDays: policy.days,
      expiresAt: policy.mode === 'forever' ? null : new Date(now.getTime() + policy.days * DAY).toISOString()
    });
  }
  /** The emailed link was opened: that mailbox is the visitor's. */
  function confirmEmail() {
    var rec = readRaw();
    if (!active(rec)) return null;
    rec.emailVerified = true;
    if (rec.status === 'unverified') rec.status = 'verified';
    return write(rec);
  }
  /** Added to the signed-in member's history — the link stops working. */
  function claim() {
    var rec = readRaw();
    if (!active(rec)) return null;
    rec.status = 'claimed';
    rec.claimedAt = new Date().toISOString();
    return write(rec);
  }
  function erase() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /** "until December 14, 2026" in en-US (platform/web/lib/prospects-api.ts). */
  function formatUntil(rec) {
    if (rec.retentionMode === 'forever' || !rec.expiresAt) return 'until you delete it';
    return 'until ' + new Date(rec.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  root.VeyeSavedResult = {
    KEY: KEY, CONSENT_LABEL: CONSENT_LABEL, TEXT: TEXT,
    policyFrom: policyFrom, noticeText: noticeText, mask: mask, normalise: normalise,
    read: read, active: active, expired: expired, capture: capture, confirmEmail: confirmEmail,
    claim: claim, erase: erase, formatUntil: formatUntil
  };
})(window);
