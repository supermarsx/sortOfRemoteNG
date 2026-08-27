//! Shared types for Nginx Proxy Manager management.
//!
//! NPM's own JSON is **snake_case** and several list endpoints return `0`/`1`
//! integers where the schema says boolean; response structs therefore use the
//! lenient [`bool_from_int`] deserializer on their `Option<bool>` fields.

use serde::{Deserialize, Deserializer, Serialize};

/// Deserialize `true`/`false`, `0`/`1` (or `null`) into `Option<bool>`.
pub fn bool_from_int<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Bool(b)) => Ok(Some(b)),
        Some(serde_json::Value::Number(n)) => Ok(n.as_i64().map(|i| i != 0)),
        Some(serde_json::Value::String(s)) => match s.as_str() {
            "1" | "true" => Ok(Some(true)),
            "0" | "false" => Ok(Some(false)),
            other => Err(serde::de::Error::custom(format!(
                "expected boolean-like value, got {other:?}"
            ))),
        },
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected boolean-like value, got {other}"
        ))),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connection & Auth
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmConnectionConfig {
    /// NPM API URL including scheme (default: http://localhost:81)
    pub api_url: String,
    pub email: Option<String>,
    pub password: Option<String>,
    /// Pre-existing bearer token (used only when email+password are absent)
    pub token: Option<String>,
    /// Accept self-signed / untrusted certificates (https only). Maps to an
    /// explicit, revocable `AlwaysTrust` override in the Trust Center.
    pub skip_tls_verify: Option<bool>,
    /// Runtime acknowledgement that `skip_tls_verify` is a security risk.
    /// Must equal the *effective* skip flag or the connection is refused.
    #[serde(default, skip_serializing)]
    pub acknowledge_invalid_cert_risk: bool,
    pub timeout_secs: Option<u64>,
    pub proxy_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmConnectionSummary {
    pub api_url: String,
    pub user: Option<String>,
    #[serde(default)]
    pub roles: Vec<String>,
    pub version: Option<String>,
    /// `"password"` or `"token"`
    pub auth_mode: String,
    /// ISO-8601 UTC expiry of the current token, when known.
    pub token_expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmTokenResponse {
    pub token: String,
    pub expires: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmTokenPayload {
    pub identity: String,
    pub secret: String,
}

/// `GET /api/` — unauthenticated liveness + version.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmVersionResponse {
    pub status: Option<String>,
    pub version: Option<NpmVersion>,
}

impl NpmVersion {
    pub fn as_string(&self) -> String {
        format!("{}.{}.{}", self.major, self.minor, self.revision)
    }
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
    #[serde(default, deserialize_with = "bool_from_int")]
    pub ssl_forced: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub caching_enabled: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub block_exploits: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub allow_websocket_upgrade: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub http2_support: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub hsts_enabled: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub hsts_subdomains: Option<bool>,
    pub advanced_config: Option<String>,
    #[serde(default, deserialize_with = "bool_from_int")]
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
    #[serde(default, deserialize_with = "bool_from_int")]
    pub preserve_path: Option<bool>,
    pub certificate_id: Option<u64>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub ssl_forced: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub block_exploits: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub hsts_enabled: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub hsts_subdomains: Option<bool>,
    pub advanced_config: Option<String>,
    #[serde(default, deserialize_with = "bool_from_int")]
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
    #[serde(default, deserialize_with = "bool_from_int")]
    pub ssl_forced: Option<bool>,
    pub advanced_config: Option<String>,
    #[serde(default, deserialize_with = "bool_from_int")]
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
    #[serde(default, deserialize_with = "bool_from_int")]
    pub tcp_forwarding: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
    pub udp_forwarding: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
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
    #[serde(default, deserialize_with = "bool_from_int")]
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
    #[serde(default, deserialize_with = "bool_from_int")]
    pub satisty_any: Option<bool>,
    #[serde(default, deserialize_with = "bool_from_int")]
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
