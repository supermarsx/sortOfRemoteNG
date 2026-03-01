use super::service::OnePasswordServiceState;
use super::types::*;

/// All Tauri commands are prefixed with `op_` for 1Password.
/// Each takes the shared `OnePasswordServiceState` and delegates to the service.

// ─── Configuration ───────────────────────────────────────────────────

#[tauri::command]
pub async fn op_get_config(
    state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<OnePasswordConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config().clone())
}

#[tauri::command]
pub async fn op_set_config(
    state: tauri::State<'_, OnePasswordServiceState>,
    config: OnePasswordConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_config(config);
    Ok(())
}

// ─── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_connect(
    state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.connect().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_disconnect(
    state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect();
    Ok(())
}

#[tauri::command]
pub async fn op_is_authenticated(
    state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_authenticated())
}

// ─── Vaults ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_list_vaults(
    state: tauri::State<'_, OnePasswordServiceState>,
    filter: Option<String>,
) -> Result<Vec<Vault>, String> {
    let mut svc = state.lock().await;
    let params = VaultListParams { filter };
    svc.list_vaults(&params).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_get_vault(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
) -> Result<Vault, String> {
    let mut svc = state.lock().await;
    svc.get_vault(&vault_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_find_vault_by_name(
    state: tauri::State<'_, OnePasswordServiceState>,
    name: String,
) -> Result<Option<Vault>, String> {
    let mut svc = state.lock().await;
    svc.find_vault_by_name(&name).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_get_vault_stats(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
) -> Result<super::vaults::VaultStats, String> {
    let mut svc = state.lock().await;
    svc.get_vault_stats(&vault_id).await.map_err(|e| e.message)
}

// ─── Items ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_list_items(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    filter: Option<String>,
) -> Result<Vec<Item>, String> {
    let mut svc = state.lock().await;
    let params = ItemListParams { filter };
    svc.list_items(&vault_id, &params)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_get_item(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.get_item(&vault_id, &item_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_find_items_by_title(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    title: String,
) -> Result<Vec<Item>, String> {
    let mut svc = state.lock().await;
    svc.find_items_by_title(&vault_id, &title)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_create_item(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    request: CreateItemRequest,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.create_item(&vault_id, &request)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_update_item(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
    request: UpdateItemRequest,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.update_item(&vault_id, &item_id, &request)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_patch_item(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
    operations: Vec<PatchOperation>,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.patch_item(&vault_id, &item_id, &operations)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_delete_item(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_item(&vault_id, &item_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_archive_item(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.archive_item(&vault_id, &item_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_restore_item(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.restore_item(&vault_id, &item_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_search_all_vaults(
    state: tauri::State<'_, OnePasswordServiceState>,
    query: String,
) -> Result<Vec<(String, Item)>, String> {
    let mut svc = state.lock().await;
    svc.search_all_vaults(&query).await.map_err(|e| e.message)
}

// ─── Fields ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_get_password(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
) -> Result<Option<String>, String> {
    let mut svc = state.lock().await;
    svc.get_password(&vault_id, &item_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_get_username(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
) -> Result<Option<String>, String> {
    let mut svc = state.lock().await;
    svc.get_username(&vault_id, &item_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_add_field(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
    field: Field,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.add_field(&vault_id, &item_id, &field)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_update_field_value(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
    field_id: String,
    value: String,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.update_field_value(&vault_id, &item_id, &field_id, &value)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_remove_field(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
    field_id: String,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.remove_field(&vault_id, &item_id, &field_id)
        .await
        .map_err(|e| e.message)
}

// ─── Files ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_list_files(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
) -> Result<Vec<FileAttachment>, String> {
    let mut svc = state.lock().await;
    svc.list_files(&vault_id, &item_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_download_file(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
    file_id: String,
) -> Result<Vec<u8>, String> {
    let mut svc = state.lock().await;
    svc.download_file(&vault_id, &item_id, &file_id)
        .await
        .map_err(|e| e.message)
}

// ─── TOTP ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_get_totp_code(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
) -> Result<Option<TotpCode>, String> {
    let mut svc = state.lock().await;
    svc.get_totp_code(&vault_id, &item_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_add_totp(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
    totp_uri: String,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.add_totp(&vault_id, &item_id, &totp_uri)
        .await
        .map_err(|e| e.message)
}

// ─── Watchtower ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_watchtower_analyze_all(
    state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<WatchtowerSummary, String> {
    let mut svc = state.lock().await;
    svc.watchtower_analyze_all().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_watchtower_analyze_vault(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
) -> Result<WatchtowerSummary, String> {
    let mut svc = state.lock().await;
    svc.watchtower_analyze_vault(&vault_id)
        .await
        .map_err(|e| e.message)
}

// ─── Health ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_heartbeat(
    state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.heartbeat().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_health(
    state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<ServerHealth, String> {
    let mut svc = state.lock().await;
    svc.health().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_is_healthy(
    state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.is_healthy().await.map_err(|e| e.message)
}

// ─── Activity ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_get_activity(
    state: tauri::State<'_, OnePasswordServiceState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<ApiRequest>, String> {
    let mut svc = state.lock().await;
    let params = ActivityListParams { limit, offset };
    svc.get_activity(&params).await.map_err(|e| e.message)
}

// ─── Favorites ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_list_favorites(
    state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<Vec<FavoriteItem>, String> {
    let mut svc = state.lock().await;
    svc.list_favorites().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_toggle_favorite(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    item_id: String,
    favorite: bool,
) -> Result<FullItem, String> {
    let mut svc = state.lock().await;
    svc.toggle_favorite(&vault_id, &item_id, favorite)
        .await
        .map_err(|e| e.message)
}

// ─── Import / Export ─────────────────────────────────────────────────

#[tauri::command]
pub async fn op_export_vault_json(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
) -> Result<ExportResult, String> {
    let mut svc = state.lock().await;
    svc.export_vault_json(&vault_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_export_vault_csv(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
) -> Result<ExportResult, String> {
    let mut svc = state.lock().await;
    svc.export_vault_csv(&vault_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_import_json(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    json_data: String,
) -> Result<ImportResult, String> {
    let mut svc = state.lock().await;
    svc.import_json(&vault_id, &json_data)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn op_import_csv(
    state: tauri::State<'_, OnePasswordServiceState>,
    vault_id: String,
    csv_data: String,
) -> Result<ImportResult, String> {
    let mut svc = state.lock().await;
    svc.import_csv(&vault_id, &csv_data)
        .await
        .map_err(|e| e.message)
}

// ─── Password Generation ────────────────────────────────────────────

#[tauri::command]
pub async fn op_generate_password(
    state: tauri::State<'_, OnePasswordServiceState>,
    config: PasswordGenConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    Ok(svc.generate_password(&config))
}

#[tauri::command]
pub async fn op_generate_passphrase(
    state: tauri::State<'_, OnePasswordServiceState>,
    word_count: u32,
    separator: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    Ok(svc.generate_passphrase(word_count, &separator))
}

#[tauri::command]
pub async fn op_rate_password_strength(
    _state: tauri::State<'_, OnePasswordServiceState>,
    password: String,
) -> Result<String, String> {
    Ok(super::password_gen::OnePasswordPasswordGen::rate_strength(&password).to_string())
}

// ─── Categories ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_list_categories(
    _state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<Vec<serde_json::Value>, String> {
    let cats = super::categories::OnePasswordCategories::all();
    Ok(cats
        .iter()
        .map(|c| {
            serde_json::json!({
                "category": c,
                "label": super::categories::OnePasswordCategories::label(c),
                "icon": super::categories::OnePasswordCategories::icon(c),
            })
        })
        .collect())
}

// ─── Cache ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn op_invalidate_cache(
    state: tauri::State<'_, OnePasswordServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.invalidate_cache();
    Ok(())
}
