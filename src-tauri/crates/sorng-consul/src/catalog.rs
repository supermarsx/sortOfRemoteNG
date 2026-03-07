// ── sorng-consul – Catalog operations ────────────────────────────────────────
//! Consul catalog API: datacenters, nodes, catalog services, entity registration.

use crate::client::ConsulClient;
use crate::error::{ConsulError, ConsulResult};
use crate::types::*;
use log::debug;
use std::collections::HashMap;

/// Manager for Consul catalog operations.
pub struct CatalogManager;

impl CatalogManager {
    // ── Datacenters ─────────────────────────────────────────────────

    /// GET /v1/catalog/datacenters — returns the list of known datacenters.
    pub async fn list_datacenters(client: &ConsulClient) -> ConsulResult<Vec<String>> {
        debug!("CONSUL list datacenters");
        client.get("/v1/catalog/datacenters").await
    }

    // ── Nodes ───────────────────────────────────────────────────────

    /// GET /v1/catalog/nodes — returns all nodes in the catalog.
    pub async fn list_nodes(client: &ConsulClient) -> ConsulResult<Vec<ConsulNode>> {
        debug!("CONSUL list catalog nodes");
        let raw_nodes: Vec<serde_json::Value> = client.get("/v1/catalog/nodes").await?;
        let mut nodes = Vec::with_capacity(raw_nodes.len());
        for entry in raw_nodes {
            nodes.push(parse_catalog_node_entry(&entry));
        }
        Ok(nodes)
    }

    /// GET /v1/catalog/node/:node — returns the node and its services.
    pub async fn get_node(client: &ConsulClient, node_name: &str) -> ConsulResult<CatalogNode> {
        let path = format!("/v1/catalog/node/{}", node_name);
        debug!("CONSUL get catalog node: {node_name}");
        let raw: serde_json::Value = client.get(&path).await?;

        let node_val = raw.get("Node")
            .ok_or_else(|| ConsulError::parse("Missing 'Node' in response"))?;
        let node = parse_catalog_node_entry(node_val);

        let services = raw.get("Services")
            .and_then(|v| v.as_object())
            .map(|obj| {
                obj.iter().map(|(name, svc_val)| {
                    let svc = parse_catalog_service(svc_val, name);
                    (name.clone(), svc)
                }).collect::<HashMap<String, ConsulService>>()
            });

        Ok(CatalogNode { node, services })
    }

    // ── Services ────────────────────────────────────────────────────

    /// GET /v1/catalog/services — map of serviceName → tags.
    pub async fn list_catalog_services(client: &ConsulClient) -> ConsulResult<HashMap<String, Vec<String>>> {
        debug!("CONSUL list catalog services");
        client.get("/v1/catalog/services").await
    }

    /// GET /v1/catalog/service/:name — all nodes providing a service.
    pub async fn get_catalog_service(client: &ConsulClient, name: &str) -> ConsulResult<Vec<ConsulServiceEntry>> {
        let path = format!("/v1/catalog/service/{}", name);
        debug!("CONSUL get catalog service: {name}");
        let entries: Vec<serde_json::Value> = client.get(&path).await?;
        let mut result = Vec::with_capacity(entries.len());
        for entry in entries {
            let node = ConsulNode {
                id: entry.get("ID").and_then(|v| v.as_str()).map(|s| s.to_string()),
                node: entry.get("Node").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                address: entry.get("Address").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                datacenter: entry.get("Datacenter").and_then(|v| v.as_str()).map(|s| s.to_string()),
                tagged_addresses: parse_string_map(entry.get("TaggedAddresses")),
                meta: parse_string_map(entry.get("NodeMeta")),
                create_index: entry.get("CreateIndex").and_then(|v| v.as_u64()),
                modify_index: entry.get("ModifyIndex").and_then(|v| v.as_u64()),
            };
            let svc = ConsulService {
                id: entry.get("ServiceID").and_then(|v| v.as_str()).map(|s| s.to_string()),
                service: entry.get("ServiceName").and_then(|v| v.as_str()).unwrap_or(name).to_string(),
                tags: entry.get("ServiceTags").and_then(|v| v.as_array()).map(|arr| {
                    arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
                }),
                address: entry.get("ServiceAddress").and_then(|v| v.as_str()).map(|s| s.to_string()),
                port: entry.get("ServicePort").and_then(|v| v.as_u64()).map(|p| p as u16),
                meta: parse_string_map(entry.get("ServiceMeta")),
                namespace: entry.get("Namespace").and_then(|v| v.as_str()).map(|s| s.to_string()),
                partition: entry.get("Partition").and_then(|v| v.as_str()).map(|s| s.to_string()),
                weights: parse_weights(entry.get("ServiceWeights")),
                enable_tag_override: entry.get("ServiceEnableTagOverride").and_then(|v| v.as_bool()),
                create_index: None,
                modify_index: None,
            };
            result.push(ConsulServiceEntry { node, service: svc, checks: Vec::new() });
        }
        Ok(result)
    }

    // ── Entity registration ─────────────────────────────────────────

    /// PUT /v1/catalog/register — register or update a catalog entity.
    pub async fn register_entity(client: &ConsulClient, reg: &CatalogRegistration) -> ConsulResult<()> {
        debug!("CONSUL catalog register: {}", reg.node);
        let body = build_catalog_register_body(reg);
        client.put_json_no_response("/v1/catalog/register", &body).await
    }

    /// PUT /v1/catalog/deregister — deregister a catalog entity.
    pub async fn deregister_entity(client: &ConsulClient, dereg: &CatalogDeregistration) -> ConsulResult<()> {
        debug!("CONSUL catalog deregister: {}", dereg.node);
        let body = build_catalog_deregister_body(dereg);
        client.put_json_no_response("/v1/catalog/deregister", &body).await
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn parse_catalog_node_entry(v: &serde_json::Value) -> ConsulNode {
    ConsulNode {
        id: v.get("ID").and_then(|v| v.as_str()).map(|s| s.to_string()),
        node: v.get("Node").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        address: v.get("Address").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        datacenter: v.get("Datacenter").and_then(|v| v.as_str()).map(|s| s.to_string()),
        tagged_addresses: parse_string_map(v.get("TaggedAddresses")),
        meta: parse_string_map(v.get("Meta").or_else(|| v.get("NodeMeta"))),
        create_index: v.get("CreateIndex").and_then(|v| v.as_u64()),
        modify_index: v.get("ModifyIndex").and_then(|v| v.as_u64()),
    }
}

fn parse_catalog_service(v: &serde_json::Value, fallback_name: &str) -> ConsulService {
    ConsulService {
        id: v.get("ID").and_then(|v| v.as_str()).map(|s| s.to_string()),
        service: v.get("Service").and_then(|v| v.as_str()).unwrap_or(fallback_name).to_string(),
        tags: v.get("Tags").and_then(|v| v.as_array()).map(|arr| {
            arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
        }),
        address: v.get("Address").and_then(|v| v.as_str()).map(|s| s.to_string()),
        port: v.get("Port").and_then(|v| v.as_u64()).map(|p| p as u16),
        meta: parse_string_map(v.get("Meta")),
        namespace: v.get("Namespace").and_then(|v| v.as_str()).map(|s| s.to_string()),
        partition: v.get("Partition").and_then(|v| v.as_str()).map(|s| s.to_string()),
        weights: parse_weights(v.get("Weights")),
        enable_tag_override: v.get("EnableTagOverride").and_then(|v| v.as_bool()),
        create_index: v.get("CreateIndex").and_then(|v| v.as_u64()),
        modify_index: v.get("ModifyIndex").and_then(|v| v.as_u64()),
    }
}

fn parse_string_map(val: Option<&serde_json::Value>) -> Option<HashMap<String, String>> {
    val.and_then(|v| v.as_object()).map(|obj| {
        obj.iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
            .collect()
    })
}

fn parse_weights(val: Option<&serde_json::Value>) -> Option<ServiceWeights> {
    val.and_then(|v| {
        let passing = v.get("Passing").and_then(|p| p.as_i64()).unwrap_or(1) as i32;
        let warning = v.get("Warning").and_then(|w| w.as_i64()).unwrap_or(1) as i32;
        Some(ServiceWeights { passing, warning })
    })
}

fn build_catalog_register_body(reg: &CatalogRegistration) -> serde_json::Value {
    let mut body = serde_json::json!({
        "Node": reg.node,
        "Address": reg.address,
    });
    let obj = body.as_object_mut().unwrap();
    if let Some(ref dc) = reg.datacenter {
        obj.insert("Datacenter".into(), serde_json::json!(dc));
    }
    if let Some(ref ta) = reg.tagged_addresses {
        obj.insert("TaggedAddresses".into(), serde_json::json!(ta));
    }
    if let Some(ref nm) = reg.node_meta {
        obj.insert("NodeMeta".into(), serde_json::json!(nm));
    }
    if let Some(ref svc) = reg.service {
        let mut svc_obj = serde_json::json!({"Service": svc.service});
        let s = svc_obj.as_object_mut().unwrap();
        if let Some(ref id) = svc.id { s.insert("ID".into(), serde_json::json!(id)); }
        if let Some(ref tags) = svc.tags { s.insert("Tags".into(), serde_json::json!(tags)); }
        if let Some(ref a) = svc.address { s.insert("Address".into(), serde_json::json!(a)); }
        if let Some(p) = svc.port { s.insert("Port".into(), serde_json::json!(p)); }
        if let Some(ref m) = svc.meta { s.insert("Meta".into(), serde_json::json!(m)); }
        obj.insert("Service".into(), svc_obj);
    }
    if let Some(ref chk) = reg.check {
        let mut c = serde_json::json!({"Name": chk.name});
        let co = c.as_object_mut().unwrap();
        if let Some(ref n) = chk.node { co.insert("Node".into(), serde_json::json!(n)); }
        if let Some(ref id) = chk.check_id { co.insert("CheckID".into(), serde_json::json!(id)); }
        if let Some(ref note) = chk.notes { co.insert("Notes".into(), serde_json::json!(note)); }
        if let Some(ref st) = chk.status { co.insert("Status".into(), serde_json::json!(st)); }
        if let Some(ref sid) = chk.service_id { co.insert("ServiceID".into(), serde_json::json!(sid)); }
        obj.insert("Check".into(), c);
    }
    body
}

fn build_catalog_deregister_body(dereg: &CatalogDeregistration) -> serde_json::Value {
    let mut body = serde_json::json!({ "Node": dereg.node });
    let obj = body.as_object_mut().unwrap();
    if let Some(ref dc) = dereg.datacenter {
        obj.insert("Datacenter".into(), serde_json::json!(dc));
    }
    if let Some(ref cid) = dereg.check_id {
        obj.insert("CheckID".into(), serde_json::json!(cid));
    }
    if let Some(ref sid) = dereg.service_id {
        obj.insert("ServiceID".into(), serde_json::json!(sid));
    }
    body
}
