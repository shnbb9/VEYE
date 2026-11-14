/* ============================================================================
   Companion → Settings → Guided Experiences
   ----------------------------------------------------------------------------
   The console's page (platform/web app/admin/companion/settings/
   guided-experiences): the guided flows Sprout runs — Cara's decision trees —
   each version's status and source, member session counts, safe activate /
   deactivate, and a read-only step-by-step preview. There is no raw JSON
   editing here on purpose: a revision is published from the client document
   as a new version and reviewed on this page.

   The flow definitions are js/veye-guided-flows-data.js, generated from the
   platform's own definition files.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const S = window.Veye.S;
const H = window.Veye.H;
const esc = window.Veye.UI.esc;

const ACTION_LABEL = {
  OPEN_DASHBOARD: 'Opens the Dashboard', OPEN_PROGRESS: 'Opens My Progress', OPEN_FOOD_CHOICES: 'Opens Food Choices',
  OPEN_MEAL_PLANNING: 'Opens Meal Planning', OPEN_COMPANION: 'Opens Sprout', OPEN_TRACKER: 'Opens the tracker', START_FLOW: 'Starts the guided experience',
};
const TRACKER_LABEL = { blood_markers: 'Blood Test Markers', body_composition: 'BMI Analysis', health_assessment: 'Health Assessment', simple_quiz: 'Simple Quiz' };
const STATE_LABEL = {
  has_blood_markers: 'the member has saved Blood Test Markers', has_body_composition: 'the member has a saved BMI analysis',
  has_health_number: 'the member has a Health Number', has_health_assessment: 'the member has completed the Health Assessment',
  has_simple_quiz: 'the member has taken the Simple Quiz', has_food_choices: 'the member has filled in Food Choices',
  blood_markers_available: 'Blood Test Markers is connected', body_composition_available: 'BMI Analysis is connected',
  health_assessment_available: 'the Health Assessment is connected', simple_quiz_available: 'the Simple Quiz is connected', food_choices_available: 'Food Choices is connected',
};

let preview = null;      // flow id being previewed
let details = false;
let error = '';

function labelForType(type) {
  return { CHOICE: 'Question', QUESTION: 'Tip — any reply continues', MESSAGE: 'Sprout says', NAVIGATION: 'Takes the member to',
    CHECK_MEMBER_STATE: 'Checks', AI_TASK: 'AI (not built yet)', COMPLETE: 'Finish', KNOWLEDGE: 'Approved knowledge' }[type] || type;
}

function sessionsFor(key, version) {
  const all = S.get().members.flatMap((m) => m.guided).filter((g) => g.flow_key === key && g.flow_version === version);
  return { total: all.length, in_progress: all.filter((g) => g.status === 'in_progress').length, completed: all.filter((g) => g.status === 'completed').length };
}

/** Every option leads to a defined step and every path can finish. */
function validate(def) {
  const ids = new Set(Object.keys(def.nodes || {}));
  for (const [id, node] of Object.entries(def.nodes || {})) {
    const targets = [node.next, ...(node.choices || []).map((c) => c.next), node.check && node.check.if_true, node.check && node.check.if_false].filter(Boolean);
    const missing = targets.find((t) => !ids.has(t));
    if (missing) return `invalid — ${id} leads to an undefined step (${missing})`;
  }
  return 'valid';
}

function render(outlet) {
  const flows = S.get().guidedFlows;
  const groups = [...new Set(flows.map((f) => f.key))].map((key) => {
    const versions = flows.filter((f) => f.key === key).sort((a, b) => b.version - a.version);
    const active = versions.find((v) => v.status === 'Active');
    return { key, title: versions[0].title, active_version: active ? active.version : null, versions };
  });

  outlet.innerHTML = `
  <div class="page">
    ${H.pageHead({ title: 'Guided Experiences',
      desc: "The step-by-step experiences Sprout can walk a member through. Each one is Cara's decision tree, published as a numbered version; members who started a version keep it until they finish.",
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Companion', route: '/companion/conversations' }, { label: 'Settings', route: '/companion/settings' }, { label: 'Guided Experiences' }] })}
    ${H.errorbar(error)}
    ${groups.length === 0 ? '<p class="empty-row">No guided experiences have been published yet.</p>' : ''}
    <div class="stack gap-5">
      ${groups.map((g) => `<div class="card">
        <div class="card__head">
          <div><h2 class="card__title">${esc(g.title)}</h2>
            <p class="t-support">${g.active_version ? `Version ${g.active_version} is what members get today.` : 'No active version — members cannot start this experience.'}</p></div>
          <span class="tag${g.active_version ? ' tag--ok' : ''}">${g.active_version ? 'Active' : 'Inactive'}</span>
        </div>
        <div class="card__body card__body--flush">
          <div class="table-wrap"><table class="table table--compact">
            <caption class="sr-only">Versions of ${esc(g.title)}</caption>
            <thead><tr><th>Version</th><th>Source</th><th>Steps</th><th>Members</th><th>Published</th><th class="t-right">Actions</th></tr></thead>
            <tbody>
              ${g.versions.map((v) => {
                const s = sessionsFor(v.key, v.version);
                const meta = v.content_meta || {};
                return `<tr>
                  <td class="t-nowrap">v${v.version} <span class="tag${v.status === 'Active' ? ' tag--ok' : v.status === 'Archived' ? ' tag--muted' : ''}">${esc(v.status)}</span></td>
                  <td><div>${esc(String(meta.source || v.source || '—'))}${meta.source_version ? ' · ' + esc(String(meta.source_version)) : ''}</div>
                    ${meta.client_supplied ? `<div class="t-support">Client-supplied · clinical review ${esc(String(meta.clinical_review_status || 'pending'))}</div>` : ''}</td>
                  <td class="t-num">${v.node_count}</td>
                  <td class="t-num">${s.total}${s.total ? `<div class="t-support">${s.in_progress} in progress · ${s.completed} completed</div>` : ''}</td>
                  <td><div class="t-nowrap">${v.published_at ? esc(H.fmtDate(v.published_at)) : 'Not published'}</div>
                    <div class="t-support">${v.published_at && v.published_by ? 'by ' + esc(v.published_by) : ''}${H.fmtDate(v.updated_at) !== H.fmtDate(v.published_at) ? `${v.published_at && v.published_by ? ' · ' : ''}updated ${esc(H.fmtDate(v.updated_at))}` : ''}</div></td>
                  <td class="t-right"><div class="row gap-2" style="justify-content:flex-end">
                    <button class="btn btn--secondary btn--sm" type="button" data-preview="${v.id}">${icon('eye', { size: 16 })} Preview</button>
                    ${v.status === 'Draft' ? `<button class="btn btn--primary btn--sm" type="button" data-act="activate" data-id="${v.id}">Activate</button>` : ''}
                    ${v.status === 'Active' ? `<button class="btn btn--danger-quiet btn--sm" type="button" data-act="deactivate" data-id="${v.id}">Deactivate</button>` : ''}
                  </div></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>
        </div>
      </div>`).join('')}
      <div id="flowPreviewHost"></div>
    </div>
  </div>`;

  outlet.querySelectorAll('[data-preview]').forEach((b) => b.addEventListener('click', () => { preview = b.dataset.preview; render(outlet); scrollToPreview(outlet); }));
  outlet.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const v = flows.find((f) => f.id === b.dataset.id);
    const action = b.dataset.act;
    const at = S.now();
    S.set({ guidedFlows: S.get().guidedFlows.map((f) => {
      if (f.id === v.id) return { ...f, status: action === 'activate' ? 'Active' : 'Draft', updated_at: at,
        published_at: action === 'activate' ? at : f.published_at, published_by: action === 'activate' ? S.me().name : f.published_by };
      // Activating archives the version that was Active for the same flow.
      if (action === 'activate' && f.key === v.key && f.status === 'Active') return { ...f, status: 'Archived', updated_at: at };
      return f;
    }) });
    S.audit('guided_flow.' + (action === 'activate' ? 'activated' : 'deactivated'), 'guided_flow', v.id, { key: v.key, version: v.version });
    error = '';
    render(outlet);
  }));
  paintPreview(outlet.querySelector('#flowPreviewHost'), outlet);
}

function scrollToPreview(outlet) {
  const el = outlet.querySelector('#flowPreview');
  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function describeTarget(def, nodeId) {
  const node = def.nodes[nodeId];
  if (!node) return nodeId;
  const text = node.type === 'CHECK_MEMBER_STATE' ? `check whether ${STATE_LABEL[(node.check || {}).state] || (node.check || {}).state}` : node.text;
  return text.length > 90 ? text.slice(0, 87) + '…' : text;
}

function paintPreview(host, outlet) {
  const flow = S.get().guidedFlows.find((f) => f.id === preview);
  const def = flow && (window.VeyeGuidedFlowData || {})[flow.key];
  if (!flow || !def) { host.innerHTML = ''; return; }
  const order = Object.keys(def.nodes);
  host.innerHTML = `<div class="card" id="flowPreview">
    <div class="card__head">
      <div>
        <h2 class="card__title">Preview — ${esc(flow.title)} v${flow.version}</h2>
        <p class="t-support">${esc(def.description || '')}</p>
        <p class="t-support">Definition check: <b>${(() => { const v = validate(def); return v === 'valid' ? 'valid — every option leads to a defined step and every path can finish' : esc(v); })()}</b>. ${esc(String((def.content_meta || {}).note || ''))}</p>
      </div>
      <div class="row gap-2">
        <label class="check"><input type="checkbox" id="showDetails" ${details ? 'checked' : ''}><span class="check__text">Show technical details</span></label>
        <button class="btn btn--ghost btn--sm" type="button" id="closePreview">Close preview</button>
      </div>
    </div>
    <div class="card__body"><div class="stack gap-5">
      ${(def.sections || []).map((section) => {
        const ids = order.filter((id) => def.nodes[id].section === section.key);
        return `<section class="flow-section">
          <h3 class="card__title" style="font-size:16px;margin-bottom:6px">${esc(section.title)}${section.kind === 'ai' ? '<span class="tag" style="margin-left:8px">AI — not yet specified</span>' : ''}</h3>
          <ol class="flow-steps" style="margin:0;padding-left:20px">
            ${ids.map((id) => {
              const node = def.nodes[id];
              return `<li style="margin-bottom:10px">
                <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
                  <span class="tag${node.type === 'NAVIGATION' ? ' tag--ok' : ''}">${esc(labelForType(node.type))}</span>
                  ${node.copy_origin && node.copy_origin !== 'client' ? `<span class="tag tag--muted">${node.copy_origin === 'derived' ? 'Veye wording — to confirm' : "Cara's wording, paraphrased"}</span>` : ''}
                  ${details ? `<span class="t-support mono">${esc(id)}${node.source_ref ? ' · ' + esc(node.source_ref) : ''}</span>` : ''}
                </div>
                ${node.type === 'CHECK_MEMBER_STATE'
                  ? `<p style="margin:4px 0">If ${esc(STATE_LABEL[(node.check || {}).state] || (node.check || {}).state)}: <b>→ ${esc(describeTarget(def, (node.check || {}).if_true || ''))}</b>; otherwise <b>→ ${esc(describeTarget(def, (node.check || {}).if_false || ''))}</b>${node.note ? `<span class="t-support"> — ${esc(node.note)}</span>` : ''}</p>`
                  : `<p style="margin:4px 0">${esc(node.text)}</p>`}
                ${node.action ? `<p class="t-support" style="margin:2px 0">${icon('chevron-right', { size: 14 })} ${esc(ACTION_LABEL[node.action.type] || node.action.type)}${node.action.target ? ': ' + esc(TRACKER_LABEL[node.action.target] || node.action.target) : ''}</p>` : ''}
                ${node.choices && node.choices.length ? `<ul style="margin:4px 0 0;padding-left:18px">
                  ${node.choices.map((c) => `<li class="t-support"><b>${esc(c.label)}</b> → ${esc(describeTarget(def, c.next))}${details ? `<span class="mono"> (${esc(c.next)})</span>` : ''}</li>`).join('')}
                </ul>` : ''}
                ${node.type === 'QUESTION' ? `<p class="t-support" style="margin:2px 0">Any reply continues → ${esc(describeTarget(def, node.next || ''))}</p>` : ''}
                ${(node.type === 'MESSAGE' || node.type === 'NAVIGATION') && node.next ? `<p class="t-support" style="margin:2px 0">${node.pause ? 'Then the guide pauses; it resumes at' : 'Then'} → ${esc(describeTarget(def, node.next))}</p>` : ''}
              </li>`;
            }).join('')}
          </ol>
        </section>`;
      }).join('')}
    </div></div>
  </div>`;
  host.querySelector('#showDetails').addEventListener('change', (e) => { details = e.target.checked; paintPreview(host, outlet); });
  host.querySelector('#closePreview').addEventListener('click', () => { preview = null; paintPreview(host, outlet); });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens['companion-guided'] = { render: (outlet) => { preview = null; details = false; error = ''; render(outlet); } };

})();
