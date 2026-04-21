// ── sorng-haproxy/src/commands.rs ────────────────────────────────────────────
// Tauri commands – thin wrappers around `HaproxyService`.

use super::service::HaproxyServiceState;
use super::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn haproxy_connect(
    state: State<'_, HaproxyServiceState>,
    id: String,
    config: HaproxyConnectionConfig,
) -> CmdResult<HaproxyConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_disconnect(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_list_connections(
    state: State<'_, HaproxyServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn haproxy_ping(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<HaproxyConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Stats ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn haproxy_get_info(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<HaproxyInfo> {
    state.lock().await.get_info(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_get_csv(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.get_csv(&id).await.map_err(map_err)
}

// ── Frontends ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn haproxy_list_frontends(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<Vec<HaproxyFrontend>> {
    state
        .lock()
        .await
        .list_frontends(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_get_frontend(
    state: State<'_, HaproxyServiceState>,
    id: String,
    name: String,
) -> CmdResult<HaproxyFrontend> {
    state
        .lock()
        .await
        .get_frontend(&id, &name)
        .await
        .map_err(map_err)
}

// ── Backends ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn haproxy_list_backends(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<Vec<HaproxyBackend>> {
    state.lock().await.list_backends(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_get_backend(
    state: State<'_, HaproxyServiceState>,
    id: String,
    name: String,
) -> CmdResult<HaproxyBackend> {
    state
        .lock()
        .await
        .get_backend(&id, &name)
        .await
        .map_err(map_err)
}

// ── Servers ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn haproxy_list_servers(
    state: State<'_, HaproxyServiceState>,
    id: String,
    backend: String,
) -> CmdResult<Vec<HaproxyServer>> {
    state
        .lock()
        .await
        .list_servers(&id, &backend)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_get_server(
    state: State<'_, HaproxyServiceState>,
    id: String,
    backend: String,
    server: String,
) -> CmdResult<HaproxyServer> {
    state
        .lock()
        .await
        .get_server(&id, &backend, &server)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_set_server_state(
    state: State<'_, HaproxyServiceState>,
    id: String,
    backend: String,
    server: String,
    action: ServerAction,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .set_server_state(&id, &backend, &server, action)
        .await
        .map_err(map_err)
}

// ── ACLs ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn haproxy_list_acls(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<Vec<HaproxyAcl>> {
    state.lock().await.list_acls(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_get_acl(
    state: State<'_, HaproxyServiceState>,
    id: String,
    acl_id: String,
) -> CmdResult<Vec<AclEntry>> {
    state
        .lock()
        .await
        .get_acl(&id, &acl_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_add_acl_entry(
    state: State<'_, HaproxyServiceState>,
    id: String,
    acl_id: String,
    value: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .add_acl_entry(&id, &acl_id, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_del_acl_entry(
    state: State<'_, HaproxyServiceState>,
    id: String,
    acl_id: String,
    value: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .del_acl_entry(&id, &acl_id, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_clear_acl(
    state: State<'_, HaproxyServiceState>,
    id: String,
    acl_id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .clear_acl(&id, &acl_id)
        .await
        .map_err(map_err)
}

// ── Maps ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn haproxy_list_maps(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<Vec<HaproxyMap>> {
    state.lock().await.list_maps(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_get_map(
    state: State<'_, HaproxyServiceState>,
    id: String,
    map_id: String,
) -> CmdResult<Vec<MapEntry>> {
    state
        .lock()
        .await
        .get_map(&id, &map_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_add_map_entry(
    state: State<'_, HaproxyServiceState>,
    id: String,
    map_id: String,
    key: String,
    value: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .add_map_entry(&id, &map_id, &key, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_del_map_entry(
    state: State<'_, HaproxyServiceState>,
    id: String,
    map_id: String,
    key: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .del_map_entry(&id, &map_id, &key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_set_map_entry(
    state: State<'_, HaproxyServiceState>,
    id: String,
    map_id: String,
    key: String,
    value: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .set_map_entry(&id, &map_id, &key, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_clear_map(
    state: State<'_, HaproxyServiceState>,
    id: String,
    map_id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .clear_map(&id, &map_id)
        .await
        .map_err(map_err)
}

// ── Stick Tables ──────────────────────────────────────────────────

#[tauri::command]
pub async fn haproxy_list_stick_tables(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<Vec<StickTable>> {
    state
        .lock()
        .await
        .list_stick_tables(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_get_stick_table(
    state: State<'_, HaproxyServiceState>,
    id: String,
    name: String,
) -> CmdResult<Vec<StickTableEntry>> {
    state
        .lock()
        .await
        .get_stick_table(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_clear_stick_table(
    state: State<'_, HaproxyServiceState>,
    id: String,
    name: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .clear_stick_table(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_set_stick_table_entry(
    state: State<'_, HaproxyServiceState>,
    id: String,
    name: String,
    key: String,
    data: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .set_stick_table_entry(&id, &name, &key, &data)
        .await
        .map_err(map_err)
}

// ── Runtime ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn haproxy_runtime_execute(
    state: State<'_, HaproxyServiceState>,
    id: String,
    command: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .runtime_execute(&id, &command)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_show_servers_state(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .show_servers_state(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_show_sessions(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<Vec<SessionEntry>> {
    state.lock().await.show_sessions(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_show_backend_list(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .show_backend_list(&id)
        .await
        .map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn haproxy_get_raw_config(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_raw_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_update_raw_config(
    state: State<'_, HaproxyServiceState>,
    id: String,
    content: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_raw_config(&id, content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_validate_config(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<ConfigValidationResult> {
    state
        .lock()
        .await
        .validate_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_reload(state: State<'_, HaproxyServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reload_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_start(state: State<'_, HaproxyServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.start(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_stop(state: State<'_, HaproxyServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.stop(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_restart(state: State<'_, HaproxyServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.restart(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn haproxy_version(
    state: State<'_, HaproxyServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.version(&id).await.map_err(map_err)
}
