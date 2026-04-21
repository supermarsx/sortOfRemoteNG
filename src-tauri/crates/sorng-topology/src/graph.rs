// ─── Core graph operations ───────────────────────────────────────────────────

use crate::error::TopologyError;
use crate::types::*;
use chrono::Utc;
use std::collections::{HashMap, HashSet, VecDeque};

type Result<T> = std::result::Result<T, TopologyError>;

impl TopologyGraph {
    /// Create an empty topology graph with default layout config.
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            edges: Vec::new(),
            groups: Vec::new(),
            layout_config: LayoutConfig::default(),
            last_updated: Utc::now(),
        }
    }

    // ━━━━━━━━━━━━━━━ Node operations ━━━━━━━━━━━━━━━

    /// Add a node to the graph. Overwrites if the id already exists.
    pub fn add_node(&mut self, node: TopologyNode) -> Result<()> {
        self.nodes.insert(node.id.clone(), node);
        self.last_updated = Utc::now();
        Ok(())
    }

    /// Remove a node and all edges connected to it.
    pub fn remove_node(&mut self, id: &str) -> Result<()> {
        if self.nodes.remove(id).is_none() {
            return Err(TopologyError::NodeNotFound(id.to_string()));
        }
        self.edges
            .retain(|e| e.source_id != id && e.target_id != id);
        // Also remove the node from any groups.
        for group in &mut self.groups {
            group.node_ids.retain(|nid| nid != id);
        }
        self.last_updated = Utc::now();
        Ok(())
    }

    /// Patch a node's fields from a JSON `Value` object.
    ///
    /// Supported fields: `label`, `hostname`, `ip_address`, `port`, `protocol`,
    /// `status`, `node_type`, `group_id`, and arbitrary `metadata` keys.
    pub fn update_node(&mut self, id: &str, updates: serde_json::Value) -> Result<()> {
        let node = self
            .nodes
            .get_mut(id)
            .ok_or_else(|| TopologyError::NodeNotFound(id.to_string()))?;

        if let Some(obj) = updates.as_object() {
            if let Some(v) = obj.get("label").and_then(|v| v.as_str()) {
                node.label = v.to_string();
            }
            if let Some(v) = obj.get("hostname") {
                node.hostname = v.as_str().map(|s| s.to_string());
            }
            if let Some(v) = obj.get("ip_address") {
                node.ip_address = v.as_str().map(|s| s.to_string());
            }
            if let Some(v) = obj.get("port") {
                node.port = v.as_u64().map(|p| p as u16);
            }
            if let Some(v) = obj.get("protocol") {
                node.protocol = v.as_str().map(|s| s.to_string());
            }
            if let Some(v) = obj.get("status") {
                if let Ok(status) = serde_json::from_value::<NodeStatus>(v.clone()) {
                    node.status = status;
                }
            }
            if let Some(v) = obj.get("node_type") {
                if let Ok(nt) = serde_json::from_value::<NodeType>(v.clone()) {
                    node.node_type = nt;
                }
            }
            if let Some(v) = obj.get("group_id") {
                node.group_id = v.as_str().map(|s| s.to_string());
            }
            if let Some(v) = obj.get("geo") {
                if let Ok(geo) = serde_json::from_value::<GeoLocation>(v.clone()) {
                    node.geo = Some(geo);
                }
            }
            if let Some(v) = obj.get("position") {
                if let Ok(pos) = serde_json::from_value::<Position>(v.clone()) {
                    node.position = Some(pos);
                }
            }
            if let Some(meta) = obj.get("metadata").and_then(|v| v.as_object()) {
                for (k, v) in meta {
                    if let Some(val) = v.as_str() {
                        node.metadata.insert(k.clone(), val.to_string());
                    }
                }
            }
        }
        self.last_updated = Utc::now();
        Ok(())
    }

    /// Return a reference to a node by id.
    pub fn get_node(&self, id: &str) -> Option<&TopologyNode> {
        self.nodes.get(id)
    }

    // ━━━━━━━━━━━━━━━ Edge operations ━━━━━━━━━━━━━━━

    /// Add an edge to the graph.
    pub fn add_edge(&mut self, edge: TopologyEdge) -> Result<()> {
        self.edges.push(edge);
        self.last_updated = Utc::now();
        Ok(())
    }

    /// Remove an edge by id.
    pub fn remove_edge(&mut self, id: &str) -> Result<()> {
        let before = self.edges.len();
        self.edges.retain(|e| e.id != id);
        if self.edges.len() == before {
            return Err(TopologyError::EdgeNotFound(id.to_string()));
        }
        self.last_updated = Utc::now();
        Ok(())
    }

    // ━━━━━━━━━━━━━━━ Neighbour / edge queries ━━━━━━━━━━━━━━━

    /// Get all directly connected nodes (ignoring edge direction).
    pub fn get_neighbors(&self, id: &str) -> Vec<&TopologyNode> {
        let mut neighbor_ids: HashSet<&str> = HashSet::new();
        for edge in &self.edges {
            if edge.source_id == id {
                neighbor_ids.insert(&edge.target_id);
            } else if edge.target_id == id {
                neighbor_ids.insert(&edge.source_id);
            }
        }
        neighbor_ids
            .into_iter()
            .filter_map(|nid| self.nodes.get(nid))
            .collect()
    }

    /// Get all edges where the given node is either source or target.
    pub fn get_edges_for_node(&self, id: &str) -> Vec<&TopologyEdge> {
        self.edges
            .iter()
            .filter(|e| e.source_id == id || e.target_id == id)
            .collect()
    }

    // ━━━━━━━━━━━━━━━ Path finding ━━━━━━━━━━━━━━━

    /// BFS shortest path returning a list of node ids (inclusive of both endpoints).
    /// Returns `None` if no path exists.
    pub fn get_path(&self, from: &str, to: &str) -> Option<Vec<String>> {
        if from == to {
            return Some(vec![from.to_string()]);
        }
        if !self.nodes.contains_key(from) || !self.nodes.contains_key(to) {
            return None;
        }

        let adj = self.undirected_adjacency();

        let mut visited: HashSet<String> = HashSet::new();
        let mut queue: VecDeque<Vec<String>> = VecDeque::new();
        visited.insert(from.to_string());
        queue.push_back(vec![from.to_string()]);

        while let Some(path) = queue.pop_front() {
            let current = path.last().expect("path always non-empty in BFS");
            if let Some(neighbors) = adj.get(current.as_str()) {
                for neighbor in neighbors {
                    if neighbor == to {
                        let mut result = path.clone();
                        result.push(neighbor.clone());
                        return Some(result);
                    }
                    if visited.insert(neighbor.clone()) {
                        let mut new_path = path.clone();
                        new_path.push(neighbor.clone());
                        queue.push_back(new_path);
                    }
                }
            }
        }
        None
    }

    /// DFS all simple paths between two nodes.
    pub fn get_all_paths(&self, from: &str, to: &str) -> Vec<Vec<String>> {
        let mut results: Vec<Vec<String>> = Vec::new();
        if !self.nodes.contains_key(from) || !self.nodes.contains_key(to) {
            return results;
        }

        let adj = self.undirected_adjacency();
        let mut visited: HashSet<String> = HashSet::new();
        visited.insert(from.to_string());

        Self::dfs_all_paths(
            &adj,
            from,
            to,
            &mut visited,
            &mut vec![from.to_string()],
            &mut results,
        );
        results
    }

    fn dfs_all_paths(
        adj: &HashMap<String, Vec<String>>,
        current: &str,
        target: &str,
        visited: &mut HashSet<String>,
        path: &mut Vec<String>,
        results: &mut Vec<Vec<String>>,
    ) {
        if current == target {
            results.push(path.clone());
            return;
        }
        if let Some(neighbors) = adj.get(current) {
            for neighbor in neighbors {
                if !visited.contains(neighbor.as_str()) {
                    visited.insert(neighbor.clone());
                    path.push(neighbor.clone());
                    Self::dfs_all_paths(adj, neighbor, target, visited, path, results);
                    path.pop();
                    visited.remove(neighbor.as_str());
                }
            }
        }
    }

    // ━━━━━━━━━━━━━━━ Components / cycles ━━━━━━━━━━━━━━━

    /// Find all connected components (undirected). Each component is a sorted
    /// list of node ids.
    pub fn get_connected_components(&self) -> Vec<Vec<String>> {
        let adj = self.undirected_adjacency();
        let mut visited: HashSet<String> = HashSet::new();
        let mut components: Vec<Vec<String>> = Vec::new();

        for node_id in self.nodes.keys() {
            if !visited.contains(node_id) {
                let mut component: Vec<String> = Vec::new();
                let mut queue: VecDeque<String> = VecDeque::new();
                queue.push_back(node_id.clone());
                visited.insert(node_id.clone());

                while let Some(current) = queue.pop_front() {
                    component.push(current.clone());
                    if let Some(neighbors) = adj.get(&current) {
                        for neighbor in neighbors {
                            if visited.insert(neighbor.clone()) {
                                queue.push_back(neighbor.clone());
                            }
                        }
                    }
                }
                component.sort();
                components.push(component);
            }
        }
        components.sort_by_key(|b| std::cmp::Reverse(b.len()));
        components
    }

    /// Detect whether the directed graph contains a cycle.
    pub fn has_cycle(&self) -> bool {
        let directed_adj = self.directed_adjacency();
        let mut white: HashSet<String> = self.nodes.keys().cloned().collect();
        let mut gray: HashSet<String> = HashSet::new();

        while let Some(start) = white.iter().next().cloned() {
            if Self::dfs_cycle(&directed_adj, &start, &mut white, &mut gray) {
                return true;
            }
        }
        false
    }

    fn dfs_cycle(
        adj: &HashMap<String, Vec<String>>,
        node: &str,
        white: &mut HashSet<String>,
        gray: &mut HashSet<String>,
    ) -> bool {
        white.remove(node);
        gray.insert(node.to_string());

        if let Some(neighbors) = adj.get(node) {
            for neighbor in neighbors {
                if gray.contains(neighbor.as_str()) {
                    return true;
                }
                if white.contains(neighbor.as_str()) && Self::dfs_cycle(adj, neighbor, white, gray)
                {
                    return true;
                }
            }
        }
        gray.remove(node);
        // mark as black implicitly — not needed in set
        false
    }

    /// Return all nodes with no connected edges.
    pub fn get_isolated_nodes(&self) -> Vec<&TopologyNode> {
        let connected: HashSet<&str> = self
            .edges
            .iter()
            .flat_map(|e| vec![e.source_id.as_str(), e.target_id.as_str()])
            .collect();

        self.nodes
            .values()
            .filter(|n| !connected.contains(n.id.as_str()))
            .collect()
    }

    // ━━━━━━━━━━━━━━━ Merge ━━━━━━━━━━━━━━━

    /// Merge nodes and edges from another graph into this one.
    /// Existing nodes with the same id are overwritten.
    pub fn merge_graph(&mut self, other: &TopologyGraph) {
        for (id, node) in &other.nodes {
            self.nodes.insert(id.clone(), node.clone());
        }
        let existing_edge_ids: HashSet<String> = self.edges.iter().map(|e| e.id.clone()).collect();
        for edge in &other.edges {
            if !existing_edge_ids.contains(&edge.id) {
                self.edges.push(edge.clone());
            }
        }
        let existing_group_ids: HashSet<String> =
            self.groups.iter().map(|g| g.id.clone()).collect();
        for group in &other.groups {
            if !existing_group_ids.contains(&group.id) {
                self.groups.push(group.clone());
            }
        }
        self.last_updated = Utc::now();
    }

    // ━━━━━━━━━━━━━━━ Statistics ━━━━━━━━━━━━━━━

    /// Compute summary statistics about the graph.
    pub fn get_stats(&self) -> TopologyStats {
        let mut by_node_type: HashMap<String, usize> = HashMap::new();
        let mut by_status: HashMap<String, usize> = HashMap::new();

        for node in self.nodes.values() {
            *by_node_type.entry(node.node_type.to_string()).or_insert(0) += 1;
            let status_key = serde_json::to_string(&node.status).unwrap_or_default();
            let status_key = status_key.trim_matches('"').to_string();
            *by_status.entry(status_key).or_insert(0) += 1;
        }

        let latencies: Vec<f64> = self.edges.iter().filter_map(|e| e.latency_ms).collect();
        let avg_latency_ms = if latencies.is_empty() {
            0.0
        } else {
            latencies.iter().sum::<f64>() / latencies.len() as f64
        };

        let isolated_nodes_count = self.get_isolated_nodes().len();

        TopologyStats {
            total_nodes: self.nodes.len(),
            total_edges: self.edges.len(),
            by_node_type,
            by_status,
            avg_latency_ms,
            isolated_nodes_count,
        }
    }

    /// Build an undirected adjacency list from the edges.
    pub fn to_adjacency_list(&self) -> HashMap<String, Vec<String>> {
        self.undirected_adjacency()
    }

    // ━━━━━━━━━━━━━━━ Internal helpers ━━━━━━━━━━━━━━━

    /// Build an undirected adjacency list.
    fn undirected_adjacency(&self) -> HashMap<String, Vec<String>> {
        let mut adj: HashMap<String, Vec<String>> = HashMap::new();
        for node_id in self.nodes.keys() {
            adj.entry(node_id.clone()).or_default();
        }
        for edge in &self.edges {
            adj.entry(edge.source_id.clone())
                .or_default()
                .push(edge.target_id.clone());
            adj.entry(edge.target_id.clone())
                .or_default()
                .push(edge.source_id.clone());
        }
        adj
    }

    /// Build a directed adjacency list (source → target).
    fn directed_adjacency(&self) -> HashMap<String, Vec<String>> {
        let mut adj: HashMap<String, Vec<String>> = HashMap::new();
        for node_id in self.nodes.keys() {
            adj.entry(node_id.clone()).or_default();
        }
        for edge in &self.edges {
            adj.entry(edge.source_id.clone())
                .or_default()
                .push(edge.target_id.clone());
        }
        adj
    }
}

impl Default for TopologyGraph {
    fn default() -> Self {
        Self::new()
    }
}
