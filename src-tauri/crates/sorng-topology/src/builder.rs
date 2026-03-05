// ─── Topology builder — construct graph from connection data ─────────────────

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

// ═══════════════════════════════════════════════════════════════════════════════
// Input types
// ═══════════════════════════════════════════════════════════════════════════════

/// A single proxy hop in a chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyHop {
    pub hostname: String,
    pub port: u16,
    pub proxy_type: String,
}

/// A single tunnel hop in a chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelHop {
    pub hostname: String,
    pub port: u16,
    pub tunnel_type: String,
}

/// Connection data used to build a topology graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionData {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub protocol: String,
    pub proxy_chain: Option<Vec<ProxyHop>>,
    pub tunnel_chain: Option<Vec<TunnelHop>>,
    pub jump_hosts: Option<Vec<String>>,
    pub group: Option<String>,
    pub tags: Vec<String>,
    pub status: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Builder
// ═══════════════════════════════════════════════════════════════════════════════

/// Build a topology graph from a slice of connection data entries.
///
/// For each connection:
/// 1. Create a `Connection` node for the target host.
/// 2. Create edge (+ intermediate nodes) for each proxy hop.
/// 3. Create edge (+ intermediate nodes) for each tunnel hop.
/// 4. Create edge (+ intermediate nodes) for each jump-host hop.
/// 5. Assign groups.
pub fn build_from_connections(connections: &[ConnectionData]) -> TopologyGraph {
    let mut graph = TopologyGraph::new();

    // Deduplicate intermediate nodes by hostname to avoid creating duplicates
    // when multiple connections share the same jump host / proxy.
    let mut hostname_to_node_id: HashMap<String, String> = HashMap::new();

    // Track groups.
    let mut group_map: HashMap<String, Vec<String>> = HashMap::new();

    for conn in connections {
        // --- Target connection node ------------------------------------------
        let conn_node_id = conn.id.clone();
        let status = match conn.status.as_deref() {
            Some("online") => NodeStatus::Online,
            Some("offline") => NodeStatus::Offline,
            Some("degraded") => NodeStatus::Degraded,
            Some("maintenance") => NodeStatus::Maintenance,
            _ => NodeStatus::Unknown,
        };

        let target_node = TopologyNode {
            id: conn_node_id.clone(),
            label: conn.name.clone(),
            node_type: NodeType::Connection,
            hostname: Some(conn.hostname.clone()),
            ip_address: None,
            port: None,
            protocol: Some(conn.protocol.clone()),
            status,
            geo: None,
            group_id: conn.group.clone(),
            metadata: {
                let mut m = HashMap::new();
                if !conn.tags.is_empty() {
                    m.insert("tags".to_string(), conn.tags.join(","));
                }
                m
            },
            position: None,
        };
        let _ = graph.add_node(target_node);

        if let Some(ref group) = conn.group {
            group_map
                .entry(group.clone())
                .or_default()
                .push(conn_node_id.clone());
        }

        // --- Jump hosts ------------------------------------------------------
        if let Some(ref jump_hosts) = conn.jump_hosts {
            let mut prev_id = conn_node_id.clone();
            for (i, jh_hostname) in jump_hosts.iter().rev().enumerate() {
                let jh_id = hostname_to_node_id
                    .entry(jh_hostname.clone())
                    .or_insert_with(|| format!("jh-{}", Uuid::new_v4()))
                    .clone();

                if graph.get_node(&jh_id).is_none() {
                    let jh_node = TopologyNode {
                        id: jh_id.clone(),
                        label: format!("Jump Host: {jh_hostname}"),
                        node_type: NodeType::JumpHost,
                        hostname: Some(jh_hostname.clone()),
                        ip_address: None,
                        port: Some(22),
                        protocol: Some("ssh".to_string()),
                        status: NodeStatus::Unknown,
                        geo: None,
                        group_id: conn.group.clone(),
                        metadata: HashMap::new(),
                        position: None,
                    };
                    let _ = graph.add_node(jh_node);
                }

                let edge = TopologyEdge {
                    id: format!("edge-jh-{}-{}-{}", conn.id, i, Uuid::new_v4()),
                    source_id: jh_id.clone(),
                    target_id: prev_id.clone(),
                    edge_type: EdgeType::JumpHostHop,
                    label: Some(format!("Jump hop {}", jump_hosts.len() - i)),
                    latency_ms: None,
                    bandwidth: None,
                    encrypted: true,
                    metadata: HashMap::new(),
                };
                let _ = graph.add_edge(edge);

                prev_id = jh_id;
            }
        }

        // --- Proxy chain -----------------------------------------------------
        if let Some(ref proxy_chain) = conn.proxy_chain {
            let mut prev_id = conn_node_id.clone();
            for (i, hop) in proxy_chain.iter().rev().enumerate() {
                let proxy_id = hostname_to_node_id
                    .entry(format!("{}:{}", hop.hostname, hop.port))
                    .or_insert_with(|| format!("proxy-{}", Uuid::new_v4()))
                    .clone();

                if graph.get_node(&proxy_id).is_none() {
                    let proxy_node = TopologyNode {
                        id: proxy_id.clone(),
                        label: format!("Proxy: {}:{}", hop.hostname, hop.port),
                        node_type: NodeType::ProxyServer,
                        hostname: Some(hop.hostname.clone()),
                        ip_address: None,
                        port: Some(hop.port),
                        protocol: Some(hop.proxy_type.clone()),
                        status: NodeStatus::Unknown,
                        geo: None,
                        group_id: conn.group.clone(),
                        metadata: HashMap::new(),
                        position: None,
                    };
                    let _ = graph.add_node(proxy_node);
                }

                let edge = TopologyEdge {
                    id: format!("edge-proxy-{}-{}-{}", conn.id, i, Uuid::new_v4()),
                    source_id: proxy_id.clone(),
                    target_id: prev_id.clone(),
                    edge_type: EdgeType::ProxyChain,
                    label: Some(format!("{} proxy hop {}", hop.proxy_type, proxy_chain.len() - i)),
                    latency_ms: None,
                    bandwidth: None,
                    encrypted: hop.proxy_type.to_lowercase().contains("socks5")
                        || hop.proxy_type.to_lowercase().contains("https"),
                    metadata: HashMap::new(),
                };
                let _ = graph.add_edge(edge);

                prev_id = proxy_id;
            }
        }

        // --- Tunnel chain ----------------------------------------------------
        if let Some(ref tunnel_chain) = conn.tunnel_chain {
            let mut prev_id = conn_node_id.clone();
            for (i, hop) in tunnel_chain.iter().rev().enumerate() {
                let tunnel_id = hostname_to_node_id
                    .entry(format!("tunnel-{}:{}", hop.hostname, hop.port))
                    .or_insert_with(|| format!("tunnel-{}", Uuid::new_v4()))
                    .clone();

                if graph.get_node(&tunnel_id).is_none() {
                    let tunnel_node = TopologyNode {
                        id: tunnel_id.clone(),
                        label: format!("Tunnel: {}:{}", hop.hostname, hop.port),
                        node_type: if hop.tunnel_type.to_lowercase().contains("vpn") {
                            NodeType::VpnGateway
                        } else {
                            NodeType::JumpHost
                        },
                        hostname: Some(hop.hostname.clone()),
                        ip_address: None,
                        port: Some(hop.port),
                        protocol: Some(hop.tunnel_type.clone()),
                        status: NodeStatus::Unknown,
                        geo: None,
                        group_id: conn.group.clone(),
                        metadata: HashMap::new(),
                        position: None,
                    };
                    let _ = graph.add_node(tunnel_node);
                }

                let edge = TopologyEdge {
                    id: format!("edge-tunnel-{}-{}-{}", conn.id, i, Uuid::new_v4()),
                    source_id: tunnel_id.clone(),
                    target_id: prev_id.clone(),
                    edge_type: EdgeType::SshTunnel,
                    label: Some(format!("{} tunnel hop {}", hop.tunnel_type, tunnel_chain.len() - i)),
                    latency_ms: None,
                    bandwidth: None,
                    encrypted: true,
                    metadata: HashMap::new(),
                };
                let _ = graph.add_edge(edge);

                prev_id = tunnel_id;
            }
        }
    }

    // --- Assign groups -------------------------------------------------------
    let mut seen_group_ids: HashSet<String> = HashSet::new();
    for (group_label, node_ids) in &group_map {
        if seen_group_ids.insert(group_label.clone()) {
            graph.groups.push(NodeGroup {
                id: group_label.clone(),
                label: group_label.clone(),
                color: None,
                collapsed: false,
                node_ids: node_ids.clone(),
            });
        }
    }

    graph
}
