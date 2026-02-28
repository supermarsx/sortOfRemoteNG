use super::types::*;
use super::TERMINAL_BUFFERS;

// ===============================
// Core SSH Tauri Commands
// ===============================

#[tauri::command]
pub async fn connect_ssh(
    state: tauri::State<'_, SshServiceState>,
    config: SshConnectionConfig
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.connect_ssh(config).await
}

#[tauri::command]
pub async fn execute_command(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    command: String,
    timeout: Option<u64>
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.execute_command(&session_id, command, timeout).await
}

#[tauri::command]
pub async fn execute_command_interactive(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    command: String
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.execute_command_interactive(&session_id, command).await
}

#[tauri::command]
pub async fn start_shell(
    state: tauri::State<'_, SshServiceState>,
    app_handle: tauri::AppHandle,
    session_id: String
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.start_shell(&session_id, app_handle).await
}

#[tauri::command]
pub async fn send_ssh_input(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    data: String
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.send_shell_input(&session_id, data).await
}

#[tauri::command]
pub async fn resize_ssh_shell(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    cols: u32,
    rows: u32
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.resize_shell(&session_id, cols, rows).await
}

#[tauri::command]
pub async fn setup_port_forward(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    config: PortForwardConfig
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.setup_port_forward(&session_id, config).await
}

#[tauri::command]
pub async fn list_directory(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    path: String
) -> Result<Vec<String>, String> {
    let mut ssh = state.lock().await;
    let entries = ssh.list_directory(&session_id, &path).await?;
    Ok(entries.into_iter().map(|e| e.path.to_string()).collect())
}

#[tauri::command]
pub async fn upload_file(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.upload_file(&session_id, &local_path, &remote_path).await
}

#[tauri::command]
pub async fn download_file(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    remote_path: String,
    local_path: String
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.download_file(&session_id, &remote_path, &local_path).await
}

#[tauri::command]
pub async fn disconnect_ssh(
    state: tauri::State<'_, SshServiceState>,
    session_id: String
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.disconnect_ssh(&session_id).await
}

#[tauri::command]
pub async fn get_session_info(
    state: tauri::State<'_, SshServiceState>,
    session_id: String
) -> Result<SshSessionInfo, String> {
    let ssh = state.lock().await;
    ssh.get_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_sessions(
    state: tauri::State<'_, SshServiceState>
) -> Result<Vec<SshSessionInfo>, String> {
    let ssh = state.lock().await;
    Ok(ssh.list_sessions().await)
}

#[tauri::command]
pub async fn execute_script(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    script: String,
    interpreter: Option<String>
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.execute_script(&session_id, &script, interpreter.as_deref()).await
}

#[tauri::command]
pub async fn transfer_file_scp(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String,
    direction: TransferDirection
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.transfer_file_scp(&session_id, &local_path, &remote_path, direction).await
}

#[tauri::command]
pub async fn get_system_info(
    state: tauri::State<'_, SshServiceState>,
    session_id: String
) -> Result<SystemInfo, String> {
    let mut ssh = state.lock().await;
    ssh.get_system_info(&session_id).await
}

#[tauri::command]
pub async fn monitor_process(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    process_name: String
) -> Result<Vec<ProcessInfo>, String> {
    let mut ssh = state.lock().await;
    ssh.monitor_process(&session_id, &process_name).await
}

#[tauri::command]
pub async fn update_ssh_session_auth(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.update_session_auth(&session_id, password, private_key_path, private_key_passphrase).await
}

#[tauri::command]
pub async fn validate_ssh_key_file(
    state: tauri::State<'_, SshServiceState>,
    key_path: String,
    passphrase: Option<String>
) -> Result<bool, String> {
    let ssh = state.lock().await;
    ssh.validate_key_file(&key_path, passphrase.as_deref()).await
}

#[tauri::command]
pub async fn test_ssh_connection(
    state: tauri::State<'_, SshServiceState>,
    config: SshConnectionConfig
) -> Result<String, String> {
    let ssh = state.lock().await;
    ssh.test_ssh_connection(config).await
}

#[tauri::command]
pub async fn generate_ssh_key(
    state: tauri::State<'_, SshServiceState>,
    key_type: String,
    bits: Option<usize>,
    passphrase: Option<String>
) -> Result<(String, String), String> {
    let ssh = state.lock().await;
    ssh.generate_ssh_key(&key_type, bits, passphrase).await
}

/// Get the terminal buffer for a session
#[tauri::command]
pub fn get_terminal_buffer(session_id: String) -> Result<String, String> {
    let buffers = TERMINAL_BUFFERS.lock()
        .map_err(|e| format!("Failed to lock buffer: {}", e))?;
    Ok(buffers.get(&session_id).cloned().unwrap_or_default())
}

/// Clear the terminal buffer for a session
#[tauri::command]
pub fn clear_terminal_buffer(session_id: String) -> Result<(), String> {
    let mut buffers = TERMINAL_BUFFERS.lock()
        .map_err(|e| format!("Failed to lock buffer: {}", e))?;
    buffers.remove(&session_id);
    Ok(())
}

/// Check if an SSH session is still alive and has an active shell
#[tauri::command]
pub async fn is_session_alive(
    state: tauri::State<'_, SshServiceState>,
    session_id: String
) -> Result<bool, String> {
    let ssh = state.lock().await;
    if !ssh.sessions.contains_key(&session_id) {
        return Ok(false);
    }
    Ok(ssh.shells.contains_key(&session_id))
}

/// Get info about an active shell for a session
#[tauri::command]
pub async fn get_shell_info(
    state: tauri::State<'_, SshServiceState>,
    session_id: String
) -> Result<Option<String>, String> {
    let ssh = state.lock().await;
    if let Some(shell) = ssh.shells.get(&session_id) {
        Ok(Some(shell.id.clone()))
    } else {
        Ok(None)
    }
}

/// Reattach to an existing SSH session - restarts the shell event listeners
/// without creating a new connection
#[tauri::command]
pub async fn reattach_session(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    app_handle: tauri::AppHandle
) -> Result<String, String> {
    let mut ssh = state.lock().await;

    if !ssh.sessions.contains_key(&session_id) {
        return Err("Session not found - may have been disconnected".to_string());
    }

    if let Some(shell) = ssh.shells.get(&session_id) {
        return Ok(shell.id.clone());
    }

    ssh.start_shell(&session_id, app_handle).await
}
