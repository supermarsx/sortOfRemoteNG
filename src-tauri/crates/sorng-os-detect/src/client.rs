//! Command execution — local and remote SSH for OS detection commands.

use crate::error::OsDetectError;
use crate::types::{OsDetectHost, SshConfig};
use log::debug;
use tokio::process::Command;

pub async fn exec(
    host: &OsDetectHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), OsDetectError> {
    let full_cmd = format!("{} {}", program, args.join(" "));
    debug!("os-detect exec: {}", full_cmd);

    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        exec_local(host.use_sudo, program, args).await?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    if stderr.contains("Permission denied") {
        return Err(OsDetectError::PermissionDenied(full_cmd));
    }

    Ok((stdout, stderr, exit_code))
}

pub async fn exec_ok(
    host: &OsDetectHost,
    program: &str,
    args: &[&str],
) -> Result<String, OsDetectError> {
    let (stdout, stderr, exit_code) = exec(host, program, args).await?;
    if exit_code != 0 {
        return Err(OsDetectError::CommandFailed {
            command: format!("{} {}", program, args.join(" ")),
            exit_code,
            stderr,
        });
    }
    Ok(stdout)
}

/// Execute and return stdout; on failure return empty string instead of error.
pub async fn exec_soft(host: &OsDetectHost, program: &str, args: &[&str]) -> String {
    match exec(host, program, args).await {
        Ok((stdout, _, 0)) => stdout,
        _ => String::new(),
    }
}

/// Check if a command is available on the host.
pub async fn has_command(host: &OsDetectHost, cmd: &str) -> bool {
    let (_, _, code) = exec(host, "sh", &["-c", &format!("command -v {cmd}")])
        .await
        .unwrap_or_default();
    code == 0
}

/// Execute a shell one-liner; returns stdout on success, empty on failure.
pub async fn shell_exec(host: &OsDetectHost, script: &str) -> String {
    exec_soft(host, "sh", &["-c", script]).await
}

async fn exec_local(
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<std::process::Output, OsDetectError> {
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
) -> Result<std::process::Output, OsDetectError> {
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
    Ok(cmd.output().await?)
}
