//! fail2ban-client command execution — local and remote (SSH) support.

use crate::error::Fail2banError;
use crate::types::{Fail2banHost, SshConfig};
use log::{debug, info};
use tokio::process::Command;

/// Execute a fail2ban-client command on a host (local or remote).
///
/// Returns (stdout, stderr, exit_code).
pub async fn exec(
    host: &Fail2banHost,
    args: &[&str],
) -> Result<(String, String, i32), Fail2banError> {
    let client_bin = host.client_binary.as_deref().unwrap_or("fail2ban-client");
    let full_cmd = format!("{} {}", client_bin, args.join(" "));
    debug!("fail2ban-client exec: {}", full_cmd);

    let output = if let Some(ssh) = &host.ssh {
        // Remote execution via SSH
        exec_remote(ssh, host.use_sudo, client_bin, args).await?
    } else {
        // Local execution
        exec_local(host.use_sudo, client_bin, args).await?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    if exit_code != 0 {
        // Check for common error patterns
        if stderr.contains("Permission denied") || stderr.contains("not permitted") {
            return Err(Fail2banError::PermissionDenied(format!(
                "`{full_cmd}` — try enabling sudo"
            )));
        }
        if stderr.contains("not running") || stderr.contains("Connection refused") {
            return Err(Fail2banError::ServerNotRunning);
        }
    }

    Ok((stdout, stderr, exit_code))
}

/// Execute a fail2ban-client command and expect success, returning stdout.
pub async fn exec_ok(
    host: &Fail2banHost,
    args: &[&str],
) -> Result<String, Fail2banError> {
    let (stdout, stderr, exit_code) = exec(host, args).await?;
    if exit_code != 0 {
        return Err(Fail2banError::ClientFailed {
            command: args.join(" "),
            exit_code,
            stderr,
        });
    }
    Ok(stdout)
}

/// Execute locally (optionally with sudo).
async fn exec_local(
    use_sudo: bool,
    client_bin: &str,
    args: &[&str],
) -> Result<std::process::Output, Fail2banError> {
    let output = if use_sudo {
        Command::new("sudo")
            .arg(client_bin)
            .args(args)
            .output()
            .await
    } else {
        Command::new(client_bin).args(args).output().await
    };

    output.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            Fail2banError::ClientNotFound(format!(
                "{} not found (sudo={})",
                client_bin, use_sudo
            ))
        } else {
            Fail2banError::ProcessError(format!("failed to execute {client_bin}: {e}"))
        }
    })
}

/// Execute remotely via SSH.
async fn exec_remote(
    ssh: &SshConfig,
    use_sudo: bool,
    client_bin: &str,
    args: &[&str],
) -> Result<std::process::Output, Fail2banError> {
    let ssh_args = ssh.ssh_command();

    let remote_cmd = if use_sudo {
        format!("sudo {} {}", client_bin, args.join(" "))
    } else {
        format!("{} {}", client_bin, args.join(" "))
    };

    let mut cmd = Command::new(&ssh_args[0]);
    for arg in &ssh_args[1..] {
        cmd.arg(arg);
    }
    cmd.arg(&remote_cmd);

    cmd.output().await.map_err(|e| {
        Fail2banError::SshError(format!(
            "SSH to {}@{}:{} failed: {e}",
            ssh.username, ssh.host, ssh.port
        ))
    })
}

/// Check if fail2ban server is running on the host.
pub async fn ping(host: &Fail2banHost) -> Result<bool, Fail2banError> {
    match exec(host, &["ping"]).await {
        Ok((stdout, _, code)) => {
            Ok(code == 0 && stdout.trim().contains("pong"))
        }
        Err(Fail2banError::ServerNotRunning) => Ok(false),
        Err(e) => Err(e),
    }
}

/// Get fail2ban server version.
pub async fn version(host: &Fail2banHost) -> Result<String, Fail2banError> {
    let stdout = exec_ok(host, &["version"]).await?;
    Ok(stdout.trim().to_string())
}

/// Get the fail2ban-client status (overall server status).
pub async fn server_status(host: &Fail2banHost) -> Result<String, Fail2banError> {
    exec_ok(host, &["status"]).await
}

/// Reload fail2ban configuration.
pub async fn reload(host: &Fail2banHost) -> Result<(), Fail2banError> {
    exec_ok(host, &["reload"]).await?;
    info!("fail2ban configuration reloaded");
    Ok(())
}

/// Reload a specific jail.
pub async fn reload_jail(host: &Fail2banHost, jail: &str) -> Result<(), Fail2banError> {
    exec_ok(host, &["reload", jail]).await?;
    info!("Reloaded jail: {jail}");
    Ok(())
}

/// Start the fail2ban server.
pub async fn start_server(host: &Fail2banHost) -> Result<(), Fail2banError> {
    exec_ok(host, &["start"]).await?;
    info!("fail2ban server started");
    Ok(())
}

/// Stop the fail2ban server.
pub async fn stop_server(host: &Fail2banHost) -> Result<(), Fail2banError> {
    exec_ok(host, &["stop"]).await?;
    info!("fail2ban server stopped");
    Ok(())
}

/// Restart the fail2ban server (via systemctl or service).
pub async fn restart_server(host: &Fail2banHost) -> Result<(), Fail2banError> {
    // fail2ban-client doesn't have a "restart" — use stop + start or systemctl
    let restart_cmd = if host.use_sudo {
        "sudo systemctl restart fail2ban"
    } else {
        "systemctl restart fail2ban"
    };

    if let Some(ssh) = &host.ssh {
        let ssh_args = ssh.ssh_command();
        let mut cmd = Command::new(&ssh_args[0]);
        for arg in &ssh_args[1..] {
            cmd.arg(arg);
        }
        cmd.arg(restart_cmd);
        let output = cmd.output().await.map_err(|e| {
            Fail2banError::SshError(format!("SSH restart failed: {e}"))
        })?;
        if !output.status.success() {
            return Err(Fail2banError::ProcessError(format!(
                "restart failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
    } else {
        let parts: Vec<&str> = restart_cmd.split_whitespace().collect();
        let output = Command::new(parts[0])
            .args(&parts[1..])
            .output()
            .await
            .map_err(|e| Fail2banError::ProcessError(format!("restart failed: {e}")))?;
        if !output.status.success() {
            return Err(Fail2banError::ProcessError(format!(
                "restart failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
    }

    info!("fail2ban server restarted");
    Ok(())
}
