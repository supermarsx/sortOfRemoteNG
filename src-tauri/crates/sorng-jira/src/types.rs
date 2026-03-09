// ── sorng-jira/src/types.rs ────────────────────────────────────────────────────
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Connection ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JiraAuthMethod {
    Basic { username: String, password: String },
    ApiToken { email: String, token: String },
    Bearer { token: String },
    Pat { token: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraConnectionConfig {
    pub name: String,
    /// e.g. <https://myorg.atlassian.net> or <https://jira.corp.com>
    pub host: String,
    pub auth: JiraAuthMethod,
    #[serde(default = "default_api")]
    pub api_version: String,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    #[serde(default)]
    pub skip_tls_verify: bool,
}

fn default_timeout() -> u64 {
    30
}
fn default_api() -> String {
    "2".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraConnectionStatus {
    pub connected: bool,
    pub server_title: Option<String>,
    pub version: Option<String>,
    pub deployment_type: Option<String>,
    pub message: Option<String>,
}

// ── Issues ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraIssue {
    #[serde(default)]
    pub id: String,
    #[serde(rename = "self", default)]
    pub self_url: String,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub fields: HashMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changelog: Option<JiraChangelog>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rendered_fields: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transitions: Option<Vec<JiraTransition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraChangelog {
    #[serde(default)]
    pub histories: Vec<JiraChangelogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraChangelogEntry {
    pub id: Option<String>,
    pub created: Option<String>,
    pub author: Option<JiraUser>,
    #[serde(default)]
    pub items: Vec<JiraChangeItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraChangeItem {
    pub field: Option<String>,
    pub fieldtype: Option<String>,
    #[serde(rename = "fromString")]
    pub from_string: Option<String>,
    #[serde(rename = "toString")]
    pub to_string: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIssueRequest {
    pub fields: HashMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateIssueRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkCreateIssueRequest {
    #[serde(rename = "issueUpdates")]
    pub issue_updates: Vec<CreateIssueRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkCreateIssueResponse {
    #[serde(default)]
    pub issues: Vec<JiraIssue>,
    #[serde(default)]
    pub errors: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraTransition {
    pub id: String,
    pub name: Option<String>,
    pub to: Option<JiraStatus>,
    #[serde(default)]
    pub fields: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransitionRequest {
    pub transition: TransitionId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransitionId {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraSearchRequest {
    pub jql: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_at: Option<u32>,
    #[serde(rename = "maxResults", skip_serializing_if = "Option::is_none")]
    pub max_results: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expand: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraSearchResponse {
    #[serde(rename = "startAt", default)]
    pub start_at: u32,
    #[serde(rename = "maxResults", default)]
    pub max_results: u32,
    #[serde(default)]
    pub total: u32,
    #[serde(default)]
    pub issues: Vec<JiraIssue>,
}

// ── Status / Priority ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraStatus {
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "statusCategory")]
    pub status_category: Option<JiraStatusCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraStatusCategory {
    pub id: Option<i64>,
    pub key: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "colorName")]
    pub color_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraPriority {
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "iconUrl")]
    pub icon_url: Option<String>,
}

// ── Projects ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraProject {
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub id: Option<String>,
    pub key: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub lead: Option<JiraUser>,
    #[serde(rename = "projectTypeKey")]
    pub project_type_key: Option<String>,
    #[serde(rename = "avatarUrls")]
    pub avatar_urls: Option<HashMap<String, String>>,
    #[serde(rename = "issueTypes", default)]
    pub issue_types: Vec<JiraIssueType>,
    pub url: Option<String>,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraIssueType {
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub subtask: Option<bool>,
    #[serde(rename = "iconUrl")]
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub key: String,
    pub name: String,
    #[serde(rename = "projectTypeKey")]
    pub project_type_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lead_account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(rename = "assigneeType", skip_serializing_if = "Option::is_none")]
    pub assignee_type: Option<String>,
}

// ── Comments ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraComment {
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub id: Option<String>,
    pub author: Option<JiraUser>,
    #[serde(rename = "updateAuthor")]
    pub update_author: Option<JiraUser>,
    pub body: Option<serde_json::Value>,
    pub created: Option<String>,
    pub updated: Option<String>,
    #[serde(rename = "jsdPublic")]
    pub jsd_public: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddCommentRequest {
    pub body: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<CommentVisibility>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentVisibility {
    #[serde(rename = "type")]
    pub vis_type: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentsResponse {
    #[serde(rename = "startAt", default)]
    pub start_at: u32,
    #[serde(rename = "maxResults", default)]
    pub max_results: u32,
    #[serde(default)]
    pub total: u32,
    #[serde(default)]
    pub comments: Vec<JiraComment>,
}

// ── Attachments ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraAttachment {
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub id: Option<String>,
    pub filename: Option<String>,
    pub author: Option<JiraUser>,
    pub created: Option<String>,
    pub size: Option<u64>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    pub content: Option<String>,
    pub thumbnail: Option<String>,
}

// ── Worklogs ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraWorklog {
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub id: Option<String>,
    pub author: Option<JiraUser>,
    #[serde(rename = "updateAuthor")]
    pub update_author: Option<JiraUser>,
    pub comment: Option<serde_json::Value>,
    pub started: Option<String>,
    #[serde(rename = "timeSpent")]
    pub time_spent: Option<String>,
    #[serde(rename = "timeSpentSeconds")]
    pub time_spent_seconds: Option<i64>,
    pub created: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddWorklogRequest {
    #[serde(rename = "timeSpentSeconds", skip_serializing_if = "Option::is_none")]
    pub time_spent_seconds: Option<i64>,
    #[serde(rename = "timeSpent", skip_serializing_if = "Option::is_none")]
    pub time_spent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorklogsResponse {
    #[serde(rename = "startAt", default)]
    pub start_at: u32,
    #[serde(rename = "maxResults", default)]
    pub max_results: u32,
    #[serde(default)]
    pub total: u32,
    #[serde(default)]
    pub worklogs: Vec<JiraWorklog>,
}

// ── Users ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraUser {
    #[serde(rename = "self", default)]
    pub self_url: String,
    #[serde(rename = "accountId")]
    pub account_id: Option<String>,
    #[serde(rename = "emailAddress")]
    pub email_address: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    pub active: Option<bool>,
    #[serde(rename = "avatarUrls")]
    pub avatar_urls: Option<HashMap<String, String>>,
    pub key: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "timeZone")]
    pub time_zone: Option<String>,
}

// ── Boards (Agile) ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraBoard {
    pub id: i64,
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub board_type: Option<String>,
    pub location: Option<BoardLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardLocation {
    #[serde(rename = "projectId")]
    pub project_id: Option<i64>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "projectName")]
    pub project_name: Option<String>,
    #[serde(rename = "projectKey")]
    pub project_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardsResponse {
    #[serde(rename = "maxResults", default)]
    pub max_results: u32,
    #[serde(rename = "startAt", default)]
    pub start_at: u32,
    #[serde(default)]
    pub total: Option<u32>,
    #[serde(rename = "isLast", default)]
    pub is_last: bool,
    #[serde(default)]
    pub values: Vec<JiraBoard>,
}

// ── Sprints (Agile) ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraSprint {
    pub id: i64,
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub name: Option<String>,
    pub state: Option<String>,
    #[serde(rename = "startDate")]
    pub start_date: Option<String>,
    #[serde(rename = "endDate")]
    pub end_date: Option<String>,
    #[serde(rename = "completeDate")]
    pub complete_date: Option<String>,
    #[serde(rename = "originBoardId")]
    pub origin_board_id: Option<i64>,
    pub goal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SprintsResponse {
    #[serde(rename = "maxResults", default)]
    pub max_results: u32,
    #[serde(rename = "startAt", default)]
    pub start_at: u32,
    #[serde(rename = "isLast", default)]
    pub is_last: bool,
    #[serde(default)]
    pub values: Vec<JiraSprint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSprintRequest {
    pub name: String,
    #[serde(rename = "originBoardId")]
    pub origin_board_id: i64,
    #[serde(rename = "startDate", skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(rename = "endDate", skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSprintRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(rename = "startDate", skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(rename = "endDate", skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveIssuesToSprintRequest {
    pub issues: Vec<String>,
}

// ── Fields ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraField {
    pub id: Option<String>,
    pub name: Option<String>,
    pub custom: Option<bool>,
    pub orderable: Option<bool>,
    pub navigable: Option<bool>,
    pub searchable: Option<bool>,
    #[serde(rename = "clauseNames", default)]
    pub clause_names: Vec<String>,
    pub schema: Option<JiraFieldSchema>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraFieldSchema {
    #[serde(rename = "type")]
    pub field_type: Option<String>,
    pub system: Option<String>,
    pub custom: Option<String>,
    #[serde(rename = "customId")]
    pub custom_id: Option<i64>,
}

// ── Dashboards ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraDashboard {
    pub id: Option<String>,
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub name: Option<String>,
    pub owner: Option<JiraUser>,
    #[serde(rename = "isFavourite")]
    pub is_favourite: Option<bool>,
    pub popularity: Option<i64>,
    pub view: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardsResponse {
    #[serde(rename = "startAt", default)]
    pub start_at: u32,
    #[serde(rename = "maxResults", default)]
    pub max_results: u32,
    #[serde(default)]
    pub total: u32,
    #[serde(default)]
    pub dashboards: Vec<JiraDashboard>,
}

// ── Filters ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraFilter {
    #[serde(rename = "self", default)]
    pub self_url: String,
    pub id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub jql: Option<String>,
    pub owner: Option<JiraUser>,
    #[serde(rename = "viewUrl")]
    pub view_url: Option<String>,
    #[serde(rename = "searchUrl")]
    pub search_url: Option<String>,
    pub favourite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFilterRequest {
    pub name: String,
    pub jql: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favourite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFilterRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jql: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favourite: Option<bool>,
}
