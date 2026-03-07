// ── sorng-prometheus/src/queries.rs ──────────────────────────────────────────
//! PromQL query execution against /api/v1/query and /api/v1/query_range.

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;
use std::collections::HashMap;

pub struct QueryManager;

impl QueryManager {
    /// Execute an instant query at a single point in time.
    /// Endpoint: GET /api/v1/query
    pub async fn instant_query(
        client: &PrometheusClient,
        query: &str,
        time: Option<&str>,
        timeout: Option<&str>,
    ) -> PrometheusResult<QueryResult> {
        let mut params: Vec<(&str, &str)> = vec![("query", query)];
        if let Some(t) = time {
            params.push(("time", t));
        }
        if let Some(to) = timeout {
            params.push(("timeout", to));
        }
        let raw: serde_json::Value = client.api_get("query", &params).await?;
        let result_type = raw
            .get("resultType")
            .and_then(|v| v.as_str())
            .unwrap_or("vector")
            .to_string();
        let result_arr = raw.get("result").cloned().unwrap_or_default();
        let data: Vec<QuerySample> =
            serde_json::from_value(result_arr).map_err(|e| PrometheusError::parse(e.to_string()))?;
        Ok(QueryResult { result_type, data })
    }

    /// Execute a range query over a time span.
    /// Endpoint: GET /api/v1/query_range
    pub async fn range_query(
        client: &PrometheusClient,
        query: &str,
        start: &str,
        end: &str,
        step: &str,
        timeout: Option<&str>,
    ) -> PrometheusResult<RangeQueryResult> {
        let mut params: Vec<(&str, &str)> = vec![
            ("query", query),
            ("start", start),
            ("end", end),
            ("step", step),
        ];
        if let Some(to) = timeout {
            params.push(("timeout", to));
        }
        let raw: serde_json::Value = client.api_get("query_range", &params).await?;
        let result_type = raw
            .get("resultType")
            .and_then(|v| v.as_str())
            .unwrap_or("matrix")
            .to_string();
        let result_arr = raw.get("result").cloned().unwrap_or_default();
        let data: Vec<QueryRangeSample> =
            serde_json::from_value(result_arr).map_err(|e| PrometheusError::parse(e.to_string()))?;
        Ok(RangeQueryResult { result_type, data })
    }

    /// Find time series matching label selectors.
    /// Endpoint: GET /api/v1/series
    pub async fn series(
        client: &PrometheusClient,
        match_selectors: &[&str],
        start: Option<&str>,
        end: Option<&str>,
    ) -> PrometheusResult<Vec<HashMap<String, String>>> {
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
        client.api_get("series", &params).await
    }

    /// Get all known label names.
    /// Endpoint: GET /api/v1/labels
    pub async fn label_names(
        client: &PrometheusClient,
        match_selectors: &[&str],
        start: Option<&str>,
        end: Option<&str>,
    ) -> PrometheusResult<Vec<String>> {
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
        client.api_get("labels", &params).await
    }

    /// Get all known values for a given label.
    /// Endpoint: GET /api/v1/label/{label_name}/values
    pub async fn label_values(
        client: &PrometheusClient,
        label_name: &str,
        match_selectors: &[&str],
        start: Option<&str>,
        end: Option<&str>,
    ) -> PrometheusResult<Vec<String>> {
        let path = format!("label/{label_name}/values");
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
        client.api_get(&path, &params).await
    }

    /// Query exemplars for a given expression.
    /// Endpoint: GET /api/v1/query_exemplars
    pub async fn exemplars(
        client: &PrometheusClient,
        query: &str,
        start: &str,
        end: &str,
    ) -> PrometheusResult<serde_json::Value> {
        let params = vec![("query", query), ("start", start), ("end", end)];
        client.api_get("query_exemplars", &params).await
    }
}
