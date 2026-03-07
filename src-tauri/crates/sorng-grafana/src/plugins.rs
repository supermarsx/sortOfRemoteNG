//! Plugin management for Grafana.

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct PluginManager<'a> {
    client: &'a GrafanaClient,
}

impl<'a> PluginManager<'a> {
    pub fn new(client: &'a GrafanaClient) -> Self {
        Self { client }
    }

    /// List all installed plugins.
    pub async fn list(&self) -> GrafanaResult<Vec<GrafanaPlugin>> {
        self.client.api_get("/plugins").await
    }

    /// Get a plugin by ID.
    pub async fn get(&self, plugin_id: &str) -> GrafanaResult<GrafanaPlugin> {
        self.client
            .api_get(&format!("/plugins/{}", plugin_id))
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::plugin_not_found(format!("Plugin '{}' not found", plugin_id))
                }
                _ => e,
            })
    }

    /// Install a plugin by ID (optionally with a specific version).
    pub async fn install(&self, plugin_id: &str, version: Option<&str>) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({});
        if let Some(v) = version {
            body["version"] = serde_json::json!(v);
        }
        self.client
            .api_post(&format!("/plugins/{}/install", plugin_id), &body)
            .await
    }

    /// Uninstall a plugin by ID.
    pub async fn uninstall(&self, plugin_id: &str) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_post(&format!("/plugins/{}/uninstall", plugin_id), &serde_json::json!({}))
            .await
    }

    /// Get the settings of a plugin.
    pub async fn get_settings(&self, plugin_id: &str) -> GrafanaResult<PluginSetting> {
        self.client
            .api_get(&format!("/plugins/{}/settings", plugin_id))
            .await
    }

    /// Update the settings of a plugin.
    pub async fn update_settings(&self, plugin_id: &str, settings: PluginSetting) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_post(&format!("/plugins/{}/settings", plugin_id), &settings)
            .await
    }

    /// Get a plugin's health check.
    pub async fn get_health(&self, plugin_id: &str) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_get(&format!("/plugins/{}/health", plugin_id))
            .await
    }

    /// Get a plugin's metrics.
    pub async fn get_metrics(&self, plugin_id: &str) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_get(&format!("/plugins/{}/metrics", plugin_id))
            .await
    }
}
