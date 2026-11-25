/* ============================================================================
   Companion → Settings → Advanced
   ----------------------------------------------------------------------------
   The console's five operational pages (platform/web app/admin/companion/
   settings/advanced/**): AI Monitoring, Retrieval Diagnostics, Safety
   Analytics, Provider Status and Audit. Everything is counted from the
   prototype's masked telemetry, policy decisions and audit log. Provider
   Status shows what the console reports for its local development stack —
   which services are replaceable, which are connected, and which remain
   client decisions. No secret is ever shown.
   ============================================================================ */

(function () {

const R = window.Veye.R;
const S = window.Veye.S;
const H = window.Veye.H;
const esc = window.Veye.UI.esc;

const PAGES = {
  'ai-monitoring': { title: 'AI Monitoring', desc: 'Every Sprout turn, as the masked telemetry record: pseudonymous member reference, provider and model, latency, tokens, policy decision, safety result, sources and feedback. Names, contact details and raw member text are never part of it.' },
  'retrieval-diagnostics': { title: 'Retrieval Diagnostics', desc: 'What the approved-knowledge index holds and how recent retrievals scored. Try a synthetic question against the index — administrator text only, never member data.' },
  'safety-analytics': { title: 'Safety Analytics', desc: 'How the policy gate and the output-safety check decided over the last 30 days, and every conversation handed to a person.' },
  'provider-status': { title: 'Provider Status', desc: 'Environment: local-docker. Which replaceable services are connected, and which remain client decisions. No secrets are shown here.' },
  audit: { title: 'Audit', desc: 'Who changed what in the console: knowledge-source lifecycle, Companion settings, conversation and feedback reviews. Policy decisions on member messages are audited separately with each conversation.' },
};

function frame(outlet, key) {
  const page = PAGES[key];
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: page.title, desc: esc(page.desc),
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Companion', route: '/companion/conversations' }, { label: 'Settings', route: '/companion/settings' }, { label: 'Advanced' }] })}
    ${H.subnav(window.Veye.ADVANCED_NAV.map((n) => ({ ...n, route: '/companion/settings/advanced/' + n.key })), key)}
    <div id="advBody"></div>
  </div>`;
  return outlet.querySelector('#advBody');
}

function counts(obj, empty = 'None yet') {
  const entries = Object.entries(obj);
  if (!entries.length) return `<span class="t-support">${esc(empty)}</span>`;
  return `<div class="tagrow">${entries.map(([k, v]) => `<span class="tag">${esc(k.replace(/_/g, ' '))} · ${v}</span>`).join('')}</div>`;
}
function tally(list) { const o = {}; list.forEach((k) => { if (k !== null && k !== undefined) o[k] = (o[k] || 0) + 1; }); return o; }

function traceTable(rows, caption) {
  if (!rows.length) return '<p class="empty-row">No Sprout turns recorded yet.</p>';
  return `<div class="table-wrap"><table class="table table--compact">
    <caption class="sr-only">${esc(caption)}</caption>
    <thead><tr><th>When</th><th>Member ref</th><th>Provider</th><th>Latency</th><th>Tokens</th><th>Policy</th><th>Safety</th><th>Sources</th><th>Feedback</th><th>Error</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td class="t-nowrap">${esc(H.fmtDate(r.created_at))}</td>
      <td class="mono">${esc(r.member_ref)}</td>
      <td>${r.provider ? esc(r.provider + (r.model ? ' · ' + r.model : '')) : '—'}</td>
      <td class="t-num">${r.provider ? r.latency_ms + ' ms' : '—'}</td>
      <td class="t-num">${r.input_tokens != null ? `${r.input_tokens} / ${r.output_tokens || 0}` : '—'}</td>
      <td>${esc(r.policy_outcome)}${r.policy_category ? ` (${esc(r.policy_category)})` : ''}</td>
      <td>${esc(r.safety_result.replace(/_/g, ' '))}</td>
      <td class="t-num">${r.retrieval_count}${r.top_retrieval_score != null ? ` · top ${Math.round(r.top_retrieval_score * 100)}%` : ''}</td>
      <td>${r.feedback ? esc(r.feedback.replace('_', ' ')) : '—'}</td>
      <td>${esc(r.error_category || '—')}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

/* ------------------------------------------------------------ AI monitoring */
let windowDays = 30;
function aiMonitoring(outlet) {
  const body = frame(outlet, 'ai-monitoring');
  const since = Date.now() - windowDays * 864e5;
  const rows = S.get().telemetry.filter((t) => Date.parse(t.created_at) >= since);
  const called = rows.filter((t) => t.provider);
  const lat = called.map((t) => t.latency_ms).sort((a, b) => a - b);
  const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  const p95 = lat.length ? lat[Math.max(0, Math.ceil(lat.length * 0.95) - 1)] : null;
  const tokensIn = rows.reduce((t, r) => t + (r.input_tokens || 0), 0);
  const tokensOut = rows.reduce((t, r) => t + (r.output_tokens || 0), 0);
  body.innerHTML = `<div class="stackgap">
    <div class="card">
      <div class="card__head">
        <div><h2 class="card__title">Last ${windowDays} days</h2><p class="t-support">Environment local-docker · exporters: database · content capture off · Langfuse ${H.chip('disabled', 'archived')}</p></div>
        <div class="modeswitch" role="tablist" aria-label="Reporting window">
          ${[7, 30, 90].map((n) => `<button class="modeswitch__btn" type="button" role="tab" aria-selected="${windowDays === n}" data-days="${n}">${n} days</button>`).join('')}
        </div>
      </div>
      <div class="card__body">
        <div class="metric-row metric-row--wrap">
          <div class="metric"><div class="metric__body"><span class="metric__label">Sprout turns</span><span class="metric__value">${rows.length}</span></div></div>
          <div class="metric"><div class="metric__body"><span class="metric__label">Model answers</span><span class="metric__value">${called.length}</span></div></div>
          <div class="metric"><div class="metric__body"><span class="metric__label">Average latency</span><span class="metric__value">${avg != null ? avg + ' ms' : '—'}</span></div></div>
          <div class="metric"><div class="metric__body"><span class="metric__label">p95 latency</span><span class="metric__value">${p95 != null ? p95 + ' ms' : '—'}</span></div></div>
          <div class="metric"><div class="metric__body"><span class="metric__label">Tokens in / out</span><span class="metric__value">${tokensIn} / ${tokensOut}</span></div></div>
        </div>
        <dl class="kv" style="margin-top:var(--s-5)">
          <dt>By provider</dt><dd>${counts(tally(called.map((t) => t.provider)))}</dd>
          <dt>By policy outcome</dt><dd>${counts(tally(rows.map((t) => t.policy_outcome)))}</dd>
          <dt>Errors</dt><dd>${counts(tally(rows.map((t) => t.error_category)), 'No errors')}</dd>
          <dt>Feedback</dt><dd>${counts(tally(rows.map((t) => t.feedback)), 'No feedback yet')}</dd>
        </dl>
      </div>
    </div>
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Recent turns</h2><p class="t-support">Member ref is an HMAC pseudonym; it links turns by the same member without identifying them.</p></div></div>
      <div class="card__body card__body--flush">${traceTable(rows.slice(0, 50), 'Recent Sprout turns')}</div>
    </div>
  </div>`;
  body.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { windowDays = +b.dataset.days; aiMonitoring(outlet); }));
}

/* ------------------------------------------------------- retrieval diagnostics */
const STOP = new Set(['the', 'and', 'for', 'what', 'does', 'how', 'are', 'you', 'your', 'can', 'with', 'this', 'that', 'from', 'about', 'mean', 'means', 'when', 'have', 'has', 'into', 'its', 'our']);
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
let hits = null;
let lastQuery = '';

/** A stand-in for the pgvector search: the same path Sprout uses — Active,
 *  approved sources only — scored by how much of the question a passage holds. */
function search(query) {
  const q = new Set(words(query));
  if (!q.size) return [];
  const out = [];
  S.get().knowledgeSources.filter((s) => s.status === 'Active' && s.current_document && s.current_document.ingestion_status === 'ingested').forEach((s) => {
    (s.passages || []).forEach((p) => {
      const pw = words((p.heading || '') + ' ' + p.text);
      let found = 0;
      q.forEach((w) => { if (pw.some((x) => x === w || (w.length > 4 && x.startsWith(w.slice(0, -1))))) found += 1; });
      if (!found) return;
      out.push({ source_id: s.id, chunk_id: p.chunk_id, title: s.title, source_version: s.version, heading: p.heading, excerpt: p.text.slice(0, 280),
        score: Math.min(0.95, 0.28 + 0.62 * (found / q.size)) });
    });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

function retrieval(outlet) {
  const body = frame(outlet, 'retrieval-diagnostics');
  const sources = S.get().knowledgeSources;
  const retrievable = sources.filter((s) => s.status === 'Active' && s.current_document && s.current_document.ingestion_status === 'ingested');
  const ingested = sources.filter((s) => s.current_document && s.current_document.ingestion_status === 'ingested');
  const traces = S.get().telemetry.filter((t) => t.retrieval_count > 0 || t.policy_outcome === 'allow');
  const scores = traces.map((t) => t.top_retrieval_score).filter((v) => v != null);
  body.innerHTML = `<div class="stackgap">
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Index</h2><p class="t-support">PostgreSQL + pgvector · embeddings: veye-hashing-256</p></div></div>
      <div class="card__body">
        <div class="metric-row metric-row--wrap">
          <div class="metric"><div class="metric__body"><span class="metric__label">Retrievable sources</span><span class="metric__value">${retrievable.length} / ${sources.length}</span></div></div>
          <div class="metric"><div class="metric__body"><span class="metric__label">Ingested documents</span><span class="metric__value">${ingested.length}</span></div></div>
          <div class="metric"><div class="metric__body"><span class="metric__label">Passages</span><span class="metric__value">${ingested.reduce((t, s) => t + s.current_document.chunk_count, 0)}</span></div></div>
          <div class="metric"><div class="metric__body"><span class="metric__label">Average top match</span><span class="metric__value">${scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) + '%' : '—'}</span></div></div>
          <div class="metric"><div class="metric__body"><span class="metric__label">Empty retrievals</span><span class="metric__value">${traces.filter((t) => t.retrieval_count === 0).length}</span></div></div>
        </div>
        <dl class="kv" style="margin-top:var(--s-5)"><dt>Sources by status</dt><dd>${counts(tally(sources.map((s) => s.status)))}</dd></dl>
      </div>
    </div>
    <form class="card" method="post" id="diagForm">
      <div class="card__head"><div><h2 class="card__title">Run a diagnostic query</h2><p class="t-support">Searches only Active, approved sources — the same path Sprout uses.</p></div></div>
      <div class="card__body row gap-3 wrap">
        <input class="input" style="flex:1 1 320px" placeholder="e.g. what does a lower Health Number mean" aria-label="Diagnostic query" id="diagQuery" value="${esc(lastQuery)}">
        <button class="btn btn--primary" type="submit" id="diagRun" ${lastQuery.trim() ? '' : 'disabled'}>Search the index</button>
      </div>
      ${hits ? `<div class="card__body card__body--flush">
        ${hits.length === 0 ? '<p class="empty-row">No approved passage matched.</p>' : `<div class="rows">
          ${hits.map((h) => `<div class="rowitem" style="grid-template-columns:minmax(0,1fr) auto">
            <div>
              <div class="rowitem__title">${esc(h.title)} <span class="t-support">v${h.source_version}${h.heading ? ' · ' + esc(h.heading) : ''}</span></div>
              <div class="rowitem__meta">${esc(h.excerpt)}${h.excerpt.length >= 280 ? '…' : ''}</div>
              <div class="rowitem__meta mono">source ${esc(h.source_id)} · chunk ${esc(h.chunk_id)}</div>
            </div>
            <span class="rowitem__side chip chip--lime">match ${Math.round(h.score * 100)}%</span>
          </div>`).join('')}
        </div>`}
      </div>` : ''}
    </form>
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Recent retrievals</h2></div></div>
      <div class="card__body card__body--flush">${traceTable(traces.slice(0, 50), 'Recent retrieval-backed turns')}</div>
    </div>
  </div>`;
  const input = body.querySelector('#diagQuery');
  const btn = body.querySelector('#diagRun');
  input.addEventListener('input', () => { lastQuery = input.value; btn.disabled = !input.value.trim(); });
  body.querySelector('#diagForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    H.busy(btn, 'Searching…', () => { hits = search(input.value.trim()); retrieval(outlet); }, 350);
  });
}

/* ------------------------------------------------------------ safety analytics */
function safety(outlet) {
  const body = frame(outlet, 'safety-analytics');
  const since = Date.now() - 30 * 864e5;
  const st = S.get();
  const memberMsgs = st.conversations.flatMap((c) => c.messages).filter((m) => m.role === 'member' && m.policy_decision && Date.parse(m.created_at) >= since);
  const sprout = st.conversations.flatMap((c) => c.messages).filter((m) => m.role === 'sprout' && Date.parse(m.created_at) >= since);
  const escalations = st.conversations.filter((c) => c.flagged).sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));
  body.innerHTML = `<div class="stackgap">
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Policy decisions</h2><p class="t-support">Policy version ${esc(st.companion.policy.version)}. Decisions are deterministic rules, never a model.</p></div></div>
      <div class="card__body">
        <dl class="kv">
          <dt>By outcome</dt><dd>${counts(tally(memberMsgs.map((m) => m.policy_decision.outcome)))}</dd>
          <dt>By category</dt><dd>${counts(tally(memberMsgs.map((m) => m.policy_decision.category)))}</dd>
          <dt>Output safety</dt><dd>${counts(tally(sprout.map((m) => m.safety_result)))}</dd>
        </dl>
      </div>
    </div>
    <div class="card">
      <div class="card__head"><div><h2 class="card__title">Handed to a person</h2></div></div>
      <div class="card__body card__body--flush">
        ${escalations.length === 0 ? '<p class="empty-row">No conversation has been handed to a person.</p>' : `<div class="table-wrap"><table class="table table--compact">
          <thead><tr><th>Member</th><th>Why</th><th>When</th><th>Status</th><th></th></tr></thead>
          <tbody>${escalations.map((c) => `<tr>
            <td>${esc(S.memberName(c.member_id))}</td>
            <td class="t-support">${esc(c.flag_reason || '')}</td>
            <td class="t-nowrap">${esc(H.fmtDate(c.last_message_at))}</td>
            <td>${c.reviewed_at ? H.chip('Reviewed', 'live') : H.chip('Needs review', 'attention')}</td>
            <td><a class="btn btn--secondary btn--sm" href="${R.href('/companion/conversations?conversation=' + c.id)}">Open</a></td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------- provider status */
const SECTIONS = [
  ['Authentication', 'Who someone is, and what they may do, are separate: Google Cloud Identity Platform is the selected production authentication, and every authorization decision — member profile, administrator access, portal isolation, session revocation — stays in the Veye API whichever provider is in use. The development provider holds password hashes here.',
    [['provider', 'development'], ['sessions', 'VEYE server-side, one HttpOnly cookie per portal'], ['authorization', 'VEYE (member_id, admin_access, portal isolation)'],
     ['production provider', 'Google Cloud Identity Platform'], ['identity verifier', 'not configured'], ['admin mfa required', 'yes'], ['admin accepted second factors', 'totp']]],
  ['Email', 'Which transport is actually in use is below: mode reads development while messages go to the Mailpit mailbox, and production once a real relay is configured. Google Workspace SMTP is the selected production transport. No password is shown here.',
    [['provider', 'local-smtp'], ['host', 'mail'], ['port', '1025'], ['sender', 'Veye <no-reply@veye.local>'], ['reply to', '—'], ['mode', 'development'],
     ['production transport', 'Google Workspace SMTP (smtp.gmail.com:587, STARTTLS)'], ['production ready', 'no'], ['reply to configured', 'no'], ['environment footer', 'marks the message as non-production']]],
  ['Language model', 'The Companion talks to the model only through the LLMProvider interface. Absence of a provider is reported, never worked around. Gemini is reached through the Developer API or through Vertex AI, whichever the setting says; one never stands in for the other.',
    [['provider', 'mock'], ['model', 'veye-mock-1'], ['configured', 'yes'], ['external', 'no']]],
  ['Embeddings', "What approved knowledge is searched with. Each provider keeps an index of its own: after a change the approved sources are written into the new one first (reindex-knowledge), and until they are, a search is refused rather than answered from part of them. Changing back is changing the setting back.",
    [['provider', 'hashing'], ['model', 'veye-hashing-256'], ['configured', 'yes'], ['external', 'no']]],
  ['Object store', 'The original source documents behind approved knowledge. Local files in development; Google Cloud Storage is the production target, in its own bucket rather than the one holding member photos. Not connected until that bucket exists.',
    [['provider', 'local-file'], ['root', '/app/var/knowledge-objects'], ['external', 'no'], ['production target', 'Google Cloud Storage']]],
  ['Telemetry', 'All records are masked before export. The database exporter feeds these screens.',
    [['exporters', 'database'], ['capture content', 'no'], ['environment', 'local-docker']]],
  ['Langfuse', 'Optional development observability. Keys are never displayed; only whether they are present.',
    [['status', 'disabled'], ['enabled', 'no'], ['base url', '—'], ['keys present', 'no']]],
  ['Database', 'PostgreSQL with the pgvector extension.',
    [['dialect', 'postgresql'], ['pgvector', '0.8.0']]],
];
function providers(outlet) {
  const body = frame(outlet, 'provider-status');
  body.innerHTML = `<div class="grid grid--2">
    ${SECTIONS.map(([title, note, values]) => `<div class="card">
      <div class="card__head"><div><h2 class="card__title">${esc(title)}</h2><p class="t-support">${esc(note)}</p></div></div>
      <div class="card__body"><dl class="kv">${values.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
    </div>`).join('')}
  </div>`;
}

/* ------------------------------------------------------------------- audit */
const AUDIT_PAGE = 100;
let auditPage = 1;
function audit(outlet) {
  const body = frame(outlet, 'audit');
  const all = S.get().audit;
  const total = all.length;
  const rows = all.slice((auditPage - 1) * AUDIT_PAGE, auditPage * AUDIT_PAGE);
  const from = total ? (auditPage - 1) * AUDIT_PAGE + 1 : 0;
  const to = from + rows.length - 1;
  const fmt = (v) => (Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '—' : String(v));
  body.innerHTML = `<div class="card"><div class="card__body card__body--flush">
    ${rows.length === 0 ? '<p class="empty-row">No administrator actions recorded yet.</p>' : `<div class="table-wrap"><table class="table table--compact">
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td class="t-nowrap">${esc(H.fmtDate(r.created_at))}</td>
        <td class="t-nowrap">${esc(r.actor_name)}</td>
        <td>${esc(r.action)}</td>
        <td class="mono">${esc(r.entity_type)}${r.entity_id ? ' ' + esc(String(r.entity_id).slice(0, 8)) + '…' : ''}</td>
        <td class="t-support">${esc(Object.entries(r.details || {}).map(([k, v]) => `${k}: ${fmt(v)}`).join(' · ') || '—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`}
    ${total > 0 ? `<div class="pager">
      <span class="pager__info" data-testid="audit-range">${total <= AUDIT_PAGE ? `All ${total} entries` : `Entries ${from}–${to} of ${total}, newest first`}</span>
      ${total > AUDIT_PAGE ? `<span class="row gap-2">
        <button class="btn btn--secondary btn--sm" type="button" id="newer" ${auditPage <= 1 ? 'disabled' : ''}>Newer</button>
        <button class="btn btn--secondary btn--sm" type="button" id="older" ${auditPage * AUDIT_PAGE >= total ? 'disabled' : ''}>Older</button>
      </span>` : ''}
    </div>` : ''}
  </div></div>`;
  const newer = body.querySelector('#newer');
  if (newer) newer.addEventListener('click', () => { auditPage -= 1; audit(outlet); });
  const older = body.querySelector('#older');
  if (older) older.addEventListener('click', () => { auditPage += 1; audit(outlet); });
}

function render(outlet, route) {
  const key = route.params.page;
  if (!PAGES[key]) { R.navigate('/companion/settings/advanced/ai-monitoring', { replace: true }); return; }
  windowDays = 30; hits = null; lastQuery = ''; auditPage = 1;
  ({ 'ai-monitoring': aiMonitoring, 'retrieval-diagnostics': retrieval, 'safety-analytics': safety, 'provider-status': providers, audit })[key](outlet);
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens['companion-advanced'] = { render };

})();
