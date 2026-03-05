// ─── Topology types ──────────────────────────────────────────────────────────

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Node types
// ═══════════════════════════════════════════════════════════════════════════════

/// Classification of a topology node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Connection,
    JumpHost,
    ProxyServer,
    VpnGateway,
    LoadBalancer,
    Firewall,
    Router,
    Switch,
    Cloud,
    Cluster,
    Database,
    WebServer,
    FileServer,
    DnsServer,
    MailServer,
    Custom(String),
}

impl std::fmt::Display for NodeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NodeType::Custom(s) => write!(f, "custom:{s}"),
            other => {
                let json = serde_json::to_string(other).unwrap_or_default();
                // strip quotes
                write!(f, "{}", json.trim_matches('"'))
            }
        }
    }
}

/// Operational status of a node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus {
    Online,
    Offline,
    Degraded,
    Unknown,
    Maintenance,
}

impl Default for NodeStatus {
    fn default() -> Self {
        NodeStatus::Unknown
    }
}

/// Geographic location information.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeoLocation {
    pub latitude: f64,
    pub longitude: f64,
    pub city: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub asn: Option<u32>,
    pub isp: Option<String>,
}

/// 2-D canvas position.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

/// A single node in the topology graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyNode {
    pub id: String,
    pub label: String,
    pub node_type: NodeType,
    pub hostname: Option<String>,
    pub ip_address: Option<String>,
    pub port: Option<u16>,
    pub protocol: Option<String>,
    pub status: NodeStatus,
    pub geo: Option<GeoLocation>,
    pub group_id: Option<String>,
    pub metadata: HashMap<String, String>,
    pub position: Option<Position>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edge types
// ═══════════════════════════════════════════════════════════════════════════════

/// Classification of a topology edge.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    DirectConnection,
    SshTunnel,
    ProxyChain,
    VpnLink,
    Dependency,
    JumpHostHop,
    NetworkLink,
    ReplicationLink,
}

/// A directed edge between two topology nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyEdge {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub edge_type: EdgeType,
    pub label: Option<String>,
    pub latency_ms: Option<f64>,
    pub bandwidth: Option<String>,
    pub encrypted: bool,
    pub metadata: HashMap<String, String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Graph container
// ═══════════════════════════════════════════════════════════════════════════════

/// Logical grouping of nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeGroup {
    pub id: String,
    pub label: String,
    pub color: Option<String>,
    pub collapsed: bool,
    pub node_ids: Vec<String>,
}

/// Which layout algorithm to use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LayoutAlgorithm {
    ForceDirected,
    Hierarchical,
    Circular,
    Grid,
    Geographic,
    Manual,
}

impl Default for LayoutAlgorithm {
    fn default() -> Self {
        LayoutAlgorithm::ForceDirected
    }
}

/// Configuration for layout algorithms.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutConfig {
    pub algorithm: LayoutAlgorithm,
    pub width: f64,
    pub height: f64,
    pub padding: f64,
    pub node_spacing: f64,
    pub edge_length: f64,
    pub iterations: u32,
}

impl Default for LayoutConfig {
    fn default() -> Self {
        Self {
            algorithm: LayoutAlgorithm::ForceDirected,
            width: 1200.0,
            height: 800.0,
            padding: 40.0,
            node_spacing: 80.0,
            edge_length: 150.0,
            iterations: 300,
        }
    }
}

/// The core topology graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyGraph {
    pub nodes: HashMap<String, TopologyNode>,
    pub edges: Vec<TopologyEdge>,
    pub groups: Vec<NodeGroup>,
    pub layout_config: LayoutConfig,
    pub last_updated: DateTime<Utc>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Analysis result types
// ═══════════════════════════════════════════════════════════════════════════════

/// Blast-radius result — what is affected if a node goes down.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlastRadius {
    pub affected_node_ids: Vec<String>,
    pub affected_edge_ids: Vec<String>,
    pub severity: String,
    pub description: String,
}

/// Structural diff between two topology snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyDiff {
    pub added_nodes: Vec<String>,
    pub removed_nodes: Vec<String>,
    pub added_edges: Vec<String>,
    pub removed_edges: Vec<String>,
    pub changed_nodes: Vec<NodeChange>,
    pub changed_edges: Vec<EdgeChange>,
}

/// A single field change on a node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeChange {
    pub node_id: String,
    pub field: String,
    pub old_value: String,
    pub new_value: String,
}

/// A single field change on an edge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeChange {
    pub edge_id: String,
    pub field: String,
    pub old_value: String,
    pub new_value: String,
}

/// A point-in-time snapshot of the topology graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologySnapshot {
    pub id: String,
    pub graph: TopologyGraph,
    pub created_at: DateTime<Utc>,
    pub label: Option<String>,
}

/// Summary statistics about the topology graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyStats {
    pub total_nodes: usize,
    pub total_edges: usize,
    pub by_node_type: HashMap<String, usize>,
    pub by_status: HashMap<String, usize>,
    pub avg_latency_ms: f64,
    pub isolated_nodes_count: usize,
}
