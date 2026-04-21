// ── sorng-roundcube/src/commands.rs ────────────────────────────────────────────
// Tauri commands – thin wrappers around `RoundcubeService`.

use super::service::RoundcubeServiceState;
use super::types::*;
use std::collections::HashMap;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn rc_connect(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    config: RoundcubeConnectionConfig,
) -> CmdResult<RoundcubeConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_disconnect(state: State<'_, RoundcubeServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn rc_list_connections(
    state: State<'_, RoundcubeServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn rc_ping(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<RoundcubeConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn rc_list_users(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<Vec<RoundcubeUser>> {
    state.lock().await.list_users(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_user(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<RoundcubeUser> {
    state
        .lock()
        .await
        .get_user(&id, &user_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_create_user(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    req: CreateUserRequest,
) -> CmdResult<RoundcubeUser> {
    state
        .lock()
        .await
        .create_user(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_update_user(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
    req: UpdateUserRequest,
) -> CmdResult<RoundcubeUser> {
    state
        .lock()
        .await
        .update_user(&id, &user_id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_delete_user(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_user(&id, &user_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_user_preferences(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<RoundcubeUserPreferences> {
    state
        .lock()
        .await
        .get_user_preferences(&id, &user_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_update_user_preferences(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
    prefs: RoundcubeUserPreferences,
) -> CmdResult<RoundcubeUserPreferences> {
    state
        .lock()
        .await
        .update_user_preferences(&id, &user_id, &prefs)
        .await
        .map_err(map_err)
}

// ── Identities ────────────────────────────────────────────────────

#[tauri::command]
pub async fn rc_list_identities(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<Vec<RoundcubeIdentity>> {
    state
        .lock()
        .await
        .list_identities(&id, &user_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_identity(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
    identity_id: String,
) -> CmdResult<RoundcubeIdentity> {
    state
        .lock()
        .await
        .get_identity(&id, &user_id, &identity_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_create_identity(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
    req: CreateIdentityRequest,
) -> CmdResult<RoundcubeIdentity> {
    state
        .lock()
        .await
        .create_identity(&id, &user_id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_update_identity(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
    identity_id: String,
    req: UpdateIdentityRequest,
) -> CmdResult<RoundcubeIdentity> {
    state
        .lock()
        .await
        .update_identity(&id, &user_id, &identity_id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_delete_identity(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
    identity_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_identity(&id, &user_id, &identity_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_set_default_identity(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    user_id: String,
    identity_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_default_identity(&id, &user_id, &identity_id)
        .await
        .map_err(map_err)
}

// ── Address Books ─────────────────────────────────────────────────

#[tauri::command]
pub async fn rc_list_address_books(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<Vec<RoundcubeAddressBook>> {
    state
        .lock()
        .await
        .list_address_books(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_address_book(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    book_id: String,
) -> CmdResult<RoundcubeAddressBook> {
    state
        .lock()
        .await
        .get_address_book(&id, &book_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_list_contacts(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    book_id: String,
) -> CmdResult<Vec<RoundcubeContact>> {
    state
        .lock()
        .await
        .list_contacts(&id, &book_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_contact(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    book_id: String,
    contact_id: String,
) -> CmdResult<RoundcubeContact> {
    state
        .lock()
        .await
        .get_contact(&id, &book_id, &contact_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_create_contact(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    book_id: String,
    req: CreateContactRequest,
) -> CmdResult<RoundcubeContact> {
    state
        .lock()
        .await
        .create_contact(&id, &book_id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_update_contact(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    book_id: String,
    contact_id: String,
    req: UpdateContactRequest,
) -> CmdResult<RoundcubeContact> {
    state
        .lock()
        .await
        .update_contact(&id, &book_id, &contact_id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_delete_contact(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    book_id: String,
    contact_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_contact(&id, &book_id, &contact_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_search_contacts(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    book_id: String,
    query: String,
) -> CmdResult<Vec<RoundcubeContact>> {
    state
        .lock()
        .await
        .search_contacts(&id, &book_id, &query)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_export_vcard(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    book_id: String,
    contact_id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .export_vcard(&id, &book_id, &contact_id)
        .await
        .map_err(map_err)
}

// ── Folders ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn rc_list_folders(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<Vec<RoundcubeFolder>> {
    state.lock().await.list_folders(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_folder(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    name: String,
) -> CmdResult<RoundcubeFolder> {
    state
        .lock()
        .await
        .get_folder(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_create_folder(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    req: CreateFolderRequest,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_folder(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_rename_folder(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    req: RenameFolderRequest,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .rename_folder(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_delete_folder(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_folder(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_subscribe_folder(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .subscribe_folder(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_unsubscribe_folder(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .unsubscribe_folder(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_purge_folder(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .purge_folder(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_quota(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<RoundcubeQuota> {
    state.lock().await.get_quota(&id).await.map_err(map_err)
}

// ── Filters ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn rc_list_filters(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<Vec<RoundcubeFilter>> {
    state.lock().await.list_filters(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_filter(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    filter_id: String,
) -> CmdResult<RoundcubeFilter> {
    state
        .lock()
        .await
        .get_filter(&id, &filter_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_create_filter(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    req: CreateFilterRequest,
) -> CmdResult<RoundcubeFilter> {
    state
        .lock()
        .await
        .create_filter(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_update_filter(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    filter_id: String,
    req: UpdateFilterRequest,
) -> CmdResult<RoundcubeFilter> {
    state
        .lock()
        .await
        .update_filter(&id, &filter_id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_delete_filter(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    filter_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_filter(&id, &filter_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_enable_filter(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    filter_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_filter(&id, &filter_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_disable_filter(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    filter_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_filter(&id, &filter_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_reorder_filters(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    ids: Vec<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .reorder_filters(&id, &ids)
        .await
        .map_err(map_err)
}

// ── Plugins ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn rc_list_plugins(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<Vec<RoundcubePlugin>> {
    state.lock().await.list_plugins(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_plugin(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    name: String,
) -> CmdResult<RoundcubePlugin> {
    state
        .lock()
        .await
        .get_plugin(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_enable_plugin(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_plugin(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_disable_plugin(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_plugin(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_plugin_config(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    name: String,
) -> CmdResult<RoundcubePluginConfig> {
    state
        .lock()
        .await
        .get_plugin_config(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_update_plugin_config(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    name: String,
    settings: HashMap<String, serde_json::Value>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_plugin_config(&id, &name, &settings)
        .await
        .map_err(map_err)
}

// ── Settings ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn rc_get_system_config(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<RoundcubeSystemConfig> {
    state
        .lock()
        .await
        .get_system_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_update_system_config(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    config: RoundcubeSystemConfig,
) -> CmdResult<RoundcubeSystemConfig> {
    state
        .lock()
        .await
        .update_system_config(&id, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_smtp_config(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<RoundcubeSmtpConfig> {
    state
        .lock()
        .await
        .get_smtp_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_update_smtp_config(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    config: RoundcubeSmtpConfig,
) -> CmdResult<RoundcubeSmtpConfig> {
    state
        .lock()
        .await
        .update_smtp_config(&id, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_cache_stats(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<RoundcubeCacheStats> {
    state
        .lock()
        .await
        .get_cache_stats(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_clear_cache(state: State<'_, RoundcubeServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.clear_cache(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_logs(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    limit: Option<u64>,
    level: Option<String>,
) -> CmdResult<Vec<RoundcubeLogEntry>> {
    state
        .lock()
        .await
        .get_logs(&id, limit, level.as_deref())
        .await
        .map_err(map_err)
}

// ── Maintenance ───────────────────────────────────────────────────

#[tauri::command]
pub async fn rc_vacuum_db(state: State<'_, RoundcubeServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.vacuum_db(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rc_optimize_db(state: State<'_, RoundcubeServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.optimize_db(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rc_clear_temp_files(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .clear_temp_files(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_clear_expired_sessions(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .clear_expired_sessions(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_get_db_stats(
    state: State<'_, RoundcubeServiceState>,
    id: String,
) -> CmdResult<RoundcubeDbStats> {
    state.lock().await.get_db_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rc_test_smtp(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    to: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .test_smtp(&id, &to)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn rc_test_imap(
    state: State<'_, RoundcubeServiceState>,
    id: String,
    host: String,
    user: String,
    pass: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .test_imap(&id, &host, &user, &pass)
        .await
        .map_err(map_err)
}
