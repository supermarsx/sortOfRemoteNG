use crate::service::FilterServiceState;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════
// Filter CRUD
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn filter_create(
    state: tauri::State<'_, FilterServiceState>,
    filter: SmartFilter,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.create_filter(filter).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn filter_delete(
    state: tauri::State<'_, FilterServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_filter(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn filter_update(
    state: tauri::State<'_, FilterServiceState>,
    filter: SmartFilter,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_filter(filter).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn filter_get(
    state: tauri::State<'_, FilterServiceState>,
    id: String,
) -> Result<SmartFilter, String> {
    let svc = state.lock().await;
    svc.get_filter(&id)
        .map(|f| f.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn filter_list(
    state: tauri::State<'_, FilterServiceState>,
) -> Result<Vec<SmartFilter>, String> {
    let svc = state.lock().await;
    Ok(svc.list_filters().into_iter().cloned().collect())
}

// ═══════════════════════════════════════════════════════════════════
// Evaluation
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn filter_evaluate(
    state: tauri::State<'_, FilterServiceState>,
    filter: SmartFilter,
    connections: Vec<serde_json::Value>,
) -> Result<FilterResult, String> {
    let mut svc = state.lock().await;
    svc.evaluate_inline(&filter, &connections)
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════
// Presets
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn filter_get_presets(
    state: tauri::State<'_, FilterServiceState>,
) -> Result<Vec<FilterPreset>, String> {
    let svc = state.lock().await;
    Ok(svc.get_presets())
}

// ═══════════════════════════════════════════════════════════════════
// Smart Groups
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn filter_create_smart_group(
    state: tauri::State<'_, FilterServiceState>,
    group: SmartGroup,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.create_smart_group(group).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn filter_delete_smart_group(
    state: tauri::State<'_, FilterServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_smart_group(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn filter_list_smart_groups(
    state: tauri::State<'_, FilterServiceState>,
) -> Result<Vec<SmartGroup>, String> {
    let svc = state.lock().await;
    Ok(svc.list_smart_groups().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn filter_update_smart_group(
    state: tauri::State<'_, FilterServiceState>,
    group: SmartGroup,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_smart_group(group).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn filter_evaluate_smart_group(
    state: tauri::State<'_, FilterServiceState>,
    group_id: String,
    connections: Vec<serde_json::Value>,
) -> Result<FilterResult, String> {
    let mut svc = state.lock().await;
    svc.evaluate_smart_group(&group_id, &connections)
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════
// Cache
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn filter_invalidate_cache(
    state: tauri::State<'_, FilterServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.invalidate_cache();
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn filter_get_stats(
    state: tauri::State<'_, FilterServiceState>,
) -> Result<FilterStats, String> {
    let svc = state.lock().await;
    Ok(svc.get_stats())
}

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn filter_get_config(
    state: tauri::State<'_, FilterServiceState>,
) -> Result<FiltersConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config().clone())
}

#[tauri::command]
pub async fn filter_update_config(
    state: tauri::State<'_, FilterServiceState>,
    config: FiltersConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_config(config);
    Ok(())
}
