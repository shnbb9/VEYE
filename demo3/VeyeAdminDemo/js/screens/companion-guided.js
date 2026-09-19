/* ============================================================================
   Companion → Settings → Guided Experiences (prototype, 19 Sep 2026)
   ----------------------------------------------------------------------------
   Cara's two decision trees as versioned guided experiences Sprout runs:
   First-Time User (Intro Decision Tree 260627) and Progress Tracker Guide
   (Progress Trackers Decision Tree 260326). The definitions are the same
   generated data the consumer prototype and the platform use
   (js/veye-guided-flows-data.js), so the readable preview shows exactly
   what Sprout says.

   Per flow: status, version, source, clinical review status, step count,
   sessions in this browser (the consumer prototype stores its sessions on the
   same origin), Preview (readable, nested by section — no JSON), Activate /
   Deactivate (prototype state in this browser) and View version.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const STATUS_KEY = 'veye_admin_guided_status';
const SESSION_KEY = 'veye_guided_flows';
const ORDER = ['first_time_user', 'progress_tracker_guide'];
const TYPE_LABEL = {
  MESSAGE: 'Sprout says', QUESTION: 'Sprout asks (any reply continues)', CHOICE: 'Sprout asks', CHECK_MEMBER_STATE: 'Checks the member’s records',
  NAVIGATION: 'Takes the member to', KNOWLEDGE: 'Answers from approved knowledge', AI_TASK: 'AI step (not yet specified)', COMPLETE: 'End of the guide',
};
const TRACKER_LABEL = { blood_markers: 'Blood Test Markers', body_composition: 'BMI Analysis', health_assessment: 'Health Assessment', simple_quiz: 'Simple Quiz', food_choices: 'Food Choices' };
const ACTION_LABEL = { OPEN_DASHBOARD: 'the Dashboard', OPEN_PROGRESS: 'My Progress', OPEN_FOOD_CHOICES: 'Food Choices', OPEN_MEAL_PLANNING: 'Meal Planning', OPEN_COMPANION: 'the Companion' };
const STATE_LABEL = {
  has_blood_markers: 'saved Blood Test Markers', has_body_composition: 'a saved BMI analysis', has_health_number: 'a Health Number',
  has_health_assessment: 'a saved Health Assessment', has_simple_quiz: 'a saved Simple Quiz', has_food_choices: 'saved Food Choices',
  blood_markers_available: 'Blood Test Markers is available', body_composition_available: 'BMI Analysis is available',
  health_assessment_available: 'the Health Assessment is available', simple_quiz_available: 'the Simple Quiz is available', food_choices_available: 'Food Choices is available',
};

function definitions() { return window.VeyeGuidedFlowData || {}; }
function statuses() { try { return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}') || {}; } catch (e) { return {}; } }
function setStatus(key, status) { const s = statuses(); s[key] = status; try { localStorage.setItem(STATUS_KEY, JSON.stringify(s)); } catch (e) {} }
function statusOf(key) { return statuses()[key] || 'Active'; }
function sessions() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') || {}; } catch (e) { return {}; } }

function sourceLine(def) {
  const m = def.content_meta || {};
  return [m.source, m.source_version ? 'v' + m.source_version : null, m.source_date].filter(Boolean).join(' · ');
}

function describeTarget(def, nodeId) {
  const node = def.nodes[nodeId];
  if (!node) return nodeId;
  if (node.type === 'NAVIGATION') return 'opens ' + actionText(node.action);
  if (node.type === 'CHECK_MEMBER_STATE') return 'checks the member’s records';
  if (node.type === 'COMPLETE') return 'ends the guide';
  const text = String(node.text || '').trim();
  return text ? '“' + (text.length > 90 ? text.slice(0, 88) + '…' : text) + '”' : nodeId;
}

function actionText(action) {
  if (!action) return '';
  if (action.type === 'OPEN_TRACKER') return TRACKER_LABEL[action.target] || action.target;
  if (action.type === 'START_FLOW') return 'the ' + ((definitions()[action.target] || {}).title || action.target) + ' guide';
  return ACTION_LABEL[action.type] || action.type;
}

function nodeRow(def, id, node) {
  let detail = '';
  if (node.type === 'CHOICE' || node.type === 'AI_TASK') {
    detail = `<ul class="gx-options">${(node.choices || []).map((c) => `<li><b>${esc(c.label)}</b> <span class="t-muted">→ ${esc(describeTarget(def, c.next))}</span></li>`).join('')}</ul>`;
  } else if (node.type === 'CHECK_MEMBER_STATE') {
    detail = `<p class="t-support">If the member has ${esc(STATE_LABEL[node.check.state] || node.check.state)} → ${esc(describeTarget(def, node.check.if_true))}; otherwise → ${esc(describeTarget(def, node.check.if_false))}.</p>`;
  } else if (node.type === 'NAVIGATION') {
    detail = `<p class="t-support">Opens ${esc(actionText(node.action))}${node.next ? ', then ' + esc(describeTarget(def, node.next)) : ''}.</p>`;
  } else if (node.type === 'QUESTION') {
    detail = `<p class="t-support">Reply button: “${esc(node.answer_label || 'Continue')}”${node.next ? ' → ' + esc(describeTarget(def, node.next)) : ''}.</p>`;
  } else if (node.type === 'MESSAGE' && node.pause) {
    detail = `<p class="t-support">Pauses the guide here; resuming continues at ${esc(describeTarget(def, node.next))}.</p>`;
  }
  const derived = node.copy_origin && node.copy_origin !== 'client' ? `<span class="tag" title="Not Cara’s words — connective wording to confirm">Veye wording — to confirm</span>` : '';
  return `<div class="gx-node">
    <div class="gx-node__head"><span class="t-eyebrow">${esc(TYPE_LABEL[node.type] || node.type)}</span>${derived}<span class="mono t-muted gx-id">${esc(id)}</span></div>
    ${node.text ? `<p class="gx-text">${esc(node.text)}</p>` : ''}
    ${detail}
  </div>`;
}

function previewHtml(def) {
  const sections = def.sections || [];
  const bySection = {};
  Object.keys(def.nodes).forEach((id) => { const s = def.nodes[id].section || 'other'; (bySection[s] = bySection[s] || []).push(id); });
  const order = sections.map((s) => s.key).concat(Object.keys(bySection).filter((k) => !sections.some((s) => s.key === k)));
  return `<div class="stack gap-5">
    <div class="notice notice--quiet">${icon('info', { size: 18 })}<div>Read-only. Cara’s lines appear exactly as written; connective lines Veye added are tagged <b>Veye wording — to confirm</b>. Nothing here is a raw definition editor.</div></div>
    ${order.map((key) => {
      const section = sections.find((s) => s.key === key) || { title: key };
      return `<div class="card"><div class="card__head"><div><h3 class="card__title" style="font-size:16px">${esc(section.title)}${section.kind === 'ai' ? ' <span class="tag">AI — not yet specified</span>' : ''}</h3></div></div>
        <div class="card__body stack gap-4">${(bySection[key] || []).map((id) => nodeRow(def, id, def.nodes[id])).join('')}</div></div>`;
    }).join('')}
  </div>`;
}

function render(host) {
  const defs = definitions();
  const sess = sessions();
  const keys = ORDER.filter((k) => defs[k]).concat(Object.keys(defs).filter((k) => ORDER.indexOf(k) < 0));
  const dot = (s) => `<span class="gx-dot gx-dot--${s.toLowerCase()}" aria-hidden="true"></span>`;

  host.innerHTML = `
    <div class="stack gap-5" id="guidedExperiences">
      <div class="notice notice--quiet">${icon('sprout', { size: 18 })}
        <div><b>Guided experiences</b> are Cara’s decision trees run step by step by Sprout: deterministic questions, Yes/No choices, navigation to the trackers, and a pause/resume that keeps the member’s place. The wording comes from the client documents; each published version is kept, and a member who started on a version stays on it.</div></div>
      ${keys.map((key) => {
        const def = defs[key];
        const status = statusOf(key);
        const s = sess[key] || null;
        const nodes = Object.keys(def.nodes).length;
        return `<div class="card" data-flow="${esc(key)}">
          <div class="card__head">
            <div><h2 class="card__title">${esc(def.title)}</h2>
              <p class="t-support">${esc(def.description || '')}</p></div>
            <div class="row gap-2 wrap">${H.chip(status)}<span class="tag">v${def.version}</span></div>
          </div>
          <div class="card__body card__body--flush">
            <div class="table-wrap"><table class="table table--compact">
              <caption class="sr-only">Versions of ${esc(def.title)}</caption>
              <thead><tr><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col">Clinical review</th><th scope="col">Steps</th><th scope="col">Member sessions (this browser)</th><th scope="col">Updated</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
              <tbody><tr>
                <td class="t-num">v${def.version}</td>
                <td>${dot(status)} ${esc(status)}</td>
                <td>${esc(sourceLine(def))}</td>
                <td>${esc((def.content_meta || {}).clinical_review_status || 'pending')}</td>
                <td class="t-num">${nodes}</td>
                <td>${s ? `1 · ${esc(String(s.status).replace('_', ' '))}${s.current_node ? ' at <span class="mono">' + esc(s.current_node) + '</span>' : ''}` : '<span class="t-muted">none yet</span>'}</td>
                <td>${esc((def.content_meta || {}).source_date || '—')}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn--secondary btn--sm" data-preview="${esc(key)}">${icon('eye', { size: 16 })} Preview</button>
                  <button class="btn btn--ghost btn--sm" data-version="${esc(key)}">View version</button>
                  ${status === 'Active'
                    ? `<button class="btn btn--ghost btn--sm" data-toggle="${esc(key)}">Deactivate</button>`
                    : `<button class="btn btn--primary btn--sm" data-toggle="${esc(key)}">Activate</button>`}
                </td>
              </tr></tbody>
            </table></div>
          </div>
          <div class="card__foot"><span class="t-support">${status === 'Active' ? 'Members can start this guide. Deactivating stops new starts; anyone already in it continues.' : 'Members cannot start this guide. Anyone already in it continues on their version.'} Prototype: this switch is saved in this browser only.</span></div>
        </div>`;
      }).join('')}
      <div class="notice notice--quiet">${icon('lock', { size: 18 })}<div>Not here: a drag-and-drop editor or raw definition editing. A new version is published from a revised client document.</div></div>
    </div>`;

  host.querySelectorAll('[data-preview]').forEach((b) => b.addEventListener('click', () => {
    const def = defs[b.dataset.preview];
    UI.drawer({ eyebrow: 'Guided experience · preview', title: `${def.title} v${def.version}`,
      desc: `${sourceLine(def)} · clinical review ${(def.content_meta || {}).clinical_review_status || 'pending'}`,
      body: previewHtml(def) });
  }));
  host.querySelectorAll('[data-version]').forEach((b) => b.addEventListener('click', () => {
    const def = defs[b.dataset.version];
    const m = def.content_meta || {};
    UI.drawer({ eyebrow: 'Guided experience · version', title: `${def.title} v${def.version}`,
      body: `<dl class="kv">
        <dt>Key</dt><dd class="mono">${esc(def.key)}</dd>
        <dt>Version</dt><dd>v${def.version} · ${esc(statusOf(def.key))}</dd>
        <dt>Source</dt><dd>${esc(m.source || '—')}${m.source_file ? '<br><span class="mono t-muted">' + esc(m.source_file) + '</span>' : ''}</dd>
        <dt>Source version</dt><dd>${esc(m.source_version || '—')} · ${esc(m.source_date || '—')}</dd>
        <dt>Client supplied</dt><dd>${m.client_supplied ? 'Yes' : 'No'}</dd>
        <dt>Clinical review</dt><dd>${esc(m.clinical_review_status || 'pending')}</dd>
        <dt>Steps</dt><dd>${Object.keys(def.nodes).length} · start at <span class="mono">${esc(def.start)}</span></dd>
        <dt>Sections</dt><dd>${(def.sections || []).map((s) => esc(s.title)).join(' · ')}</dd>
      </dl>` });
  }));
  host.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.toggle;
    const next = statusOf(key) === 'Active' ? 'Inactive' : 'Active';
    UI.confirm({
      title: next === 'Active' ? 'Activate this guide?' : 'Deactivate this guide?',
      message: next === 'Active' ? 'Members will be able to start it from the Companion and the dashboard.' : 'New starts stop. Members already in the guide continue on their version.',
      reversible: 'You can switch it back at any time.',
      confirmLabel: next === 'Active' ? 'Activate' : 'Deactivate',
    }).then((r) => {
      if (!r.ok) return;
      setStatus(key, next);
      UI.toast({ title: `${defs[key].title} ${next.toLowerCase()}`, message: 'Prototype: saved in this browser only.' });
      render(host);
    });
  }));
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens.companionGuided = { render };

})();
