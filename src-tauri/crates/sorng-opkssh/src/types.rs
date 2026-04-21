//! # opkssh Types
//!
//! All data structures for the OpenPubkey SSH integration.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── Binary / Installation ───────────────────────────────────────────

/// Status of the opkssh binary on the local machine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshBinaryStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub platform: String,
    pub arch: String,
    /// URL for the latest release binary for this platform.
    pub download_url: Option<String>,
}

/// Supported OIDC providers (well-known aliases).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OpksshProviderAlias {
    Google,
    Microsoft,
    Azure,
    Gitlab,
    HelloDev,
    Authelia,
    Authentik,
    AwsCognito,
    Keycloak,
    Kanidm,
    PocketId,
    Zitadel,
    Custom,
}

impl std::fmt::Display for OpksshProviderAlias {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Google => write!(f, "google"),
            Self::Microsoft | Self::Azure => write!(f, "azure"),
            Self::Gitlab => write!(f, "gitlab"),
            Self::HelloDev => write!(f, "hello.dev"),
            Self::Authelia => write!(f, "authelia"),
            Self::Authentik => write!(f, "authentik"),
            Self::AwsCognito => write!(f, "cognito"),
            Self::Keycloak => write!(f, "keycloak"),
            Self::Kanidm => write!(f, "kanidm"),
            Self::PocketId => write!(f, "pocketid"),
            Self::Zitadel => write!(f, "zitadel"),
            Self::Custom => write!(f, "custom"),
        }
    }
}

// ── OIDC Login ──────────────────────────────────────────────────────

/// Options for `opkssh login`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpksshLoginOptions {
    /// Provider alias (google, azure, gitlab, …) or custom issuer string.
    pub provider: Option<String>,
    /// Custom issuer URI (used with custom providers).
    pub issuer: Option<String>,
    /// Client ID (used with custom providers).
    pub client_id: Option<String>,
    /// Client secret (rare, used with some custom providers).
    pub client_secret: Option<String>,
    /// Scopes (e.g. "openid profile email groups").
    pub scopes: Option<String>,
    /// Custom key file name (default: id_ecdsa).
    pub key_file_name: Option<String>,
    /// Whether to create/update the client config file (~/.opk/config.yml).
    pub create_config: bool,
    /// Remote redirect URI (for termix-style headless login).
    pub remote_redirect_uri: Option<String>,
}

/// Result of a successful `opkssh login`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshLoginResult {
    pub success: bool,
    pub key_path: Option<String>,
    pub identity: Option<String>,
    pub provider: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub message: String,
    pub raw_output: String,
}

// ── Key Management ──────────────────────────────────────────────────

/// An opkssh-generated SSH key on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshKey {
    pub id: String,
    pub path: String,
    pub public_key_path: String,
    pub identity: Option<String>,
    pub provider: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub is_expired: bool,
    pub algorithm: String,
    pub fingerprint: Option<String>,
}

// ── Server Policy ───────────────────────────────────────────────────

/// Expiration policy for a provider entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ExpirationPolicy {
    #[serde(rename = "12h")]
    TwelveHours,
    #[serde(rename = "24h")]
    #[default]
    TwentyFourHours,
    #[serde(rename = "48h")]
    FortyEightHours,
    #[serde(rename = "1week")]
    OneWeek,
    #[serde(rename = "oidc")]
    Oidc,
    #[serde(rename = "oidc-refreshed")]
    OidcRefreshed,
}

impl std::fmt::Display for ExpirationPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TwelveHours => write!(f, "12h"),
            Self::TwentyFourHours => write!(f, "24h"),
            Self::FortyEightHours => write!(f, "48h"),
            Self::OneWeek => write!(f, "1week"),
            Self::Oidc => write!(f, "oidc"),
            Self::OidcRefreshed => write!(f, "oidc-refreshed"),
        }
    }
}

/// An entry in `/etc/opk/providers`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEntry {
    pub issuer: String,
    pub client_id: String,
    pub expiration_policy: ExpirationPolicy,
}

/// An entry in `/etc/opk/auth_id` or `~/.opk/auth_id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthIdEntry {
    /// The Linux user/principal this identity maps to.
    pub principal: String,
    /// Email address, subject ID, or group identifier (e.g. `oidc:groups:ssh-users`).
    pub identity: String,
    /// Issuer URI (or alias like "google", "azure").
    pub issuer: String,
}

/// Full server-side opkssh configuration snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerOpksshConfig {
    pub installed: bool,
    pub version: Option<String>,
    pub providers: Vec<ProviderEntry>,
    pub global_auth_ids: Vec<AuthIdEntry>,
    pub user_auth_ids: Vec<AuthIdEntry>,
    /// Contents of sshd_config relevant to opkssh.
    pub sshd_config_snippet: Option<String>,
}

// ── Provider Configuration ──────────────────────────────────────────

/// A custom provider definition in `~/.opk/config.yml` or env vars.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProvider {
    pub alias: String,
    pub issuer: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub scopes: Option<String>,
}

/// Local client configuration for opkssh.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshClientConfig {
    pub config_path: String,
    pub default_provider: Option<String>,
    pub providers: Vec<CustomProvider>,
}

// ── Audit ───────────────────────────────────────────────────────────

/// An opkssh audit record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub timestamp: Option<DateTime<Utc>>,
    pub identity: String,
    pub principal: String,
    pub issuer: String,
    pub action: String,
    pub source_ip: Option<String>,
    pub success: bool,
    pub details: Option<String>,
}

/// Result of an audit query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditResult {
    pub entries: Vec<AuditEntry>,
    pub total_count: usize,
    pub raw_output: String,
}

// ── Server Install ──────────────────────────────────────────────────

/// Options for installing opkssh on a remote server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInstallOptions {
    /// SSH session ID to execute commands on.
    pub session_id: String,
    /// Use the official install script (wget | sudo bash).
    pub use_install_script: bool,
    /// Manually specify the binary URL (for air-gapped / custom builds).
    pub custom_binary_url: Option<String>,
}

/// Result of a server install operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInstallResult {
    pub success: bool,
    pub version: Option<String>,
    pub message: String,
    pub raw_output: String,
}

// ── Overall Service Status ──────────────────────────────────────────

/// Overall opkssh integration status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshStatus {
    pub binary: OpksshBinaryStatus,
    pub active_keys: Vec<OpksshKey>,
    pub client_config: Option<OpksshClientConfig>,
    pub last_login: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

// ── Command Execution ───────────────────────────────────────────────

/// Generic result from running an opkssh CLI command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}
