// ── sorng-nginx-proxy-mgr/src/commands.rs ────────────────────────────────────
//! Tauri commands – thin wrappers around `NpmService`.

use tauri::State;
use crate::service::NpmServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn npm_connect(
    state: State<'_, NpmServiceState>,
    id: String,
    config: NpmConnectionConfig,
) -> CmdResult<NpmConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_disconnect(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn npm_list_connections(
    state: State<'_, NpmServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn npm_ping(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<NpmConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Proxy Hosts ───────────────────────────────────────────────────

#[tauri::command]
pub async fn npm_list_proxy_hosts(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<Vec<NpmProxyHost>> {
    state.lock().await.list_proxy_hosts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_proxy_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
) -> CmdResult<NpmProxyHost> {
    state.lock().await.get_proxy_host(&id, host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_create_proxy_host(
    state: State<'_, NpmServiceState>,
    id: String,
    request: CreateProxyHostRequest,
) -> CmdResult<NpmProxyHost> {
    state.lock().await.create_proxy_host(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_update_proxy_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
    request: UpdateProxyHostRequest,
) -> CmdResult<NpmProxyHost> {
    state.lock().await.update_proxy_host(&id, host_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_delete_proxy_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
) -> CmdResult<()> {
    state.lock().await.delete_proxy_host(&id, host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_enable_proxy_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
) -> CmdResult<NpmProxyHost> {
    state.lock().await.enable_proxy_host(&id, host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_disable_proxy_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
) -> CmdResult<NpmProxyHost> {
    state.lock().await.disable_proxy_host(&id, host_id).await.map_err(map_err)
}

// ── Redirection Hosts ─────────────────────────────────────────────

#[tauri::command]
pub async fn npm_list_redirection_hosts(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<Vec<NpmRedirectionHost>> {
    state.lock().await.list_redirection_hosts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_redirection_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
) -> CmdResult<NpmRedirectionHost> {
    state.lock().await.get_redirection_host(&id, host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_create_redirection_host(
    state: State<'_, NpmServiceState>,
    id: String,
    request: CreateRedirectionHostRequest,
) -> CmdResult<NpmRedirectionHost> {
    state.lock().await.create_redirection_host(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_update_redirection_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
    request: CreateRedirectionHostRequest,
) -> CmdResult<NpmRedirectionHost> {
    state.lock().await.update_redirection_host(&id, host_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_delete_redirection_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
) -> CmdResult<()> {
    state.lock().await.delete_redirection_host(&id, host_id).await.map_err(map_err)
}

// ── Dead Hosts ────────────────────────────────────────────────────

#[tauri::command]
pub async fn npm_list_dead_hosts(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<Vec<NpmDeadHost>> {
    state.lock().await.list_dead_hosts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_dead_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
) -> CmdResult<NpmDeadHost> {
    state.lock().await.get_dead_host(&id, host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_create_dead_host(
    state: State<'_, NpmServiceState>,
    id: String,
    request: CreateDeadHostRequest,
) -> CmdResult<NpmDeadHost> {
    state.lock().await.create_dead_host(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_update_dead_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
    request: CreateDeadHostRequest,
) -> CmdResult<NpmDeadHost> {
    state.lock().await.update_dead_host(&id, host_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_delete_dead_host(
    state: State<'_, NpmServiceState>,
    id: String,
    host_id: u64,
) -> CmdResult<()> {
    state.lock().await.delete_dead_host(&id, host_id).await.map_err(map_err)
}

// ── Streams ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn npm_list_streams(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<Vec<NpmStream>> {
    state.lock().await.list_streams(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_stream(
    state: State<'_, NpmServiceState>,
    id: String,
    stream_id: u64,
) -> CmdResult<NpmStream> {
    state.lock().await.get_stream(&id, stream_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_create_stream(
    state: State<'_, NpmServiceState>,
    id: String,
    request: CreateStreamRequest,
) -> CmdResult<NpmStream> {
    state.lock().await.create_stream(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_update_stream(
    state: State<'_, NpmServiceState>,
    id: String,
    stream_id: u64,
    request: CreateStreamRequest,
) -> CmdResult<NpmStream> {
    state.lock().await.update_stream(&id, stream_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_delete_stream(
    state: State<'_, NpmServiceState>,
    id: String,
    stream_id: u64,
) -> CmdResult<()> {
    state.lock().await.delete_stream(&id, stream_id).await.map_err(map_err)
}

// ── Certificates ──────────────────────────────────────────────────

#[tauri::command]
pub async fn npm_list_certificates(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<Vec<NpmCertificate>> {
    state.lock().await.list_certificates(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_certificate(
    state: State<'_, NpmServiceState>,
    id: String,
    cert_id: u64,
) -> CmdResult<NpmCertificate> {
    state.lock().await.get_certificate(&id, cert_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_create_letsencrypt_certificate(
    state: State<'_, NpmServiceState>,
    id: String,
    request: CreateLetsEncryptCertRequest,
) -> CmdResult<NpmCertificate> {
    state.lock().await.create_letsencrypt_certificate(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_upload_custom_certificate(
    state: State<'_, NpmServiceState>,
    id: String,
    request: UploadCustomCertRequest,
) -> CmdResult<NpmCertificate> {
    state.lock().await.upload_custom_certificate(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_delete_certificate(
    state: State<'_, NpmServiceState>,
    id: String,
    cert_id: u64,
) -> CmdResult<()> {
    state.lock().await.delete_certificate(&id, cert_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_renew_certificate(
    state: State<'_, NpmServiceState>,
    id: String,
    cert_id: u64,
) -> CmdResult<NpmCertificate> {
    state.lock().await.renew_certificate(&id, cert_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_validate_certificate(
    state: State<'_, NpmServiceState>,
    id: String,
    cert_id: u64,
) -> CmdResult<serde_json::Value> {
    state.lock().await.validate_certificate(&id, cert_id).await.map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn npm_list_users(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<Vec<NpmUser>> {
    state.lock().await.list_users(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_user(
    state: State<'_, NpmServiceState>,
    id: String,
    user_id: u64,
) -> CmdResult<NpmUser> {
    state.lock().await.get_user(&id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_create_user(
    state: State<'_, NpmServiceState>,
    id: String,
    request: CreateUserRequest,
) -> CmdResult<NpmUser> {
    state.lock().await.create_user(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_update_user(
    state: State<'_, NpmServiceState>,
    id: String,
    user_id: u64,
    request: UpdateUserRequest,
) -> CmdResult<NpmUser> {
    state.lock().await.update_user(&id, user_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_delete_user(
    state: State<'_, NpmServiceState>,
    id: String,
    user_id: u64,
) -> CmdResult<()> {
    state.lock().await.delete_user(&id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_change_user_password(
    state: State<'_, NpmServiceState>,
    id: String,
    user_id: u64,
    request: ChangePasswordRequest,
) -> CmdResult<()> {
    state.lock().await.change_user_password(&id, user_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_me(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<NpmUser> {
    state.lock().await.get_me(&id).await.map_err(map_err)
}

// ── Access Lists ──────────────────────────────────────────────────

#[tauri::command]
pub async fn npm_list_access_lists(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<Vec<NpmAccessList>> {
    state.lock().await.list_access_lists(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_access_list(
    state: State<'_, NpmServiceState>,
    id: String,
    list_id: u64,
) -> CmdResult<NpmAccessList> {
    state.lock().await.get_access_list(&id, list_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_create_access_list(
    state: State<'_, NpmServiceState>,
    id: String,
    request: CreateAccessListRequest,
) -> CmdResult<NpmAccessList> {
    state.lock().await.create_access_list(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_update_access_list(
    state: State<'_, NpmServiceState>,
    id: String,
    list_id: u64,
    request: CreateAccessListRequest,
) -> CmdResult<NpmAccessList> {
    state.lock().await.update_access_list(&id, list_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_delete_access_list(
    state: State<'_, NpmServiceState>,
    id: String,
    list_id: u64,
) -> CmdResult<()> {
    state.lock().await.delete_access_list(&id, list_id).await.map_err(map_err)
}

// ── Settings ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn npm_list_settings(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<Vec<NpmSetting>> {
    state.lock().await.list_settings(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_setting(
    state: State<'_, NpmServiceState>,
    id: String,
    setting_id: String,
) -> CmdResult<NpmSetting> {
    state.lock().await.get_setting(&id, &setting_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_update_setting(
    state: State<'_, NpmServiceState>,
    id: String,
    setting_id: String,
    value: serde_json::Value,
) -> CmdResult<NpmSetting> {
    state.lock().await.update_setting(&id, &setting_id, value).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_reports(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<NpmReports> {
    state.lock().await.get_reports(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_audit_log(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<Vec<NpmAuditLogEntry>> {
    state.lock().await.get_audit_log(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn npm_get_health(
    state: State<'_, NpmServiceState>,
    id: String,
) -> CmdResult<NpmHealthStatus> {
    state.lock().await.get_health(&id).await.map_err(map_err)
}
