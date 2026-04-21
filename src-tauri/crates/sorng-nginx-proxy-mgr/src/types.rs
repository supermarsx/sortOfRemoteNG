//! Shared types for Nginx Proxy Manager management.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection & Auth
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmConnectionConfig {
    /// NPM API URL (default: http://localhost:81)
    pub api_url: String,
    pub email: Option<String>,
    pub password: Option<String>,
    /// Pre-existing bearer token
    pub token: Option<String>,
    pub tls_skip_verify: Option<bool>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmConnectionSummary {
    pub api_url: String,
    pub user: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmTokenResponse {
    pub token: String,
    pub expires: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmTokenPayload {
    pub identity: String,
    pub secret: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Proxy Hosts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmProxyHost {
    pub id: u64,
    pub created_on: Option<String>,
    pub modified_on: Option<String>,
    pub owner_user_id: Option<u64>,
    pub domain_names: Vec<String>,
    pub forward_host: String,
    pub forward_port: u16,
    pub forward_scheme: String,
    pub access_list_id: Option<u64>,
    pub certificate_id: Option<u64>,
    pub ssl_forced: Option<bool>,
    pub caching_enabled: Option<bool>,
    pub block_exploits: Option<bool>,
    pub allow_websocket_upgrade: Option<bool>,
    pub http2_support: Option<bool>,
    pub hsts_enabled: Option<bool>,
    pub hsts_subdomains: Option<bool>,
    pub advanced_config: Option<String>,
    pub enabled: Option<bool>,
    pub meta: Option<serde_json::Value>,
    pub locations: Option<Vec<NpmLocation>>,
    pub certificate: Option<serde_json::Value>,
    pub owner: Option<serde_json::Value>,
    pub access_list: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmLocation {
    pub path: String,
    pub forward_host: String,
    pub forward_port: u16,
    pub forward_scheme: String,
    pub advanced_config: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProxyHostRequest {
    pub domain_names: Vec<String>,
    pub forward_host: String,
    pub forward_port: u16,
    pub forward_scheme: Option<String>,
    pub certificate_id: Option<u64>,
    pub ssl_forced: Option<bool>,
    pub caching_enabled: Option<bool>,
    pub block_exploits: Option<bool>,
    pub allow_websocket_upgrade: Option<bool>,
    pub http2_support: Option<bool>,
    pub hsts_enabled: Option<bool>,
    pub hsts_subdomains: Option<bool>,
    pub advanced_config: Option<String>,
    pub locations: Option<Vec<NpmLocation>>,
    pub access_list_id: Option<u64>,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProxyHostRequest {
    pub domain_names: Option<Vec<String>>,
    pub forward_host: Option<String>,
    pub forward_port: Option<u16>,
    pub forward_scheme: Option<String>,
    pub certificate_id: Option<u64>,
    pub ssl_forced: Option<bool>,
    pub caching_enabled: Option<bool>,
    pub block_exploits: Option<bool>,
    pub allow_websocket_upgrade: Option<bool>,
    pub http2_support: Option<bool>,
    pub hsts_enabled: Option<bool>,
    pub hsts_subdomains: Option<bool>,
    pub advanced_config: Option<String>,
    pub locations: Option<Vec<NpmLocation>>,
    pub access_list_id: Option<u64>,
    pub meta: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Redirection Hosts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmRedirectionHost {
    pub id: u64,
    pub created_on: Option<String>,
    pub modified_on: Option<String>,
    pub owner_user_id: Option<u64>,
    pub domain_names: Vec<String>,
    pub forward_http_code: u16,
    pub forward_domain_name: String,
    pub forward_scheme: String,
    pub preserve_path: Option<bool>,
    pub certificate_id: Option<u64>,
    pub ssl_forced: Option<bool>,
    pub block_exploits: Option<bool>,
    pub hsts_enabled: Option<bool>,
    pub hsts_subdomains: Option<bool>,
    pub advanced_config: Option<String>,
    pub enabled: Option<bool>,
    pub meta: Option<serde_json::Value>,
    pub certificate: Option<serde_json::Value>,
    pub owner: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRedirectionHostRequest {
    pub domain_names: Vec<String>,
    pub forward_http_code: u16,
    pub forward_domain_name: String,
    pub forward_scheme: Option<String>,
    pub preserve_path: Option<bool>,
    pub certificate_id: Option<u64>,
    pub ssl_forced: Option<bool>,
    pub block_exploits: Option<bool>,
    pub hsts_enabled: Option<bool>,
    pub hsts_subdomains: Option<bool>,
    pub advanced_config: Option<String>,
    pub meta: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dead Hosts (404 pages)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmDeadHost {
    pub id: u64,
    pub created_on: Option<String>,
    pub modified_on: Option<String>,
    pub owner_user_id: Option<u64>,
    pub domain_names: Vec<String>,
    pub certificate_id: Option<u64>,
    pub ssl_forced: Option<bool>,
    pub advanced_config: Option<String>,
    pub enabled: Option<bool>,
    pub meta: Option<serde_json::Value>,
    pub certificate: Option<serde_json::Value>,
    pub owner: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDeadHostRequest {
    pub domain_names: Vec<String>,
    pub certificate_id: Option<u64>,
    pub ssl_forced: Option<bool>,
    pub advanced_config: Option<String>,
    pub meta: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Streams (TCP/UDP forwarding)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmStream {
    pub id: u64,
    pub created_on: Option<String>,
    pub modified_on: Option<String>,
    pub owner_user_id: Option<u64>,
    pub incoming_port: u16,
    pub forwarding_host: String,
    pub forwarding_port: u16,
    pub tcp_forwarding: Option<bool>,
    pub udp_forwarding: Option<bool>,
    pub enabled: Option<bool>,
    pub meta: Option<serde_json::Value>,
    pub owner: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStreamRequest {
    pub incoming_port: u16,
    pub forwarding_host: String,
    pub forwarding_port: u16,
    pub tcp_forwarding: Option<bool>,
    pub udp_forwarding: Option<bool>,
    pub meta: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Certificates
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmCertificate {
    pub id: u64,
    pub created_on: Option<String>,
    pub modified_on: Option<String>,
    pub owner_user_id: Option<u64>,
    pub provider: String,
    pub nice_name: String,
    pub domain_names: Vec<String>,
    pub expires_on: Option<String>,
    pub meta: Option<serde_json::Value>,
    pub owner: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLetsEncryptCertRequest {
    pub domain_names: Vec<String>,
    pub meta: Option<LetsEncryptMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LetsEncryptMeta {
    pub letsencrypt_email: String,
    pub letsencrypt_agree: bool,
    pub dns_challenge: Option<bool>,
    pub dns_provider: Option<String>,
    pub dns_provider_credentials: Option<String>,
    pub propagation_seconds: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadCustomCertRequest {
    pub nice_name: String,
    pub certificate: String,
    pub certificate_key: String,
    pub intermediate_certificate: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmUser {
    pub id: u64,
    pub created_on: Option<String>,
    pub modified_on: Option<String>,
    pub name: String,
    pub nickname: String,
    pub email: String,
    pub avatar: Option<String>,
    pub is_disabled: Option<bool>,
    pub roles: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub name: String,
    pub nickname: String,
    pub email: String,
    pub roles: Option<Vec<String>>,
    pub is_disabled: Option<bool>,
    pub auth: Option<UserAuth>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserAuth {
    #[serde(rename = "type")]
    pub auth_type: String,
    pub secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    pub name: Option<String>,
    pub nickname: Option<String>,
    pub email: Option<String>,
    pub roles: Option<Vec<String>>,
    pub is_disabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangePasswordRequest {
    #[serde(rename = "type")]
    pub auth_type: String,
    pub current: Option<String>,
    pub secret: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Access Lists
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmAccessList {
    pub id: u64,
    pub created_on: Option<String>,
    pub modified_on: Option<String>,
    pub owner_user_id: Option<u64>,
    pub name: String,
    pub satisty_any: Option<bool>,
    pub pass_auth: Option<bool>,
    pub items: Option<Vec<AccessListItem>>,
    pub clients: Option<Vec<AccessListClient>>,
    pub proxy_host_count: Option<u64>,
    pub owner: Option<serde_json::Value>,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessListItem {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessListClient {
    pub address: String,
    pub directive: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAccessListRequest {
    pub name: String,
    pub satisfy_any: Option<bool>,
    pub pass_auth: Option<bool>,
    pub items: Option<Vec<AccessListItem>>,
    pub clients: Option<Vec<AccessListClient>>,
    pub meta: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Settings & Audit
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmSetting {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub value: serde_json::Value,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmAuditLogEntry {
    pub id: u64,
    pub created_on: Option<String>,
    pub modified_on: Option<String>,
    pub user_id: Option<u64>,
    pub object_type: Option<String>,
    pub object_id: Option<u64>,
    pub action: Option<String>,
    pub meta: Option<serde_json::Value>,
    pub user: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reports / Health
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmReports {
    pub proxy: u64,
    pub redirection: u64,
    pub stream: u64,
    pub dead: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmHealthStatus {
    pub status: String,
    pub version: Option<NpmVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmVersion {
    pub major: u32,
    pub minor: u32,
    pub revision: u32,
}
