//! Command execution — local and remote SSH for cron/at/anacron.

use crate::error::CronError;
use crate::types::{CronHost, SshAuth, SshConfig};
use log::debug;
use tokio::process::Command;

/// Execute a command on the host, returning (stdout, stderr, exit_code).
pub async fn exec(
    host: &CronHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), CronError> {
    let full_cmd = format!("{} {}", program, args.join(" "));
    debug!("cron exec: {}", full_cmd);

    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        exec_local(host.use_sudo, program, args).await?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    if stderr.contains("Permission denied") {
        return Err(CronError::PermissionDenied(full_cmd));
    }

    Ok((stdout, stderr, exit_code))
}

/// Execute a command and return stdout on success, or error on non-zero exit.
pub async fn exec_ok(host: &CronHost, program: &str, args: &[&str]) -> Result<String, CronError> {
    let (stdout, stderr, exit_code) = exec(host, program, args).await?;
    if exit_code != 0 {
        return Err(CronError::CommandFailed {
            command: format!("{} {}", program, args.join(" ")),
            exit_code,
            stderr,
        });
    }
    Ok(stdout)
}

/// Execute a command with data piped to stdin (e.g. crontab from stdin).
pub async fn exec_with_stdin(
    host: &CronHost,
    program: &str,
    args: &[&str],
    stdin_data: &str,
) -> Result<String, CronError> {
    let full_cmd = format!("{} {}", program, args.join(" "));
    debug!("cron exec_with_stdin: {}", full_cmd);

    let output = if let Some(ssh) = &host.ssh {
        exec_remote_stdin(ssh, host.use_sudo, program, args, stdin_data).await?
    } else {
        exec_local_stdin(host.use_sudo, program, args, stdin_data).await?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    if stderr.contains("Permission denied") {
        return Err(CronError::PermissionDenied(full_cmd));
    }

    if exit_code != 0 {
        return Err(CronError::CommandFailed {
            command: full_cmd,
            exit_code,
            stderr,
        });
    }

    Ok(stdout)
}

// ─── Local execution ────────────────────────────────────────────────

async fn exec_local(
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<std::process::Output, CronError> {
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

async fn exec_local_stdin(
    use_sudo: bool,
    program: &str,
    args: &[&str],
    stdin_data: &str,
) -> Result<std::process::Output, CronError> {
    use tokio::io::AsyncWriteExt;

    let mut child = if use_sudo {
        Command::new("sudo")
            .arg(program)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?
    } else {
        Command::new(program)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?
    };

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(stdin_data.as_bytes()).await?;
        drop(stdin);
    }

    let output = child.wait_with_output().await?;
    Ok(output)
}

// ─── Remote execution ───────────────────────────────────────────────

async fn exec_remote(
    ssh: &SshConfig,
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<std::process::Output, CronError> {
    let remote_cmd = if use_sudo {
        format!("sudo {} {}", program, shell_escape_args(args))
    } else {
        format!("{} {}", program, shell_escape_args(args))
    };

    let mut cmd = build_ssh_command(ssh);
    cmd.arg(format!("{}@{}", ssh.username, ssh.host))
        .arg(&remote_cmd);
    Ok(cmd.output().await?)
}

async fn exec_remote_stdin(
    ssh: &SshConfig,
    use_sudo: bool,
    program: &str,
    args: &[&str],
    stdin_data: &str,
) -> Result<std::process::Output, CronError> {
    use tokio::io::AsyncWriteExt;

    let remote_cmd = if use_sudo {
        format!("sudo {} {}", program, shell_escape_args(args))
    } else {
        format!("{} {}", program, shell_escape_args(args))
    };

    let mut cmd = build_ssh_command(ssh);
    cmd.arg(format!("{}@{}", ssh.username, ssh.host))
        .arg(&remote_cmd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn()?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(stdin_data.as_bytes()).await?;
        drop(stdin);
    }

    let output = child.wait_with_output().await?;
    Ok(output)
}

fn build_ssh_command(ssh: &SshConfig) -> Command {
    let mut cmd = Command::new("ssh");
    cmd.arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg(format!("ConnectTimeout={}", ssh.timeout_secs))
        .arg("-p")
        .arg(ssh.port.to_string());
    if let SshAuth::PrivateKey { key_path, .. } = &ssh.auth {
        cmd.arg("-i").arg(key_path);
    }
    cmd
}

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
