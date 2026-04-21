// ── sorng-prometheus/src/targets.rs ──────────────────────────────────────────
//! Scrape target discovery and metadata via /api/v1/targets.

use crate::client::PrometheusClient;
use crate::error::PrometheusResult;
use crate::types::*;

pub struct TargetManager;

impl TargetManager {
    /// List scrape targets, optionally filtered by state ("active", "dropped", "any").
    /// Endpoint: GET /api/v1/targets
    pub async fn list(
        client: &PrometheusClient,
        state_filter: Option<&str>,
    ) -> PrometheusResult<Vec<PromTarget>> {
        let mut params: Vec<(&str, &str)> = Vec::new();
        if let Some(s) = state_filter {
            params.push(("state", s));
        }
        let raw: serde_json::Value = client.api_get("targets", &params).await?;
        let active = raw
            .get("activeTargets")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(active)
            .map_err(|e| crate::error::PrometheusError::parse(e.to_string()))
    }

    /// List only active targets.
    pub async fn list_active(client: &PrometheusClient) -> PrometheusResult<Vec<PromTarget>> {
        Self::list(client, Some("active")).await
    }

    /// List only dropped targets.
    pub async fn list_dropped(client: &PrometheusClient) -> PrometheusResult<Vec<PromTarget>> {
        let raw: serde_json::Value = client.api_get("targets", &[("state", "dropped")]).await?;
        let dropped = raw
            .get("droppedTargets")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(dropped)
            .map_err(|e| crate::error::PrometheusError::parse(e.to_string()))
    }

    /// Get target metadata.
    /// Endpoint: GET /api/v1/targets/metadata
    pub async fn get_metadata(
        client: &PrometheusClient,
        metric: Option<&str>,
        match_target: Option<&str>,
        limit: Option<u32>,
    ) -> PrometheusResult<Vec<TargetMetadata>> {
        let mut params: Vec<(&str, &str)> = Vec::new();
        let metric_str;
        if let Some(m) = metric {
            metric_str = m.to_string();
            params.push(("metric", &metric_str));
        }
        let target_str;
        if let Some(t) = match_target {
            target_str = t.to_string();
            params.push(("match_target", &target_str));
        }
        let limit_str;
        if let Some(l) = limit {
            limit_str = l.to_string();
            params.push(("limit", &limit_str));
        }
        client.api_get("targets/metadata", &params).await
    }
}
