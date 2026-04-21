//! Shared types for Roundcube Webmail administration.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeConnectionConfig {
    /// Roundcube API base URL (e.g. http://localhost/api)
    #[serde(default = "default_base_url")]
    pub base_url: String,
    /// Admin username for authentication
    pub username: String,
    /// Admin password for authentication
    pub password: String,
    /// Request timeout in seconds
    pub timeout_secs: Option<u64>,
    /// Skip TLS certificate verification
    pub tls_skip_verify: Option<bool>,
}

fn default_base_url() -> String {
    "http://localhost/api".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub skin: Option<String>,
    pub product_name: Option<String>,
    pub plugins_count: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeUser {
    pub id: String,
    pub username: String,
    pub mail_host: Option<String>,
    pub language: Option<String>,
    pub preferences: Option<RoundcubeUserPreferences>,
    pub created: Option<String>,
    pub last_login: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeUserPreferences {
    pub language: Option<String>,
    pub timezone: Option<String>,
    pub date_format: Option<String>,
    pub time_format: Option<String>,
    pub skin: Option<String>,
    pub page_size: Option<u32>,
    pub preview_pane: Option<bool>,
    pub html_editor: Option<bool>,
    pub compose_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub mail_host: Option<String>,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    pub language: Option<String>,
    pub preferences: Option<RoundcubeUserPreferences>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Identities
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeIdentity {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub email: String,
    pub organization: Option<String>,
    pub reply_to: Option<String>,
    pub bcc: Option<String>,
    pub signature: Option<String>,
    pub html_signature: Option<bool>,
    pub is_standard: Option<bool>,
    pub changed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIdentityRequest {
    pub name: String,
    pub email: String,
    pub organization: Option<String>,
    pub reply_to: Option<String>,
    pub bcc: Option<String>,
    pub signature: Option<String>,
    pub html_signature: Option<bool>,
    pub is_standard: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateIdentityRequest {
    pub name: Option<String>,
    pub email: Option<String>,
    pub organization: Option<String>,
    pub reply_to: Option<String>,
    pub bcc: Option<String>,
    pub signature: Option<String>,
    pub html_signature: Option<bool>,
    pub is_standard: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Address Books
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeAddressBook {
    pub id: String,
    pub user_id: Option<String>,
    pub name: String,
    pub readonly: Option<bool>,
    pub groups_count: Option<u64>,
    pub contacts_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeContact {
    pub id: String,
    pub address_book_id: Option<String>,
    pub name: Option<String>,
    pub firstname: Option<String>,
    pub surname: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub organization: Option<String>,
    pub notes: Option<String>,
    pub vcard: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateContactRequest {
    pub name: Option<String>,
    pub firstname: Option<String>,
    pub surname: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub organization: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateContactRequest {
    pub name: Option<String>,
    pub firstname: Option<String>,
    pub surname: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub organization: Option<String>,
    pub notes: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Folders (IMAP Mailboxes)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeFolder {
    pub name: String,
    pub delimiter: Option<String>,
    pub special_use: Option<String>,
    pub exists: Option<u64>,
    pub unseen: Option<u64>,
    pub subscribed: Option<bool>,
    #[serde(default)]
    pub children: Vec<RoundcubeFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameFolderRequest {
    pub old_name: String,
    pub new_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeQuota {
    pub used_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub used_messages: Option<u64>,
    pub total_messages: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Filters (ManageSieve)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeFilter {
    pub id: String,
    pub name: String,
    pub enabled: Option<bool>,
    #[serde(default)]
    pub conditions: Vec<RoundcubeFilterCondition>,
    #[serde(default)]
    pub actions: Vec<RoundcubeFilterAction>,
    pub join_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeFilterCondition {
    pub header: Option<String>,
    pub match_type: Option<String>,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeFilterAction {
    pub action_type: Option<String>,
    pub target: Option<String>,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFilterRequest {
    pub name: String,
    pub enabled: Option<bool>,
    #[serde(default)]
    pub conditions: Vec<RoundcubeFilterCondition>,
    #[serde(default)]
    pub actions: Vec<RoundcubeFilterAction>,
    pub join_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFilterRequest {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub conditions: Option<Vec<RoundcubeFilterCondition>>,
    pub actions: Option<Vec<RoundcubeFilterAction>>,
    pub join_type: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugins
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubePlugin {
    pub name: String,
    pub version: Option<String>,
    pub enabled: Option<bool>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub homepage: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubePluginConfig {
    pub plugin_name: String,
    #[serde(default)]
    pub settings: HashMap<String, serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Settings
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeSystemConfig {
    pub product_name: Option<String>,
    pub skin: Option<String>,
    pub default_host: Option<String>,
    pub default_port: Option<u16>,
    pub smtp_server: Option<String>,
    pub smtp_port: Option<u16>,
    pub support_url: Option<String>,
    #[serde(default)]
    pub plugins_enabled: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeSmtpConfig {
    pub server: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub pass: Option<String>,
    pub auth_type: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cache / Maintenance
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeCacheStats {
    pub total_entries: Option<u64>,
    pub total_size_bytes: Option<u64>,
    pub expired_entries: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeLogEntry {
    pub timestamp: Option<String>,
    pub level: Option<String>,
    pub message: Option<String>,
    pub session_id: Option<String>,
    pub user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundcubeDbStats {
    pub size_bytes: Option<u64>,
    pub tables_count: Option<u64>,
    pub sessions_count: Option<u64>,
    pub cache_entries: Option<u64>,
}
