// ── sorng-apache/src/service.rs ──────────────────────────────────────────────
//! Aggregate Apache façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::ApacheClient;
use crate::error::{ApacheError, ApacheResult};
use crate::types::*;

use crate::config::ApacheConfigManager;
use crate::logs::ApacheLogManager;
use crate::modules::ModuleManager;
use crate::process::ApacheProcessManager;
use crate::ssl::ApacheSslManager;
use crate::status::ApacheStatusManager;
use crate::vhosts::VhostManager;

/// Shared Tauri state handle.
pub type ApacheServiceState = Arc<Mutex<ApacheService>>;

/// Main Apache service managing connections.
pub struct ApacheService {
    connections: HashMap<String, ApacheClient>,
}

impl Default for ApacheService {
    fn default() -> Self {
        Self::new()
    }
}

impl ApacheService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: ApacheConnectionConfig,
    ) -> ApacheResult<ApacheConnectionSummary> {
        let client = ApacheClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> ApacheResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| ApacheError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> ApacheResult<&ApacheClient> {
        self.connections
            .get(id)
            .ok_or_else(|| ApacheError::not_connected(format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> ApacheResult<ApacheConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Virtual Hosts ────────────────────────────────────────────

    pub async fn list_vhosts(&self, id: &str) -> ApacheResult<Vec<ApacheVhost>> {
        VhostManager::list(self.client(id)?).await
    }

    pub async fn get_vhost(&self, id: &str, name: &str) -> ApacheResult<ApacheVhost> {
        VhostManager::get(self.client(id)?, name).await
    }

    pub async fn create_vhost(
        &self,
        id: &str,
        req: CreateVhostRequest,
    ) -> ApacheResult<ApacheVhost> {
        VhostManager::create(self.client(id)?, &req).await
    }

    pub async fn update_vhost(
        &self,
        id: &str,
        name: &str,
        req: UpdateVhostRequest,
    ) -> ApacheResult<ApacheVhost> {
        VhostManager::update(self.client(id)?, name, &req).await
    }

    pub async fn delete_vhost(&self, id: &str, name: &str) -> ApacheResult<()> {
        VhostManager::delete(self.client(id)?, name).await
    }

    pub async fn enable_vhost(&self, id: &str, name: &str) -> ApacheResult<()> {
        VhostManager::enable(self.client(id)?, name).await
    }

    pub async fn disable_vhost(&self, id: &str, name: &str) -> ApacheResult<()> {
        VhostManager::disable(self.client(id)?, name).await
    }

    // ── Modules ──────────────────────────────────────────────────

    pub async fn list_modules(&self, id: &str) -> ApacheResult<Vec<ApacheModule>> {
        ModuleManager::list(self.client(id)?).await
    }

    pub async fn list_available_modules(&self, id: &str) -> ApacheResult<Vec<String>> {
        ModuleManager::list_available(self.client(id)?).await
    }

    pub async fn list_enabled_modules(&self, id: &str) -> ApacheResult<Vec<String>> {
        ModuleManager::list_enabled(self.client(id)?).await
    }

    pub async fn enable_module(&self, id: &str, name: &str) -> ApacheResult<()> {
        ModuleManager::enable(self.client(id)?, name).await
    }

    pub async fn disable_module(&self, id: &str, name: &str) -> ApacheResult<()> {
        ModuleManager::disable(self.client(id)?, name).await
    }

    // ── SSL ──────────────────────────────────────────────────────

    pub async fn get_ssl_config(
        &self,
        id: &str,
        vhost_name: &str,
    ) -> ApacheResult<Option<ApacheSslConfig>> {
        ApacheSslManager::get_config(self.client(id)?, vhost_name).await
    }

    pub async fn list_ssl_certificates(
        &self,
        id: &str,
        cert_dir: &str,
    ) -> ApacheResult<Vec<String>> {
        ApacheSslManager::list_certificates(self.client(id)?, cert_dir).await
    }

    // ── Status ───────────────────────────────────────────────────

    pub async fn get_status(&self, id: &str) -> ApacheResult<ApacheServerStatus> {
        ApacheStatusManager::get_status(self.client(id)?).await
    }

    pub async fn process_status(&self, id: &str) -> ApacheResult<ApacheProcess> {
        ApacheStatusManager::process_status(self.client(id)?).await
    }

    // ── Logs ─────────────────────────────────────────────────────

    pub async fn query_access_log(
        &self,
        id: &str,
        query: LogQuery,
    ) -> ApacheResult<Vec<ApacheAccessLogEntry>> {
        ApacheLogManager::query_access_log(self.client(id)?, &query).await
    }

    pub async fn query_error_log(
        &self,
        id: &str,
        query: LogQuery,
    ) -> ApacheResult<Vec<ApacheErrorLogEntry>> {
        ApacheLogManager::query_error_log(self.client(id)?, &query).await
    }

    pub async fn list_log_files(
        &self,
        id: &str,
        log_dir: Option<String>,
    ) -> ApacheResult<Vec<String>> {
        ApacheLogManager::list_log_files(self.client(id)?, log_dir.as_deref()).await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_main_config(&self, id: &str) -> ApacheResult<ApacheMainConfig> {
        ApacheConfigManager::get_main_config(self.client(id)?).await
    }

    pub async fn update_main_config(&self, id: &str, content: String) -> ApacheResult<()> {
        ApacheConfigManager::update_main_config(self.client(id)?, &content).await
    }

    pub async fn test_config(&self, id: &str) -> ApacheResult<ConfigTestResult> {
        ApacheConfigManager::test(self.client(id)?).await
    }

    pub async fn list_conf_available(&self, id: &str) -> ApacheResult<Vec<String>> {
        ApacheConfigManager::list_conf_available(self.client(id)?).await
    }

    pub async fn list_conf_enabled(&self, id: &str) -> ApacheResult<Vec<String>> {
        ApacheConfigManager::list_conf_enabled(self.client(id)?).await
    }

    pub async fn enable_conf(&self, id: &str, name: &str) -> ApacheResult<()> {
        ApacheConfigManager::enable_conf(self.client(id)?, name).await
    }

    pub async fn disable_conf(&self, id: &str, name: &str) -> ApacheResult<()> {
        ApacheConfigManager::disable_conf(self.client(id)?, name).await
    }

    // ── Process ──────────────────────────────────────────────────

    pub async fn start(&self, id: &str) -> ApacheResult<()> {
        ApacheProcessManager::start(self.client(id)?).await
    }

    pub async fn stop(&self, id: &str) -> ApacheResult<()> {
        ApacheProcessManager::stop(self.client(id)?).await
    }

    pub async fn restart(&self, id: &str) -> ApacheResult<()> {
        ApacheProcessManager::restart(self.client(id)?).await
    }

    pub async fn reload(&self, id: &str) -> ApacheResult<()> {
        ApacheProcessManager::reload(self.client(id)?).await
    }

    pub async fn version(&self, id: &str) -> ApacheResult<String> {
        ApacheProcessManager::version(self.client(id)?).await
    }

    pub async fn info(&self, id: &str) -> ApacheResult<ApacheInfo> {
        ApacheProcessManager::info(self.client(id)?).await
    }
}
