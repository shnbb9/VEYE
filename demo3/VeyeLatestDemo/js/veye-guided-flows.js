/* ============================================================================
   VEYE prototype — Sprout guided flows (deterministic, local, no AI)
   ----------------------------------------------------------------------------
   Runs Cara's two decision trees (Intro 260627, Progress Trackers 260326) in
   the static prototype exactly as the platform does, from the same generated
   definitions (veye-guided-flows-data.js). The engine mirrors the platform's
   GuidedFlowService: a render loop that auto-chains MESSAGE / NAVIGATION /
   CHECK_MEMBER_STATE nodes until an interactive node (CHOICE, QUESTION,
   AI_TASK, COMPLETE); Yes/No buttons plus a small lexicon for typed replies;
   a clarification when a reply does not map to an option; pause / resume /
   skip / restart; and explicit UI actions the page performs itself
   (OPEN_TRACKER …, OPEN_FOOD_CHOICES, START_FLOW …). Sessions live in
   localStorage under `veye_guided_flows` and pin the definition version.

   Member-state checks read the prototype's own saved trackers, so a member
   who has a saved BMI is not asked the BMI question — the documented
   enhancement Cara's tree allows. Nothing here calls a model; there is no AI
   in the prototype.
   ======================================================================== */
(function (window) {
  'use strict';

  var STORE_KEY = 'veye_guided_flows';
  var MAX_HOPS = 60;
  var CLARIFICATION = 'I want to be sure I follow you — please choose one of the options below.';
  var YES_WORDS = ['yes', 'y', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'continue', 'go on', 'ready', 'lets go', "let's go", 'please',
    'absolutely', 'of course', 'sounds good', 'im ready', "i'm ready", 'yes please', 'go ahead', 'carry on', 'next', 'definitely'];
  var NO_WORDS = ['no', 'n', 'nope', 'not now', 'later', 'skip', 'no thanks', 'no thank you', 'not yet', 'maybe later', 'not really',
    'no thanks.', "i'd rather not", 'id rather not', 'pass'];
  var STOP = ['the', 'a', 'an', 'to', 'of', 'and', 'or', 'me', 'my', 'i', 'we', 'you', 'it', 'is', 'on', 'in', 'for', 'with', 'go', 'start',
    'want', 'would', 'like', 'please', 'lets', "let's", 'can', 'do', 'be', 'that', 'this', 'about'];

  function definitions() { return window.VeyeGuidedFlowData || {}; }
  function definition(key) {
    var def = definitions()[key];
    if (!def) throw new Error('Unknown guided flow: ' + key);
    return def;
  }

  /* ---------------------------------------------------------------- store */
  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeStore(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }
  function session(key) { return readStore()[key] || null; }
  function saveSession(key, sess) { var s = readStore(); s[key] = sess; writeStore(s); return sess; }
  function nowISO() { return new Date().toISOString(); }

  /* -------------------------------------------------------- member state */
  /* The prototype's saved trackers. Health Assessment, Simple Quiz, Blood
     Markers and BMI are real prototype screens; Food Choices is a member
     section without a completed-state record, so it is never "done". */
  function hasEntries(storageKey, latestKeys) {
    try {
      var raw = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!raw) return false;
      if (Array.isArray(raw)) return raw.length > 0;
      if (Array.isArray(raw.history) && raw.history.length) return true;
      if (Array.isArray(raw.entries) && raw.entries.length) return true;
      for (var i = 0; i < (latestKeys || []).length; i++) { if (raw[latestKeys[i]]) return true; }
      return false;
    } catch (e) { return false; }
  }
  function memberState() {
    var hn = false;
    try {
      hn = !!(JSON.parse(localStorage.getItem('veye_health_quiz') || 'null') || JSON.parse(localStorage.getItem('veye_health_number') || 'null'));
    } catch (e) {}
    return {
      has_blood_markers: hasEntries('veye_blood', ['latest', 'result']),
      has_body_composition: hasEntries('veye_bmi', ['latest', 'result']),
      has_health_number: hn,
      has_health_assessment: hasEntries('veye_assessment', ['latest', 'result']),
      has_simple_quiz: hasEntries('veye_simple_quiz', ['latest', 'result']),
      has_food_choices: false,
      blood_markers_available: true,
      body_composition_available: true,
      health_assessment_available: true,
      simple_quiz_available: true,
      food_choices_available: false
    };
  }

  /* --------------------------------------------------------- transitions */
  function transition(def, nodeId, choiceKey, state) {
    var node = def.nodes[nodeId];
    if (!node) throw new Error('Undefined node ' + nodeId);
    switch (node.type) {
      case 'MESSAGE': case 'QUESTION': case 'KNOWLEDGE': return { next: node.next || null, action: null };
      case 'NAVIGATION': return { next: node.next || null, action: node.action ? Object.assign({}, node.action) : null };
      case 'CHOICE': case 'AI_TASK':
        for (var i = 0; i < (node.choices || []).length; i++) {
          if (node.choices[i].key === choiceKey) return { next: node.choices[i].next || null, action: null };
        }
        throw new Error("'" + choiceKey + "' is not an option at node '" + nodeId + "'.");
      case 'CHECK_MEMBER_STATE':
        return { next: (state || {})[node.check.state] ? node.check.if_true : node.check.if_false, action: null };
      case 'COMPLETE': return { next: null, action: null };
    }
    throw new Error('Unsupported node type ' + node.type);
  }

  function sectionTitle(def, nodeId) {
    var node = def.nodes[nodeId];
    if (!node) return null;
    for (var i = 0; i < (def.sections || []).length; i++) { if (def.sections[i].key === node.section) return def.sections[i].title; }
    return null;
  }

  function nodeOut(node, nodeId) {
    var out = { id: nodeId, type: node.type, section: node.section || null, text: node.text, copy_origin: node.copy_origin || 'client' };
    if (node.type === 'CHOICE' || node.type === 'AI_TASK') out.choices = (node.choices || []).map(function (c) { return { key: c.key, label: c.label }; });
    if (node.type === 'QUESTION') out.answer_label = node.answer_label || 'Continue';
    if (node.type === 'AI_TASK') out.task = node.task || null;
    return out;
  }

  /* The render loop: chains automatic nodes and stops at the next interactive one. */
  function render(key, sess) {
    var def = definition(key);
    var step = { flow_key: key, flow_title: def.title, flow_version: def.version, status: sess.status,
                 messages: [], actions: [], node: null, section_title: null, clarification: null,
                 steps_taken: (sess.history || []).length, content_meta: def.content_meta || {} };
    if (sess.status === 'skipped') { step.section_title = sectionTitle(def, sess.current_node); return step; }
    var state = null, hops = 0;
    for (;;) {
      if (++hops > MAX_HOPS) throw new Error('The guided experience did not reach a step.');
      var node = def.nodes[sess.current_node];
      if (!node) throw new Error('Undefined node ' + sess.current_node);
      if (node.type === 'CHECK_MEMBER_STATE') {
        state = state || memberState();
        sess.current_node = transition(def, sess.current_node, null, state).next;
        continue;
      }
      if (node.type === 'MESSAGE') {
        step.messages.push(node.text);
        sess.current_node = node.next;
        if (node.pause) {
          sess.status = 'paused'; sess.pauses = (sess.pauses || 0) + 1;
          step.status = 'paused'; step.section_title = sectionTitle(def, sess.current_node);
          saveSession(key, sess);
          return step;
        }
        continue;
      }
      if (node.type === 'NAVIGATION') {
        step.messages.push(node.text);
        step.actions.push(Object.assign({}, node.action));
        sess.current_node = node.next;
        continue;
      }
      if (node.type === 'KNOWLEDGE') {
        // The platform retrieves approved knowledge here; the prototype has
        // no knowledge base, so only the node's own line is shown.
        step.messages.push(node.text);
        sess.current_node = node.next;
        continue;
      }
      if (node.type === 'COMPLETE' && sess.status !== 'completed') {
        sess.status = 'completed'; sess.completed_at = nowISO();
      }
      step.status = sess.status;
      step.node = nodeOut(node, sess.current_node);
      step.section_title = sectionTitle(def, sess.current_node);
      saveSession(key, sess);
      return step;
    }
  }

  /* ---------------------------------------------------------- interpreter */
  function normalise(text) {
    return String(text || '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function interpret(text, choices) {
    var n = normalise(text);
    if (!n) return null;
    var keys = (choices || []).map(function (c) { return c.key; });
    var yesNo = keys.indexOf('yes') >= 0 && keys.indexOf('no') >= 0;
    if (yesNo) {
      if (YES_WORDS.indexOf(n) >= 0 || /^(yes|yeah|sure|ok|okay) /.test(n)) return 'yes';
      if (NO_WORDS.indexOf(n) >= 0 || /^(no|not|nope) /.test(n)) return 'no';
    }
    var words = n.split(' ');
    for (var i = 0; i < (choices || []).length; i++) {
      var c = choices[i];
      if (c.key === 'yes' || c.key === 'no') continue;
      var keyWords = c.key.split('_').filter(Boolean);
      if (keyWords.length && keyWords.every(function (w) { return words.indexOf(w) >= 0; })) return c.key;
      var labelWords = normalise(c.label).split(' ').filter(function (w) { return w.length > 3 && STOP.indexOf(w) < 0; });
      for (var j = 0; j < labelWords.length; j++) { if (words.indexOf(labelWords[j]) >= 0) return c.key; }
    }
    return null;
  }

  /* ------------------------------------------------------------- public */
  function fresh(key) {
    var def = definition(key);
    return { flow_key: key, flow_version: def.version, current_node: def.start, status: 'in_progress', history: [],
             questions_asked: 0, pauses: 0, started_at: nowISO() };
  }
  function start(key) {
    var s = session(key);
    if (s && (s.status === 'in_progress' || s.status === 'paused') && s.flow_version === definition(key).version) {
      s.status = 'in_progress';
      return render(key, s);
    }
    return render(key, saveSession(key, fresh(key)));
  }
  function restart(key) { return render(key, saveSession(key, fresh(key))); }
  function current(key) {
    var s = session(key);
    return s ? render(key, s) : null;
  }
  function pause(key) {
    var s = session(key);
    if (!s || s.status !== 'in_progress') return s ? render(key, s) : null;
    s.status = 'paused'; s.pauses = (s.pauses || 0) + 1;
    return render(key, saveSession(key, s));
  }
  function skip(key) {
    var s = session(key) || fresh(key);
    s.status = 'skipped';
    saveSession(key, s);
    var step = render(key, s);
    step.messages = [String((definition(key).content_meta || {}).explore_message || 'Explore the dashboard at your own pace.')];
    return step;
  }
  function answer(key, opts) {
    opts = opts || {};
    var s = session(key);
    if (!s) return start(key);
    var def = definition(key);
    var node = def.nodes[s.current_node];
    var choice = null, via = 'choice';
    if (node.type === 'COMPLETE') return render(key, s);
    if (node.type === 'CHOICE' || node.type === 'AI_TASK') {
      if (opts.choice != null) {
        choice = opts.choice;
      } else if (opts.text != null) {
        choice = interpret(opts.text, node.choices);
        if (choice == null) { var st = render(key, s); st.clarification = CLARIFICATION; return st; }
        via = 'lexicon';
      } else {
        return render(key, s);
      }
    } else if (node.type === 'QUESTION') {
      via = 'response'; // every response advances; the text itself is not stored
    } else {
      via = 'continue';
    }
    var t = transition(def, s.current_node, choice, memberState());
    s.history = (s.history || []).concat([{ node: s.current_node, choice: choice, via: via, at: nowISO() }]);
    if (t.next == null) {
      s.status = 'completed'; s.completed_at = nowISO();
      return render(key, saveSession(key, s));
    }
    s.current_node = t.next;
    s.status = 'in_progress';
    return render(key, saveSession(key, s));
  }
  function overview() {
    var defs = definitions(), store = readStore(), flows = [], anySession = false;
    Object.keys(defs).forEach(function (key) {
      var s = store[key] || null;
      if (s) anySession = true;
      flows.push({ key: key, title: defs[key].title, version: defs[key].version, session: s ? { status: s.status, current_node: s.current_node, flow_version: s.flow_version } : null });
    });
    return { first_arrival_offer: !!defs.first_time_user && !anySession, flows: flows };
  }
  function reset() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} }

  window.VeyeGuidedFlows = {
    CLARIFICATION: CLARIFICATION,
    definitions: definitions, definition: definition, memberState: memberState, interpret: interpret,
    start: start, restart: restart, current: current, answer: answer, pause: pause, skip: skip, overview: overview, reset: reset,
    session: session
  };
})(window);
