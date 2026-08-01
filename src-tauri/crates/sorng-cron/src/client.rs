//! Command execution — local and remote SSH for cron/at/anacron.

use crate::error::CronError;
use crate::types::{CronHost, SshAuth, SshConfig};
use sorng_ssh::ssh::integration::{
    output_bounded_with_input, BoundedCommandExt, ExternalSshConfig, IntegrationSshSession,
};
use tokio::process::Command;

const MAX_STDOUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const MAX_REMOTE_COMMAND_BYTES: usize = 256 * 1024;
const MAX_STDIN_BYTES: usize = 8 * 1024 * 1024;
const MAX_IDENTITY_BYTES: usize = 1024;
const MAX_KEY_PATH_BYTES: usize = 32 * 1024;
const MAX_PASSWORD_BYTES: usize = 1024 * 1024;

/// Execute a command on the host, returning (stdout, stderr, exit_code).
pub async fn exec(
    host: &CronHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), CronError> {
    let (stdout, stderr, exit_code) = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        collect_output(exec_local(host.use_sudo, program, args).await?)
    };

    if stderr.contains("Permission denied") {
        return Err(CronError::PermissionDenied(program.to_string()));
    }

    Ok((stdout, stderr, exit_code))
}

/// Execute a command and return stdout on success, or error on non-zero exit.
pub async fn exec_ok(host: &CronHost, program: &str, args: &[&str]) -> Result<String, CronError> {
    let (stdout, stderr, exit_code) = exec(host, program, args).await?;
    if exit_code != 0 {
        return Err(CronError::CommandFailed {
            command: program.to_string(),
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
    let (stdout, stderr, exit_code) = if let Some(ssh) = &host.ssh {
        return exec_remote_stdin(ssh, host.use_sudo, program, args, stdin_data).await;
    } else {
        collect_output(exec_local_stdin(host.use_sudo, program, args, stdin_data).await?)
    };

    if stderr.contains("Permission denied") {
        return Err(CronError::PermissionDenied(program.to_string()));
    }

    if exit_code != 0 {
        return Err(CronError::CommandFailed {
            command: program.to_string(),
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
            .args(["-n", "--", program])
            .args(args)
            .output_bounded()
            .await?
    } else {
        Command::new(program).args(args).output_bounded().await?
    };
    Ok(output)
}

async fn exec_local_stdin(
    use_sudo: bool,
    program: &str,
    args: &[&str],
    stdin_data: &str,
) -> Result<std::process::Output, CronError> {
    let mut command = if use_sudo {
        let mut command = Command::new("sudo");
        command.args(["-n", "--", program]).args(args);
        command
    } else {
        let mut command = Command::new(program);
        command.args(args);
        command
    };
    Ok(output_bounded_with_input(&mut command, stdin_data.as_bytes()).await?)
}

// ─── Remote execution ───────────────────────────────────────────────

async fn exec_remote(
    ssh: &SshConfig,
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), CronError> {
    let remote_cmd = build_remote_command(use_sudo, program, args)?;
    execute_remote(ssh, &remote_cmd).await
}

async fn exec_remote_stdin(
    ssh: &SshConfig,
    use_sudo: bool,
    program: &str,
    args: &[&str],
    stdin_data: &str,
) -> Result<String, CronError> {
    if stdin_data.len() > MAX_STDIN_BYTES {
        return Err(CronError::SshError(
            "Remote cron input exceeds the 8 MiB safety limit".to_string(),
        ));
    }

    let remote_cmd = build_remote_command(use_sudo, program, args)?;
    let (private_key, password) = ssh_credentials(ssh)?;
    let timeout_secs = ssh.timeout_secs.clamp(1, 300);
    let session = IntegrationSshSession::new(ExternalSshConfig {
        host: ssh.host.trim(),
        username: ssh.username.trim(),
        port: ssh.port,
        private_key,
        password,
        connect_timeout_secs: timeout_secs,
    });
    let result = session
        .execute_with_input(
            &remote_cmd,
            stdin_data.as_bytes().to_vec(),
            Some(timeout_secs.saturating_mul(1_000)),
        )
        .await;
    let _ = session.disconnect().await;
    result
        .map(|stdout| bound_text(stdout, MAX_STDOUT_BYTES, false))
        .map_err(|error| CronError::SshError(bound_text(error, MAX_STDERR_BYTES, false)))
}

async fn execute_remote(
    ssh: &SshConfig,
    remote_cmd: &str,
) -> Result<(String, String, i32), CronError> {
    let (private_key, password) = ssh_credentials(ssh)?;
    let timeout_secs = ssh.timeout_secs.clamp(1, 300);
    let session = IntegrationSshSession::new(ExternalSshConfig {
        host: ssh.host.trim(),
        username: ssh.username.trim(),
        port: ssh.port,
        private_key,
        password,
        connect_timeout_secs: timeout_secs,
    });
    let result = session
        .execute(remote_cmd, Some(timeout_secs.saturating_mul(1_000)))
        .await;
    let _ = session.disconnect().await;
    match result {
        Ok(stdout) => Ok((
            bound_text(stdout, MAX_STDOUT_BYTES, false),
            String::new(),
            0,
        )),
        Err(error) => Ok((
            String::new(),
            bound_text(error, MAX_STDERR_BYTES, false),
            -1,
        )),
    }
}

fn ssh_credentials(ssh: &SshConfig) -> Result<(Option<&str>, Option<&str>), CronError> {
    validate_ssh_identity(ssh)?;
    match &ssh.auth {
        SshAuth::Password { password } if password.is_empty() => Err(CronError::SshError(
            "SSH password cannot be empty".to_string(),
        )),
        SshAuth::Password { password } if password.len() > MAX_PASSWORD_BYTES => {
            Err(CronError::SshError("SSH password is too large".to_string()))
        }
        SshAuth::Password { password } => Ok((None, Some(password.as_str()))),
        SshAuth::PrivateKey {
            key_path,
            passphrase,
        } if passphrase.as_ref().is_some_and(|value| !value.is_empty()) => {
            Err(CronError::SshError(
                "Encrypted SSH private keys are not supported by this integration".to_string(),
            ))
        }
        SshAuth::PrivateKey { key_path, .. } if key_path.trim().is_empty() => Err(
            CronError::SshError("SSH private key path cannot be empty".to_string()),
        ),
        SshAuth::PrivateKey { key_path, .. } if key_path.len() > MAX_KEY_PATH_BYTES => Err(
            CronError::SshError("SSH private key path is too large".to_string()),
        ),
        SshAuth::PrivateKey { key_path, .. } => Ok((Some(key_path.as_str()), None)),
        SshAuth::Agent => Ok((None, None)),
    }
}

fn validate_ssh_identity(ssh: &SshConfig) -> Result<(), CronError> {
    if ssh.host.trim().is_empty() || ssh.username.trim().is_empty() {
        return Err(CronError::SshError(
            "SSH host and username cannot be empty".to_string(),
        ));
    }
    if ssh.host.len() > MAX_IDENTITY_BYTES || ssh.username.len() > MAX_IDENTITY_BYTES {
        return Err(CronError::SshError(
            "SSH host or username is too large".to_string(),
        ));
    }
    if ssh.port == 0 {
        return Err(CronError::SshError(
            "SSH port must be greater than zero".to_string(),
        ));
    }
    Ok(())
}

fn build_remote_command(sudo: bool, program: &str, args: &[&str]) -> Result<String, CronError> {
    if program.trim().is_empty()
        || program.contains('\0')
        || args.iter().any(|arg| arg.contains('\0'))
    {
        return Err(CronError::SshError(
            "Remote command contains an empty program or NUL byte".to_string(),
        ));
    }
    let size = args.iter().try_fold(program.len(), |total, arg| {
        total.checked_add(arg.len().saturating_add(3))
    });
    if !matches!(size, Some(value) if value <= MAX_REMOTE_COMMAND_BYTES) {
        return Err(CronError::SshError(
            "Remote command is too large".to_string(),
        ));
    }
    let mut words = Vec::with_capacity(args.len() + 4);
    if sudo {
        words.extend([shell_quote("sudo"), shell_quote("-n"), shell_quote("--")]);
    }
    words.push(shell_quote(program));
    words.extend(args.iter().map(|arg| shell_quote(arg)));
    Ok(words.join(" "))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn collect_output(output: std::process::Output) -> (String, String, i32) {
    (
        bound_bytes(&output.stdout, MAX_STDOUT_BYTES),
        bound_bytes(&output.stderr, MAX_STDERR_BYTES),
        output.status.code().unwrap_or(-1),
    )
}

fn bound_bytes(bytes: &[u8], max_bytes: usize) -> String {
    let clipped = bytes.len() > max_bytes;
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(max_bytes)]).into_owned();
    bound_text(text, max_bytes, clipped)
}

fn bound_text(mut text: String, max_bytes: usize, force_marker: bool) -> String {
    const MARKER: &str = "\n[output truncated]";
    if !force_marker && text.len() <= max_bytes {
        return text;
    }
    let mut keep = text.len().min(max_bytes.saturating_sub(MARKER.len()));
    while keep > 0 && !text.is_char_boundary(keep) {
        keep -= 1;
    }
    text.truncate(keep);
    text.push_str(MARKER);
    text
}
