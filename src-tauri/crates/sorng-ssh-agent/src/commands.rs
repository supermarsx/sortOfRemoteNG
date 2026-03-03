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
