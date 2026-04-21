// ── sorng-grafana/src/types.rs ───────────────────────────────────────────────
//! Grafana API data structures.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Connection ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaConnectionConfig {
    pub host: String,
    pub port: Option<u16>,
    pub use_tls: Option<bool>,
    pub accept_invalid_certs: Option<bool>,
    pub api_key: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub org_id: Option<u64>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaConnectionSummary {
    pub host: String,
    pub version: String,
    pub org_name: String,
    pub user_count: u64,
    pub dashboard_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub commit: Option<String>,
    pub database: Option<String>,
    pub version: Option<String>,
}

// ── Dashboards ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dashboard {
    pub id: Option<u64>,
    pub uid: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub slug: Option<String>,
    #[serde(rename = "type")]
    pub type_field: Option<String>,
    pub tags: Option<Vec<String>>,
    #[serde(rename = "isStarred")]
    pub is_starred: Option<bool>,
    pub uri: Option<String>,
    #[serde(rename = "folderId")]
    pub folder_id: Option<u64>,
    #[serde(rename = "folderUid")]
    pub folder_uid: Option<String>,
    #[serde(rename = "folderTitle")]
    pub folder_title: Option<String>,
    #[serde(rename = "folderUrl")]
    pub folder_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardDetail {
    pub meta: DashboardMeta,
    pub dashboard: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardMeta {
    #[serde(rename = "type")]
    pub type_field: Option<String>,
    #[serde(rename = "canSave")]
    pub can_save: Option<bool>,
    #[serde(rename = "canEdit")]
    pub can_edit: Option<bool>,
    #[serde(rename = "canAdmin")]
    pub can_admin: Option<bool>,
    #[serde(rename = "canStar")]
    pub can_star: Option<bool>,
    #[serde(rename = "canDelete")]
    pub can_delete: Option<bool>,
    pub slug: Option<String>,
    pub url: Option<String>,
    pub expires: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    #[serde(rename = "updatedBy")]
    pub updated_by: Option<String>,
    #[serde(rename = "createdBy")]
    pub created_by: Option<String>,
    pub version: Option<u64>,
    #[serde(rename = "hasAcl")]
    pub has_acl: Option<bool>,
    #[serde(rename = "isFolder")]
    pub is_folder: Option<bool>,
    pub provisioned: Option<bool>,
    #[serde(rename = "provisionedExternalId")]
    pub provisioned_external_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardVersion {
    pub id: Option<u64>,
    #[serde(rename = "dashboardId")]
    pub dashboard_id: Option<u64>,
    #[serde(rename = "parentVersion")]
    pub parent_version: Option<u64>,
    #[serde(rename = "restoredFrom")]
    pub restored_from: Option<u64>,
    pub version: Option<u64>,
    pub created: Option<String>,
    #[serde(rename = "createdBy")]
    pub created_by: Option<String>,
    pub message: Option<String>,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveDashboardRequest {
    pub dashboard: serde_json::Value,
    #[serde(rename = "folderUid", skip_serializing_if = "Option::is_none")]
    pub folder_uid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveDashboardResponse {
    pub id: Option<u64>,
    pub uid: Option<String>,
    pub url: Option<String>,
    pub status: Option<String>,
    pub version: Option<u64>,
    pub slug: Option<String>,
}

// ── Datasources ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Datasource {
    pub id: Option<u64>,
    pub uid: Option<String>,
    #[serde(rename = "orgId")]
    pub org_id: Option<u64>,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub type_field: Option<String>,
    #[serde(rename = "typeLogoUrl")]
    pub type_logo_url: Option<String>,
    pub access: Option<String>,
    pub url: Option<String>,
    pub password: Option<String>,
    pub user: Option<String>,
    pub database: Option<String>,
    #[serde(rename = "basicAuth")]
    pub basic_auth: Option<bool>,
    #[serde(rename = "basicAuthUser")]
    pub basic_auth_user: Option<String>,
    #[serde(rename = "withCredentials")]
    pub with_credentials: Option<bool>,
    #[serde(rename = "isDefault")]
    pub is_default: Option<bool>,
    #[serde(rename = "jsonData")]
    pub json_data: Option<serde_json::Value>,
    #[serde(rename = "secureJsonFields")]
    pub secure_json_fields: Option<HashMap<String, bool>>,
    pub version: Option<u64>,
    #[serde(rename = "readOnly")]
    pub read_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasourceCreateRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub url: Option<String>,
    pub access: Option<String>,
    #[serde(rename = "basicAuth", skip_serializing_if = "Option::is_none")]
    pub basic_auth: Option<bool>,
    #[serde(rename = "basicAuthUser", skip_serializing_if = "Option::is_none")]
    pub basic_auth_user: Option<String>,
    #[serde(rename = "basicAuthPassword", skip_serializing_if = "Option::is_none")]
    pub basic_auth_password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(rename = "jsonData", skip_serializing_if = "Option::is_none")]
    pub json_data: Option<serde_json::Value>,
    #[serde(rename = "isDefault", skip_serializing_if = "Option::is_none")]
    pub is_default: Option<bool>,
}

// ── Folders ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: Option<u64>,
    pub uid: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "hasAcl")]
    pub has_acl: Option<bool>,
    #[serde(rename = "canSave")]
    pub can_save: Option<bool>,
    #[serde(rename = "canEdit")]
    pub can_edit: Option<bool>,
    #[serde(rename = "canAdmin")]
    pub can_admin: Option<bool>,
    #[serde(rename = "canDelete")]
    pub can_delete: Option<bool>,
    pub created: Option<String>,
    pub updated: Option<String>,
    #[serde(rename = "createdBy")]
    pub created_by: Option<String>,
    #[serde(rename = "updatedBy")]
    pub updated_by: Option<String>,
    pub version: Option<u64>,
}

// ── Organizations ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Organization {
    pub id: Option<u64>,
    pub name: Option<String>,
    pub address: Option<OrgAddress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgAddress {
    pub address1: Option<String>,
    pub address2: Option<String>,
    pub city: Option<String>,
    #[serde(rename = "zipCode")]
    pub zip_code: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
}

// ── Users ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrafanaUser {
    pub id: Option<u64>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub login: Option<String>,
    pub theme: Option<String>,
    #[serde(rename = "orgId")]
    pub org_id: Option<u64>,
    #[serde(rename = "isGrafanaAdmin")]
    pub is_grafana_admin: Option<bool>,
    #[serde(rename = "isDisabled")]
    pub is_disabled: Option<bool>,
    #[serde(rename = "isExternal")]
    pub is_external: Option<bool>,
    #[serde(rename = "authLabels")]
    pub auth_labels: Option<Vec<String>>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
}

// ── Teams ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    pub id: Option<u64>,
    #[serde(rename = "orgId")]
    pub org_id: Option<u64>,
    pub name: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    #[serde(rename = "memberCount")]
    pub member_count: Option<u64>,
    pub permission: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    #[serde(rename = "orgId")]
    pub org_id: Option<u64>,
    #[serde(rename = "teamId")]
    pub team_id: Option<u64>,
    #[serde(rename = "userId")]
    pub user_id: Option<u64>,
    #[serde(rename = "authModule")]
    pub auth_module: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub login: Option<String>,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    pub labels: Option<Vec<String>>,
    pub permission: Option<u64>,
}

// ── Alerts ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub id: Option<u64>,
    pub uid: Option<String>,
    #[serde(rename = "orgID")]
    pub org_id: Option<u64>,
    #[serde(rename = "folderUID")]
    pub folder_uid: Option<String>,
    #[serde(rename = "ruleGroup")]
    pub rule_group: Option<String>,
    pub title: Option<String>,
    pub condition: Option<String>,
    pub data: Option<serde_json::Value>,
    pub updated: Option<String>,
    #[serde(rename = "noDataState")]
    pub no_data_state: Option<String>,
    #[serde(rename = "execErrState")]
    pub exec_err_state: Option<String>,
    #[serde(rename = "for")]
    pub for_duration: Option<String>,
    pub annotations: Option<HashMap<String, String>>,
    pub labels: Option<HashMap<String, String>>,
    #[serde(rename = "isPaused")]
    pub is_paused: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertNotification {
    pub id: Option<u64>,
    pub uid: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub type_field: Option<String>,
    #[serde(rename = "isDefault")]
    pub is_default: Option<bool>,
    #[serde(rename = "sendReminder")]
    pub send_reminder: Option<bool>,
    #[serde(rename = "disableResolveMessage")]
    pub disable_resolve_message: Option<bool>,
    pub frequency: Option<String>,
    pub settings: Option<serde_json::Value>,
    pub created: Option<String>,
    pub updated: Option<String>,
}

// ── Annotations ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: Option<u64>,
    #[serde(rename = "alertId")]
    pub alert_id: Option<u64>,
    #[serde(rename = "alertName")]
    pub alert_name: Option<String>,
    #[serde(rename = "dashboardId")]
    pub dashboard_id: Option<u64>,
    #[serde(rename = "dashboardUID")]
    pub dashboard_uid: Option<String>,
    #[serde(rename = "panelId")]
    pub panel_id: Option<u64>,
    #[serde(rename = "userId")]
    pub user_id: Option<u64>,
    #[serde(rename = "userName")]
    pub user_name: Option<String>,
    #[serde(rename = "newState")]
    pub new_state: Option<String>,
    #[serde(rename = "prevState")]
    pub prev_state: Option<String>,
    pub created: Option<u64>,
    pub updated: Option<u64>,
    pub time: Option<u64>,
    #[serde(rename = "timeEnd")]
    pub time_end: Option<u64>,
    pub text: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAnnotationRequest {
    #[serde(rename = "dashboardUID", skip_serializing_if = "Option::is_none")]
    pub dashboard_uid: Option<String>,
    #[serde(rename = "panelId", skip_serializing_if = "Option::is_none")]
    pub panel_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<u64>,
    #[serde(rename = "timeEnd", skip_serializing_if = "Option::is_none")]
    pub time_end: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    pub text: String,
}

// ── Playlists ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: Option<u64>,
    pub name: Option<String>,
    pub interval: Option<String>,
    pub items: Option<Vec<PlaylistItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistItem {
    #[serde(rename = "type")]
    pub type_field: Option<String>,
    pub value: Option<String>,
    pub order: Option<u64>,
    pub title: Option<String>,
}

// ── Snapshots ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: Option<u64>,
    pub name: Option<String>,
    pub key: Option<String>,
    #[serde(rename = "orgId")]
    pub org_id: Option<u64>,
    #[serde(rename = "userId")]
    pub user_id: Option<u64>,
    pub external: Option<bool>,
    #[serde(rename = "externalUrl")]
    pub external_url: Option<String>,
    pub dashboard: Option<serde_json::Value>,
    pub expires: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "deleteUrl")]
    pub delete_url: Option<String>,
}

// ── Panels / Plugins ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelPlugin {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub type_field: Option<String>,
    pub name: Option<String>,
    pub info: Option<PanelPluginInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelPluginInfo {
    pub description: Option<String>,
    pub author: Option<serde_json::Value>,
    pub version: Option<String>,
    pub logos: Option<serde_json::Value>,
}

// ── Search ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<Vec<String>>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub type_field: Option<String>,
    #[serde(rename = "dashboardIds", skip_serializing_if = "Option::is_none")]
    pub dashboard_ids: Option<Vec<u64>>,
    #[serde(rename = "folderIds", skip_serializing_if = "Option::is_none")]
    pub folder_ids: Option<Vec<u64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u64>,
}
