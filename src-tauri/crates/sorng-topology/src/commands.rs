// ─── Tauri IPC commands for sorng-topology ───────────────────────────────────

use crate::builder::ConnectionData;
use crate::service::TopologyServiceState;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Build
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn topo_build_from_connections(
    state: tauri::State<'_, TopologyServiceState>,
    connections: Vec<ConnectionData>,
) -> Result<TopologyGraph, String> {
    let mut svc = state.lock().await;
    svc.build_from_connections(&connections);
    Ok(svc.get_graph().clone())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Graph read
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn topo_get_graph(
    state: tauri::State<'_, TopologyServiceState>,
) -> Result<TopologyGraph, String> {
    let svc = state.lock().await;
    Ok(svc.get_graph().clone())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Node CRUD
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn topo_add_node(
    state: tauri::State<'_, TopologyServiceState>,
    node: TopologyNode,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_node(node).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn topo_remove_node(
    state: tauri::State<'_, TopologyServiceState>,
    node_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_node(&node_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn topo_update_node(
    state: tauri::State<'_, TopologyServiceState>,
    node_id: String,
    updates: serde_json::Value,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_node(&node_id, updates)
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edge CRUD
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn topo_add_edge(
    state: tauri::State<'_, TopologyServiceState>,
    edge: TopologyEdge,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_edge(edge).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn topo_remove_edge(
    state: tauri::State<'_, TopologyServiceState>,
    edge_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_edge(&edge_id).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layout
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn topo_apply_layout(
    state: tauri::State<'_, TopologyServiceState>,
    config: Option<LayoutConfig>,
) -> Result<TopologyGraph, String> {
    let mut svc = state.lock().await;
    if let Some(cfg) = config {
        svc.set_layout_config(cfg);
    }
    svc.apply_layout().map_err(|e| e.to_string())?;
    Ok(svc.get_graph().clone())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Analysis
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn topo_get_blast_radius(
    state: tauri::State<'_, TopologyServiceState>,
    node_id: String,
) -> Result<BlastRadius, String> {
    let svc = state.lock().await;
    svc.blast_radius(&node_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn topo_find_bottlenecks(
    state: tauri::State<'_, TopologyServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.bottlenecks())
}

#[tauri::command]
pub async fn topo_find_critical_edges(
    state: tauri::State<'_, TopologyServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.critical_edges())
}

#[tauri::command]
pub async fn topo_get_path(
    state: tauri::State<'_, TopologyServiceState>,
    from: String,
    to: String,
) -> Result<Option<Vec<String>>, String> {
    let svc = state.lock().await;
    Ok(svc.get_path(&from, &to))
}

#[tauri::command]
pub async fn topo_get_neighbors(
    state: tauri::State<'_, TopologyServiceState>,
    node_id: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.get_neighbors(&node_id))
}

#[tauri::command]
pub async fn topo_get_connected_components(
    state: tauri::State<'_, TopologyServiceState>,
) -> Result<Vec<Vec<String>>, String> {
    let svc = state.lock().await;
    Ok(svc.get_connected_components())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Statistics
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn topo_get_stats(
    state: tauri::State<'_, TopologyServiceState>,
) -> Result<TopologyStats, String> {
    let svc = state.lock().await;
    Ok(svc.get_stats())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Snapshots
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn topo_create_snapshot(
    state: tauri::State<'_, TopologyServiceState>,
    label: Option<String>,
) -> Result<TopologySnapshot, String> {
    let mut svc = state.lock().await;
    Ok(svc.create_snapshot(label))
}

#[tauri::command]
pub async fn topo_list_snapshots(
    state: tauri::State<'_, TopologyServiceState>,
) -> Result<Vec<TopologySnapshot>, String> {
    let svc = state.lock().await;
    Ok(svc.list_snapshots())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Groups
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn topo_add_group(
    state: tauri::State<'_, TopologyServiceState>,
    group: NodeGroup,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_group(group).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn topo_remove_group(
    state: tauri::State<'_, TopologyServiceState>,
    group_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_group(&group_id).map_err(|e| e.to_string())
}
