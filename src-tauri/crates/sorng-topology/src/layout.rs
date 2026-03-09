// ─── Auto-layout algorithms ──────────────────────────────────────────────────

use crate::error::TopologyError;
use crate::types::*;

type Result<T> = std::result::Result<T, TopologyError>;

/// Apply the configured layout algorithm to the graph, updating node positions.
pub fn apply_layout(graph: &mut TopologyGraph) -> Result<()> {
    let config = graph.layout_config.clone();
    match config.algorithm {
        LayoutAlgorithm::ForceDirected => force_directed_layout(graph, &config),
        LayoutAlgorithm::Hierarchical => hierarchical_layout(graph, &config),
        LayoutAlgorithm::Circular => circular_layout(graph, &config),
        LayoutAlgorithm::Grid => grid_layout(graph, &config),
        LayoutAlgorithm::Geographic => geographic_layout(graph, &config),
        LayoutAlgorithm::Manual => Ok(()), // do nothing — positions are user-managed
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Force-directed layout (Fruchterman–Reingold)
// ═══════════════════════════════════════════════════════════════════════════════

/// Fruchterman–Reingold force-directed placement.
///
/// 1. Repulsive forces between every pair of nodes (∝ k² / d)
/// 2. Attractive forces along edges (∝ d² / k)
/// 3. Cooling schedule that linearly decreases step size to zero
pub fn force_directed_layout(graph: &mut TopologyGraph, config: &LayoutConfig) -> Result<()> {
    let node_ids: Vec<String> = graph.nodes.keys().cloned().collect();
    let n = node_ids.len();
    if n == 0 {
        return Ok(());
    }

    let area = (config.width - 2.0 * config.padding) * (config.height - 2.0 * config.padding);
    let k = (area / n as f64).sqrt(); // ideal spring length
    let iterations = config.iterations.max(1);

    // Index mapping for fast positional lookup.
    let id_to_idx: std::collections::HashMap<&str, usize> = node_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();

    // Initialise positions — use existing position or spread on a circle.
    let cx = config.width / 2.0;
    let cy = config.height / 2.0;
    let mut pos: Vec<(f64, f64)> = node_ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            if let Some(p) = graph.nodes.get(id).and_then(|n| n.position) {
                (p.x, p.y)
            } else {
                let angle = 2.0 * std::f64::consts::PI * i as f64 / n as f64;
                let r = k * 2.0;
                (cx + r * angle.cos(), cy + r * angle.sin())
            }
        })
        .collect();

    // Build edge index pairs.
    let edge_pairs: Vec<(usize, usize)> = graph
        .edges
        .iter()
        .filter_map(|e| {
            let si = id_to_idx.get(e.source_id.as_str())?;
            let ti = id_to_idx.get(e.target_id.as_str())?;
            Some((*si, *ti))
        })
        .collect();

    let mut temperature = config.width / 10.0;
    let cooling = temperature / iterations as f64;

    for _ in 0..iterations {
        let mut disp: Vec<(f64, f64)> = vec![(0.0, 0.0); n];

        // Repulsive forces between every pair.
        for i in 0..n {
            for j in (i + 1)..n {
                let dx = pos[i].0 - pos[j].0;
                let dy = pos[i].1 - pos[j].1;
                let dist = (dx * dx + dy * dy).sqrt().max(0.01);
                let force = k * k / dist;
                let fx = dx / dist * force;
                let fy = dy / dist * force;
                disp[i].0 += fx;
                disp[i].1 += fy;
                disp[j].0 -= fx;
                disp[j].1 -= fy;
            }
        }

        // Attractive forces along edges.
        for &(si, ti) in &edge_pairs {
            let dx = pos[si].0 - pos[ti].0;
            let dy = pos[si].1 - pos[ti].1;
            let dist = (dx * dx + dy * dy).sqrt().max(0.01);
            let force = dist * dist / k;
            let fx = dx / dist * force;
            let fy = dy / dist * force;
            disp[si].0 -= fx;
            disp[si].1 -= fy;
            disp[ti].0 += fx;
            disp[ti].1 += fy;
        }

        // Apply displacements clamped by temperature, keep within bounds.
        let x_min = config.padding;
        let x_max = config.width - config.padding;
        let y_min = config.padding;
        let y_max = config.height - config.padding;

        for i in 0..n {
            let (dx, dy) = disp[i];
            let mag = (dx * dx + dy * dy).sqrt().max(0.01);
            let scale = temperature.min(mag) / mag;
            pos[i].0 += dx * scale;
            pos[i].1 += dy * scale;
            pos[i].0 = pos[i].0.clamp(x_min, x_max);
            pos[i].1 = pos[i].1.clamp(y_min, y_max);
        }

        temperature -= cooling;
        if temperature < 0.0 {
            temperature = 0.0;
        }
    }

    // Write positions back.
    for (i, id) in node_ids.iter().enumerate() {
        if let Some(node) = graph.nodes.get_mut(id) {
            node.position = Some(Position {
                x: pos[i].0,
                y: pos[i].1,
            });
        }
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hierarchical layout (Sugiyama-style)
// ═══════════════════════════════════════════════════════════════════════════════

/// Sugiyama-style hierarchical layout:
/// 1. Assign layers via longest-path layering.
/// 2. Order nodes within layers using a barycentric heuristic to minimise
///    crossings.
/// 3. Position nodes at evenly spaced coordinates within their layer.
pub fn hierarchical_layout(graph: &mut TopologyGraph, config: &LayoutConfig) -> Result<()> {
    let node_ids: Vec<String> = graph.nodes.keys().cloned().collect();
    if node_ids.is_empty() {
        return Ok(());
    }

    // Build directed adjacency.
    let mut directed: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for id in &node_ids {
        directed.entry(id.clone()).or_default();
    }
    for edge in &graph.edges {
        directed
            .entry(edge.source_id.clone())
            .or_default()
            .push(edge.target_id.clone());
    }

    // --- Layer assignment via longest-path ----------------------------------
    let mut layer_of: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    fn longest_path(
        node: &str,
        directed: &std::collections::HashMap<String, Vec<String>>,
        memo: &mut std::collections::HashMap<String, usize>,
    ) -> usize {
        if let Some(&v) = memo.get(node) {
            return v;
        }
        let children = directed.get(node).cloned().unwrap_or_default();
        let depth = if children.is_empty() {
            0
        } else {
            children
                .iter()
                .map(|c| 1 + longest_path(c, directed, memo))
                .max()
                .unwrap_or(0)
        };
        memo.insert(node.to_string(), depth);
        depth
    }

    for id in &node_ids {
        longest_path(id, &directed, &mut layer_of);
    }

    // Invert so roots are at layer 0.
    let max_layer = layer_of.values().copied().max().unwrap_or(0);
    for val in layer_of.values_mut() {
        *val = max_layer - *val;
    }

    // Group nodes by layer.
    let num_layers = max_layer + 1;
    let mut layers: Vec<Vec<String>> = vec![Vec::new(); num_layers];
    for (id, &layer) in &layer_of {
        layers[layer].push(id.clone());
    }

    // --- Barycentric ordering -----------------------------------------------
    // Build reverse adjacency (target → sources).
    let mut reverse: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for edge in &graph.edges {
        reverse
            .entry(edge.target_id.clone())
            .or_default()
            .push(edge.source_id.clone());
    }

    // Order within layers using barycenter of connected nodes in the previous layer.
    for _pass in 0..4 {
        for l in 1..num_layers {
            let prev_order: std::collections::HashMap<String, usize> = layers[l - 1]
                .iter()
                .enumerate()
                .map(|(i, id)| (id.clone(), i))
                .collect();

            let mut scored: Vec<(String, f64)> = layers[l]
                .iter()
                .map(|id| {
                    let parents = reverse.get(id).cloned().unwrap_or_default();
                    let positions: Vec<f64> = parents
                        .iter()
                        .filter_map(|pid| prev_order.get(pid).map(|&i| i as f64))
                        .collect();
                    let bary = if positions.is_empty() {
                        f64::MAX
                    } else {
                        positions.iter().sum::<f64>() / positions.len() as f64
                    };
                    (id.clone(), bary)
                })
                .collect();

            scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
            layers[l] = scored.into_iter().map(|(id, _)| id).collect();
        }
    }

    // --- Position assignment ------------------------------------------------
    let usable_w = config.width - 2.0 * config.padding;
    let usable_h = config.height - 2.0 * config.padding;
    let layer_gap = if num_layers > 1 {
        usable_h / (num_layers - 1) as f64
    } else {
        0.0
    };

    for (l, layer) in layers.iter().enumerate() {
        let count = layer.len();
        let spacing = if count > 1 {
            usable_w / (count - 1) as f64
        } else {
            0.0
        };
        for (i, id) in layer.iter().enumerate() {
            let x = if count > 1 {
                config.padding + spacing * i as f64
            } else {
                config.width / 2.0
            };
            let y = config.padding + layer_gap * l as f64;
            if let Some(node) = graph.nodes.get_mut(id) {
                node.position = Some(Position { x, y });
            }
        }
    }

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Circular layout
// ═══════════════════════════════════════════════════════════════════════════════

/// Place nodes evenly on a circle centered in the canvas.
pub fn circular_layout(graph: &mut TopologyGraph, config: &LayoutConfig) -> Result<()> {
    let node_ids: Vec<String> = graph.nodes.keys().cloned().collect();
    let n = node_ids.len();
    if n == 0 {
        return Ok(());
    }

    let cx = config.width / 2.0;
    let cy = config.height / 2.0;
    let radius =
        ((config.width - 2.0 * config.padding).min(config.height - 2.0 * config.padding)) / 2.0;

    for (i, id) in node_ids.iter().enumerate() {
        let angle = 2.0 * std::f64::consts::PI * i as f64 / n as f64 - std::f64::consts::FRAC_PI_2;
        let x = cx + radius * angle.cos();
        let y = cy + radius * angle.sin();
        if let Some(node) = graph.nodes.get_mut(id) {
            node.position = Some(Position { x, y });
        }
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Grid layout
// ═══════════════════════════════════════════════════════════════════════════════

/// Arrange nodes in a grid.
pub fn grid_layout(graph: &mut TopologyGraph, config: &LayoutConfig) -> Result<()> {
    let node_ids: Vec<String> = {
        let mut ids: Vec<String> = graph.nodes.keys().cloned().collect();
        ids.sort();
        ids
    };
    let n = node_ids.len();
    if n == 0 {
        return Ok(());
    }

    let cols = ((n as f64).sqrt().ceil()) as usize;
    let usable_w = config.width - 2.0 * config.padding;
    let usable_h = config.height - 2.0 * config.padding;
    let col_gap = if cols > 1 {
        usable_w / (cols - 1) as f64
    } else {
        0.0
    };
    let rows = n.div_ceil(cols);
    let row_gap = if rows > 1 {
        usable_h / (rows - 1) as f64
    } else {
        0.0
    };

    for (i, id) in node_ids.iter().enumerate() {
        let col = i % cols;
        let row = i / cols;
        let x = if cols > 1 {
            config.padding + col_gap * col as f64
        } else {
            config.width / 2.0
        };
        let y = if rows > 1 {
            config.padding + row_gap * row as f64
        } else {
            config.height / 2.0
        };
        if let Some(node) = graph.nodes.get_mut(id) {
            node.position = Some(Position { x, y });
        }
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Geographic layout (simple Mercator projection)
// ═══════════════════════════════════════════════════════════════════════════════

/// Position nodes by their geographic coordinates using a simple equirectangular
/// / Mercator projection into the canvas bounds.  Nodes without geo data are
/// placed at the center.
pub fn geographic_layout(graph: &mut TopologyGraph, config: &LayoutConfig) -> Result<()> {
    let usable_w = config.width - 2.0 * config.padding;
    let usable_h = config.height - 2.0 * config.padding;

    // Gather geo bounds.
    let geo_nodes: Vec<(String, f64, f64)> = graph
        .nodes
        .values()
        .filter_map(|n| {
            n.geo
                .as_ref()
                .map(|g| (n.id.clone(), g.latitude, g.longitude))
        })
        .collect();

    if geo_nodes.is_empty() {
        // Fall back to grid layout if no geo data available.
        return grid_layout(graph, config);
    }

    let min_lat = geo_nodes
        .iter()
        .map(|(_, lat, _)| *lat)
        .fold(f64::INFINITY, f64::min);
    let max_lat = geo_nodes
        .iter()
        .map(|(_, lat, _)| *lat)
        .fold(f64::NEG_INFINITY, f64::max);
    let min_lon = geo_nodes
        .iter()
        .map(|(_, _, lon)| *lon)
        .fold(f64::INFINITY, f64::min);
    let max_lon = geo_nodes
        .iter()
        .map(|(_, _, lon)| *lon)
        .fold(f64::NEG_INFINITY, f64::max);

    let _lat_range = (max_lat - min_lat).max(0.001);
    let lon_range = (max_lon - min_lon).max(0.001);

    // Mercator y: convert latitude to Mercator y then normalise.
    let mercator_y = |lat: f64| -> f64 {
        let lat_rad = lat.to_radians().clamp(-1.4, 1.4);
        (lat_rad.tan() + 1.0 / lat_rad.cos()).ln()
    };

    let merc_min = mercator_y(min_lat);
    let merc_max = mercator_y(max_lat);
    let merc_range = (merc_max - merc_min).max(0.001);

    let cx = config.width / 2.0;
    let cy = config.height / 2.0;

    let node_ids: Vec<String> = graph.nodes.keys().cloned().collect();
    for id in &node_ids {
        let node = graph.nodes.get(id).unwrap();
        let (x, y) = if let Some(geo) = &node.geo {
            let norm_x = (geo.longitude - min_lon) / lon_range;
            let norm_y = 1.0 - (mercator_y(geo.latitude) - merc_min) / merc_range; // invert y
            (
                config.padding + norm_x * usable_w,
                config.padding + norm_y * usable_h,
            )
        } else {
            (cx, cy)
        };
        if let Some(node) = graph.nodes.get_mut(id) {
            node.position = Some(Position { x, y });
        }
    }

    Ok(())
}
