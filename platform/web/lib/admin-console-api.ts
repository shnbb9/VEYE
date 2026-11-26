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
  questions_awaiting_reply: number;
  attention_waiting: number;
  mood_entries_total: number;
  food_diary_entries_total: number;
  recent_members: { member_id: string; name: string; email: string; joined_at: string; email_verified: boolean; is_synthetic: boolean }[];
  recent_activity: { at: string; member_id: string; member_name: string; kind: string; summary: string }[];
  generated_at: string;
};

export type Priority = "high" | "medium" | "low";

/** The change between a member's two latest Health Numbers. Lower is better. */
export type MemberTrend = {
  state: "improved" | "worsened" | "unchanged" | "first" | "not_comparable" | "none" | "not_shared";
  delta: number | null; current: number | null; previous: number | null; current_at: string | null; previous_at: string | null;
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
  /** null = withheld with the rest of the records. */
  trackers_completed: number | null;
  trend: MemberTrend;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
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
  /* The console's view (architecture V2 §4.2): may it ask now, why not, and
     what happened to the email that carried the last request. */
  email_verified?: boolean | null;
  can_request?: boolean | null;
  cannot_request_reason?: string | null;
  requires_reason?: boolean | null;
  next_request_at?: string | null;
  delivery?: { status: string; attempts: number; last_error: string | null; sent_at: string | null; next_attempt_at: string | null; to_email: string } | null;
};

export type MembersPage = {
  rows: MemberRow[]; total: number; page: number; page_size: number;
  segments: { prospects: number; unverified: number; onboarding_incomplete: number; invitations_pending: number; archived: number };
  trends: Record<MemberTrend["state"], number>;
};

export type MembersQuery = {
  q?: string;
  status?: "any" | "active" | "inactive" | "unverified";
  onboarding?: "any" | "complete" | "not_started";
  active?: "any" | "week" | "month" | "longer" | "never";
  sharing?: "any" | HealthPermission["state"];
  trend?: "any" | MemberTrend["state"];
  result_within?: number;
  archived?: "exclude" | "include" | "only";
  sort?: "name" | "joined" | "health_number" | "last_active" | "sharing" | "trend";
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
  food_diary: { id: string; entry_date: string; meal_time: string; description: string; feelings: string[]; notes: string; created_at: string; updated_at: string; photo_version?: string | null }[];
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

/** A meal's photo, served only under its own member. */
export const memberMealPhotoUrl = (memberId: string, mealId: string, version: string, size: "thumb" | "full" = "thumb") =>
  apiPath(`${CONSOLE}/members/${memberId}/food-diary/${mealId}/photo?size=${size}&v=${encodeURIComponent(version)}`);

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
  starts: number;
  starts_unfinished: number;
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
  retention: Retention;
  getting_started: { joined: number; verified: number; onboarding_complete: number; food_choices_started: number };
  generated_at: string;
};

export type Retention = {
  recorded_since: string | null; members: number; joined_last_30_days: number; active_last_7_days: number; active_last_30_days: number;
  inactive: number | null; returned: { days: number; eligible: number; returned: number }[];
  engagement_judged_after_days: number; engagement_members: number; engagement_median_days: number | null;
  engagement: { label: string; members: number }[]; not_measured: number;
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
export const requestHealthPermission = (memberId: string, reason?: string) =>
  postJson<HealthPermission>(`${CONSOLE}/members/${memberId}/health-permission/request`, reason ? { reason } : {});
/* Re-deliver the email of the open request after a refused send; never a second ask. */
export const resendHealthPermissionEmail = (memberId: string) =>
  postJson<HealthPermission>(`${CONSOLE}/members/${memberId}/health-permission/resend`, {});
export const listInstruments = () => apiJson<Instrument[]>(`${CONSOLE}/assessments`);
export const listAttempts = (key: string, params: { q?: string; page?: number; page_size?: number } = {}) =>
  apiJson<AttemptsPage>(`${CONSOLE}/assessments/${key}/attempts${query(params)}`);
export const getInsights = () => apiJson<Insights>(`${CONSOLE}/insights`);

/* ---- Requests & Inbox ---------------------------------------------------- */

export type RequestKind = "contact_us" | "help_question" | "join_beta";
export type RequestStatus = "new" | "in_progress" | "resolved";
/** Whether a person has answered — the status does not say. */
export type ReplyState = "waiting" | "failed" | "replied" | "resolved";
export const REQUEST_KIND_LABELS: Record<RequestKind, string> = { contact_us: "Contact Us", help_question: "Help question", join_beta: "Join Beta" };
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = { new: "New", in_progress: "In progress", resolved: "Resolved" };
/* An answer the console sent. `delivery_status` is carried so a reply that
   never left the building is shown as such instead of being assumed delivered. */
export type RequestReply = {
  id: string; body: string; to_email: string; sent_by_name: string;
  delivery_status: "sent" | "failed"; delivery_detail: string | null; created_at: string;
};
/* The email that told the team's support address this request arrived. */
export type TeamNotice = {
  status: "queued" | "sending" | "retry" | "sent" | "failed" | "skipped"; to_email: string; sent_at: string | null; detail: string | null;
};
export type ConsoleRequest = {
  id: string; kind: RequestKind; kind_label: string; status: RequestStatus; status_label: string; source: "public" | "member";
  member_id: string | null; name: string; email: string; subject: string; message: string; page: string | null;
  created_at: string; updated_at: string; handled_by: string | null; handled_at: string | null; resolution_note: string;
  priority: Priority | null; reply_state: ReplyState;
  replies: RequestReply[];
  // None for requests that came in before the team was emailed about them.
  team_notice?: TeamNotice | null;
};
export type RequestsPage = { rows: ConsoleRequest[]; total: number; page: number; page_size: number; counts: Record<string, number> };
export type RequestsView = "open" | "all" | "resolved" | "new" | "in_progress" | "awaiting_reply";

export const listRequests = (params: { view?: RequestsView; kind?: RequestKind | ""; source?: "member" | "public" | ""; priority?: Priority | "unassigned" | ""; q?: string; page?: number; page_size?: number } = {}) =>
  apiJson<RequestsPage>(`${CONSOLE}/requests${query(params)}`);
export const getRequest = (id: string) => apiJson<ConsoleRequest>(`${CONSOLE}/requests/${id}`);
export const setRequestStatus = (id: string, status: RequestStatus, resolution_note = "") =>
  postJson<ConsoleRequest>(`${CONSOLE}/requests/${id}/status`, { status, resolution_note });
export const setRequestPriority = (id: string, priority: Priority | null) => postJson<ConsoleRequest>(`${CONSOLE}/requests/${id}/priority`, { priority }, "PUT");
/* Emails the answer to the address on the request and keeps it there. The
   status is not touched: moving the request on is a separate decision. */
export const replyToRequest = (id: string, body: string) =>
  postJson<ConsoleRequest>(`${CONSOLE}/requests/${id}/reply`, { body });

/* ---- Needs your attention -------------------------------------------------- */

export type AttentionItem = {
  source: "request" | "conversation"; id: string; title: string; detail: string; person: string;
  state: "reply_needed" | "reply_failed" | "review_needed" | "replied" | "reviewed" | "resolved";
  person_kind: "member" | "visitor" | "former"; member_id: string | null; priority: Priority | null; at: string;
};
export type AttentionPage = { rows: AttentionItem[]; total: number; page: number; page_size: number; counts: Record<string, number> };
export type AttentionQuery = { state?: "waiting" | AttentionItem["state"] | "all"; who?: "any" | "member" | "visitor"; priority?: "any" | Priority | "unassigned"; page?: number; page_size?: number };
export const getAttention = (params: AttentionQuery = {}) => apiJson<AttentionPage>(`${CONSOLE}/attention${query(params)}`);

/* ---- Member invitations and archiving --------------------------------------- */

export type MemberInvitation = {
  id: string; email: string; name: string; status: "pending" | "accepted" | "expired" | "revoked"; status_label: string; invited_by: string;
  created_at: string; last_sent_at: string | null; sent_count: number; expires_at: string; accepted_at: string | null; revoked_at: string | null;
  member_id: string | null; delivery: string | null; delivery_error: string | null;
};
export type MemberInvitationsPage = { rows: MemberInvitation[]; total: number; page: number; page_size: number; counts: Record<MemberInvitation["status"], number> };
export const listMemberInvitations = (params: { q?: string; status?: string; sort?: string; page?: number } = {}) =>
  apiJson<MemberInvitationsPage>(`${CONSOLE}/member-invitations${query(params)}`);
export const inviteMember = (input: { email: string; first_name: string; last_name: string }) => postJson<MemberInvitation>(`${CONSOLE}/member-invitations`, input);
export const resendMemberInvitation = (id: string) => postJson<MemberInvitation>(`${CONSOLE}/member-invitations/${id}/resend`, {});
export const revokeMemberInvitation = (id: string) => postJson<MemberInvitation>(`${CONSOLE}/member-invitations/${id}/revoke`, {});
export type ArchiveResult = { archived_at: string | null; archived_by: string | null; archive_reason: string | null; message: string };
export const archiveMember = (memberId: string, reason: string) => postJson<ArchiveResult>(`${CONSOLE}/members/${memberId}/archive`, { reason });
export const restoreMember = (memberId: string) => postJson<ArchiveResult>(`${CONSOLE}/members/${memberId}/restore`, {});

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
/** `categories` is the vocabulary the API accepts for the group: the Help
 *  page's five chips for help_faq, and empty (free text) for member_copy. */
export type ContentGroupSummary = { group: ContentGroup; label: string; total: number; published: number; draft: number; archived: number; categories: string[] };

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
  /** Changes when that administrator's own picture changes; null = initials. */
  photo_version: string | null;
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

/* ---- the administrator's own picture and member profile (V2 §5) -------------- */
/* One picture per sign-in account: a person with both kinds of access has the
   same avatar in both portals. Only the signed-in account's own picture can
   be changed here. */
export const myConsolePhotoUrl = (version: string, size: "full" | "thumb" | "original" = "thumb") =>
  apiPath(`/api/v1/admin/account/photo?size=${size}&v=${encodeURIComponent(version)}`);
export const administratorPhotoUrl = (userId: string, version: string) =>
  apiPath(`/api/v1/admin/administrators/${userId}/photo?size=thumb&v=${encodeURIComponent(version)}`);
/** A new picture; the avatar is cut from `crop` (the centred square without one). */
export async function uploadMyConsolePhoto(file: File, crop?: { x: number; y: number; size: number }) {
  const body = new FormData();
  body.append("file", file);
  if (crop) {
    body.append("crop_x", String(crop.x));
    body.append("crop_y", String(crop.y));
    body.append("crop_size", String(crop.size));
  }
  return apiJson<import("@/lib/auth-api").Account>("/api/v1/admin/account/photo", { method: "POST", body });
}
/** Cut the avatar again from the kept original — no new upload. */
export const recropMyConsolePhoto = (crop: { x: number; y: number; size: number }) =>
  postJson<import("@/lib/auth-api").Account>("/api/v1/admin/account/photo/crop", crop, "PUT");
export const removeMyConsolePhoto = () => apiJson<import("@/lib/auth-api").Account>("/api/v1/admin/account/photo", { method: "DELETE" });
export const createMyMemberProfile = (password: string) =>
  postJson<{ member_id: string; created: boolean; message: string }>("/api/v1/admin/account/member-profile", { password, understood: true });

/* ---- the Fitness library (15 Nov 2026) ---------------------------------------
   The console's side of the member Fitness screen: YouTube or Vimeo links per
   goal, one main video per goal, shown or hidden, in the console's order. */
export type FitnessGoalKey = "stronger" | "weight" | "fit" | "performance";
export type AdminFitnessVideo = {
  id: string; goal: FitnessGoalKey; provider: "youtube" | "vimeo"; title: string; subtitle: string; embed_url: string;
  watch_url: string; thumbnail_url: string | null; is_main: boolean; url: string; position: number; published: boolean;
  updated_at: string; updated_by: string | null;
};
export type AdminFitnessLibrary = { goal: FitnessGoalKey; goals: { key: FitnessGoalKey; label: string; count: number }[]; videos: AdminFitnessVideo[] };
const FITNESS = "/api/v1/admin/fitness/videos";
export const getAdminFitnessLibrary = (goal: FitnessGoalKey) => apiJson<AdminFitnessLibrary>(`${FITNESS}?goal=${goal}`);
export const addFitnessVideo = (input: { goal: FitnessGoalKey; url: string; title: string; subtitle: string }) =>
  postJson<AdminFitnessLibrary>(FITNESS, input);
export const updateFitnessVideo = (id: string, change: { title?: string; subtitle?: string; published?: boolean }) =>
  postJson<AdminFitnessLibrary>(`${FITNESS}/${id}`, change, "PATCH");
export const makeMainFitnessVideo = (id: string) => postJson<AdminFitnessLibrary>(`${FITNESS}/${id}/main`, {});
export const reorderFitnessVideos = (goal: FitnessGoalKey, ids: string[]) => postJson<AdminFitnessLibrary>(`${FITNESS}/order`, { goal, ids }, "PUT");
export const removeFitnessVideo = (id: string) => apiJson<AdminFitnessLibrary>(`${FITNESS}/${id}`, { method: "DELETE" });
