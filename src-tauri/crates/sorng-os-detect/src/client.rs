//! Command execution — local and remote SSH for OS detection commands.

use crate::error::OsDetectError;
use crate::types::{OsDetectHost, SshAuth, SshConfig};
use log::debug;
use sorng_ssh::ssh::integration::{
    BoundedCommandExt, ExternalSshConfig, IntegrationSshSession, SshCommandOutput,
};
use tokio::process::Command;

const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 4 * 1024 * 1024;
const MAX_REMOTE_COMMAND_BYTES: usize = 256 * 1024;
const MAX_IDENTITY_BYTES: usize = 1024;
const MAX_KEY_PATH_BYTES: usize = 32 * 1024;
const MAX_PASSWORD_BYTES: usize = 1024 * 1024;
const MAX_TRANSPORT_ERROR_BYTES: usize = 64 * 1024;

pub async fn exec(
    host: &OsDetectHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), OsDetectError> {
    debug!(
        "os-detect: executing {} command",
        if host.ssh.is_some() {
            "remote"
        } else {
            "local"
        }
    );
    let (stdout, stderr, exit_code) = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        let output = exec_local(host.use_sudo, program, args).await?;
        (
            bounded_output(&output.stdout),
            bounded_output(&output.stderr),
            output.status.code().unwrap_or(-1),
        )
    };

    if stderr.contains("Permission denied") {
        return Err(OsDetectError::PermissionDenied(program.to_string()));
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
            command: program.to_string(),
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
    let (_, _, code) = exec(host, "sh", &["-c", "command -v \"$1\"", "sh", cmd])
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
            .arg("-n")
            .arg("--")
            .arg(program)
            .args(args)
            .output_bounded()
            .await?
    } else {
        Command::new(program).args(args).output_bounded().await?
    };
    Ok(output)
}

async fn exec_remote(
    ssh: &SshConfig,
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), OsDetectError> {
    let remote_command = build_remote_command(ssh, use_sudo, program, args)?;
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

    let execution = session
        .execute_capped(
            &remote_command,
            Some(timeout_secs.saturating_mul(1_000)),
            MAX_STDOUT_BYTES.saturating_add(MAX_STDERR_BYTES),
        )
        .await;
    let disconnect = session.disconnect().await;

    match (execution, disconnect) {
        (Ok(output), Ok(())) => Ok(collect_remote_output(output)),
        (Err(error), Ok(())) => Err(ssh_error(bound_transport_error(error))),
        (Ok(_), Err(cleanup_error)) => Err(ssh_error(bound_transport_error(format!(
            "SSH command completed, but session cleanup failed: {cleanup_error}"
        )))),
        (Err(error), Err(cleanup_error)) => Err(ssh_error(bound_transport_error(format!(
            "{error}; SSH session cleanup also failed: {cleanup_error}"
        )))),
    }
}

fn ssh_error(message: impl Into<String>) -> OsDetectError {
    OsDetectError::SshError(message.into())
}

fn ssh_credentials<'a>(
    ssh: &'a SshConfig,
) -> Result<(Option<&'a str>, Option<&'a str>), OsDetectError> {
    validate_ssh_identity(ssh)?;
    match &ssh.auth {
        SshAuth::Password { password } if password.is_empty() => {
            Err(ssh_error("SSH password cannot be empty"))
        }
        SshAuth::Password { password } if password.len() > MAX_PASSWORD_BYTES => {
            Err(ssh_error("SSH password is too large"))
        }
        SshAuth::Password { password } => Ok((None, Some(password.as_str()))),
        SshAuth::PrivateKey {
            key_path,
            passphrase,
        } if passphrase.as_ref().is_some_and(|value| !value.is_empty()) => Err(ssh_error(
            "Encrypted SSH private keys are not supported by this integration transport",
        )),
        SshAuth::PrivateKey { key_path, .. }
            if key_path.trim().is_empty() || key_path.contains('\0') =>
        {
            Err(ssh_error("SSH private key path is invalid"))
        }
        SshAuth::PrivateKey { key_path, .. } if key_path.len() > MAX_KEY_PATH_BYTES => {
            Err(ssh_error("SSH private key path is too large"))
        }
        SshAuth::PrivateKey { key_path, .. } => Ok((Some(key_path.as_str()), None)),
        SshAuth::Agent => Ok((None, None)),
    }
}

fn validate_ssh_identity(ssh: &SshConfig) -> Result<(), OsDetectError> {
    let host = ssh.host.trim();
    let username = ssh.username.trim();
    if host.is_empty()
        || username.is_empty()
        || host.len() > MAX_IDENTITY_BYTES
        || username.len() > MAX_IDENTITY_BYTES
        || host.chars().any(|character| character.is_control() || character.is_whitespace())
        || username
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(ssh_error("SSH host or username is invalid"));
    }
    if ssh.port == 0 {
        return Err(ssh_error("SSH port must be greater than zero"));
    }
    Ok(())
}

fn build_remote_command(
    ssh: &SshConfig,
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<String, OsDetectError> {
    if program.trim().is_empty()
        || program.contains('\0')
        || args.iter().any(|argument| argument.contains('\0'))
    {
        return Err(ssh_error(
            "Remote command contains an empty program or NUL byte",
        ));
    }
    let size = args.iter().try_fold(program.len(), |total, argument| {
        total.checked_add(argument.len().saturating_add(3))
    });
    if !matches!(size, Some(value) if value <= MAX_REMOTE_COMMAND_BYTES) {
        return Err(ssh_error("Remote command is too large"));
    }

    let mut words = Vec::with_capacity(args.len().saturating_add(4));
    if use_sudo && ssh.username.trim() != "root" {
        words.extend([shell_quote("sudo"), shell_quote("-n"), shell_quote("--")]);
    }
    words.push(shell_quote(program));
    words.extend(args.iter().map(|argument| shell_quote(argument)));
    Ok(words.join(" "))
}

fn collect_remote_output(output: SshCommandOutput) -> (String, String, i32) {
    (
        bound_bytes(&output.stdout, MAX_STDOUT_BYTES, output.stdout_truncated),
        bound_bytes(&output.stderr, MAX_STDERR_BYTES, output.stderr_truncated),
        output.exit_status,
    )
}

fn bounded_output(bytes: &[u8]) -> String {
    bound_bytes(bytes, MAX_STDOUT_BYTES, false)
}

fn bound_bytes(bytes: &[u8], max_bytes: usize, force_marker: bool) -> String {
    let clipped = force_marker || bytes.len() > max_bytes;
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(max_bytes)]).into_owned();
    bound_text(text, max_bytes, clipped)
}

fn bound_transport_error(error: String) -> String {
    bound_text(error, MAX_TRANSPORT_ERROR_BYTES, false)
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

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
