// ── sorng-docker-compose/src/graph.rs ──────────────────────────────────────────
//! Dependency graph resolution for compose services using topological sort
//! with cycle detection.

use petgraph::algo::toposort;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use std::collections::HashMap;

use crate::error::{ComposeError, ComposeResult};
use crate::types::*;

/// Builds and analyses service dependency graphs.
pub struct DependencyResolver;

impl DependencyResolver {
    /// Build a dependency graph from a parsed compose file.
    pub fn build_graph(compose: &ComposeFile) -> ComposeResult<DependencyGraph> {
        let mut graph = DiGraph::<String, Option<String>>::new();
        let mut node_map: HashMap<String, NodeIndex> = HashMap::new();

        // Add all services as nodes.
        for name in compose.services.keys() {
            let idx = graph.add_node(name.clone());
            node_map.insert(name.clone(), idx);
        }

        let mut edges = Vec::new();

        // Add dependency edges.
        for (name, svc) in &compose.services {
            if let Some(ref deps) = svc.depends_on {
                let from_idx = node_map[name];
                match deps {
                    DependsOn::List(list) => {
                        for dep in list {
                            if let Some(&to_idx) = node_map.get(dep) {
                                graph.add_edge(from_idx, to_idx, None);
                                edges.push(DependencyEdge {
                                    from: name.clone(),
                                    to: dep.clone(),
                                    condition: None,
                                });
                            }
                        }
                    }
                    DependsOn::Map(map) => {
                        for (dep, cond) in map {
                            if let Some(&to_idx) = node_map.get(dep) {
                                let condition = cond.condition.clone();
                                graph.add_edge(from_idx, to_idx, condition.clone());
                                edges.push(DependencyEdge {
                                    from: name.clone(),
                                    to: dep.clone(),
                                    condition,
                                });
                            }
                        }
                    }
                }
            }

            // Also consider `links` as implicit dependencies.
            for link in &svc.links {
                let dep = link.split(':').next().unwrap_or(link);
                if let Some(&to_idx) = node_map.get(dep) {
                    let from_idx = node_map[name];
                    if !graph.edges(from_idx).any(|e| e.target() == to_idx) {
                        graph.add_edge(from_idx, to_idx, None);
                        edges.push(DependencyEdge {
                            from: name.clone(),
                            to: dep.to_string(),
                            condition: None,
                        });
                    }
                }
            }
        }

        // Topological sort (reversed gives startup order: dependencies first).
        match toposort(&graph, None) {
            Ok(order) => {
                let startup_order: Vec<String> = order
                    .into_iter()
                    .rev()
                    .map(|idx| graph[idx].clone())
                    .collect();
                Ok(DependencyGraph {
                    services: compose.services.keys().cloned().collect(),
                    edges,
                    startup_order,
                    has_cycle: false,
                })
            }
            Err(_cycle) => {
                // There's a cycle — report it but still return the graph.
                Ok(DependencyGraph {
                    services: compose.services.keys().cloned().collect(),
                    edges,
                    startup_order: vec![],
                    has_cycle: true,
                })
            }
        }
    }

    /// Get the startup order for a subset of services (including transitive deps).
    pub fn startup_order_for(
        compose: &ComposeFile,
        target_services: &[String],
    ) -> ComposeResult<Vec<String>> {
        let full = Self::build_graph(compose)?;
        if full.has_cycle {
            return Err(ComposeError::cycle(
                "Cannot determine startup order: dependency cycle detected",
            ));
        }

        // Collect transitive dependencies.
        let mut needed: std::collections::HashSet<String> =
            target_services.iter().cloned().collect();
        let mut changed = true;
        while changed {
            changed = false;
            let current: Vec<String> = needed.iter().cloned().collect();
            for svc_name in &current {
                if let Some(svc) = compose.services.get(svc_name) {
                    let deps = Self::direct_deps(svc);
                    for dep in deps {
                        if needed.insert(dep) {
                            changed = true;
                        }
                    }
                }
            }
        }

        // Filter full startup order to only the needed services.
        Ok(full
            .startup_order
            .into_iter()
            .filter(|s| needed.contains(s))
            .collect())
    }

    /// Get the shutdown order (reverse of startup).
    pub fn shutdown_order(compose: &ComposeFile) -> ComposeResult<Vec<String>> {
        let graph = Self::build_graph(compose)?;
        if graph.has_cycle {
            return Err(ComposeError::cycle(
                "Cannot determine shutdown order: dependency cycle detected",
            ));
        }
        let mut order = graph.startup_order;
        order.reverse();
        Ok(order)
    }

    /// Get direct dependencies for a service.
    fn direct_deps(svc: &ServiceDefinition) -> Vec<String> {
        let mut deps = Vec::new();
        if let Some(ref dep) = svc.depends_on {
            match dep {
                DependsOn::List(list) => deps.extend(list.iter().cloned()),
                DependsOn::Map(map) => deps.extend(map.keys().cloned()),
            }
        }
        for link in &svc.links {
            let dep = link.split(':').next().unwrap_or(link);
            deps.push(dep.to_string());
        }
        deps
    }

    /// Get all services that directly or transitively depend on the given service.
    pub fn dependents(compose: &ComposeFile, service: &str) -> Vec<String> {
        let mut result = Vec::new();
        let mut visited = std::collections::HashSet::new();
        Self::collect_dependents(compose, service, &mut result, &mut visited);
        result
    }

    fn collect_dependents(
        compose: &ComposeFile,
        service: &str,
        result: &mut Vec<String>,
        visited: &mut std::collections::HashSet<String>,
    ) {
        for (name, svc) in &compose.services {
            if visited.contains(name) {
                continue;
            }
            let deps = Self::direct_deps(svc);
            if deps.iter().any(|d| d == service) {
                visited.insert(name.clone());
                result.push(name.clone());
                Self::collect_dependents(compose, name, result, visited);
            }
        }
    }
}
