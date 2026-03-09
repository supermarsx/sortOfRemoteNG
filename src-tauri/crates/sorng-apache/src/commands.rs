// ── sorng-apache/src/commands.rs ─────────────────────────────────────────────
//! Tauri commands – thin wrappers around `ApacheService`.

use crate::service::ApacheServiceState;
use crate::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn apache_connect(
    state: State<'_, ApacheServiceState>,
    id: String,
    config: ApacheConnectionConfig,
) -> CmdResult<ApacheConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_disconnect(state: State<'_, ApacheServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn apache_list_connections(
    state: State<'_, ApacheServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn apache_ping(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<ApacheConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Virtual Hosts ─────────────────────────────────────────────────

#[tauri::command]
pub async fn apache_list_vhosts(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<Vec<ApacheVhost>> {
    state.lock().await.list_vhosts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn apache_get_vhost(
    state: State<'_, ApacheServiceState>,
    id: String,
    name: String,
) -> CmdResult<ApacheVhost> {
    state
        .lock()
        .await
        .get_vhost(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_create_vhost(
    state: State<'_, ApacheServiceState>,
    id: String,
    request: CreateVhostRequest,
) -> CmdResult<ApacheVhost> {
    state
        .lock()
        .await
        .create_vhost(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_update_vhost(
    state: State<'_, ApacheServiceState>,
    id: String,
    name: String,
    request: UpdateVhostRequest,
) -> CmdResult<ApacheVhost> {
    state
        .lock()
        .await
        .update_vhost(&id, &name, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_delete_vhost(
    state: State<'_, ApacheServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_vhost(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_enable_vhost(
    state: State<'_, ApacheServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_vhost(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_disable_vhost(
    state: State<'_, ApacheServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_vhost(&id, &name)
        .await
        .map_err(map_err)
}

// ── Modules ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn apache_list_modules(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<Vec<ApacheModule>> {
    state.lock().await.list_modules(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn apache_list_available_modules(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_available_modules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_list_enabled_modules(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_enabled_modules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_enable_module(
    state: State<'_, ApacheServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_module(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_disable_module(
    state: State<'_, ApacheServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_module(&id, &name)
        .await
        .map_err(map_err)
}

// ── SSL ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn apache_get_ssl_config(
    state: State<'_, ApacheServiceState>,
    id: String,
    vhost_name: String,
) -> CmdResult<Option<ApacheSslConfig>> {
    state
        .lock()
        .await
        .get_ssl_config(&id, &vhost_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_list_ssl_certificates(
    state: State<'_, ApacheServiceState>,
    id: String,
    cert_dir: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_ssl_certificates(&id, &cert_dir)
        .await
        .map_err(map_err)
}

// ── Status ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn apache_get_status(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<ApacheServerStatus> {
    state.lock().await.get_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn apache_process_status(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<ApacheProcess> {
    state
        .lock()
        .await
        .process_status(&id)
        .await
        .map_err(map_err)
}

// ── Logs ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn apache_query_access_log(
    state: State<'_, ApacheServiceState>,
    id: String,
    query: LogQuery,
) -> CmdResult<Vec<ApacheAccessLogEntry>> {
    state
        .lock()
        .await
        .query_access_log(&id, query)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_query_error_log(
    state: State<'_, ApacheServiceState>,
    id: String,
    query: LogQuery,
) -> CmdResult<Vec<ApacheErrorLogEntry>> {
    state
        .lock()
        .await
        .query_error_log(&id, query)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_list_log_files(
    state: State<'_, ApacheServiceState>,
    id: String,
    log_dir: Option<String>,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_log_files(&id, log_dir)
        .await
        .map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn apache_get_main_config(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<ApacheMainConfig> {
    state
        .lock()
        .await
        .get_main_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_update_main_config(
    state: State<'_, ApacheServiceState>,
    id: String,
    content: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_main_config(&id, content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_test_config(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<ConfigTestResult> {
    state.lock().await.test_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn apache_list_conf_available(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_conf_available(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_list_conf_enabled(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_conf_enabled(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_enable_conf(
    state: State<'_, ApacheServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_conf(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apache_disable_conf(
    state: State<'_, ApacheServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_conf(&id, &name)
        .await
        .map_err(map_err)
}

// ── Process ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn apache_start(state: State<'_, ApacheServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.start(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn apache_stop(state: State<'_, ApacheServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.stop(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn apache_restart(state: State<'_, ApacheServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.restart(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn apache_reload(state: State<'_, ApacheServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reload(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn apache_version(state: State<'_, ApacheServiceState>, id: String) -> CmdResult<String> {
    state.lock().await.version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn apache_info(
    state: State<'_, ApacheServiceState>,
    id: String,
) -> CmdResult<ApacheInfo> {
    state.lock().await.info(&id).await.map_err(map_err)
}
