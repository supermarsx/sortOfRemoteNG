// ── sorng-consul – Agent operations ──────────────────────────────────────────
//! Consul agent API: self info, members, services, checks, join/leave, metrics.

use crate::client::ConsulClient;
use crate::error::ConsulResult;
use crate::types::*;
use log::debug;
use std::collections::HashMap;

/// Manager for Consul agent-local operations.
pub struct AgentManager;

impl AgentManager {
    // ── Self / info ─────────────────────────────────────────────────

    /// GET /v1/agent/self — returns the agent's configuration and member info.
    pub async fn get_self(client: &ConsulClient) -> ConsulResult<ConsulAgentInfo> {
        debug!("CONSUL agent self");
        client.get("/v1/agent/self").await
    }

    /// GET /v1/agent/members — returns the known gossip pool members.
    pub async fn list_members(client: &ConsulClient) -> ConsulResult<Vec<AgentMember>> {
        debug!("CONSUL agent members");
        let raw: Vec<serde_json::Value> = client.get("/v1/agent/members").await?;
        Ok(raw.iter().map(parse_member).collect())
    }

    // ── Agent services ──────────────────────────────────────────────

    /// GET /v1/agent/services — returns services registered on the local agent.
    pub async fn list_agent_services(
        client: &ConsulClient,
    ) -> ConsulResult<HashMap<String, ConsulService>> {
        debug!("CONSUL agent services");
        let raw: HashMap<String, serde_json::Value> = client.get("/v1/agent/services").await?;
        let mut result = HashMap::with_capacity(raw.len());
        for (key, val) in &raw {
            result.insert(key.clone(), parse_agent_service(val, key));
        }
        Ok(result)
    }

    /// PUT /v1/agent/service/register — register a service on the agent.
    pub async fn register_agent_service(
        client: &ConsulClient,
        reg: &ServiceRegistration,
    ) -> ConsulResult<()> {
        debug!("CONSUL agent register service: {}", reg.name);
        let body = build_agent_service_body(reg);
        client
            .put_json_no_response("/v1/agent/service/register", &body)
            .await
    }

    /// PUT /v1/agent/service/deregister/:id — remove a service from the agent.
    pub async fn deregister_agent_service(
        client: &ConsulClient,
        service_id: &str,
    ) -> ConsulResult<()> {
        let path = format!("/v1/agent/service/deregister/{}", service_id);
        debug!("CONSUL agent deregister service: {service_id}");
        client.put_no_body(&path).await
    }

    // ── Agent checks ────────────────────────────────────────────────

    /// GET /v1/agent/checks — returns checks registered on the local agent.
    pub async fn list_agent_checks(
        client: &ConsulClient,
    ) -> ConsulResult<HashMap<String, ConsulHealthCheck>> {
        debug!("CONSUL agent checks");
        let raw: HashMap<String, serde_json::Value> = client.get("/v1/agent/checks").await?;
        let mut result = HashMap::with_capacity(raw.len());
        for (key, val) in &raw {
            result.insert(key.clone(), parse_agent_check(val));
        }
        Ok(result)
    }

    /// PUT /v1/agent/check/register — register a check on the agent.
    pub async fn register_check(
        client: &ConsulClient,
        reg: &CheckRegistration,
    ) -> ConsulResult<()> {
        debug!("CONSUL agent register check: {}", reg.name);
        let body = build_check_register_body(reg);
        client
            .put_json_no_response("/v1/agent/check/register", &body)
            .await
    }

    /// PUT /v1/agent/check/deregister/:id — remove a check from the agent.
    pub async fn deregister_check(client: &ConsulClient, check_id: &str) -> ConsulResult<()> {
        let path = format!("/v1/agent/check/deregister/{}", check_id);
        debug!("CONSUL agent deregister check: {check_id}");
        client.put_no_body(&path).await
    }

    // ── Cluster operations ──────────────────────────────────────────

    /// PUT /v1/agent/join/:address — instructs the agent to join a cluster.
    pub async fn join(client: &ConsulClient, address: &str) -> ConsulResult<()> {
        let path = format!("/v1/agent/join/{}", address);
        debug!("CONSUL agent join: {address}");
        client.put_no_body(&path).await
    }

    /// PUT /v1/agent/leave — gracefully leave the cluster.
    pub async fn leave(client: &ConsulClient) -> ConsulResult<()> {
        debug!("CONSUL agent leave");
        client.put_no_body("/v1/agent/leave").await
    }

    /// PUT /v1/agent/force-leave/:node — force a node to leave the cluster.
    pub async fn force_leave(client: &ConsulClient, node: &str) -> ConsulResult<()> {
        let path = format!("/v1/agent/force-leave/{}", node);
        debug!("CONSUL agent force-leave: {node}");
        client.put_no_body(&path).await
    }

    // ── Management ──────────────────────────────────────────────────

    /// PUT /v1/agent/reload — reload the agent's configuration.
    pub async fn reload_config(client: &ConsulClient) -> ConsulResult<()> {
        debug!("CONSUL agent reload");
        client.put_no_body("/v1/agent/reload").await
    }

    /// GET /v1/agent/metrics — returns agent telemetry metrics.
    pub async fn get_metrics(client: &ConsulClient) -> ConsulResult<ConsulAgentMetrics> {
        debug!("CONSUL agent metrics");
        client.get("/v1/agent/metrics").await
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn parse_member(v: &serde_json::Value) -> AgentMember {
    AgentMember {
        name: v
            .get("Name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        addr: v
            .get("Addr")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        port: v.get("Port").and_then(|v| v.as_u64()).unwrap_or(0) as u16,
        tags: v.get("Tags").and_then(|v| v.as_object()).map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        }),
        status: v.get("Status").and_then(|v| v.as_u64()).unwrap_or(0) as u8,
        protocol_min: v
            .get("ProtocolMin")
            .and_then(|v| v.as_u64())
            .map(|n| n as u8),
        protocol_max: v
            .get("ProtocolMax")
            .and_then(|v| v.as_u64())
            .map(|n| n as u8),
        protocol_cur: v
            .get("ProtocolCur")
            .and_then(|v| v.as_u64())
            .map(|n| n as u8),
        delegate_min: v
            .get("DelegateMin")
            .and_then(|v| v.as_u64())
            .map(|n| n as u8),
        delegate_max: v
            .get("DelegateMax")
            .and_then(|v| v.as_u64())
            .map(|n| n as u8),
        delegate_cur: v
            .get("DelegateCur")
            .and_then(|v| v.as_u64())
            .map(|n| n as u8),
    }
}

fn parse_agent_service(v: &serde_json::Value, key: &str) -> ConsulService {
    ConsulService {
        id: v.get("ID").and_then(|v| v.as_str()).map(|s| s.to_string()),
        service: v
            .get("Service")
            .and_then(|v| v.as_str())
            .unwrap_or(key)
            .to_string(),
        tags: v.get("Tags").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        }),
        address: v
            .get("Address")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        port: v.get("Port").and_then(|v| v.as_u64()).map(|p| p as u16),
        meta: v.get("Meta").and_then(|v| v.as_object()).map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        }),
        namespace: v
            .get("Namespace")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        partition: v
            .get("Partition")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        weights: v.get("Weights").map(|w| {
            let passing = w.get("Passing").and_then(|p| p.as_i64()).unwrap_or(1) as i32;
            let warning = w.get("Warning").and_then(|w| w.as_i64()).unwrap_or(1) as i32;
            ServiceWeights { passing, warning }
        }),
        enable_tag_override: v.get("EnableTagOverride").and_then(|v| v.as_bool()),
        create_index: None,
        modify_index: None,
    }
}

fn parse_agent_check(v: &serde_json::Value) -> ConsulHealthCheck {
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
            .unwrap_or("")
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

fn build_agent_service_body(reg: &ServiceRegistration) -> serde_json::Value {
    let mut body = serde_json::json!({"Name": reg.name});
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
    body
}

fn build_check_register_body(reg: &CheckRegistration) -> serde_json::Value {
    let mut body = serde_json::json!({"Name": reg.name});
    let obj = body.as_object_mut().unwrap();
    if let Some(ref id) = reg.check_id {
        obj.insert("CheckID".into(), serde_json::json!(id));
    }
    if let Some(ref sid) = reg.service_id {
        obj.insert("ServiceID".into(), serde_json::json!(sid));
    }
    if let Some(ref h) = reg.http {
        obj.insert("HTTP".into(), serde_json::json!(h));
    }
    if let Some(ref t) = reg.tcp {
        obj.insert("TCP".into(), serde_json::json!(t));
    }
    if let Some(ref g) = reg.grpc {
        obj.insert("GRPC".into(), serde_json::json!(g));
    }
    if let Some(ref i) = reg.interval {
        obj.insert("Interval".into(), serde_json::json!(i));
    }
    if let Some(ref t) = reg.timeout {
        obj.insert("Timeout".into(), serde_json::json!(t));
    }
    if let Some(ref d) = reg.deregister_critical_service_after {
        obj.insert(
            "DeregisterCriticalServiceAfter".into(),
            serde_json::json!(d),
        );
    }
    if let Some(skip) = reg.tls_skip_verify {
        obj.insert("TLSSkipVerify".into(), serde_json::json!(skip));
    }
    if let Some(ref s) = reg.status {
        obj.insert("Status".into(), serde_json::json!(s));
    }
    if let Some(ref n) = reg.notes {
        obj.insert("Notes".into(), serde_json::json!(n));
    }
    body
}
