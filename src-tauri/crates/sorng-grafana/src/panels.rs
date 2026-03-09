// ── sorng-grafana/src/panels.rs ──────────────────────────────────────────────
//! Panel plugin queries via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct PanelManager;

impl PanelManager {
    /// List all panel plugins.  GET /api/plugins?type=panel
    pub async fn list_plugins(client: &GrafanaClient) -> GrafanaResult<Vec<PanelPlugin>> {
        client.api_get("plugins?type=panel").await
    }

    /// Get a single panel plugin.  GET /api/plugins/:id
    pub async fn get_plugin(client: &GrafanaClient, id: &str) -> GrafanaResult<PanelPlugin> {
        client.api_get(&format!("plugins/{id}")).await
    }
}
