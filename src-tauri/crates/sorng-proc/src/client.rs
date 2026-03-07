//! Command execution — local and remote SSH for process management commands.

use crate::error::ProcError;
use crate::types::{ProcHost, SshConfig, SshAuth};
use log::debug;
use tokio::process::Command;

/// Execute a command on the given host and return (stdout, stderr, exit_code).
pub async fn exec(
    host: &ProcHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), ProcError> {
    let full_cmd = format!("{} {}", program, args.join(" "));
    debug!("proc exec: {}", full_cmd);

    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        exec_local(host.use_sudo, program, args).await?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    if stderr.contains("Permission denied") {
        return Err(ProcError::PermissionDenied(full_cmd));
    }

    Ok((stdout, stderr, exit_code))
}

/// Execute and require exit code 0.
pub async fn exec_ok(
    host: &ProcHost,
    program: &str,
    args: &[&str],
) -> Result<String, ProcError> {
    let (stdout, stderr, exit_code) = exec(host, program, args).await?;
    if exit_code != 0 {
        return Err(ProcError::CommandFailed {
            command: format!("{} {}", program, args.join(" ")),
            exit_code,
            stderr,
        });
    }
    Ok(stdout)
}

/// Execute a raw shell string (for pipes, redirections) via `sh -c`.
pub async fn exec_shell(
    host: &ProcHost,
    shell_cmd: &str,
) -> Result<(String, String, i32), ProcError> {
    debug!("proc exec_shell: {}", shell_cmd);
    exec(host, "sh", &["-c", shell_cmd]).await
}

/// Execute a raw shell string and require exit code 0.
pub async fn exec_shell_ok(
    host: &ProcHost,
    shell_cmd: &str,
) -> Result<String, ProcError> {
    let (stdout, stderr, exit_code) = exec_shell(host, shell_cmd).await?;
    if exit_code != 0 {
        return Err(ProcError::CommandFailed {
            command: shell_cmd.to_string(),
            exit_code,
            stderr,
        });
    }
    Ok(stdout)
}

async fn exec_local(
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<std::process::Output, ProcError> {
    let output = if use_sudo {
        Command::new("sudo").arg(program).args(args).output().await?
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
) -> Result<std::process::Output, ProcError> {
    let remote_cmd = if use_sudo {
        format!("sudo {} {}", program, shell_escape_args(args))
    } else {
        format!("{} {}", program, shell_escape_args(args))
    };
    let mut cmd = Command::new("ssh");
    cmd.arg("-o").arg("StrictHostKeyChecking=accept-new")
        .arg("-o").arg(format!("ConnectTimeout={}", ssh.timeout_secs))
        .arg("-p").arg(ssh.port.to_string());
    if let SshAuth::PrivateKey { ref key_path, .. } = ssh.auth {
        cmd.arg("-i").arg(key_path);
    }
    cmd.arg(format!("{}@{}", ssh.username, ssh.host))
        .arg(&remote_cmd);
    Ok(cmd.output().await?)
}

/// Minimal shell-safe join for remote args.
fn shell_escape_args(args: &[&str]) -> String {
    args.iter()
        .map(|a| {
            if a.contains(' ') || a.contains('\'') || a.contains('"') || a.contains('\\') {
                format!("'{}'", a.replace('\'', "'\\''"))
            } else {
                (*a).to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
