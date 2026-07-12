// osTicket Administration domain types (t42-osticket-c2).
//
// Mirrors the admin-panel structs in
// `src-tauri/crates/sorng-osticket/src/types.rs`: departments, help topics,
// agents/staff, teams, SLA plans, canned responses and custom fields/forms.
//
// IMPORTANT — this crate carries NO `#[serde(rename_all)]`, so every struct
// field serialises with its raw Rust snake_case name. All interface fields below
// are snake_case verbatim; the `request` objects passed to the `osticket_*`
// commands must use these exact keys (`manager_id`, `sla_id`, `is_active`,
// `grace_period`, `field_type`, `form_id`, `member_ids`, …). Only the top-level
// invoke ARGUMENT names (`id`, `deptId`, `agentId`, `request`, …) follow Tauri's
// camelCase conversion — see `useOsticketAdmin`.
//
// Option<T> Rust fields become `field?: T | null`; `#[serde(default)]` bool/Vec
// fields are always present in responses and are typed non-optional.

// ── Attachments ───────────────────────────────────────────────────
// Canned responses carry attachment metadata (Rust `Vec<TicketAttachment>`).
// The ticket-side `TicketAttachment` is owned by the ticketing slice; admin keeps
// its own structurally-identical view so the two category files stay disjoint.
export interface OsticketAttachment {
  id?: number | null;
  name?: string | null;
  size?: number | null;
  content_type?: string | null;
  url?: string | null;
}

// ── Departments ───────────────────────────────────────────────────

export interface OsticketDepartment {
  id?: number | null;
  name?: string | null;
  signature?: string | null;
  manager_id?: number | null;
  sla_id?: number | null;
  email_id?: number | null;
  auto_resp_email_id?: number | null;
  parent_id?: number | null;
  path?: string | null;
  is_active: boolean;
  is_public: boolean;
  created?: string | null;
  updated?: string | null;
}

export interface CreateDepartmentRequest {
  name: string;
  manager_id?: number;
  sla_id?: number;
  email_id?: number;
  parent_id?: number;
  signature?: string;
  is_active?: boolean;
  is_public?: boolean;
}

export interface UpdateDepartmentRequest {
  name?: string;
  manager_id?: number;
  sla_id?: number;
  signature?: string;
  is_active?: boolean;
  is_public?: boolean;
}

// ── Help Topics ───────────────────────────────────────────────────

export interface OsticketTopic {
  id?: number | null;
  name?: string | null;
  dept_id?: number | null;
  priority_id?: number | null;
  sla_id?: number | null;
  auto_resp?: boolean | null;
  status_id?: number | null;
  sort?: number | null;
  is_active: boolean;
  is_public: boolean;
  notes?: string | null;
  created?: string | null;
  updated?: string | null;
}

export interface CreateTopicRequest {
  name: string;
  dept_id?: number;
  priority_id?: number;
  sla_id?: number;
  auto_resp?: boolean;
  is_active?: boolean;
  is_public?: boolean;
  notes?: string;
}

export interface UpdateTopicRequest {
  name?: string;
  dept_id?: number;
  priority_id?: number;
  sla_id?: number;
  auto_resp?: boolean;
  is_active?: boolean;
  is_public?: boolean;
}

// ── Agents (Staff) ────────────────────────────────────────────────

export interface OsticketAgent {
  id?: number | null;
  username?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  signature?: string | null;
  dept_id?: number | null;
  role_id?: number | null;
  timezone?: string | null;
  is_admin: boolean;
  is_active: boolean;
  is_visible: boolean;
  on_vacation: boolean;
  created?: string | null;
  updated?: string | null;
  last_login?: string | null;
  permissions: string[];
}

export interface CreateAgentRequest {
  username: string;
  firstname: string;
  lastname: string;
  email: string;
  password: string;
  phone?: string;
  dept_id?: number;
  role_id?: number;
  timezone?: string;
  is_admin?: boolean;
  is_active?: boolean;
}

export interface UpdateAgentRequest {
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  dept_id?: number;
  role_id?: number;
  is_active?: boolean;
  on_vacation?: boolean;
  signature?: string;
}

// ── Teams ─────────────────────────────────────────────────────────

export interface TeamMember {
  staff_id: number;
  name?: string | null;
}

export interface OsticketTeam {
  id?: number | null;
  name?: string | null;
  lead_id?: number | null;
  is_active: boolean;
  notes?: string | null;
  created?: string | null;
  updated?: string | null;
  members: TeamMember[];
}

export interface CreateTeamRequest {
  name: string;
  lead_id?: number;
  is_active?: boolean;
  notes?: string;
  member_ids?: number[];
}

export interface UpdateTeamRequest {
  name?: string;
  lead_id?: number;
  is_active?: boolean;
  notes?: string;
  member_ids?: number[];
}

// ── SLA Plans ─────────────────────────────────────────────────────

export interface OsticketSla {
  id?: number | null;
  name?: string | null;
  grace_period?: number | null;
  notes?: string | null;
  is_active: boolean;
  disable_overdue_alerts: boolean;
  transient: boolean;
  created?: string | null;
  updated?: string | null;
}

export interface CreateSlaRequest {
  name: string;
  grace_period: number;
  notes?: string;
  is_active?: boolean;
  disable_overdue_alerts?: boolean;
  transient?: boolean;
}

export interface UpdateSlaRequest {
  name?: string;
  grace_period?: number;
  notes?: string;
  is_active?: boolean;
  disable_overdue_alerts?: boolean;
}

// ── Canned Responses ──────────────────────────────────────────────

export interface OsticketCannedResponse {
  id?: number | null;
  title?: string | null;
  response?: string | null;
  dept_id?: number | null;
  is_active: boolean;
  notes?: string | null;
  created?: string | null;
  updated?: string | null;
  attachments: OsticketAttachment[];
}

export interface CreateCannedResponseRequest {
  title: string;
  response: string;
  dept_id?: number;
  is_active?: boolean;
  notes?: string;
}

export interface UpdateCannedResponseRequest {
  title?: string;
  response?: string;
  dept_id?: number;
  is_active?: boolean;
  notes?: string;
}

// ── Custom Fields / Forms ─────────────────────────────────────────

export interface OsticketCustomField {
  id?: number | null;
  name?: string | null;
  label?: string | null;
  field_type?: string | null;
  form_id?: number | null;
  sort?: number | null;
  required: boolean;
  private: boolean;
  editable: boolean;
  hint?: string | null;
  /** Rust `serde_json::Value` — arbitrary field-type configuration. */
  configuration?: unknown;
  created?: string | null;
  updated?: string | null;
}

export interface OsticketForm {
  id?: number | null;
  title?: string | null;
  instructions?: string | null;
  notes?: string | null;
  fields: OsticketCustomField[];
  created?: string | null;
  updated?: string | null;
}

export interface CreateCustomFieldRequest {
  name: string;
  label: string;
  field_type: string;
  form_id: number;
  required?: boolean;
  private?: boolean;
  editable?: boolean;
  hint?: string;
  configuration?: unknown;
}

export interface UpdateCustomFieldRequest {
  label?: string;
  required?: boolean;
  private?: boolean;
  editable?: boolean;
  hint?: string;
  configuration?: unknown;
}
