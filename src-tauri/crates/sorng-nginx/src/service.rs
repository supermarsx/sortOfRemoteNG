// ── sorng-nginx/src/service.rs ───────────────────────────────────────────────
//! Aggregate Nginx façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::NginxClient;
use crate::error::{NginxError, NginxResult};
use crate::types::*;

use crate::sites::SiteManager;
use crate::upstreams::UpstreamManager;
use crate::ssl::SslManager;
use crate::status::StatusManager;
use crate::logs::LogManager;
use crate::config::ConfigManager;
use crate::process::ProcessManager;

/// Shared Tauri state handle.
pub type NginxServiceState = Arc<Mutex<NginxService>>;

/// Main Nginx service managing connections.
pub struct NginxService {
    connections: HashMap<String, NginxClient>,
}

impl NginxService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: NginxConnectionConfig) -> NginxResult<NginxConnectionSummary> {
        let client = NginxClient::new(config)?;
        let ver = client.version().await.ok();
        let summary = NginxConnectionSummary {
            host: client.config.host.clone(),
            version: ver,
            config_path: client.config_path().to_string(),
            worker_processes: None,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> NginxResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| NginxError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> NginxResult<&NginxClient> {
        self.connections.get(id)
            .ok_or_else(|| NginxError::not_connected(format!("No connection '{}'", id)))
    }

    // ── Sites ────────────────────────────────────────────────────

    pub async fn list_sites(&self, id: &str) -> NginxResult<Vec<NginxSite>> {
        SiteManager::list(self.client(id)?).await
    }

    pub async fn get_site(&self, id: &str, name: &str) -> NginxResult<NginxSite> {
        SiteManager::get(self.client(id)?, name).await
    }

    pub async fn create_site(&self, id: &str, req: CreateSiteRequest) -> NginxResult<NginxSite> {
        SiteManager::create(self.client(id)?, &req).await
    }

    pub async fn update_site(&self, id: &str, name: &str, req: UpdateSiteRequest) -> NginxResult<NginxSite> {
        SiteManager::update(self.client(id)?, name, &req).await
    }

    pub async fn delete_site(&self, id: &str, name: &str) -> NginxResult<()> {
        SiteManager::delete(self.client(id)?, name).await
    }

    pub async fn enable_site(&self, id: &str, name: &str) -> NginxResult<()> {
        SiteManager::enable(self.client(id)?, name).await
    }

    pub async fn disable_site(&self, id: &str, name: &str) -> NginxResult<()> {
        SiteManager::disable(self.client(id)?, name).await
    }

    // ── Upstreams ────────────────────────────────────────────────

    pub async fn list_upstreams(&self, id: &str) -> NginxResult<Vec<NginxUpstream>> {
        UpstreamManager::list(self.client(id)?).await
    }

    pub async fn get_upstream(&self, id: &str, name: &str) -> NginxResult<NginxUpstream> {
        UpstreamManager::get(self.client(id)?, name).await
    }

    pub async fn create_upstream(&self, id: &str, req: CreateUpstreamRequest) -> NginxResult<NginxUpstream> {
        UpstreamManager::create(self.client(id)?, &req).await
    }

    pub async fn update_upstream(&self, id: &str, name: &str, req: CreateUpstreamRequest) -> NginxResult<NginxUpstream> {
        UpstreamManager::update(self.client(id)?, name, &req).await
    }

    pub async fn delete_upstream(&self, id: &str, name: &str) -> NginxResult<()> {
        UpstreamManager::delete(self.client(id)?, name).await
    }

    // ── SSL ──────────────────────────────────────────────────────

    pub async fn get_ssl_config(&self, id: &str, site_name: &str) -> NginxResult<Option<SslConfig>> {
        SslManager::get_config(self.client(id)?, site_name).await
    }

    pub async fn update_ssl_config(&self, id: &str, site_name: &str, ssl: SslConfig) -> NginxResult<()> {
        SslManager::update_config(self.client(id)?, site_name, &ssl).await
    }

    pub async fn list_ssl_certificates(&self, id: &str, cert_dir: &str) -> NginxResult<Vec<String>> {
        SslManager::list_certificates(self.client(id)?, cert_dir).await
    }

    // ── Status ───────────────────────────────────────────────────

    pub async fn stub_status(&self, id: &str) -> NginxResult<NginxStubStatus> {
        StatusManager::stub_status(self.client(id)?).await
    }

    pub async fn process_status(&self, id: &str) -> NginxResult<NginxProcess> {
        StatusManager::process_status(self.client(id)?).await
    }

    pub async fn health_check(&self, id: &str) -> NginxResult<NginxHealthCheck> {
        StatusManager::health_check(self.client(id)?).await
    }

    // ── Logs ─────────────────────────────────────────────────────

    pub async fn query_access_log(&self, id: &str, query: LogQuery) -> NginxResult<Vec<AccessLogEntry>> {
        LogManager::query_access_log(self.client(id)?, &query).await
    }

    pub async fn query_error_log(&self, id: &str, query: LogQuery) -> NginxResult<Vec<ErrorLogEntry>> {
        LogManager::query_error_log(self.client(id)?, &query).await
    }

    pub async fn list_log_files(&self, id: &str, log_dir: Option<String>) -> NginxResult<Vec<String>> {
        LogManager::list_log_files(self.client(id)?, log_dir.as_deref()).await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_main_config(&self, id: &str) -> NginxResult<NginxMainConfig> {
        ConfigManager::get_main_config(self.client(id)?).await
    }

    pub async fn update_main_config(&self, id: &str, content: String) -> NginxResult<()> {
        ConfigManager::update_main_config(self.client(id)?, &content).await
    }

    pub async fn test_config(&self, id: &str) -> NginxResult<ConfigTestResult> {
        ConfigManager::test(self.client(id)?).await
    }

    pub async fn list_snippets(&self, id: &str) -> NginxResult<Vec<NginxSnippet>> {
        ConfigManager::list_snippets(self.client(id)?).await
    }

    pub async fn get_snippet(&self, id: &str, name: &str) -> NginxResult<NginxSnippet> {
        ConfigManager::get_snippet(self.client(id)?, name).await
    }

    pub async fn create_snippet(&self, id: &str, req: CreateSnippetRequest) -> NginxResult<NginxSnippet> {
        ConfigManager::create_snippet(self.client(id)?, &req).await
    }

    pub async fn update_snippet(&self, id: &str, name: &str, content: String) -> NginxResult<NginxSnippet> {
        ConfigManager::update_snippet(self.client(id)?, name, &content).await
    }

    pub async fn delete_snippet(&self, id: &str, name: &str) -> NginxResult<()> {
        ConfigManager::delete_snippet(self.client(id)?, name).await
    }

    // ── Process ──────────────────────────────────────────────────

    pub async fn start(&self, id: &str) -> NginxResult<()> {
        ProcessManager::start(self.client(id)?).await
    }

    pub async fn stop(&self, id: &str) -> NginxResult<()> {
        ProcessManager::stop(self.client(id)?).await
    }

    pub async fn restart(&self, id: &str) -> NginxResult<()> {
        ProcessManager::restart(self.client(id)?).await
    }

    pub async fn reload(&self, id: &str) -> NginxResult<()> {
        ProcessManager::reload(self.client(id)?).await
    }

    pub async fn version(&self, id: &str) -> NginxResult<String> {
        ProcessManager::version(self.client(id)?).await
    }

    pub async fn info(&self, id: &str) -> NginxResult<NginxInfo> {
        ProcessManager::info(self.client(id)?).await
    }
}
