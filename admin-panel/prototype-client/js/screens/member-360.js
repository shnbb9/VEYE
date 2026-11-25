/* ============================================================================
   Member 360
   ----------------------------------------------------------------------------
   The console's member record (platform/web app/admin/members/[memberId]):
   the header with the Health Number dial, the Health Data Sharing banner, and
   Overview · Assessments · Mood & Diary · Companion · Requests · Account.

   Health records are the member's to share. Until they grant it, the console
   is not sent their Health Number, body composition, blood markers,
   questionnaires or moods — the tabs are empty for that reason (the food
   diary is not part of the choice: Cara, 25 Nov 2026),
   and the banner says so rather than letting the record read as an inactive
   member. Asking is the only thing the console can do; the member decides in
   the app. Every opening of a record is written to the audit log as viewed or
   withheld, as the API does. Nothing here re-scores or edits a stored result.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'assessments', label: 'Assessments' },
  { key: 'journal', label: 'Mood & Diary' },
  { key: 'companion', label: 'Companion' },
  { key: 'requests', label: 'Requests' },
  { key: 'account', label: 'Account' },
];
const DELIVERY_LABELS = {
  sent: 'Email delivered to the mail server', queued: 'Email queued', sending: 'Email being sent',
  retry: 'Email refused — will be retried', failed: 'Email failed', skipped: 'Email not sent',
};
const STATE_LABELS = { not_requested: 'Not requested', requested: 'Awaiting your decision', granted: 'Shared with the Veye team', declined: 'Declined', revoked: 'Withdrawn' };
const REQUEST_STATUS_LABELS = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };
const MOOD_BALANCE = { happy: 100, calm: 100, excited: 100, neutral: 50, tired: 25, sad: 25, stressed: 0, angry: 0 };

function hnTone(value) {
  if (value === null) return 'var(--line-strong)';
  if (value <= 3) return 'var(--status-positive)';
  if (value <= 6) return 'var(--status-attention)';
  return 'var(--status-significant)';
}
const fmtNum = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
const localDate = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;

/** The console's mood header statistics (app/mood/service.py compute_stats). */
function moodStats(entries) {
  const today = new Date();
  const month = localDate(today).slice(0, 7);
  const byDay = new Set(entries.map((e) => e.entry_date));
  const inMonth = entries.filter((e) => e.entry_date.slice(0, 7) === month);
  const tally = {};
  inMonth.forEach((e) => { tally[e.mood] = (tally[e.mood] || 0) + 1; });
  const top = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || null;
  let streak = 0;
  const cursor = new Date(today);
  while (byDay.has(localDate(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 29);
  const window = entries.filter((e) => e.entry_date >= localDate(cutoff) && e.entry_date <= localDate(today)).map((e) => MOOD_BALANCE[e.mood]);
  return {
    days_logged_this_month: inMonth.length, day_streak: streak,
    top_mood_label: top ? entries.find((e) => e.mood === top).mood_label : null,
    balance_score: window.length ? Math.round(window.reduce((a, b) => a + b, 0) / window.length) : null, balance_entries: window.length,
  };
}

/** May the console ask this member now? (app/health_permission/requests.py) */
function eligibility(m) {
  if (!m.isActive) return { can: false, reason: 'This account is deactivated.', requiresReason: false };
  if (!m.emailVerified) return { can: false, reason: 'This member has not verified their email address yet. A request can be sent once they have.', requiresReason: false };
  const state = m.sharing.state;
  if (state === 'granted') return { can: false, reason: 'This member already shares their health records.', requiresReason: false };
  if (state === 'requested' && m.sharing.requested_at) {
    const hours = S.get().sharingSettings.notification.resend_interval_hours;
    const next = Date.parse(m.sharing.requested_at) + hours * 36e5;
    if (next > Date.now()) {
      return { can: false, requiresReason: false,
        reason: `Asked ${H.utcDay(m.sharing.requested_at)}. You can ask again after ${H.utcDayTime(new Date(next).toISOString())} UTC.` };
    }
  }
  return { can: true, reason: null, requiresReason: state === 'declined' || state === 'revoked' };
}

/** Who looked at whose records, when — once per record per minute. */
function recordView(m) {
  const last = S.get().lastViewed;
  if (last && last.id === m.id && Date.now() - last.at < 60e3) return;
  S.set({ lastViewed: { id: m.id, at: Date.now() } }, { silent: true });
  S.audit(S.shares(m) ? 'health.viewed' : 'health.withheld', 'member', m.id,
    { permission: m.sharing.state, policy_version: m.sharing.policy_version || '' });
}

/* ------------------------------------------------------------------ render */
function render(outlet, route) {
  const id = route.params.id;
  const m = S.member(id);
  if (!m) {
    outlet.innerHTML = `<div class="page">
      ${H.pageHead({ title: 'That member was not found', crumbs: [{ label: 'Home', route: '/home' }, { label: 'Members', route: '/members' }, { label: 'Not found' }],
        desc: 'That member was not found.' })}
      <div class="card"><div class="card__body">${H.emptyState({ icon: 'users', title: 'Try the directory',
        msg: 'The directory has a search across names, email addresses and member ids.',
        action: `<a class="btn btn--primary" href="${R.href('/members')}">Go to the member directory</a>` })}</div></div>
    </div>`;
    return;
  }
  const tab = (TABS.find((t) => t.key === route.params.tab) || TABS[0]).key;
  recordView(m);

  const shares = S.shares(m);
  const latest = shares ? m.records.health_number[0] || null : null;
  const hn = latest ? Number(latest.displayed_score) : null;
  const pct = hn === null ? 0 : Math.max(4, Math.min(100, (1 - hn / 10) * 100));

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: m.name, crumbs: [{ label: 'Home', route: '/home' }, { label: 'Members', route: '/members' }, { label: m.name }] })}

    <section class="m360">
      <div class="m360__who">
        <div class="row gap-4" style="align-items:center">
          ${H.avatar(m, 'lg')}
          <div style="min-width:0">
            <div class="m360__id">${esc(m.email)} · joined ${esc(H.fmtDate(m.joinedAt))}</div>
            <div class="row gap-2 wrap" style="margin-top:6px">
              ${m.archivedAt ? H.chip('Archived', 'archived') : H.chip(m.isActive ? 'Active' : 'Inactive', m.isActive ? 'live' : 'archived')}
              <span class="tag">${m.emailVerified ? 'Email verified' : 'Email unverified'}</span>
              ${m.isSynthetic ? '<span class="tag">Synthetic demo account</span>' : ''}
              ${m.adminAccess ? '<span class="tag">Also has admin access</span>' : ''}
            </div>
          </div>
        </div>
        <details class="disclose" style="margin-top:var(--s-5)">
          <summary>${icon('chevron-right', { size: 15 })} Member details</summary>
          <dl class="facts" style="margin-top:var(--s-4)">
            <div class="fact"><dt>Email</dt><dd>${esc(m.email)}</dd></div>
            <div class="fact"><dt>Phone</dt><dd>${esc(m.phone || '—')}</dd></div>
            <div class="fact"><dt>Postal code</dt><dd>${esc(m.postalCode || '—')}</dd></div>
            <div class="fact"><dt>Last active</dt><dd>${m.lastActiveAt ? esc(H.fmtDate(m.lastActiveAt)) : 'Never'}</dd></div>
            <div class="fact"><dt>Onboarding</dt><dd>${esc(m.onboarding)}</dd></div>
            <div class="fact"><dt>Member id</dt><dd class="mono">${esc(m.id)}</dd></div>
          </dl>
        </details>
      </div>
      <div class="m360__hn">
        <div class="arc">
          <div class="arc__dial" style="--pct:${pct.toFixed(0)};--tone:${hnTone(hn)}">
            <div class="arc__inner">
              <div class="arc__val">${hn === null ? '—' : hn.toFixed(1)}</div>
              <div class="arc__scale">of 10</div>
            </div>
          </div>
          <div style="min-width:0">
            <div class="t-eyebrow">Health Number</div>
            <div class="t-strong" style="margin-top:2px">${shares ? esc(latest ? latest.status : 'Not completed') : 'Not shared'}</div>
            <p class="t-support" style="margin-top:4px">A lower number is better on this scale.</p>
            <p class="t-support">${!shares ? 'Withheld until this member shares their records.'
              : latest ? `Taken ${esc(H.fmtDate(latest.completed_at))}` : 'No Health Number saved yet.'}</p>
            ${shares && latest ? `<p style="margin-top:6px">${window.Veye.MC.trendCell(window.Veye.MC.trendOf(m))}</p>` : ''}
          </div>
        </div>
      </div>
    </section>

    <div id="sharingBanner"></div>

    ${H.subnav(TABS.map((t) => ({ ...t, route: '/members/' + m.id + '/' + t.key })), tab)}
    <div id="tabBody"></div>
  </div>`;

  if (m.archivedAt) {
    outlet.querySelector('#sharingBanner').innerHTML = `<div class="notice" data-testid="archived-banner">${icon('lock', { size: 18 })}<div><strong>Archived</strong> ${esc(H.fmtDate(m.archivedAt))}${m.archivedBy ? ' by ' + esc(m.archivedBy) : ''}.${m.archiveReason ? ' ' + esc(m.archiveReason) + '.' : ''} They cannot open the member application, their health records are closed, and they are left out of the directory and every count. Nothing is deleted; restore them under Account.</div></div>`;
  } else banner(outlet.querySelector('#sharingBanner'), m, outlet, route);
  ({ overview, assessments, journal, companion, requests, account })[tab](outlet.querySelector('#tabBody'), m, outlet, route);
}

/* ------------------------------------------------------------ the banner -- */
function banner(host, m, outlet, route) {
  if (S.shares(m)) {
    host.innerHTML = `<div class="notice notice--quiet" data-testid="sharing-banner">
      ${icon('shield', { size: 18 })}
      <div><strong>${esc(STATE_LABELS.granted)}.</strong> This member has chosen to share their saved results with the
        Veye team. They can stop at any time, and the records close again immediately.</div>
    </div>`;
    return;
  }
  const explanation = {
    not_requested: 'This member has not been asked to share their health records yet.',
    requested: 'This member has been asked and has not answered yet.',
    declined: 'This member was asked and chose not to share.',
    revoked: 'This member shared before and has since stopped.',
  }[m.sharing.state];
  const allowed = eligibility(m);
  const delivery = m.sharing.state === 'requested' ? m.sharing.delivery : null;

  host.innerHTML = `<div class="notice" data-testid="sharing-banner">
    ${icon('shield', { size: 18 })}
    <div style="min-width:0">
      <strong>Health records are not shared.</strong> ${esc(explanation)}
      Their Health Number, body composition, blood markers, questionnaires and moods are not sent to this console —
      the tabs below are empty for that reason, not because nothing was recorded. Their name, email, messages and food
      diary are not covered by sharing and stay visible so the team can help them.
      ${delivery ? `<p class="t-support" style="margin-top:6px" data-testid="sharing-delivery">
        ${esc(DELIVERY_LABELS[delivery.status] || delivery.status)}${delivery.sent_at ? ' · ' + esc(H.fmtDate(delivery.sent_at)) : ''} · to ${esc(delivery.to_email)}${delivery.last_error && delivery.status !== 'sent' ? ' · ' + esc(delivery.last_error) : ''}
      </p>` : ''}
      ${!allowed.can && allowed.reason ? `<p class="t-support" style="margin-top:6px" data-testid="sharing-cannot-ask">${esc(allowed.reason)}</p>` : ''}
      ${allowed.requiresReason && allowed.can ? `<div class="field" style="margin-top:10px">
        <label class="field__label" for="askReason">They said no before. Why ask again? (kept with the request)</label>
        <input class="input" id="askReason" maxlength="300" placeholder="e.g. They asked for help reviewing their blood markers" data-testid="sharing-ask-reason">
      </div>` : ''}
      <div class="row gap-2 wrap" style="margin-top:10px">
        <button class="btn btn--secondary btn--sm" type="button" id="askBtn" data-testid="sharing-ask" ${allowed.can && !allowed.requiresReason ? '' : 'disabled'}>
          ${m.sharing.state === 'requested' ? 'Ask again' : 'Ask this member to share'}</button>
        ${delivery && ['retry', 'failed'].includes(delivery.status) ? '<button class="btn btn--ghost btn--sm" type="button" id="resendBtn" data-testid="sharing-resend">Try sending the email again</button>' : ''}
      </div>
    </div>
  </div>`;

  const ask = host.querySelector('#askBtn');
  const reasonInput = host.querySelector('#askReason');
  if (reasonInput) reasonInput.addEventListener('input', () => { ask.disabled = reasonInput.value.trim().length < 10; });

  ask.addEventListener('click', () => {
    const reason = reasonInput ? reasonInput.value.trim() : '';
    H.busy(ask, 'Asking…', () => {
      const at = S.now();
      const sent = S.deliver(m.email);
      S.updateMember(m.id, (x) => {
        x.sharing = { ...x.sharing, state: 'requested', requested_at: at, requested_by_name: S.me().name, decided_at: null,
          reason: reason || null,
          delivery: { status: sent.status, attempts: 1, last_error: sent.detail, sent_at: sent.status === 'sent' ? at : null, next_attempt_at: null, to_email: x.email } };
        return x;
      });
      const terms = S.get().sharingSettings.terms;
      S.audit('health_permission.requested', 'member', m.id, { state: 'requested', policy_version: `health-sharing-terms-v${terms.version}`, with_reason: !!reason });
      render(outlet, route);
    });
  });

  const resend = host.querySelector('#resendBtn');
  if (resend) resend.addEventListener('click', () => {
    H.busy(resend, 'Sending…', () => {
      const sent = S.deliver(m.email);
      S.updateMember(m.id, (x) => {
        const d = x.sharing.delivery;
        x.sharing.delivery = { ...d, status: sent.status, attempts: d.attempts + 1, last_error: sent.detail,
          sent_at: sent.status === 'sent' ? S.now() : d.sent_at, next_attempt_at: null };
        return x;
      });
      S.audit('health_permission.request_email_retried', 'member', m.id, {});
      render(outlet, route);
    });
  });
}

/* ------------------------------------------------------------------- tabs -- */
function lists(m) {
  const shares = S.shares(m);
  const empty = { health_number: [], body_composition: [], blood_markers: [], health_assessment: [], simple_quiz: [] };
  return {
    records: shares ? m.records : empty,
    mood: shares ? m.mood : [],
    diary: m.diary,
    trackersCompleted: ['health_number', 'body_composition', 'blood_markers', 'health_assessment', 'simple_quiz'].filter((k) => m.records[k].length).length,
  };
}

function overview(host, m) {
  const { records, mood, diary, trackersCompleted } = lists(m);
  const conversations = S.get().conversations.filter((c) => c.member_id === m.id);
  const requests = S.get().requests.filter((r) => r.member_id === m.id);
  const diaryDays = new Set(diary.map((d) => d.entry_date)).size;
  const trackers = [
    ['Health Number', records.health_number], ['Body Composition', records.body_composition], ['Blood Markers', records.blood_markers],
    ['Health Assessment', records.health_assessment], ['Simple Quiz', records.simple_quiz],
  ];
  host.innerHTML = `
    <div class="grid grid--main-side">
      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Where they are</h2></div></div>
          <div class="card__body">
            <div class="minirow">
              <div class="mini"><span class="mini__n">${esc(m.onboarding)}</span><span class="mini__l">Onboarding</span></div>
              <div class="mini"><span class="mini__n">${trackersCompleted} of 5</span><span class="mini__l">Trackers with results</span></div>
              <div class="mini"><span class="mini__n">${m.guided.length}</span><span class="mini__l">Guided sessions</span></div>
              <div class="mini"><span class="mini__n">${conversations.length}</span><span class="mini__l">Sprout conversations</span></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Health Number over time</h2><p class="t-support">A lower number is better on this scale.</p></div></div>
          <div class="card__body">
            ${records.health_number.length ? `<div class="bars">
              ${[...records.health_number].reverse().map((row) => `<div class="bar">
                <span class="bar__label">${esc(H.fmtDate(row.completed_at))}</span>
                <span class="bar__track"><span class="bar__fill" style="width:${Math.max(4, (Number(row.displayed_score) / 10) * 100)}%;background:${hnTone(Number(row.displayed_score))}"></span></span>
                <span class="bar__n">${Number(row.displayed_score).toFixed(1)}</span>
              </div>`).join('')}
            </div>` : '<p class="t-support">No Health Number saved yet.</p>'}
          </div>
        </div>
      </div>
      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Progress trackers</h2><p class="t-support">Results saved, and the latest date.</p></div></div>
          <div class="card__body">
            <dl class="kv">
              ${trackers.map(([label, rows]) => `<dt>${label}</dt><dd>${rows.length ? `${rows.length} · latest ${esc(H.fmtDate(rows[0].completed_at))}` : '<span class="t-muted">Not started</span>'}</dd>`).join('')}
            </dl>
          </div>
          <div class="card__foot"><a class="btn btn--secondary btn--sm" href="${R.href('/members/' + m.id + '/assessments')}">Open Assessments</a><a class="btn btn--ghost btn--sm" href="${R.href('/members/' + m.id + '/journal')}">Mood &amp; Diary</a></div>
        </div>
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Journal &amp; requests</h2><p class="t-support">Non-clinical entries and messages from this member.</p></div></div>
          <div class="card__body">
            <dl class="kv">
              <dt>Mood entries</dt><dd>${mood.length ? `${mood.length} · latest ${esc(mood[0].entry_date)} (${esc(mood[0].mood_label)})` : '<span class="t-muted">Not started</span>'}</dd>
              <dt>Food Diary</dt><dd>${diaryDays ? `${diaryDays} day${diaryDays === 1 ? '' : 's'} · latest ${esc(diary[0].entry_date)}` : '<span class="t-muted">Not started</span>'}</dd>
              <dt>Requests</dt><dd>${requests.length ? `${requests.length} · ${requests.filter((r) => r.status !== 'resolved').length} open` : '<span class="t-muted">None</span>'}</dd>
            </dl>
          </div>
        </div>
        <div class="notice notice--quiet">${icon('info', { size: 18 })}<div>Not connected to the application yet: Mindfulness, Activity Tracker (Exercise, Meditation). These sections show honest empty states in the member product.</div></div>
      </div>
    </div>`;
}

function resultCard(title, description, head, rows) {
  const count = rows.length;
  return `<div class="card" data-testid="m360-${title.toLowerCase().replace(/\s+/g, '-')}">
    <div class="card__head"><div><h2 class="card__title">${esc(title)}</h2><p class="t-support">${esc(description)}</p></div><span class="tag">${count} result${count === 1 ? '' : 's'} · System managed</span></div>
    <div class="card__body card__body--flush">
      ${rows.length ? `<div class="table-wrap"><table class="table table--compact">
        <thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>` : '<p class="t-support" style="padding:20px">Not started.</p>'}
    </div>
  </div>`;
}

function assessments(host, m) {
  const { records } = lists(m);
  host.innerHTML = `<div class="stack gap-5">
    <div class="notice notice--quiet">${icon('lock', { size: 18 })}<div>Historical results are read-only. Each row is the calculation as it was saved on that day (with its calculation version); nothing here is re-scored.</div></div>
    ${resultCard('Health Number', '12 questions · 1–10, lower is better.', ['Date', 'Number', 'Band', 'Category', 'Version'],
      records.health_number.map((r) => [H.fmtDate(r.completed_at), Number(r.displayed_score).toFixed(1), r.status, r.category, r.calculation_version]))}
    ${resultCard('Body Composition', "Standard BMI plus the client's body-fat tables.", ['Date', 'Sex', 'BMI', 'Body fat', 'Fat mass', 'Lean mass', 'Version'],
      records.body_composition.map((r) => [H.fmtDate(r.completed_at), r.sex, r.bmi === null ? '—' : String(r.bmi),
        r.body_fat_available ? `${r.body_fat_percent}%` : (r.unavailable_reason ? 'not available' : '—'),
        r.fat_mass_lb === null ? '—' : `${r.fat_mass_lb} lb`, r.lean_mass_lb === null ? '—' : `${r.lean_mass_lb} lb`, r.calculation_version]))}
    ${resultCard('Blood Markers', "Ratios with goal flags and the client's supplement suggestion.", ['Date', 'TG/HDL', 'HOMA-IR', 'AA/EPA', 'HbA1c', 'In range', 'Suggestion', 'Version'],
      records.blood_markers.map((r) => {
        const flags = Object.values(r.in_range).filter((v) => v !== null);
        return [H.fmtDate(r.completed_at), fmtNum(r.tg_hdl), fmtNum(r.homa_ir), fmtNum(r.aa_epa),
          r.markers.hba1c === null || r.markers.hba1c === undefined ? '—' : `${r.markers.hba1c}%`, `${flags.filter(Boolean).length} of ${flags.length}`,
          r.recommendation.state === 'ok' ? `EPA/DHA ${r.recommendation.epa_dha_dose}` : r.recommendation.state === 'review' ? 'requires review' : '—', r.calculation_version];
      }))}
    ${resultCard('Health Assessment', '11 questions scoring 1–3 · total 11–33, lower is better · EPA/DHA suggestion by score.', ['Date', 'Total', 'Band', 'EPA/DHA', 'Version'],
      records.health_assessment.map((r) => [H.fmtDate(r.completed_at), `${r.total} / 33`, r.status, r.epa_dha_dose, r.calculation_version]))}
    ${resultCard('Simple Quiz', '8 yes/no questions · a dated count. Never creates or changes a Health Number.', ['Date', 'Result', 'Yes', 'No', 'Version'],
      records.simple_quiz.map((r) => [H.fmtDate(r.completed_at), r.summary, String(r.yes_count), String(r.no_count), r.calculation_version]))}
  </div>`;
}

function journal(host, m) {
  const { mood, diary } = lists(m);
  const stats = moodStats(mood);
  const diaryDays = new Set(diary.map((d) => d.entry_date)).size;
  host.innerHTML = `<div class="grid grid--2" data-testid="m360-journal">
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Mood Tracker</h2><p class="t-support">One mood a day with an optional note. Balance score: the client's 30-day formula (positive 100 · neutral 50 · tired/sad 25 · stressed/angry 0).</p></div><span class="tag">${mood.length} entr${mood.length === 1 ? 'y' : 'ies'}</span></div>
      <div class="card__body">
        <dl class="kv">
          <dt>Logged this month</dt><dd>${stats.days_logged_this_month}</dd>
          <dt>Day streak</dt><dd>${stats.day_streak}</dd>
          <dt>Most felt</dt><dd>${stats.top_mood_label ? esc(stats.top_mood_label) : '<span class="t-muted">—</span>'}</dd>
          <dt>Balance score</dt><dd>${stats.balance_score === null ? '<span class="t-muted">— (no entries in the last 30 days)</span>' : `${stats.balance_score}% over ${stats.balance_entries} day${stats.balance_entries === 1 ? '' : 's'}`}</dd>
        </dl>
      </div>
      <div class="card__body card__body--flush">
        ${mood.length ? `<div class="table-wrap"><table class="table table--compact">
          <thead><tr><th scope="col">Day</th><th scope="col">Mood</th><th scope="col">Note</th></tr></thead>
          <tbody>${mood.slice(0, 31).map((e) => `<tr><td>${esc(e.entry_date)}</td><td>${esc(e.mood_label)}</td><td class="t-support">${esc(e.note || '—')}</td></tr>`).join('')}</tbody>
        </table></div>` : `<p class="t-support" style="padding:20px">${S.shares(m) ? 'No mood logged yet.' : 'Not shared.'}</p>`}
      </div>
    </div>
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Food Diary</h2><p class="t-support">Meal entries as the member wrote them. No nutritional analysis is computed — that is a client decision.</p></div><span class="tag">${diaryDays} day${diaryDays === 1 ? '' : 's'} logged</span></div>
      <div class="card__body card__body--flush">
        ${diary.length ? `<div class="table-wrap"><table class="table table--compact">
          <thead><tr><th scope="col">Day</th><th scope="col">Time</th><th scope="col">Meal</th><th scope="col">Felt before</th></tr></thead>
          <tbody>${diary.map((e) => `<tr><td class="t-nowrap">${esc(e.entry_date)}</td><td class="t-nowrap">${esc(e.meal_time)}</td><td>${esc(e.description)}${e.notes ? `<div class="cell-sub">${esc(e.notes)}</div>` : ''}</td><td class="t-support">${esc(e.feelings.join(', ') || '—')}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="t-support" style="padding:20px">No diary entry yet.</p>'}
      </div>
    </div>
  </div>`;
}

function companion(host, m) {
  const conversations = S.get().conversations.filter((c) => c.member_id === m.id).sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));
  const guided = [...m.guided].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  host.innerHTML = `<div class="stack gap-5">
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">${icon('sprout')} Guided experiences</h2><p class="t-support">Sprout's guided flows and where this member is in each.</p></div></div>
      <div class="card__body card__body--flush">
        ${guided.length ? `<div class="table-wrap"><table class="table table--compact">
          <thead><tr><th scope="col">Flow</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Step</th><th scope="col">Updated</th></tr></thead>
          <tbody>${guided.map((g) => `<tr><td>${esc(g.flow_title)}</td><td>v${g.flow_version}</td>
            <td>${H.chip(g.status.replace('_', ' '), g.status === 'completed' ? 'live' : g.status === 'skipped' ? 'archived' : 'draft')}</td>
            <td class="mono">${esc(g.current_node)}</td><td class="t-nowrap">${esc(H.fmtDate(g.updated_at))}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="t-support" style="padding:20px">No guided session yet.</p>'}
      </div>
      <div class="card__foot"><a class="btn btn--ghost btn--sm" href="${R.href('/companion/settings/guided-experiences')}">Guided Experiences ${icon('chevron-right', { size: 16 })}</a></div>
    </div>
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">${icon('messages')} Conversations</h2><p class="t-support">Sprout conversations with this member. Transcripts open in Companion → Conversations.</p></div></div>
      <div class="card__body card__body--flush">
        ${conversations.length ? `<div class="table-wrap"><table class="table table--compact">
          <thead><tr><th scope="col">Started</th><th scope="col">Last message</th><th scope="col">Messages</th><th scope="col">Review</th><th scope="col"><span class="sr-only">Open</span></th></tr></thead>
          <tbody>${conversations.map((c) => `<tr><td class="t-nowrap">${esc(H.fmtDate(c.started_at))}</td><td class="t-nowrap">${esc(H.fmtDate(c.last_message_at))}</td><td>${c.message_count}</td>
            <td>${c.flagged ? H.chip(c.reviewed_at ? 'reviewed' : 'needs review', c.reviewed_at ? 'live' : 'attention') : '<span class="t-muted">—</span>'}</td>
            <td style="text-align:right"><a class="btn btn--secondary btn--sm" href="${R.href('/companion/conversations?conversation=' + c.id)}">Open</a></td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="t-support" style="padding:20px">No conversation yet.</p>'}
      </div>
    </div>
  </div>`;
}

function requests(host, m) {
  const rows = S.get().requests.filter((r) => r.member_id === m.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  host.innerHTML = `<div class="card" data-testid="m360-requests">
    <div class="card__head"><div><h2 class="card__title">Requests</h2><p class="t-support">Contact Us messages, Help questions and Join Beta submissions from this member.</p></div><a class="btn btn--secondary btn--sm" href="${R.href('/requests')}">Open Requests &amp; Inbox</a></div>
    <div class="card__body card__body--flush">
      ${rows.length ? `<div class="table-wrap"><table class="table table--compact">
        <thead><tr><th scope="col">Received</th><th scope="col">Kind</th><th scope="col">Subject</th><th scope="col">Answered</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Open</span></th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(H.fmtDate(r.created_at))}</td><td>${esc(window.Veye.REQUEST_KIND_LABELS[r.kind])}</td><td>${esc(r.subject || r.message.slice(0, 60))}</td>
          <td>${r.replies.length === 0 ? '<span class="t-support">Not yet</span>' : esc(H.fmtDate(r.replies[r.replies.length - 1].created_at))}</td>
          <td>${H.chip(REQUEST_STATUS_LABELS[r.status], r.status === 'resolved' ? 'live' : r.status === 'new' ? 'attention' : 'info')}</td>
          <td style="text-align:right"><a class="btn btn--secondary btn--sm" href="${R.href('/requests?view=all&id=' + r.id)}">Open</a></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="t-support" style="padding:20px">No request from this member.</p>'}
    </div>
  </div>`;
}

/* ----------------------------------------------------------- the account -- */
let accountNote = { id: null, text: '' };

/* Archive first, delete last: an archived member is signed out and left out of
   the directory, and can be restored. Deletion is a different thing. */
let archiveNote = '';
function archiveCard(host, m, outlet, route) {
  host.innerHTML = `<div class="card" data-testid="m360-archive">
    <div class="card__head"><div><h2 class="card__title">${m.archivedAt ? 'Restore member' : 'Archive member'}</h2><p class="t-support">${m.archivedAt
      ? 'Brings them back to the directory and lets them open the member application again. What they share is as they left it.'
      : 'Signs them out of the member application and leaves them out of the directory. Nothing is deleted and you can restore them.'}</p></div></div>
    <div class="card__body stack gap-4">
      ${archiveNote ? `<p class="t-support" role="status" data-testid="archive-notice">${esc(archiveNote)}</p>` : ''}
      ${m.archivedAt ? '<div><button class="btn btn--secondary btn--sm" type="button" data-testid="member-restore">Restore member</button></div>'
        : `<div class="field"><label for="archiveReason">Reason <span class="t-muted">(optional, kept with the record)</span></label><input class="input" id="archiveReason" maxlength="300"></div>
           <div><button class="btn btn--danger-quiet btn--sm" type="button" data-testid="member-archive">Archive member</button></div>`}
    </div></div>`;
  const restore = host.querySelector('[data-testid="member-restore"]');
  if (restore) restore.addEventListener('click', () => {
    S.updateMember(m.id, (x) => { x.archivedAt = null; x.archivedBy = null; x.archiveReason = ''; return x; });
    S.audit('member.restored', 'member', m.id, {}); archiveNote = `${m.name} is back in the directory.`; render(outlet, route);
  });
  const archive = host.querySelector('[data-testid="member-archive"]');
  if (archive) archive.addEventListener('click', async () => {
    const reason = host.querySelector('#archiveReason').value.trim();
    const r = await UI.confirm({ title: 'Archive this member?', message: `Archive ${esc(m.name)}? They are signed out of the member application and leave the directory.`, reversible: 'You can restore them later.', confirmLabel: 'Archive', danger: true });
    if (!r.ok) return;
    S.updateMember(m.id, (x) => { x.archivedAt = S.now(); x.archivedBy = S.me().name; x.archiveReason = reason; x.activeSessions = 0; return x; });
    S.audit('member.archived', 'member', m.id, { with_reason: !!reason }); archiveNote = `${m.name} is archived.`; render(outlet, route);
  });
}

function account(host, m, outlet, route) {
  const notice = accountNote.id === m.id ? accountNote.text : '';
  const activity = S.accountActivity({ userId: m.accountId, limit: 10 });
  host.innerHTML = `<div class="stack gap-5">
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Account</h2><p class="t-support">Identity and access facts. Administrator access is provisioned by the system, never self-served.</p></div></div>
      <div class="card__body">
        <dl class="kv">
          <dt>Name</dt><dd>${esc(m.name)}</dd>
          <dt>Email</dt><dd>${esc(m.email)} · ${m.emailVerified ? 'verified' : 'not verified'}</dd>
          ${m.pendingEmail ? `<dt>Pending email</dt><dd>${esc(m.pendingEmail)} · waiting for the member to confirm from that mailbox</dd>` : ''}
          <dt>Account id</dt><dd class="mono">${esc(m.accountId)}</dd>
          <dt>Member id</dt><dd class="mono">${esc(m.id)}</dd>
          <dt>Member portal</dt><dd>Yes — this account owns a member profile</dd>
          <dt>Admin console</dt><dd>${m.adminAccess ? 'Yes — managed under Settings → Administrators' : 'No'}</dd>
          <dt>Status</dt><dd>${m.isActive ? 'Active' : `Deactivated${m.deactivatedAt ? ' on ' + esc(H.fmtDate(m.deactivatedAt)) : ''}`}${m.isSynthetic ? ' · synthetic local demo account' : ''}</dd>
          <dt>Signed in now</dt><dd>${m.activeSessions === 0 ? 'No live session' : `${m.activeSessions} session${m.activeSessions === 1 ? '' : 's'}`}${m.lastSessionAt ? ' · last seen ' + esc(H.fmtDate(m.lastSessionAt)) : ''}</dd>
          <dt>Joined</dt><dd>${esc(H.fmtDate(m.joinedAt))}</dd>
          <dt>Last active</dt><dd>${m.lastActiveAt ? esc(H.fmtDate(m.lastActiveAt)) : 'Never'}</dd>
        </dl>
      </div>
    </div>
    ${m.adminAccess ? `<div class="card" data-testid="m360-account-actions">
      <div class="card__head"><div><h2 class="card__title">Account actions</h2></div></div>
      <div class="card__body">
        <div class="notice notice--quiet">${icon('info', { size: 18 })}<div>
          ${esc(m.name)} also has console access, so this account is managed under
          <a href="${R.href('/settings/administrators')}">Settings → Administrators</a>, where the last-administrator guard lives.
        </div></div>
      </div>
    </div>` : `<div class="card" data-testid="m360-account-actions">
      <div class="card__head"><div><h2 class="card__title">Account actions</h2>
        <p class="t-support">Access and email only. Results stay read-only, and a password is always chosen by the member.</p></div></div>
      <div class="card__body card__body--flush">
        ${notice ? `<p class="t-support" role="status" style="padding:12px 20px 0" data-testid="account-action-notice">${esc(notice)}</p>` : ''}
        <div class="rows">
          <div class="rowitem">
            <span class="rowitem__icon${m.isActive ? '' : ' rowitem__icon--off'}">${icon('lock', { size: 18 })}</span>
            <div>
              <div class="rowitem__title">${m.isActive ? 'Deactivate account' : 'Reactivate account'}</div>
              <div class="rowitem__meta">${m.isActive
                ? 'Signs them out everywhere at once and refuses their password until reactivated. Their saved results are kept.'
                : `Deactivated${m.deactivatedAt ? ' on ' + esc(H.fmtDate(m.deactivatedAt)) : ''}. Reactivating lets them sign in with the password they already had.`}</div>
            </div>
            ${m.isActive
              ? '<button class="btn btn--danger-quiet btn--sm" type="button" data-act="deactivate" data-testid="account-deactivate">Deactivate</button>'
              : '<button class="btn btn--secondary btn--sm" type="button" data-act="reactivate" data-testid="account-reactivate">Reactivate</button>'}
          </div>
          <div class="rowitem">
            <span class="rowitem__icon${m.emailVerified ? ' rowitem__icon--off' : ''}">${icon('mail', { size: 18 })}</span>
            <div>
              <div class="rowitem__title">Verification email</div>
              <div class="rowitem__meta">${m.emailVerified
                ? `${esc(m.email)} is already verified, so there is nothing to resend.`
                : `Sends a fresh verification link to ${esc(m.email)}. It works once and expires in 48 hours.`}</div>
            </div>
            <button class="btn btn--secondary btn--sm" type="button" data-act="resend-verification" data-testid="account-resend-verification" ${m.emailVerified || !m.isActive ? 'disabled' : ''}>Resend</button>
          </div>
          <div class="rowitem">
            <span class="rowitem__icon">${icon('shield', { size: 18 })}</span>
            <div>
              <div class="rowitem__title">Password reset link</div>
              <div class="rowitem__meta">Emails ${esc(m.email)} the ordinary single-use reset link (30 minutes). You never see or choose their password.</div>
            </div>
            <button class="btn btn--secondary btn--sm" type="button" data-act="send-password-reset" data-testid="account-send-reset" ${m.isActive ? '' : 'disabled'}>Send reset link</button>
          </div>
        </div>
      </div>
      ${activity.length ? `<div class="card__body card__body--flush" data-testid="account-history">
        <div class="t-eyebrow" style="padding:16px 20px 0">Account history</div>
        <div class="rows">${activity.map((a) => `<div class="rowitem">
          <span class="rowitem__icon">${icon('clipboard', { size: 18 })}</span>
          <div style="min-width:0"><div class="rowitem__title">${esc(a.label)}</div><div class="rowitem__meta">by ${esc(a.actor_name)}</div></div>
          <span class="t-support" style="white-space:nowrap">${esc(H.fmtDate(a.at))}</span>
        </div>`).join('')}</div>
      </div>` : ''}
      <div class="card__foot"><span class="t-support">Every action here is written to the admin audit log.</span></div>
    </div>`}
    <div id="archiveHost"></div>
  </div>`;
  archiveCard(host.querySelector('#archiveHost'), m, outlet, route);

  host.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const action = btn.dataset.act;
    const confirms = {
      deactivate: { title: 'Deactivate this account?', message: `Deactivate ${esc(m.name)}? They are signed out at once and cannot sign in until reactivated.`, confirmLabel: 'Deactivate', danger: true },
      'send-password-reset': { title: 'Send a reset link?', message: `Email ${esc(m.name)} a password-reset link?`, confirmLabel: 'Send reset link' },
    };
    if (confirms[action]) { const r = await UI.confirm(confirms[action]); if (!r.ok) return; }
    const labels = { deactivate: 'Working…', reactivate: 'Working…', 'resend-verification': 'Sending…', 'send-password-reset': 'Sending…' };
    H.busy(btn, labels[action], () => {
      let message = '';
      let delivery = null;
      if (action === 'deactivate') {
        S.updateMember(m.id, (x) => { x.isActive = false; x.deactivatedAt = S.now(); x.activeSessions = 0; return x; });
        S.audit('member_account.deactivated', 'user_account', m.accountId, { email: m.email });
        message = 'The account is deactivated and every session has ended.';
      } else if (action === 'reactivate') {
        S.updateMember(m.id, (x) => { x.isActive = true; x.deactivatedAt = null; return x; });
        S.audit('member_account.reactivated', 'user_account', m.accountId, { email: m.email });
        message = 'The account is active again. They can sign in as before.';
      } else if (action === 'resend-verification') {
        delivery = S.deliver(m.email);
        S.audit('member_account.verification_resent', 'user_account', m.accountId, { email: m.email, delivery: delivery.status });
        message = 'A fresh verification email has been sent.';
      } else {
        delivery = S.deliver(m.email);
        S.audit('member_account.password_reset_sent', 'user_account', m.accountId, { email: m.email, delivery: delivery.status });
        message = 'A password-reset link has been emailed to the member.';
      }
      accountNote = { id: m.id, text: delivery && delivery.status !== 'sent'
        ? `${message} The email could not be sent: ${delivery.detail || 'mail service unavailable'}.` : message };
      render(outlet, route);
    });
  }));
}

window.Veye.memberEligibility = eligibility;
window.Veye.screens = window.Veye.screens || {};
/* Arriving at a record starts without a notice, as the console's remount does;
   an account action re-renders internally so its own result stays on screen. */
window.Veye.screens['member-360'] = { render: (outlet, route) => {
  accountNote = { id: null, text: '' };
  archiveNote = '';
  render(outlet, route);
} };

})();
