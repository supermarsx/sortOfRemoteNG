use super::x11::*;

/// Enable X11 forwarding on an SSH session.
#[tauri::command]
pub async fn enable_x11_forwarding(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    config: X11ForwardingConfig,
) -> Result<X11ForwardInfo, String> {
    let mut ssh = state.lock().await;
    ssh.enable_x11_forwarding(&session_id, config)
}

/// Disable X11 forwarding on an SSH session.
#[tauri::command]
pub async fn disable_x11_forwarding(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.disable_x11_forwarding(&session_id)
}

/// Get X11 forwarding status for a session.
#[tauri::command]
pub async fn get_x11_forward_status(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
) -> Result<X11ForwardStatus, String> {
    let ssh = state.lock().await;
    ssh.get_x11_forward_status(&session_id)
}

/// List all active X11 forwards across all sessions.
#[tauri::command]
pub fn list_x11_forwards() -> Result<Vec<X11ForwardStatus>, String> {
    let fwds = X11_FORWARDS
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(fwds
        .values()
        .map(|state| X11ForwardStatus {
            session_id: state.session_id.clone(),
            enabled: true,
            info: Some(X11ForwardInfo {
                session_id: state.session_id.clone(),
                remote_display: state.remote_display.clone(),
                local_bind: state.local_bind.clone(),
                trusted: state.trusted,
                active_channels: state
                    .active_channels
                    .load(std::sync::atomic::Ordering::Relaxed),
                total_channels_opened: state.total_channels_opened,
            }),
        })
        .collect())
}
