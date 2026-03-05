// ─── Topology service ────────────────────────────────────────────────────────

use crate::analysis;
use crate::builder::{self, ConnectionData};
use crate::diff;
use crate::error::TopologyError;
use crate::layout;
use crate::types::*;
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Tauri-compatible shared state type.
pub type TopologyServiceState = Arc<Mutex<TopologyService>>;

/// Top-level topology service managing the graph, snapshots, and layout config.
pub struct TopologyService {
    pub graph: TopologyGraph,
    pub snapshots: Vec<TopologySnapshot>,
    pub config: LayoutConfig,
}

impl TopologyService {
    /// Create a new empty topology service with default config.
    pub fn new() -> Self {
        Self {
            graph: TopologyGraph::new(),
            snapshots: Vec::new(),
            config: LayoutConfig::default(),
        }
    }

    // ━━━━━━━━━━━━━━━ Build ━━━━━━━━━━━━━━━

    /// Build the topology graph from connection data, replacing the current graph.
    pub fn build_from_connections(&mut self, connections: &[ConnectionData]) {
        self.graph = builder::build_from_connections(connections);
        self.graph.layout_config = self.config.clone();
    }

    // ━━━━━━━━━━━━━━━ Graph read ━━━━━━━━━━━━━━━

    pub fn get_graph(&self) -> &TopologyGraph {
        &self.graph
    }

    // ━━━━━━━━━━━━━━━ Node CRUD ━━━━━━━━━━━━━━━

    pub fn add_node(&mut self, node: TopologyNode) -> Result<(), TopologyError> {
        self.graph.add_node(node)
    }

    pub fn remove_node(&mut self, id: &str) -> Result<(), TopologyError> {
        self.graph.remove_node(id)
    }

    pub fn update_node(
        &mut self,
        id: &str,
        updates: serde_json::Value,
    ) -> Result<(), TopologyError> {
        self.graph.update_node(id, updates)
    }

    // ━━━━━━━━━━━━━━━ Edge CRUD ━━━━━━━━━━━━━━━

    pub fn add_edge(&mut self, edge: TopologyEdge) -> Result<(), TopologyError> {
        self.graph.add_edge(edge)
    }

    pub fn remove_edge(&mut self, id: &str) -> Result<(), TopologyError> {
        self.graph.remove_edge(id)
    }

    // ━━━━━━━━━━━━━━━ Layout ━━━━━━━━━━━━━━━

    pub fn set_layout_config(&mut self, config: LayoutConfig) {
        self.config = config.clone();
        self.graph.layout_config = config;
    }

    pub fn apply_layout(&mut self) -> Result<(), TopologyError> {
        layout::apply_layout(&mut self.graph)
    }

    // ━━━━━━━━━━━━━━━ Analysis ━━━━━━━━━━━━━━━

    pub fn blast_radius(&self, node_id: &str) -> Result<BlastRadius, TopologyError> {
        analysis::calculate_blast_radius(&self.graph, node_id)
    }

    pub fn bottlenecks(&self) -> Vec<String> {
        analysis::find_bottlenecks(&self.graph)
    }

    pub fn critical_edges(&self) -> Vec<String> {
        analysis::find_critical_edges(&self.graph)
    }

    pub fn get_path(&self, from: &str, to: &str) -> Option<Vec<String>> {
        self.graph.get_path(from, to)
    }

    pub fn get_neighbors(&self, id: &str) -> Vec<String> {
        self.graph
            .get_neighbors(id)
            .into_iter()
            .map(|n| n.id.clone())
            .collect()
    }

    pub fn get_connected_components(&self) -> Vec<Vec<String>> {
        self.graph.get_connected_components()
    }

    pub fn get_stats(&self) -> TopologyStats {
        self.graph.get_stats()
    }

    // ━━━━━━━━━━━━━━━ Groups ━━━━━━━━━━━━━━━

    pub fn add_group(&mut self, group: NodeGroup) -> Result<(), TopologyError> {
        if self.graph.groups.iter().any(|g| g.id == group.id) {
            // Overwrite existing group with the same id.
            self.graph.groups.retain(|g| g.id != group.id);
        }
        self.graph.groups.push(group);
        Ok(())
    }

    pub fn remove_group(&mut self, id: &str) -> Result<(), TopologyError> {
        let before = self.graph.groups.len();
        self.graph.groups.retain(|g| g.id != id);
        if self.graph.groups.len() == before {
            return Err(TopologyError::GroupNotFound(id.to_string()));
        }
        // Also clear group_id on nodes that referenced this group.
        for node in self.graph.nodes.values_mut() {
            if node.group_id.as_deref() == Some(id) {
                node.group_id = None;
            }
        }
        Ok(())
    }

    // ━━━━━━━━━━━━━━━ Snapshots ━━━━━━━━━━━━━━━

    pub fn create_snapshot(&mut self, label: Option<String>) -> TopologySnapshot {
        let snapshot = TopologySnapshot {
            id: Uuid::new_v4().to_string(),
            graph: self.graph.clone(),
            created_at: Utc::now(),
            label,
        };
        self.snapshots.push(snapshot.clone());
        snapshot
    }

    pub fn list_snapshots(&self) -> Vec<TopologySnapshot> {
        self.snapshots.clone()
    }

    pub fn restore_snapshot(&mut self, snapshot_id: &str) -> Result<(), TopologyError> {
        let snapshot = self
            .snapshots
            .iter()
            .find(|s| s.id == snapshot_id)
            .ok_or_else(|| TopologyError::SnapshotNotFound(snapshot_id.to_string()))?
            .clone();
        self.graph = snapshot.graph;
        Ok(())
    }

    pub fn get_diff(
        &self,
        snapshot_a_id: &str,
        snapshot_b_id: &str,
    ) -> Result<TopologyDiff, TopologyError> {
        let a = self
            .snapshots
            .iter()
            .find(|s| s.id == snapshot_a_id)
            .ok_or_else(|| TopologyError::SnapshotNotFound(snapshot_a_id.to_string()))?;
        let b = self
            .snapshots
            .iter()
            .find(|s| s.id == snapshot_b_id)
            .ok_or_else(|| TopologyError::SnapshotNotFound(snapshot_b_id.to_string()))?;
        Ok(diff::compute_diff(&a.graph, &b.graph))
    }
}

impl Default for TopologyService {
    fn default() -> Self {
        Self::new()
    }
}
