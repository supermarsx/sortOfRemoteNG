// ─── Topology diff — change detection between graph versions ─────────────────

use crate::types::*;
use std::collections::{HashMap, HashSet};

/// Compute the structural diff between two topology graphs.
pub fn compute_diff(old: &TopologyGraph, new: &TopologyGraph) -> TopologyDiff {
    // --- Nodes ---------------------------------------------------------------
    let old_node_ids: HashSet<&String> = old.nodes.keys().collect();
    let new_node_ids: HashSet<&String> = new.nodes.keys().collect();

    let added_nodes: Vec<String> = new_node_ids
        .difference(&old_node_ids)
        .map(|id| (*id).clone())
        .collect();
    let removed_nodes: Vec<String> = old_node_ids
        .difference(&new_node_ids)
        .map(|id| (*id).clone())
        .collect();

    let mut changed_nodes: Vec<NodeChange> = Vec::new();
    for id in old_node_ids.intersection(&new_node_ids) {
        let old_node = &old.nodes[*id];
        let new_node = &new.nodes[*id];
        diff_node(old_node, new_node, &mut changed_nodes);
    }

    // --- Edges ---------------------------------------------------------------
    let old_edge_ids: HashSet<String> = old.edges.iter().map(|e| e.id.clone()).collect();
    let new_edge_ids: HashSet<String> = new.edges.iter().map(|e| e.id.clone()).collect();

    let added_edges: Vec<String> = new_edge_ids.difference(&old_edge_ids).cloned().collect();
    let removed_edges: Vec<String> = old_edge_ids.difference(&new_edge_ids).cloned().collect();

    let old_edge_map: HashMap<&str, &TopologyEdge> =
        old.edges.iter().map(|e| (e.id.as_str(), e)).collect();
    let new_edge_map: HashMap<&str, &TopologyEdge> =
        new.edges.iter().map(|e| (e.id.as_str(), e)).collect();

    let mut changed_edges: Vec<EdgeChange> = Vec::new();
    for eid in old_edge_ids.intersection(&new_edge_ids) {
        if let (Some(oe), Some(ne)) = (
            old_edge_map.get(eid.as_str()),
            new_edge_map.get(eid.as_str()),
        ) {
            diff_edge(oe, ne, &mut changed_edges);
        }
    }

    TopologyDiff {
        added_nodes,
        removed_nodes,
        added_edges,
        removed_edges,
        changed_nodes,
        changed_edges,
    }
}

fn diff_node(old: &TopologyNode, new: &TopologyNode, changes: &mut Vec<NodeChange>) {
    let id = old.id.clone();

    macro_rules! cmp_field {
        ($field:ident) => {
            let old_val = serde_json::to_string(&old.$field).unwrap_or_default();
            let new_val = serde_json::to_string(&new.$field).unwrap_or_default();
            if old_val != new_val {
                changes.push(NodeChange {
                    node_id: id.clone(),
                    field: stringify!($field).to_string(),
                    old_value: old_val,
                    new_value: new_val,
                });
            }
        };
    }

    cmp_field!(label);
    cmp_field!(node_type);
    cmp_field!(hostname);
    cmp_field!(ip_address);
    cmp_field!(port);
    cmp_field!(protocol);
    cmp_field!(status);
    cmp_field!(geo);
    cmp_field!(group_id);
    cmp_field!(metadata);
    cmp_field!(position);
}

fn diff_edge(old: &TopologyEdge, new: &TopologyEdge, changes: &mut Vec<EdgeChange>) {
    let id = old.id.clone();

    macro_rules! cmp_field {
        ($field:ident) => {
            let old_val = serde_json::to_string(&old.$field).unwrap_or_default();
            let new_val = serde_json::to_string(&new.$field).unwrap_or_default();
            if old_val != new_val {
                changes.push(EdgeChange {
                    edge_id: id.clone(),
                    field: stringify!($field).to_string(),
                    old_value: old_val,
                    new_value: new_val,
                });
            }
        };
    }

    cmp_field!(source_id);
    cmp_field!(target_id);
    cmp_field!(edge_type);
    cmp_field!(label);
    cmp_field!(latency_ms);
    cmp_field!(bandwidth);
    cmp_field!(encrypted);
    cmp_field!(metadata);
}

/// Apply a diff to a graph, adding/removing nodes and edges and patching
/// changed fields.
pub fn apply_diff(graph: &mut TopologyGraph, diff: &TopologyDiff) {
    // Remove nodes (this also removes their edges via `remove_node`).
    for id in &diff.removed_nodes {
        let _ = graph.remove_node(id);
    }

    // Remove edges that haven't already been removed with nodes.
    for eid in &diff.removed_edges {
        let _ = graph.remove_edge(eid);
    }

    // Add new nodes — we create minimal placeholder nodes. In a real-world
    // scenario the caller would supply the full node data; here we create
    // Unknown nodes so the graph is structurally correct.
    for id in &diff.added_nodes {
        if !graph.nodes.contains_key(id) {
            let node = TopologyNode {
                id: id.clone(),
                label: id.clone(),
                node_type: NodeType::Connection,
                hostname: None,
                ip_address: None,
                port: None,
                protocol: None,
                status: NodeStatus::Unknown,
                geo: None,
                group_id: None,
                metadata: std::collections::HashMap::new(),
                position: None,
            };
            let _ = graph.add_node(node);
        }
    }

    // Add new edges — same caveat about placeholders.
    for eid in &diff.added_edges {
        let exists = graph.edges.iter().any(|e| e.id == *eid);
        if !exists {
            let edge = TopologyEdge {
                id: eid.clone(),
                source_id: String::new(),
                target_id: String::new(),
                edge_type: EdgeType::DirectConnection,
                label: None,
                latency_ms: None,
                bandwidth: None,
                encrypted: false,
                metadata: std::collections::HashMap::new(),
            };
            let _ = graph.add_edge(edge);
        }
    }

    // Apply field-level node changes.
    for change in &diff.changed_nodes {
        if let Some(node) = graph.nodes.get_mut(&change.node_id) {
            apply_node_field_change(node, &change.field, &change.new_value);
        }
    }

    // Apply field-level edge changes.
    for change in &diff.changed_edges {
        if let Some(edge) = graph.edges.iter_mut().find(|e| e.id == change.edge_id) {
            apply_edge_field_change(edge, &change.field, &change.new_value);
        }
    }
}

fn apply_node_field_change(node: &mut TopologyNode, field: &str, new_value: &str) {
    match field {
        "label" => {
            if let Ok(v) = serde_json::from_str::<String>(new_value) {
                node.label = v;
            }
        }
        "node_type" => {
            if let Ok(v) = serde_json::from_str::<NodeType>(new_value) {
                node.node_type = v;
            }
        }
        "hostname" => {
            node.hostname = serde_json::from_str(new_value).ok();
        }
        "ip_address" => {
            node.ip_address = serde_json::from_str(new_value).ok();
        }
        "port" => {
            node.port = serde_json::from_str(new_value).ok();
        }
        "protocol" => {
            node.protocol = serde_json::from_str(new_value).ok();
        }
        "status" => {
            if let Ok(v) = serde_json::from_str::<NodeStatus>(new_value) {
                node.status = v;
            }
        }
        "geo" => {
            node.geo = serde_json::from_str(new_value).ok();
        }
        "group_id" => {
            node.group_id = serde_json::from_str(new_value).ok();
        }
        "metadata" => {
            if let Ok(v) = serde_json::from_str::<HashMap<String, String>>(new_value) {
                node.metadata = v;
            }
        }
        "position" => {
            node.position = serde_json::from_str(new_value).ok();
        }
        _ => {}
    }
}

fn apply_edge_field_change(edge: &mut TopologyEdge, field: &str, new_value: &str) {
    match field {
        "source_id" => {
            if let Ok(v) = serde_json::from_str::<String>(new_value) {
                edge.source_id = v;
            }
        }
        "target_id" => {
            if let Ok(v) = serde_json::from_str::<String>(new_value) {
                edge.target_id = v;
            }
        }
        "edge_type" => {
            if let Ok(v) = serde_json::from_str::<EdgeType>(new_value) {
                edge.edge_type = v;
            }
        }
        "label" => {
            edge.label = serde_json::from_str(new_value).ok();
        }
        "latency_ms" => {
            edge.latency_ms = serde_json::from_str(new_value).ok();
        }
        "bandwidth" => {
            edge.bandwidth = serde_json::from_str(new_value).ok();
        }
        "encrypted" => {
            if let Ok(v) = serde_json::from_str::<bool>(new_value) {
                edge.encrypted = v;
            }
        }
        "metadata" => {
            if let Ok(v) = serde_json::from_str::<HashMap<String, String>>(new_value) {
                edge.metadata = v;
            }
        }
        _ => {}
    }
}
