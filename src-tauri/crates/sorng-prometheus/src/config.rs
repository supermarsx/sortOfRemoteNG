// ── sorng-prometheus/src/config.rs ───────────────────────────────────────────
//! Prometheus server configuration and flags.

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;
use std::collections::HashMap;

pub struct ConfigManager;

impl ConfigManager {
    /// Get the currently loaded Prometheus configuration as YAML.
    /// Endpoint: GET /api/v1/status/config
    pub async fn get(client: &PrometheusClient) -> PrometheusResult<PrometheusConfig> {
        let raw: serde_json::Value = client.api_get("status/config", &[]).await?;
        let yaml = raw
            .get("yaml")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(PrometheusConfig { yaml })
    }

    /// Trigger a configuration reload.
    /// Endpoint: POST /-/reload (lifecycle API, not under /api/v1)
    pub async fn reload(client: &PrometheusClient) -> PrometheusResult<ConfigReloadResult> {
        // /-/reload is outside the /api/v1 prefix so we use post on base URL
        let url = format!(
            "{}://{}:{}/-/reload",
            if client.config.use_tls.unwrap_or(false) {
                "https"
            } else {
                "http"
            },
            client.config.host,
            client.config.port.unwrap_or(9090)
        );
        let resp = reqwest::Client::new()
            .post(&url)
            .send()
            .await
            .map_err(|e| PrometheusError::config_error(format!("reload: {e}")))?;
        Ok(ConfigReloadResult {
            success: resp.status().is_success(),
        })
    }

    /// Get command-line flags the Prometheus server was started with.
    /// Endpoint: GET /api/v1/status/flags
    pub async fn get_flags(client: &PrometheusClient) -> PrometheusResult<HashMap<String, String>> {
        client.api_get("status/flags", &[]).await
    }
}
