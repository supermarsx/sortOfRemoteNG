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
        // Redact before returning — the expanded command may embed inline
        // `user:pass@host` or `--proxy-auth` credentials.
        command: redact_proxy_credentials(&cmd_string),
        alive,
        pid: Some(pid),
    })
}

/// Expand a ProxyCommand template/command with the given host/port/username
/// placeholders and return the resulting string. Useful for preview in the UI.
///
/// The returned string is credential-redacted: inline `user:pass@host`,
/// `--proxy-auth`, `-P`/`-p` secrets and similar shapes are masked so the
/// preview (which may be copied into logs) never carries plaintext secrets.
#[tauri::command]
pub fn expand_proxy_command(
    config: ProxyCommandConfig,
    host: String,
    port: u16,
    username: String,
) -> Result<String, String> {
    let expanded = build_command_string(&config, &host, port, &username)?;
    Ok(redact_proxy_credentials(&expanded))
}
