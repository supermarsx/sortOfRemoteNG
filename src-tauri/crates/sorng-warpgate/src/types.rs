// ── sorng-warpgate/src/types.rs ─────────────────────────────────────────────
//! Comprehensive Warpgate admin REST API types.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for connecting to a Warpgate instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateConnectionConfig {
    pub name: String,
    /// Warpgate HTTPS admin URL, e.g. `https://warpgate.example.com:8888`.
    pub host: String,
    /// Username for admin login.
    pub username: String,
    /// Password for admin login.
    pub password: String,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    #[serde(default)]
    pub skip_tls_verify: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateConnectionStatus {
    pub connected: bool,
    pub host: String,
    pub version: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Targets
// ═══════════════════════════════════════════════════════════════════════════════

/// Target kind enum matching Warpgate TargetKind.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub enum WarpgateTargetKind {
    Ssh,
    Http,
    MySql,
    WebAdmin,
    PostgreSql,
    Kubernetes,
}

/// SSH target authentication options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTargetPasswordAuth {
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTargetPublicKeyAuth {
    // empty – uses server's key
}

/// SSH target auth enum.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "PascalCase")]
pub enum SshTargetAuth {
    Password(SshTargetPasswordAuth),
    PublicKey(SshTargetPublicKeyAuth),
}

/// SSH target-specific options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSshOptions {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshTargetAuth,
    #[serde(default)]
    pub allow_insecure_algos: Option<bool>,
}

/// HTTP target-specific options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetHttpOptions {
    pub url: String,
    #[serde(default)]
    pub tls: Option<TargetTlsOptions>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub external_host: Option<String>,
}

/// TLS options for HTTP targets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetTlsOptions {
    pub mode: String,
    pub verify: bool,
}

/// MySQL target-specific options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetMySqlOptions {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    #[serde(default)]
    pub tls: Option<TargetTlsOptions>,
}

/// PostgreSQL target-specific options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetPostgreSqlOptions {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    #[serde(default)]
    pub tls: Option<TargetTlsOptions>,
}

/// Kubernetes target-specific options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetKubernetesOptions {
    pub kubeconfig: Option<String>,
    pub context: Option<String>,
    pub namespace: Option<String>,
}

/// WebAdmin target-specific options (internal).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetWebAdminOptions {}

/// Unified target options enum.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "PascalCase")]
pub enum TargetOptions {
    Ssh(TargetSshOptions),
    Http(TargetHttpOptions),
    #[serde(rename = "MySql")]
    MySql(TargetMySqlOptions),
    WebAdmin(TargetWebAdminOptions),
    #[serde(rename = "PostgreSql")]
    PostgreSql(TargetPostgreSqlOptions),
    Kubernetes(TargetKubernetesOptions),
}

/// A Warpgate target (SSH host, HTTP service, DB, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateTarget {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub options: TargetOptions,
    #[serde(default)]
    pub rate_limit_bytes_per_second: Option<u32>,
    #[serde(default)]
    pub group_id: Option<String>,
}

/// Request to create or update a target.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetDataRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub options: TargetOptions,
    #[serde(default)]
    pub rate_limit_bytes_per_second: Option<u32>,
    #[serde(default)]
    pub group_id: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Target Groups
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateTargetGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetGroupDataRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Roles
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateRole {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleDataRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════════

/// User credential requirement policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRequireCredentialsPolicy {
    #[serde(default)]
    pub password: Option<bool>,
    #[serde(default)]
    pub public_key: Option<bool>,
    #[serde(default)]
    pub totp: Option<bool>,
    #[serde(default)]
    pub sso: Option<bool>,
    #[serde(default)]
    pub certificate: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateUser {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub credential_policy: Option<UserRequireCredentialsPolicy>,
    #[serde(default)]
    pub rate_limit_bytes_per_second: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
    pub username: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRequest {
    pub username: String,
    #[serde(default)]
    pub credential_policy: Option<UserRequireCredentialsPolicy>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub rate_limit_bytes_per_second: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateSession {
    pub id: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub target_name: Option<String>,
    #[serde(default)]
    pub started: Option<String>,
    #[serde(default)]
    pub ended: Option<String>,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListResponse {
    pub data: Vec<WarpgateSession>,
    #[serde(default)]
    pub offset: Option<u64>,
    #[serde(default)]
    pub total: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Recordings
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateRecording {
    pub id: String,
    pub session_id: String,
    pub name: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub started: Option<String>,
    #[serde(default)]
    pub ended: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tickets (access tokens)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateTicket {
    pub id: String,
    pub username: String,
    pub target: String,
    #[serde(default)]
    pub secret: Option<String>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub expiry: Option<String>,
    #[serde(default)]
    pub uses_left: Option<i16>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTicketRequest {
    pub username: String,
    pub target_name: String,
    #[serde(default)]
    pub expiry: Option<String>,
    #[serde(default)]
    pub number_of_uses: Option<i16>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketAndSecret {
    pub ticket: WarpgateTicket,
    pub secret: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Credentials (per-user)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordCredential {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPasswordCredential {
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicKeyCredential {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub date_added: Option<String>,
    #[serde(default)]
    pub last_used: Option<String>,
    #[serde(default)]
    pub openssh_public_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPublicKeyCredential {
    pub label: String,
    pub openssh_public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsoCredential {
    pub id: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSsoCredential {
    #[serde(default)]
    pub provider: Option<String>,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtpCredential {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewOtpCredential {
    pub secret_key: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateCredential {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub date_added: Option<String>,
    #[serde(default)]
    pub last_used: Option<String>,
    #[serde(default)]
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueCertificateRequest {
    pub label: String,
    pub public_key_pem: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedCertificate {
    pub credential: CertificateCredential,
    pub certificate_pem: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCertificateLabel {
    pub label: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH Keys
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateSshKey {
    pub kind: String,
    pub public_key_base64: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Known Hosts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateKnownHost {
    pub id: String,
    pub host: String,
    pub port: i32,
    pub key_type: String,
    pub key_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddKnownHostRequest {
    pub host: String,
    pub port: i32,
    pub key_type: String,
    pub key_base64: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH Connection Test
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckSshHostKeyRequest {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckSshHostKeyResponse {
    pub remote_key_type: String,
    pub remote_key_base64: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// LDAP Servers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateLdapServer {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub bind_dn: String,
    pub user_filter: String,
    #[serde(default)]
    pub base_dns: Vec<String>,
    #[serde(default)]
    pub tls_mode: Option<String>,
    #[serde(default)]
    pub tls_verify: Option<bool>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub auto_link_sso_users: Option<bool>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub username_attribute: Option<String>,
    #[serde(default)]
    pub ssh_key_attribute: Option<String>,
    #[serde(default)]
    pub uuid_attribute: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLdapServerRequest {
    pub name: String,
    pub host: String,
    #[serde(default = "default_ldap_port")]
    pub port: i32,
    pub bind_dn: String,
    pub bind_password: String,
    #[serde(default = "default_user_filter")]
    pub user_filter: String,
    #[serde(default)]
    pub tls_mode: Option<String>,
    #[serde(default = "default_true")]
    pub tls_verify: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub auto_link_sso_users: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub username_attribute: Option<String>,
    #[serde(default)]
    pub ssh_key_attribute: Option<String>,
    #[serde(default)]
    pub uuid_attribute: Option<String>,
}

fn default_ldap_port() -> i32 { 389 }
fn default_user_filter() -> String { "(objectClass=person)".to_string() }
fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLdapServerRequest {
    pub name: String,
    pub host: String,
    pub port: i32,
    pub bind_dn: String,
    #[serde(default)]
    pub bind_password: Option<String>,
    pub user_filter: String,
    #[serde(default)]
    pub tls_mode: Option<String>,
    #[serde(default)]
    pub tls_verify: Option<bool>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub auto_link_sso_users: Option<bool>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub username_attribute: Option<String>,
    #[serde(default)]
    pub ssh_key_attribute: Option<String>,
    #[serde(default)]
    pub uuid_attribute: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestLdapServerRequest {
    pub host: String,
    pub port: i32,
    pub bind_dn: String,
    pub bind_password: String,
    #[serde(default)]
    pub tls_mode: Option<String>,
    #[serde(default)]
    pub tls_verify: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestLdapServerResponse {
    pub success: bool,
    pub message: String,
    #[serde(default)]
    pub base_dns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapUser {
    pub username: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    pub dn: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLdapUsersRequest {
    pub dns: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetLogsRequest {
    #[serde(default)]
    pub before: Option<String>,
    #[serde(default)]
    pub after: Option<String>,
    #[serde(default)]
    pub limit: Option<u64>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateLogEntry {
    pub id: String,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parameters (system config)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpgateParameters {
    pub allow_own_credential_management: bool,
    #[serde(default)]
    pub rate_limit_bytes_per_second: Option<u32>,
    #[serde(default)]
    pub ssh_client_auth_publickey: Option<bool>,
    #[serde(default)]
    pub ssh_client_auth_password: Option<bool>,
    #[serde(default)]
    pub ssh_client_auth_keyboard_interactive: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateParametersRequest {
    pub allow_own_credential_management: bool,
    #[serde(default)]
    pub rate_limit_bytes_per_second: Option<u32>,
    #[serde(default)]
    pub ssh_client_auth_publickey: Option<bool>,
    #[serde(default)]
    pub ssh_client_auth_password: Option<bool>,
    #[serde(default)]
    pub ssh_client_auth_keyboard_interactive: Option<bool>,
}
