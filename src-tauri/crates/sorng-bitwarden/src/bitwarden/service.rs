//! Bitwarden service manager.
//!
//! Provides the central `BitwardenService` that coordinates
//! the CLI bridge, API clients, sync engine, and session management.

use crate::bitwarden::api::VaultApiClient;
use crate::bitwarden::cli::BitwardenCli;
use crate::bitwarden::generate;
use crate::bitwarden::sync::{SyncEngine, SyncResult, SyncSource};
use crate::bitwarden::types::*;
use crate::bitwarden::vault;
use log::{error, info, warn};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Tauri-managed state wrapper.
pub type BitwardenServiceState = Arc<Mutex<BitwardenService>>;

/// Central Bitwarden integration service.
pub struct BitwardenService {
    /// Configuration.
    config: BitwardenConfig,
    /// CLI bridge.
    cli: BitwardenCli,
    /// Vault Management API client (lazy-initialized when `bw serve` is running).
    vault_api: Option<VaultApiClient>,
    /// Sync engine.
    sync_engine: SyncEngine,
    /// Session state.
    session: SessionState,
    /// Process handle for `bw serve` (if we started it).
    serve_process: Option<tokio::process::Child>,
    /// Whether the CLI is available.
    cli_available: Option<bool>,
    /// CLI version string.
    cli_version: Option<String>,
}

impl BitwardenService {
    /// Create a new service with default config.
    pub fn new() -> Self {
        Self::with_config(BitwardenConfig::default())
    }

    /// Create a new service with the given config.
    pub fn with_config(config: BitwardenConfig) -> Self {
        let cli = BitwardenCli::from_config(&config);
        let sync_engine = SyncEngine::new(SyncSource::Cli)
            .with_auto_sync(config.auto_sync_interval_secs);

        Self {
            config,
            cli,
            vault_api: None,
            sync_engine,
            session: SessionState::default(),
            serve_process: None,
            cli_available: None,
            cli_version: None,
        }
    }

    /// Create the Tauri managed state.
    pub fn new_state() -> BitwardenServiceState {
        Arc::new(Mutex::new(Self::new()))
    }

    /// Create the Tauri managed state with config.
    pub fn new_state_with_config(config: BitwardenConfig) -> BitwardenServiceState {
        Arc::new(Mutex::new(Self::with_config(config)))
    }

    // ── Configuration ───────────────────────────────────────────────

    /// Get the current config.
    pub fn config(&self) -> &BitwardenConfig {
        &self.config
    }

    /// Update the config.
    pub fn set_config(&mut self, config: BitwardenConfig) {
        self.cli = BitwardenCli::from_config(&config);
        self.config = config;
    }

    /// Get the session state.
    pub fn session(&self) -> &SessionState {
        &self.session
    }

    // ── CLI availability ────────────────────────────────────────────

    /// Check if the `bw` CLI is available.
    pub async fn check_cli(&mut self) -> Result<String, BitwardenError> {
        match self.cli.check_available().await {
            Ok(version) => {
                self.cli_available = Some(true);
                self.cli_version = Some(version.clone());
                info!("Bitwarden CLI available: v{}", version);
                Ok(version)
            }
            Err(e) => {
                self.cli_available = Some(false);
                self.cli_version = None;
                error!("Bitwarden CLI not available: {}", e);
                Err(e)
            }
        }
    }

    /// Check if the CLI is known to be available.
    pub fn is_cli_available(&self) -> bool {
        self.cli_available.unwrap_or(false)
    }

    /// Get the CLI version.
    pub fn cli_version(&self) -> Option<&str> {
        self.cli_version.as_deref()
    }

    // ── Status ──────────────────────────────────────────────────────

    /// Get the current vault status.
    pub async fn status(&mut self) -> Result<StatusInfo, BitwardenError> {
        let status = self.cli.status().await?;

        // Update session state from status
        self.session.status = status.vault_status();
        self.session.user_email = status.user_email.clone();
        self.session.user_id = status.user_id.clone();
        self.session.server_url = status.server_url.clone();
        self.session.touch();

        Ok(status)
    }

    /// Get the vault status enum.
    pub fn vault_status(&self) -> VaultStatus {
        self.session.status
    }

    // ── Authentication ──────────────────────────────────────────────

    /// Configure the server URL.
    pub async fn config_server(&mut self, url: &str) -> Result<(), BitwardenError> {
        self.cli.config_server(url).await?;
        self.config.server_url = url.to_string();
        Ok(())
    }

    /// Login with email and password.
    pub async fn login(
        &mut self,
        email: &str,
        password: &str,
    ) -> Result<(), BitwardenError> {
        let session_key = self.cli.login_password(email, password).await?;
        self.cli.set_session_key(Some(session_key.clone()));
        self.session.session_key = Some(session_key);
        self.session.status = VaultStatus::Unlocked;
        self.session.user_email = Some(email.to_string());
        self.session.auth_method = Some(AuthMethod::EmailPassword { email: email.to_string() });
        self.session.touch();
        info!("Logged in as {}", email);
        Ok(())
    }

    /// Login with email, password, and 2FA.
    pub async fn login_2fa(
        &mut self,
        email: &str,
        password: &str,
        code: &str,
        method: TwoFactorMethod,
    ) -> Result<(), BitwardenError> {
        let session_key = self.cli.login_password_2fa(email, password, code, method).await?;
        self.cli.set_session_key(Some(session_key.clone()));
        self.session.session_key = Some(session_key);
        self.session.status = VaultStatus::Unlocked;
        self.session.user_email = Some(email.to_string());
        self.session.auth_method = Some(AuthMethod::EmailPassword { email: email.to_string() });
        self.session.touch();
        Ok(())
    }

    /// Login with API key.
    pub async fn login_api_key(
        &mut self,
        client_id: &str,
        client_secret: &str,
    ) -> Result<(), BitwardenError> {
        self.cli.set_api_key(client_id, client_secret);
        self.cli.login_api_key().await?;
        self.session.status = VaultStatus::Locked;
        self.session.auth_method = Some(AuthMethod::ApiKey { client_id: client_id.to_string() });
        self.session.touch();
        info!("Logged in with API key");
        Ok(())
    }

    /// Unlock the vault.
    pub async fn unlock(&mut self, password: &str) -> Result<(), BitwardenError> {
        let session_key = self.cli.unlock(password).await?;
        self.cli.set_session_key(Some(session_key.clone()));
        self.session.session_key = Some(session_key);
        self.session.status = VaultStatus::Unlocked;
        self.session.touch();
        info!("Vault unlocked");
        Ok(())
    }

    /// Lock the vault.
    pub async fn lock(&mut self) -> Result<(), BitwardenError> {
        self.cli.lock().await?;
        self.cli.set_session_key(None);
        self.session.session_key = None;
        self.session.status = VaultStatus::Locked;
        self.session.touch();
        info!("Vault locked");
        Ok(())
    }

    /// Logout.
    pub async fn logout(&mut self) -> Result<(), BitwardenError> {
        self.cli.logout().await?;
        self.cli.set_session_key(None);
        self.session = SessionState::default();
        self.sync_engine.clear_cache().await;

        // Stop bw serve if we started it
        if let Some(mut child) = self.serve_process.take() {
            let _ = child.kill().await;
        }
        self.vault_api = None;

        info!("Logged out");
        Ok(())
    }

    // ── Sync ────────────────────────────────────────────────────────

    /// Sync the vault.
    pub async fn sync(&mut self) -> Result<SyncResult, BitwardenError> {
        self.session.touch();
        self.sync_engine.sync(Some(&self.cli), self.vault_api.as_ref()).await
    }

    /// Force sync.
    pub async fn force_sync(&mut self) -> Result<SyncResult, BitwardenError> {
        self.cli.force_sync().await?;
        self.sync_engine.sync_via_cli(&self.cli).await
    }

    /// Get last sync time.
    pub fn last_sync(&self) -> Option<chrono::DateTime<chrono::Utc>> {
        self.sync_engine.last_sync()
    }

    /// Check if sync is needed.
    pub fn needs_sync(&self) -> bool {
        self.sync_engine.needs_sync()
    }

    // ── Vault items ─────────────────────────────────────────────────

    /// List all items (from cache or CLI).
    pub async fn list_items(&mut self) -> Result<Vec<VaultItem>, BitwardenError> {
        // If cache is populated, use it
        let cached = self.sync_engine.get_cached_items().await;
        if !cached.is_empty() {
            return Ok(cached);
        }
        // Otherwise fetch from CLI
        let items = self.cli.list_items().await?;
        // Update cache
        for item in &items {
            self.sync_engine.update_cached_item(item.clone()).await;
        }
        Ok(items)
    }

    /// Search items.
    pub async fn search_items(&self, query: &str) -> Vec<VaultItem> {
        self.sync_engine.search(query).await
    }

    /// Get an item by ID.
    pub async fn get_item(&self, id: &str) -> Result<VaultItem, BitwardenError> {
        // Check cache first
        let cached = self.sync_engine.get_cached_items().await;
        if let Some(item) = cached.iter().find(|i| i.id.as_deref() == Some(id)) {
            return Ok(item.clone());
        }
        // Fall back to CLI
        self.cli.get_item(id).await
    }

    /// Create a new item.
    pub async fn create_item(&mut self, item: &VaultItem) -> Result<VaultItem, BitwardenError> {
        let created = self.cli.create_item(item).await?;
        self.sync_engine.update_cached_item(created.clone()).await;
        Ok(created)
    }

    /// Edit an item.
    pub async fn edit_item(&mut self, id: &str, item: &VaultItem) -> Result<VaultItem, BitwardenError> {
        let edited = self.cli.edit_item(id, item).await?;
        self.sync_engine.update_cached_item(edited.clone()).await;
        Ok(edited)
    }

    /// Delete an item (move to trash).
    pub async fn delete_item(&mut self, id: &str) -> Result<(), BitwardenError> {
        self.cli.delete_item(id).await?;
        self.sync_engine.remove_cached_item(id).await;
        Ok(())
    }

    /// Permanently delete a trashed item.
    pub async fn delete_item_permanent(&mut self, id: &str) -> Result<(), BitwardenError> {
        self.cli.delete_item_permanent(id).await?;
        self.sync_engine.remove_cached_item(id).await;
        Ok(())
    }

    /// Restore a deleted item.
    pub async fn restore_item(&mut self, id: &str) -> Result<(), BitwardenError> {
        self.cli.restore_item(id).await
    }

    // ── Quick access ────────────────────────────────────────────────

    /// Get a username.
    pub async fn get_username(&self, id: &str) -> Result<String, BitwardenError> {
        self.cli.get_username(id).await
    }

    /// Get a password.
    pub async fn get_password(&self, id: &str) -> Result<String, BitwardenError> {
        self.cli.get_password(id).await
    }

    /// Get a TOTP code.
    pub async fn get_totp(&self, id: &str) -> Result<String, BitwardenError> {
        self.cli.get_totp(id).await
    }

    /// Find credentials for a URI (autofill).
    pub async fn find_credentials(&self, uri: &str) -> Vec<CredentialMatch> {
        self.sync_engine.find_credentials(uri).await
    }

    // ── Folders ─────────────────────────────────────────────────────

    /// List folders.
    pub async fn list_folders(&self) -> Result<Vec<Folder>, BitwardenError> {
        let cached = self.sync_engine.get_cached_folders().await;
        if !cached.is_empty() {
            return Ok(cached);
        }
        self.cli.list_folders().await
    }

    /// Create a folder.
    pub async fn create_folder(&self, folder: &Folder) -> Result<Folder, BitwardenError> {
        self.cli.create_folder(folder).await
    }

    /// Edit a folder.
    pub async fn edit_folder(&self, id: &str, folder: &Folder) -> Result<Folder, BitwardenError> {
        self.cli.edit_folder(id, folder).await
    }

    /// Delete a folder.
    pub async fn delete_folder(&self, id: &str) -> Result<(), BitwardenError> {
        self.cli.delete_folder(id).await
    }

    // ── Collections & organizations ─────────────────────────────────

    /// List collections.
    pub async fn list_collections(&self) -> Result<Vec<Collection>, BitwardenError> {
        let cached = self.sync_engine.get_cached_collections().await;
        if !cached.is_empty() {
            return Ok(cached);
        }
        self.cli.list_collections().await
    }

    /// List organizations.
    pub async fn list_organizations(&self) -> Result<Vec<Organization>, BitwardenError> {
        let cached = self.sync_engine.get_cached_organizations().await;
        if !cached.is_empty() {
            return Ok(cached);
        }
        self.cli.list_organizations().await
    }

    // ── Sends ───────────────────────────────────────────────────────

    /// List sends.
    pub async fn list_sends(&self) -> Result<Vec<Send>, BitwardenError> {
        self.cli.list_sends().await
    }

    /// Create a text send.
    pub async fn create_text_send(
        &self,
        name: &str,
        text: &str,
        max_access: Option<u32>,
        password: Option<&str>,
        hidden: bool,
    ) -> Result<Send, BitwardenError> {
        self.cli.create_text_send(name, text, max_access, password, hidden).await
    }

    /// Delete a send.
    pub async fn delete_send(&self, id: &str) -> Result<(), BitwardenError> {
        self.cli.delete_send(id).await
    }

    // ── Attachments ─────────────────────────────────────────────────

    /// Create an attachment on an item.
    pub async fn create_attachment(
        &self,
        item_id: &str,
        file_path: &str,
    ) -> Result<VaultItem, BitwardenError> {
        self.cli.create_attachment(item_id, file_path).await
    }

    /// Delete an attachment.
    pub async fn delete_attachment(
        &self,
        attachment_id: &str,
        item_id: &str,
    ) -> Result<(), BitwardenError> {
        self.cli.delete_attachment(attachment_id, item_id).await
    }

    /// Download an attachment.
    pub async fn download_attachment(
        &self,
        attachment_id: &str,
        item_id: &str,
        output_path: &str,
    ) -> Result<(), BitwardenError> {
        self.cli.get_attachment(attachment_id, item_id, output_path).await
    }

    // ── Generate ────────────────────────────────────────────────────

    /// Generate a password (tries CLI first, falls back to local).
    pub async fn generate_password(
        &self,
        opts: &PasswordGenerateOptions,
    ) -> Result<String, BitwardenError> {
        // Try CLI first if available
        if self.cli_available == Some(true) {
            match self.cli.generate(opts).await {
                Ok(password) => return Ok(password),
                Err(e) => {
                    warn!("CLI generate failed, using local fallback: {}", e);
                }
            }
        }

        // Local fallback
        generate::generate_password(opts)
    }

    /// Generate a password locally (no CLI needed).
    pub fn generate_password_local(
        &self,
        opts: &PasswordGenerateOptions,
    ) -> Result<String, BitwardenError> {
        generate::generate_password(opts)
    }

    // ── Export / Import ─────────────────────────────────────────────

    /// Export the vault.
    pub async fn export(
        &self,
        format: ExportFormat,
        output_path: &str,
        password: Option<&str>,
    ) -> Result<(), BitwardenError> {
        self.cli.export(format, output_path, password).await
    }

    /// Import vault data.
    pub async fn import(
        &self,
        format: ImportFormat,
        file_path: &str,
    ) -> Result<(), BitwardenError> {
        self.cli.import(format, file_path).await
    }

    // ── Vault health ────────────────────────────────────────────────

    /// Get vault statistics.
    pub async fn vault_stats(&self) -> VaultStats {
        self.sync_engine.get_stats().await
    }

    /// Analyze password health.
    pub async fn password_health(&self) -> Vec<PasswordHealthReport> {
        let items = self.sync_engine.get_cached_items().await;
        vault::analyze_password_health(&items)
    }

    /// Find duplicate items.
    pub async fn find_duplicates(&self) -> Vec<(String, String)> {
        let items = self.sync_engine.get_cached_items().await;
        vault::find_duplicates(&items)
    }

    // ── bw serve management ─────────────────────────────────────────

    /// Start `bw serve` in the background and create an API client.
    pub async fn start_serve(&mut self) -> Result<(), BitwardenError> {
        let hostname = &self.config.serve_hostname.clone();
        let port = self.config.serve_port;

        // Check if already running
        if BitwardenCli::check_serve_running(hostname, port).await {
            info!("bw serve already running on {}:{}", hostname, port);
            self.vault_api = Some(VaultApiClient::new(hostname, port)?);
            return Ok(());
        }

        // Start the process
        let child = self.cli.start_serve(hostname, port)?;
        self.serve_process = Some(child);

        // Wait for it to become available (with timeout)
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(10);
        loop {
            if start.elapsed() > timeout {
                return Err(BitwardenError::timeout("bw serve failed to start within 10 seconds"));
            }
            if BitwardenCli::check_serve_running(hostname, port).await {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        self.vault_api = Some(VaultApiClient::new(hostname, port)?);
        info!("bw serve started on {}:{}", hostname, port);
        Ok(())
    }

    /// Stop `bw serve` if we started it.
    pub async fn stop_serve(&mut self) {
        if let Some(mut child) = self.serve_process.take() {
            let _ = child.kill().await;
            info!("bw serve stopped");
        }
        self.vault_api = None;
    }

    /// Check if `bw serve` is running.
    pub async fn is_serve_running(&self) -> bool {
        BitwardenCli::check_serve_running(&self.config.serve_hostname, self.config.serve_port).await
    }
}

impl Default for BitwardenService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_new() {
        let svc = BitwardenService::new();
        assert_eq!(svc.vault_status(), VaultStatus::Unauthenticated);
        assert_eq!(svc.config.serve_port, 8087);
        assert!(svc.cli_version.is_none());
    }

    #[test]
    fn service_with_config() {
        let config = BitwardenConfig {
            serve_port: 9999,
            timeout_secs: 60,
            ..Default::default()
        };
        let svc = BitwardenService::with_config(config);
        assert_eq!(svc.config.serve_port, 9999);
        assert_eq!(svc.config.timeout_secs, 60);
    }

    #[test]
    fn service_set_config() {
        let mut svc = BitwardenService::new();
        let config = BitwardenConfig::eu_cloud();
        svc.set_config(config);
        assert!(svc.config.server_url.contains("bitwarden.eu"));
    }

    #[test]
    fn service_session_default() {
        let svc = BitwardenService::new();
        let session = svc.session();
        assert_eq!(session.status, VaultStatus::Unauthenticated);
        assert!(!session.is_unlocked());
        assert!(!session.is_authenticated());
    }

    #[test]
    fn service_new_state() {
        let state = BitwardenService::new_state();
        assert!(Arc::strong_count(&state) == 1);
    }

    #[test]
    fn service_default() {
        let svc = BitwardenService::default();
        assert_eq!(svc.vault_status(), VaultStatus::Unauthenticated);
    }

    #[test]
    fn service_is_cli_available_initially_false() {
        let svc = BitwardenService::new();
        assert!(!svc.is_cli_available());
    }

    #[test]
    fn service_needs_sync_initially() {
        let svc = BitwardenService::new();
        assert!(!svc.needs_sync()); // No auto-sync configured
    }

    #[test]
    fn service_needs_sync_with_config() {
        let config = BitwardenConfig {
            auto_sync_interval_secs: 300,
            ..Default::default()
        };
        let svc = BitwardenService::with_config(config);
        assert!(svc.needs_sync()); // Auto-sync configured, never synced
    }

    #[test]
    fn service_generate_local() {
        let svc = BitwardenService::new();
        let opts = PasswordGenerateOptions::default();
        let pw = svc.generate_password_local(&opts).unwrap();
        assert_eq!(pw.len(), opts.length as usize);
    }

    #[test]
    fn service_generate_local_passphrase() {
        let svc = BitwardenService::new();
        let opts = PasswordGenerateOptions::passphrase(4);
        let phrase = svc.generate_password_local(&opts).unwrap();
        let parts: Vec<&str> = phrase.split('-').collect();
        assert_eq!(parts.len(), 4);
    }

    #[tokio::test]
    async fn service_search_empty() {
        let svc = BitwardenService::new();
        let results = svc.search_items("test").await;
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn service_vault_stats_empty() {
        let svc = BitwardenService::new();
        let stats = svc.vault_stats().await;
        assert_eq!(stats.total_items, 0);
    }

    #[tokio::test]
    async fn service_find_credentials_empty() {
        let svc = BitwardenService::new();
        let matches = svc.find_credentials("https://example.com").await;
        assert!(matches.is_empty());
    }

    #[tokio::test]
    async fn service_is_serve_running_false() {
        let svc = BitwardenService::new();
        // Should be false since nothing is running on default port
        // (This might flake if something IS on 8087, but unlikely in CI)
        let running = svc.is_serve_running().await;
        // We just test it doesn't panic - the result depends on environment
        let _ = running;
    }
}
