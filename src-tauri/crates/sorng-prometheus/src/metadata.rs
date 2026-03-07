// ── sorng-prometheus/src/metadata.rs ─────────────────────────────────────────
//! Metric metadata via /api/v1/metadata.

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;
use std::collections::HashMap;

pub struct MetadataManager;

impl MetadataManager {
    /// List metadata for all (or a specific) metric, optionally limited.
    /// Endpoint: GET /api/v1/metadata
    pub async fn list(
        client: &PrometheusClient,
        metric: Option<&str>,
        limit: Option<u32>,
    ) -> PrometheusResult<HashMap<String, Vec<MetricMetadata>>> {
        let mut params: Vec<(&str, &str)> = Vec::new();
        let metric_str;
        if let Some(m) = metric {
            metric_str = m.to_string();
            params.push(("metric", &metric_str));
        }
        let limit_str;
        if let Some(l) = limit {
            limit_str = l.to_string();
            params.push(("limit", &limit_str));
        }
        client.api_get("metadata", &params).await
    }

    /// Get metadata for a specific metric name.
    pub async fn get(
        client: &PrometheusClient,
        metric: &str,
    ) -> PrometheusResult<Vec<MetricMetadata>> {
        let all = Self::list(client, Some(metric), None).await?;
        Ok(all.into_values().next().unwrap_or_default())
    }
}
