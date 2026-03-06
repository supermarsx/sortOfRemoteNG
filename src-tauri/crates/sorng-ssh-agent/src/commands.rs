//! # SSH Agent Tauri Commands
//!
//! All `#[tauri::command]` handlers for the SSH agent subsystem.
//! Registered in the main Tauri `generate_handler![]` macro.

use crate::service::SshAgentService;
use crate::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

// ── Service Lifecycle ───────────────────────────────────────────────

/// Get the SSH agent service status.
#[tauri::command]
pub async fn ssh_agent_get_status(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<AgentStatus> {
    let svc = state.lock().await;
    Ok(svc.status().clone())
}

/// Start the SSH agent service.
#[tauri::command]
pub async fn ssh_agent_start(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<()> {
    state.lock().await.start().await
}

/// Stop the SSH agent service.
#[tauri::command]
pub async fn ssh_agent_stop(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<()> {
    state.lock().await.stop().await
}

/// Restart the SSH agent service.
#[tauri::command]
pub async fn ssh_agent_restart(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<()> {
    state.lock().await.restart().await
}

/// Get the SSH agent configuration.
#[tauri::command]
pub async fn ssh_agent_get_config(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<AgentConfig> {
    let svc = state.lock().await;
    Ok(svc.config().clone())
}

/// Update the SSH agent configuration.
#[tauri::command]
pub async fn ssh_agent_update_config(
    state: State<'_, SshAgentServiceState>,
    config: AgentConfig,
) -> CmdResult<()> {
    state.lock().await.update_config(config);
    Ok(())
}

// ── Key Management ──────────────────────────────────────────────────

/// List all loaded keys (built-in + system agent).
#[tauri::command]
pub async fn ssh_agent_list_keys(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<Vec<AgentKey>> {
    let mut svc = state.lock().await;
    Ok(svc.list_all_keys().await)
}

/// Add a key to the built-in agent.
#[tauri::command]
pub async fn ssh_agent_add_key(
    state: State<'_, SshAgentServiceState>,
    key: AgentKey,
) -> CmdResult<String> {
    state.lock().await.add_key(key)
}

/// Remove a key by ID.
#[tauri::command]
pub async fn ssh_agent_remove_key(
    state: State<'_, SshAgentServiceState>,
    key_id: String,
) -> CmdResult<()> {
    state.lock().await.remove_key(&key_id)
}

/// Remove all keys.
#[tauri::command]
pub async fn ssh_agent_remove_all_keys(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<usize> {
    Ok(state.lock().await.remove_all_keys())
}

/// Lock the agent with a passphrase.
#[tauri::command]
pub async fn ssh_agent_lock(
    state: State<'_, SshAgentServiceState>,
    passphrase: String,
) -> CmdResult<()> {
    state.lock().await.lock(&passphrase)
}

/// Unlock the agent.
#[tauri::command]
pub async fn ssh_agent_unlock(
    state: State<'_, SshAgentServiceState>,
    passphrase: String,
) -> CmdResult<()> {
    state.lock().await.unlock(&passphrase)
}

// ── System Agent Bridge ─────────────────────────────────────────────

/// Connect to the system SSH agent.
#[tauri::command]
pub async fn ssh_agent_connect_system(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<()> {
    state.lock().await.connect_system_agent().await
}

/// Disconnect from the system SSH agent.
#[tauri::command]
pub async fn ssh_agent_disconnect_system(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<()> {
    state.lock().await.disconnect_system_agent();
    Ok(())
}

/// Set the system agent socket path.
#[tauri::command]
pub async fn ssh_agent_set_system_path(
    state: State<'_, SshAgentServiceState>,
    path: String,
) -> CmdResult<()> {
    state.lock().await.set_system_agent_path(&path);
    Ok(())
}

/// Discover the system agent socket path.
#[tauri::command]
pub async fn ssh_agent_discover_system() -> CmdResult<Option<String>> {
    Ok(crate::bridge::SystemAgentBridge::discover_socket_path())
}

// ── Agent Forwarding ────────────────────────────────────────────────

/// Start an agent forwarding session.
#[tauri::command]
pub async fn ssh_agent_start_forwarding(
    state: State<'_, SshAgentServiceState>,
    session_id: String,
    remote_host: String,
    remote_user: String,
    depth: u32,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .start_forwarding(&session_id, &remote_host, &remote_user, depth)
}

/// Stop a forwarding session.
#[tauri::command]
pub async fn ssh_agent_stop_forwarding(
    state: State<'_, SshAgentServiceState>,
    session_id: String,
) -> CmdResult<()> {
    state.lock().await.stop_forwarding(&session_id)
}

/// List active forwarding sessions.
#[tauri::command]
pub async fn ssh_agent_list_forwarding(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<Vec<ForwardingSession>> {
    let svc = state.lock().await;
    Ok(svc
        .forwarding
        .active_sessions()
        .into_iter()
        .cloned()
        .collect())
}

// ── Audit Log ───────────────────────────────────────────────────────

/// Get recent audit log entries.
#[tauri::command]
pub async fn ssh_agent_audit_log(
    state: State<'_, SshAgentServiceState>,
    count: Option<usize>,
) -> CmdResult<Vec<AuditEntry>> {
    let svc = state.lock().await;
    Ok(svc
        .recent_audit_entries(count.unwrap_or(100))
        .into_iter()
        .cloned()
        .collect())
}

/// Export the full audit log as JSON.
#[tauri::command]
pub async fn ssh_agent_export_audit(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<String> {
    let svc = state.lock().await;
    svc.export_audit_log()
}

/// Clear the audit log.
#[tauri::command]
pub async fn ssh_agent_clear_audit(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<()> {
    state.lock().await.clear_audit_log();
    Ok(())
}

// ── Maintenance ─────────────────────────────────────────────────────

/// Run periodic maintenance (expire keys, clean confirmations).
#[tauri::command]
pub async fn ssh_agent_run_maintenance(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<()> {
    state.lock().await.run_maintenance();
    Ok(())
}

// ── PKCS#11 / Hardware Key Commands ─────────────────────────────────

/// Load a PKCS#11 provider library (smart card / HSM).
#[tauri::command]
pub async fn ssh_agent_load_pkcs11(
    state: State<'_, SshAgentServiceState>,
    provider_path: String,
) -> CmdResult<Vec<crate::types::Pkcs11SlotInfo>> {
    let mut svc = state.lock().await;
    svc.load_pkcs11_provider(&provider_path)
}

/// Unload a PKCS#11 provider library.
#[tauri::command]
pub async fn ssh_agent_unload_pkcs11(
    state: State<'_, SshAgentServiceState>,
    provider_path: String,
) -> CmdResult<()> {
    let mut svc = state.lock().await;
    svc.unload_pkcs11_provider(&provider_path)
}

/// List all loaded PKCS#11 providers.
#[tauri::command]
pub async fn ssh_agent_list_pkcs11_providers(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<Vec<crate::types::Pkcs11ProviderStatus>> {
    let svc = state.lock().await;
    Ok(svc.list_pkcs11_providers())
}

/// Get slots for a specific PKCS#11 provider.
#[tauri::command]
pub async fn ssh_agent_get_pkcs11_slots(
    state: State<'_, SshAgentServiceState>,
    provider_path: String,
) -> CmdResult<Vec<crate::types::Pkcs11SlotInfo>> {
    let svc = state.lock().await;
    svc.get_pkcs11_slots(&provider_path)
}

/// Add keys from a smart card provider.
#[tauri::command]
pub async fn ssh_agent_add_smartcard_key(
    state: State<'_, SshAgentServiceState>,
    provider: String,
    pin: Option<String>,
) -> CmdResult<usize> {
    let mut svc = state.lock().await;
    svc.add_smartcard_key(&provider, pin.as_deref())
}

/// Remove keys from a smart card provider.
#[tauri::command]
pub async fn ssh_agent_remove_smartcard_key(
    state: State<'_, SshAgentServiceState>,
    provider: String,
) -> CmdResult<usize> {
    let mut svc = state.lock().await;
    svc.remove_smartcard_key(&provider)
}

/// List all FIDO2 / security-key-backed keys.
#[tauri::command]
pub async fn ssh_agent_list_security_keys(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<Vec<crate::types::AgentKey>> {
    let svc = state.lock().await;
    Ok(svc.list_security_keys())
}

/// Enroll a new FIDO2 security key.
#[tauri::command]
pub async fn ssh_agent_add_security_key(
    state: State<'_, SshAgentServiceState>,
    sk_provider: Option<String>,
    application: Option<String>,
    user: Option<String>,
    pin_required: bool,
    touch_required: bool,
    verify_required: bool,
    resident: bool,
) -> CmdResult<String> {
    let mut svc = state.lock().await;
    svc.add_security_key(
        sk_provider.as_deref(),
        application.as_deref(),
        user.as_deref(),
        pin_required,
        touch_required,
        verify_required,
        resident,
    )
}

/// Get pending sign-request confirmations.
#[tauri::command]
pub async fn ssh_agent_get_pending_confirm(
    state: State<'_, SshAgentServiceState>,
) -> CmdResult<Vec<crate::types::PendingSignRequest>> {
    let svc = state.lock().await;
    Ok(svc.get_pending_confirmations())
}

/// Approve or deny a pending sign request.
#[tauri::command]
pub async fn ssh_agent_confirm_sign(
    state: State<'_, SshAgentServiceState>,
    request_id: String,
    approved: bool,
) -> CmdResult<()> {
    let mut svc = state.lock().await;
    svc.confirm_sign_request(&request_id, approved)
}

/// Get detailed info about a specific key.
#[tauri::command]
pub async fn ssh_agent_get_key_details(
    state: State<'_, SshAgentServiceState>,
    key_id: String,
) -> CmdResult<crate::types::AgentKey> {
    let svc = state.lock().await;
    svc.get_key_details(&key_id)
}

/// Update the comment on a loaded key.
#[tauri::command]
pub async fn ssh_agent_update_key_comment(
    state: State<'_, SshAgentServiceState>,
    key_id: String,
    comment: String,
) -> CmdResult<()> {
    let mut svc = state.lock().await;
    svc.update_key_comment(&key_id, &comment)
}

/// Update the constraints on a loaded key.
#[tauri::command]
pub async fn ssh_agent_update_key_constraints(
    state: State<'_, SshAgentServiceState>,
    key_id: String,
    constraints: Vec<crate::types::KeyConstraint>,
) -> CmdResult<()> {
    let mut svc = state.lock().await;
    svc.update_key_constraints(&key_id, constraints)
}

/// Export a public key in the requested format ("openssh" or "pem").
#[tauri::command]
pub async fn ssh_agent_export_public_key(
    state: State<'_, SshAgentServiceState>,
    key_id: String,
    format: String,
) -> CmdResult<String> {
    let svc = state.lock().await;
    svc.export_public_key(&key_id, &format)
}
