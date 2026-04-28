//! # opkssh Types
//!
//! All data structures for the OpenPubkey SSH integration.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

const CLIENT_SECRET_STORAGE_NOTE: &str = "Provider client_secret values are redacted from the app transport/cache. New plaintext client_secret writes are blocked by the repo wrapper because ~/.opk/config.yml stores them unencrypted. Existing client_secret values already present in ~/.opk/config.yml can still remain plaintext on disk and are only preserved during redacted updates in this slice.";

// ── Runtime / Installation ──────────────────────────────────────────

/// Preferred backend mode for the local opkssh runtime.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum OpksshBackendMode {
    #[default]
    Auto,
    Library,
    Cli,
}

/// Concrete backend kind used by the local opkssh runtime.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OpksshBackendKind {
    Library,
    Cli,
}

/// Availability state for a specific opkssh runtime.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OpksshRuntimeAvailability {
    Available,
    Planned,
    Unavailable,
}

/// Status of the revived hard-dylink bundle contract for the OPKSSH vendor
/// wrapper artifact.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OpksshVendorLoadStrategy {
    LinkedFeature,
    OverridePath,
    PackagedResource,
    WorkspaceBundle,
}

/// Status of the revived hard-dylink bundle contract for the OPKSSH vendor
/// wrapper artifact.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshBundleArtifactStatus {
    pub dylib_required: bool,
    pub tauri_bundle_configured: bool,
    pub app_linked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrapper_abi_version: Option<u32>,
    pub workspace_bundle_dir: String,
    pub workspace_artifact_path: String,
    pub resource_relative_path: String,
    pub artifact_name: String,
    pub artifact_present: bool,
    #[serde(default)]
    pub metadata_queryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load_strategy: Option<OpksshVendorLoadStrategy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loaded_artifact_path: Option<String>,
    #[serde(default)]
    pub embedded_runtime_present: bool,
    #[serde(default)]
    pub backend_callable: bool,
    #[serde(default)]
    pub config_load_supported: bool,
    #[serde(default)]
    pub login_supported: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load_error: Option<String>,
    pub message: Option<String>,
}

/// Status of a specific opkssh backend/runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshBackendStatus {
    pub kind: OpksshBackendKind,
    pub available: bool,
    pub availability: OpksshRuntimeAvailability,
    pub version: Option<String>,
    pub path: Option<String>,
    pub message: Option<String>,
    #[serde(default)]
    pub login_supported: bool,
    #[serde(default)]
    pub config_load_supported: bool,
    pub provider_owns_callback_listener: bool,
    pub provider_owns_callback_shutdown: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_contract: Option<OpksshBundleArtifactStatus>,
}

/// Status of the CLI fallback binary on the local machine.
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
    /// Backend/runtime metadata for the CLI path.
    pub backend: OpksshBackendStatus,
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
    /// Compatibility-only field retained for immediate internal parsing. It is
    /// skipped during serialization so raw CLI output is not part of the
    /// long-lived app contract.
    #[serde(default, skip_serializing)]
    pub raw_output: String,
}

impl OpksshLoginResult {
    pub fn clear_raw_output(&mut self) {
        self.raw_output.clear();
    }
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
    /// Write-only on request paths. Service responses redact the value and
    /// surface only presence metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    #[serde(default)]
    pub client_secret_present: bool,
    #[serde(default)]
    pub client_secret_redacted: bool,
    pub scopes: Option<String>,
}

/// Local client configuration for opkssh.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshClientConfig {
    pub config_path: String,
    pub default_provider: Option<String>,
    pub providers: Vec<CustomProvider>,
    #[serde(default)]
    pub provider_secrets_present: bool,
    #[serde(default)]
    pub secrets_redacted_for_transport: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_storage_note: Option<String>,
}

impl CustomProvider {
    pub fn has_client_secret(&self) -> bool {
        self.client_secret
            .as_deref()
            .is_some_and(|secret| !secret.is_empty())
            || self.client_secret_present
    }

    pub fn normalize_secret_metadata(&mut self) {
        let has_secret = self
            .client_secret
            .as_deref()
            .is_some_and(|secret| !secret.is_empty())
            || self.client_secret_present;

        self.client_secret_present = has_secret;
        if !has_secret {
            self.client_secret = None;
            self.client_secret_redacted = false;
        }
    }

    pub fn redacted_for_transport(&self) -> Self {
        let mut provider = self.clone();
        let has_secret = provider.has_client_secret();
        provider.client_secret = None;
        provider.client_secret_present = has_secret;
        provider.client_secret_redacted = has_secret;
        provider
    }
}

impl OpksshClientConfig {
    pub fn normalize_secret_metadata(&mut self) {
        for provider in &mut self.providers {
            provider.normalize_secret_metadata();
        }

        self.provider_secrets_present =
            self.providers.iter().any(CustomProvider::has_client_secret);
        if !self.provider_secrets_present {
            self.secrets_redacted_for_transport = false;
            self.secret_storage_note = None;
        }
    }

    pub fn redacted_for_transport(&self) -> Self {
        let mut config = self.clone();
        config.normalize_secret_metadata();

        let has_provider_secrets = config.provider_secrets_present;
        config.providers = config
            .providers
            .iter()
            .map(CustomProvider::redacted_for_transport)
            .collect();
        config.provider_secrets_present = has_provider_secrets;
        config.secrets_redacted_for_transport = has_provider_secrets;
        config.secret_storage_note =
            has_provider_secrets.then(|| CLIENT_SECRET_STORAGE_NOTE.to_string());
        config
    }
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
    /// Compatibility-only field retained for immediate internal parsing. It is
    /// skipped during serialization so raw audit text is not part of the
    /// long-lived app contract.
    #[serde(default, skip_serializing)]
    pub raw_output: String,
}

impl AuditResult {
    pub fn clear_raw_output(&mut self) {
        self.raw_output.clear();
    }
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
    /// Compatibility-only field retained for immediate execution boundaries. It
    /// is skipped during serialization so raw install output is not treated as
    /// part of the long-lived app contract.
    #[serde(default, skip_serializing)]
    pub raw_output: String,
}

impl ServerInstallResult {
    pub fn clear_raw_output(&mut self) {
        self.raw_output.clear();
    }
}

// ── Overall Service Status ──────────────────────────────────────────

/// Runtime-first status for opkssh backend selection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshRuntimeStatus {
    pub mode: OpksshBackendMode,
    pub active_backend: Option<OpksshBackendKind>,
    pub using_fallback: bool,
    pub library: OpksshBackendStatus,
    pub cli: OpksshBinaryStatus,
    pub message: Option<String>,
}

/// Overall opkssh integration status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshStatus {
    /// Runtime-first view of the active backend and fallback state.
    pub runtime: OpksshRuntimeStatus,
    /// Compatibility alias for the CLI fallback runtime.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_config_transport_redaction_preserves_secret_presence_metadata() {
        let config = OpksshClientConfig {
            config_path: "/tmp/opk/config.yml".into(),
            default_provider: Some("custom".into()),
            providers: vec![CustomProvider {
                alias: "custom".into(),
                issuer: "https://issuer.example".into(),
                client_id: "client-id".into(),
                client_secret: Some("super-secret".into()),
                client_secret_present: false,
                client_secret_redacted: false,
                scopes: Some("openid profile".into()),
            }],
            provider_secrets_present: false,
            secrets_redacted_for_transport: false,
            secret_storage_note: None,
        };

        let redacted = config.redacted_for_transport();

        assert!(redacted.provider_secrets_present);
        assert!(redacted.secrets_redacted_for_transport);
        assert!(redacted.secret_storage_note.is_some());
        assert_eq!(redacted.providers[0].client_secret, None);
        assert!(redacted.providers[0].client_secret_present);
        assert!(redacted.providers[0].client_secret_redacted);
    }

    #[test]
    fn raw_output_helpers_clear_compatibility_fields() {
        let mut login = OpksshLoginResult {
            success: false,
            key_path: None,
            identity: None,
            provider: None,
            expires_at: None,
            message: "failed".into(),
            raw_output: "token=secret".into(),
        };
        login.clear_raw_output();
        assert!(login.raw_output.is_empty());

        let mut audit = AuditResult {
            entries: Vec::new(),
            total_count: 0,
            raw_output: "audit details".into(),
        };
        audit.clear_raw_output();
        assert!(audit.raw_output.is_empty());
    }

    #[test]
    fn raw_output_fields_are_not_serialized() {
        let login = OpksshLoginResult {
            success: true,
            key_path: Some("/tmp/id_ecdsa".into()),
            identity: Some("user@example.com".into()),
            provider: Some("google".into()),
            expires_at: None,
            message: "Login successful".into(),
            raw_output: "access_token=secret".into(),
        };
        let login_json = serde_json::to_value(&login).expect("serialize login result");
        assert!(login_json.get("rawOutput").is_none());

        let audit = AuditResult {
            entries: Vec::new(),
            total_count: 0,
            raw_output: "audit raw text".into(),
        };
        let audit_json = serde_json::to_value(&audit).expect("serialize audit result");
        assert!(audit_json.get("rawOutput").is_none());

        let install = ServerInstallResult {
            success: false,
            version: None,
            message: "install failed".into(),
            raw_output: "stderr with token".into(),
        };
        let install_json = serde_json::to_value(&install).expect("serialize install result");
        assert!(install_json.get("rawOutput").is_none());
    }
}
