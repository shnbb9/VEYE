/* ============================================================================
   Companion — Conversations · Knowledge Sources · Feedback · Settings
   ----------------------------------------------------------------------------
   The console's Companion area (platform/web app/admin/companion/**). Sprout
   is the companion members talk to inside Veye; it answers from approved Veye
   knowledge and short summaries of the member's own results.

   Reading a conversation changes nothing; marking it reviewed is recorded in
   the audit log. Knowledge sources are approved one at a time, and only an
   Active source with an ingested document is ever retrievable. Settings are
   the wording, quick prompts and topic rules Sprout's policy gate reads on
   every message.

   One deliberate difference from the console: the member panel beside a
   transcript shows the Health Number only when the member shares their
   health records (see the gap matrix — the console's endpoint does not apply
   the sharing rule there).
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const COMPANION_NAV = [
  { key: 'conversations', label: 'Conversations', route: '/companion/conversations' },
  { key: 'knowledge', label: 'Knowledge Sources', route: '/companion/knowledge-sources' },
  { key: 'feedback', label: 'Feedback', route: '/companion/feedback' },
  { key: 'settings', label: 'Settings', route: '/companion/settings' },
];
const MODES = { conversations: 'conversations', 'knowledge-sources': 'knowledge', feedback: 'feedback', settings: 'settings' };
const DEFAULT_DESC = "Sprout is the companion members talk to inside Veye. It answers from approved Veye knowledge and short summaries of the member's own results.";
const ADVANCED_NAV = [
  { key: 'ai-monitoring', label: 'AI Monitoring' }, { key: 'retrieval-diagnostics', label: 'Retrieval Diagnostics' },
  { key: 'safety-analytics', label: 'Safety Analytics' }, { key: 'provider-status', label: 'Provider Status' }, { key: 'audit', label: 'Audit' },
];

function frame(outlet, active, { desc, actions, count } = {}) {
  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Companion', desc: esc(desc || DEFAULT_DESC), crumbs: [{ label: 'Home', route: '/home' }, { label: 'Companion' }], actions })}
    ${H.subnav(COMPANION_NAV.map((n) => (n.key === 'conversations' ? { ...n, count } : n)), active)}
    <div id="cBody"></div>
  </div>`;
  return outlet.querySelector('#cBody');
}

function render(outlet, route) {
  const mode = MODES[route.params.mode || 'conversations'];
  if (!mode) {
    const body = frame(outlet, null);
    body.innerHTML = `<div class="card"><div class="card__body">${H.emptyState({ icon: 'sprout', title: 'Companion has no section by that name',
      msg: 'Conversations, Knowledge Sources, Feedback and Settings are the four.',
      action: `<a class="btn btn--primary" href="${R.href('/companion/conversations')}">Open Conversations</a>` })}</div></div>`;
    return;
  }
  ({ conversations, knowledge, feedback, settings })[mode](outlet, route);
}

/* ========================================================= CONVERSATIONS == */
const FILTERS = [['needs_review', 'Needs review'], ['reviewed', 'Reviewed'], ['all', 'All']];
let conv = { filter: 'needs_review', q: '', selected: null };

function conversationRows() {
  const st = S.get();
  const q = conv.q.trim().toLowerCase();
  return st.conversations
    .filter((c) => conv.filter === 'all' || (conv.filter === 'reviewed' ? !!c.reviewed_at : c.flagged && !c.reviewed_at))
    .filter((c) => {
      if (!q) return true;
      const m = S.member(c.member_id);
      return (m && (m.name + ' ' + m.email).toLowerCase().includes(q)) || c.messages.some((x) => x.content.toLowerCase().includes(q));
    })
    .sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));
}

function conversations(outlet, route) {
  const rows = conversationRows();
  if (!conv.selected || !rows.some((r) => r.id === conv.selected)) conv.selected = rows[0] ? rows[0].id : null;
  const needsReview = rows.filter((r) => r.flagged && !r.reviewed_at).length;
  const body = frame(outlet, 'conversations', { count: needsReview });
  const memberOf = (c) => S.member(c.member_id) || { name: 'Member', email: '' };

  body.innerHTML = `
    <div class="review2">
      <div class="card">
        <div class="findbar" style="padding:var(--s-4)">
          <div class="search" style="flex:1 1 100%;position:relative">
            <span class="search__icon">${icon('search', { size: 18 })}</span>
            <label class="sr-only" for="cvSearch">Search conversations</label>
            <input class="search__input" id="cvSearch" type="search" placeholder="Search members and messages" value="${esc(conv.q)}">
          </div>
          <div class="modeswitch" role="tablist" aria-label="Which conversations" style="width:100%;justify-content:space-between">
            ${FILTERS.map(([k, l]) => `<button class="modeswitch__btn" type="button" role="tab" aria-selected="${conv.filter === k}" data-filter="${k}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="flaglist">
          ${rows.length === 0 ? `<div style="padding:var(--s-6)">${H.emptyState({
            icon: conv.filter === 'needs_review' ? 'check-circle' : 'search',
            title: conv.filter === 'needs_review' ? 'Nothing waiting for review' : 'No conversations match',
            msg: conv.filter === 'needs_review' ? 'Every conversation handed to a person has been read.' : 'Try a shorter search, or switch the filter to All.' })}</div>` : ''}
          ${rows.map((c) => {
            const first = (c.messages.find((x) => x.role === 'member') || {}).content || '';
            return `<button class="flag${c.id === conv.selected ? ' is-active' : ''}" type="button" data-conv="${c.id}">
              <span class="flag__top">
                <span class="flag__who">${esc(memberOf(c).name)}</span>
                ${window.Veye.MC.priorityChip(c.priority)}
                ${c.flagged && !c.reviewed_at ? '<span class="chip chip--attention chip--sm">Needs review</span>'
                  : c.resolved_at ? '<span class="chip chip--live chip--sm">Resolved</span>'
                  : c.flagged ? '<span class="chip chip--info chip--sm">Reviewed, not resolved</span>'
                  : c.reviewed_at ? '<span class="chip chip--live chip--sm">Reviewed</span>' : '<span class="chip chip--sm">Normal</span>'}
              </span>
              <span class="flag__why">${esc(first.slice(0, 160) || '(no member message)')}</span>
              <span class="t-support" style="display:block;margin-top:4px">${esc(H.fmtDate(c.last_message_at))} · ${c.message_count} messages</span>
            </button>`;
          }).join('')}
        </div>
        <div class="card__foot"><span class="t-support">Reading a conversation changes nothing. Marking it reviewed is recorded in the audit log.</span></div>
      </div>
      <div class="card" id="cvDetail"></div>
    </div>`;

  body.querySelector('#cvSearch').addEventListener('input', (e) => { conv.q = e.target.value; conversations(outlet, route); focusEnd(outlet, '#cvSearch'); });
  body.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { conv.filter = b.dataset.filter; conversations(outlet, route); }));
  body.querySelectorAll('[data-conv]').forEach((b) => b.addEventListener('click', () => { conv.selected = b.dataset.conv; conversations(outlet, route); }));
  detail(body.querySelector('#cvDetail'), outlet, route);
}

function focusEnd(outlet, sel) {
  const el = outlet.querySelector(sel);
  if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; }
}

function detail(host, outlet, route) {
  const c = S.get().conversations.find((x) => x.id === conv.selected);
  if (!c) { host.innerHTML = `<div class="card__body">${H.emptyState({ icon: 'messages', title: 'Nothing selected', msg: 'Pick a conversation on the left.' })}</div>`; return; }
  const m = S.member(c.member_id);
  const name = m ? m.name : 'Member';
  const latest = m && m.records.health_number[0];
  const hnText = !m ? 'Not completed' : !S.shares(m) ? 'Not shared' : latest ? `${Number(latest.displayed_score).toFixed(1)} — ${latest.status}` : 'Not completed';

  host.innerHTML = `
    <div class="card__head">
      <div><h2 class="card__title">${esc(name)}</h2><p class="t-support">${esc(m ? m.email : '')} · started ${esc(H.fmtDate(c.started_at))}</p></div>
      <div class="row gap-2">
        ${c.resolved_at ? '<span class="chip chip--live">Resolved</span>' : c.reviewed_at ? `<span class="chip chip--${c.flagged ? 'info' : 'live'}">${c.flagged ? 'Reviewed, not resolved' : 'Reviewed'}</span>` : ''}
        ${m && m.isSynthetic ? '<span class="chip chip--lime">Synthetic</span>' : ''}
      </div>
    </div>
    <div class="panel" style="margin:var(--s-4) var(--s-5) 0">
      <dl class="kv">
        <dt>Health Number</dt><dd>${esc(hnText)}</dd>
        <dt>Member since</dt><dd>${esc(H.fmtDate(m ? m.joinedAt : c.started_at))}</dd>
        <dt>Email</dt><dd>${m && m.emailVerified ? 'Verified' : 'Not verified'}</dd>
      </dl>
    </div>
    <div class="convo convo--wide">
      ${c.messages.map((x) => `<div class="msg msg--${x.role === 'member' ? 'member' : 'companion'}">
        <div class="msg__meta">${x.role === 'member' ? esc(name) : 'Sprout'}${x.outcome && x.outcome !== 'answered' ? ' · ' + H.chip(x.outcome) : ''}${x.policy_decision && x.role === 'member' ? ` · policy: ${esc(x.policy_decision.outcome)}${x.policy_decision.category ? ` (${esc(x.policy_decision.category)})` : ''}` : ''}</div>
        <div class="msg__bubble">${esc(x.content)}</div>
        ${x.role === 'sprout' ? `<div class="msg__sources">${x.sources.length ? `Sources · ${x.sources.length}: ${x.sources.map((s) => esc(s.title) + ' v' + s.source_version).join(', ')} · ` : ''}${x.provider ? `${esc(x.provider)}${x.model ? ' · ' + esc(x.model) : ''} · ${x.latency_ms || 0} ms · safety ${esc(x.safety_result || '—')}` : 'no model call'}${x.feedback ? ` · feedback: ${esc(x.feedback.rating.replace('_', ' '))}${x.feedback.reason ? ` (${esc(x.feedback.reason)})` : ''}` : ''}</div>` : ''}
      </div>`).join('')}
    </div>
    ${c.flagged ? `<div class="card__body conv-actions" data-testid="conversation-actions">
      ${window.Veye.MC.prioritySelect('cvImportance', c.priority)}
      ${c.resolved_at ? '<button class="btn btn--ghost btn--sm" type="button" id="cvReopen">Reopen</button>' : '<button class="btn btn--secondary btn--sm" type="button" id="cvResolve">Mark resolved</button>'}
      <span class="t-support" style="flex:1 1 220px">Reviewed means somebody read it. It does not answer the member: the team replies outside Sprout, and resolving says nothing is left to do.</span>
    </div>` : ''}
    ${c.flagged && !c.reviewed_at ? `<div class="held held--pinned">
      <span class="held__label">${icon('lock', { size: 14 })} Handed to a person</span>
      <div class="held__text">${esc(c.flag_reason || '')}</div>
      <p class="t-support" style="margin-top:12px">Sprout sent the member its escalation wording and did not generate an answer. The Veye team follows up outside the Companion.</p>
      <div class="row gap-3 wrap" style="margin-top:16px"><button class="btn btn--primary btn--sm" type="button" id="markReviewed">Mark reviewed</button></div>
    </div>` : `<div class="card__foot">
      <span class="t-support">${c.reviewed_at ? `Reviewed by ${esc(c.reviewed_by)} on ${esc(H.fmtDate(c.reviewed_at))}.` : 'Nothing was handed to a person here. This is an ordinary conversation.'}</span>
      ${!c.reviewed_at ? '<button class="btn btn--secondary btn--sm" type="button" id="markReviewed">Mark reviewed</button>' : ''}
    </div>`}`;

  const change = (patch, action, details) => {
    S.set({ conversations: S.get().conversations.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }, { silent: true });
    S.audit(action, 'companion_conversation', c.id, details || {});
    conv.filter = 'all'; conv.selected = c.id; conversations(outlet, route);
  };
  const importance = host.querySelector('#cvImportance');
  if (importance) importance.addEventListener('change', () => change({ priority: importance.value || null }, 'conversation.priority', { from: c.priority, to: importance.value || null }));
  const resolve = host.querySelector('#cvResolve');
  if (resolve) resolve.addEventListener('click', () => change({ resolved_at: S.now(), resolved_by: S.me().name, reviewed_at: c.reviewed_at || S.now(), reviewed_by: c.reviewed_by || S.me().name }, 'conversation.resolved'));
  const reopen = host.querySelector('#cvReopen');
  if (reopen) reopen.addEventListener('click', () => change({ resolved_at: null, resolved_by: null }, 'conversation.reopened'));
  const btn = host.querySelector('#markReviewed');
  if (btn) btn.addEventListener('click', () => H.busy(btn, 'Mark reviewed', () => {
    S.set({ conversations: S.get().conversations.map((x) => (x.id === c.id ? { ...x, reviewed_at: S.now(), reviewed_by: S.me().name } : x)) });
    S.audit('conversation.reviewed', 'companion_conversation', c.id, { note: null });
    conversations(outlet, route);
  }, 300));
}

/* ============================================================ KNOWLEDGE == */
const SCOPES = () => S.get().companion.retrieval_scope_options;
let kn = { editing: null, notice: '', error: '' };

function knowledge(outlet, route) {
  const body = frame(outlet, 'knowledge', { actions: `<button class="btn btn--primary" type="button" id="addSource">${icon('plus', { size: 18 })} Add source</button>` });
  const sources = S.get().knowledgeSources;
  const storage = sources[0] ? sources[0].storage : 'local-file';
  const e = kn.editing;

  body.innerHTML = `
    ${H.errorbar(kn.error)}
    ${kn.notice ? `<div class="notice notice--quiet" style="margin-bottom:var(--s-4)">${icon('info', { size: 18 })}<div>${esc(kn.notice)}</div></div>` : ''}
    ${e ? `<form class="card" style="margin-bottom:var(--s-5)" method="post" id="ksForm">
      <div class="card__head"><div><h2 class="card__title">${e.id ? 'View / edit source' : 'Add source'}</h2>
        <p class="t-support">Metadata is saved to PostgreSQL. Attaching a document stores the file in the ${esc(storage)} object store and ingests it for retrieval.</p></div></div>
      <div class="card__body inline-form">
        <div class="field"><label for="ks-title">Source title</label><input class="input" id="ks-title" required value="${esc(e.input.title)}"></div>
        <div class="field"><label for="ks-type">Source type</label>
          <select class="select" id="ks-type">${window.Veye.SEED_CONTENT.KNOWLEDGE_TYPES.map((t) => `<option ${t === e.input.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label for="ks-scope">Scope</label>
          <select class="select" id="ks-scope">${Object.entries(SCOPES()).map(([k, l]) => `<option value="${k}" ${k === e.input.scope_key ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label for="ks-ref">Filename or URL label (optional)</label><input class="input" id="ks-ref" value="${esc(e.input.reference_label || '')}"></div>
        <div class="field"><label for="ks-date">Effective date (optional)</label><input class="input" id="ks-date" type="date" value="${esc(e.input.effective_date || '')}"></div>
        <div class="field field--wide"><label for="ks-desc">Short description</label><textarea class="textarea" id="ks-desc" rows="3">${esc(e.input.description)}</textarea></div>
      </div>
      <div class="card__foot">
        <button class="btn btn--secondary" type="button" id="ksCancel">Cancel</button>
        <button class="btn btn--primary" type="submit" id="ksSave">${e.id ? 'Save source' : 'Add source'}</button>
      </div>
    </form>` : ''}
    <section class="card">
      <div class="card__head"><div><h2 class="card__title">Knowledge Sources</h2>
        <p class="t-support">Approved sources Sprout may draw on. Only an Active source with an ingested document is retrievable; Inactive and Archived sources never are.</p></div></div>
      <div class="card__body card__body--flush">
        <div class="rows">
          ${sources.map((s) => {
            const doc = s.current_document;
            const canActivate = s.status === 'Active' || (doc && doc.ingestion_status === 'ingested');
            return `<div class="rowitem" style="grid-template-columns:44px minmax(0,1fr) auto">
              <span class="rowitem__icon${s.status === 'Active' ? '' : ' rowitem__icon--off'}">${icon('file-text', { size: 18 })}</span>
              <div>
                <div class="rowitem__title">${esc(s.title)} <span class="t-support">v${s.version}</span></div>
                <div class="rowitem__meta">${esc(s.type)} · ${esc(SCOPES()[s.scope_key] || s.scope_key)}${s.reference_label ? ' · ' + esc(s.reference_label) : ''}</div>
                <div class="rowitem__meta">
                  ${doc ? `Document: ${esc(doc.filename)} · ${H.chip(doc.ingestion_status)}${doc.ingestion_status === 'ingested' ? ` · ${doc.chunk_count} passages` : doc.ingestion_error ? ' · ' + esc(doc.ingestion_error) : ''}${doc.ingestion_status === 'ingested' && doc.extraction_note ? ' · ' + esc(doc.extraction_note) : ''}` : 'No document attached'}
                  · Updated ${esc(H.fmtDate(s.updated_at))}${s.approved_at ? ` · Approved by ${esc(s.approved_by)} on ${esc(H.fmtDate(s.approved_at))}` : ''}
                </div>
                ${s.status !== 'Archived' ? `<label class="filelabel t-support" style="margin-top:6px">
                  Attach document (.docx, .pdf, .md or .txt)
                  <input type="file" data-attach="${s.id}" accept=".docx,.pdf,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,text/markdown,text/plain">
                </label>` : ''}
              </div>
              <div class="rowitem__side row gap-2 wrap">
                ${H.chip(s.status)}
                ${s.status !== 'Archived' ? `<button class="btn btn--secondary btn--sm" type="button" data-edit="${s.id}">View / edit</button>` : ''}
                ${s.status === 'Archived'
                  ? `<button class="btn btn--ghost btn--sm" type="button" data-act="restore" data-id="${s.id}">Restore</button>`
                  : `<button class="btn btn--ghost btn--sm" type="button" data-act="${s.status === 'Active' ? 'deactivate' : 'activate'}" data-id="${s.id}" ${canActivate ? '' : 'disabled title="Attach an ingested document first"'}>${s.status === 'Active' ? 'Deactivate' : 'Activate'}</button>
                     <button class="btn btn--ghost btn--sm" type="button" data-act="archive" data-id="${s.id}">Archive</button>`}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="card__foot"><span class="t-support">Archiving keeps the source record, its documents and its history. Nothing is permanently deleted from this screen. Storage: ${esc(storage)} (production target Google Cloud Storage, not connected).</span></div>
    </section>`;

  const again = () => knowledge(outlet, route);
  outlet.querySelector('#addSource').addEventListener('click', () => {
    kn.editing = { id: null, input: { title: '', type: 'VEYE educational document', scope_key: 'help', description: '', reference_label: '', effective_date: null } };
    again();
  });
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const s = sources.find((x) => x.id === b.dataset.edit);
    kn.editing = { id: s.id, input: { title: s.title, type: s.type, scope_key: s.scope_key, description: s.description, reference_label: s.reference_label || '', effective_date: s.effective_date } };
    again();
  }));
  const form = body.querySelector('#ksForm');
  if (form) {
    body.querySelector('#ksCancel').addEventListener('click', () => { kn.editing = null; again(); });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const input = {
        title: body.querySelector('#ks-title').value.trim(), type: body.querySelector('#ks-type').value, scope_key: body.querySelector('#ks-scope').value,
        description: body.querySelector('#ks-desc').value, reference_label: body.querySelector('#ks-ref').value.trim() || null,
        effective_date: body.querySelector('#ks-date').value || null,
      };
      if (!input.title) { kn.error = 'Give the source a title.'; again(); return; }
      H.busy(body.querySelector('#ksSave'), 'Saving…', () => {
        const at = S.now();
        if (e.id) {
          S.set({ knowledgeSources: S.get().knowledgeSources.map((s) => (s.id === e.id ? { ...s, ...input, updated_at: at } : s)) });
          S.audit('knowledge_source.updated', 'knowledge_source', e.id, { title: input.title });
          kn.notice = 'Source saved.';
        } else {
          const id = S.newId();
          S.set({ knowledgeSources: [...S.get().knowledgeSources, { id, ...input, status: 'Draft', version: 1, approved_by: null, approved_at: null,
            is_synthetic: true, created_at: at, updated_at: at, archived_at: null, current_document: null, documents: [], storage, passages: [] }] });
          S.audit('knowledge_source.created', 'knowledge_source', id, { title: input.title });
          kn.notice = 'Source added as Draft. Attach a document, then activate it.';
        }
        kn.editing = null; kn.error = '';
        again();
      });
    });
  }

  body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const s = S.get().knowledgeSources.find((x) => x.id === b.dataset.id);
    const action = b.dataset.act;
    if (action === 'archive') {
      const r = await UI.confirm({ title: 'Archive this source?', message: `Archive "${esc(s.title)}"? It is retained as an archived record and is never permanently deleted.`, confirmLabel: 'Archive' });
      if (!r.ok) return;
    }
    const status = { activate: 'Active', deactivate: 'Inactive', archive: 'Archived', restore: 'Inactive' }[action];
    const at = S.now();
    const me = S.me().name;
    let saved;
    S.set({ knowledgeSources: S.get().knowledgeSources.map((x) => (x.id === s.id ? (saved = { ...x, status, updated_at: at,
      approved_by: action === 'activate' ? me : x.approved_by, approved_at: action === 'activate' ? at : x.approved_at,
      archived_at: action === 'archive' ? at : action === 'restore' ? null : x.archived_at }) : x)) });
    S.audit(`knowledge_source.${action}d`, 'knowledge_source', s.id, { title: s.title });
    kn.notice = `${saved.title}: ${saved.status}${action === 'activate' ? ` — approved by ${saved.approved_by}` : ''}.`;
    kn.error = '';
    again();
  }));

  body.querySelectorAll('[data-attach]').forEach((input) => input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    attach(input.dataset.attach, file, again);
  }));
}

/** Ingest a chosen document in the browser: .md and .txt are read and split
 *  into passages the diagnostic search can find; .docx and .pdf are accepted
 *  but their text is not read here. Nothing is uploaded anywhere. */
function attach(id, file, again) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const fail = (text) => { kn.error = text; kn.notice = ''; again(); };
  if (!['docx', 'pdf', 'md', 'markdown', 'txt'].includes(ext)) return fail('Only .docx, .pdf, .md and .txt documents can be attached.');
  if (file.size === 0) return fail('The uploaded file is empty.');
  if (file.size > 5 * 1024 * 1024) return fail('Documents larger than 5 MB are not accepted in the local environment.');
  const finish = (passages, note) => {
    const at = S.now();
    let saved;
    S.set({ knowledgeSources: S.get().knowledgeSources.map((s) => {
      if (s.id !== id) return s;
      const version = s.current_document ? s.version + 1 : s.version;
      const doc = { id: S.newId(), source_version: version, filename: file.name, content_type: file.type || 'text/plain', byte_size: file.size,
        sha256: '', is_current: true, ingestion_status: 'ingested', ingestion_error: null, extraction_note: note,
        chunk_count: passages.length || Math.max(1, Math.ceil(file.size / 1400)), ingested_at: at, created_at: at };
      saved = { ...s, version, current_document: doc, documents: [...s.documents.map((d) => ({ ...d, is_current: false })), doc],
        status: s.status === 'Active' ? 'Inactive' : s.status, updated_at: at,
        passages: passages.map(([heading, text], i) => ({ chunk_id: S.newId(), document_id: doc.id, heading, text, i })) };
      return saved;
    }) });
    S.audit('knowledge_document.attached', 'knowledge_source', id, { filename: file.name, version: saved.version, chunks: saved.current_document.chunk_count });
    kn.notice = `${file.name}: ingested into ${saved.current_document.chunk_count} passages (version ${saved.version}). Activate the source to make it retrievable.`;
    kn.error = '';
    again();
  };
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      let heading = null;
      const passages = [];
      text.split(/\n\s*\n/).forEach((block) => {
        const b = block.trim();
        if (!b) return;
        const h = b.match(/^#{1,6}\s+(.*)$/);
        if (h && !b.includes('\n')) { heading = h[1].trim(); return; }
        passages.push([heading, b.replace(/^#{1,6}\s+/gm, '').slice(0, 900)]);
      });
      if (!passages.length) return fail('The document contains no readable text.');
      finish(passages, null);
    };
    reader.readAsText(file);
  } else {
    finish([], 'This prototype reads .md and .txt files only; this file’s passages are not searchable here.');
  }
}

/* ============================================================= FEEDBACK == */
let fbFilter = 'unreviewed';

function feedback(outlet, route) {
  const body = frame(outlet, 'feedback', { desc: 'Helpful / not helpful responses members leave on Sprout replies. Reading changes nothing; marking reviewed is recorded in the audit log.' });
  const rows = S.get().feedback
    .filter((f) => fbFilter === 'all' || (fbFilter === 'reviewed' ? !!f.reviewed_at : !f.reviewed_at))
    .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
  body.innerHTML = `
    <div class="card">
      <div class="card__head">
        <div><h2 class="card__title">Member feedback</h2></div>
        <div class="modeswitch" role="tablist" aria-label="Which feedback">
          ${['unreviewed', 'reviewed', 'all'].map((k) => `<button class="modeswitch__btn" type="button" role="tab" aria-selected="${fbFilter === k}" data-filter="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
        </div>
      </div>
      <div class="card__body card__body--flush">
        ${rows.length === 0 ? `<div style="padding:var(--s-6)">${H.emptyState({ icon: 'thumbs', title: 'No feedback here',
          msg: fbFilter === 'unreviewed' ? 'Every response has been read.' : 'Members have not left feedback yet.' })}</div>` : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Member</th><th>Rating</th><th>Reason</th><th>Sprout said</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${rows.map((f) => `<tr>
              <td>${esc(S.memberName(f.member_id))}</td>
              <td>${H.chip(f.rating)}</td>
              <td>${esc(f.reason || '—')}${f.comment ? `<div class="t-support">“${esc(f.comment)}”</div>` : ''}</td>
              <td class="t-support">${esc(f.reply_excerpt)}</td>
              <td class="t-nowrap">${esc(H.fmtDate(f.submitted_at))}</td>
              <td>${f.reviewed_at ? `<span class="t-support">Reviewed by ${esc(f.reviewed_by)}</span>` : H.chip('Unreviewed', 'attention')}</td>
              <td class="t-nowrap">
                <a class="btn btn--secondary btn--sm" href="${R.href('/companion/conversations?conversation=' + f.conversation_id)}">Open</a>
                ${!f.reviewed_at ? `<button class="btn btn--secondary btn--sm" type="button" data-review="${f.id}">Mark reviewed</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
    </div>`;
  body.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { fbFilter = b.dataset.filter; feedback(outlet, route); }));
  body.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', () => {
    b.disabled = true;
    S.set({ feedback: S.get().feedback.map((f) => (f.id === b.dataset.review ? { ...f, reviewed_at: S.now(), reviewed_by: S.me().name } : f)) });
    S.audit('feedback.reviewed', 'companion_feedback', b.dataset.review, {});
    feedback(outlet, route);
  }));
}

/* ============================================================= SETTINGS == */
let draft = null;
let setNotice = '';

function settings(outlet, route) {
  if (!draft) draft = JSON.parse(JSON.stringify(S.get().companion));
  const saved = S.get().companion;
  const body = frame(outlet, 'settings', { actions: '<button class="btn btn--primary" type="button" id="saveSettings">Save changes</button>' });
  const text = (key, label, hint, rows = 3) => `<div class="field">
      <label for="c-${key}">${esc(label)}</label>
      ${rows === 1 ? `<input class="input" id="c-${key}" data-text="${key}" value="${esc(draft[key])}">`
        : `<textarea class="textarea" id="c-${key}" rows="${rows}" data-text="${key}">${esc(draft[key])}</textarea>`}
      <span class="t-support">${esc(hint)}</span>
    </div>`;

  body.innerHTML = `
    ${setNotice ? `<div class="notice notice--quiet" style="margin-bottom:var(--s-4)">${icon('info', { size: 18 })}<div>${esc(setNotice)}</div></div>` : ''}
    <div class="hgrid">
      <div class="stack gap-5">
        <div class="card">
          <div class="card__head">
            <div><h2 class="card__title">Is Companion on?</h2><p class="t-support">When it is off, members see the rest of their dashboard as normal and Sprout declines to answer.</p></div>
            <label class="switch"><input type="checkbox" id="cEnabled" ${draft.enabled ? 'checked' : ''}><span class="switch__track"></span><span class="check__text" id="cEnabledText">${draft.enabled ? 'On for everyone' : 'Off'}</span></label>
          </div>
        </div>
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">What Companion says</h2></div></div>
          <div class="card__body stack gap-5">
            ${text('name', 'Companion name', 'Shown in the member chat header.', 1)}
            ${text('welcome', 'Opening message (first visit)', 'The first thing a member reads when they open Companion.')}
            ${text('returning_welcome', 'Opening message (returning)', 'Shown when the member has talked to Sprout before.')}
            ${text('safe_response', 'When a question needs a person', 'Used for anything about an amount, a symptom or a medicine.')}
            ${text('fallback', 'When the question is off-topic', 'Used when the question has nothing to do with Veye.')}
            ${text('escalation_response', 'When the conversation is handed to a person', 'Sent instead of an answer; the conversation is flagged for review and the team is notified.')}
          </div>
        </div>
        <div class="card">
          <div class="card__head">
            <div><h2 class="card__title">Quick prompts</h2><p class="t-support">The suggestions a member can tap instead of typing.</p></div>
            <button class="btn btn--secondary btn--sm" type="button" id="addPrompt">${icon('plus', { size: 16 })} Add a prompt</button>
          </div>
          <div class="card__body card__body--flush">
            <div class="rows">
              ${draft.quick_prompts.map((p, i) => `<div class="rowitem" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) auto">
                <input class="input input--sm" aria-label="What the member taps" data-prompt-label="${i}" value="${esc(p.label)}">
                <input class="input input--sm" aria-label="What it asks Companion" placeholder="What it asks Companion" data-prompt-text="${i}" value="${esc(p.prompt)}">
                <div class="rowitem__side row gap-2">
                  <label class="switch"><input type="checkbox" data-prompt-active="${i}" ${p.active ? 'checked' : ''}><span class="switch__track"></span><span class="sr-only">Show to members</span></label>
                  <button class="btn btn--ghost btn--sm" type="button" data-prompt-remove="${i}">Remove</button>
                </div>
              </div>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="stack gap-5">
        <div class="card">
          <div class="card__head"><div><h2 class="card__title">What Companion may talk about</h2>
            <p class="t-support">Anything outside this list gets the off-topic wording. Keywords decide the topic; edit them as comma-separated words or phrases.</p></div></div>
          <div class="card__body card__body--flush">
            <div class="rows">
              ${draft.policy.topics.map((t, i) => `<div class="rowitem" style="grid-template-columns:44px minmax(0,1fr) auto">
                <span class="rowitem__icon${t.allowed ? '' : ' rowitem__icon--warn'}">${icon(t.allowed ? 'check-circle' : 'lock', { size: 18 })}</span>
                <div>
                  <div class="rowitem__title">${esc(t.label)}</div>
                  <textarea class="textarea textarea--rows" rows="4" aria-label="Keywords for ${esc(t.label)}" data-topic-keywords="${i}">${esc(t.keywords.join(', '))}</textarea>
                  <div class="rowitem__meta">Retrieval: ${esc(t.retrieval_scopes.map((s) => draft.retrieval_scope_options[s] || s).join(', ') || 'none')} · Member data: ${esc(t.member_data_scopes.join(', ') || 'none')}</div>
                </div>
                <div class="rowitem__side"><label class="switch"><input type="checkbox" data-topic-allowed="${i}" ${t.allowed ? 'checked' : ''}><span class="switch__track"></span><span class="sr-only">Allow ${esc(t.label)}</span></label></div>
              </div>`).join('')}
              ${draft.policy.prohibited.map((r, i) => `<div class="rowitem" style="grid-template-columns:44px minmax(0,1fr) auto">
                <span class="rowitem__icon rowitem__icon--warn">${icon('lock', { size: 18 })}</span>
                <div>
                  <div class="rowitem__title">${esc(r.label)}</div>
                  <textarea class="textarea textarea--rows" rows="4" aria-label="Keywords for ${esc(r.label)}" data-rule-keywords="${i}">${esc(r.keywords.join(', '))}</textarea>
                  ${r.why ? `<div class="rowitem__meta">${esc(r.why)}</div>` : ''}
                </div>
                <div class="rowitem__side"><span class="chip ${r.action === 'escalate' ? 'chip--error' : 'chip--attention'}">${r.action === 'escalate' ? 'Handed to a person' : 'Safe response'}</span></div>
              </div>`).join('')}
            </div>
          </div>
          <div class="card__foot" style="display:block">
            <div class="notice notice--quiet">${icon('info', { size: 18 })}<div>Companion does not diagnose, treat or prevent any condition. Questions about symptoms, medicines or amounts are always handed to a person or answered with the safe response.</div></div>
          </div>
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Member data Sprout may use</h2><p class="t-support">Short structured summaries only — never the raw record, never contact details.</p></div></div>
          <div class="card__body stack gap-3">
            ${draft.member_data_scope_options.map((scope) => `<label class="switch">
              <input type="checkbox" data-scope="${scope}" ${draft.policy.member_data_scopes_enabled.includes(scope) ? 'checked' : ''}>
              <span class="switch__track"></span><span class="check__text">${esc(scope.replace(/_/g, ' '))}</span>
            </label>`).join('')}
            <p class="t-support">Mood and food-pattern summaries are built from the member’s own entries as counts and trends — never a note or a meal description. A member who has not shared their health records gets a Sprout that answers without them.</p>
          </div>
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Guided Experiences</h2><p class="t-support">The step-by-step guides Sprout walks members through — Cara’s First-Time User and Progress Tracker decision trees, published as numbered versions.</p></div></div>
          <div class="card__body card__body--flush">
            <div class="rows">
              <a class="rowitem" href="${R.href('/companion/settings/guided-experiences')}" style="grid-template-columns:minmax(0,1fr) auto;text-decoration:none">
                <div><div class="rowitem__title">First-Time User · Progress Tracker Guide</div><div class="rowitem__meta">Status, active version, member sessions, read-only preview, activate / deactivate.</div></div>
                <span class="rowitem__side">${icon('chevron-right', { size: 18 })}</span>
              </a>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card__head"><div><h2 class="card__title">Advanced</h2><p class="t-support">Operational monitoring for the development environment.</p></div></div>
          <div class="card__body card__body--flush">
            <div class="rows">
              ${ADVANCED_NAV.map((a) => `<a class="rowitem" href="${R.href('/companion/settings/advanced/' + a.key)}" style="grid-template-columns:minmax(0,1fr) auto;text-decoration:none">
                <div class="rowitem__title">${esc(a.label)}</div><span class="rowitem__side">${icon('chevron-right', { size: 18 })}</span>
              </a>`).join('')}
            </div>
          </div>
          <div class="card__foot"><span class="t-support">Policy ${esc(saved.policy.version)} · last saved ${esc(H.fmtDate(S.get().companionUpdatedAt))}${S.get().companionUpdatedBy ? ' by ' + esc(S.get().companionUpdatedBy) : ''}</span></div>
        </div>
      </div>
    </div>`;

  const again = () => settings(outlet, route);
  const split = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  body.querySelector('#cEnabled').addEventListener('change', (e) => { draft.enabled = e.target.checked; body.querySelector('#cEnabledText').textContent = draft.enabled ? 'On for everyone' : 'Off'; });
  body.querySelectorAll('[data-text]').forEach((el) => el.addEventListener('input', () => { draft[el.dataset.text] = el.value; }));
  body.querySelectorAll('[data-prompt-label]').forEach((el) => el.addEventListener('input', () => { draft.quick_prompts[+el.dataset.promptLabel].label = el.value; }));
  body.querySelectorAll('[data-prompt-text]').forEach((el) => el.addEventListener('input', () => { draft.quick_prompts[+el.dataset.promptText].prompt = el.value; }));
  body.querySelectorAll('[data-prompt-active]').forEach((el) => el.addEventListener('change', () => { draft.quick_prompts[+el.dataset.promptActive].active = el.checked; }));
  body.querySelectorAll('[data-prompt-remove]').forEach((el) => el.addEventListener('click', () => { draft.quick_prompts.splice(+el.dataset.promptRemove, 1); again(); }));
  body.querySelector('#addPrompt').addEventListener('click', () => {
    draft.quick_prompts.push({ id: 'QP-' + Date.now().toString(36), label: 'New prompt', prompt: '', active: true });
    again();
  });
  body.querySelectorAll('[data-topic-keywords]').forEach((el) => el.addEventListener('input', () => { draft.policy.topics[+el.dataset.topicKeywords].keywords = split(el.value); }));
  body.querySelectorAll('[data-topic-allowed]').forEach((el) => el.addEventListener('change', () => { draft.policy.topics[+el.dataset.topicAllowed].allowed = el.checked; again(); }));
  body.querySelectorAll('[data-rule-keywords]').forEach((el) => el.addEventListener('input', () => { draft.policy.prohibited[+el.dataset.ruleKeywords].keywords = split(el.value); }));
  body.querySelectorAll('[data-scope]').forEach((el) => el.addEventListener('change', () => {
    const set = new Set(draft.policy.member_data_scopes_enabled);
    if (el.checked) set.add(el.dataset.scope); else set.delete(el.dataset.scope);
    draft.policy.member_data_scopes_enabled = draft.member_data_scope_options.filter((s) => set.has(s));
  }));
  outlet.querySelector('#saveSettings').addEventListener('click', (e) => {
    H.busy(e.currentTarget, 'Saving…', () => {
      S.set({ companion: JSON.parse(JSON.stringify(draft)), companionUpdatedAt: S.now(), companionUpdatedBy: S.me().name });
      S.audit('settings.updated', 'companion_settings', '1', { enabled: draft.enabled, policy_version: draft.policy.version });
      setNotice = 'Companion settings saved. Members see the new wording and topic rules on their next message.';
      again();
    });
  });
}

window.Veye.COMPANION_NAV = COMPANION_NAV;
window.Veye.ADVANCED_NAV = ADVANCED_NAV;
window.Veye.screens = window.Veye.screens || {};
/* Arriving at a Companion screen starts as the console's does: the filter and
   notices of a previous visit are not carried over, and a ?conversation=
   link opens that transcript under "All". */
window.Veye.screens.companion = { render: (outlet, route) => {
  const pre = route.query.conversation || null;
  conv = { filter: pre ? 'all' : 'needs_review', q: '', selected: pre };
  kn = { editing: null, notice: '', error: '' };
  fbFilter = 'unreviewed';
  draft = null; setNotice = '';
  render(outlet, route);
} };

})();
