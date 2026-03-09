//! # opkssh Tauri Commands
//!
//! All `#[tauri::command]` handlers for the OpenPubkey SSH subsystem.
//! Registered in the main Tauri `generate_handler![]` macro.

use crate::service::OpksshServiceState;
use crate::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

// ── Binary Management ───────────────────────────────────────────────

/// Check if opkssh is installed and get version info.
#[tauri::command]
pub async fn opkssh_check_binary(
    state: State<'_, OpksshServiceState>,
) -> CmdResult<OpksshBinaryStatus> {
    let mut svc = state.lock().await;
    Ok(svc.check_binary().await)
}

/// Get the download URL for the current platform.
#[tauri::command]
pub async fn opkssh_get_download_url() -> CmdResult<String> {
    Ok(crate::binary::download_url())
}

// ── OIDC Login ──────────────────────────────────────────────────────

/// Execute `opkssh login` to authenticate via OIDC.
#[tauri::command]
pub async fn opkssh_login(
    state: State<'_, OpksshServiceState>,
    options: OpksshLoginOptions,
) -> CmdResult<OpksshLoginResult> {
    let mut svc = state.lock().await;
    svc.login(options).await
}

// ── Key Management ──────────────────────────────────────────────────

/// List all opkssh-generated keys on disk.
#[tauri::command]
pub async fn opkssh_list_keys(state: State<'_, OpksshServiceState>) -> CmdResult<Vec<OpksshKey>> {
    let mut svc = state.lock().await;
    Ok(svc.refresh_keys().await)
}

/// Remove an opkssh key pair from disk.
#[tauri::command]
pub async fn opkssh_remove_key(
    state: State<'_, OpksshServiceState>,
    key_path: String,
) -> CmdResult<()> {
    let mut svc = state.lock().await;
    svc.remove_key(&key_path).await
}

// ── Client Configuration ────────────────────────────────────────────

/// Read the local opkssh client configuration (~/.opk/config.yml + env vars).
#[tauri::command]
pub async fn opkssh_get_client_config(
    state: State<'_, OpksshServiceState>,
) -> CmdResult<OpksshClientConfig> {
    let mut svc = state.lock().await;
    Ok(svc.refresh_client_config().await)
}

/// Update the local opkssh client configuration.
#[tauri::command]
pub async fn opkssh_update_client_config(
    state: State<'_, OpksshServiceState>,
    config: OpksshClientConfig,
) -> CmdResult<()> {
    let mut svc = state.lock().await;
    svc.update_client_config(config).await
}

/// Get the list of well-known OIDC providers.
#[tauri::command]
pub async fn opkssh_well_known_providers(
    state: State<'_, OpksshServiceState>,
) -> CmdResult<Vec<CustomProvider>> {
    let svc = state.lock().await;
    Ok(svc.well_known_providers())
}

/// Build the OPKSSH_PROVIDERS environment variable string.
#[tauri::command]
pub async fn opkssh_build_env_string(
    state: State<'_, OpksshServiceState>,
) -> CmdResult<Option<String>> {
    let svc = state.lock().await;
    Ok(svc.build_env_providers_string())
}

// ── Server Policy (executed via SSH) ────────────────────────────────

/// Get the shell script to read the server's opkssh configuration.
#[tauri::command]
pub async fn opkssh_server_read_config_script(
    state: State<'_, OpksshServiceState>,
) -> CmdResult<String> {
    let svc = state.lock().await;
    Ok(svc.build_read_config_script())
}

/// Parse the raw output from the server config read script.
#[tauri::command]
pub async fn opkssh_parse_server_config(
    state: State<'_, OpksshServiceState>,
    session_id: String,
    raw_output: String,
) -> CmdResult<ServerOpksshConfig> {
    let mut svc = state.lock().await;
    Ok(svc.parse_server_config(&session_id, &raw_output))
}

/// Get the cached server config for a session.
#[tauri::command]
pub async fn opkssh_get_server_config(
    state: State<'_, OpksshServiceState>,
    session_id: String,
) -> CmdResult<Option<ServerOpksshConfig>> {
    let svc = state.lock().await;
    Ok(svc.get_server_config(&session_id).cloned())
}

/// Build the command to add an authorized identity on the server.
#[tauri::command]
pub async fn opkssh_build_add_identity_cmd(
    state: State<'_, OpksshServiceState>,
    entry: AuthIdEntry,
) -> CmdResult<String> {
    let svc = state.lock().await;
    Ok(svc.build_add_identity_command(&entry))
}

/// Build the command to remove an authorized identity.
#[tauri::command]
pub async fn opkssh_build_remove_identity_cmd(
    state: State<'_, OpksshServiceState>,
    entry: AuthIdEntry,
    user_level: bool,
) -> CmdResult<String> {
    let svc = state.lock().await;
    Ok(svc.build_remove_identity_command(&entry, user_level))
}

/// Build the command to add a provider on the server.
#[tauri::command]
pub async fn opkssh_build_add_provider_cmd(
    state: State<'_, OpksshServiceState>,
    entry: ProviderEntry,
) -> CmdResult<String> {
    let svc = state.lock().await;
    Ok(svc.build_add_provider_command(&entry))
}

/// Build the command to remove a provider on the server.
#[tauri::command]
pub async fn opkssh_build_remove_provider_cmd(
    state: State<'_, OpksshServiceState>,
    entry: ProviderEntry,
) -> CmdResult<String> {
    let svc = state.lock().await;
    Ok(svc.build_remove_provider_command(&entry))
}

/// Build the server install command.
#[tauri::command]
pub async fn opkssh_build_install_cmd(
    state: State<'_, OpksshServiceState>,
    options: ServerInstallOptions,
) -> CmdResult<String> {
    let svc = state.lock().await;
    Ok(svc.build_install_command(&options))
}

// ── Audit ───────────────────────────────────────────────────────────

/// Build the audit command to run on a server.
#[tauri::command]
pub async fn opkssh_build_audit_cmd(
    _state: State<'_, OpksshServiceState>,
    principal: Option<String>,
    limit: Option<usize>,
) -> CmdResult<String> {
    let _svc = _state.lock().await;
    Ok(_svc.build_audit_command(principal.as_deref(), limit))
}

/// Parse raw audit output into structured data.
#[tauri::command]
pub async fn opkssh_parse_audit_output(
    state: State<'_, OpksshServiceState>,
    session_id: String,
    raw_output: String,
) -> CmdResult<AuditResult> {
    let mut svc = state.lock().await;
    Ok(svc.parse_audit_output(&session_id, &raw_output))
}

/// Get cached audit results for a session.
#[tauri::command]
pub async fn opkssh_get_audit_results(
    state: State<'_, OpksshServiceState>,
    session_id: String,
) -> CmdResult<Option<AuditResult>> {
    let svc = state.lock().await;
    Ok(svc.get_audit_result(&session_id).cloned())
}

// ── Overall Status ──────────────────────────────────────────────────

/// Get the full opkssh integration status.
#[tauri::command]
pub async fn opkssh_get_status(state: State<'_, OpksshServiceState>) -> CmdResult<OpksshStatus> {
    let mut svc = state.lock().await;
    Ok(svc.get_status().await)
}
