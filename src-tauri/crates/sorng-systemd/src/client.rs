//! Command execution — local and remote SSH for systemctl/journalctl.

use crate::error::SystemdError;
use crate::types::{SshConfig, SystemdHost};
use log::debug;
use tokio::process::Command;

pub async fn exec(
    host: &SystemdHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), SystemdError> {
    let full_cmd = format!("{} {}", program, args.join(" "));
    debug!("systemd exec: {}", full_cmd);

    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        exec_local(host.use_sudo, program, args).await?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    if stderr.contains("Permission denied") {
        return Err(SystemdError::PermissionDenied(full_cmd));
    }

    Ok((stdout, stderr, exit_code))
}

pub async fn exec_ok(
    host: &SystemdHost,
    program: &str,
    args: &[&str],
) -> Result<String, SystemdError> {
    let (stdout, stderr, exit_code) = exec(host, program, args).await?;
    if exit_code != 0 {
        return Err(SystemdError::CommandFailed {
            command: format!("{} {}", program, args.join(" ")),
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
) -> Result<std::process::Output, SystemdError> {
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
) -> Result<std::process::Output, SystemdError> {
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
