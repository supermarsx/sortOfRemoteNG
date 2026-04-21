//! Command execution — local and remote (SSH) for PAM management.

use crate::error::PamError;
use crate::types::{PamHost, SshAuth, SshConfig};
use log::debug;
use tokio::process::Command;

/// Execute a command on a host (local or remote via SSH).
///
/// Returns (stdout, stderr, exit_code).
pub async fn exec(
    host: &PamHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), PamError> {
    let full_cmd = format!("{} {}", program, args.join(" "));
    debug!("pam exec: {}", full_cmd);

    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        exec_local(host.use_sudo, program, args).await?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    if stderr.contains("Permission denied") || stderr.contains("not permitted") {
        return Err(PamError::PermissionDenied(format!(
            "`{full_cmd}` — try enabling sudo"
        )));
    }

    Ok((stdout, stderr, exit_code))
}

/// Execute and expect success, returning stdout.
pub async fn exec_ok(host: &PamHost, program: &str, args: &[&str]) -> Result<String, PamError> {
    let (stdout, stderr, exit_code) = exec(host, program, args).await?;
    if exit_code != 0 {
        return Err(PamError::CommandFailed {
            command: format!("{} {}", program, args.join(" ")),
            exit_code,
            stderr,
        });
    }
    Ok(stdout)
}

/// Read a file from the host.
pub async fn read_file(host: &PamHost, path: &str) -> Result<String, PamError> {
    exec_ok(host, "cat", &[path]).await
}

/// Write content to a file on the host (uses tee for sudo-safe writes).
pub async fn write_file(host: &PamHost, path: &str, content: &str) -> Result<(), PamError> {
    let escaped = content.replace('\'', "'\\''");
    let shell_cmd = if host.use_sudo {
        format!("printf '%s' '{}' | sudo tee {} > /dev/null", escaped, path)
    } else {
        format!("printf '%s' '{}' | tee {} > /dev/null", escaped, path)
    };
    exec_shell(host, &shell_cmd).await?;
    Ok(())
}

/// Check if a file exists on the host.
pub async fn file_exists(host: &PamHost, path: &str) -> Result<bool, PamError> {
    let (stdout, _, _) = exec(
        host,
        "sh",
        &["-c", &format!("test -f {} && echo yes || echo no", path)],
    )
    .await?;
    Ok(stdout.trim() == "yes")
}

/// Check if a directory exists on the host.
pub async fn dir_exists(host: &PamHost, path: &str) -> Result<bool, PamError> {
    let (stdout, _, _) = exec(
        host,
        "sh",
        &["-c", &format!("test -d {} && echo yes || echo no", path)],
    )
    .await?;
    Ok(stdout.trim() == "yes")
}

/// List files in a directory on the host.
pub async fn list_dir(host: &PamHost, path: &str) -> Result<Vec<String>, PamError> {
    let stdout = exec_ok(host, "ls", &["-1", path]).await?;
    Ok(stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect())
}

/// Remove a file on the host.
pub async fn remove_file(host: &PamHost, path: &str) -> Result<(), PamError> {
    if host.use_sudo {
        exec_ok(host, "sudo", &["rm", "-f", path]).await?;
    } else {
        exec_ok(host, "rm", &["-f", path]).await?;
    }
    Ok(())
}

/// Execute a raw shell command string on the host.
pub async fn exec_shell(host: &PamHost, shell_cmd: &str) -> Result<String, PamError> {
    exec_ok(host, "sh", &["-c", shell_cmd]).await
}

// ─── Internal ───────────────────────────────────────────────────────

async fn exec_local(
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<std::process::Output, PamError> {
    let output = if use_sudo {
        Command::new("sudo")
            .arg(program)
            .args(args)
            .output()
            .await?
    } else {
        Command::new(program).args(args).output().await?
    };
    Ok(output)
}

async fn exec_remote(
    ssh: &SshConfig,
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<std::process::Output, PamError> {
    let remote_cmd = if use_sudo {
        format!("sudo {} {}", program, args.join(" "))
    } else {
        format!("{} {}", program, args.join(" "))
    };

    let mut cmd = Command::new("ssh");
    cmd.arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("-o")
        .arg(format!("ConnectTimeout={}", ssh.timeout_secs))
        .arg("-p")
        .arg(ssh.port.to_string());

    if let SshAuth::PrivateKey { key_path, .. } = &ssh.auth {
        cmd.arg("-i").arg(key_path);
    }

    cmd.arg(format!("{}@{}", ssh.username, ssh.host))
        .arg(&remote_cmd);

    let output = cmd.output().await.map_err(|e| {
        PamError::SshError(format!(
            "SSH to {}@{}:{} failed: {e}",
            ssh.username, ssh.host, ssh.port
        ))
    })?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {
        // Smoke test — module compiles
    }
}
