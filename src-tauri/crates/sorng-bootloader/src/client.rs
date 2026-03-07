//! Command execution for bootloader management.
use crate::error::BootloaderError;
use crate::types::{BootloaderHost, SshAuth, SshConfig};
use log::debug;
use tokio::process::Command;

/// Run a command on the host, returning (stdout, stderr, exit_code).
pub async fn exec(
    host: &BootloaderHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), BootloaderError> {
    debug!("bootloader exec: {} {}", program, args.join(" "));
    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        exec_local(host.use_sudo, program, args).await?
    };
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((stdout, stderr, output.status.code().unwrap_or(-1)))
}

/// Run a command and return stdout, failing on non-zero exit.
pub async fn exec_ok(
    host: &BootloaderHost,
    program: &str,
    args: &[&str],
) -> Result<String, BootloaderError> {
    let (stdout, stderr, code) = exec(host, program, args).await?;
    if code != 0 {
        return Err(BootloaderError::CommandFailed {
            command: format!("{program} {}", args.join(" ")),
            exit_code: code,
            stderr,
        });
    }
    Ok(stdout)
}

/// Read a remote/local file via `cat`.
pub async fn read_remote_file(host: &BootloaderHost, path: &str) -> Result<String, BootloaderError> {
    exec_ok(host, "cat", &[path]).await
}

/// Write content to a remote/local file via tee.
pub async fn write_remote_file(
    host: &BootloaderHost,
    path: &str,
    content: &str,
) -> Result<(), BootloaderError> {
    // Use a shell pipeline: echo ... | tee path
    let shell_cmd = format!("printf '%s' '{}' | tee {} > /dev/null", shell_escape(content), path);
    exec_shell(host, &shell_cmd).await?;
    Ok(())
}

/// Execute an arbitrary shell command string on the host.
pub async fn exec_shell(
    host: &BootloaderHost,
    shell_cmd: &str,
) -> Result<String, BootloaderError> {
    exec_ok(host, "sh", &["-c", shell_cmd]).await
}

fn shell_escape(s: &str) -> String {
    s.replace('\'', "'\\''")
}

async fn exec_local(
    sudo: bool,
    prog: &str,
    args: &[&str],
) -> Result<std::process::Output, BootloaderError> {
    Ok(if sudo {
        Command::new("sudo").arg(prog).args(args).output().await?
    } else {
        Command::new(prog).args(args).output().await?
    })
}

async fn exec_remote(
    ssh: &SshConfig,
    sudo: bool,
    prog: &str,
    args: &[&str],
) -> Result<std::process::Output, BootloaderError> {
    let remote_cmd = if sudo {
        format!("sudo {} {}", prog, shell_escape_args(args))
    } else {
        format!("{} {}", prog, shell_escape_args(args))
    };
    let mut cmd = Command::new("ssh");
    cmd.arg("-o").arg("StrictHostKeyChecking=accept-new")
        .arg("-o").arg(format!("ConnectTimeout={}", ssh.timeout_secs))
        .arg("-p").arg(ssh.port.to_string());
    if let SshAuth::PrivateKey { key_path, .. } = &ssh.auth {
        cmd.arg("-i").arg(key_path);
    }
    cmd.arg(format!("{}@{}", ssh.username, ssh.host)).arg(&remote_cmd);
    Ok(cmd.output().await?)
}

fn shell_escape_args(args: &[&str]) -> String {
    args.iter()
        .map(|a| {
            if a.contains(' ') || a.contains('\'') || a.contains('"') {
                format!("'{}'", a.replace('\'', "'\\''"))
            } else {
                (*a).to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
