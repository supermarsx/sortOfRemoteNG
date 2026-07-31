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

/// Mark a connection's ProxyCommand as user-confirmed for execution.
///
/// ProxyCommand stays fully free-form (OpenSSH parity). The only constraint is
/// an anti-malicious-import gate: a ProxyCommand whose config has
/// `command_confirmed == false` (the default for imported/synced configs) is
/// refused at spawn time with `PROXY_COMMAND_CONFIRMATION_REQUIRED`. The
/// Wave-2 UI shows the user the (redacted) command via `expand_proxy_command`,
/// and once they confirm it calls THIS command with the SAME
/// `config`/`host`/`port`/`username` it would connect with. The backend rebuilds
/// the exact expanded command string and records its fingerprint as confirmed,
/// so exactly one subsequent connect attempt is allowed through.
///
/// Confirmation is one-shot and fingerprint-scoped to the exact expanded
/// command: editing or re-importing a different command re-arms the gate.
/// Returns the redacted confirmed command for display/audit.
#[tauri::command]
pub fn confirm_proxy_command(
    config: ProxyCommandConfig,
    host: String,
    port: u16,
    username: String,
) -> Result<String, String> {
    let cmd_string = build_command_string(&config, &host, port, &username)?;
    mark_proxy_command_confirmed(&cmd_string);
    Ok(redact_proxy_credentials(&cmd_string))
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
