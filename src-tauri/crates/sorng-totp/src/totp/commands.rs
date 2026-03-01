//! Tauri command bindings for the TOTP crate.
//!
//! Thin wrappers that take `State<TotpServiceState>`, lock the mutex,
//! and delegate to the service.  Every command returns `Result<T, String>`.

use crate::totp::service::{TotpServiceState, VaultStats};
use crate::totp::types::*;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Entry CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn totp_add_entry(
    state: tauri::State<'_, TotpServiceState>,
    entry: TotpEntry,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.add_entry(entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_create_entry(
    state: tauri::State<'_, TotpServiceState>,
    label: String,
    secret: String,
    issuer: Option<String>,
    algorithm: Option<String>,
    digits: Option<u8>,
    period: Option<u32>,
) -> Result<TotpEntry, String> {
    let mut svc = state.lock().await;
    svc.create_entry(label, secret, issuer, algorithm, digits, period)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_get_entry(
    state: tauri::State<'_, TotpServiceState>,
    id: String,
) -> Result<TotpEntry, String> {
    let svc = state.lock().await;
    svc.get_entry(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_update_entry(
    state: tauri::State<'_, TotpServiceState>,
    entry: TotpEntry,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_entry(entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_remove_entry(
    state: tauri::State<'_, TotpServiceState>,
    id: String,
) -> Result<TotpEntry, String> {
    let mut svc = state.lock().await;
    svc.remove_entry(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_list_entries(
    state: tauri::State<'_, TotpServiceState>,
) -> Result<Vec<TotpEntry>, String> {
    let svc = state.lock().await;
    svc.list_entries().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_search_entries(
    state: tauri::State<'_, TotpServiceState>,
    query: String,
) -> Result<Vec<TotpEntry>, String> {
    let svc = state.lock().await;
    svc.search_entries(&query).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_filter_entries(
    state: tauri::State<'_, TotpServiceState>,
    filter: EntryFilter,
) -> Result<Vec<TotpEntry>, String> {
    let svc = state.lock().await;
    svc.filter_entries(filter).map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Code generation & verification
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn totp_generate_code(
    state: tauri::State<'_, TotpServiceState>,
    id: String,
) -> Result<GeneratedCode, String> {
    let mut svc = state.lock().await;
    svc.generate_code(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_generate_all_codes(
    state: tauri::State<'_, TotpServiceState>,
) -> Result<Vec<GeneratedCode>, String> {
    let svc = state.lock().await;
    svc.generate_all_codes().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_verify_code(
    state: tauri::State<'_, TotpServiceState>,
    id: String,
    code: String,
    drift_window: Option<u32>,
) -> Result<VerifyResult, String> {
    let svc = state.lock().await;
    svc.verify_code(&id, &code, drift_window)
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Groups
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn totp_add_group(
    state: tauri::State<'_, TotpServiceState>,
    name: String,
) -> Result<TotpGroup, String> {
    let mut svc = state.lock().await;
    svc.add_group(name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_list_groups(
    state: tauri::State<'_, TotpServiceState>,
) -> Result<Vec<TotpGroup>, String> {
    let svc = state.lock().await;
    svc.list_groups().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_remove_group(
    state: tauri::State<'_, TotpServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_group(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_move_entry_to_group(
    state: tauri::State<'_, TotpServiceState>,
    entry_id: String,
    group_id: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.move_entry_to_group(&entry_id, group_id)
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Favourites & ordering
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn totp_toggle_favourite(
    state: tauri::State<'_, TotpServiceState>,
    id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.toggle_favourite(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_list_favourites(
    state: tauri::State<'_, TotpServiceState>,
) -> Result<Vec<TotpEntry>, String> {
    let svc = state.lock().await;
    svc.list_favourites().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_reorder_entry(
    state: tauri::State<'_, TotpServiceState>,
    from_idx: usize,
    to_idx: usize,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reorder_entry(from_idx, to_idx)
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Import / Export
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn totp_import_entries(
    state: tauri::State<'_, TotpServiceState>,
    data: String,
) -> Result<ImportResult, String> {
    let mut svc = state.lock().await;
    svc.import_entries(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_import_as(
    state: tauri::State<'_, TotpServiceState>,
    data: String,
    format: ImportFormat,
) -> Result<ImportResult, String> {
    let mut svc = state.lock().await;
    svc.import_as(&data, format).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_import_uri(
    state: tauri::State<'_, TotpServiceState>,
    uri: String,
) -> Result<TotpEntry, String> {
    let mut svc = state.lock().await;
    svc.import_uri(&uri).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_export_entries(
    state: tauri::State<'_, TotpServiceState>,
    format: ExportFormat,
    password: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.export_entries(format, password)
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  QR codes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn totp_entry_qr_png(
    state: tauri::State<'_, TotpServiceState>,
    id: String,
) -> Result<Vec<u8>, String> {
    let svc = state.lock().await;
    svc.entry_qr_png(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_entry_qr_data_uri(
    state: tauri::State<'_, TotpServiceState>,
    id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.entry_qr_data_uri(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_entry_uri(
    state: tauri::State<'_, TotpServiceState>,
    id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.entry_uri(&id).map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Vault lock / unlock / save / load
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn totp_set_password(
    state: tauri::State<'_, TotpServiceState>,
    password: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_password(&password);
    Ok(())
}

#[tauri::command]
pub async fn totp_lock(
    state: tauri::State<'_, TotpServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.lock();
    Ok(())
}

#[tauri::command]
pub async fn totp_unlock(
    state: tauri::State<'_, TotpServiceState>,
    encrypted_json: String,
    password: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.unlock(&encrypted_json, &password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_is_locked(
    state: tauri::State<'_, TotpServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_locked())
}

#[tauri::command]
pub async fn totp_save_vault(
    state: tauri::State<'_, TotpServiceState>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.save_vault().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_load_vault(
    state: tauri::State<'_, TotpServiceState>,
    data: String,
    password: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.load_vault(&data, password.as_deref())
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Utility
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn totp_generate_secret(
    state: tauri::State<'_, TotpServiceState>,
    length: Option<usize>,
) -> Result<String, String> {
    let svc = state.lock().await;
    Ok(svc.generate_secret(length))
}

#[tauri::command]
pub async fn totp_password_strength(
    _state: tauri::State<'_, TotpServiceState>,
    password: String,
) -> Result<(u8, String), String> {
    let score = crate::totp::crypto::password_strength(&password);
    let label = crate::totp::crypto::strength_label(score);
    Ok((score, label.to_string()))
}

#[tauri::command]
pub async fn totp_deduplicate(
    state: tauri::State<'_, TotpServiceState>,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    svc.deduplicate().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_vault_stats(
    state: tauri::State<'_, TotpServiceState>,
) -> Result<VaultStats, String> {
    let svc = state.lock().await;
    svc.vault_stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn totp_all_tags(
    state: tauri::State<'_, TotpServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.all_tags().map_err(|e| e.to_string())
}
