// ── sorng-caddy/src/service.rs ───────────────────────────────────────────────
//! Aggregate Caddy façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::CaddyClient;
use crate::error::{CaddyError, CaddyResult};
use crate::types::*;

use crate::config::CaddyConfigManager;
use crate::servers::ServerManager;
use crate::routes::RouteManager;
use crate::tls::CaddyTlsManager;
use crate::reverse_proxy::ReverseProxyManager;

/// Shared Tauri state handle.
pub type CaddyServiceState = Arc<Mutex<CaddyService>>;

/// Main Caddy service managing connections.
pub struct CaddyService {
    connections: HashMap<String, CaddyClient>,
}

impl CaddyService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: CaddyConnectionConfig) -> CaddyResult<CaddyConnectionSummary> {
        let client = CaddyClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> CaddyResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| CaddyError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> CaddyResult<&CaddyClient> {
        self.connections.get(id)
            .ok_or_else(|| CaddyError::not_connected(format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> CaddyResult<CaddyConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_full_config(&self, id: &str) -> CaddyResult<CaddyConfig> {
        CaddyConfigManager::get_full(self.client(id)?).await
    }

    pub async fn get_raw_config(&self, id: &str) -> CaddyResult<serde_json::Value> {
        CaddyConfigManager::get_raw(self.client(id)?).await
    }

    pub async fn get_config_path(&self, id: &str, path: &str) -> CaddyResult<serde_json::Value> {
        CaddyConfigManager::get_path(self.client(id)?, path).await
    }

    pub async fn set_config_path(&self, id: &str, path: &str, value: serde_json::Value) -> CaddyResult<()> {
        CaddyConfigManager::set_path(self.client(id)?, path, &value).await
    }

    pub async fn patch_config_path(&self, id: &str, path: &str, value: serde_json::Value) -> CaddyResult<()> {
        CaddyConfigManager::patch_path(self.client(id)?, path, &value).await
    }

    pub async fn delete_config_path(&self, id: &str, path: &str) -> CaddyResult<()> {
        CaddyConfigManager::delete_path(self.client(id)?, path).await
    }

    pub async fn load_config(&self, id: &str, config: serde_json::Value) -> CaddyResult<()> {
        CaddyConfigManager::load(self.client(id)?, &config).await
    }

    pub async fn adapt_caddyfile(&self, id: &str, caddyfile: String) -> CaddyResult<CaddyfileAdaptResult> {
        CaddyConfigManager::adapt_caddyfile(self.client(id)?, &caddyfile).await
    }

    pub async fn stop_server(&self, id: &str) -> CaddyResult<()> {
        CaddyConfigManager::stop_server(self.client(id)?).await
    }

    // ── Servers ──────────────────────────────────────────────────

    pub async fn list_servers(&self, id: &str) -> CaddyResult<HashMap<String, CaddyServer>> {
        ServerManager::list(self.client(id)?).await
    }

    pub async fn get_server(&self, id: &str, name: &str) -> CaddyResult<CaddyServer> {
        ServerManager::get(self.client(id)?, name).await
    }

    pub async fn set_server(&self, id: &str, name: &str, server: CaddyServer) -> CaddyResult<()> {
        ServerManager::set(self.client(id)?, name, &server).await
    }

    pub async fn delete_server(&self, id: &str, name: &str) -> CaddyResult<()> {
        ServerManager::delete(self.client(id)?, name).await
    }

    // ── Routes ───────────────────────────────────────────────────

    pub async fn list_routes(&self, id: &str, server: &str) -> CaddyResult<Vec<CaddyRoute>> {
        RouteManager::list(self.client(id)?, server).await
    }

    pub async fn get_route(&self, id: &str, server: &str, index: usize) -> CaddyResult<CaddyRoute> {
        RouteManager::get(self.client(id)?, server, index).await
    }

    pub async fn add_route(&self, id: &str, server: &str, route: CaddyRoute) -> CaddyResult<()> {
        RouteManager::add(self.client(id)?, server, &route).await
    }

    pub async fn set_route(&self, id: &str, server: &str, index: usize, route: CaddyRoute) -> CaddyResult<()> {
        RouteManager::set(self.client(id)?, server, index, &route).await
    }

    pub async fn delete_route(&self, id: &str, server: &str, index: usize) -> CaddyResult<()> {
        RouteManager::delete(self.client(id)?, server, index).await
    }

    pub async fn set_all_routes(&self, id: &str, server: &str, routes: Vec<CaddyRoute>) -> CaddyResult<()> {
        RouteManager::set_all(self.client(id)?, server, &routes).await
    }

    // ── TLS ──────────────────────────────────────────────────────

    pub async fn get_tls_app(&self, id: &str) -> CaddyResult<TlsApp> {
        CaddyTlsManager::get_app(self.client(id)?).await
    }

    pub async fn set_tls_app(&self, id: &str, tls: TlsApp) -> CaddyResult<()> {
        CaddyTlsManager::set_app(self.client(id)?, &tls).await
    }

    pub async fn list_automate_domains(&self, id: &str) -> CaddyResult<Vec<String>> {
        CaddyTlsManager::list_automate_domains(self.client(id)?).await
    }

    pub async fn set_automate_domains(&self, id: &str, domains: Vec<String>) -> CaddyResult<()> {
        CaddyTlsManager::set_automate_domains(self.client(id)?, &domains).await
    }

    pub async fn get_tls_automation(&self, id: &str) -> CaddyResult<TlsAutomation> {
        CaddyTlsManager::get_automation(self.client(id)?).await
    }

    pub async fn set_tls_automation(&self, id: &str, automation: TlsAutomation) -> CaddyResult<()> {
        CaddyTlsManager::set_automation(self.client(id)?, &automation).await
    }

    pub async fn list_tls_certificates(&self, id: &str) -> CaddyResult<Vec<CaddyCertificate>> {
        CaddyTlsManager::list_certificates(self.client(id)?).await
    }

    // ── Reverse Proxy helpers ────────────────────────────────────

    pub async fn create_reverse_proxy(&self, id: &str, server: &str, req: CreateReverseProxyRequest) -> CaddyResult<()> {
        ReverseProxyManager::create(self.client(id)?, server, &req).await
    }

    pub async fn get_upstreams(&self, id: &str) -> CaddyResult<Vec<serde_json::Value>> {
        ReverseProxyManager::get_upstreams(self.client(id)?).await
    }

    pub async fn create_file_server(&self, id: &str, server: &str, req: CreateFileServerRequest) -> CaddyResult<()> {
        ReverseProxyManager::create_file_server(self.client(id)?, server, &req).await
    }

    pub async fn create_redirect(&self, id: &str, server: &str, req: CreateRedirectRequest) -> CaddyResult<()> {
        ReverseProxyManager::create_redirect(self.client(id)?, server, &req).await
    }
}
