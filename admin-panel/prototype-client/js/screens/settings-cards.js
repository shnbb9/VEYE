/* ============================================================================
   Settings → Product settings: Privacy & prospects, and Health sharing
   ----------------------------------------------------------------------------
   The console's two V2 cards (platform/web components/admin/
   privacy-prospects-card.tsx and health-sharing-card.tsx).

   PRIVACY & PROSPECTS — how long a visitor's saved assessment result is kept
   if they do not sign up. The five choices are exactly the ones the product
   asked for. A new policy governs new saves; existing records keep the expiry
   they were saved with unless an administrator explicitly applies a SHORTER
   policy to them — there is no way to lengthen what a visitor agreed to.
   Forever needs an explicit confirmation.

   HEALTH SHARING — how a request to share health records reaches a member
   (Manual from Member 360, or Automatic once a new member has verified their
   address), the request email, and the terms a member reads before deciding.
   Each is versioned: edits are drafts until published, and a published
   version never changes, so a past decision always reads against the words
   the member was shown. What is shared, for how long, how to withdraw and what
   is not covered are fixed and shown read-only. All of it is engineering
   draft wording pending owner and counsel approval, and the card says so.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

/* =================================================== PRIVACY & PROSPECTS == */
const OPTIONS = [
  { mode: 'never', days: null, label: 'Never' }, { mode: 'days', days: 15, label: '15 days' }, { mode: 'days', days: 30, label: '30 days' },
  { mode: 'days', days: 45, label: '45 days' }, { mode: 'forever', days: null, label: 'Forever' },
];
const NOTICE_VERSION = 'prospect-capture-2026-11-14-draft-v1';
const NOTICE_STATUS = 'Engineering draft — have it approved before switching saving on.';
const key = (c) => `${c.mode}:${c.days == null ? '' : c.days}`;
const lengthOf = (c) => (c.mode === 'never' ? 0 : c.mode === 'forever' ? Infinity : c.days);
const visitorPhrase = (c) => (c.mode === 'forever' ? 'until you or Veye delete them' : `for ${c.days} days`);
const noticeText = (c) => `We will save your quiz answers and Health Number so you can come back to them or add them to an account. If you do not sign up, we keep them ${visitorPhrase(c)} and then delete them. We will email this address a link to confirm it is yours; we never email your answers or your number. See our Privacy Policy.`;

let pv = { choice: null, forever: false, note: '', message: null };

/** When a record saved at `captured` would expire under policy `c`. */
function expiryUnder(c, captured) {
  if (c.mode === 'days') return Date.parse(captured) + c.days * 864e5;
  if (c.mode === 'never') return Date.parse(captured);
  return null;
}

function liveRows() {
  const P = window.Veye.prospects;
  return S.get().prospects.filter((p) => P.ACTIVE.includes(p.status) && !P.expired(p));
}

/** What applying `c` to existing records would do. Counts only. */
function impact(c) {
  const now = Date.now();
  let shorten = 0, expireNow = 0, unaffected = 0;
  const live = liveRows();
  live.forEach((p) => {
    const proposed = expiryUnder(c, p.captured_at);
    const current = p.expires_at ? Date.parse(p.expires_at) : null;
    if (proposed === null || (current !== null && proposed >= current)) unaffected += 1;
    else if (proposed <= now) expireNow += 1;
    else shorten += 1;
  });
  const r = S.get().retention;
  return { active: live.length, would_shorten: shorten, would_expire_now: expireNow, unaffected, lengthens_existing: lengthOf(c) > lengthOf(r) };
}

/** The scheduled purge: removes what is past its expiry. */
function purgeExpired(dryRun) {
  const P = window.Veye.prospects;
  const due = S.get().prospects.filter((p) => P.ACTIVE.includes(p.status) && P.expired(p));
  if (!dryRun && due.length) {
    const at = S.now();
    const ids = new Set(due.map((p) => p.id));
    S.set({ prospects: S.get().prospects.map((p) => (ids.has(p.id) ? { ...p, status: 'expired', email: null,
      events: [...p.events, { event_type: 'purged', actor_type: 'system', at, policy_version: null }] } : p)) });
  }
  return { due: due.length, purged: dryRun ? 0 : due.length };
}

function privacyCard(host) {
  const r = S.get().retention;
  if (!pv.choice) pv.choice = { mode: r.mode, days: r.days };
  const P = window.Veye.prospects;
  const counts = P.counts();
  const label = P.policyLabel(r);
  const isDefault = r.version === 0;
  const changed = key(pv.choice) !== key(r);
  const imp = changed ? impact(pv.choice) : null;
  const last = r.last_cleanup;
  const previewPolicy = r.mode === 'never' ? { mode: 'days', days: 30 } : r;

  host.innerHTML = `<div class="card" id="privacy-prospects" data-testid="privacy-prospects">
    <div class="card__head">
      <div><h2 class="card__title">Privacy &amp; prospects</h2>
        <p class="t-support">How long a visitor’s saved assessment result is kept if they do not sign up. Prospects are listed under <a href="${R.href('/members/prospects')}">Members → Prospects</a>.</p></div>
      ${H.chip(isDefault ? 'Default: Never' : `Version ${r.version}`, r.mode === 'never' ? 'draft' : 'live')}
    </div>
    <div class="card__body stack gap-5">
      <p class="t-support" data-testid="retention-current">Now: <strong>${esc(label)}</strong>${r.published_at ? ` — published ${esc(H.fmtDate(r.published_at))} by ${esc(r.published_by)}.` : ' — the built-in default; nothing has been published.'}</p>
      ${!r.encryption_ready ? `<div class="notice">${icon('alert-circle', { size: 18 })}<div>This deployment has no encryption key for saved answers, so saving cannot be switched on. Set <code>VEYE_PROSPECT_ENCRYPTION_KEYS</code> from Secret Manager.</div></div>` : ''}
      ${r.encryption_ready && r.encryption_is_development_key ? '<p class="t-support">Saved answers are sealed with the local development key — fine for synthetic data on this machine, never for a real deployment (production refuses to save without its own key).</p>' : ''}
      <fieldset class="stack gap-2" style="border:0;padding:0;margin:0">
        <legend class="field__label">Keep unsigned-up quiz results</legend>
        <div class="row gap-2 wrap" role="radiogroup" aria-label="Keep unsigned-up quiz results">
          ${OPTIONS.map((o) => {
            const selected = key(o) === key(pv.choice);
            const disabled = o.mode !== 'never' && !r.encryption_ready;
            return `<label class="retention-option btn btn--sm ${selected ? 'btn--primary' : 'btn--secondary'}" style="cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? 0.5 : 1}">
              <input type="radio" name="retention" class="sr-only" value="${key(o)}" ${selected ? 'checked' : ''} ${disabled ? 'disabled' : ''} data-testid="retention-${o.mode}${o.days == null ? '' : o.days}">
              ${esc(o.label)}${o.mode === 'forever' ? '*' : ''}
            </label>`;
          }).join('')}
        </div>
        <span class="field__hint">Never saves nothing (the visitor still sees their number). Forever* keeps results until they are deleted, and needs the owner’s and counsel’s approval.</span>
      </fieldset>

      ${changed ? `<div class="notice notice--quiet" data-testid="retention-impact">${icon('info', { size: 18 })}<div>
        <strong>Applies to new saved results only.</strong>
        There ${imp.active === 1 ? 'is' : 'are'} ${imp.active} saved result${imp.active === 1 ? '' : 's'} now.
        ${imp.lengthens_existing ? 'Existing ones keep their shorter expiry — a longer policy never extends what a visitor agreed to.'
          : `Applying it to them as well (a separate step) would shorten ${imp.would_shorten} and delete ${imp.would_expire_now} at once.`}
      </div></div>` : ''}

      ${pv.choice.mode === 'forever' && changed ? `<label class="row gap-2" style="align-items:flex-start">
        <input type="checkbox" id="foreverAck" ${pv.forever ? 'checked' : ''} data-testid="retention-forever-ack">
        <span class="t-support">I confirm the owner and counsel approved keeping unsigned-up results until they are deleted, and that the privacy notice says so. Deletion requests still apply.</span>
      </label>` : ''}

      ${changed ? `<div class="field">
        <label class="field__label" for="retentionNote">Note for the history (optional)</label>
        <input class="input" id="retentionNote" maxlength="300" value="${esc(pv.note)}" placeholder="e.g. Approved by Cara on 14 Nov">
      </div>` : ''}

      <div>
        <div class="t-eyebrow">What a visitor reads ${r.mode === 'never' ? '(when saving is on)' : ''}</div>
        <p class="t-support" style="margin-top:6px" data-testid="retention-notice">“${esc(noticeText(previewPolicy))}”</p>
        <p class="t-support">${H.chip('Draft wording', 'attention')} ${esc(NOTICE_STATUS)} Version <code>${NOTICE_VERSION}</code>.</p>
      </div>

      <div class="rows">
        <div class="rowitem">
          <span class="rowitem__icon">${icon('clipboard', { size: 18 })}</span>
          <div><div class="rowitem__title">Existing saved results</div>
            <div class="rowitem__meta">${counts.unregistered} kept now · ${counts.expiring_within_7_days} expire within 7 days · ${counts.awaiting_purge} past expiry, waiting for cleanup.</div></div>
          <button class="btn btn--secondary btn--sm" type="button" id="applyShorter" data-testid="retention-apply" ${isDefault ? 'disabled' : ''}>Apply current policy to existing</button>
        </div>
        <div class="rowitem">
          <span class="rowitem__icon">${icon('activity', { size: 18 })}</span>
          <div><div class="rowitem__title">Cleanup</div>
            <div class="rowitem__meta" data-testid="retention-last-run">${last
              ? `Last run ${esc(H.fmtDate(last.finished_at || last.started_at))} (${esc(last.triggered_by)}${last.dry_run ? ', dry run' : ''}): ${last.status === 'ok' ? `${last.counts.purged || 0} removed, ${last.counts.due || 0} were due` : `failed — ${esc(last.error)}`}.`
              : 'Has not run yet. Expired results are already unreachable; cleanup removes them physically.'}</div></div>
          <span class="row gap-2">
            <button class="btn btn--ghost btn--sm" type="button" id="dryRun" data-testid="retention-dry-run">Preview</button>
            <button class="btn btn--secondary btn--sm" type="button" id="runCleanup" data-testid="retention-run">Run cleanup now</button>
          </span>
        </div>
      </div>

      ${r.history.length ? `<details class="disclose">
        <summary>${icon('chevron-right', { size: 15 })} Version history (${r.history.length})</summary>
        <ul class="rows" style="margin-top:8px" data-testid="retention-history">
          ${r.history.map((h) => `<li class="rowitem"><span class="rowitem__icon">${icon('file-text', { size: 16 })}</span>
            <div><div class="rowitem__title">v${h.version} · ${esc(P.policyLabel(h))}</div><div class="rowitem__meta">${esc(H.fmtDate(h.published_at))} by ${esc(h.published_by)}${h.note ? ' — ' + esc(h.note) : ''}</div></div></li>`).join('')}
        </ul>
      </details>` : ''}
      ${pv.message ? `<p class="${pv.message.tone === 'error' ? 'errorbar' : 't-support'}" role="status" data-testid="retention-message">${esc(pv.message.text)}</p>` : ''}
    </div>
    <div class="card__foot">
      <button class="btn btn--primary" type="button" id="publishRetention" data-testid="retention-publish" ${!changed || (pv.choice.mode === 'forever' && !pv.forever) ? 'disabled' : ''}>Publish retention policy</button>
      ${!changed ? '<span class="t-support">Choose a different option to publish a new version.</span>' : ''}
      ${changed && pv.choice.mode === 'forever' && !pv.forever ? '<span class="t-support">Tick the confirmation to publish Forever.</span>' : ''}
    </div>
  </div>`;

  const again = () => privacyCard(host);
  host.querySelectorAll('input[name="retention"]').forEach((input) => input.addEventListener('change', () => {
    const o = OPTIONS.find((x) => key(x) === input.value);
    pv.choice = { mode: o.mode, days: o.days };
    pv.message = null;
    again();
    const same = host.querySelector(`input[name="retention"][value="${input.value}"]`);
    if (same) same.focus();
  }));
  const ack = host.querySelector('#foreverAck');
  if (ack) ack.addEventListener('change', () => { pv.forever = ack.checked; again(); });
  const note = host.querySelector('#retentionNote');
  if (note) note.addEventListener('input', () => { pv.note = note.value; });

  host.querySelector('#publishRetention').addEventListener('click', (e) => H.busy(e.currentTarget, 'Publishing…', () => {
    const cur = S.get().retention;
    const version = cur.version + 1;
    const at = S.now();
    const entry = { version, mode: pv.choice.mode, days: pv.choice.days, published_at: at, published_by: S.me().name, note: pv.note.trim() || null };
    S.set({ retention: { ...cur, mode: pv.choice.mode, days: pv.choice.days, version, published_at: at, published_by: S.me().name, history: [entry, ...cur.history] } });
    S.audit('settings.prospect_retention.published', 'policy', 'prospect_retention', { version, mode: pv.choice.mode, days: pv.choice.days,
      previous_version: cur.version, acknowledged_forever: pv.choice.mode === 'forever' && pv.forever });
    pv = { choice: { mode: entry.mode, days: entry.days }, forever: false, note: '',
      message: { tone: 'ok', text: `Published as version ${version}. New saved results follow it from now on; existing ones keep their own expiry.` } };
    again();
  }));

  const apply = host.querySelector('#applyShorter');
  apply.addEventListener('click', async () => {
    const cur = S.get().retention;
    const res = await UI.confirm({ title: 'Apply the policy to existing results?',
      message: `Apply "${esc(P.policyLabel(cur))}" to existing saved results? Expiry only ever moves earlier, and any result already past its new expiry is deleted now. This cannot be undone.`,
      confirmLabel: 'Apply to existing', danger: true });
    if (!res.ok) return;
    H.busy(apply, 'Applying…', () => {
      const now = Date.now();
      const at = new Date(now).toISOString();
      let shortened = 0;
      const live = new Set(liveRows().map((p) => p.id));
      S.set({ prospects: S.get().prospects.map((p) => {
        if (!live.has(p.id)) return p;
        const proposed = expiryUnder(cur, p.captured_at);
        const current = p.expires_at ? Date.parse(p.expires_at) : null;
        if (proposed === null || (current !== null && proposed >= current)) return p;
        shortened += 1;
        const next = cur.mode === 'never' ? now : Math.max(proposed, now);
        return { ...p, expires_at: new Date(next).toISOString(),
          events: [...p.events, { event_type: 'retention_shortened', actor_type: 'administrator', at, policy_version: cur.version }] };
      }) });
      const purged = purgeExpired(false).purged;
      S.audit('settings.prospect_retention.applied_to_existing', 'policy', 'prospect_retention', { version: cur.version, shortened, purged_now: purged });
      pv.message = { tone: 'ok', text: shortened === 0 ? 'No existing saved result was kept longer than this policy allows — nothing changed.'
        : `${shortened} saved result(s) now expire earlier; ${purged} were already past their new expiry and were deleted.` };
      again();
    });
  });

  const cleanup = (dryRun, btn) => H.busy(btn, dryRun ? 'Checking…' : 'Running…', () => {
    const at = S.now();
    const result = purgeExpired(dryRun);
    const run = { job: 'purge-prospects', status: 'ok', dry_run: dryRun, started_at: at, finished_at: at,
      counts: { due: result.due, purged: result.purged }, error: null, triggered_by: `console: ${S.me().name}` };
    S.set({ retention: { ...S.get().retention, last_cleanup: run } });
    S.audit('settings.prospect_retention.cleanup', 'policy', 'prospect_retention', { dry_run: dryRun });
    pv.message = { tone: 'ok', text: dryRun ? `${result.due} expired saved result(s) are waiting to be removed. Nothing was changed.` : `Removed ${result.purged} expired saved result(s).` };
    again();
  });
  host.querySelector('#dryRun').addEventListener('click', (e) => cleanup(true, e.currentTarget));
  host.querySelector('#runCleanup').addEventListener('click', (e) => cleanup(false, e.currentTarget));
}

/* ======================================================== HEALTH SHARING == */
const INTERVALS = { 24: '1 day', 72: '3 days', 168: '1 week', 336: '2 weeks' };
const TEMPLATE_VARIABLES = ['first_name', 'organization_name', 'request_expiry', 'review_link', 'support_email'];
const TERMS_VARIABLES = ['organization_name', 'support_email'];
const CTA_LABEL = 'Review sharing request';
const STATUS = 'Engineering draft wording, pending owner and counsel approval. Whether VEYE needs a formal authorization rather than this consent is a legal question nobody has answered yet.';
const BACKFILL = 'Automatic mode asks members whose address is verified AFTER it is switched on. It never emails existing members in bulk.';
const LOCKED = {
  categories: ['Your Health Number and its history', 'Body composition results', 'Blood marker results', 'Your Health Assessment and Simple Quiz answers and results', 'Mood entries and their notes', 'Food diary entries'],
  companion_use: 'Veye Companion (Sprout) may use summaries of the same records to answer you about your own progress. It never receives your notes or meal descriptions word for word.',
  expiry_rule: 'Until you withdraw it.',
  withdrawal: 'You can withdraw at any time in Settings, and it stops at once: from that moment the team and Sprout no longer see your records. Withdrawing cannot undo what was already seen while sharing was on.',
  not_covered: 'Your name, email address and the messages you send to Veye are not covered by this choice and stay visible to the team so they can answer you.',
};
const SHARING_LINK_NOTE = 'This button opens the Veye app. Opening it does not share anything: you decide there, after signing in.';
const clone = (v) => JSON.parse(JSON.stringify(v));

let hs = null;
function freshHs() {
  const s = S.get().sharingSettings;
  return {
    mode: { form: { mode: s.notification.mode, resend_interval_hours: s.notification.resend_interval_hours, sender_name: s.notification.sender_name }, note: null },
    tpl: { value: clone(s.template.draft ? s.template.draft.value : s.template.value), dirty: false, note: null, preview: null },
    terms: { value: clone(s.terms.draft ? s.terms.draft.value : s.terms.value), dirty: false, note: null, preview: null },
  };
}

/** The API's variable rule (app/policies/richtext.py `_clean`). */
function checkText(text, allowed) {
  const VAR = /\{\{\s*([a-z_]+)\s*\}\}/g;
  let m;
  while ((m = VAR.exec(text))) {
    if (!allowed.includes(m[1])) return `Unknown variable {{${m[1]}}}. Allowed: ${[...allowed].sort().join(', ')}.`;
  }
  const stripped = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, '');
  if (stripped.includes('{{') || stripped.includes('}}')) return 'A variable is written {{name}}.';
  return null;
}
function docText(doc) {
  return (doc.blocks || []).map((b) => (b.children || (b.items || []).flat()).map((r) => r.text || (r.children || []).map((c) => c.text).join('') + ' ' + (r.href || '')).join('')).join('\n');
}
function sampleVars() {
  return { first_name: S.me().firstName || 'there', organization_name: 'Veye', support_email: S.get().org.supportEmail || 'the Veye team',
    review_link: 'https://app.veye.example/app/settings?section=privacy&request=PREVIEW-ONLY-NOT-A-REAL-REQUEST', request_expiry: 'until you answer it' };
}
function emailHtml(title, bodyHtml, cta, link) {
  return `<div style="font-family:Kumbh Sans,Arial,sans-serif;background:#FBF8F1;padding:32px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
      <h1 style="margin:0 0 18px;font-size:24px;color:#2E4A1A">${esc(title)}</h1>${bodyHtml}
      <p style="margin:22px 0"><a href="${esc(link)}" style="background:#446514;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${esc(cta)}</a></p>
      <p style="margin:26px 0 0;font-size:13px;color:#7A8A6A">Veye &mdash; Nutrition Reimagined. Sent from the Veye prototype environment &mdash; not a live message.</p>
    </div></div>`;
}

function healthSharingCard(host) {
  if (!hs) hs = freshHs();
  host.innerHTML = `<div class="card" id="health-sharing" data-testid="health-sharing-settings">
    <div class="card__head">
      <div><h2 class="card__title">Health sharing</h2>
        <p class="t-support">How a request to share health records reaches a member, and what they read before they decide. Members decide in the app; nothing here can decide for them.</p></div>
      ${H.chip('Draft wording', 'attention')}
    </div>
    <div class="card__body stack gap-6">
      <p class="t-support" data-testid="sharing-settings-status">${esc(STATUS)}</p>
      <section class="stack gap-3" data-testid="sharing-mode" id="modeSection"></section>
      <section class="stack gap-3" data-testid="sharing-template" id="templateSection"></section>
      <section class="stack gap-3" data-testid="sharing-terms" id="termsSection"></section>
    </div>
  </div>`;
  modeSection(host.querySelector('#modeSection'));
  templateSection(host.querySelector('#templateSection'));
  termsSection(host.querySelector('#termsSection'));
}

const noteHtml = (note, testId) => (note ? `<p class="${note.tone === 'error' ? 'errorbar' : 't-support'}" role="status"${testId ? ` data-testid="${testId}"` : ''}>${esc(note.text)}</p>` : '');

function modeSection(host) {
  const cur = S.get().sharingSettings.notification;
  const f = hs.mode.form;
  const changed = f.mode !== cur.mode || f.resend_interval_hours !== cur.resend_interval_hours || f.sender_name.trim() !== cur.sender_name;
  host.innerHTML = `
    <h3 class="t-eyebrow">Request mode</h3>
    <div class="row gap-4 wrap" role="radiogroup" aria-label="Request mode">
      <label class="row gap-2"><input type="radio" name="sharingMode" value="manual" ${f.mode === 'manual' ? 'checked' : ''} data-testid="sharing-mode-manual"> Manual — the team asks from Member 360</label>
      <label class="row gap-2"><input type="radio" name="sharingMode" value="automatic" ${f.mode === 'automatic' ? 'checked' : ''} data-testid="sharing-mode-automatic"> Automatic after a verified sign-up</label>
    </div>
    <p class="t-support">${esc(BACKFILL)} A member who declined or withdrew is never asked automatically again.</p>
    <div class="row gap-4 wrap">
      <div class="field" style="min-width:200px">
        <label class="field__label" for="resendInterval">Earliest time to ask again</label>
        <select class="select" id="resendInterval">${[24, 72, 168, 336].map((h) => `<option value="${h}" ${h === f.resend_interval_hours ? 'selected' : ''}>${INTERVALS[h]}</option>`).join('')}</select>
      </div>
      <div class="field" style="min-width:240px">
        <label class="field__label" for="senderName">Email signed as</label>
        <input class="input" id="senderName" maxlength="60" value="${esc(f.sender_name)}" data-testid="sharing-sender-name">
        <span class="field__hint">A display name only. The address is always Veye’s authenticated sender; a personal name needs that person’s approval.</span>
      </div>
    </div>
    <div class="row gap-3 wrap" style="align-items:center">
      <button class="btn btn--primary btn--sm" type="button" id="modePublish" data-testid="sharing-mode-publish" ${!changed || !f.sender_name.trim() ? 'disabled' : ''}>Publish</button>
      <span class="t-support">${cur.version ? `Version ${cur.version}, ${esc(H.fmtDate(cur.published_at))} by ${esc(cur.published_by)}.` : 'Built-in default: Manual, nothing published yet.'}</span>
    </div>
    ${noteHtml(hs.mode.note)}`;

  const again = () => modeSection(host);
  host.querySelectorAll('input[name="sharingMode"]').forEach((r) => r.addEventListener('change', () => { f.mode = r.value; again(); }));
  host.querySelector('#resendInterval').addEventListener('change', (e) => { f.resend_interval_hours = Number(e.target.value); again(); });
  host.querySelector('#senderName').addEventListener('input', (e) => {
    f.sender_name = e.target.value;
    const dirty = f.mode !== cur.mode || f.resend_interval_hours !== cur.resend_interval_hours || f.sender_name.trim() !== cur.sender_name;
    host.querySelector('#modePublish').disabled = !dirty || !f.sender_name.trim();
  });
  host.querySelector('#modePublish').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (f.mode === 'automatic' && cur.mode !== 'automatic') {
      const r = await UI.confirm({ title: 'Switch on automatic requests?',
        message: 'Switch on automatic requests? From now on, every member who verifies their email address is asked once, by email. Members who verified earlier are not emailed.',
        confirmLabel: 'Switch on automatic requests' });
      if (!r.ok) return;
    }
    const name = f.sender_name.replace(/\s+/g, ' ').trim();
    if (/[<>@"\\]/.test(name)) { hs.mode.note = { tone: 'error', text: "The sender name is a name only — the address is always Veye's own." }; again(); return; }
    H.busy(btn, 'Publishing…', () => {
      const s = S.get().sharingSettings;
      const version = s.notification.version + 1;
      const at = S.now();
      S.set({ sharingSettings: { ...s, notification: { ...s.notification, mode: f.mode, resend_interval_hours: f.resend_interval_hours, sender_name: name, version,
        published_at: at, published_by: S.me().name,
        history: [{ version, published_at: at, published_by: S.me().name, note: null, hash: '' }, ...s.notification.history] } } });
      S.audit('settings.health_sharing.notification_published', 'policy', 'health_sharing_notification', { version, mode: f.mode, resend_interval_hours: f.resend_interval_hours });
      f.sender_name = name;
      hs.mode.note = { tone: 'ok', text: `Published as version ${version}.` };
      again();
    });
  });
}

function templateSection(host) {
  const t = S.get().sharingSettings.template;
  const st = hs.tpl;
  host.innerHTML = `
    <h3 class="t-eyebrow">Request email ${t.draft ? H.chip('Unpublished draft', 'attention') : ''}</h3>
    <div class="field">
      <label class="field__label" for="sharingSubject">Subject</label>
      <input class="input" id="sharingSubject" maxlength="180" value="${esc(st.value.subject)}" data-testid="sharing-subject">
    </div>
    <div id="sharingBodyHost"></div>
    <p class="t-support">The button always reads <b>${esc(CTA_LABEL)}</b> and opens the app; it grants nothing by itself.</p>
    <div class="row gap-2 wrap">
      <button class="btn btn--secondary btn--sm" type="button" id="tplSave" data-testid="sharing-template-save">Save draft</button>
      <button class="btn btn--ghost btn--sm" type="button" id="tplPreview" data-testid="sharing-template-preview">Preview</button>
      <button class="btn btn--ghost btn--sm" type="button" id="tplTest" data-testid="sharing-template-test">Send me a test</button>
      <button class="btn btn--primary btn--sm" type="button" id="tplPublish" data-testid="sharing-template-publish" ${st.dirty || !t.draft ? 'disabled' : ''} ${st.dirty ? 'title="Save the draft first"' : !t.draft ? 'title="Nothing to publish"' : ''}>Publish</button>
      ${t.draft ? '<button class="btn btn--ghost btn--sm" type="button" id="tplDiscard">Discard draft</button>' : ''}
    </div>
    <span class="t-support" id="tplStatus">${t.version ? `Published version ${t.version}.` : 'Members receive the built-in default until a version is published.'}${st.dirty ? ' You have unsaved changes.' : ''}</span>
    ${noteHtml(st.note, 'sharing-template-note')}
    ${st.preview ? `<div class="stack gap-2" data-testid="sharing-template-preview-panel">
      <div class="t-support"><b>Subject:</b> ${esc(st.preview.subject)}</div>
      <iframe class="preview-frame" title="Email preview" sandbox="" id="tplFrame"></iframe>
      <details><summary class="t-support">Plain-text version</summary><pre style="white-space:pre-wrap">${esc(st.preview.text)}</pre></details>
    </div>` : ''}`;

  const again = () => templateSection(host);
  const markDirty = () => {
    if (!st.dirty) { st.dirty = true; st.preview = null; const p = host.querySelector('[data-testid="sharing-template-preview-panel"]'); if (p) p.remove(); }
    host.querySelector('#tplStatus').textContent = `${t.version ? `Published version ${t.version}.` : 'Members receive the built-in default until a version is published.'} You have unsaved changes.`;
    const pub = host.querySelector('#tplPublish'); pub.disabled = true; pub.title = 'Save the draft first';
  };
  host.querySelector('#sharingSubject').addEventListener('input', (e) => { st.value.subject = e.target.value; markDirty(); });
  window.Veye.RTE.mount(host.querySelector('#sharingBodyHost'), { id: 'sharingBody', label: 'Message', value: st.value.body, testId: 'sharing-body',
    variables: TEMPLATE_VARIABLES, onChange: (doc) => { if (JSON.stringify(doc) !== JSON.stringify(st.value.body)) { st.value.body = doc; markDirty(); } } });
  if (st.preview) host.querySelector('#tplFrame').srcdoc = st.preview.html;

  const validate = () => {
    const subject = st.value.subject.trim();
    if (!subject || subject.length > 180) return 'Write between 1 and 180 characters.';
    if (/[\r\n]/.test(subject)) return 'This field is a single line.';
    return checkText(subject, TEMPLATE_VARIABLES) || checkText(docText(st.value.body), TEMPLATE_VARIABLES)
      || (window.Veye.RTE.isBlank(st.value.body) ? 'The email needs some words.' : null);
  };
  const run = (btn, label, fn) => H.busy(btn, label, () => { const problem = validate(); if (problem && btn.id !== 'tplPublish' && btn.id !== 'tplDiscard') { st.note = { tone: 'error', text: problem }; again(); return; } fn(); again(); });

  host.querySelector('#tplSave').addEventListener('click', (e) => run(e.currentTarget, 'Saving…', () => {
    const s = S.get().sharingSettings;
    S.set({ sharingSettings: { ...s, template: { ...s.template, draft: { value: clone(st.value), updated_at: S.now(), by: S.me().name } } } });
    st.dirty = false;
    st.note = { tone: 'ok', text: 'Draft saved. Members still receive the published version.' };
  }));
  host.querySelector('#tplPreview').addEventListener('click', (e) => run(e.currentTarget, 'Rendering…', () => {
    const vars = sampleVars();
    const R2 = window.Veye.RTE;
    st.preview = {
      subject: R2.substitute(st.value.subject, vars).replace(/\s+/g, ' ').slice(0, 180),
      html: emailHtml('A request to share your health information', R2.docToHtml(st.value.body, vars, true)
        + `<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#5A6B4A">${esc(SHARING_LINK_NOTE)}</p>`, CTA_LABEL, vars.review_link),
      text: `${R2.docToText(st.value.body, vars)}\n${CTA_LABEL}: ${vars.review_link}\n\n${SHARING_LINK_NOTE}\n`,
    };
    st.note = null;
  }));
  host.querySelector('#tplTest').addEventListener('click', (e) => run(e.currentTarget, 'Sending…', () => {
    const to = S.me().email;
    const sent = S.deliver(to);
    st.note = sent.status === 'sent' ? { tone: 'ok', text: `A test was sent to ${to}.` } : { tone: 'error', text: `The test could not be sent: ${sent.detail || sent.status}.` };
  }));
  host.querySelector('#tplPublish').addEventListener('click', (e) => run(e.currentTarget, 'Publishing…', () => {
    const s = S.get().sharingSettings;
    if (!s.template.draft) { st.note = { tone: 'error', text: 'There is no draft to publish. Save a draft first.' }; return; }
    const version = s.template.version + 1;
    const at = S.now();
    S.set({ sharingSettings: { ...s, template: { ...s.template, value: clone(s.template.draft.value), version, draft: null,
      history: [{ version, published_at: at, published_by: S.me().name, note: null, hash: '' }, ...s.template.history] } } });
    S.audit('settings.health_sharing.template_published', 'policy', 'health_sharing_email', { version });
    st.value = clone(S.get().sharingSettings.template.value);
    st.note = { tone: 'ok', text: `Published as version ${version}.` };
  }));
  const discard = host.querySelector('#tplDiscard');
  if (discard) discard.addEventListener('click', (e) => run(e.currentTarget, 'Discard draft', () => {
    const s = S.get().sharingSettings;
    S.set({ sharingSettings: { ...s, template: { ...s.template, draft: null } } });
    st.value = clone(s.template.value);
    st.dirty = false; st.preview = null; st.note = null;
  }));
}

function termsSection(host) {
  const t = S.get().sharingSettings.terms;
  const st = hs.terms;
  const label = t.version ? `health-sharing-terms-v${t.version}` : 'health-sharing-2026-11-09-v2';
  host.innerHTML = `
    <h3 class="t-eyebrow">What members read before deciding ${t.draft ? H.chip('Unpublished draft', 'attention') : ''}</h3>
    <div id="termsSummaryHost"></div>
    <div class="row gap-4 wrap">
      <div class="field" style="flex:1 1 280px"><label class="field__label" for="termsRecipient">Who receives it (required)</label><input class="input" id="termsRecipient" maxlength="160" value="${esc(st.value.recipient)}" data-testid="terms-recipient"></div>
      <div class="field" style="flex:2 1 360px"><label class="field__label" for="termsPurpose">Why (required)</label><input class="input" id="termsPurpose" maxlength="300" value="${esc(st.value.purpose)}" data-testid="terms-purpose"></div>
    </div>
    <div id="termsDetailsHost"></div>
    <div class="notice notice--quiet">${icon('lock', { size: 18 })}<div>
      <strong>Fixed — always shown, not editable here:</strong> what is shared (${esc(LOCKED.categories.join('; '))}), ${esc(LOCKED.companion_use)}
      For how long: ${esc(LOCKED.expiry_rule)} ${esc(LOCKED.withdrawal)} Not covered: ${esc(LOCKED.not_covered)}
    </div></div>
    <div class="row gap-2 wrap">
      <button class="btn btn--secondary btn--sm" type="button" id="termsSave" data-testid="terms-save">Save draft</button>
      <button class="btn btn--ghost btn--sm" type="button" id="termsPreview" data-testid="terms-preview">Preview</button>
      <button class="btn btn--primary btn--sm" type="button" id="termsPublish" data-testid="terms-publish" ${st.dirty || !t.draft ? 'disabled' : ''}>Publish</button>
      ${t.draft ? '<button class="btn btn--ghost btn--sm" type="button" id="termsDiscard">Discard draft</button>' : ''}
    </div>
    <span class="t-support" id="termsStatus">Current: ${esc(label)}${t.version ? '' : ' (built-in default)'}.${st.dirty ? ' You have unsaved changes.' : ''}</span>
    ${noteHtml(st.note, 'terms-note')}
    ${st.preview ? `<div class="card" data-testid="terms-preview-panel"><div class="card__body stack gap-2">
      ${st.preview.material_change ? '<p class="errorbar">Material change: who receives the records or why has changed.</p>' : ''}
      <div class="consent-preview">${st.preview.summary_html}</div>
      <ul>${LOCKED.categories.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      <div class="consent-preview">${st.preview.details_html}</div>
    </div></div>` : ''}
    ${t.history.length ? `<details class="disclose"><summary>${icon('chevron-right', { size: 15 })} Published versions (${t.history.length})</summary>
      <ul class="rows" style="margin-top:8px">${t.history.map((h) => `<li class="rowitem"><span class="rowitem__icon">${icon('file-text', { size: 16 })}</span>
        <div><div class="rowitem__title">Version ${h.version}</div><div class="rowitem__meta">${esc(H.fmtDate(h.published_at))} by ${esc(h.published_by)}${h.note ? ' — ' + esc(h.note) : ''}</div></div></li>`).join('')}</ul>
    </details>` : ''}`;

  const again = () => termsSection(host);
  const markDirty = () => {
    if (!st.dirty) { st.dirty = true; st.preview = null; const p = host.querySelector('[data-testid="terms-preview-panel"]'); if (p) p.remove(); }
    host.querySelector('#termsStatus').textContent = `Current: ${label}${t.version ? '' : ' (built-in default)'}. You have unsaved changes.`;
    host.querySelector('#termsPublish').disabled = true;
  };
  window.Veye.RTE.mount(host.querySelector('#termsSummaryHost'), { id: 'termsSummary', label: 'Summary', value: st.value.summary, testId: 'terms-summary',
    variables: TERMS_VARIABLES, onChange: (doc) => { if (JSON.stringify(doc) !== JSON.stringify(st.value.summary)) { st.value.summary = doc; markDirty(); } } });
  window.Veye.RTE.mount(host.querySelector('#termsDetailsHost'), { id: 'termsDetails', label: 'Full terms', value: st.value.details, testId: 'terms-details',
    variables: TERMS_VARIABLES, onChange: (doc) => { if (JSON.stringify(doc) !== JSON.stringify(st.value.details)) { st.value.details = doc; markDirty(); } } });
  host.querySelector('#termsRecipient').addEventListener('input', (e) => { st.value.recipient = e.target.value; markDirty(); });
  host.querySelector('#termsPurpose').addEventListener('input', (e) => { st.value.purpose = e.target.value; markDirty(); });

  const single = (v, max, what) => { const text = String(v || '').replace(/\s+/g, ' ').trim(); return !text || text.length > max ? `${what} needs between 1 and ${max} characters.` : null; };
  const validate = () => single(st.value.purpose, 300, 'The purpose') || single(st.value.recipient, 160, 'Who receives it')
    || checkText(docText(st.value.summary), TERMS_VARIABLES) || checkText(docText(st.value.details), TERMS_VARIABLES)
    || (window.Veye.RTE.isBlank(st.value.summary) ? 'The summary needs some words.' : null);
  const material = (a, b) => a.purpose.trim() !== b.purpose.trim() || a.recipient.trim() !== b.recipient.trim();
  const run = (btn, label2, fn, check = true) => H.busy(btn, label2, () => { const problem = check ? validate() : null; if (problem) { st.note = { tone: 'error', text: problem }; again(); return; } Promise.resolve(fn()).then(again); });

  host.querySelector('#termsSave').addEventListener('click', (e) => run(e.currentTarget, 'Saving…', () => {
    const s = S.get().sharingSettings;
    const value = { ...clone(st.value), purpose: st.value.purpose.replace(/\s+/g, ' ').trim(), recipient: st.value.recipient.replace(/\s+/g, ' ').trim() };
    S.set({ sharingSettings: { ...s, terms: { ...s.terms, draft: { value, updated_at: S.now(), by: S.me().name } } } });
    st.dirty = false;
    st.note = { tone: 'ok', text: 'Draft saved. Members still read the published version.' };
  }));
  host.querySelector('#termsPreview').addEventListener('click', (e) => run(e.currentTarget, 'Rendering…', () => {
    const vars = { organization_name: 'Veye', support_email: S.get().org.supportEmail || 'the Veye team' };
    st.preview = { material_change: material(S.get().sharingSettings.terms.value, st.value),
      summary_html: window.Veye.RTE.docToHtml(st.value.summary, vars, false), details_html: window.Veye.RTE.docToHtml(st.value.details, vars, false) };
    st.note = null;
  }));
  host.querySelector('#termsPublish').addEventListener('click', (e) => run(e.currentTarget, 'Publishing…', async () => {
    const s = S.get().sharingSettings;
    if (!s.terms.draft) { st.note = { tone: 'error', text: 'There is no draft to publish. Save a draft first.' }; return; }
    const isMaterial = material(s.terms.value, s.terms.draft.value);
    if (st.preview && st.preview.material_change) {
      const r = await UI.confirm({ title: 'Publish a material change?', confirmLabel: 'Publish',
        message: 'This changes who receives the records or why. Members who already decided agreed to the earlier wording; they will see that a newer version exists. Publish?' });
      if (!r.ok) return;
    }
    const version = s.terms.version + 1;
    const at = S.now();
    S.set({ sharingSettings: { ...s, terms: { ...s.terms, value: clone(s.terms.draft.value), version, draft: null,
      history: [{ version, published_at: at, published_by: S.me().name, note: isMaterial ? 'Material change: purpose or recipient changed.' : null, hash: '' }, ...s.terms.history] } } });
    S.audit('settings.health_sharing.terms_published', 'policy', 'health_sharing_terms', { version, material_change: isMaterial });
    st.value = clone(S.get().sharingSettings.terms.value);
    st.preview = null;
    st.note = { tone: 'ok', text: `Published as version ${version}. New decisions are recorded against it.` };
  }, false));
  const discard = host.querySelector('#termsDiscard');
  if (discard) discard.addEventListener('click', (e) => run(e.currentTarget, 'Discard draft', () => {
    const s = S.get().sharingSettings;
    S.set({ sharingSettings: { ...s, terms: { ...s.terms, draft: null } } });
    st.value = clone(s.terms.value);
    st.dirty = false; st.preview = null; st.note = null;
  }, false));
}

window.Veye.privacyCard = (host) => { pv = { choice: null, forever: false, note: '', message: null }; privacyCard(host); };
window.Veye.healthSharingCard = (host) => { hs = null; healthSharingCard(host); };

})();
