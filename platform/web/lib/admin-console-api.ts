import { apiJson, postJson } from "@/lib/api";
import { apiPath } from "@/lib/api-base";

/* Production console client: Home, Members, Member 360, Assessments,
   Insights, Care Studio and Content. Every call needs the ADMIN portal
   session cookie; a member session is refused by the API. */

const CONSOLE = "/api/v1/admin";

export type TrackerKey = "health_number" | "body_composition" | "blood_markers" | "health_assessment" | "simple_quiz";
export type TrackerCounts = Record<TrackerKey, number>;
export const TRACKER_KEYS: TrackerKey[] = ["health_number", "body_composition", "blood_markers", "health_assessment", "simple_quiz"];
export const TRACKER_LABELS: Record<TrackerKey, string> = {
  health_number: "Health Number", body_composition: "Body Composition", blood_markers: "Blood Markers",
  health_assessment: "Health Assessment", simple_quiz: "Simple Quiz",
};

export type ConsoleOverview = {
  members_total: number;
  members_verified: number;
  members_new_last_7_days: number;
  members_new_last_30_days: number;
  members_active_last_7_days: number;
  completions: TrackerCounts;
  members_completed: TrackerCounts;
  guided_sessions_total: number;
  guided_sessions_in_progress: number;
  guided_sessions_completed: number;
  companion_conversations_total: number;
  companion_conversations_last_7_days: number;
  companion_feedback_unreviewed: number;
  requests_open: number;
  requests_new: number;
  requests_in_progress: number;
  mood_entries_total: number;
  food_diary_entries_total: number;
  recent_members: { member_id: string; name: string; email: string; joined_at: string; email_verified: boolean; is_synthetic: boolean }[];
  recent_activity: { at: string; member_id: string; member_name: string; kind: string; summary: string }[];
  generated_at: string;
};

export type MemberRow = {
  member_id: string;
  account_id: string;
  name: string;
  email: string;
  initials: string;
  joined_at: string;
  email_verified: boolean;
  is_active: boolean;
  is_synthetic: boolean;
  admin_access: boolean;
  health_number: number | null;
  health_number_status: string | null;
  health_number_at: string | null;
  trackers_completed: number;
  last_active_at: string | null;
  onboarding: "Complete" | "Not started";
  has_photo: boolean;
  photo_version: string | null;
  /* A null health_number means one of two things, so the state says which:
     no saved result, or no permission to see it. */
  sharing_state: HealthPermission["state"];
  sharing_label: string;
  shares_health_data: boolean;
};

/* ---- Health Data Sharing Permission -------------------------------------- */
/* The member decides whether the Veye team may open their health records. The
   console can ask and can read the answer; it can never set it. */
export type HealthPermissionEvent = {
  id: string; from_state: string; to_state: string; actor: string;
  actor_name: string; source: string; policy_version: string; created_at: string;
};
export type HealthPermission = {
  state: "not_requested" | "requested" | "granted" | "declined" | "revoked";
  state_label: string;
  shares_health_data: boolean;
  policy_version: string;
  current_policy_version: string;
  explanation: string;
  requested_at: string | null;
  requested_by_name: string;
  decided_at: string | null;
  revoked_at: string | null;
  events: HealthPermissionEvent[];
};

export type MembersPage = { rows: MemberRow[]; total: number; page: number; page_size: number };

export type MembersQuery = {
  q?: string;
  status?: "any" | "active" | "inactive" | "unverified";
  onboarding?: "any" | "complete" | "not_started";
  active?: "any" | "week" | "month" | "longer" | "never";
  sort?: "name" | "joined" | "health_number" | "last_active";
  direction?: "asc" | "desc";
  page?: number;
  page_size?: number;
};

export type HealthNumberRow = { attempt_id: string; displayed_score: number | string; status: string; bucket: string; category: string; interpretation: string; calculation_version: string; completed_at: string };
export type BodyCompositionRow = { attempt_id: string; sex: string; bmi: number | null; body_fat_percent: number | null; fat_mass_lb: number | null; lean_mass_lb: number | null; body_fat_available: boolean; unavailable_reason: string | null; calculation_version: string; completed_at: string; measurements: Record<string, number | string | undefined> };
export type BloodMarkersRow = { attempt_id: string; tg_hdl: number | null; homa_ir: number | null; aa_epa: number | null; in_range: Record<string, boolean | null>; recommendation: { state: string; epa_dha_dose: string | null }; calculation_version: string; completed_at: string; markers: Record<string, number | null> };
export type HealthAssessmentRow = { attempt_id: string; total: number; status: string; epa_dha_dose: string; calculation_version: string; completed_at: string; answers: Record<string, number> };
export type SimpleQuizRow = { attempt_id: string; yes_count: number; no_count: number; summary: string; calculation_version: string; completed_at: string; answers: Record<string, string> };

export type Member360 = {
  profile: MemberRow;
  phone: string | null;
  postal_code: string | null;
  health_number: HealthNumberRow[];
  body_composition: BodyCompositionRow[];
  blood_markers: BloodMarkersRow[];
  health_assessment: HealthAssessmentRow[];
  simple_quiz: SimpleQuizRow[];
  guided_sessions: { flow_key: string; flow_title: string; flow_version: number; status: string; current_node: string; started_at: string; updated_at: string; completed_at: string | null }[];
  conversations: { id: string; started_at: string; last_message_at: string; message_count: number; flagged: boolean; reviewed_at: string | null }[];
  mood_entries: { id: string; entry_date: string; mood: string; mood_label: string; note: string; created_at: string; updated_at: string }[];
  mood_stats: { month: string; days_logged_this_month: number; day_streak: number; top_mood: string | null; top_mood_label: string | null; balance_score: number | null; balance_window_days: number; balance_entries: number };
  food_diary: { id: string; entry_date: string; meal_time: string; description: string; feelings: string[]; notes: string; created_at: string; updated_at: string }[];
  food_diary_days: number;
  requests: ConsoleRequest[];
  not_connected: string[];
  /* Every health list above is empty unless this is true — the API withholds
     them, the screen does not hide them. */
  sharing_state: HealthPermission["state"];
  sharing_label: string;
  shares_health_data: boolean;
  account: MemberAccount;
  account_activity: AccountActivity[];
};

/** The member's profile photo as the console sees it (same bytes the member sees). */
export const memberPhotoUrl = (memberId: string, version: string) => apiPath(`${CONSOLE}/members/${memberId}/photo?v=${encodeURIComponent(version)}`);

export type Instrument = {
  key: TrackerKey;
  name: string;
  description: string;
  calculation_version: string;
  calculation_owner: string;
  attempts_total: number;
  members_scored: number;
  last_completed_at: string | null;
};

export type AttemptRow = { attempt_id: string; member_id: string; member_name: string; member_email: string; completed_at: string; calculation_version: string; result: string; detail: Record<string, unknown> };
export type AttemptsPage = { instrument: Instrument; rows: AttemptRow[]; total: number; page: number; page_size: number };

export type MonthCount = { month: string; count: number };
export type Insights = {
  members_total: number;
  members_by_month: MonthCount[];
  attempts: TrackerCounts;
  members_completed: TrackerCounts;
  attempts_by_month: Record<TrackerKey, MonthCount[]>;
  guided_flows: { flow_key: string; flow_title: string; started: number; in_progress: number; paused: number; completed: number; skipped: number }[];
  companion_conversations: number;
  companion_messages: number;
  companion_feedback_helpful: number;
  companion_feedback_not_helpful: number;
  requests_by_kind: Record<string, number>;
  requests_by_status: Record<string, number>;
  requests_by_month: MonthCount[];
  mood_entries: number;
  mood_members: number;
  food_diary_entries: number;
  food_diary_members: number;
  generated_at: string;
};

function query(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export const getConsoleOverview = () => apiJson<ConsoleOverview>(`${CONSOLE}/overview`);
export const listMembers = (params: MembersQuery = {}) => apiJson<MembersPage>(`${CONSOLE}/members${query(params)}`);
export const getMember360 = (memberId: string) => apiJson<Member360>(`${CONSOLE}/members/${memberId}`);
export const getHealthPermission = (memberId: string) =>
  apiJson<HealthPermission>(`${CONSOLE}/members/${memberId}/health-permission`);
/* Asking is the console's whole power here. */
export const requestHealthPermission = (memberId: string) =>
  postJson<HealthPermission>(`${CONSOLE}/members/${memberId}/health-permission/request`, {});
export const listInstruments = () => apiJson<Instrument[]>(`${CONSOLE}/assessments`);
export const listAttempts = (key: string, params: { q?: string; page?: number; page_size?: number } = {}) =>
  apiJson<AttemptsPage>(`${CONSOLE}/assessments/${key}/attempts${query(params)}`);
export const getInsights = () => apiJson<Insights>(`${CONSOLE}/insights`);

/* ---- Requests & Inbox ---------------------------------------------------- */

export type RequestKind = "contact_us" | "help_question" | "join_beta";
export type RequestStatus = "new" | "in_progress" | "resolved";
export const REQUEST_KIND_LABELS: Record<RequestKind, string> = { contact_us: "Contact Us", help_question: "Help question", join_beta: "Join Beta" };
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = { new: "New", in_progress: "In progress", resolved: "Resolved" };
/* An answer the console sent. `delivery_status` is carried so a reply that
   never left the building is shown as such instead of being assumed delivered. */
export type RequestReply = {
  id: string; body: string; to_email: string; sent_by_name: string;
  delivery_status: "sent" | "failed"; delivery_detail: string | null; created_at: string;
};
export type ConsoleRequest = {
  id: string; kind: RequestKind; kind_label: string; status: RequestStatus; status_label: string; source: "public" | "member";
  member_id: string | null; name: string; email: string; subject: string; message: string; page: string | null;
  created_at: string; updated_at: string; handled_by: string | null; handled_at: string | null; resolution_note: string;
  replies: RequestReply[];
};
export type RequestsPage = { rows: ConsoleRequest[]; total: number; page: number; page_size: number; counts: Record<string, number> };
export type RequestsView = "open" | "all" | "resolved" | "new" | "in_progress";

export const listRequests = (params: { view?: RequestsView; kind?: RequestKind | ""; q?: string; page?: number; page_size?: number } = {}) =>
  apiJson<RequestsPage>(`${CONSOLE}/requests${query(params)}`);
export const getRequest = (id: string) => apiJson<ConsoleRequest>(`${CONSOLE}/requests/${id}`);
export const setRequestStatus = (id: string, status: RequestStatus, resolution_note = "") =>
  postJson<ConsoleRequest>(`${CONSOLE}/requests/${id}/status`, { status, resolution_note });
/* Emails the answer to the address on the request and keeps it there. The
   status is not touched: moving the request on is a separate decision. */
export const replyToRequest = (id: string, body: string) =>
  postJson<ConsoleRequest>(`${CONSOLE}/requests/${id}/reply`, { body });

/* ---- Settings ------------------------------------------------------------ */

export type SupportDetails = { support_email: string; support_phone: string; updated_at: string | null; updated_by: string | null };
export type FeatureState = { key: string; label: string; state: "available" | "holding" | "client_input" | "phase_2"; state_label: string; note: string };
export const getSupportSettings = () => apiJson<SupportDetails>(`${CONSOLE}/settings/product`);
export const saveSupportSettings = (input: { support_email: string; support_phone: string }) => postJson<SupportDetails>(`${CONSOLE}/settings/product`, input, "PUT");
export const getFeatureStates = () => apiJson<FeatureState[]>(`${CONSOLE}/settings/features`);

/* ---- Care Studio --------------------------------------------------------- */

export type CareKind = "fitness" | "supplement" | "resource";
export type CareContentType = "video" | "program" | "article" | "link" | "copy";
export type CareStatus = "Draft" | "Published" | "Archived";
export const CARE_KINDS: CareKind[] = ["fitness", "supplement", "resource"];
export const CARE_KIND_LABELS: Record<CareKind, string> = { fitness: "Fitness", supplement: "Supplements", resource: "Resources" };
/** What one item of each kind is called. Written out because chopping a
 *  trailing "s" off the section name turns Fitness into "fitnes", which is
 *  what the New-item button said. */
export const CARE_ITEM_LABELS: Record<CareKind, string> = { fitness: "fitness", supplement: "supplement", resource: "resource" };
export const CARE_CONTENT_TYPES: CareContentType[] = ["video", "program", "article", "link", "copy"];

export type CareItemInput = {
  kind: CareKind;
  title: string;
  description: string;
  category: string | null;
  content_type: CareContentType;
  youtube_url: string | null;
  external_url: string | null;
  video_object_key: string | null;
  body: string;
  cautions: string | null;
  references: string | null;
  display_order: number;
};

export type CareItem = CareItemInput & {
  id: string;
  youtube_embed_url: string | null;
  status: CareStatus;
  source: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  published_at: string | null;
  published_by: string | null;
};

export type CareKindSummary = { kind: CareKind; label: string; total: number; published: number; draft: number; archived: number };
export type LifecycleAction = "publish" | "unpublish" | "archive" | "restore";

export const getCareSummary = () => apiJson<CareKindSummary[]>(`${CONSOLE}/care/summary`);
export const listCareItems = (kind?: CareKind, status?: string) => apiJson<CareItem[]>(`${CONSOLE}/care/items${query({ kind, status })}`);
export const createCareItem = (input: CareItemInput) => postJson<CareItem>(`${CONSOLE}/care/items`, input);
export const updateCareItem = (id: string, input: CareItemInput) => postJson<CareItem>(`${CONSOLE}/care/items/${id}`, input, "PUT");
export const transitionCareItem = (id: string, action: LifecycleAction) => postJson<CareItem>(`${CONSOLE}/care/items/${id}/${action}`, {});

/* ---- Content ------------------------------------------------------------- */

export type ContentGroup = "help_faq" | "member_copy";
export const CONTENT_GROUPS: ContentGroup[] = ["help_faq", "member_copy"];
export const CONTENT_GROUP_LABELS: Record<ContentGroup, string> = { help_faq: "Help / FAQ", member_copy: "Member educational copy" };

export type ContentEntryInput = { group: ContentGroup; key: string; category: string | null; title: string; body: string; display_order: number };
export type ContentEntry = ContentEntryInput & {
  id: string;
  group_label: string;
  status: CareStatus;
  source: string | null;
  updated_at: string;
  updated_by: string | null;
  published_at: string | null;
  published_by: string | null;
};
export type ContentGroupSummary = { group: ContentGroup; label: string; total: number; published: number; draft: number; archived: number };

export const getContentSummary = () => apiJson<ContentGroupSummary[]>(`${CONSOLE}/content/summary`);
export const listContentEntries = (group?: ContentGroup, status?: string) => apiJson<ContentEntry[]>(`${CONSOLE}/content/entries${query({ group, status })}`);
export const createContentEntry = (input: ContentEntryInput) => postJson<ContentEntry>(`${CONSOLE}/content/entries`, input);
export const updateContentEntry = (id: string, input: ContentEntryInput) => postJson<ContentEntry>(`${CONSOLE}/content/entries/${id}`, input, "PUT");
export const transitionContentEntry = (id: string, action: LifecycleAction) => postJson<ContentEntry>(`${CONSOLE}/content/entries/${id}/${action}`, {});

/* ---- Administrators ------------------------------------------------------
   Who may use the console. There are no roles: every administrator has the
   same console, so a row carries provisioning facts (invitation, last active,
   account state) and never a permission level. */

export type InvitationStatus = "accepted" | "pending" | "expired" | "seeded";
export const INVITATION_LABELS: Record<InvitationStatus, string> = {
  accepted: "Accepted", pending: "Invitation sent", expired: "Invitation expired", seeded: "System account",
};
export const INVITATION_TONES: Record<InvitationStatus, string> = {
  accepted: "live", pending: "draft", expired: "attention", seeded: "archived",
};

export type AdministratorRow = {
  user_id: string;
  name: string;
  email: string;
  invitation_status: InvitationStatus;
  invited_at: string | null;
  invited_by: string | null;
  accepted_at: string | null;
  last_active_at: string | null;
  active_sessions: number;
  is_active: boolean;
  deactivated_at: string | null;
  also_member: boolean;
  is_self: boolean;
  is_synthetic: boolean;
};
export type AdministratorsPage = { rows: AdministratorRow[]; total: number; active: number; pending: number };
export type DeliveryOut = { kind: string; status: string; detail: string | null };
export type AdministratorResult = { row: AdministratorRow; delivery: DeliveryOut | null };
export type AdminAction = "resend" | "revoke-invitation" | "deactivate" | "reactivate";

export const listAdministrators = () => apiJson<AdministratorsPage>(`${CONSOLE}/administrators`);
export const inviteAdministrator = (input: { email: string; first_name: string; last_name: string }) =>
  postJson<AdministratorResult>(`${CONSOLE}/administrators/invite`, input);
export const administratorAction = (userId: string, action: AdminAction) =>
  postJson<AdministratorResult>(`${CONSOLE}/administrators/${userId}/${action}`, {});

/* ---- A member's sign-in account ------------------------------------------
   Account state only: no route here reads or writes an assessment result, and
   no administrator ever sets a password. */

export type MemberAccount = {
  user_id: string;
  email: string;
  pending_email: string | null;
  email_verified: boolean;
  is_active: boolean;
  deactivated_at: string | null;
  active_sessions: number;
  last_session_at: string | null;
  admin_access: boolean;
  is_synthetic: boolean;
};
export type MemberAccountResult = { account: MemberAccount; delivery: DeliveryOut | null; message: string };
export type MemberAccountAction = "deactivate" | "reactivate" | "resend-verification" | "send-password-reset";

export const memberAccountAction = (memberId: string, action: MemberAccountAction) =>
  postJson<MemberAccountResult>(`${CONSOLE}/members/${memberId}/${action}`, {});

/* ---- the administrator's own account -------------------------------------
   The console half of the member's Sign-in details. Acts on the signed-in
   administrator only; it grants nothing and touches no other account. */

export type ConsoleSession = {
  id: string;
  portal: "member" | "admin";
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  remember: boolean;
  current: boolean;
};

export const changeMyConsolePassword = (current_password: string, new_password: string) =>
  postJson<{ ok: boolean; message: string | null }>(`${CONSOLE}/account/password`, { current_password, new_password });
export const listMyConsoleSessions = () =>
  apiJson<{ rows: ConsoleSession[]; current_session_id: string | null }>(`${CONSOLE}/account/sessions`);
export const signOutMyOtherConsoleSessions = () =>
  postJson<{ ok: boolean; message: string | null }>(`${CONSOLE}/account/sessions/revoke-others`, {});

/* ---- account history -----------------------------------------------------
   The audit entries the access controls already write, read back beside the
   controls themselves. Read-only: no screen writes an audit row. */

export type AccountActivity = {
  id: string;
  at: string;
  actor_name: string;
  action: string;
  label: string;
  user_id: string | null;
  email: string | null;
};

export const listAccountActivity = (limit = 20) =>
  apiJson<AccountActivity[]>(`${CONSOLE}/administrators/activity?limit=${limit}`);
