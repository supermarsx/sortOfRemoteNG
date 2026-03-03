//! # opkssh Service
//!
//! Central orchestrator for all OpenPubkey SSH operations.
//! Managed as Tauri application state.

use crate::types::*;
use crate::{binary, keys, login, providers, server_policy, audit};
use chrono::Utc;
use log::{info, warn};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Service state type alias for Tauri's `app.manage()`.
pub type OpksshServiceState = Arc<Mutex<OpksshService>>;

/// The OpenPubkey SSH service — manages binary detection, login, keys, server
/// policy, provider configuration, and audit.
pub struct OpksshService {
    /// Cached binary status.
    binary_status: Option<OpksshBinaryStatus>,
    /// Path to the opkssh binary (if found).
    binary_path: Option<PathBuf>,
    /// Cached active keys.
    active_keys: Vec<OpksshKey>,
    /// Client config cache.
    client_config: Option<OpksshClientConfig>,
    /// Last login timestamp.
    last_login: Option<chrono::DateTime<Utc>>,
    /// Last error.
    last_error: Option<String>,
    /// Server configs keyed by SSH session ID.
    server_configs: HashMap<String, ServerOpksshConfig>,
    /// Audit results keyed by SSH session ID.
    audit_results: HashMap<String, AuditResult>,
}

impl OpksshService {
    pub fn new() -> Self {
        Self {
            binary_status: None,
            binary_path: None,
            active_keys: Vec::new(),
            client_config: None,
            last_login: None,
            last_error: None,
            server_configs: HashMap::new(),
            audit_results: HashMap::new(),
        }
    }

    // ── Binary Management ──────────────────────────────────────

    /// Check binary status (detect, get version).
    pub async fn check_binary(&mut self) -> OpksshBinaryStatus {
        let status = binary::check_status().await;
        self.binary_path = status.path.as_ref().map(PathBuf::from);
        self.binary_status = Some(status.clone());
        status
    }

    /// Get cached binary status or check.
    pub fn get_binary_status(&self) -> Option<&OpksshBinaryStatus> {
        self.binary_status.as_ref()
    }

    pub fn get_binary_path(&self) -> Option<&PathBuf> {
        self.binary_path.as_ref()
    }

    // ── Login ──────────────────────────────────────────────────

    /// Execute `opkssh login` with given options.
    pub async fn login(&mut self, opts: OpksshLoginOptions) -> Result<OpksshLoginResult, String> {
        let path = self
            .binary_path
            .clone()
            .ok_or_else(|| "opkssh binary not found. Install it first.".to_string())?;

        let result = login::execute_login(&path, &opts).await?;

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
        let config = providers::read_client_config().await;
        self.client_config = Some(config.clone());
        config
    }

    /// Get cached client config.
    pub fn get_client_config(&self) -> Option<&OpksshClientConfig> {
        self.client_config.as_ref()
    }

    /// Update the local client configuration and write to disk.
    pub async fn update_client_config(
        &mut self,
        config: OpksshClientConfig,
    ) -> Result<(), String> {
        providers::write_client_config(&config).await?;
        self.client_config = Some(config);
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
    pub fn parse_server_config(
        &mut self,
        session_id: &str,
        raw: &str,
    ) -> ServerOpksshConfig {
        let config = server_policy::parse_server_config(raw);
        self.server_configs.insert(session_id.to_string(), config.clone());
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
    pub fn build_remove_identity_command(
        &self,
        entry: &AuthIdEntry,
        user_level: bool,
    ) -> String {
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
    pub fn build_audit_command(
        &self,
        principal: Option<&str>,
        limit: Option<usize>,
    ) -> String {
        audit::build_audit_command(principal, limit)
    }

    /// Parse audit output.
    pub fn parse_audit_output(
        &mut self,
        session_id: &str,
        raw: &str,
    ) -> AuditResult {
        let result = audit::parse_audit_output(raw);
        self.audit_results.insert(session_id.to_string(), result.clone());
        result
    }

    /// Get cached audit results for a session.
    pub fn get_audit_result(&self, session_id: &str) -> Option<&AuditResult> {
        self.audit_results.get(session_id)
    }

    // ── Overall Status ─────────────────────────────────────────

    /// Get the full service status.
    pub async fn get_status(&mut self) -> OpksshStatus {
        let binary = self.check_binary().await;
        let active_keys = self.refresh_keys().await;
        let client_config = Some(self.refresh_client_config().await);

        OpksshStatus {
            binary,
            active_keys,
            client_config,
            last_login: self.last_login,
            last_error: self.last_error.clone(),
        }
    }

    // ── Environment Variable Helpers ───────────────────────────

    /// Build the OPKSSH_PROVIDERS env var string from the current config.
    pub fn build_env_providers_string(&self) -> Option<String> {
        self.client_config.as_ref().map(|c| {
            providers::build_env_providers_string(&c.providers)
        })
    }
}

impl Default for OpksshService {
    fn default() -> Self {
        Self::new()
    }
}
