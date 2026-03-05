// ── sorng-nginx/src/commands.rs ──────────────────────────────────────────────
//! Tauri commands – thin wrappers around `NginxService`.

use tauri::State;
use crate::service::NginxServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn ngx_connect(
    state: State<'_, NginxServiceState>,
    id: String,
    config: NginxConnectionConfig,
) -> CmdResult<NginxConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_disconnect(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn ngx_list_connections(
    state: State<'_, NginxServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

// ── Sites ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ngx_list_sites(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<Vec<NginxSite>> {
    state.lock().await.list_sites(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_get_site(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
) -> CmdResult<NginxSite> {
    state.lock().await.get_site(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_create_site(
    state: State<'_, NginxServiceState>,
    id: String,
    request: CreateSiteRequest,
) -> CmdResult<NginxSite> {
    state.lock().await.create_site(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_update_site(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
    request: UpdateSiteRequest,
) -> CmdResult<NginxSite> {
    state.lock().await.update_site(&id, &name, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_delete_site(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_site(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_enable_site(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.enable_site(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_disable_site(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.disable_site(&id, &name).await.map_err(map_err)
}

// ── Upstreams ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn ngx_list_upstreams(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<Vec<NginxUpstream>> {
    state.lock().await.list_upstreams(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_get_upstream(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
) -> CmdResult<NginxUpstream> {
    state.lock().await.get_upstream(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_create_upstream(
    state: State<'_, NginxServiceState>,
    id: String,
    request: CreateUpstreamRequest,
) -> CmdResult<NginxUpstream> {
    state.lock().await.create_upstream(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_update_upstream(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
    request: CreateUpstreamRequest,
) -> CmdResult<NginxUpstream> {
    state.lock().await.update_upstream(&id, &name, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_delete_upstream(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_upstream(&id, &name).await.map_err(map_err)
}

// ── SSL ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ngx_get_ssl_config(
    state: State<'_, NginxServiceState>,
    id: String,
    site_name: String,
) -> CmdResult<Option<SslConfig>> {
    state.lock().await.get_ssl_config(&id, &site_name).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_update_ssl_config(
    state: State<'_, NginxServiceState>,
    id: String,
    site_name: String,
    ssl: SslConfig,
) -> CmdResult<()> {
    state.lock().await.update_ssl_config(&id, &site_name, ssl).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_list_ssl_certificates(
    state: State<'_, NginxServiceState>,
    id: String,
    cert_dir: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_ssl_certificates(&id, &cert_dir).await.map_err(map_err)
}

// ── Status ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ngx_stub_status(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<NginxStubStatus> {
    state.lock().await.stub_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_process_status(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<NginxProcess> {
    state.lock().await.process_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_health_check(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<NginxHealthCheck> {
    state.lock().await.health_check(&id).await.map_err(map_err)
}

// ── Logs ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ngx_query_access_log(
    state: State<'_, NginxServiceState>,
    id: String,
    query: LogQuery,
) -> CmdResult<Vec<AccessLogEntry>> {
    state.lock().await.query_access_log(&id, query).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_query_error_log(
    state: State<'_, NginxServiceState>,
    id: String,
    query: LogQuery,
) -> CmdResult<Vec<ErrorLogEntry>> {
    state.lock().await.query_error_log(&id, query).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_list_log_files(
    state: State<'_, NginxServiceState>,
    id: String,
    log_dir: Option<String>,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_log_files(&id, log_dir).await.map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ngx_get_main_config(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<NginxMainConfig> {
    state.lock().await.get_main_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_update_main_config(
    state: State<'_, NginxServiceState>,
    id: String,
    content: String,
) -> CmdResult<()> {
    state.lock().await.update_main_config(&id, content).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_test_config(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<ConfigTestResult> {
    state.lock().await.test_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_list_snippets(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<Vec<NginxSnippet>> {
    state.lock().await.list_snippets(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_get_snippet(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
) -> CmdResult<NginxSnippet> {
    state.lock().await.get_snippet(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_create_snippet(
    state: State<'_, NginxServiceState>,
    id: String,
    request: CreateSnippetRequest,
) -> CmdResult<NginxSnippet> {
    state.lock().await.create_snippet(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_update_snippet(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
    content: String,
) -> CmdResult<NginxSnippet> {
    state.lock().await.update_snippet(&id, &name, content).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_delete_snippet(
    state: State<'_, NginxServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_snippet(&id, &name).await.map_err(map_err)
}

// ── Process ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn ngx_start(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.start(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_stop(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.stop(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_restart(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.restart(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_reload(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.reload(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_version(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn ngx_info(
    state: State<'_, NginxServiceState>,
    id: String,
) -> CmdResult<NginxInfo> {
    state.lock().await.info(&id).await.map_err(map_err)
}
