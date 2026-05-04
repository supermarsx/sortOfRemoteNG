// # opkssh Tauri Commands
//
// All `#[tauri::command]` handlers for the OpenPubkey SSH subsystem.
// Registered in the main Tauri `generate_handler![]` macro.

use super::login;
use super::service::OpksshServiceState;
use super::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

async fn reconcile_service_with_operation(
    service_state: &OpksshServiceState,
    operation: &login::OpksshLoginOperation,
) {
    let mut svc = service_state.lock().await;
    svc.track_login_operation(operation);
}

async fn clear_missing_operation_tracking(service_state: &OpksshServiceState, operation_id: &str) {
    let mut svc = service_state.lock().await;
    svc.clear_tracked_login_operation_if_matches(Some(operation_id));
}

async fn active_login_operation(
    service_state: &OpksshServiceState,
) -> CmdResult<Option<login::OpksshLoginOperation>> {
    let tracked_operation_id = {
        let svc = service_state.lock().await;
        svc.tracked_login_operation_id().map(str::to_string)
    };

    let Some(operation_id) = tracked_operation_id else {
        return Ok(None);
    };

    match login::get_login_operation(&operation_id).await? {
        Some(operation) => {
            reconcile_service_with_operation(service_state, &operation).await;
            if operation.status == login::OpksshLoginOperationStatus::Running {
                Ok(Some(operation))
            } else {
                Ok(None)
            }
        }
        None => {
            clear_missing_operation_tracking(service_state, &operation_id).await;
            Ok(None)
        }
    }
}

pub(crate) async fn start_login_operation_command(
    service_state: OpksshServiceState,
    options: OpksshLoginOptions,
) -> CmdResult<login::OpksshLoginOperation> {
    if let Some(active_operation) = active_login_operation(&service_state).await? {
        let message = {
            let mut svc = service_state.lock().await;
            svc.concurrent_login_message(&active_operation)
        };
        return Err(message);
    }

    let operation = login::start_login_operation(service_state.clone(), options).await?;
    reconcile_service_with_operation(&service_state, &operation).await;
    Ok(operation)
}

pub(crate) async fn get_login_operation_command(
    service_state: OpksshServiceState,
    operation_id: String,
) -> CmdResult<Option<login::OpksshLoginOperation>> {
    match login::get_login_operation(&operation_id).await? {
        Some(operation) => {
            reconcile_service_with_operation(&service_state, &operation).await;
            Ok(Some(operation))
        }
        None => {
            clear_missing_operation_tracking(&service_state, &operation_id).await;
            Ok(None)
        }
    }
}

pub(crate) async fn await_login_operation_command(
    service_state: OpksshServiceState,
    operation_id: String,
) -> CmdResult<login::OpksshLoginOperation> {
    let operation = login::await_login_operation(&operation_id).await?;
    reconcile_service_with_operation(&service_state, &operation).await;
    Ok(operation)
}

pub(crate) async fn cancel_login_operation_command(
    service_state: OpksshServiceState,
    operation_id: String,
) -> CmdResult<login::OpksshLoginOperation> {
    let operation = login::cancel_login_operation(&operation_id).await?;
    reconcile_service_with_operation(&service_state, &operation).await;
    Ok(operation)
}

pub(crate) async fn login_command(
    service_state: OpksshServiceState,
    options: OpksshLoginOptions,
) -> CmdResult<OpksshLoginResult> {
    let operation = start_login_operation_command(service_state.clone(), options).await?;
    let completed = await_login_operation_command(service_state, operation.id).await?;

    if let Some(result) = completed.result {
        return Ok(result);
    }

    Err(completed
        .message
        .unwrap_or_else(|| "OPKSSH login did not produce a result".to_string()))
}

// ── Binary Management ───────────────────────────────────────────────

/// Refresh runtime selection and return CLI fallback status for legacy callers.
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
    Ok(super::binary::download_url())
}

// ── OIDC Login ──────────────────────────────────────────────────────

/// Start an OPKSSH login operation that can later be polled, awaited, or cancelled.
#[tauri::command]
pub async fn opkssh_start_login(
    state: State<'_, OpksshServiceState>,
    options: OpksshLoginOptions,
) -> CmdResult<login::OpksshLoginOperation> {
    start_login_operation_command(state.inner().clone(), options).await
}

/// Get the latest snapshot for an OPKSSH login operation.
#[tauri::command]
pub async fn opkssh_get_login_operation(
    state: State<'_, OpksshServiceState>,
    operation_id: String,
) -> CmdResult<Option<login::OpksshLoginOperation>> {
    get_login_operation_command(state.inner().clone(), operation_id).await
}

/// Await completion of an OPKSSH login operation.
#[tauri::command]
pub async fn opkssh_await_login(
    state: State<'_, OpksshServiceState>,
    operation_id: String,
) -> CmdResult<login::OpksshLoginOperation> {
    await_login_operation_command(state.inner().clone(), operation_id).await
}

/// Cancel an OPKSSH login operation.
#[tauri::command]
pub async fn opkssh_cancel_login(
    state: State<'_, OpksshServiceState>,
    operation_id: String,
) -> CmdResult<login::OpksshLoginOperation> {
    cancel_login_operation_command(state.inner().clone(), operation_id).await
}

/// Execute `opkssh login` to authenticate via OIDC.
#[tauri::command]
pub async fn opkssh_login(
    state: State<'_, OpksshServiceState>,
    options: OpksshLoginOptions,
) -> CmdResult<OpksshLoginResult> {
    login_command(state.inner().clone(), options).await
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
