// ── sorng-portainer/src/service.rs ───────────────────────────────────────────
//! Aggregate Portainer façade – holds named connections and delegates to the
//! client. Owns the (optional) Trust Center store handle used for TOFU TLS.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::PortainerClient;
use crate::error::{PortainerError, PortainerResult};
use crate::types::*;
use sorng_tls_trust::BlockingTrustStore;

/// Shared Tauri state handle.
pub type PortainerServiceState = Arc<Mutex<PortainerService>>;

pub struct PortainerService {
    connections: HashMap<String, PortainerClient>,
    trust_store: Option<Arc<dyn BlockingTrustStore>>,
}

impl Default for PortainerService {
    fn default() -> Self {
        Self::new(None)
    }
}

impl PortainerService {
    /// `trust_store = None` → plain reqwest TLS (unit tests / no Trust Center).
    pub fn new(trust_store: Option<Arc<dyn BlockingTrustStore>>) -> Self {
        Self {
            connections: HashMap::new(),
            trust_store,
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: PortainerConnectionConfig,
    ) -> PortainerResult<PortainerConnectionSummary> {
        if self.connections.contains_key(&id) {
            return Err(PortainerError::already_connected(format!(
                "Connection '{id}' already exists"
            )));
        }
        let client = PortainerClient::new(config, self.trust_store.clone())?;
        client.login().await?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub async fn disconnect(&mut self, id: &str) -> PortainerResult<()> {
        match self.connections.remove(id) {
            Some(client) => {
                client.logout().await;
                Ok(())
            }
            None => Err(PortainerError::not_connected(format!(
                "No connection '{id}'"
            ))),
        }
    }

    pub fn list_connections(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.connections.keys().cloned().collect();
        ids.sort();
        ids
    }

    fn client(&self, id: &str) -> PortainerResult<&PortainerClient> {
        self.connections
            .get(id)
            .ok_or_else(|| PortainerError::not_connected(format!("No connection '{id}'")))
    }

    pub async fn ping(&self, id: &str) -> PortainerResult<PortainerConnectionSummary> {
        self.client(id)?.ping().await
    }

    /// Normalised base URL for the "Open web UI" action.
    pub fn web_ui_url(&self, id: &str) -> PortainerResult<String> {
        Ok(self.client(id)?.base_url().to_string())
    }

    // ── Environments ─────────────────────────────────────────────

    pub async fn list_endpoints(&self, id: &str) -> PortainerResult<Vec<PortainerEndpoint>> {
        self.client(id)?.list_endpoints().await
    }

    // ── Containers ───────────────────────────────────────────────

    pub async fn list_containers(
        &self,
        id: &str,
        endpoint_id: u64,
        all: bool,
    ) -> PortainerResult<Vec<PortainerContainer>> {
        self.client(id)?.list_containers(endpoint_id, all).await
    }

    pub async fn start_container(
        &self,
        id: &str,
        endpoint_id: u64,
        container_id: &str,
    ) -> PortainerResult<()> {
        self.client(id)?
            .start_container(endpoint_id, container_id)
            .await
    }

    pub async fn stop_container(
        &self,
        id: &str,
        endpoint_id: u64,
        container_id: &str,
    ) -> PortainerResult<()> {
        self.client(id)?
            .stop_container(endpoint_id, container_id)
            .await
    }

    pub async fn restart_container(
        &self,
        id: &str,
        endpoint_id: u64,
        container_id: &str,
    ) -> PortainerResult<()> {
        self.client(id)?
            .restart_container(endpoint_id, container_id)
            .await
    }

    pub async fn container_logs(
        &self,
        id: &str,
        endpoint_id: u64,
        container_id: &str,
        tail: u32,
    ) -> PortainerResult<Vec<PortainerLogLine>> {
        self.client(id)?
            .container_logs(endpoint_id, container_id, tail)
            .await
    }

    // ── Stacks ───────────────────────────────────────────────────

    pub async fn list_stacks(&self, id: &str) -> PortainerResult<Vec<PortainerStack>> {
        self.client(id)?.list_stacks().await
    }

    pub async fn start_stack(
        &self,
        id: &str,
        stack_id: u64,
        endpoint_id: u64,
    ) -> PortainerResult<()> {
        self.client(id)?.start_stack(stack_id, endpoint_id).await
    }

    pub async fn stop_stack(
        &self,
        id: &str,
        stack_id: u64,
        endpoint_id: u64,
    ) -> PortainerResult<()> {
        self.client(id)?.stop_stack(stack_id, endpoint_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::PortainerErrorKind;

    #[tokio::test]
    async fn unknown_id_is_not_connected() {
        let svc = PortainerService::default();
        assert_eq!(
            svc.ping("nope").await.unwrap_err().kind,
            PortainerErrorKind::NotConnected
        );
        assert_eq!(
            svc.web_ui_url("nope").unwrap_err().kind,
            PortainerErrorKind::NotConnected
        );
        assert!(svc.list_connections().is_empty());
    }

    #[tokio::test]
    async fn connect_without_credentials_fails_before_any_request() {
        let mut svc = PortainerService::default();
        // Unroutable port on loopback: a request would fail with ConnectionFailed,
        // so a ConfigError proves nothing was sent.
        let cfg = PortainerConnectionConfig {
            base_url: "http://127.0.0.1:1".into(),
            username: None,
            password: None,
            api_key: None,
            skip_tls_verify: None,
            acknowledge_invalid_cert_risk: false,
            timeout_secs: Some(1),
            proxy_url: None,
        };
        assert_eq!(
            svc.connect("x".into(), cfg).await.unwrap_err().kind,
            PortainerErrorKind::ConfigError
        );
        assert!(svc.disconnect("x").await.is_err());
    }
}
