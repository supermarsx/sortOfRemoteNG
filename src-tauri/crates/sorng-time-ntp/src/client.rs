//! Command execution for time / NTP management.
use crate::error::TimeNtpError;
use crate::types::{SshAuth, SshConfig, TimeHost};
use log::debug;
use sorng_ssh::ssh::integration::{BoundedCommandExt, ExternalSshConfig, IntegrationSshSession};
use tokio::process::Command;
use uuid::Uuid;

const MAX_REMOTE_STREAM_BYTES: usize = 4 * 1024 * 1024;
const MAX_WRITE_CONTENT_BYTES: usize = 128 * 1024;
const MAX_WRITE_PATH_BYTES: usize = 4 * 1024;

/// Execute a command on a host, returning (stdout, stderr, exit_code).
pub async fn exec(
    host: &TimeHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), TimeNtpError> {
    debug!(
        "time-ntp: executing {} command",
        if host.ssh.is_some() {
            "remote"
        } else {
            "local"
        }
    );
    if let Some(ssh) = &host.ssh {
        return exec_remote(ssh, host.use_sudo, program, args).await;
    }
    let output = exec_local(host.use_sudo, program, args).await?;
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
            command: program.to_string(),
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
    if path.is_empty()
        || path.len() > MAX_WRITE_PATH_BYTES
        || path.as_bytes().contains(&0)
    {
        return Err(TimeNtpError::Other(
            "write path is empty, too long, or contains a NUL byte".into(),
        ));
    }
    if content.len() > MAX_WRITE_CONTENT_BYTES || content.as_bytes().contains(&0) {
        return Err(TimeNtpError::Other(
            "write content exceeds the 128 KiB limit or contains a NUL byte".into(),
        ));
    }
    let shell_cmd = format!(
        "printf '%s' {} | tee -- {} > /dev/null",
        shell_quote(content),
        shell_quote(path)
    );
    let (_, stderr, code) = exec(host, "sh", &["-c", &shell_cmd]).await?;
    if code != 0 {
        return Err(TimeNtpError::CommandFailed {
            command: "write file".into(),
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
        Command::new("sudo")
            .arg("-n")
            .arg("--")
            .arg(prog)
            .args(args)
            .output_bounded()
            .await?
    } else {
        Command::new(prog).args(args).output_bounded().await?
    })
}

async fn exec_remote(
    ssh: &SshConfig,
    sudo: bool,
    prog: &str,
    args: &[&str],
) -> Result<(String, String, i32), TimeNtpError> {
    validate_ssh_config(ssh)?;
    let (private_key, password) = auth_material(ssh)?;
    let session = IntegrationSshSession::new(ExternalSshConfig {
        host: &ssh.host,
        username: &ssh.username,
        port: ssh.port,
        private_key,
        password,
        connect_timeout_secs: ssh.timeout_secs.clamp(1, 300),
    });
    let command = remote_command(ssh, sudo, prog, args);
    let marker = format!("__SORNG_{}__", Uuid::new_v4().simple());
    let framed = framed_command(&command, &marker);
    let raw = session
        .execute(
            &framed,
            Some(ssh.timeout_secs.clamp(1, 300).saturating_mul(1000)),
        )
        .await
        .map_err(|error| TimeNtpError::SshError(bounded_error(error)))?;
    parse_framed_output(raw, &marker).map_err(TimeNtpError::SshError)
}

fn validate_ssh_config(ssh: &SshConfig) -> Result<(), TimeNtpError> {
    if ssh.host.trim().is_empty() || ssh.username.trim().is_empty() || ssh.port == 0 {
        return Err(TimeNtpError::SshError(
            "SSH host, username, and non-zero port are required".into(),
        ));
    }
    Ok(())
}

fn auth_material(ssh: &SshConfig) -> Result<(Option<&str>, Option<&str>), TimeNtpError> {
    match &ssh.auth {
        SshAuth::Password { password } => Ok((None, Some(password.as_str()))),
        SshAuth::PrivateKey {
            key_path,
            passphrase,
        } => {
            if key_path.trim().is_empty() {
                return Err(TimeNtpError::SshError(
                    "SSH private-key path cannot be empty".into(),
                ));
            }
            if passphrase.as_deref().is_some_and(|value| !value.is_empty()) {
                return Err(TimeNtpError::SshError(
                    "encrypted SSH private keys are not supported by this integration transport"
                        .into(),
                ));
            }
            Ok((Some(key_path.as_str()), None))
        }
        SshAuth::Agent => Ok((None, None)),
    }
}

fn remote_command(ssh: &SshConfig, sudo: bool, prog: &str, args: &[&str]) -> String {
    let mut command = shell_quote(prog);
    for arg in args {
        command.push(' ');
        command.push_str(&shell_quote(arg));
    }
    if sudo && ssh.username != "root" {
        format!("sudo -n -- {command}")
    } else {
        command
    }
}

fn framed_command(command: &str, marker: &str) -> String {
    format!(
        "d=$(mktemp -d) || exit 125; \
         cleanup() {{ p=${{opid:-}}; opid=; [ -z \"$p\" ] || {{ kill \"$p\" 2>/dev/null; wait \"$p\" 2>/dev/null; }}; p=${{epid:-}}; epid=; [ -z \"$p\" ] || {{ kill \"$p\" 2>/dev/null; wait \"$p\" 2>/dev/null; }}; rm -rf \"$d\"; }}; \
         trap cleanup EXIT; trap 'cleanup; exit 130' HUP INT TERM; \
         mkfifo \"$d/o.pipe\" \"$d/e.pipe\" || exit 125; \
         {{ head -c {MAX_REMOTE_STREAM_BYTES} >\"$d/o\"; cat >/dev/null; }} <\"$d/o.pipe\" & opid=$!; \
         {{ head -c {MAX_REMOTE_STREAM_BYTES} >\"$d/e\"; cat >/dev/null; }} <\"$d/e.pipe\" & epid=$!; \
         {command} >\"$d/o.pipe\" 2>\"$d/e.pipe\"; status=$?; \
         wait \"$opid\"; opid=; wait \"$epid\"; epid=; \
         printf '%s\\n' \"$status\"; cat \"$d/o\"; printf '%s' '{marker}:ERR'; \
         cat \"$d/e\"; printf '%s' '{marker}:END'"
    )
}

fn parse_framed_output(raw: String, marker: &str) -> Result<(String, String, i32), String> {
    let (status, body) = raw
        .split_once('\n')
        .ok_or_else(|| "SSH command returned an invalid output frame".to_string())?;
    let exit_code = status
        .parse::<i32>()
        .map_err(|_| "SSH command returned an invalid exit status".to_string())?;
    let error_marker = format!("{marker}:ERR");
    let end_marker = format!("{marker}:END");
    let end = body
        .rfind(&end_marker)
        .filter(|position| position + end_marker.len() == body.len())
        .ok_or_else(|| "SSH command output frame was truncated".to_string())?;
    let framed = &body[..end];
    let error_start = framed
        .rfind(&error_marker)
        .ok_or_else(|| "SSH command output frame is missing stderr".to_string())?;
    Ok((
        framed[..error_start].to_string(),
        framed[error_start + error_marker.len()..].to_string(),
        exit_code,
    ))
}

fn bounded_error(error: String) -> String {
    const MAX_ERROR_CHARS: usize = 4096;
    if error.chars().count() <= MAX_ERROR_CHARS {
        error
    } else {
        format!(
            "{} [truncated]",
            error.chars().take(MAX_ERROR_CHARS).collect::<String>()
        )
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
