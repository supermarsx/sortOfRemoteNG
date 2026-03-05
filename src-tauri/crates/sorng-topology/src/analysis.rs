// ─── Topology analysis ───────────────────────────────────────────────────────

use crate::error::TopologyError;
use crate::types::*;
use std::collections::{HashMap, HashSet, VecDeque};

type Result<T> = std::result::Result<T, TopologyError>;

// ═══════════════════════════════════════════════════════════════════════════════
// Blast radius
// ═══════════════════════════════════════════════════════════════════════════════

/// Calculate which nodes become unreachable if `node_id` is removed.
///
/// Strategy: enumerate connected components *without* the target node and
/// compare to the component the target node belonged to. Nodes that are no
/// longer reachable from the largest remaining sub-component are "affected".
pub fn calculate_blast_radius(
    graph: &TopologyGraph,
    node_id: &str,
) -> Result<BlastRadius> {
    if !graph.nodes.contains_key(node_id) {
        return Err(TopologyError::NodeNotFound(node_id.to_string()));
    }

    // Build undirected adjacency excluding the target node.
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for id in graph.nodes.keys() {
        if id != node_id {
            adj.entry(id.as_str()).or_default();
        }
    }
    for edge in &graph.edges {
        if edge.source_id == node_id || edge.target_id == node_id {
            continue;
        }
        let s = edge.source_id.as_str();
        let t = edge.target_id.as_str();
        if adj.contains_key(s) && adj.contains_key(t) {
            adj.entry(s).or_default().push(t);
            adj.entry(t).or_default().push(s);
        }
    }

    // Find original component that contained the node.
    let original_component: HashSet<String> = {
        let full_adj = graph.to_adjacency_list();
        let mut visited: HashSet<String> = HashSet::new();
        let mut queue: VecDeque<String> = VecDeque::new();
        queue.push_back(node_id.to_string());
        visited.insert(node_id.to_string());
        while let Some(current) = queue.pop_front() {
            if let Some(neighbors) = full_adj.get(&current) {
                for neighbor in neighbors {
                    if visited.insert(neighbor.clone()) {
                        queue.push_back(neighbor.clone());
                    }
                }
            }
        }
        visited
    };

    // BFS from every node in the original component (minus the removed node)
    // to find how many sub-components remain.
    let mut visited_global: HashSet<&str> = HashSet::new();
    let mut components: Vec<HashSet<&str>> = Vec::new();

    for id in original_component.iter() {
        if id == node_id {
            continue;
        }
        let id_str = id.as_str();
        if visited_global.contains(id_str) {
            continue;
        }
        // Ensure node exists in adj (it should unless it was removed from the graph)
        if !adj.contains_key(id_str) {
            continue;
        }
        let mut comp: HashSet<&str> = HashSet::new();
        let mut queue: VecDeque<&str> = VecDeque::new();
        queue.push_back(id_str);
        comp.insert(id_str);
        visited_global.insert(id_str);
        while let Some(current) = queue.pop_front() {
            if let Some(neighbors) = adj.get(current) {
                for &nbr in neighbors {
                    if comp.insert(nbr) {
                        visited_global.insert(nbr);
                        queue.push_back(nbr);
                    }
                }
            }
        }
        components.push(comp);
    }

    // The largest remaining sub-component is the "surviving" set; everything
    // else becomes unreachable.
    components.sort_by(|a, b| b.len().cmp(&a.len()));
    let surviving: HashSet<&str> = components.first().cloned().unwrap_or_default();

    let affected_node_ids: Vec<String> = original_component
        .iter()
        .filter(|id| id.as_str() != node_id && !surviving.contains(id.as_str()))
        .cloned()
        .collect();

    let affected_edge_ids: Vec<String> = graph
        .edges
        .iter()
        .filter(|e| {
            affected_node_ids.contains(&e.source_id)
                || affected_node_ids.contains(&e.target_id)
                || e.source_id == node_id
                || e.target_id == node_id
        })
        .map(|e| e.id.clone())
        .collect();

    let total = graph.nodes.len();
    let affected_count = affected_node_ids.len() + 1; // +1 for the removed node itself
    let severity = if affected_count == 0 {
        "none".to_string()
    } else if affected_count <= total / 10 {
        "low".to_string()
    } else if affected_count <= total / 3 {
        "medium".to_string()
    } else if affected_count <= total * 2 / 3 {
        "high".to_string()
    } else {
        "critical".to_string()
    };

    let description = format!(
        "Removing node '{}' would affect {} node(s) and {} edge(s)",
        node_id,
        affected_node_ids.len(),
        affected_edge_ids.len()
    );

    Ok(BlastRadius {
        affected_node_ids,
        affected_edge_ids,
        severity,
        description,
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bottleneck / articulation-point detection
// ═══════════════════════════════════════════════════════════════════════════════

/// Find articulation points — nodes whose removal disconnects the graph.
///
/// Uses Tarjan's DFS-based algorithm.
pub fn find_bottlenecks(graph: &TopologyGraph) -> Vec<String> {
    let node_ids: Vec<String> = graph.nodes.keys().cloned().collect();
    let n = node_ids.len();
    if n == 0 {
        return Vec::new();
    }

    let id_to_idx: HashMap<&str, usize> = node_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();

    let adj = graph.to_adjacency_list();

    let mut disc: Vec<i32> = vec![-1; n];
    let mut low: Vec<i32> = vec![-1; n];
    let mut parent: Vec<i32> = vec![-1; n];
    let mut ap: Vec<bool> = vec![false; n];
    let mut timer: i32 = 0;

    fn dfs(
        u: usize,
        adj: &HashMap<String, Vec<String>>,
        node_ids: &[String],
        id_to_idx: &HashMap<&str, usize>,
        disc: &mut Vec<i32>,
        low: &mut Vec<i32>,
        parent: &mut Vec<i32>,
        ap: &mut Vec<bool>,
        timer: &mut i32,
    ) {
        disc[u] = *timer;
        low[u] = *timer;
        *timer += 1;
        let mut children = 0;

        let neighbors = adj.get(&node_ids[u]).cloned().unwrap_or_default();
        for nbr_id in &neighbors {
            if let Some(&v) = id_to_idx.get(nbr_id.as_str()) {
                if disc[v] == -1 {
                    children += 1;
                    parent[v] = u as i32;
                    dfs(v, adj, node_ids, id_to_idx, disc, low, parent, ap, timer);
                    low[u] = low[u].min(low[v]);

                    // u is an articulation point if:
                    // 1. u is root and has ≥ 2 children
                    if parent[u] == -1 && children > 1 {
                        ap[u] = true;
                    }
                    // 2. u is not root and low[v] >= disc[u]
                    if parent[u] != -1 && low[v] >= disc[u] {
                        ap[u] = true;
                    }
                } else if v as i32 != parent[u] {
                    low[u] = low[u].min(disc[v]);
                }
            }
        }
    }

    for i in 0..n {
        if disc[i] == -1 {
            dfs(
                i,
                &adj,
                &node_ids,
                &id_to_idx,
                &mut disc,
                &mut low,
                &mut parent,
                &mut ap,
                &mut timer,
            );
        }
    }

    node_ids
        .iter()
        .enumerate()
        .filter(|(i, _)| ap[*i])
        .map(|(_, id)| id.clone())
        .collect()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bridge detection
// ═══════════════════════════════════════════════════════════════════════════════

/// Find bridge edges — edges whose removal disconnects the graph.
pub fn find_critical_edges(graph: &TopologyGraph) -> Vec<String> {
    let node_ids: Vec<String> = graph.nodes.keys().cloned().collect();
    let n = node_ids.len();
    if n == 0 {
        return Vec::new();
    }

    let id_to_idx: HashMap<&str, usize> = node_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();

    let adj = graph.to_adjacency_list();

    let mut disc: Vec<i32> = vec![-1; n];
    let mut low: Vec<i32> = vec![-1; n];
    let mut parent: Vec<i32> = vec![-1; n];
    let mut bridges: Vec<(usize, usize)> = Vec::new();
    let mut timer: i32 = 0;

    fn dfs_bridge(
        u: usize,
        adj: &HashMap<String, Vec<String>>,
        node_ids: &[String],
        id_to_idx: &HashMap<&str, usize>,
        disc: &mut Vec<i32>,
        low: &mut Vec<i32>,
        parent: &mut Vec<i32>,
        bridges: &mut Vec<(usize, usize)>,
        timer: &mut i32,
    ) {
        disc[u] = *timer;
        low[u] = *timer;
        *timer += 1;

        let neighbors = adj.get(&node_ids[u]).cloned().unwrap_or_default();
        for nbr_id in &neighbors {
            if let Some(&v) = id_to_idx.get(nbr_id.as_str()) {
                if disc[v] == -1 {
                    parent[v] = u as i32;
                    dfs_bridge(v, adj, node_ids, id_to_idx, disc, low, parent, bridges, timer);
                    low[u] = low[u].min(low[v]);

                    if low[v] > disc[u] {
                        bridges.push((u, v));
                    }
                } else if v as i32 != parent[u] {
                    low[u] = low[u].min(disc[v]);
                }
            }
        }
    }

    for i in 0..n {
        if disc[i] == -1 {
            dfs_bridge(
                i,
                &adj,
                &node_ids,
                &id_to_idx,
                &mut disc,
                &mut low,
                &mut parent,
                &mut bridges,
                &mut timer,
            );
        }
    }

    // Map node-index pairs back to edge ids.
    let mut result: Vec<String> = Vec::new();
    for (u, v) in bridges {
        let uid = &node_ids[u];
        let vid = &node_ids[v];
        for edge in &graph.edges {
            if (edge.source_id == *uid && edge.target_id == *vid)
                || (edge.source_id == *vid && edge.target_id == *uid)
            {
                result.push(edge.id.clone());
            }
        }
    }
    result
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dependency depth & tree
// ═══════════════════════════════════════════════════════════════════════════════

/// Longest directed path from `node_id` to any leaf.
pub fn calculate_dependency_depth(graph: &TopologyGraph, node_id: &str) -> Result<usize> {
    if !graph.nodes.contains_key(node_id) {
        return Err(TopologyError::NodeNotFound(node_id.to_string()));
    }
    let directed: HashMap<String, Vec<String>> = {
        let mut m: HashMap<String, Vec<String>> = HashMap::new();
        for id in graph.nodes.keys() {
            m.entry(id.clone()).or_default();
        }
        for edge in &graph.edges {
            m.entry(edge.source_id.clone())
                .or_default()
                .push(edge.target_id.clone());
        }
        m
    };

    fn depth(
        node: &str,
        directed: &HashMap<String, Vec<String>>,
        memo: &mut HashMap<String, usize>,
        visiting: &mut HashSet<String>,
    ) -> usize {
        if let Some(&d) = memo.get(node) {
            return d;
        }
        if !visiting.insert(node.to_string()) {
            // cycle — stop
            return 0;
        }
        let children = directed.get(node).cloned().unwrap_or_default();
        let d = if children.is_empty() {
            0
        } else {
            children
                .iter()
                .map(|c| 1 + depth(c, directed, memo, visiting))
                .max()
                .unwrap_or(0)
        };
        visiting.remove(node);
        memo.insert(node.to_string(), d);
        d
    }

    let mut memo: HashMap<String, usize> = HashMap::new();
    let mut visiting: HashSet<String> = HashSet::new();
    Ok(depth(node_id, &directed, &mut memo, &mut visiting))
}

/// Build a JSON tree of dependencies rooted at `node_id`.
///
/// ```json
/// { "id": "A", "label": "...", "children": [ { "id": "B", ... }, ... ] }
/// ```
pub fn get_dependency_tree(
    graph: &TopologyGraph,
    node_id: &str,
) -> Result<serde_json::Value> {
    if !graph.nodes.contains_key(node_id) {
        return Err(TopologyError::NodeNotFound(node_id.to_string()));
    }

    let directed: HashMap<String, Vec<String>> = {
        let mut m: HashMap<String, Vec<String>> = HashMap::new();
        for id in graph.nodes.keys() {
            m.entry(id.clone()).or_default();
        }
        for edge in &graph.edges {
            m.entry(edge.source_id.clone())
                .or_default()
                .push(edge.target_id.clone());
        }
        m
    };

    fn build_tree(
        node_id: &str,
        graph: &TopologyGraph,
        directed: &HashMap<String, Vec<String>>,
        visited: &mut HashSet<String>,
    ) -> serde_json::Value {
        visited.insert(node_id.to_string());
        let label = graph
            .nodes
            .get(node_id)
            .map(|n| n.label.clone())
            .unwrap_or_default();
        let children: Vec<serde_json::Value> = {
            let child_ids: Vec<String> = directed
                .get(node_id)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|c| !visited.contains(c.as_str()))
                .collect();
            child_ids
                .iter()
                .map(|c| build_tree(c, graph, directed, visited))
                .collect()
        };
        visited.remove(node_id);

        serde_json::json!({
            "id": node_id,
            "label": label,
            "children": children,
        })
    }

    let mut visited: HashSet<String> = HashSet::new();
    Ok(build_tree(node_id, graph, &directed, &mut visited))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Redundancy detection
// ═══════════════════════════════════════════════════════════════════════════════

/// Find pairs of nodes that have multiple distinct paths between them.
///
/// Returns `(node_a, node_b, paths)` triples. Only considers nodes with
/// edges (not isolated).
pub fn detect_redundancy(
    graph: &TopologyGraph,
) -> Vec<(String, String, Vec<Vec<String>>)> {
    let mut result: Vec<(String, String, Vec<Vec<String>>)> = Vec::new();

    // Only check pairs that share at least one edge.
    let mut pairs_checked: HashSet<(String, String)> = HashSet::new();

    for edge in &graph.edges {
        let a = edge.source_id.clone();
        let b = edge.target_id.clone();
        let key = if a < b {
            (a.clone(), b.clone())
        } else {
            (b.clone(), a.clone())
        };
        if !pairs_checked.insert(key.clone()) {
            continue;
        }

        let paths = graph.get_all_paths(&key.0, &key.1);
        if paths.len() > 1 {
            result.push((key.0, key.1, paths));
        }
    }
    result
}
