// ── sorng-draytek/src/service.rs ────────────────────────────────────────────
//! Aggregate DrayTek service – holds live sessions keyed by connection id.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::DraytekClient;
use crate::error::{DraytekError, DraytekResult};
use crate::types::*;

/// Shared Tauri state handle.
pub type DraytekServiceState = Arc<Mutex<DraytekServiceWrapper>>;

/// Main DrayTek service managing connections.
pub struct DraytekServiceWrapper {
    connections: HashMap<String, DraytekClient>,
}

impl Default for DraytekServiceWrapper {
    fn default() -> Self {
        Self::new()
    }
}

impl DraytekServiceWrapper {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ─────────────────────────────────────

    /// Build a client, log in, probe status and register it under `id`.
    pub async fn connect(
        &mut self,
        id: String,
        config: DraytekConnectionConfig,
    ) -> DraytekResult<DraytekConnectionSummary> {
        if self.connections.contains_key(&id) {
            return Err(DraytekError::connection(format!(
                "Connection id '{id}' already exists; disconnect it before reconnecting"
            )));
        }
        let client = DraytekClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> DraytekResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| DraytekError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> DraytekResult<&DraytekClient> {
        self.connections
            .get(id)
            .ok_or_else(|| DraytekError::not_connected(format!("No connection '{id}'")))
    }

    pub async fn ping(&self, id: &str) -> DraytekResult<DraytekConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Status / actions ─────────────────────────────────────────

    pub async fn get_status(&self, id: &str) -> DraytekResult<DraytekStatus> {
        crate::status::fetch_status(self.client(id)?).await
    }

    /// Reboot; the caller (panel) must have confirmed with the user.
    pub async fn reboot(&self, id: &str) -> DraytekResult<DraytekRebootResult> {
        crate::actions::reboot(self.client(id)?).await
    }

    /// Web UI URL for "Open Web UI".
    pub fn web_ui_url(&self, id: &str) -> DraytekResult<String> {
        Ok(self.client(id)?.base_url())
    }
}
