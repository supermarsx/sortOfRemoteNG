// ── Grafana plugin management ────────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct PluginManager;

impl PluginManager {
    pub async fn list_plugins(client: &GrafanaClient) -> GrafanaResult<Vec<GrafanaPlugin>> {
        let body = client.api_get("/api/plugins").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_plugins: {e}")))
    }

    pub async fn get_plugin(client: &GrafanaClient, plugin_id: &str) -> GrafanaResult<GrafanaPlugin> {
        let body = client.api_get(&format!("/api/plugins/{plugin_id}/settings")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_plugin: {e}")))
    }

    pub async fn install_plugin(client: &GrafanaClient, plugin_id: &str, req: &InstallPluginRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post(&format!("/api/plugins/{plugin_id}/install"), &payload).await?;
        Ok(())
    }

    pub async fn uninstall_plugin(client: &GrafanaClient, plugin_id: &str) -> GrafanaResult<()> {
        client.api_post(&format!("/api/plugins/{plugin_id}/uninstall"), "{}").await?;
        Ok(())
    }

    pub async fn update_plugin(client: &GrafanaClient, plugin_id: &str, req: &InstallPluginRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post(&format!("/api/plugins/{plugin_id}/install"), &payload).await?;
        Ok(())
    }

    pub async fn get_plugin_settings(client: &GrafanaClient, plugin_id: &str) -> GrafanaResult<PluginSettings> {
        let body = client.api_get(&format!("/api/plugins/{plugin_id}/settings")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_plugin_settings: {e}")))
    }

    pub async fn update_plugin_settings(client: &GrafanaClient, plugin_id: &str, req: &UpdatePluginSettingsRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post(&format!("/api/plugins/{plugin_id}/settings"), &payload).await?;
        Ok(())
    }

    pub async fn get_plugin_health(client: &GrafanaClient, plugin_id: &str) -> GrafanaResult<serde_json::Value> {
        let body = client.api_get(&format!("/api/plugins/{plugin_id}/health")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_plugin_health: {e}")))
    }

    pub async fn list_plugin_dashboards(client: &GrafanaClient, plugin_id: &str) -> GrafanaResult<Vec<DashboardSearchResult>> {
        let body = client.api_get(&format!("/api/plugins/{plugin_id}/dashboards")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_plugin_dashboards: {e}")))
    }
}
