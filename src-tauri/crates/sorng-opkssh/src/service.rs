//! # opkssh Service
//!
//! Central orchestrator for all OpenPubkey SSH operations.
//! Managed as Tauri application state.

use crate::binary::{OpksshBackend, ResolvedBackendRuntime};
use crate::types::*;
use crate::{audit, binary, keys, login, providers, server_policy};
use chrono::Utc;
use log::warn;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

const BACKEND_MODE_ENV: &str = "SORNG_OPKSSH_BACKEND";

fn backend_mode_from_env() -> OpksshBackendMode {
    let Ok(raw) = std::env::var(BACKEND_MODE_ENV) else {
        return OpksshBackendMode::Auto;
    };

    match raw.trim().to_ascii_lowercase().as_str() {
        "" | "auto" => OpksshBackendMode::Auto,
        "library" => OpksshBackendMode::Library,
        "cli" => OpksshBackendMode::Cli,
        invalid => {
            warn!(
                "Ignoring unsupported {} value '{}'; falling back to auto.",
                BACKEND_MODE_ENV,
                invalid,
            );
            OpksshBackendMode::Auto
        }
    }
}

/// Service state type alias for Tauri's `app.manage()`.
pub type OpksshServiceState = Arc<Mutex<OpksshService>>;

/// Encodes the current app-side evidence for whether the CLI path must remain
/// visible during rollout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpksshCliRetirementDecision {
    RetainCliFallback,
    DeferUntilRuntimeEvidence,
    BlockedNoRuntime,
}

/// Small rollout scaffold derived from the current wrapped runtime contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpksshRolloutSignal {
    pub preferred_mode: OpksshBackendMode,
    pub active_backend: Option<OpksshBackendKind>,
    pub using_fallback: bool,
    pub fallback_reason: Option<String>,
    pub cli_retirement_decision: OpksshCliRetirementDecision,
    pub cli_retirement_message: String,
}

/// The OpenPubkey SSH service — manages binary detection, login, keys, server
/// policy, provider configuration, and audit.
pub struct OpksshService {
    /// Preferred backend mode for runtime selection.
    backend_mode: OpksshBackendMode,
    /// Cached runtime-first status.
    runtime_status: Option<OpksshRuntimeStatus>,
    /// Currently selected backend runtime.
    active_backend: Option<OpksshBackend>,
    /// Cached binary status.
    binary_status: Option<OpksshBinaryStatus>,
    /// Path to the CLI fallback binary (if found).
    binary_path: Option<PathBuf>,
    /// Cached active keys.
    active_keys: Vec<OpksshKey>,
    /// Client config cache with provider secrets redacted for transport. Any
    /// pre-existing plaintext secrets remain on disk only for redacted
    /// round-trip preservation; new plaintext writes are blocked.
    client_config: Option<OpksshClientConfig>,
    /// Last login timestamp.
    last_login: Option<chrono::DateTime<Utc>>,
    /// Last error.
    last_error: Option<String>,
    /// The currently tracked login operation, if an OPKSSH auth flow is still
    /// in progress from the app's point of view.
    tracked_login_operation_id: Option<String>,
    /// Server configs keyed by SSH session ID.
    server_configs: HashMap<String, ServerOpksshConfig>,
    /// Audit results keyed by SSH session ID.
    audit_results: HashMap<String, AuditResult>,
}

impl OpksshService {
    pub fn new() -> Self {
        Self {
            backend_mode: backend_mode_from_env(),
            runtime_status: None,
            active_backend: None,
            binary_status: None,
            binary_path: None,
            active_keys: Vec::new(),
            client_config: None,
            last_login: None,
            last_error: None,
            tracked_login_operation_id: None,
            server_configs: HashMap::new(),
            audit_results: HashMap::new(),
        }
    }

    // ── Binary Management ──────────────────────────────────────

    /// Refresh runtime status and keep the CLI helper surface cached.
    pub async fn refresh_runtime_status(&mut self) -> OpksshRuntimeStatus {
        let resolved = binary::resolve_runtime(self.backend_mode.clone()).await;
        self.apply_resolved_runtime(resolved)
    }

    fn apply_resolved_runtime(&mut self, resolved: ResolvedBackendRuntime) -> OpksshRuntimeStatus {
        let runtime_status = resolved.runtime;

        self.active_backend = resolved.active_backend;
        self.binary_path = resolved.cli_binary_path;
        self.binary_status = Some(runtime_status.cli.clone());
        self.runtime_status = Some(runtime_status.clone());

        runtime_status
    }

    /// Check CLI fallback status (detect, get version).
    pub async fn check_binary(&mut self) -> OpksshBinaryStatus {
        self.refresh_runtime_status().await.cli
    }

    /// Get cached binary status or check.
    pub fn get_binary_status(&self) -> Option<&OpksshBinaryStatus> {
        self.binary_status.as_ref()
    }

    /// Get cached runtime-first status.
    pub fn get_runtime_status(&self) -> Option<&OpksshRuntimeStatus> {
        self.runtime_status.as_ref()
    }

    pub fn get_backend_mode(&self) -> OpksshBackendMode {
        self.backend_mode.clone()
    }

    pub fn get_active_backend(&self) -> Option<OpksshBackendKind> {
        self.active_backend.as_ref().map(OpksshBackend::kind)
    }

    pub fn get_binary_path(&self) -> Option<&PathBuf> {
        self.active_backend
            .as_ref()
            .and_then(OpksshBackend::binary_path)
            .or(self.binary_path.as_ref())
    }

    /// Derive the current rollout posture from the runtime-first status model.
    pub fn current_rollout_signal(&self) -> Option<OpksshRolloutSignal> {
        self.runtime_status.as_ref().map(Self::rollout_signal_for_runtime)
    }

    /// Convert the current wrapped runtime contract into an explicit rollout
    /// signal without inventing packaging or telemetry evidence.
    pub fn rollout_signal_for_runtime(runtime: &OpksshRuntimeStatus) -> OpksshRolloutSignal {
        let fallback_reason = Self::fallback_reason_for_runtime(runtime);

        let (cli_retirement_decision, cli_retirement_message) = match runtime.active_backend {
            Some(OpksshBackendKind::Cli) => (
                OpksshCliRetirementDecision::RetainCliFallback,
                if runtime.mode == OpksshBackendMode::Cli {
                    "CLI retirement is deferred: this build is still running in explicit CLI mode for the current rollout seam.".to_string()
                } else {
                    "CLI retirement is deferred: the wrapped contract is still running on CLI fallback, so keep it visible for at least one release cycle.".to_string()
                },
            ),
            Some(OpksshBackendKind::Library) => (
                OpksshCliRetirementDecision::DeferUntilRuntimeEvidence,
                "CLI retirement is still deferred: this seam can prove runtime selection, but it does not yet encode bundle/install evidence for removing fallback.".to_string(),
            ),
            None => (
                OpksshCliRetirementDecision::BlockedNoRuntime,
                "CLI retirement is blocked: this build cannot prove a working wrapped OPKSSH runtime yet.".to_string(),
            ),
        };

        OpksshRolloutSignal {
            preferred_mode: runtime.mode.clone(),
            active_backend: runtime.active_backend.clone(),
            using_fallback: runtime.using_fallback,
            fallback_reason,
            cli_retirement_decision,
            cli_retirement_message,
        }
    }

    fn fallback_reason_for_runtime(runtime: &OpksshRuntimeStatus) -> Option<String> {
        if runtime.active_backend == Some(OpksshBackendKind::Cli) {
            return Some(match runtime.mode {
                OpksshBackendMode::Auto => runtime
                    .message
                    .clone()
                    .or_else(|| runtime.library.message.clone())
                    .unwrap_or_else(|| {
                        "Auto mode kept the CLI fallback because the wrapped in-process backend is not available in this build.".to_string()
                    }),
                OpksshBackendMode::Library => runtime
                    .library
                    .message
                    .clone()
                    .or_else(|| runtime.message.clone())
                    .unwrap_or_else(|| {
                        "Library mode was requested, but the wrapped in-process backend is not available so CLI fallback remained active.".to_string()
                    }),
                OpksshBackendMode::Cli => {
                    "CLI mode is explicitly selected for the current release-cycle fallback seam.".to_string()
                }
            });
        }

        None
    }

    // ── Login ──────────────────────────────────────────────────

    /// Execute `opkssh login` with given options.
    pub async fn login(&mut self, opts: OpksshLoginOptions) -> Result<OpksshLoginResult, String> {
        let runtime = self.refresh_runtime_status().await;
        let provider_hint = opts.provider.clone().or_else(|| opts.issuer.clone());

        if matches!(self.active_backend, Some(OpksshBackend::Library)) {
            let config_path = resolve_wrapper_client_config_path().ok();
            let key_path = resolve_wrapper_login_key_path(&opts)?;
            let opts_for_wrapper = opts.clone();

            let wrapper_result = tokio::task::spawn_blocking(move || {
                binary::execute_login_from_wrapper(
                    &opts_for_wrapper,
                    config_path.as_deref(),
                    &key_path,
                )
            })
            .await
            .map_err(|error| format!("OPKSSH library login task failed: {error}"))?;

            match wrapper_result? {
                Some(mut result) => {
                    if result.provider.is_none() {
                        result.provider = provider_hint.clone();
                    }

                    if result.success {
                        self.last_login = Some(Utc::now());
                        self.last_error = None;
                        self.refresh_keys().await;
                    } else {
                        self.last_error = Some(result.message.clone());
                    }

                    return Ok(result);
                }
                None => {
                    warn!(
                        "OPKSSH library backend was selected, but no callable wrapper login bridge was available at execution time; falling back to the CLI path."
                    );
                }
            }
        }

        let Some(path) = self
            .active_backend
            .as_ref()
            .and_then(OpksshBackend::binary_path)
            .cloned()
            .or_else(|| self.binary_path.clone())
        else {
            let message = runtime.message.clone().unwrap_or_else(|| {
                "No OPKSSH runtime is currently available. The in-process library path is not linked yet and the CLI fallback was not found.".to_string()
            });
            self.last_error = Some(message.clone());
            return Err(message);
        };

        let mut result = login::execute_login(&path, &opts).await?;
        result.clear_raw_output();

        if result.success {
            self.last_login = Some(Utc::now());
            self.last_error = None;
            // Refresh keys after login
            self.refresh_keys().await;
        } else {
            self.last_error = Some(result.message.clone());
        }

        Ok(result)
    }

    pub fn tracked_login_operation_id(&self) -> Option<&str> {
        self.tracked_login_operation_id.as_deref()
    }

    pub fn track_login_operation(&mut self, operation: &login::OpksshLoginOperation) {
        match operation.status {
            login::OpksshLoginOperationStatus::Running => {
                self.tracked_login_operation_id = Some(operation.id.clone());
            }
            login::OpksshLoginOperationStatus::Succeeded => {
                self.clear_tracked_login_operation_if_matches(Some(&operation.id));
                if operation.result.as_ref().is_some_and(|result| result.success) {
                    self.last_login = Some(Utc::now());
                    self.last_error = None;
                } else if let Some(message) = operation.message.clone() {
                    self.last_error = Some(message);
                }
            }
            login::OpksshLoginOperationStatus::Failed
            | login::OpksshLoginOperationStatus::Cancelled => {
                self.clear_tracked_login_operation_if_matches(Some(&operation.id));
                self.last_error = operation.message.clone();
            }
        }
    }

    pub fn clear_tracked_login_operation_if_matches(&mut self, operation_id: Option<&str>) {
        let should_clear = match (self.tracked_login_operation_id.as_deref(), operation_id) {
            (_, None) => true,
            (Some(current), Some(target)) => current == target,
            (None, Some(_)) => false,
        };

        if should_clear {
            self.tracked_login_operation_id = None;
        }
    }

    pub fn concurrent_login_message(
        &mut self,
        operation: &login::OpksshLoginOperation,
    ) -> String {
        let message = match operation.provider.as_deref() {
            Some(provider) if !provider.is_empty() => format!(
                "An OPKSSH login is already running for {provider}. Wait for that browser/provider flow to finish or cancel the local wait before starting another attempt."
            ),
            _ => "An OPKSSH login is already running. Wait for the current browser/provider flow to finish or cancel the local wait before starting another attempt.".to_string(),
        };
        self.last_error = Some(message.clone());
        message
    }

    pub async fn sync_tracked_login_operation(&mut self) {
        let Some(operation_id) = self.tracked_login_operation_id.clone() else {
            return;
        };

        match login::get_login_operation(&operation_id).await {
            Ok(Some(operation)) => self.track_login_operation(&operation),
            Ok(None) => self.clear_tracked_login_operation_if_matches(Some(&operation_id)),
            Err(error) => {
                self.last_error = Some(format!(
                    "Failed to refresh OPKSSH login operation state: {error}"
                ));
            }
        }
    }

    // ── Key Management ─────────────────────────────────────────

    /// Refresh the list of opkssh keys.
    pub async fn refresh_keys(&mut self) -> Vec<OpksshKey> {
        self.active_keys = keys::list_keys().await;
        self.active_keys.clone()
    }

    /// Get cached active keys.
    pub fn get_keys(&self) -> &[OpksshKey] {
        &self.active_keys
    }

    /// Remove a key pair.
    pub async fn remove_key(&mut self, key_path: &str) -> Result<(), String> {
        keys::remove_key(key_path).await?;
        self.refresh_keys().await;
        Ok(())
    }

    // ── Client Config ──────────────────────────────────────────

    /// Read/refresh the local client configuration.
    pub async fn refresh_client_config(&mut self) -> OpksshClientConfig {
        let runtime = self.refresh_runtime_status().await;
        self.refresh_client_config_for_runtime(&runtime).await
    }

    async fn refresh_client_config_for_runtime(
        &mut self,
        runtime: &OpksshRuntimeStatus,
    ) -> OpksshClientConfig {
        let config = if runtime.library.config_load_supported {
            match load_wrapper_backed_client_config() {
                Ok(Some(config)) => config,
                Ok(None) => providers::read_client_config().await,
                Err(error) => {
                    warn!(
                        "Falling back to native client-config parsing after OPKSSH wrapper config-load failure: {}",
                        error
                    );
                    providers::read_client_config().await
                }
            }
        } else {
            providers::read_client_config().await
        };

        let transport = providers::redact_client_config_for_transport(&config);
        self.client_config = Some(transport.clone());
        transport
    }

    /// Get cached client config.
    pub fn get_client_config(&self) -> Option<&OpksshClientConfig> {
        self.client_config.as_ref()
    }

    /// Update the local client configuration and write to disk, rejecting new
    /// plaintext provider-secret writes.
    pub async fn update_client_config(&mut self, config: OpksshClientConfig) -> Result<(), String> {
        let persisted = providers::write_client_config(&config).await?;
        self.client_config = Some(providers::redact_client_config_for_transport(&persisted));
        Ok(())
    }

    /// Get well-known providers.
    pub fn well_known_providers(&self) -> Vec<CustomProvider> {
        providers::well_known_providers()
    }

    // ── Server Policy ──────────────────────────────────────────

    /// Get the script to read server config.
    pub fn build_read_config_script(&self) -> String {
        server_policy::build_read_config_script()
    }

    /// Parse server config output.
    pub fn parse_server_config(&mut self, session_id: &str, raw: &str) -> ServerOpksshConfig {
        let config = server_policy::parse_server_config(raw);
        self.server_configs
            .insert(session_id.to_string(), config.clone());
        config
    }

    /// Get cached server config for a session.
    pub fn get_server_config(&self, session_id: &str) -> Option<&ServerOpksshConfig> {
        self.server_configs.get(session_id)
    }

    /// Build command to add an authorized identity on the server.
    pub fn build_add_identity_command(&self, entry: &AuthIdEntry) -> String {
        server_policy::build_add_identity_command(entry)
    }

    /// Build command to remove an authorized identity.
    pub fn build_remove_identity_command(&self, entry: &AuthIdEntry, user_level: bool) -> String {
        server_policy::build_remove_identity_command(entry, user_level)
    }

    /// Build command to add a provider on the server.
    pub fn build_add_provider_command(&self, entry: &ProviderEntry) -> String {
        server_policy::build_add_provider_command(entry)
    }

    /// Build command to remove a provider.
    pub fn build_remove_provider_command(&self, entry: &ProviderEntry) -> String {
        server_policy::build_remove_provider_command(entry)
    }

    /// Build the server install command.
    pub fn build_install_command(&self, opts: &ServerInstallOptions) -> String {
        server_policy::build_install_command(opts)
    }

    // ── Audit ──────────────────────────────────────────────────

    /// Build audit command.
    pub fn build_audit_command(&self, principal: Option<&str>, limit: Option<usize>) -> String {
        audit::build_audit_command(principal, limit)
    }

    /// Parse audit output.
    pub fn parse_audit_output(&mut self, session_id: &str, raw: &str) -> AuditResult {
        let mut result = audit::parse_audit_output(raw);
        result.clear_raw_output();
        self.audit_results
            .insert(session_id.to_string(), result.clone());
        result
    }

    /// Get cached audit results for a session.
    pub fn get_audit_result(&self, session_id: &str) -> Option<&AuditResult> {
        self.audit_results.get(session_id)
    }

    // ── Overall Status ─────────────────────────────────────────

    /// Get the full service status.
    pub async fn get_status(&mut self) -> OpksshStatus {
        self.sync_tracked_login_operation().await;
        let runtime = self.refresh_runtime_status().await;
        let binary = runtime.cli.clone();
        let active_keys = self.refresh_keys().await;
        let client_config = Some(self.refresh_client_config_for_runtime(&runtime).await);

        OpksshStatus {
            runtime,
            binary,
            active_keys,
            client_config,
            last_login: self.last_login,
            last_error: self.last_error.clone(),
        }
    }

    // ── Environment Variable Helpers ───────────────────────────

    /// Build the OPKSSH_PROVIDERS env var string from the cached redacted
    /// config. Provider secrets already on disk are therefore omitted here.
    pub fn build_env_providers_string(&self) -> Option<String> {
        self.client_config
            .as_ref()
            .map(|c| providers::build_env_providers_string(&c.providers))
    }
}

fn load_wrapper_backed_client_config() -> Result<Option<OpksshClientConfig>, String> {
    let config_path = match resolve_wrapper_client_config_path() {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };

    if !config_path.is_file() {
        return Ok(None);
    }

    let mut config = match binary::load_client_config_from_wrapper(Some(&config_path))? {
        Some(config) => config,
        None => return Ok(None),
    };

    apply_env_provider_overrides(&mut config);
    Ok(Some(config))
}

fn resolve_wrapper_client_config_path() -> Result<PathBuf, String> {
    if let Some(home_dir) = override_home_dir() {
        return Ok(home_dir.join(".opk").join("config.yml"));
    }

    providers::resolve_client_config_path(None)
}

fn resolve_wrapper_login_key_path(opts: &OpksshLoginOptions) -> Result<PathBuf, String> {
    let home_dir = override_home_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "Failed to resolve the home directory for the OPKSSH login key path".to_string())?;

    let key_name = opts
        .key_file_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("id_ecdsa");

    Ok(home_dir.join(".ssh").join(key_name))
}

fn override_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        })
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            if drive.is_empty() || path.is_empty() {
                return None;
            }

            Some(PathBuf::from(drive).join(path))
        })
}

fn apply_env_provider_overrides(config: &mut OpksshClientConfig) {
    if let Ok(default_provider) = std::env::var("OPKSSH_DEFAULT") {
        let default_provider = default_provider.trim();
        if !default_provider.is_empty() {
            config.default_provider = Some(default_provider.to_string());
        }
    }

    if let Ok(env_providers) = std::env::var("OPKSSH_PROVIDERS") {
        let env_providers = parse_env_providers(&env_providers);
        if !env_providers.is_empty() {
            config.providers = merge_provider_sources(config.providers.clone(), env_providers);
        }
    }

    config.normalize_secret_metadata();
}

fn parse_env_providers(value: &str) -> Vec<CustomProvider> {
    value
        .split(';')
        .filter_map(|entry| {
            let mut parts = entry.splitn(5, ',');
            let alias = parts.next()?.trim();
            let issuer = parts.next()?.trim();
            let client_id = parts.next()?.trim();
            let client_secret = parts
                .next()
                .map(str::trim)
                .filter(|secret| !secret.is_empty())
                .map(str::to_string);
            let scopes = parts
                .next()
                .map(str::trim)
                .filter(|scopes| !scopes.is_empty())
                .map(str::to_string);

            if alias.is_empty() || issuer.is_empty() || client_id.is_empty() {
                return None;
            }

            Some(CustomProvider {
                alias: alias.to_string(),
                issuer: issuer.to_string(),
                client_id: client_id.to_string(),
                client_secret_present: client_secret.is_some(),
                client_secret_redacted: false,
                client_secret,
                scopes,
            })
        })
        .collect()
}

fn merge_provider_sources(
    file_providers: Vec<CustomProvider>,
    env_providers: Vec<CustomProvider>,
) -> Vec<CustomProvider> {
    let mut merged = HashMap::new();

    for provider in file_providers {
        merged.insert(provider.alias.clone(), provider);
    }

    for provider in env_providers {
        merged.insert(provider.alias.clone(), provider);
    }

    let mut providers: Vec<_> = merged.into_values().collect();
    providers.sort_by(|left, right| left.alias.cmp(&right.alias));
    providers
}

impl Default for OpksshService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime_status_for_tests() -> OpksshRuntimeStatus {
        OpksshRuntimeStatus {
            mode: OpksshBackendMode::Auto,
            active_backend: Some(OpksshBackendKind::Cli),
            using_fallback: true,
            library: OpksshBackendStatus {
                kind: OpksshBackendKind::Library,
                available: false,
                availability: OpksshRuntimeAvailability::Planned,
                version: None,
                path: None,
                message: Some("libopkssh is not linked yet".into()),
                login_supported: false,
                config_load_supported: false,
                provider_owns_callback_listener: true,
                provider_owns_callback_shutdown: true,
                bundle_contract: None,
            },
            cli: OpksshBinaryStatus {
                installed: true,
                path: Some("/usr/bin/opkssh".into()),
                version: Some("opkssh v0.13.0".into()),
                platform: "linux".into(),
                arch: "x86_64".into(),
                download_url: None,
                backend: OpksshBackendStatus {
                    kind: OpksshBackendKind::Cli,
                    available: true,
                    availability: OpksshRuntimeAvailability::Available,
                    version: Some("opkssh v0.13.0".into()),
                    path: Some("/usr/bin/opkssh".into()),
                    message: None,
                    login_supported: true,
                    config_load_supported: false,
                    provider_owns_callback_listener: true,
                    provider_owns_callback_shutdown: true,
                    bundle_contract: None,
                },
            },
            message: Some("CLI fallback is active".into()),
        }
    }

    fn login_operation_for_tests(
        status: login::OpksshLoginOperationStatus,
        result: Option<OpksshLoginResult>,
        message: Option<&str>,
    ) -> login::OpksshLoginOperation {
        login::OpksshLoginOperation {
            id: "operation-1".into(),
            status,
            provider: Some("google".into()),
            runtime: runtime_status_for_tests(),
            browser_url: None,
            can_cancel: false,
            message: message.map(str::to_string),
            result,
            started_at: Utc::now(),
            finished_at: Some(Utc::now()),
        }
    }

    fn unique_temp_config_path() -> String {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("sorng-opkssh-service-{stamp}"))
            .join("config.yml")
            .to_string_lossy()
            .to_string()
    }

    #[tokio::test]
    async fn update_client_config_redacts_cached_transport_and_preserves_secret_on_disk() {
        let path = unique_temp_config_path();
        let mut service = OpksshService::new();

        let temp_dir = PathBuf::from(&path)
            .parent()
            .expect("config parent")
            .to_path_buf();
        tokio::fs::create_dir_all(&temp_dir)
            .await
            .expect("create temp dir");
        tokio::fs::write(
            &path,
            "default: custom\nproviders:\n  - alias: custom\n    issuer: https://issuer.example\n    client_id: client-id\n    client_secret: super-secret\n    scopes: openid\n",
        )
        .await
        .expect("seed config");

        let updated = OpksshClientConfig {
            config_path: path.clone(),
            default_provider: Some("custom".into()),
            providers: vec![CustomProvider {
                alias: "custom".into(),
                issuer: "https://issuer.example".into(),
                client_id: "updated-client".into(),
                client_secret: None,
                client_secret_present: true,
                client_secret_redacted: true,
                scopes: Some("openid".into()),
            }],
            provider_secrets_present: true,
            secrets_redacted_for_transport: true,
            secret_storage_note: Some("redacted".into()),
        };

        service
            .update_client_config(updated)
            .await
            .expect("rewrite config");

        let cached = service.get_client_config().expect("cached config").clone();
        assert!(cached.provider_secrets_present);
        assert!(cached.secrets_redacted_for_transport);
        assert!(cached.secret_storage_note.is_some());
        assert_eq!(cached.providers[0].client_secret, None);
        assert!(cached.providers[0].client_secret_present);
        assert!(cached.providers[0].client_secret_redacted);
        assert_eq!(
            service.build_env_providers_string().as_deref(),
            Some("custom,https://issuer.example,updated-client,,openid")
        );

        let disk = providers::load_client_config(Some(&path))
            .await
            .expect("disk config");
        assert_eq!(disk.providers[0].client_secret.as_deref(), Some("super-secret"));

        let disk_after = providers::load_client_config(Some(&path))
            .await
            .expect("disk config after rewrite");
        assert_eq!(disk_after.providers[0].client_secret.as_deref(), Some("super-secret"));
        assert_eq!(disk_after.providers[0].client_id, "updated-client");
        let _ = tokio::fs::remove_dir_all(temp_dir).await;
    }

    #[tokio::test]
    async fn update_client_config_rejects_new_plaintext_secret_write() {
        let path = unique_temp_config_path();
        let mut service = OpksshService::new();

        let config = OpksshClientConfig {
            config_path: path.clone(),
            default_provider: Some("custom".into()),
            providers: vec![CustomProvider {
                alias: "custom".into(),
                issuer: "https://issuer.example".into(),
                client_id: "client-id".into(),
                client_secret: Some("super-secret".into()),
                client_secret_present: false,
                client_secret_redacted: false,
                scopes: Some("openid".into()),
            }],
            provider_secrets_present: false,
            secrets_redacted_for_transport: false,
            secret_storage_note: None,
        };

        let error = service
            .update_client_config(config)
            .await
            .expect_err("new plaintext secrets should be rejected");
        assert!(error.contains("blocked"));
        assert!(!PathBuf::from(&path).exists());
    }

    #[test]
    fn parse_audit_output_clears_raw_output_before_caching() {
        let mut service = OpksshService::new();
        let result = service.parse_audit_output(
            "session-1",
            "alice@example.com root https://accounts.google.com login success",
        );

        assert!(result.raw_output.is_empty());
        assert!(service
            .get_audit_result("session-1")
            .is_some_and(|cached| cached.raw_output.is_empty()));
    }

    #[test]
    fn track_login_operation_updates_running_and_terminal_state() {
        let mut service = OpksshService::new();
        let running = login::OpksshLoginOperation {
            id: "operation-1".into(),
            status: login::OpksshLoginOperationStatus::Running,
            provider: Some("google".into()),
            runtime: runtime_status_for_tests(),
            browser_url: None,
            can_cancel: true,
            message: Some("Waiting for browser callback".into()),
            result: None,
            started_at: Utc::now(),
            finished_at: None,
        };

        service.track_login_operation(&running);
        assert_eq!(service.tracked_login_operation_id(), Some("operation-1"));

        let cancelled = login_operation_for_tests(
            login::OpksshLoginOperationStatus::Cancelled,
            None,
            Some("Cancelled locally while the provider-owned callback may still continue."),
        );
        service.track_login_operation(&cancelled);

        assert_eq!(service.tracked_login_operation_id(), None);
        assert!(service
            .last_error
            .as_deref()
            .is_some_and(|message| message.contains("provider-owned callback")));
    }

    #[test]
    fn concurrent_login_message_is_actionable() {
        let mut service = OpksshService::new();
        let running = login::OpksshLoginOperation {
            id: "operation-1".into(),
            status: login::OpksshLoginOperationStatus::Running,
            provider: Some("gitlab".into()),
            runtime: runtime_status_for_tests(),
            browser_url: None,
            can_cancel: true,
            message: Some("Waiting for browser callback".into()),
            result: None,
            started_at: Utc::now(),
            finished_at: None,
        };

        let message = service.concurrent_login_message(&running);
        assert!(message.contains("gitlab"));
        assert!(message.contains("cancel the local wait"));
        assert_eq!(service.last_error.as_deref(), Some(message.as_str()));
    }

    #[test]
    fn successful_terminal_login_clears_last_error() {
        let mut service = OpksshService::new();
        service.last_error = Some("stale error".into());
        service.tracked_login_operation_id = Some("operation-1".into());

        let operation = login_operation_for_tests(
            login::OpksshLoginOperationStatus::Succeeded,
            Some(OpksshLoginResult {
                success: true,
                key_path: Some("/tmp/id_ecdsa".into()),
                identity: Some("user@example.com".into()),
                provider: Some("google".into()),
                expires_at: None,
                message: "Login successful".into(),
                raw_output: String::new(),
            }),
            Some("Login successful"),
        );

        service.track_login_operation(&operation);

        assert!(service.last_login.is_some());
        assert!(service.last_error.is_none());
        assert_eq!(service.tracked_login_operation_id(), None);
    }

    #[test]
    fn rollout_signal_keeps_cli_fallback_visible_for_auto_mode() {
        let signal = OpksshService::rollout_signal_for_runtime(&runtime_status_for_tests());

        assert_eq!(signal.preferred_mode, OpksshBackendMode::Auto);
        assert_eq!(signal.active_backend, Some(OpksshBackendKind::Cli));
        assert!(signal.using_fallback);
        assert!(signal
            .fallback_reason
            .as_deref()
            .is_some_and(|message| message.contains("CLI fallback")));
        assert_eq!(
            signal.cli_retirement_decision,
            OpksshCliRetirementDecision::RetainCliFallback
        );
        assert!(signal.cli_retirement_message.contains("release cycle"));
    }

    #[test]
    fn rollout_signal_defers_cli_retirement_even_when_library_runtime_is_selected() {
        let mut runtime = runtime_status_for_tests();
        runtime.mode = OpksshBackendMode::Library;
        runtime.active_backend = Some(OpksshBackendKind::Library);
        runtime.using_fallback = false;
        runtime.library.available = true;
        runtime.library.availability = OpksshRuntimeAvailability::Available;
        runtime.library.message = Some("Wrapped library runtime selected".into());
        runtime.message = Some("Library runtime active".into());

        let signal = OpksshService::rollout_signal_for_runtime(&runtime);

        assert_eq!(signal.preferred_mode, OpksshBackendMode::Library);
        assert_eq!(signal.active_backend, Some(OpksshBackendKind::Library));
        assert!(!signal.using_fallback);
        assert_eq!(signal.fallback_reason, None);
        assert_eq!(
            signal.cli_retirement_decision,
            OpksshCliRetirementDecision::DeferUntilRuntimeEvidence
        );
        assert!(signal.cli_retirement_message.contains("bundle/install evidence"));
    }
}
