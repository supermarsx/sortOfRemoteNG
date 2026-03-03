// ── sorng-osticket/src/types.rs ────────────────────────────────────────────────
use serde::{Deserialize, Serialize};

// ── Connection ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketConnectionConfig {
    pub name: String,
    /// Base URL, e.g. <https://helpdesk.example.com>
    pub host: String,
    /// API key created in osTicket admin
    pub api_key: String,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    #[serde(default)]
    pub skip_tls_verify: bool,
}

fn default_timeout() -> u64 { 30 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketConnectionStatus {
    pub connected: bool,
    pub version: Option<String>,
    pub message: Option<String>,
}

// ── Tickets ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketTicket {
    pub id: Option<i64>,
    pub number: Option<String>,
    pub subject: Option<String>,
    pub status: Option<String>,
    pub status_id: Option<i64>,
    pub priority: Option<String>,
    pub priority_id: Option<i64>,
    pub department: Option<String>,
    pub department_id: Option<i64>,
    pub topic: Option<String>,
    pub topic_id: Option<i64>,
    pub user: Option<String>,
    pub user_id: Option<i64>,
    pub staff: Option<String>,
    pub staff_id: Option<i64>,
    pub team: Option<String>,
    pub team_id: Option<i64>,
    pub sla: Option<String>,
    pub sla_id: Option<i64>,
    pub due_date: Option<String>,
    pub close_date: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub source: Option<String>,
    pub ip_address: Option<String>,
    #[serde(default)]
    pub is_overdue: bool,
    #[serde(default)]
    pub is_answered: bool,
    #[serde(default)]
    pub threads: Vec<TicketThread>,
    #[serde(default)]
    pub collaborators: Vec<TicketCollaborator>,
    #[serde(default)]
    pub attachments: Vec<TicketAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketThread {
    pub id: Option<i64>,
    pub thread_type: Option<String>,
    pub poster: Option<String>,
    pub body: Option<String>,
    pub created: Option<String>,
    pub title: Option<String>,
    #[serde(default)]
    pub attachments: Vec<TicketAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketCollaborator {
    pub user_id: Option<i64>,
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketAttachment {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub size: Option<u64>,
    pub content_type: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTicketRequest {
    pub name: String,
    pub email: String,
    pub subject: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dept_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sla_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_respond: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub internal_note: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<CreateAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAttachment {
    pub filename: String,
    /// Base64-encoded content
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTicketRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dept_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sla_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostThreadRequest {
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<CreateAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketSearchRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dept_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_overdue: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketSearchResponse {
    #[serde(default)]
    pub tickets: Vec<OsticketTicket>,
    pub total: Option<u64>,
    pub page: Option<u32>,
    pub pages: Option<u32>,
}

// ── Users ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketUser {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub notes: Option<String>,
    pub status: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub org_id: Option<i64>,
    pub default_email_id: Option<i64>,
    #[serde(default)]
    pub emails: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub name: String,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<i64>,
}

// ── Departments ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketDepartment {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub signature: Option<String>,
    pub manager_id: Option<i64>,
    pub sla_id: Option<i64>,
    pub email_id: Option<i64>,
    pub auto_resp_email_id: Option<i64>,
    pub parent_id: Option<i64>,
    pub path: Option<String>,
    #[serde(default)]
    pub is_active: bool,
    #[serde(default)]
    pub is_public: bool,
    pub created: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDepartmentRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manager_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sla_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateDepartmentRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manager_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sla_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
}

// ── Help Topics ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketTopic {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub dept_id: Option<i64>,
    pub priority_id: Option<i64>,
    pub sla_id: Option<i64>,
    pub auto_resp: Option<bool>,
    pub status_id: Option<i64>,
    pub sort: Option<i32>,
    #[serde(default)]
    pub is_active: bool,
    #[serde(default)]
    pub is_public: bool,
    pub notes: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTopicRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dept_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sla_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_resp: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTopicRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dept_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sla_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_resp: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
}

// ── Agents (Staff) ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketAgent {
    pub id: Option<i64>,
    pub username: Option<String>,
    pub firstname: Option<String>,
    pub lastname: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub signature: Option<String>,
    pub dept_id: Option<i64>,
    pub role_id: Option<i64>,
    pub timezone: Option<String>,
    #[serde(default)]
    pub is_admin: bool,
    #[serde(default)]
    pub is_active: bool,
    #[serde(default)]
    pub is_visible: bool,
    #[serde(default)]
    pub on_vacation: bool,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub last_login: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAgentRequest {
    pub username: String,
    pub firstname: String,
    pub lastname: String,
    pub email: String,
    pub password: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dept_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_admin: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAgentRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub firstname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lastname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dept_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_vacation: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

// ── Teams ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketTeam {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub lead_id: Option<i64>,
    #[serde(default)]
    pub is_active: bool,
    pub notes: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    #[serde(default)]
    pub members: Vec<TeamMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub staff_id: i64,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTeamRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lead_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub member_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTeamRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lead_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub member_ids: Option<Vec<i64>>,
}

// ── SLA Plans ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketSla {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub grace_period: Option<i32>,
    pub notes: Option<String>,
    #[serde(default)]
    pub is_active: bool,
    #[serde(default)]
    pub disable_overdue_alerts: bool,
    #[serde(default)]
    pub transient: bool,
    pub created: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSlaRequest {
    pub name: String,
    pub grace_period: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disable_overdue_alerts: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transient: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSlaRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grace_period: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disable_overdue_alerts: Option<bool>,
}

// ── Canned Responses ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketCannedResponse {
    pub id: Option<i64>,
    pub title: Option<String>,
    pub response: Option<String>,
    pub dept_id: Option<i64>,
    #[serde(default)]
    pub is_active: bool,
    pub notes: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    #[serde(default)]
    pub attachments: Vec<TicketAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCannedResponseRequest {
    pub title: String,
    pub response: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dept_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCannedResponseRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dept_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

// ── Custom Fields ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketCustomField {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub label: Option<String>,
    pub field_type: Option<String>,
    pub form_id: Option<i64>,
    pub sort: Option<i32>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub editable: bool,
    pub hint: Option<String>,
    pub configuration: Option<serde_json::Value>,
    pub created: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsticketForm {
    pub id: Option<i64>,
    pub title: Option<String>,
    pub instructions: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub fields: Vec<OsticketCustomField>,
    pub created: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCustomFieldRequest {
    pub name: String,
    pub label: String,
    pub field_type: String,
    pub form_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub editable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configuration: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCustomFieldRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub editable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configuration: Option<serde_json::Value>,
}

// ── Pagination ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OsticketPagination {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}
