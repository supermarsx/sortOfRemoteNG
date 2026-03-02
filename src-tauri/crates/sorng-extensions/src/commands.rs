//! Tauri command handlers for the extensions engine.
//!
//! Each command follows the `ext_*` naming convention and delegates
//! to [`ExtensionsService`].

use std::collections::HashMap;

use tauri::State;

use crate::service::ExtensionsServiceState;
use crate::types::*;

/// Helper to map ExtError → String for Tauri.
fn err_str(e: ExtError) -> String {
    e.to_string()
}

// ─── Extension Lifecycle ────────────────────────────────────────────

#[tauri::command]
pub async fn ext_install(
    state: State<'_, ExtensionsServiceState>,
    manifest_json: String,
    script_source: Option<String>,
    sandbox_config: Option<SandboxConfig>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.install_extension(&manifest_json, script_source, sandbox_config)
        .map_err(err_str)
}

#[tauri::command]
pub async fn ext_install_with_manifest(
    state: State<'_, ExtensionsServiceState>,
    manifest: ExtensionManifest,
    script_source: Option<String>,
    sandbox_config: Option<SandboxConfig>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.install_extension_manifest(manifest, script_source, sandbox_config)
        .map_err(err_str)
}

#[tauri::command]
pub async fn ext_enable(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.enable_extension(&extension_id).map_err(err_str)
}

#[tauri::command]
pub async fn ext_disable(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disable_extension(&extension_id).map_err(err_str)
}

#[tauri::command]
pub async fn ext_uninstall(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.uninstall_extension(&extension_id).map_err(err_str)
}

#[tauri::command]
pub async fn ext_update(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
    manifest_json: String,
    new_script_source: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_extension(&extension_id, &manifest_json, new_script_source)
        .map_err(err_str)
}

// ─── Execution ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn ext_execute_handler(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
    handler_name: String,
    args: Option<HashMap<String, ScriptValue>>,
) -> Result<ExecutionResult, String> {
    let mut svc = state.lock().await;
    svc.execute_handler(&extension_id, &handler_name, args.unwrap_or_default())
        .map_err(err_str)
}

#[tauri::command]
pub async fn ext_dispatch_event(
    state: State<'_, ExtensionsServiceState>,
    event: HookEvent,
    payload: Option<HashMap<String, ScriptValue>>,
) -> Result<Vec<HookResult>, String> {
    let mut svc = state.lock().await;
    Ok(svc.dispatch_event(&event, payload))
}

// ─── Storage ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ext_storage_get(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    let svc = state.lock().await;
    svc.storage_get(&extension_id, &key).map_err(err_str)
}

#[tauri::command]
pub async fn ext_storage_set(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.storage_set(&extension_id, &key, value).map_err(err_str)
}

#[tauri::command]
pub async fn ext_storage_delete(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
    key: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.storage_delete(&extension_id, &key).map_err(err_str)
}

#[tauri::command]
pub async fn ext_storage_list_keys(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.storage_list_keys(&extension_id).map_err(err_str)
}

#[tauri::command]
pub async fn ext_storage_clear(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    svc.storage_clear(&extension_id).map_err(err_str)
}

#[tauri::command]
pub async fn ext_storage_export(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    Ok(svc.storage_export(&extension_id))
}

#[tauri::command]
pub async fn ext_storage_import(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
    data: serde_json::Value,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    svc.storage_import(&extension_id, data).map_err(err_str)
}

#[tauri::command]
pub async fn ext_storage_summary(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
) -> Result<StorageSummary, String> {
    let svc = state.lock().await;
    Ok(svc.storage_summary(&extension_id))
}

// ─── Settings ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn ext_get_setting(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    let svc = state.lock().await;
    svc.get_setting(&extension_id, &key).map_err(err_str)
}

#[tauri::command]
pub async fn ext_set_setting(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_setting(&extension_id, &key, value).map_err(err_str)
}

// ─── Query / Listing ────────────────────────────────────────────────

#[tauri::command]
pub async fn ext_get_extension(
    state: State<'_, ExtensionsServiceState>,
    extension_id: String,
) -> Result<Option<ExtensionSummary>, String> {
    let svc = state.lock().await;
    let summary = svc.get_extension(&extension_id).map(|s| ExtensionSummary {
        id: s.manifest.id.clone(),
        name: s.manifest.name.clone(),
        version: s.manifest.version.clone(),
        description: s.manifest.description.clone(),
        author: s.manifest.author.clone(),
        extension_type: s.manifest.extension_type.clone(),
        status: s.status.clone(),
        installed_at: s.installed_at,
        execution_count: s.execution_count,
        tags: s.manifest.tags.clone(),
        has_settings: !s.settings.is_empty(),
        permission_count: s.manifest.permissions.len(),
        hook_count: s.manifest.hooks.len(),
    });
    Ok(summary)
}

#[tauri::command]
pub async fn ext_list_extensions(
    state: State<'_, ExtensionsServiceState>,
    filter: Option<ExtensionFilter>,
) -> Result<Vec<ExtensionSummary>, String> {
    let svc = state.lock().await;
    Ok(svc.list_extensions(&filter.unwrap_or_default()))
}

#[tauri::command]
pub async fn ext_engine_stats(
    state: State<'_, ExtensionsServiceState>,
) -> Result<EngineStats, String> {
    let svc = state.lock().await;
    Ok(svc.engine_stats())
}

// ─── Manifest Utilities ─────────────────────────────────────────────

#[tauri::command]
pub async fn ext_validate_manifest(
    state: State<'_, ExtensionsServiceState>,
    manifest_json: String,
) -> Result<ExtensionManifest, String> {
    let svc = state.lock().await;
    svc.validate_manifest_json(&manifest_json).map_err(err_str)
}

#[tauri::command]
pub async fn ext_create_manifest_template(
    state: State<'_, ExtensionsServiceState>,
    id: String,
    name: String,
    version: String,
    description: String,
    author: String,
    extension_type: ExtensionType,
) -> Result<String, String> {
    let svc = state.lock().await;
    let manifest = svc.create_manifest_template(id, name, version, description, author, extension_type);
    svc.serialize_manifest(&manifest).map_err(err_str)
}

// ─── API Documentation ──────────────────────────────────────────────

#[tauri::command]
pub async fn ext_api_documentation(
    state: State<'_, ExtensionsServiceState>,
) -> Result<Vec<crate::api::ApiFunctionDoc>, String> {
    let svc = state.lock().await;
    Ok(svc.api_documentation())
}

#[tauri::command]
pub async fn ext_permission_groups(
    state: State<'_, ExtensionsServiceState>,
) -> Result<Vec<PermissionGroup>, String> {
    let svc = state.lock().await;
    Ok(svc.permission_groups())
}

// ─── Config ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ext_get_config(
    state: State<'_, ExtensionsServiceState>,
) -> Result<EngineConfig, String> {
    let svc = state.lock().await;
    Ok(svc.config().clone())
}

#[tauri::command]
pub async fn ext_update_config(
    state: State<'_, ExtensionsServiceState>,
    config: EngineConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_config(config);
    Ok(())
}

// ─── Audit / Dispatch Logs ──────────────────────────────────────────

#[tauri::command]
pub async fn ext_audit_log(
    state: State<'_, ExtensionsServiceState>,
) -> Result<Vec<AuditEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.audit_log().to_vec())
}

#[tauri::command]
pub async fn ext_dispatch_log(
    state: State<'_, ExtensionsServiceState>,
) -> Result<Vec<crate::hooks::DispatchRecord>, String> {
    let svc = state.lock().await;
    Ok(svc.dispatch_log().to_vec())
}
