/* ============================================================================
   Requests & Inbox
   ----------------------------------------------------------------------------
   The console's inbox (platform/web app/admin/requests/page.tsx): Contact Us
   messages, Help questions and Join Beta submissions — a list with Open / All /
   Resolved, the selected request on the right, and three plain status moves.

   A reply is a record of what was sent: the administrator's words go out
   unaltered, the address is captured on the reply itself, and a send that the
   mail server refused is kept and shown as NOT delivered — never assumed to
   have arrived. Replying never changes the request's status; the internal
   note is never emailed.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const H = window.Veye.H;
const esc = window.Veye.UI.esc;

const VIEWS = [['open', 'Open'], ['all', 'All'], ['resolved', 'Resolved']];
const KINDS = { contact_us: 'Contact Us', help_question: 'Help question', join_beta: 'Join Beta' };
const STATUS_LABELS = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };
const STATUS_TONE = { new: 'attention', in_progress: 'info', resolved: 'live' };

let view = { view: 'open', kind: '', q: '', selected: null, pinned: null, reply: '', sent: '', error: '', note: null };

function list() {
  const q = view.q.trim().toLowerCase();
  const rows = S.get().requests
    .filter((r) => view.view === 'all' || (view.view === 'resolved' ? r.status === 'resolved' : r.status !== 'resolved'))
    .filter((r) => !view.kind || r.kind === view.kind)
    .filter((r) => !q || `${r.name} ${r.email} ${r.subject} ${r.message}`.toLowerCase().includes(q))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  // The request just handled stays on screen even when the filter no longer includes it.
  if (view.pinned && !rows.some((r) => r.id === view.pinned)) {
    const pinned = S.get().requests.find((r) => r.id === view.pinned);
    if (pinned) rows.unshift(pinned);
  }
  return rows;
}

function render(outlet) {
  const all = S.get().requests;
  const rows = list();
  if (!view.selected || !rows.some((r) => r.id === view.selected)) { view.selected = rows[0] ? rows[0].id : null; view.note = null; }
  const item = all.find((r) => r.id === view.selected) || null;
  if (item && view.note === null) view.note = item.resolution_note || '';

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Requests & Inbox', desc: 'One simple place for Contact Us messages, Help questions and Join Beta submissions.',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Requests & Inbox' }] })}
    ${H.errorbar(view.error)}
    <section class="lead">
      <div><h2>Member requests</h2><p>Start with the newest messages, answer from the request itself, mark what you are handling and resolve when done. Every reply you send is emailed to the person and kept here.</p></div>
      <div class="minirow" style="min-width:330px" data-testid="requests-counts">
        <div class="mini"><span class="mini__n">${all.filter((r) => r.status === 'new').length}</span><span class="mini__l">New</span></div>
        <div class="mini"><span class="mini__n">${all.filter((r) => r.status === 'in_progress').length}</span><span class="mini__l">In progress</span></div>
        <div class="mini"><span class="mini__n">${all.filter((r) => r.status === 'resolved').length}</span><span class="mini__l">Resolved</span></div>
      </div>
    </section>

    <div class="review2">
      <div class="card">
        <div class="findbar" style="padding:var(--s-4);flex-wrap:wrap;gap:10px">
          <div class="modeswitch" role="tablist" aria-label="Which requests">
            ${VIEWS.map(([k, l]) => `<button class="modeswitch__btn" type="button" role="tab" aria-selected="${view.view === k}" data-view="${k}">${l}</button>`).join('')}
          </div>
          <label class="sr-only" for="rqKind">Kind</label>
          <select class="select" id="rqKind" style="max-width:170px">
            <option value="">All kinds</option>
            ${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${view.kind === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <div class="search" style="flex:1 1 160px;position:relative">
            <span class="search__icon">${icon('search', { size: 18 })}</span>
            <label class="sr-only" for="rqSearch">Search requests</label>
            <input class="search__input" id="rqSearch" type="search" placeholder="Name, email or words" value="${esc(view.q)}">
          </div>
        </div>
        <div class="flaglist" id="rqList" data-testid="requests-list">
          ${rows.length === 0 ? `<div class="card__body">${H.emptyState({ icon: 'inbox', title: 'No requests here', msg: 'Choose another filter, or wait for the next message.' })}</div>` : ''}
          ${rows.map((r) => `<button class="flag${r.id === view.selected ? ' is-active' : ''}" type="button" data-rq="${r.id}">
            <span class="flag__top">
              <span class="flag__who">${esc(r.name || 'Visitor')}</span>
              ${r.status === 'new' ? '<span class="chip chip--attention chip--sm">New</span>' : ''}
              ${r.replies.length > 0 ? '<span class="chip chip--live chip--sm">Answered</span>' : ''}
            </span>
            <span class="flag__why">${esc(r.subject || r.message.slice(0, 80))}</span>
            <span class="t-support">${esc(KINDS[r.kind])} · ${esc(H.fmtDate(r.created_at))}</span>
          </button>`).join('')}
        </div>
      </div>

      <div class="card" id="rqDetail" data-testid="request-detail">
        ${!item ? `<div class="card__body">${H.emptyState({ icon: 'inbox', title: 'Nothing selected', msg: 'Pick a request on the left.' })}</div>` : `
        <div class="card__head">
          <div><h2 class="card__title">${esc(item.subject || KINDS[item.kind])}</h2><p class="t-support">${esc(item.name || 'Visitor')}${item.email ? ' · ' + esc(item.email) : ''} · ${esc(H.fmtDate(item.created_at))}</p></div>
          ${H.chip(STATUS_LABELS[item.status], STATUS_TONE[item.status])}
        </div>
        <div class="card__body stack gap-5">
          <div><div class="t-eyebrow">Source</div><p>${esc(KINDS[item.kind])} · ${item.source === 'member' ? 'signed-in member' : 'public website'}${item.page ? ' · ' + esc(item.page) : ''}</p></div>
          <div><div class="t-eyebrow">Message</div><p style="white-space:pre-wrap">${item.message ? esc(item.message) : '<span class="t-support">No message — a Join Beta request carries only the member’s identity.</span>'}</p></div>
          ${item.member_id && S.member(item.member_id) ? `<div><div class="t-eyebrow">Member</div><p><a href="${R.href('/members/' + item.member_id)}">Open Member 360</a></p></div>` : ''}
          ${item.handled_by || item.handled_at ? `<div><div class="t-eyebrow">Handling</div><p class="t-support">${esc(item.handled_by || '—')} · ${esc(H.fmtDate(item.handled_at))}</p></div>` : ''}
          ${item.replies.length ? `<div data-testid="request-replies">
            <div class="t-eyebrow">${item.replies.length === 1 ? 'Reply sent' : `${item.replies.length} replies sent`}</div>
            <div class="replies">
              ${item.replies.map((r) => `<div class="reply${r.delivery_status === 'failed' ? ' reply--failed' : ''}" data-reply="${r.id}">
                <div class="reply__meta">${esc(r.sent_by_name)} · ${esc(H.fmtDate(r.created_at))} · to ${esc(r.to_email)}${r.delivery_status === 'failed' ? ' ' + H.chip('Not delivered', 'error') : ''}</div>
                <p class="reply__body">${esc(r.body)}</p>
                ${r.delivery_status === 'failed' ? `<p class="reply__warn">This one never left the server${r.delivery_detail ? ': ' + esc(r.delivery_detail) : ''}. Nobody received it — send it again.</p>` : ''}
              </div>`).join('')}
            </div>
          </div>` : ''}
          <div>
            <label class="t-eyebrow" for="rqReply">Reply${item.email ? ' to ' + esc(item.email) : ''}</label>
            ${item.email ? `<textarea class="textarea" id="rqReply" rows="4" placeholder="Write the answer in your own words. It is sent exactly as typed." data-testid="request-reply">${esc(view.reply)}</textarea>
              <p class="t-support" style="margin-top:6px">Sent as written, over Veye’s wording, and kept on this request. The person is asked to write back to the
                support address in Settings, not to this message. Sending does not change the status.</p>`
              : '<p class="t-support">Nobody left an email address on this request, so there is nothing to reply to. Record what you know in the internal note below.</p>'}
            ${view.sent ? `<p class="t-support" role="status" data-testid="request-reply-result">${esc(view.sent)}</p>` : ''}
          </div>
          <div>
            <label class="t-eyebrow" for="rqNote">Internal note</label>
            <textarea class="textarea" id="rqNote" rows="3" placeholder="Anything the next person needs to know. The member never sees this." data-testid="request-note">${esc(view.note || '')}</textarea>
          </div>
          <div class="notice notice--quiet">${icon('info', { size: 18 })}<div>The reply above is emailed to the person; the internal note is not — it stays in the console for whoever opens this request next.</div></div>
        </div>
        <div class="card__foot">
          ${item.email ? `<button class="btn btn--primary btn--sm" type="button" id="sendReply" data-testid="request-send-reply" ${view.reply.trim().length < 2 ? 'disabled' : ''}>Send reply</button>` : ''}
          ${item.status !== 'in_progress' && item.status !== 'resolved' ? '<button class="btn btn--secondary btn--sm" type="button" data-move="in_progress" data-testid="request-progress">Mark in progress</button>' : ''}
          ${item.status !== 'resolved' ? '<button class="btn btn--secondary btn--sm" type="button" data-move="resolved" data-testid="request-resolve">Resolve</button>' : ''}
          ${item.status === 'resolved' ? '<button class="btn btn--secondary btn--sm" type="button" data-move="new" data-testid="request-reopen">Reopen</button>' : ''}
          ${item.status === 'in_progress' ? '<button class="btn btn--ghost btn--sm" type="button" data-move="in_progress">Save note</button>' : ''}
        </div>`}
      </div>
    </div>
  </div>`;

  const reset = () => { view.pinned = null; view.selected = null; view.note = null; view.reply = ''; view.sent = ''; };
  outlet.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { view.view = b.dataset.view; reset(); render(outlet); }));
  outlet.querySelector('#rqKind').addEventListener('change', (e) => { view.kind = e.target.value; reset(); render(outlet); });
  outlet.querySelector('#rqSearch').addEventListener('input', (e) => {
    view.q = e.target.value; reset(); render(outlet);
    const el = outlet.querySelector('#rqSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  });
  outlet.querySelectorAll('[data-rq]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.rq === view.selected) return;
    view.selected = b.dataset.rq; view.pinned = null; view.note = null; view.reply = ''; view.sent = ''; view.error = '';
    render(outlet);
  }));
  if (!item) return;

  const replyBox = outlet.querySelector('#rqReply');
  const sendBtn = outlet.querySelector('#sendReply');
  if (replyBox) replyBox.addEventListener('input', () => {
    view.reply = replyBox.value; view.sent = '';
    const result = outlet.querySelector('[data-testid="request-reply-result"]');
    if (result) result.remove();
    if (sendBtn) sendBtn.disabled = replyBox.value.trim().length < 2;
  });
  outlet.querySelector('#rqNote').addEventListener('input', (e) => { view.note = e.target.value; });

  if (sendBtn) sendBtn.addEventListener('click', () => {
    const body = view.reply.trim();
    if (body.length < 2) { view.error = 'Write a reply before sending it.'; render(outlet); return; }
    H.busy(sendBtn, 'Sending…', () => {
      const result = S.deliver(item.email);
      const at = S.now();
      const reply = { id: S.newId(), body, to_email: item.email, sent_by_name: S.me().name,
        delivery_status: result.status === 'sent' ? 'sent' : 'failed', delivery_detail: result.detail, created_at: at };
      S.set({ requests: S.get().requests.map((r) => (r.id === item.id ? { ...r, replies: [...r.replies, reply], updated_at: at } : r)) });
      S.audit('requests.replied', 'member_request', item.id, { kind: item.kind, delivery: reply.delivery_status });
      view.reply = ''; view.error = ''; view.pinned = item.id;
      view.sent = reply.delivery_status === 'failed'
        ? `That reply could not be delivered to ${reply.to_email}. It is kept below so you can try again.`
        : `Sent to ${reply.to_email}.`;
      render(outlet);
    });
  });

  outlet.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
    const status = b.dataset.move;
    const note = view.note || '';
    outlet.querySelectorAll('[data-move]').forEach((x) => { x.disabled = true; });
    setTimeout(() => {
      const at = S.now();
      S.set({ requests: S.get().requests.map((r) => (r.id === item.id
        ? { ...r, status, resolution_note: note, handled_by: S.me().name, handled_at: at, updated_at: at } : r)) });
      S.audit('requests.' + status, 'member_request', item.id, { kind: item.kind, status });
      view.pinned = item.id; view.sent = ''; view.error = '';
      render(outlet);
    }, 300);
  }));
}

window.Veye.screens = window.Veye.screens || {};
/* A link can carry ?view= and ?id= (Member 360 → Requests → Open). */
window.Veye.screens.requests = { render: (outlet, route) => {
  const v = VIEWS.some(([k]) => k === route.query.view) ? route.query.view : 'open';
  view = { view: v, kind: '', q: '', selected: route.query.id || null, pinned: route.query.id || null, reply: '', sent: '', error: '', note: null };
  render(outlet);
} };

})();
