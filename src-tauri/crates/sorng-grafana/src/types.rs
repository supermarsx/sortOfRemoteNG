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
    pub api_url: Option<String>,
    pub api_key: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub org_id: Option<i64>,
    pub ssh_host: Option<String>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    pub use_tls: Option<bool>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub org_name: Option<String>,
    pub edition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboards
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dashboard {
    pub id: Option<i64>,
    pub uid: Option<String>,
    pub title: String,
    pub slug: Option<String>,
    pub url: Option<String>,
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub folder_title: Option<String>,
    pub tags: Vec<String>,
    pub is_starred: Option<bool>,
    pub panels: Option<serde_json::Value>,
    pub templating: Option<serde_json::Value>,
    pub annotations: Option<serde_json::Value>,
    pub time: Option<serde_json::Value>,
    pub timezone: Option<String>,
    pub schema_version: Option<i64>,
    pub version: Option<i64>,
    pub refresh: Option<String>,
    pub editable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardMeta {
    pub slug: Option<String>,
    pub url: Option<String>,
    pub status: Option<String>,
    pub version: Option<i64>,
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub folder_title: Option<String>,
    pub is_starred: Option<bool>,
    pub created: Option<String>,
    pub created_by: Option<String>,
    pub updated: Option<String>,
    pub updated_by: Option<String>,
    pub provisioned: Option<bool>,
    pub provisioned_external_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardVersion {
    pub id: i64,
    pub dashboard_id: i64,
    pub version: i64,
    pub created: Option<String>,
    pub created_by: Option<String>,
    pub message: Option<String>,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardPermission {
    pub id: Option<i64>,
    pub dashboard_id: Option<i64>,
    pub dashboard_uid: Option<String>,
    pub user_id: Option<i64>,
    pub team_id: Option<i64>,
    pub role: Option<String>,
    pub permission: i32,
    pub permission_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardDiff {
    pub base: Option<serde_json::Value>,
    pub new: Option<serde_json::Value>,
    pub diff: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSearchResult {
    pub id: i64,
    pub uid: String,
    pub title: String,
    pub uri: Option<String>,
    pub url: Option<String>,
    pub slug: Option<String>,
    #[serde(rename = "type")]
    pub result_type: Option<String>,
    pub tags: Vec<String>,
    pub is_starred: Option<bool>,
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub folder_title: Option<String>,
    pub folder_url: Option<String>,
    pub sort_meta: Option<i64>,
    pub sort_meta_name: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Datasources
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Datasource {
    pub id: Option<i64>,
    pub uid: Option<String>,
    pub org_id: Option<i64>,
    pub name: String,
    #[serde(rename = "type")]
    pub ds_type: String,
    pub type_logo_url: Option<String>,
    pub access: Option<String>,
    pub url: Option<String>,
    pub database: Option<String>,
    pub user: Option<String>,
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
pub struct DatasourceType {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub module: Option<String>,
    pub category: Option<String>,
    pub logos: Option<serde_json::Value>,
    pub metrics: Option<bool>,
    pub alerting: Option<bool>,
    pub annotations: Option<bool>,
    pub streaming: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasourceHealth {
    pub status: String,
    pub message: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Folders
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
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
    pub created_by: Option<String>,
    pub updated: Option<String>,
    pub updated_by: Option<String>,
    pub version: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderPermission {
    pub id: Option<i64>,
    pub folder_uid: Option<String>,
    pub user_id: Option<i64>,
    pub team_id: Option<i64>,
    pub role: Option<String>,
    pub permission: i32,
    pub permission_name: Option<String>,
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
    pub theme: Option<String>,
    pub org_id: Option<i64>,
    pub last_seen_at: Option<String>,
    pub last_seen_at_age: Option<String>,
    pub auth_labels: Option<Vec<String>>,
    pub is_external: Option<bool>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserOrg {
    pub org_id: i64,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreferences {
    pub theme: Option<String>,
    pub home_dashboard_id: Option<i64>,
    pub home_dashboard_uid: Option<String>,
    pub timezone: Option<String>,
    pub week_start: Option<String>,
    pub locale: Option<String>,
    pub navbar: Option<serde_json::Value>,
    pub query_history: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Organizations
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaOrg {
    pub id: Option<i64>,
    pub name: String,
    pub address: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgUser {
    pub org_id: Option<i64>,
    pub user_id: i64,
    pub login: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub role: String,
    pub last_seen_at: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgPreferences {
    pub theme: Option<String>,
    pub home_dashboard_id: Option<i64>,
    pub home_dashboard_uid: Option<String>,
    pub timezone: Option<String>,
    pub week_start: Option<String>,
    pub locale: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Alerts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub id: Option<i64>,
    pub uid: Option<String>,
    pub org_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub rule_group: Option<String>,
    pub title: String,
    pub condition: Option<String>,
    pub data: Option<serde_json::Value>,
    pub no_data_state: Option<String>,
    pub exec_err_state: Option<String>,
    #[serde(rename = "for")]
    pub for_duration: Option<String>,
    pub annotations: Option<HashMap<String, String>>,
    pub labels: Option<HashMap<String, String>>,
    pub is_paused: Option<bool>,
    pub updated: Option<String>,
    pub provenance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertInstance {
    pub labels: HashMap<String, String>,
    pub state: String,
    pub current_state_since: Option<String>,
    pub current_state_end: Option<String>,
    pub last_eval_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRuleGroup {
    pub name: String,
    pub folder_uid: Option<String>,
    pub interval: Option<String>,
    pub rules: Vec<AlertRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactPoint {
    pub uid: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub cp_type: String,
    pub settings: serde_json::Value,
    pub disable_resolve_message: Option<bool>,
    pub provenance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPolicy {
    pub receiver: Option<String>,
    pub group_by: Option<Vec<String>>,
    pub group_wait: Option<String>,
    pub group_interval: Option<String>,
    pub repeat_interval: Option<String>,
    pub object_matchers: Option<serde_json::Value>,
    pub routes: Option<Vec<NotificationPolicy>>,
    pub mute_time_intervals: Option<Vec<String>>,
    pub provenance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertSilence {
    pub id: Option<String>,
    pub status: Option<serde_json::Value>,
    pub comment: Option<String>,
    pub created_by: Option<String>,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub updated_at: Option<String>,
    pub matchers: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MuteTiming {
    pub name: String,
    pub time_intervals: Option<serde_json::Value>,
    pub provenance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertStateHistory {
    pub rule_uid: Option<String>,
    pub values: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Annotations
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: Option<i64>,
    pub alert_id: Option<i64>,
    pub dashboard_id: Option<i64>,
    pub dashboard_uid: Option<String>,
    pub panel_id: Option<i64>,
    pub user_id: Option<i64>,
    pub login: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub time: Option<i64>,
    pub time_end: Option<i64>,
    pub tags: Option<Vec<String>>,
    pub text: Option<String>,
    pub data: Option<serde_json::Value>,
    pub created: Option<i64>,
    pub updated: Option<i64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Playlists
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: Option<i64>,
    pub uid: Option<String>,
    pub name: String,
    pub interval: Option<String>,
    pub items: Option<Vec<PlaylistItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistItem {
    pub id: Option<i64>,
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    pub value: Option<String>,
    pub order: Option<i32>,
    pub title: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Panels
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelType {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub info: Option<serde_json::Value>,
    pub sort: Option<i32>,
    pub skip_data_query: Option<bool>,
    pub state: Option<String>,
    pub base_url: Option<String>,
    pub module: Option<String>,
    pub signatures: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelSchema {
    pub id: String,
    pub name: String,
    pub field_config: Option<serde_json::Value>,
    pub options: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryPanel {
    pub id: Option<i64>,
    pub uid: Option<String>,
    pub org_id: Option<i64>,
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub panel_type: Option<String>,
    pub model: Option<serde_json::Value>,
    pub version: Option<i64>,
    pub meta: Option<serde_json::Value>,
    pub created: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryPanelConnection {
    pub id: i64,
    pub kind: i32,
    pub element_id: i64,
    pub connection_id: i64,
    pub created: Option<String>,
    pub created_by: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// API Keys & Service Accounts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaApiKey {
    pub id: Option<i64>,
    pub name: String,
    pub role: Option<String>,
    pub expiration: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceAccount {
    pub id: Option<i64>,
    pub name: String,
    pub login: Option<String>,
    pub org_id: Option<i64>,
    pub is_disabled: Option<bool>,
    pub role: Option<String>,
    pub tokens: Option<i64>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceAccountToken {
    pub id: Option<i64>,
    pub name: String,
    pub key: Option<String>,
    pub role: Option<String>,
    pub expiration: Option<String>,
    pub seconds_until_expiration: Option<f64>,
    pub has_expired: Option<bool>,
    pub created: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Teams
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    pub id: Option<i64>,
    pub org_id: Option<i64>,
    pub name: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub member_count: Option<i64>,
    pub permission: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub org_id: Option<i64>,
    pub team_id: Option<i64>,
    pub user_id: i64,
    pub login: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub labels: Option<Vec<String>>,
    pub permission: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamPreferences {
    pub theme: Option<String>,
    pub home_dashboard_id: Option<i64>,
    pub home_dashboard_uid: Option<String>,
    pub timezone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamGroup {
    pub org_id: Option<i64>,
    pub team_id: Option<i64>,
    pub group_id: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugins
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaPlugin {
    pub id: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub plugin_type: Option<String>,
    pub enabled: Option<bool>,
    pub pinned: Option<bool>,
    pub info: Option<serde_json::Value>,
    pub latest_version: Option<String>,
    pub has_update: Option<bool>,
    pub default_nav_url: Option<String>,
    pub category: Option<String>,
    pub state: Option<String>,
    pub signature: Option<String>,
    pub signature_type: Option<String>,
    pub signature_org: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSettings {
    pub enabled: Option<bool>,
    pub pinned: Option<bool>,
    pub json_data: Option<serde_json::Value>,
    pub secure_json_data: Option<HashMap<String, String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Snapshots
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaSnapshot {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub key: Option<String>,
    pub delete_key: Option<String>,
    pub org_id: Option<i64>,
    pub user_id: Option<i64>,
    pub external: Option<bool>,
    pub external_url: Option<String>,
    pub expires: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub url: Option<String>,
    pub dashboard: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaSettings {
    #[serde(flatten)]
    pub sections: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaStats {
    pub orgs: Option<i64>,
    pub dashboards: Option<i64>,
    pub datasources: Option<i64>,
    pub users: Option<i64>,
    pub active_users: Option<i64>,
    pub active_admins: Option<i64>,
    pub active_editors: Option<i64>,
    pub active_viewers: Option<i64>,
    pub active_sessions: Option<i64>,
    pub daily_active_users: Option<i64>,
    pub monthly_active_users: Option<i64>,
    pub alerts: Option<i64>,
    pub stars: Option<i64>,
    pub snapshots: Option<i64>,
    pub playlists: Option<i64>,
    pub tags: Option<i64>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaHealth {
    pub commit: Option<String>,
    pub database: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaVersion {
    pub version: String,
    pub commit: Option<String>,
    pub build_date: Option<String>,
    pub edition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageStats {
    #[serde(flatten)]
    pub metrics: HashMap<String, serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Request types (used by commands)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDashboardRequest {
    pub dashboard: serde_json::Value,
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub message: Option<String>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateDashboardRequest {
    pub dashboard: serde_json::Value,
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub message: Option<String>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportDashboardRequest {
    pub dashboard: serde_json::Value,
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub overwrite: Option<bool>,
    pub inputs: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSearchQuery {
    pub query: Option<String>,
    pub tag: Option<Vec<String>>,
    pub starred: Option<bool>,
    pub folder_ids: Option<Vec<i64>>,
    pub limit: Option<i64>,
    pub page: Option<i64>,
    #[serde(rename = "type")]
    pub search_type: Option<String>,
    pub sort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePermissionsRequest {
    pub items: Vec<DashboardPermission>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardDiffRequest {
    pub base: serde_json::Value,
    pub new: serde_json::Value,
    pub diff_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDatasourceRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub ds_type: String,
    pub access: Option<String>,
    pub url: Option<String>,
    pub database: Option<String>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub basic_auth: Option<bool>,
    pub basic_auth_user: Option<String>,
    pub basic_auth_password: Option<String>,
    pub is_default: Option<bool>,
    pub json_data: Option<serde_json::Value>,
    pub secure_json_data: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateDatasourceRequest {
    pub name: Option<String>,
    pub access: Option<String>,
    pub url: Option<String>,
    pub database: Option<String>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub basic_auth: Option<bool>,
    pub basic_auth_user: Option<String>,
    pub is_default: Option<bool>,
    pub json_data: Option<serde_json::Value>,
    pub secure_json_data: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryDatasourceRequest {
    pub queries: Vec<serde_json::Value>,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFolderRequest {
    pub title: String,
    pub uid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFolderRequest {
    pub title: String,
    pub version: Option<i64>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFolderPermissionsRequest {
    pub items: Vec<FolderPermission>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub name: Option<String>,
    pub login: String,
    pub email: Option<String>,
    pub password: String,
    pub org_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    pub name: Option<String>,
    pub login: Option<String>,
    pub email: Option<String>,
    pub theme: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddUserToOrgRequest {
    pub login_or_email: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRoleRequest {
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateOrgRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateOrgRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddOrgUserRequest {
    pub login_or_email: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateOrgUserRoleRequest {
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAlertRuleRequest {
    pub title: String,
    pub folder_uid: String,
    pub rule_group: String,
    pub condition: Option<String>,
    pub data: serde_json::Value,
    pub no_data_state: Option<String>,
    pub exec_err_state: Option<String>,
    #[serde(rename = "for")]
    pub for_duration: Option<String>,
    pub annotations: Option<HashMap<String, String>>,
    pub labels: Option<HashMap<String, String>>,
    pub is_paused: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAlertRuleRequest {
    pub title: Option<String>,
    pub condition: Option<String>,
    pub data: Option<serde_json::Value>,
    pub no_data_state: Option<String>,
    pub exec_err_state: Option<String>,
    #[serde(rename = "for")]
    pub for_duration: Option<String>,
    pub annotations: Option<HashMap<String, String>>,
    pub labels: Option<HashMap<String, String>>,
    pub is_paused: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateContactPointRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub cp_type: String,
    pub settings: serde_json::Value,
    pub disable_resolve_message: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateContactPointRequest {
    pub name: Option<String>,
    pub settings: Option<serde_json::Value>,
    pub disable_resolve_message: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSilenceRequest {
    pub comment: String,
    pub created_by: String,
    pub starts_at: String,
    pub ends_at: String,
    pub matchers: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMuteTimingRequest {
    pub name: String,
    pub time_intervals: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateMuteTimingRequest {
    pub name: Option<String>,
    pub time_intervals: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAnnotationRequest {
    pub dashboard_id: Option<i64>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGraphiteAnnotationRequest {
    pub what: String,
    pub tags: Option<Vec<String>>,
    pub when: Option<i64>,
    pub data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MassDeleteAnnotationsRequest {
    pub dashboard_id: Option<i64>,
    pub panel_id: Option<i64>,
    pub annotation_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlaylistRequest {
    pub name: String,
    pub interval: String,
    pub items: Vec<PlaylistItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePlaylistRequest {
    pub name: Option<String>,
    pub interval: Option<String>,
    pub items: Option<Vec<PlaylistItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLibraryPanelRequest {
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub name: String,
    pub model: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateLibraryPanelRequest {
    pub folder_id: Option<i64>,
    pub folder_uid: Option<String>,
    pub name: Option<String>,
    pub model: Option<serde_json::Value>,
    pub version: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    pub role: String,
    pub seconds_to_live: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateServiceAccountRequest {
    pub name: String,
    pub role: Option<String>,
    pub is_disabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateServiceAccountTokenRequest {
    pub name: String,
    pub seconds_to_live: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTeamRequest {
    pub name: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTeamRequest {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTeamMemberRequest {
    pub user_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTeamGroupRequest {
    pub group_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallPluginRequest {
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePluginSettingsRequest {
    pub enabled: Option<bool>,
    pub pinned: Option<bool>,
    pub json_data: Option<serde_json::Value>,
    pub secure_json_data: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSnapshotRequest {
    pub dashboard: serde_json::Value,
    pub name: Option<String>,
    pub expires: Option<i64>,
    pub external: Option<bool>,
    pub key: Option<String>,
    pub delete_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveDashboardRequest {
    pub folder_uid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationQuery {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub dashboard_id: Option<i64>,
    pub dashboard_uid: Option<String>,
    pub panel_id: Option<i64>,
    pub alert_id: Option<i64>,
    pub tags: Option<Vec<String>>,
    pub limit: Option<i64>,
    #[serde(rename = "type")]
    pub annotation_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelQueryOptions {
    pub max_data_points: Option<i64>,
    pub interval: Option<String>,
}
