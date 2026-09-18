/* ============================================================================
   Veye Admin Console — application state
   ----------------------------------------------------------------------------
   There is no role model here, and that is deliberate. Every invited
   administrator has the same access to this console, so there is nothing to
   look up before rendering a screen: no roles, no capability map, no scoped
   reads, no masking, no separation of duties.

   Production security is a separate matter and is described in the README, not
   built into this prototype.

   State is persisted to localStorage so prototype edits survive a reload.
   ============================================================================ */

(function () {

const SEED = window.Veye.SEED;

/* Its own storage key. On file:// every edition in this repository shares one
   origin, so a shared key would let one overwrite another's data. */
const KEY = 'veye_admin_client_v2';
const listeners = new Set();

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function fresh() {
  return {
    signedIn: false,
    rememberedEmail: '',
    railCollapsed: false,

    org: clone(SEED.org),
    me: clone(SEED.me),
    admins: clone(SEED.admins),

    members: clone(SEED.members),
    memberDetail: clone(SEED.memberDetail),
    threads: clone(SEED.threads),
    attention: clone(SEED.attention),
    memberNotes: [],

    programs: clone(SEED.programs),
    programSteps: clone(SEED.programSteps),
    foodPortals: clone(SEED.foodPortals),
    foods: clone(SEED.foods),
    customFoods: clone(SEED.customFoods),
    mealTemplates: clone(SEED.mealTemplates),
    supplementGuidance: clone(SEED.supplementGuidance),

    healthNumber: clone(SEED.healthNumber),
    statusReport: clone(SEED.statusReport),
    simpleQuiz: clone(SEED.simpleQuiz),
    markers: clone(SEED.markers),
    markersMeta: clone(SEED.markersMeta),
    ratios: clone(SEED.ratios),
    bodyComposition: clone(SEED.bodyComposition),
    assessments: clone(SEED.assessments),

    companion: clone(SEED.companion),
    conversations: clone(SEED.conversations),

    website: clone(SEED.website),
    memberSections: clone(SEED.memberSections),
    dashboardContent: clone(SEED.dashboardContent),
    resources: clone(SEED.resources),
    notices: clone(SEED.notices),
    legalDocs: clone(SEED.legalDocs),

    plans: clone(SEED.plans),
    billing: clone(SEED.billing),
    integrations: clone(SEED.integrations),
    features: clone(SEED.features),
    activity: clone(SEED.activity),

    dirty: null,
  };
}

/* --------------------------------------------------------------- migrations --
   load() merges the STORED object over a fresh one, which is what lets a new
   seed key appear without discarding anybody's edits — but it also means a
   changed seed VALUE never reaches a browser that has already stored the old
   one. A migration is how a corrected value gets through.

   Every migration here is narrow and idempotent. Narrow: it names the exact old
   value it replaces, so an administrator who deliberately changed something in
   the prototype keeps their own version. Idempotent: after it has run there is
   nothing left for it to match, so running it again does nothing.

   Nothing is ever wiped. Clearing the whole key to hide a stale value would
   throw away every unrelated prototype edit as well, and a second "current"
   storage key would leave the stale one still there, still loadable.

   MIG-1 — the signed-in administrator was Naomi Clarke and is now Cara Hogue.
   Keyed to the AD-02 record and to that one old identity. Attributions carry a
   name rather than an id, so those are matched on the exact old name string.
   Cara MORGAN, the sample member, is a different person and is never touched. */
const MIG1_OLD = { id: 'AD-02', name: 'Naomi Clarke', email: 'naomi.clarke@veye.example' };
const MIG1_NEW = { name: 'Cara Hogue', initials: 'CH', email: 'cara.hogue@veye.example' };

function migrate(s) {
  let changed = false;

  const isOldAdmin = (o) => !!o && o.id === MIG1_OLD.id
    && (o.name === MIG1_OLD.name || o.email === MIG1_OLD.email);
  const renamed = (o) => ({ ...o, name: MIG1_NEW.name, initials: MIG1_NEW.initials, email: MIG1_NEW.email });

  if (isOldAdmin(s.me)) { s.me = renamed(s.me); changed = true; }

  if (Array.isArray(s.admins) && s.admins.some(isOldAdmin)) {
    s.admins = s.admins.map((a) => isOldAdmin(a) ? renamed(a) : a);
    changed = true;
  }

  /* Attributions: the console records who did something by name. */
  const byName = (v) => v === MIG1_OLD.name ? MIG1_NEW.name : v;

  if (Array.isArray(s.activity) && s.activity.some((a) => a.who === MIG1_OLD.name)) {
    s.activity = s.activity.map((a) => ({ ...a, who: byName(a.who) }));
    changed = true;
  }
  if (Array.isArray(s.memberNotes) && s.memberNotes.some((nte) => nte.who === MIG1_OLD.name)) {
    s.memberNotes = s.memberNotes.map((nte) => ({ ...nte, who: byName(nte.who) }));
    changed = true;
  }
  if (Array.isArray(s.threads) && s.threads.some((t) => (t.messages || []).some((msg) => msg.from === MIG1_OLD.name))) {
    s.threads = s.threads.map((t) => ({ ...t, messages: (t.messages || []).map((msg) => ({ ...msg, from: byName(msg.from) })) }));
    changed = true;
  }

  /* MIG-2 — the Food Library used a made-up taxonomy (Protein / Fat / Vegetable /
     Carbohydrate, plus a favorable-or-not flag) and now uses the member
     product's own four portals and fourteen groups.

     A stored record cannot be carried across, because there is no honest
     mapping: "Vegetable, Favorable" does not say whether the member sees the
     food under Super Favorable, Very Favorable or Starchy Vegetables — and
     guessing is how sweet potato ended up on the favorable side in the first
     place. So the Food Library is reseeded, and ONLY the Food Library: programs,
     members, content, assessments, companion and settings edits are untouched.

     Detected by shape, not by a version number, so it is self-limiting: after it
     has run no record has a `category`, and it never fires again. */
  const oldTaxonomy = Array.isArray(s.foods)
    && s.foods.some((f) => f && f.category !== undefined && f.portal === undefined);

  if (oldTaxonomy) {
    s.foods = clone(SEED.foods);
    s.foodPortals = clone(SEED.foodPortals);
    s.customFoods = clone(SEED.customFoods);
    changed = true;
  }
  /* A state stored before foodPortals existed simply has no key for it. */
  if (!Array.isArray(s.foodPortals) || !s.foodPortals.length) {
    s.foodPortals = clone(SEED.foodPortals);
    changed = true;
  }

  /* MIG-3 — display preferences. `me` is a stored object, so a new key inside it
     does not arrive through the top-level merge. Fill in only what is missing. */
  if (s.me && !s.me.display) {
    s.me = { ...s.me, display: clone(SEED.me.display) };
    changed = true;
  }

  /* ---- MIG-4..8 — the 20 Aug 2026 client alignment. Each is detected by the
     stale shape it replaces, so none of them runs twice and none touches an
     unrelated edit. ---- */

  /* MIG-4 — stale feature availability is replaced with the current Beta
     list, carrying over choices on feature records that remain editable. */
  if (Array.isArray(s.features) && s.features.some((f) => f.locked)) {
    const chosen = {};
    s.features.forEach((f) => { if (!f.locked) chosen[f.id] = f.enabled; });
    s.features = clone(SEED.features).map((f) =>
      Object.prototype.hasOwnProperty.call(chosen, f.id) ? { ...f, enabled: chosen[f.id] } : f);
    changed = true;
  }

  /* MIG-5 — Health Number definition updates (Q5 0.5, floor resolved to 1,
     band wording). Patched surgically so admin edits to other questions stay. */
  if (s.healthNumber && Array.isArray(s.healthNumber.questions)) {
    const q5 = s.healthNumber.questions.find((q) => q.id === 'Q5');
    if (q5 && q5.options && q5.options[0] && q5.options[0].points === 1.5) {
      q5.options[0].points = 0.5;
      changed = true;
    }
    if (s.healthNumber.openQuestion) {
      delete s.healthNumber.openQuestion;
      s.healthNumber.floor = clone(SEED.healthNumber.floor);
      s.healthNumber.bands = clone(SEED.healthNumber.bands);
      s.healthNumber.personas = clone(SEED.healthNumber.personas);
      s.healthNumber.versions = clone(SEED.healthNumber.versions);
      changed = true;
    }
  }

  /* MIG-6 — Food portals: the Limit rename, the Fats Avoid tier, the tier
     definitions, and the four Avoid foods. */
  if (Array.isArray(s.foodPortals) && s.foodPortals.length) {
    const fats = s.foodPortals.find((p2) => p2.key === 'fats');
    if (fats && !fats.groups.some((g) => g.key === 'fats:avoid')) {
      s.foodPortals = clone(SEED.foodPortals).map((p2) => {
        const old = s.foodPortals.find((o) => o.key === p2.key);
        return old && old.memberInfo ? { ...p2, memberInfo: old.memberInfo } : p2;
      });
      if (Array.isArray(s.foods) && !s.foods.some((f) => f.group === 'fats:avoid')) {
        s.foods = s.foods.concat(clone(SEED.foods).filter((f) => f.group === 'fats:avoid'));
      }
      changed = true;
    }
  }

  /* MIG-7 — the member-section reference data, the notices and the resource
     records' state. */
  if (!s.memberSections) {
    s.memberSections = clone(SEED.memberSections);
    changed = true;
  }
  if (Array.isArray(s.dashboardContent) && s.dashboardContent.some((d) => d.kind === 'Coming soon label')) {
    const notices = clone(SEED.dashboardContent).filter((d) => d.kind === 'Section notice');
    s.dashboardContent = s.dashboardContent.filter((d) => d.kind !== 'Coming soon label').concat(notices);
    changed = true;
  }
  if (Array.isArray(s.resources) && s.resources.some((r) => r.status === 'Held for Phase 2')) {
    s.resources = s.resources.map((r) => r.status === 'Held for Phase 2' ? { ...r, status: 'Draft' } : r);
    changed = true;
  }
  if (Array.isArray(s.assessments)) {
    const as3 = s.assessments.find((a) => a.id === 'AS-3');
    if (as3 && as3.name === 'Health Status Report') { as3.name = 'Health Assessment'; changed = true; }
    const as1 = s.assessments.find((a) => a.id === 'AS-1');
    if (as1 && as1.warn) { as1.warn = false; as1.version = 'v4.3'; as1.updated = '20 Aug 2026'; changed = true; }
  }
  if (Array.isArray(s.ratios)) {
    const rt2 = s.ratios.find((r) => r.id === 'RT-2');
    if (rt2 && !rt2.entry) {
      rt2.entry = 'Calculated or entered directly';
      rt2.entryNote = clone(SEED.ratios.find((r) => r.id === 'RT-2').entryNote);
      changed = true;
    }
  }

  /* MIG-8 — 21 Aug 2026 correction pass: the Meal Planning rename reaches
     stored feature and program-step wording, and the Food Diary feature
     description catches up with the rebuilt member screen. Detected by the
     stale strings themselves; ids and every administrator choice stay. */
  if (Array.isArray(s.features)) {
    const f4 = s.features.find((f) => f.id === 'FT-04');
    if (f4 && f4.name === 'Your Days and meal plans') { f4.name = 'Meal Planning'; changed = true; }
    const f5 = s.features.find((f) => f.id === 'FT-05');
    if (f5 && f5.desc === 'The editable diary table and its export.') {
      f5.desc = 'Daily meal entries, time eaten, pre-meal feelings, notes, prototype macro estimates, daily summary and history.';
      changed = true;
    }
  }
  if (Array.isArray(s.programSteps)) {
    s.programSteps.forEach((st) => {
      if (st.detail && st.detail.indexOf('Your Days template:') === 0) {
        st.detail = st.detail.replace('Your Days template:', 'Meal Planning template:');
        changed = true;
      }
    });
  }
  if (s.memberSections && s.memberSections.mindfulness &&
      s.memberSections.mindfulness.body === 'Guided practices, breathing sessions and mindful-eating tools are being prepared for this space.') {
    /* The old sentence described future scope the client never supplied. */
    s.memberSections.mindfulness.body = 'Under development — more coming.';
    changed = true;
  }

  /* MIG-9 — 28 Aug 2026 source reconciliation. These exact stale seed shapes
     predate Cara's revised Health Assessment direction, the client wording for
     the Simple Quiz, the supplied sample-day names and the source-backed
     supplement guidance. Replace only those untouched stale shapes; an admin
     edit made after the previous seed is not overwritten. */
  if (s.statusReport && s.statusReport.scale === 'Total of 11 to 33. Higher is better.') {
    s.statusReport = clone(SEED.statusReport);
    changed = true;
  }
  if (s.simpleQuiz && Array.isArray(s.simpleQuiz.items) &&
      s.simpleQuiz.items[0] === 'Do you feel tired during the day?') {
    s.simpleQuiz = { ...s.simpleQuiz, ...clone(SEED.simpleQuiz) };
    changed = true;
  }
  const oldTemplateNames = ['Balanced Start', 'Plant Forward Day', 'Low Carb Day', 'Reset Week', 'Mediterranean Day'];
  if (Array.isArray(s.mealTemplates) && s.mealTemplates.length === oldTemplateNames.length &&
      s.mealTemplates.every((t, i) => t && t.name === oldTemplateNames[i])) {
    s.mealTemplates = clone(SEED.mealTemplates);
    changed = true;
  }
  if (Array.isArray(s.supplementGuidance) &&
      s.supplementGuidance.some((g) => g && g.id === 'SG-2' && g.supplement === 'Magnesium glycinate')) {
    s.supplementGuidance = clone(SEED.supplementGuidance);
    changed = true;
  }

  /* MIG-10 — 10 Sep 2026 Start the Process review. The referral question is
     onboarding-only and unscored, so this changes its wording without changing
     any Health Number. It also corrects one duplicate content-record id and
     makes the Fitness editor describe the static preview truthfully. */
  if (s.healthNumber && Array.isArray(s.healthNumber.questions)) {
    const sourceQ = s.healthNumber.questions.find((q) => q.id === 'Q12');
    if (sourceQ && Array.isArray(sourceQ.options) &&
        sourceQ.options.some((o) => o.label === 'X (formerly Twitter)')) {
      sourceQ.options = clone(SEED.healthNumber.questions.find((q) => q.id === 'Q12').options);
      s.healthNumber.version = 'v4.4';
      const assessment = Array.isArray(s.assessments) && s.assessments.find((a) => a.id === 'AS-1');
      if (assessment) { assessment.version = 'v4.4'; assessment.updated = '10 Sep 2026'; }
      changed = true;
    }
    const approvedText = Object.fromEntries(SEED.healthNumber.questions.map((q) => [q.id, q.text]));
    const staleText = {
      Q1: 'What is your main health goal?', Q3: 'How would you describe your activity level?',
      Q5: 'Are you often tired, or do you have poor mental focus?',
      Q7: 'Do you carry excess weight around your abdomen?', Q8: 'Do you get enough sleep?',
      Q10: 'How many hours do you sleep?', Q11: 'Do you have a dietary preference?',
      Q12: 'How did you hear about Veye?',
    };
    s.healthNumber.questions.forEach((q) => {
      if (staleText[q.id] && q.text === staleText[q.id]) { q.text = approvedText[q.id]; changed = true; }
      if (['Q1', 'Q11', 'Q12'].includes(q.id) && Array.isArray(q.options) &&
          !q.options.some((o) => o.label === 'Other')) {
        q.options.push({ label: 'Other', points: 0 }); changed = true;
      }
    });
    if (s.healthNumber.effective !== '10 Sep 2026') { s.healthNumber.effective = '10 Sep 2026'; changed = true; }
    if (s.healthNumber.scale === '0 to 10, rounded to the nearest 0.5') {
      s.healthNumber.scale = SEED.healthNumber.scale; changed = true;
    }
  }
  if (Array.isArray(s.assessments)) {
    const assessment = s.assessments.find((a) => a.id === 'AS-1');
    const sourceQ = s.healthNumber && Array.isArray(s.healthNumber.questions) &&
      s.healthNumber.questions.find((q) => q.id === 'Q12');
    if (assessment && assessment.version === 'v4.3' && sourceQ &&
        sourceQ.options.some((o) => o.label === 'Facebook')) {
      assessment.version = 'v4.4'; assessment.updated = '10 Sep 2026';
      changed = true;
    }
  }
  if (Array.isArray(s.dashboardContent)) {
    const help = s.dashboardContent.find((d) => d.kind === 'Help content' && d.id === 'DC-10');
    if (help) { help.id = 'DC-11'; changed = true; }
    const fitness = s.dashboardContent.find((d) => d.id === 'DC-09');
    if (fitness && fitness.body === 'Content in development.') {
      fitness.body = 'Static workout preview; final video assets and permissions are still required.';
      fitness.updated = '10 Sep 2026';
      changed = true;
    }
  }
  if (s.memberSections && s.memberSections.fitness &&
      s.memberSections.fitness.embedNote === 'No video embeds until the client supplies the assets and permissions — the member screen says so honestly.') {
    s.memberSections.fitness.embedNote = SEED.memberSections.fitness.embedNote;
    changed = true;
  }

  /* MIG-11 — 12 Sep 2026 production-foundation alignment. Companion sources
     are simple approved-content records, member feedback is member-originated,
     and the three named areas are Phase 2 references rather than Live Beta
     features. Existing administrator edits outside these stale fields remain. */
  if (s.companion && (!Array.isArray(s.companion.knowledgeSources) || !s.companion.knowledgeSources.length)) {
    s.companion = { ...s.companion, knowledgeSources: clone(SEED.companion.knowledgeSources) };
    changed = true;
  }
  if (Array.isArray(s.conversations)) {
    const seededFeedback = Object.fromEntries(SEED.conversations.map((c) => [c.id, c.feedback]));
    let feedbackChanged = false;
    s.conversations = s.conversations.map((c) => {
      if (c.feedback) return c;
      feedbackChanged = true;
      return { ...c, feedback: clone(seededFeedback[c.id] || {
        rating: null, comment: null, submittedAt: null, reviewed: false,
      }) };
    });
    if (feedbackChanged) changed = true;
  }
  if (Array.isArray(s.features)) {
    const phaseTwo = new Set(['FT-10', 'FT-11', 'FT-12']);
    let featureChanged = false;
    s.features = s.features.map((f) => {
      if (!phaseTwo.has(f.id) || f.state === 'Phase 2') return f;
      const current = SEED.features.find((seed) => seed.id === f.id);
      featureChanged = true;
      return current ? clone(current) : f;
    });
    if (featureChanged) changed = true;
  }
  if (Array.isArray(s.dashboardContent)) {
    const phaseTwoIds = new Set(['DC-07', 'DC-08', 'DC-09']);
    let contentChanged = false;
    s.dashboardContent = s.dashboardContent.map((item) => {
      if (!phaseTwoIds.has(item.id) || item.status === 'Phase 2') return item;
      const current = SEED.dashboardContent.find((seed) => seed.id === item.id);
      contentChanged = true;
      return current ? clone(current) : item;
    });
    if (contentChanged) changed = true;
  }

  return changed;
}

let state = load();

function load() {
  let s;
  try {
    const raw = localStorage.getItem(KEY);
    // Merge over a fresh base so a seed addition never breaks a stored state.
    s = raw ? { ...fresh(), ...JSON.parse(raw) } : fresh();
  } catch (e) {
    console.warn('[state] stored state unreadable, starting fresh', e);
    return fresh();
  }
  /* Write the corrected state straight back, so the migration runs once rather
     than on every load for the rest of this browser's life. */
  if (migrate(s)) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* quota — the in-memory fix still stands */ }
  }
  return s;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.warn('[state] could not persist', e); }
}

function get() { return state; }

function set(patch, { silent = false } = {}) {
  state = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
  persist();
  if (!silent) listeners.forEach((fn) => fn(state));
  return state;
}

function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function resetDemoData() {
  const stayIn = state.signedIn;
  localStorage.removeItem(KEY);
  state = fresh();
  state.signedIn = stayIn;
  persist();
  listeners.forEach((fn) => fn(state));
}

/** The signed-in administrator. */
function me() { return state.me; }

/* --------------------------------------------------------- recent activity --
   A short, plain-language record of what changed in the console, shown in
   Settings. It is not an audit product and makes no compliance claim. */
let seq = 100;
function note(what, who) {
  const entry = { id: 'RA-' + (++seq), who: who || me().name, what, when: 'Just now' };
  set({ activity: [entry, ...state.activity].slice(0, 40) }, { silent: true });
  return entry;
}

/* ------------------------------------------------- unsaved-change tracking -- */
function markDirty(scopeId, label) { set({ dirty: { scopeId, label } }, { silent: true }); }
function clearDirty() { set({ dirty: null }, { silent: true }); }
function isDirty() { return !!state.dirty; }

/* ----------------------------------------------------------------- lookups -- */
function member(id) { return state.members.find((m) => m.id === id) || null; }
function detail(id) { return state.memberDetail[id] || null; }
function thread(memberId) { return state.threads.find((t) => t.memberId === memberId) || null; }

/* Health Number band lookup. Bands are keyed on the canonical LOW-IS-BETTER
   scale, so the first band whose ceiling the score does not exceed wins. No
   screen re-derives this. */
function hnBand(score) {
  if (score == null) return null;
  return state.healthNumber.bands.find((b) => score <= b.upTo) || state.healthNumber.bands[state.healthNumber.bands.length - 1];
}

window.Veye = window.Veye || { screens: {} };
window.Veye.S = {
  get, set, subscribe, resetDemoData,
  me, note, markDirty, clearDirty, isDirty,
  member, detail, thread, hnBand,
};

})();
