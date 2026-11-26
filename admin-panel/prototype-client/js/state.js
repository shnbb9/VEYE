/* ============================================================================
   Veye Admin Console — application state
   ----------------------------------------------------------------------------
   The prototype's database. Everything a screen shows is read from here and
   every action writes here, so a change survives a reload — in this browser
   only. There is no role model: every administrator has the same console.

   STORAGE
   The 14 Nov 2026 rebuild mirrors the real console's data model, which shares
   almost nothing with the August model, so it has its own key. The earlier
   key (veye_admin_client_v2) is not read and is left untouched.
   ============================================================================ */

(function () {

const KEY = 'veye_admin_client_v3';
const SCHEMA = 4;
const listeners = new Set();

function fresh() {
  return {
    signedIn: false,
    rememberedEmail: '',
    ...window.Veye.buildSeed(Date.now()),
    lastViewed: null,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const stored = JSON.parse(raw);
    if (!stored || stored.schema !== SCHEMA) return fresh();
    // 26 Nov 2026: a request records the email that told the team it arrived.
    // Requests stored before then get one, rather than the sample data being
    // thrown away for one new field.
    const support = (stored.org && stored.org.supportEmail) || 'contact@veye.co';
    (stored.requests || []).forEach((r) => {
      if (!('team_notice' in r)) {
        r.team_notice = { status: 'sent', to_email: support, sent_at: new Date(Date.parse(r.created_at) + 60 * 1000).toISOString(), detail: null };
      }
    });
    // Merge over a fresh base so a key added later never breaks a stored state.
    return { ...fresh(), ...stored };
  } catch (e) {
    console.warn('[state] stored state unreadable, starting fresh', e);
    return fresh();
  }
}

let state = load();

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

/** Start over: the sample data is rebuilt as of now. Signing in survives. */
function resetDemoData() {
  const stayIn = state.signedIn;
  state = fresh();
  state.signedIn = stayIn;
  persist();
  listeners.forEach((fn) => fn(state));
}

/* ------------------------------------------------------------------ helpers */
function now() { return new Date().toISOString(); }

function newId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  const r = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${r()}${r()}-${r()}-4${r().slice(1)}-a${r().slice(1)}-${r()}${r()}${r()}`;
}

/** The signed-in administrator — a row of the Administrators list. */
function me() { return state.admins.find((a) => a.userId === state.meId) || state.admins[0]; }

/* Who did something, in the console's words: the audit log the API writes on
   every change (app/admin/audit.py), kept newest first. */
function audit(action, entityType, entityId, details = {}) {
  const entry = { id: newId(), created_at: now(), actor_name: me().name, action, entity_type: entityType,
    entity_id: entityId == null ? null : String(entityId), details };
  set({ audit: [entry, ...state.audit].slice(0, 600) }, { silent: true });
  return entry;
}

const ACCOUNT_ACTIONS = {
  'administrator.invited': 'Invited to the console',
  'administrator.invitation_resent': 'Invitation resent',
  'administrator.invitation_revoked': 'Invitation withdrawn',
  'administrator.deactivated': 'Console access deactivated',
  'administrator.reactivated': 'Console access reactivated',
  'member_account.deactivated': 'Account deactivated',
  'member_account.reactivated': 'Account reactivated',
  'member_account.verification_resent': 'Verification email resent',
  'member_account.password_reset_sent': 'Password-reset link sent',
};

/** Access changes read back beside the controls that made them. */
function accountActivity({ userId = null, limit = 20 } = {}) {
  return state.audit
    .filter((a) => a.entity_type === 'user_account' && ACCOUNT_ACTIONS[a.action] && (!userId || a.entity_id === userId))
    .slice(0, limit)
    .map((a) => ({ id: a.id, at: a.created_at, actor_name: a.actor_name, action: a.action, label: ACCOUNT_ACTIONS[a.action],
      user_id: a.entity_id, email: (a.details || {}).email || null }));
}

/* ----------------------------------------------------------- the mail server
   Nothing leaves the prototype. This stands in for the console's outbox and
   provider: every message is accepted except one addressed to the synthetic
   bounce domain, which the "server" refuses — so a failed send can be shown
   for what it is, exactly as the console shows it. */
const BOUNCE = /@bounces\.demo\.veye\.test$/i;
function deliver(email) {
  return BOUNCE.test(String(email || '')) ? { status: 'failed', detail: '550 5.1.1 Mailbox unavailable' } : { status: 'sent', detail: null };
}

/* ------------------------------------------------------------------ lookups */
function member(id) { return state.members.find((m) => m.id === id) || null; }
function memberName(id) { const m = member(id); return m ? m.name : 'Member'; }
/** Sharing, and still a member: an archived record opens to nobody. */
function shares(m) { return !!m && m.sharing && m.sharing.state === 'granted' && !m.archivedAt; }
function sharingIds() { return new Set(state.members.filter(shares).map((m) => m.id)); }

/** Replace one member record and persist. */
function updateMember(id, fn) {
  set({ members: state.members.map((m) => (m.id === id ? fn(JSON.parse(JSON.stringify(m))) : m)) });
}

window.Veye = window.Veye || { screens: {} };
window.Veye.S = {
  get, set, subscribe, resetDemoData,
  now, newId, me, audit, accountActivity, ACCOUNT_ACTIONS, deliver,
  member, memberName, shares, sharingIds, updateMember,
};

})();
