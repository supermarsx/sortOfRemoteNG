// ── sorng-consul – Health check operations ──────────────────────────────────
//! Consul health API: node health, service health, check states.

use crate::client::ConsulClient;
use crate::error::ConsulResult;
use crate::types::*;
use log::debug;

/// Manager for Consul health-related endpoints.
pub struct HealthManager;

impl HealthManager {
    // ── Node health ─────────────────────────────────────────────────

    /// GET /v1/health/node/:node — returns all checks for a node.
    pub async fn node_health(
        client: &ConsulClient,
        node: &str,
    ) -> ConsulResult<Vec<ConsulHealthCheck>> {
        let path = format!("/v1/health/node/{}", node);
        debug!("CONSUL health node: {node}");
        let raw: Vec<serde_json::Value> = client.get(&path).await?;
        Ok(raw.iter().map(parse_health_check).collect())
    }

    // ── Service health ──────────────────────────────────────────────

    /// GET /v1/health/service/:service — returns nodes providing a service with health info.
    pub async fn service_health(
        client: &ConsulClient,
        service: &str,
    ) -> ConsulResult<Vec<ConsulServiceEntry>> {
        let path = format!("/v1/health/service/{}", service);
        debug!("CONSUL health service: {service}");
        client.get(&path).await
    }

    // ── Checks ──────────────────────────────────────────────────────

    /// GET /v1/health/checks/:service — returns checks associated with a service.
    pub async fn list_checks_for_service(
        client: &ConsulClient,
        service: &str,
    ) -> ConsulResult<Vec<ConsulHealthCheck>> {
        let path = format!("/v1/health/checks/{}", service);
        debug!("CONSUL health checks for service: {service}");
        let raw: Vec<serde_json::Value> = client.get(&path).await?;
        Ok(raw.iter().map(parse_health_check).collect())
    }

    /// GET /v1/health/state/:state — returns checks in a specific state.
    /// `state` can be: "any", "passing", "warning", "critical".
    pub async fn list_checks_in_state(
        client: &ConsulClient,
        state: &str,
    ) -> ConsulResult<Vec<ConsulHealthCheck>> {
        let path = format!("/v1/health/state/{}", state);
        debug!("CONSUL health state: {state}");
        let raw: Vec<serde_json::Value> = client.get(&path).await?;
        Ok(raw.iter().map(parse_health_check).collect())
    }

    /// GET /v1/health/checks/:service — returns a single check by ID.
    pub async fn check_health(
        client: &ConsulClient,
        check_id: &str,
    ) -> ConsulResult<ConsulHealthCheck> {
        // Consul doesn't have a direct single-check endpoint.
        // We query all checks in state "any" and filter by CheckID.
        debug!("CONSUL health check: {check_id}");
        let all: Vec<serde_json::Value> = client.get("/v1/health/state/any").await?;
        for entry in &all {
            let cid = entry.get("CheckID").and_then(|v| v.as_str()).unwrap_or("");
            if cid == check_id {
                return Ok(parse_health_check(entry));
            }
        }
        Err(crate::error::ConsulError::not_found(format!(
            "Check not found: {check_id}"
        )))
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn parse_health_check(v: &serde_json::Value) -> ConsulHealthCheck {
    ConsulHealthCheck {
        node: v
            .get("Node")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        check_id: v
            .get("CheckID")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        name: v
            .get("Name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        status: v
            .get("Status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        notes: v
            .get("Notes")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        output: v
            .get("Output")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        service_id: v
            .get("ServiceID")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        service_name: v
            .get("ServiceName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        service_tags: v.get("ServiceTags").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        }),
        check_type: v
            .get("Type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        definition: v.get("Definition").cloned(),
        create_index: v.get("CreateIndex").and_then(|v| v.as_u64()),
        modify_index: v.get("ModifyIndex").and_then(|v| v.as_u64()),
    }
}
