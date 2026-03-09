// ── sorng-traefik/src/service.rs ─────────────────────────────────────────────
//! Aggregate Traefik façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::TraefikClient;
use crate::error::{TraefikError, TraefikResult};
use crate::types::{
    TraefikConnectionConfig, TraefikConnectionSummary, TraefikEntryPoint, TraefikMiddleware,
    TraefikOverview, TraefikRawConfig, TraefikRouter, TraefikService as TraefikSvcType,
    TraefikTcpMiddleware, TraefikTcpRouter, TraefikTcpService, TraefikTlsCertificate,
    TraefikUdpRouter, TraefikUdpService, TraefikVersion,
};

use crate::entrypoints::EntrypointManager;
use crate::middleware::MiddlewareManager;
use crate::overview::OverviewManager;
use crate::routers::RouterManager;
use crate::services::ServiceManager;
use crate::tls::TlsManager;

/// Shared Tauri state handle.
pub type TraefikServiceState = Arc<Mutex<TraefikService>>;

/// Main Traefik service managing connections.
pub struct TraefikService {
    connections: HashMap<String, TraefikClient>,
}

impl Default for TraefikService {
    fn default() -> Self {
        Self::new()
    }
}

impl TraefikService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: TraefikConnectionConfig,
    ) -> TraefikResult<TraefikConnectionSummary> {
        let client = TraefikClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> TraefikResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| TraefikError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> TraefikResult<&TraefikClient> {
        self.connections
            .get(id)
            .ok_or_else(|| TraefikError::not_connected(format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> TraefikResult<TraefikConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Routers ──────────────────────────────────────────────────

    pub async fn list_http_routers(&self, id: &str) -> TraefikResult<Vec<TraefikRouter>> {
        RouterManager::list_http(self.client(id)?).await
    }

    pub async fn get_http_router(&self, id: &str, name: &str) -> TraefikResult<TraefikRouter> {
        RouterManager::get_http(self.client(id)?, name).await
    }

    pub async fn list_tcp_routers(&self, id: &str) -> TraefikResult<Vec<TraefikTcpRouter>> {
        RouterManager::list_tcp(self.client(id)?).await
    }

    pub async fn get_tcp_router(&self, id: &str, name: &str) -> TraefikResult<TraefikTcpRouter> {
        RouterManager::get_tcp(self.client(id)?, name).await
    }

    pub async fn list_udp_routers(&self, id: &str) -> TraefikResult<Vec<TraefikUdpRouter>> {
        RouterManager::list_udp(self.client(id)?).await
    }

    pub async fn get_udp_router(&self, id: &str, name: &str) -> TraefikResult<TraefikUdpRouter> {
        RouterManager::get_udp(self.client(id)?, name).await
    }

    // ── Services ─────────────────────────────────────────────────

    pub async fn list_http_services(&self, id: &str) -> TraefikResult<Vec<TraefikSvcType>> {
        ServiceManager::list_http(self.client(id)?).await
    }

    pub async fn get_http_service(&self, id: &str, name: &str) -> TraefikResult<TraefikSvcType> {
        ServiceManager::get_http(self.client(id)?, name).await
    }

    pub async fn list_tcp_services(&self, id: &str) -> TraefikResult<Vec<TraefikTcpService>> {
        ServiceManager::list_tcp(self.client(id)?).await
    }

    pub async fn get_tcp_service(&self, id: &str, name: &str) -> TraefikResult<TraefikTcpService> {
        ServiceManager::get_tcp(self.client(id)?, name).await
    }

    pub async fn list_udp_services(&self, id: &str) -> TraefikResult<Vec<TraefikUdpService>> {
        ServiceManager::list_udp(self.client(id)?).await
    }

    pub async fn get_udp_service(&self, id: &str, name: &str) -> TraefikResult<TraefikUdpService> {
        ServiceManager::get_udp(self.client(id)?, name).await
    }

    // ── Middleware ────────────────────────────────────────────────

    pub async fn list_http_middlewares(&self, id: &str) -> TraefikResult<Vec<TraefikMiddleware>> {
        MiddlewareManager::list_http(self.client(id)?).await
    }

    pub async fn get_http_middleware(
        &self,
        id: &str,
        name: &str,
    ) -> TraefikResult<TraefikMiddleware> {
        MiddlewareManager::get_http(self.client(id)?, name).await
    }

    pub async fn list_tcp_middlewares(&self, id: &str) -> TraefikResult<Vec<TraefikTcpMiddleware>> {
        MiddlewareManager::list_tcp(self.client(id)?).await
    }

    pub async fn get_tcp_middleware(
        &self,
        id: &str,
        name: &str,
    ) -> TraefikResult<TraefikTcpMiddleware> {
        MiddlewareManager::get_tcp(self.client(id)?, name).await
    }

    // ── Entrypoints ──────────────────────────────────────────────

    pub async fn list_entrypoints(&self, id: &str) -> TraefikResult<Vec<TraefikEntryPoint>> {
        EntrypointManager::list(self.client(id)?).await
    }

    pub async fn get_entrypoint(&self, id: &str, name: &str) -> TraefikResult<TraefikEntryPoint> {
        EntrypointManager::get(self.client(id)?, name).await
    }

    // ── TLS ──────────────────────────────────────────────────────

    pub async fn list_tls_certificates(
        &self,
        id: &str,
    ) -> TraefikResult<Vec<TraefikTlsCertificate>> {
        TlsManager::list_certificates(self.client(id)?).await
    }

    pub async fn get_tls_certificate(
        &self,
        id: &str,
        name: &str,
    ) -> TraefikResult<TraefikTlsCertificate> {
        TlsManager::get_certificate(self.client(id)?, name).await
    }

    // ── Overview ─────────────────────────────────────────────────

    pub async fn get_overview(&self, id: &str) -> TraefikResult<TraefikOverview> {
        OverviewManager::get_overview(self.client(id)?).await
    }

    pub async fn get_version(&self, id: &str) -> TraefikResult<TraefikVersion> {
        OverviewManager::get_version(self.client(id)?).await
    }

    pub async fn get_raw_config(&self, id: &str) -> TraefikResult<TraefikRawConfig> {
        OverviewManager::get_raw_config(self.client(id)?).await
    }
}
