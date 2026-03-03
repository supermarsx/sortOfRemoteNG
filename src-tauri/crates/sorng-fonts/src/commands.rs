use tauri::State;

use crate::service::FontServiceState;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
//  Registry queries
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn fonts_list_all(
    state: State<'_, FontServiceState>,
) -> Result<Vec<FontMetadata>, String> {
    let svc = state.read().await;
    Ok(svc.list_all())
}

#[tauri::command]
pub async fn fonts_by_category(
    category: FontCategory,
    state: State<'_, FontServiceState>,
) -> Result<Vec<FontMetadata>, String> {
    let svc = state.read().await;
    Ok(svc.list_by_category(category))
}

#[tauri::command]
pub async fn fonts_get(
    id: String,
    state: State<'_, FontServiceState>,
) -> Result<Option<FontMetadata>, String> {
    let svc = state.read().await;
    Ok(svc.get_font(&id))
}

#[tauri::command]
pub async fn fonts_search(
    query: FontSearchQuery,
    state: State<'_, FontServiceState>,
) -> Result<Vec<FontMetadata>, String> {
    let svc = state.read().await;
    Ok(svc.search_fonts(&query))
}

#[tauri::command]
pub async fn fonts_list_monospace(
    state: State<'_, FontServiceState>,
) -> Result<Vec<FontMetadata>, String> {
    let svc = state.read().await;
    Ok(svc.list_monospace())
}

#[tauri::command]
pub async fn fonts_list_with_ligatures(
    state: State<'_, FontServiceState>,
) -> Result<Vec<FontMetadata>, String> {
    let svc = state.read().await;
    Ok(svc.list_with_ligatures())
}

#[tauri::command]
pub async fn fonts_list_with_nerd_font(
    state: State<'_, FontServiceState>,
) -> Result<Vec<FontMetadata>, String> {
    let svc = state.read().await;
    Ok(svc.list_with_nerd_font())
}

#[tauri::command]
pub async fn fonts_get_stats(
    state: State<'_, FontServiceState>,
) -> Result<FontStats, String> {
    let svc = state.read().await;
    Ok(svc.registry_stats())
}

// ═══════════════════════════════════════════════════════════════════════
//  Font stacks
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn fonts_list_stacks(
    state: State<'_, FontServiceState>,
) -> Result<Vec<FontStack>, String> {
    let svc = state.read().await;
    Ok(svc.list_stacks())
}

#[tauri::command]
pub async fn fonts_get_stack(
    id: String,
    state: State<'_, FontServiceState>,
) -> Result<Option<FontStack>, String> {
    let svc = state.read().await;
    Ok(svc.get_stack(&id))
}

#[tauri::command]
pub async fn fonts_create_stack(
    stack: FontStack,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.upsert_stack(stack);
    svc.save()
}

#[tauri::command]
pub async fn fonts_delete_stack(
    stack_id: String,
    state: State<'_, FontServiceState>,
) -> Result<bool, String> {
    let mut svc = state.write().await;
    let deleted = svc.delete_stack(&stack_id);
    svc.save()?;
    Ok(deleted)
}

// ═══════════════════════════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn fonts_get_config(
    state: State<'_, FontServiceState>,
) -> Result<FontConfiguration, String> {
    let svc = state.read().await;
    Ok(svc.get_config())
}

#[tauri::command]
pub async fn fonts_update_ssh_terminal(
    settings: FontSettings,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.update_ssh_terminal(settings);
    svc.save()
}

#[tauri::command]
pub async fn fonts_update_app_ui(
    settings: FontSettings,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.update_app_ui(settings);
    svc.save()
}

#[tauri::command]
pub async fn fonts_update_code_editor(
    settings: FontSettings,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.update_code_editor(settings);
    svc.save()
}

#[tauri::command]
pub async fn fonts_update_tab_bar(
    settings: FontSettings,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.update_tab_bar(settings);
    svc.save()
}

#[tauri::command]
pub async fn fonts_update_log_viewer(
    settings: FontSettings,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.update_log_viewer(settings);
    svc.save()
}

// ─── Connection overrides ───────────────────────────────────────────

#[tauri::command]
pub async fn fonts_set_connection_override(
    connection_id: String,
    settings: FontSettings,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.set_connection_override(&connection_id, settings);
    svc.save()
}

#[tauri::command]
pub async fn fonts_remove_connection_override(
    connection_id: String,
    state: State<'_, FontServiceState>,
) -> Result<bool, String> {
    let mut svc = state.write().await;
    let removed = svc.remove_connection_override(&connection_id);
    svc.save()?;
    Ok(removed)
}

#[tauri::command]
pub async fn fonts_resolve_connection(
    connection_id: String,
    state: State<'_, FontServiceState>,
) -> Result<FontSettings, String> {
    let svc = state.read().await;
    Ok(svc.resolve_connection_settings(&connection_id))
}

// ═══════════════════════════════════════════════════════════════════════
//  Favourites & Recent
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn fonts_add_favourite(
    font_id: String,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.add_favourite(&font_id);
    svc.save()
}

#[tauri::command]
pub async fn fonts_remove_favourite(
    font_id: String,
    state: State<'_, FontServiceState>,
) -> Result<bool, String> {
    let mut svc = state.write().await;
    let removed = svc.remove_favourite(&font_id);
    svc.save()?;
    Ok(removed)
}

#[tauri::command]
pub async fn fonts_get_favourites(
    state: State<'_, FontServiceState>,
) -> Result<Vec<FontMetadata>, String> {
    let svc = state.read().await;
    Ok(svc.get_favourites())
}

#[tauri::command]
pub async fn fonts_get_recent(
    state: State<'_, FontServiceState>,
) -> Result<Vec<FontMetadata>, String> {
    let svc = state.read().await;
    Ok(svc.get_recent())
}

#[tauri::command]
pub async fn fonts_record_recent(
    font_id: String,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.record_recent(&font_id);
    svc.save()
}

// ═══════════════════════════════════════════════════════════════════════
//  Presets
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn fonts_list_presets(
    state: State<'_, FontServiceState>,
) -> Result<Vec<FontPreset>, String> {
    let svc = state.read().await;
    Ok(svc.list_presets())
}

#[tauri::command]
pub async fn fonts_apply_preset(
    preset_id: String,
    state: State<'_, FontServiceState>,
) -> Result<FontPreset, String> {
    let mut svc = state.write().await;
    let preset = svc.apply_preset(&preset_id)?;
    svc.save()?;
    Ok(preset)
}

// ═══════════════════════════════════════════════════════════════════════
//  System font detection
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn fonts_detect_system(
    state: State<'_, FontServiceState>,
) -> Result<Vec<SystemFont>, String> {
    let svc = state.read().await;
    Ok(svc.detect_system_fonts().await)
}

#[tauri::command]
pub async fn fonts_detect_system_monospace(
    state: State<'_, FontServiceState>,
) -> Result<Vec<SystemFont>, String> {
    let svc = state.read().await;
    Ok(svc.detect_system_monospace().await)
}

// ═══════════════════════════════════════════════════════════════════════
//  CSS resolution
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn fonts_resolve_css(
    font_id: String,
    prefer_nerd_font: bool,
    state: State<'_, FontServiceState>,
) -> Result<Option<String>, String> {
    let svc = state.read().await;
    Ok(svc.resolve_css(&font_id, prefer_nerd_font))
}

#[tauri::command]
pub async fn fonts_resolve_settings_css(
    settings: FontSettings,
    state: State<'_, FontServiceState>,
) -> Result<String, String> {
    let svc = state.read().await;
    Ok(svc.resolve_settings_css(&settings))
}

// ═══════════════════════════════════════════════════════════════════════
//  Persistence
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn fonts_save(
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let svc = state.read().await;
    svc.save()
}

#[tauri::command]
pub async fn fonts_export(
    path: String,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let svc = state.read().await;
    svc.export_to(&path)
}

#[tauri::command]
pub async fn fonts_import(
    path: String,
    state: State<'_, FontServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.import_from(&path)?;
    svc.save()
}
