// ── sorng-consul – Service discovery operations ─────────────────────────────
//! Register, deregister, list, and inspect services through the Consul API.

use crate::client::ConsulClient;
use crate::error::ConsulResult;
use crate::types::*;
use log::debug;
use std::collections::HashMap;

/// Service discovery operations on the Consul catalog and agent.
pub struct ServiceDiscovery;

impl ServiceDiscovery {
    // ── List & inspect ──────────────────────────────────────────────

    /// GET /v1/catalog/services — returns a map of service name → tags.
    pub async fn list_services(
        client: &ConsulClient,
    ) -> ConsulResult<HashMap<String, Vec<String>>> {
        debug!("CONSUL list services (catalog)");
        client.get("/v1/catalog/services").await
    }

    /// GET /v1/catalog/service/:name — returns all nodes providing a service.
    pub async fn get_service(
        client: &ConsulClient,
        name: &str,
    ) -> ConsulResult<Vec<ConsulServiceEntry>> {
        let path = format!("/v1/catalog/service/{}", name);
        debug!("CONSUL get service: {name}");
        let entries: Vec<serde_json::Value> = client.get(&path).await?;
        let mut result = Vec::with_capacity(entries.len());
        for entry in entries {
            let node = ConsulNode {
                id: entry
                    .get("ID")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                node: entry
                    .get("Node")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                address: entry
                    .get("Address")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                datacenter: entry
                    .get("Datacenter")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                tagged_addresses: parse_string_map(entry.get("TaggedAddresses")),
                meta: parse_string_map(entry.get("NodeMeta")),
                create_index: entry.get("CreateIndex").and_then(|v| v.as_u64()),
                modify_index: entry.get("ModifyIndex").and_then(|v| v.as_u64()),
            };
            let svc = ConsulService {
                id: entry
                    .get("ServiceID")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                service: entry
                    .get("ServiceName")
                    .and_then(|v| v.as_str())
                    .unwrap_or(name)
                    .to_string(),
                tags: entry
                    .get("ServiceTags")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    }),
                address: entry
                    .get("ServiceAddress")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                port: entry
                    .get("ServicePort")
                    .and_then(|v| v.as_u64())
                    .map(|p| p as u16),
                meta: parse_string_map(entry.get("ServiceMeta")),
                namespace: entry
                    .get("Namespace")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                partition: entry
                    .get("Partition")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                weights: parse_weights(entry.get("ServiceWeights")),
                enable_tag_override: entry
                    .get("ServiceEnableTagOverride")
                    .and_then(|v| v.as_bool()),
                create_index: None,
                modify_index: None,
            };
            let checks = Vec::new(); // catalog/service doesn't inline checks
            result.push(ConsulServiceEntry {
                node,
                service: svc,
                checks,
            });
        }
        Ok(result)
    }

    /// GET /v1/health/service/:name — returns instances with health info.
    pub async fn list_service_instances(
        client: &ConsulClient,
        name: &str,
    ) -> ConsulResult<Vec<ConsulServiceEntry>> {
        let path = format!("/v1/health/service/{}", name);
        debug!("CONSUL list service instances: {name}");
        client.get(&path).await
    }

    /// GET /v1/health/service/:name?passing — returns only healthy instances.
    pub async fn get_service_health(
        client: &ConsulClient,
        name: &str,
    ) -> ConsulResult<Vec<ConsulServiceEntry>> {
        let path = format!("/v1/health/service/{}", name);
        debug!("CONSUL get service health: {name}");
        client.get_with_params(&path, &[("passing", "true")]).await
    }

    // ── Register & deregister ───────────────────────────────────────

    /// PUT /v1/agent/service/register — register a new service on the local agent.
    pub async fn register_service(
        client: &ConsulClient,
        reg: &ServiceRegistration,
    ) -> ConsulResult<()> {
        debug!("CONSUL register service: {}", reg.name);
        // Consul agent register expects the body directly
        let body = build_agent_service_body(reg);
        client
            .put_json_no_response("/v1/agent/service/register", &body)
            .await
    }

    /// PUT /v1/agent/service/deregister/:id — deregister a service from the agent.
    pub async fn deregister_service(client: &ConsulClient, service_id: &str) -> ConsulResult<()> {
        let path = format!("/v1/agent/service/deregister/{}", service_id);
        debug!("CONSUL deregister service: {service_id}");
        client.put_no_body(&path).await
    }

    // ── Maintenance mode ────────────────────────────────────────────

    /// PUT /v1/agent/service/maintenance/:id?enable=true&reason=...
    pub async fn enable_maintenance(
        client: &ConsulClient,
        service_id: &str,
        reason: &str,
    ) -> ConsulResult<()> {
        let path = format!("/v1/agent/service/maintenance/{}", service_id);
        debug!("CONSUL enable maintenance: {service_id}");
        let url = format!("{}?enable=true&reason={}", path, urlencoding(reason));
        client.put_no_body(&url).await
    }

    /// PUT /v1/agent/service/maintenance/:id?enable=false
    pub async fn disable_maintenance(client: &ConsulClient, service_id: &str) -> ConsulResult<()> {
        let path = format!("/v1/agent/service/maintenance/{}", service_id);
        debug!("CONSUL disable maintenance: {service_id}");
        let url = format!("{}?enable=false", path);
        client.put_no_body(&url).await
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn parse_string_map(val: Option<&serde_json::Value>) -> Option<HashMap<String, String>> {
    val.and_then(|v| v.as_object()).map(|obj| {
        obj.iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
            .collect()
    })
}

fn parse_weights(val: Option<&serde_json::Value>) -> Option<ServiceWeights> {
    val.map(|v| {
        let passing = v.get("Passing").and_then(|p| p.as_i64()).unwrap_or(1) as i32;
        let warning = v.get("Warning").and_then(|w| w.as_i64()).unwrap_or(1) as i32;
        ServiceWeights { passing, warning }
    })
}

/// Build the JSON body for /v1/agent/service/register (PascalCase).
fn build_agent_service_body(reg: &ServiceRegistration) -> serde_json::Value {
    let mut body = serde_json::json!({
        "Name": reg.name,
    });
    let obj = body.as_object_mut().unwrap();
    if let Some(ref id) = reg.id {
        obj.insert("ID".into(), serde_json::json!(id));
    }
    if let Some(ref tags) = reg.tags {
        obj.insert("Tags".into(), serde_json::json!(tags));
    }
    if let Some(ref addr) = reg.address {
        obj.insert("Address".into(), serde_json::json!(addr));
    }
    if let Some(port) = reg.port {
        obj.insert("Port".into(), serde_json::json!(port));
    }
    if let Some(ref meta) = reg.meta {
        obj.insert("Meta".into(), serde_json::json!(meta));
    }
    if let Some(eto) = reg.enable_tag_override {
        obj.insert("EnableTagOverride".into(), serde_json::json!(eto));
    }
    if let Some(ref w) = reg.weights {
        obj.insert(
            "Weights".into(),
            serde_json::json!({"Passing": w.passing, "Warning": w.warning}),
        );
    }
    if let Some(ref chk) = reg.check {
        obj.insert("Check".into(), build_check_body(chk));
    }
    if let Some(ref chks) = reg.checks {
        let arr: Vec<serde_json::Value> = chks.iter().map(build_check_body).collect();
        obj.insert("Checks".into(), serde_json::json!(arr));
    }
    body
}

fn build_check_body(chk: &ServiceCheckRegistration) -> serde_json::Value {
    let mut body = serde_json::json!({});
    let obj = body.as_object_mut().unwrap();
    if let Some(ref n) = chk.name {
        obj.insert("Name".into(), serde_json::json!(n));
    }
    if let Some(ref id) = chk.check_id {
        obj.insert("CheckID".into(), serde_json::json!(id));
    }
    if let Some(ref h) = chk.http {
        obj.insert("HTTP".into(), serde_json::json!(h));
    }
    if let Some(ref t) = chk.tcp {
        obj.insert("TCP".into(), serde_json::json!(t));
    }
    if let Some(ref g) = chk.grpc {
        obj.insert("GRPC".into(), serde_json::json!(g));
    }
    if let Some(ref i) = chk.interval {
        obj.insert("Interval".into(), serde_json::json!(i));
    }
    if let Some(ref t) = chk.timeout {
        obj.insert("Timeout".into(), serde_json::json!(t));
    }
    if let Some(ref d) = chk.deregister_critical_service_after {
        obj.insert(
            "DeregisterCriticalServiceAfter".into(),
            serde_json::json!(d),
        );
    }
    if let Some(skip) = chk.tls_skip_verify {
        obj.insert("TLSSkipVerify".into(), serde_json::json!(skip));
    }
    if let Some(ref s) = chk.status {
        obj.insert("Status".into(), serde_json::json!(s));
    }
    body
}

fn urlencoding(s: &str) -> String {
    s.replace('%', "%25")
        .replace(' ', "%20")
        .replace('&', "%26")
        .replace('=', "%3D")
        .replace('+', "%2B")
        .replace('#', "%23")
}
