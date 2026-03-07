// ── sorng-prometheus/src/tsdb.rs ─────────────────────────────────────────────
//! TSDB administration: status, snapshots, series deletion, tombstone cleanup.

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct TsdbManager;

impl TsdbManager {
    /// Get TSDB head and cardinality statistics.
    /// Endpoint: GET /api/v1/status/tsdb
    pub async fn get_status(client: &PrometheusClient) -> PrometheusResult<TsdbStatus> {
        client.api_get("status/tsdb", &[]).await
    }

    /// Create a snapshot of the current TSDB data.
    /// Endpoint: POST /api/v1/admin/tsdb/snapshot
    pub async fn snapshot(
        client: &PrometheusClient,
        skip_head: bool,
    ) -> PrometheusResult<String> {
        let skip = if skip_head { "true" } else { "false" };
        let raw: serde_json::Value =
            client.api_post("admin/tsdb/snapshot", &[("skip_head", skip)]).await?;
        let name = raw
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(name)
    }

    /// Delete time-series data matching selectors in the given time range.
    /// Endpoint: POST /api/v1/admin/tsdb/delete_series
    pub async fn delete_series(
        client: &PrometheusClient,
        match_selectors: &[&str],
        start: Option<&str>,
        end: Option<&str>,
    ) -> PrometheusResult<()> {
        let mut params: Vec<(&str, &str)> = Vec::new();
        for m in match_selectors {
            params.push(("match[]", m));
        }
        if let Some(s) = start {
            params.push(("start", s));
        }
        if let Some(e) = end {
            params.push(("end", e));
        }
        client.api_post_empty("admin/tsdb/delete_series", &params).await
    }

    /// Remove deleted data from disk (clean tombstones).
    /// Endpoint: POST /api/v1/admin/tsdb/clean_tombstones
    pub async fn clean_tombstones(client: &PrometheusClient) -> PrometheusResult<()> {
        client.api_post_empty("admin/tsdb/clean_tombstones", &[]).await
    }
}
