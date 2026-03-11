use super::proxy_command::*;

/// Get the status of a ProxyCommand for an SSH session.
#[tauri::command]
pub fn get_proxy_command_info(session_id: String) -> Result<Option<ProxyCommandStatus>, String> {
    get_proxy_command_status(&session_id)
}

/// Stop a running ProxyCommand for an SSH session.
#[tauri::command]
pub fn stop_proxy_command_cmd(session_id: String) -> Result<(), String> {
    stop_proxy_command(&session_id)
}

/// Test a ProxyCommand — spawn it, wait for the first byte of output,
/// then kill it.  Returns the expanded command and whether it connected.
#[tauri::command]
pub async fn test_proxy_command(
    config: ProxyCommandConfig,
    host: String,
    port: u16,
    username: String,
) -> Result<ProxyCommandStatus, String> {
    let cmd_string = build_command_string(&config, &host, port, &username)?;

    let mut child =
        spawn_shell_command(&cmd_string).map_err(|e| format!("Failed to spawn: {}", e))?;

    let pid = child.id();

    // Wait a short time to see if it starts successfully
    let timeout = config.timeout_secs.unwrap_or(5);
    let alive = tokio::task::spawn_blocking(move || {
        std::thread::sleep(Duration::from_secs(timeout.min(5)));
        match child.try_wait() {
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                true // still running = probably connected
            }
            Ok(Some(status)) => status.success(),
            Err(_) => false,
        }
    })
    .await
    .unwrap_or(false);

    Ok(ProxyCommandStatus {
        session_id: String::new(),
        command: cmd_string,
        alive,
        pid: Some(pid),
    })
}

/// Expand a ProxyCommand template/command with the given host/port/username
/// placeholders and return the resulting string. Useful for preview in the UI.
#[tauri::command]
pub fn expand_proxy_command(
    config: ProxyCommandConfig,
    host: String,
    port: u16,
    username: String,
) -> Result<String, String> {
    build_command_string(&config, &host, port, &username)
}
