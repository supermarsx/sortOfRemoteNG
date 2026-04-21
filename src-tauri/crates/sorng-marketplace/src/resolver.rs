//! Dependency resolution, compatibility checks, and conflict detection.

use std::collections::{HashMap, HashSet, VecDeque};

use crate::error::MarketplaceError;
use crate::types::*;

/// Resolve all (transitive) dependencies of `listing` via topological sort.
///
/// Returns an ordered `Vec<String>` of extension IDs that must be
/// installed **before** `listing` itself (the listing's own ID is **not**
/// included in the result).
pub fn resolve_dependencies(
    listing: &MarketplaceListing,
    available: &HashMap<String, MarketplaceListing>,
) -> Result<Vec<String>, MarketplaceError> {
    // Adjacency: extension_id → Vec<dependency extension_ids>
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<String> = VecDeque::new();

    // Seed with the target listing's direct dependencies.
    for dep in &listing.dependencies {
        if dep.optional {
            continue;
        }
        queue.push_back(dep.extension_id.clone());
        adj.entry(listing.id.clone())
            .or_default()
            .push(dep.extension_id.clone());
    }
    visited.insert(listing.id.clone());

    // BFS to discover transitive deps.
    while let Some(ext_id) = queue.pop_front() {
        if visited.contains(&ext_id) {
            continue;
        }
        visited.insert(ext_id.clone());

        if let Some(dep_listing) = available.get(&ext_id) {
            for dep in &dep_listing.dependencies {
                if dep.optional {
                    continue;
                }
                adj.entry(ext_id.clone())
                    .or_default()
                    .push(dep.extension_id.clone());
                queue.push_back(dep.extension_id.clone());
            }
        } else {
            return Err(MarketplaceError::DependencyError(format!(
                "required dependency '{ext_id}' not found in available listings"
            )));
        }
    }

    // Topological sort using Kahn's algorithm.
    // in-degree map
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    for id in visited.iter() {
        in_degree.entry(id.clone()).or_insert(0);
        if let Some(deps) = adj.get(id) {
            for d in deps {
                *in_degree.entry(d.clone()).or_insert(0) += 1;
            }
        }
    }

    let mut topo_queue: VecDeque<String> = VecDeque::new();
    for (id, &deg) in &in_degree {
        if deg == 0 {
            topo_queue.push_back(id.clone());
        }
    }

    let mut order: Vec<String> = Vec::new();
    while let Some(id) = topo_queue.pop_front() {
        order.push(id.clone());
        if let Some(deps) = adj.get(&id) {
            for d in deps {
                if let Some(deg) = in_degree.get_mut(d) {
                    *deg = deg.saturating_sub(1);
                    if *deg == 0 {
                        topo_queue.push_back(d.clone());
                    }
                }
            }
        }
    }

    // If not all nodes were emitted we have a cycle.
    if order.len() != in_degree.len() {
        return Err(MarketplaceError::CircularDependency(format!(
            "cycle detected while resolving dependencies for '{}'",
            listing.id
        )));
    }

    // Reverse so that leaves (no-deps) come first; remove the listing itself.
    order.reverse();
    order.retain(|id| id != &listing.id);

    Ok(order)
}

/// Check whether `listing` declares itself compatible with `app_version`.
///
/// If the listing's `compatible_versions` is empty, it is assumed
/// universally compatible. Otherwise, `app_version` must start with
/// one of the listed prefixes (e.g. `"2"` matches `"2.9.5"`).
pub fn check_compatibility(listing: &MarketplaceListing, app_version: &str) -> bool {
    if listing.compatible_versions.is_empty() {
        return true;
    }
    listing
        .compatible_versions
        .iter()
        .any(|v| app_version.starts_with(v.as_str()))
}

/// Detect conflicts between extensions that are about to be installed
/// and those already installed.
///
/// Returns a list of human-readable conflict descriptions. An empty
/// vector means no conflicts.
pub fn check_conflicts(
    to_install: &[String],
    installed: &HashMap<String, InstalledExtension>,
) -> Vec<String> {
    let mut conflicts = Vec::new();

    for id in to_install {
        if let Some(existing) = installed.get(id) {
            conflicts.push(format!(
                "Extension '{}' is already installed (version {})",
                id, existing.version,
            ));
        }
    }

    // Check for duplicate IDs within the batch itself.
    let mut seen: HashSet<&String> = HashSet::new();
    for id in to_install {
        if !seen.insert(id) {
            conflicts.push(format!(
                "Extension '{id}' appears multiple times in the install list"
            ));
        }
    }

    conflicts
}
