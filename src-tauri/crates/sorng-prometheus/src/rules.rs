// ── sorng-prometheus/src/rules.rs ────────────────────────────────────────────
//! Rule group listing via /api/v1/rules.

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct RuleManager;

impl RuleManager {
    /// List all rule groups, optionally filtered by type ("alert" or "record").
    /// Endpoint: GET /api/v1/rules
    pub async fn list(
        client: &PrometheusClient,
        rule_type: Option<&str>,
    ) -> PrometheusResult<Vec<RuleGroup>> {
        let mut params: Vec<(&str, &str)> = Vec::new();
        if let Some(rt) = rule_type {
            params.push(("type", rt));
        }
        let raw: serde_json::Value = client.api_get("rules", &params).await?;
        let groups = raw
            .get("groups")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(groups)
            .map_err(|e| PrometheusError::parse(e.to_string()))
    }

    /// List only alerting rule groups.
    pub async fn list_alerting(client: &PrometheusClient) -> PrometheusResult<Vec<RuleGroup>> {
        Self::list(client, Some("alert")).await
    }

    /// List only recording rule groups.
    pub async fn list_recording(client: &PrometheusClient) -> PrometheusResult<Vec<RuleGroup>> {
        Self::list(client, Some("record")).await
    }

    /// Get a specific rule group by name.
    pub async fn get_group(
        client: &PrometheusClient,
        name: &str,
    ) -> PrometheusResult<RuleGroup> {
        let groups = Self::list(client, None).await?;
        groups
            .into_iter()
            .find(|g| g.name == name)
            .ok_or_else(|| PrometheusError::rule_not_found(format!("Rule group '{name}' not found")))
    }
}
