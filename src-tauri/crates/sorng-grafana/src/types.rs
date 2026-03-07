//! Shared types for Grafana management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaConnectionConfig {
    pub host: String,
    pub port: Option<u16>,
    pub scheme: Option<String>,
    pub api_key: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub org_id: Option<i64>,
    pub tls_verify: Option<bool>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub edition: Option<String>,
    pub database_type: Option<String>,
    pub license_status: Option<String>,
    pub org_name: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboards
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaDashboard {
    pub id: Option<i64>,
    pub uid: Option<String>,
    pub title: String,
    pub slug: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub tags: Vec<String>,
    pub is_starred: Option<bool>,
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub folder_title: Option<String>,
    pub sort_meta: Option<i64>,
    pub provisioned: Option<bool>,
    pub provisioned_external_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardDetail {
    pub meta: DashboardMeta,
    pub dashboard: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMeta {
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub can_save: Option<bool>,
    pub can_edit: Option<bool>,
    pub can_admin: Option<bool>,
    pub can_star: Option<bool>,
    pub can_delete: Option<bool>,
    pub slug: Option<String>,
    pub url: Option<String>,
    pub expires: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub updated_by: Option<String>,
    pub created_by: Option<String>,
    pub version: Option<i64>,
    pub has_acl: Option<bool>,
    pub is_folder: Option<bool>,
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub folder_title: Option<String>,
    pub folder_url: Option<String>,
    pub provisioned: Option<bool>,
    pub provisioned_external_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDashboardRequest {
    pub dashboard: serde_json::Value,
    pub folder_uid: Option<String>,
    pub message: Option<String>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardVersion {
    pub id: Option<i64>,
    pub dashboard_id: Option<i64>,
    pub parent_version: Option<i64>,
    pub restored_from: Option<i64>,
    pub version: Option<i64>,
    pub created: Option<String>,
    pub created_by: Option<String>,
    pub message: Option<String>,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardPermission {
    pub dashboard_id: Option<i64>,
    pub role: Option<String>,
    pub permission: Option<i64>,
    pub team_id: Option<i64>,
    pub user_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchDashboardRequest {
    pub query: Option<String>,
    pub tag: Option<Vec<String>>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub dashboard_ids: Option<Vec<i64>>,
    pub folder_ids: Option<Vec<i64>>,
    pub starred: Option<bool>,
    pub limit: Option<i64>,
    pub page: Option<i64>,
    pub sort: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Datasources
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrafanaDatasource {
    pub id: Option<i64>,
    pub uid: Option<String>,
    pub org_id: Option<i64>,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub type_logo_url: Option<String>,
    pub access: Option<String>,
    pub url: Option<String>,
    pub user: Option<String>,
    pub database: Option<String>,
    pub basic_auth: Option<bool>,
    pub basic_auth_user: Option<String>,
    pub with_credentials: Option<bool>,
    pub is_default: Option<bool>,
    pub json_data: Option<serde_json::Value>,
    pub secure_json_fields: Option<HashMap<String, bool>>,
    pub version: Option<i64>,
    pub read_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDatasourceRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub url: Option<String>,
    pub access: Option<String>,
    pub database: Option<String>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub basic_auth: Option<bool>,
    pub basic_auth_user: Option<String>,
    pub basic_auth_password: Option<String>,
    pub with_credentials: Option<bool>,
    pub is_default: Option<bool>,
    pub json_data: Option<serde_json::Value>,
    pub secure_json_data: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateDatasourceRequest {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub url: Option<String>,
    pub access: Option<String>,
    pub database: Option<String>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub basic_auth: Option<bool>,
    pub basic_auth_user: Option<String>,
    pub basic_auth_password: Option<String>,
    pub with_credentials: Option<bool>,
    pub is_default: Option<bool>,
    pub json_data: Option<serde_json::Value>,
    pub secure_json_data: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasourceHealth {
    pub status: Option<String>,
    pub message: Option<String>,
    pub duration_ms: Option<f64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Folders
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaFolder {
    pub id: Option<i64>,
    pub uid: Option<String>,
    pub title: String,
    pub url: Option<String>,
    pub has_acl: Option<bool>,
    pub can_save: Option<bool>,
    pub can_edit: Option<bool>,
    pub can_admin: Option<bool>,
    pub can_delete: Option<bool>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
    pub version: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFolderRequest {
    pub uid: Option<String>,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFolderRequest {
    pub title: Option<String>,
    pub version: Option<i64>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderPermission {
    pub role: Option<String>,
    pub permission: Option<i64>,
    pub team_id: Option<i64>,
    pub user_id: Option<i64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Organizations
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaOrg {
    pub id: Option<i64>,
    pub name: String,
    pub address: Option<OrgAddress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgAddress {
    pub address1: Option<String>,
    pub address2: Option<String>,
    pub city: Option<String>,
    pub zip_code: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateOrgRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateOrgRequest {
    pub name: Option<String>,
    pub address: Option<OrgAddress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgUser {
    pub org_id: Option<i64>,
    pub user_id: Option<i64>,
    pub login: Option<String>,
    pub email: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrgRole {
    Admin,
    Editor,
    Viewer,
}

impl std::fmt::Display for OrgRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OrgRole::Admin => write!(f, "Admin"),
            OrgRole::Editor => write!(f, "Editor"),
            OrgRole::Viewer => write!(f, "Viewer"),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaUser {
    pub id: Option<i64>,
    pub login: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub is_admin: Option<bool>,
    pub is_disabled: Option<bool>,
    pub auth_labels: Option<Vec<String>>,
    pub is_external: Option<bool>,
    pub last_seen_at: Option<String>,
    pub last_seen_at_age: Option<String>,
    pub created: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub name: Option<String>,
    pub login: String,
    pub email: Option<String>,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    pub name: Option<String>,
    pub login: Option<String>,
    pub email: Option<String>,
    pub theme: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserOrg {
    pub org_id: Option<i64>,
    pub name: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalUser {
    pub id: Option<i64>,
    pub login: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub is_admin: Option<bool>,
    pub is_disabled: Option<bool>,
    pub created: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Teams
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaTeam {
    pub id: Option<i64>,
    pub org_id: Option<i64>,
    pub name: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub member_count: Option<i64>,
    pub permission: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTeamRequest {
    pub name: String,
    pub email: Option<String>,
    pub org_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub org_id: Option<i64>,
    pub team_id: Option<i64>,
    pub user_id: Option<i64>,
    pub auth_module: Option<String>,
    pub email: Option<String>,
    pub login: Option<String>,
    pub avatar_url: Option<String>,
    pub labels: Option<Vec<String>>,
    pub permission: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTeamMemberRequest {
    pub user_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamPreferences {
    pub theme: Option<String>,
    pub home_dashboard_id: Option<i64>,
    pub timezone: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Alerting
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub id: Option<i64>,
    pub uid: Option<String>,
    pub title: Option<String>,
    pub condition: Option<String>,
    pub data: Option<Vec<serde_json::Value>>,
    pub updated: Option<String>,
    pub interval_secs: Option<i64>,
    pub version: Option<i64>,
    pub namespace_uid: Option<String>,
    pub namespace_id: Option<i64>,
    pub rule_group: Option<String>,
    pub no_data_state: Option<String>,
    pub exec_err_state: Option<String>,
    pub for_duration: Option<String>,
    pub annotations: Option<HashMap<String, String>>,
    pub labels: Option<HashMap<String, String>>,
    pub is_paused: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRuleGroup {
    pub name: Option<String>,
    pub interval: Option<i64>,
    pub rules: Vec<AlertRule>,
    pub folder_uid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAlertRuleRequest {
    pub title: String,
    pub condition: String,
    pub data: Vec<serde_json::Value>,
    pub folder_uid: String,
    pub rule_group: String,
    pub no_data_state: Option<String>,
    pub exec_err_state: Option<String>,
    pub for_duration: Option<String>,
    pub annotations: Option<HashMap<String, String>>,
    pub labels: Option<HashMap<String, String>>,
    pub is_paused: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactPoint {
    pub uid: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub settings: serde_json::Value,
    pub disable_resolve_message: Option<bool>,
    pub provisioned: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPolicy {
    pub receiver: Option<String>,
    pub group_by: Option<Vec<String>>,
    pub group_wait: Option<String>,
    pub group_interval: Option<String>,
    pub repeat_interval: Option<String>,
    pub matchers: Option<Vec<serde_json::Value>>,
    pub routes: Option<Vec<NotificationPolicy>>,
    pub mute_time_intervals: Option<Vec<String>>,
    #[serde(rename = "continue")]
    pub continue_flag: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MuteTimeInterval {
    pub name: String,
    pub time_intervals: Vec<TimeInterval>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeInterval {
    pub times: Option<Vec<serde_json::Value>>,
    pub weekdays: Option<Vec<String>>,
    pub days_of_month: Option<Vec<String>>,
    pub months: Option<Vec<String>>,
    pub years: Option<Vec<String>>,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertInstance {
    pub labels: Option<HashMap<String, String>>,
    pub annotations: Option<HashMap<String, String>>,
    pub state: Option<String>,
    pub state_reason: Option<String>,
    pub active_at: Option<String>,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertStateHistory {
    pub values: Option<Vec<serde_json::Value>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Annotations
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaAnnotation {
    pub id: Option<i64>,
    pub alert_id: Option<i64>,
    pub alert_name: Option<String>,
    pub dashboard_id: Option<i64>,
    pub dashboard_uid: Option<String>,
    pub panel_id: Option<i64>,
    pub user_id: Option<i64>,
    pub user_login: Option<String>,
    pub new_state: Option<String>,
    pub prev_state: Option<String>,
    pub created: Option<i64>,
    pub updated: Option<i64>,
    pub time: Option<i64>,
    pub time_end: Option<i64>,
    pub text: Option<String>,
    pub tags: Option<Vec<String>>,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAnnotationRequest {
    pub dashboard_uid: Option<String>,
    pub panel_id: Option<i64>,
    pub time: Option<i64>,
    pub time_end: Option<i64>,
    pub tags: Option<Vec<String>>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAnnotationRequest {
    pub time: Option<i64>,
    pub time_end: Option<i64>,
    pub tags: Option<Vec<String>>,
    pub text: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugins
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaPlugin {
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub info: Option<PluginInfo>,
    pub enabled: Option<bool>,
    pub pinned: Option<bool>,
    pub signature: Option<String>,
    pub module: Option<String>,
    pub base_url: Option<String>,
    pub has_update: Option<bool>,
    pub latest_version: Option<String>,
    pub default_nav_url: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub author: Option<serde_json::Value>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub links: Option<Vec<serde_json::Value>>,
    pub logos: Option<serde_json::Value>,
    pub updated: Option<String>,
    pub screenshots: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSetting {
    pub enabled: Option<bool>,
    pub pinned: Option<bool>,
    pub json_data: Option<serde_json::Value>,
    pub secure_json_data: Option<HashMap<String, String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Preferences
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreferences {
    pub theme: Option<String>,
    pub home_dashboard_id: Option<i64>,
    pub timezone: Option<String>,
    pub week_start: Option<String>,
    pub locale: Option<String>,
    pub query_history: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgPreferences {
    pub theme: Option<String>,
    pub home_dashboard_id: Option<i64>,
    pub timezone: Option<String>,
    pub week_start: Option<String>,
}
