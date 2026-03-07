// ── sorng-prometheus/src/alerts.rs ───────────────────────────────────────────
//! Active alert listing and Alertmanager discovery.

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct AlertManager;

impl AlertManager {
    /// List all active alerts.
    /// Endpoint: GET /api/v1/alerts
    pub async fn list(client: &PrometheusClient) -> PrometheusResult<Vec<Alert>> {
        let raw: serde_json::Value = client.api_get("alerts", &[]).await?;
        let alerts = raw
            .get("alerts")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(alerts)
            .map_err(|e| PrometheusError::parse(e.to_string()))
    }

    /// Get active and dropped Alertmanager endpoints.
    /// Endpoint: GET /api/v1/alertmanagers
    pub async fn get_alertmanagers(
        client: &PrometheusClient,
    ) -> PrometheusResult<AlertManagerInfo> {
        client.api_get("alertmanagers", &[]).await
    }
}
