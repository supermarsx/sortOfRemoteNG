//! Command execution — local and remote (SSH) for user management commands.

use crate::error::UserMgmtError;
use crate::types::{SshConfig, UserMgmtHost};
use log::debug;
use tokio::process::Command;

/// Execute a command on a host (local or remote via SSH).
pub async fn exec(
    host: &UserMgmtHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), UserMgmtError> {
    let full_cmd = format!("{} {}", program, args.join(" "));
    debug!("usermgmt exec: {}", full_cmd);

    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        exec_local(host.use_sudo, program, args).await?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    if stderr.contains("Permission denied") || stderr.contains("not permitted") {
        return Err(UserMgmtError::PermissionDenied(format!(
            "`{full_cmd}` — try enabling sudo"
        )));
    }

    Ok((stdout, stderr, exit_code))
}

/// Execute and expect success, returning stdout.
pub async fn exec_ok(
    host: &UserMgmtHost,
    program: &str,
    args: &[&str],
) -> Result<String, UserMgmtError> {
    let (stdout, stderr, exit_code) = exec(host, program, args).await?;
    if exit_code != 0 {
        return Err(UserMgmtError::CommandFailed {
            command: format!("{} {}", program, args.join(" ")),
            exit_code,
            stderr,
        });
    }
    Ok(stdout)
}

/// Read a file from the host (local or remote).
pub async fn read_file(host: &UserMgmtHost, path: &str) -> Result<String, UserMgmtError> {
    exec_ok(host, "cat", &[path]).await
}

async fn exec_local(
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<std::process::Output, UserMgmtError> {
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
) -> Result<std::process::Output, UserMgmtError> {
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

    if let crate::types::SshAuth::PrivateKey { key_path, .. } = &ssh.auth {
        cmd.arg("-i").arg(key_path);
    }

    cmd.arg(format!("{}@{}", ssh.username, ssh.host))
        .arg(&remote_cmd);

    let output = cmd.output().await?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {
        // Smoke test — module compiles
    }
}
