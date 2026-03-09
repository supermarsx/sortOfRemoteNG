//! Command execution for time / NTP management.
use crate::error::TimeNtpError;
use crate::types::{SshAuth, SshConfig, TimeHost};
use log::debug;
use tokio::process::Command;

/// Execute a command on a host, returning (stdout, stderr, exit_code).
pub async fn exec(
    host: &TimeHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), TimeNtpError> {
    debug!("time-ntp exec: {} {}", program, args.join(" "));
    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        exec_local(host.use_sudo, program, args).await?
    };
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((stdout, stderr, output.status.code().unwrap_or(-1)))
}

/// Execute a command and return stdout on success, or error on non-zero exit.
pub async fn exec_ok(
    host: &TimeHost,
    program: &str,
    args: &[&str],
) -> Result<String, TimeNtpError> {
    let (stdout, stderr, code) = exec(host, program, args).await?;
    if code != 0 {
        return Err(TimeNtpError::CommandFailed {
            command: format!("{program} {}", args.join(" ")),
            exit_code: code,
            stderr,
        });
    }
    Ok(stdout)
}

/// Read a remote/local file via `cat`.
pub async fn read_file(host: &TimeHost, path: &str) -> Result<String, TimeNtpError> {
    exec_ok(host, "cat", &[path]).await
}

/// Write content to a remote/local file via `tee`.
pub async fn write_file(host: &TimeHost, path: &str, content: &str) -> Result<(), TimeNtpError> {
    // Use printf piped to tee to write content safely
    let escaped = content.replace('\\', "\\\\").replace('\'', "'\\''");
    let shell_cmd = format!("printf '%s' '{}' | tee {} > /dev/null", escaped, path);
    let (_, stderr, code) = exec(host, "sh", &["-c", &shell_cmd]).await?;
    if code != 0 {
        return Err(TimeNtpError::CommandFailed {
            command: format!("write {path}"),
            exit_code: code,
            stderr,
        });
    }
    Ok(())
}

async fn exec_local(
    sudo: bool,
    prog: &str,
    args: &[&str],
) -> Result<std::process::Output, TimeNtpError> {
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
) -> Result<std::process::Output, TimeNtpError> {
    let rc = if sudo {
        format!("sudo {} {}", prog, args.join(" "))
    } else {
        format!("{} {}", prog, args.join(" "))
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
    cmd.arg(format!("{}@{}", ssh.username, ssh.host)).arg(&rc);
    Ok(cmd.output().await?)
}
