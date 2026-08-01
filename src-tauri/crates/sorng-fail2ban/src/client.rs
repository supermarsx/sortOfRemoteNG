//! Bounded fail2ban command execution with hardened local and SSH transports.

use crate::error::Fail2banError;
use crate::types::{Fail2banHost, SshConfig};
use log::{debug, info};
use std::future::Future;
use std::net::IpAddr;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_DIAGNOSTIC_BYTES: usize = 4096;
const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CONNECT_TIMEOUT_SECS: u64 = 60;
const MAX_ARGUMENT_BYTES: usize = 16 * 1024;
const MAX_ARGUMENTS: usize = 128;

#[derive(Debug)]
pub(crate) struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

struct CapturedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

impl CapturedOutput {
    fn into_string(mut self) -> String {
        const MARKER: &[u8] = b"\n[output truncated]";
        if self.truncated {
            self.bytes
                .truncate(MAX_OUTPUT_BYTES.saturating_sub(MARKER.len()));
            self.bytes.extend_from_slice(MARKER);
        }
        String::from_utf8_lossy(&self.bytes).into_owned()
    }
}

/// Execute a fail2ban-client command on a host (local or remote).
///
/// Returns (stdout, stderr, exit_code).
pub async fn exec(
    host: &Fail2banHost,
    args: &[&str],
) -> Result<(String, String, i32), Fail2banError> {
    let client_bin = host.client_binary.as_deref().unwrap_or("fail2ban-client");
    let operation = args.first().copied().unwrap_or("request");
    debug!("fail2ban-client operation: {operation}");

    let output = exec_program(host, host.use_sudo, client_bin, args, "fail2ban-client").await?;

    if output.exit_code != 0 {
        if output.stderr.contains("Permission denied") || output.stderr.contains("not permitted") {
            return Err(Fail2banError::PermissionDenied(
                "the operation was rejected; verify the configured sudo policy".into(),
            ));
        }
        if output.stderr.contains("not running") || output.stderr.contains("Connection refused") {
            return Err(Fail2banError::ServerNotRunning);
        }
    }

    Ok((output.stdout, output.stderr, output.exit_code))
}

/// Execute a fail2ban-client command and expect success, returning stdout.
pub async fn exec_ok(host: &Fail2banHost, args: &[&str]) -> Result<String, Fail2banError> {
    let (stdout, stderr, exit_code) = exec(host, args).await?;
    if exit_code != 0 {
        return Err(Fail2banError::ClientFailed {
            command: args.first().copied().unwrap_or("request").to_string(),
            exit_code,
            stderr,
        });
    }
    Ok(stdout)
}

/// Execute an argv vector locally or through the hardened SSH transport.
pub(crate) async fn exec_program(
    host: &Fail2banHost,
    use_sudo: bool,
    program: &str,
    args: &[&str],
    operation: &'static str,
) -> Result<CommandResult, Fail2banError> {
    validate_host_config(host)?;
    validate_program(program)?;
    validate_arguments(args)?;

    let timeout = command_timeout(host);
    let mut command = if let Some(ssh) = &host.ssh {
        let remote_command = build_remote_command(use_sudo, program, args)?;
        let mut command = Command::new("ssh");
        command.args(validated_ssh_args(ssh)?);
        command.arg(remote_command);
        command
    } else {
        let mut command = if use_sudo {
            let mut command = Command::new("sudo");
            command.arg("--").arg(program);
            command
        } else {
            Command::new(program)
        };
        command.args(args);
        command
    };

    let output = run_bounded(&mut command, timeout, operation).await?;
    Ok(CommandResult {
        stdout: redact_output(host, &output.stdout),
        stderr: redact_diagnostic(host, &output.stderr),
        exit_code: output.exit_code,
    })
}

pub(crate) fn require_success(
    operation: &str,
    output: CommandResult,
) -> Result<CommandResult, Fail2banError> {
    if output.exit_code == 0 {
        Ok(output)
    } else {
        Err(Fail2banError::ClientFailed {
            command: operation.to_string(),
            exit_code: output.exit_code,
            stderr: output.stderr,
        })
    }
}

pub(crate) fn validate_host_config(host: &Fail2banHost) -> Result<(), Fail2banError> {
    if let Some(client_binary) = host.client_binary.as_deref() {
        validate_program(client_binary)?;
    }
    if let Some(ssh) = &host.ssh {
        validate_ssh_config(ssh)?;
    }
    Ok(())
}

pub(crate) fn validate_safe_name(value: &str, name: &str) -> Result<(), Fail2banError> {
    if value.is_empty() || value.chars().count() > 128 {
        return Err(Fail2banError::ConfigError(format!(
            "{name} must be 1-128 characters"
        )));
    }
    if !value
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | '@' | '+'))
    {
        return Err(Fail2banError::ConfigError(format!(
            "{name} contains invalid characters"
        )));
    }
    Ok(())
}

pub(crate) fn validate_argument(value: &str, name: &str) -> Result<(), Fail2banError> {
    if value.is_empty() || value.len() > MAX_ARGUMENT_BYTES {
        return Err(Fail2banError::ConfigError(format!(
            "{name} must be 1-{MAX_ARGUMENT_BYTES} bytes"
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(Fail2banError::ConfigError(format!(
            "{name} contains control characters"
        )));
    }
    Ok(())
}

pub(crate) fn validate_absolute_path(path: &str, name: &str) -> Result<(), Fail2banError> {
    validate_argument(path, name)?;
    if !path.starts_with('/') {
        return Err(Fail2banError::ConfigError(format!(
            "{name} must be an absolute POSIX path"
        )));
    }
    if path.split('/').any(|component| component == "..") {
        return Err(Fail2banError::ConfigError(format!(
            "{name} must not contain parent traversal"
        )));
    }
    Ok(())
}

pub(crate) fn validate_ip_or_host(value: &str) -> Result<(), Fail2banError> {
    if let Some((address, prefix)) = value.rsplit_once('/') {
        let ip: IpAddr = address
            .parse()
            .map_err(|_| Fail2banError::ConfigError("invalid IP/CIDR value".into()))?;
        let prefix: u8 = prefix
            .parse()
            .map_err(|_| Fail2banError::ConfigError("invalid CIDR prefix".into()))?;
        let maximum = if ip.is_ipv4() { 32 } else { 128 };
        if prefix > maximum {
            return Err(Fail2banError::ConfigError("invalid CIDR prefix".into()));
        }
        return Ok(());
    }
    if value.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    validate_hostname(value)
}

fn validate_hostname(value: &str) -> Result<(), Fail2banError> {
    if value.is_empty() || value.len() > 253 || value.ends_with('.') {
        return Err(Fail2banError::ConfigError("invalid hostname".into()));
    }
    if value.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    }) {
        Ok(())
    } else {
        Err(Fail2banError::ConfigError("invalid hostname".into()))
    }
}

fn validate_program(program: &str) -> Result<(), Fail2banError> {
    if program.is_empty() || program.len() > 256 || program.starts_with('-') {
        return Err(Fail2banError::ConfigError(
            "command binary must be a non-option name or absolute path".into(),
        ));
    }
    if !program
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.' | '+'))
    {
        return Err(Fail2banError::ConfigError(
            "command binary contains invalid characters".into(),
        ));
    }
    if program.contains('/')
        && (!program.starts_with('/') || program.split('/').any(|part| part == ".."))
    {
        return Err(Fail2banError::ConfigError(
            "command binary paths must be absolute and traversal-free".into(),
        ));
    }
    Ok(())
}

fn validate_arguments(args: &[&str]) -> Result<(), Fail2banError> {
    if args.len() > MAX_ARGUMENTS {
        return Err(Fail2banError::ConfigError(
            "too many command arguments".into(),
        ));
    }
    for arg in args {
        if arg.len() > MAX_ARGUMENT_BYTES || arg.chars().any(char::is_control) {
            return Err(Fail2banError::ConfigError(
                "command argument exceeds safety limits".into(),
            ));
        }
    }
    Ok(())
}

fn validate_ssh_config(ssh: &SshConfig) -> Result<(), Fail2banError> {
    if ssh.password.is_some() || ssh.private_key_passphrase.is_some() {
        return Err(Fail2banError::AuthError(
            "password and private-key passphrase authentication are unsupported; use an SSH agent or an unencrypted key".into(),
        ));
    }
    if ssh.port == 0 {
        return Err(Fail2banError::ConfigError(
            "SSH port must be non-zero".into(),
        ));
    }
    if ssh.host.is_empty()
        || ssh.host.len() > 255
        || !ssh.host.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '%' | '[' | ']')
        })
    {
        return Err(Fail2banError::ConfigError("invalid SSH host".into()));
    }
    if ssh.username.is_empty()
        || ssh.username.len() > 128
        || !ssh
            .username
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | '@' | '+'))
    {
        return Err(Fail2banError::ConfigError("invalid SSH username".into()));
    }
    if let Some(path) = ssh.private_key_path.as_deref() {
        validate_argument(path, "SSH private key path")?;
    }
    if let Some(timeout) = ssh.connect_timeout {
        if !(1..=MAX_CONNECT_TIMEOUT_SECS).contains(&timeout) {
            return Err(Fail2banError::ConfigError(
                "SSH connect timeout must be 1-60 seconds".into(),
            ));
        }
    }
    for (key, value) in &ssh.ssh_options {
        const ALLOWED_OPTIONS: &[&str] = &[
            "AddressFamily",
            "BindAddress",
            "Compression",
            "ConnectionAttempts",
            "IPQoS",
            "LogLevel",
            "ServerAliveCountMax",
            "ServerAliveInterval",
        ];
        if !ALLOWED_OPTIONS.contains(&key.as_str()) {
            return Err(Fail2banError::ConfigError(format!(
                "SSH option {key} is not allowed"
            )));
        }
        validate_argument(value, "SSH option value")?;
    }
    Ok(())
}

fn validated_ssh_args(ssh: &SshConfig) -> Result<Vec<String>, Fail2banError> {
    validate_ssh_config(ssh)?;
    let mut args = vec![
        "-p".into(),
        ssh.port.to_string(),
        "-l".into(),
        ssh.username.clone(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        "-o".into(),
        "PasswordAuthentication=no".into(),
        "-o".into(),
        "KbdInteractiveAuthentication=no".into(),
        "-o".into(),
        "NumberOfPasswordPrompts=0".into(),
        "-o".into(),
        "ClearAllForwardings=yes".into(),
        "-o".into(),
        "ForwardAgent=no".into(),
        "-o".into(),
        "ForwardX11=no".into(),
    ];
    if let Some(key) = &ssh.private_key_path {
        args.push("-i".into());
        args.push(key.clone());
    }
    if let Some(timeout) = ssh.connect_timeout {
        args.push("-o".into());
        args.push(format!("ConnectTimeout={timeout}"));
    }
    let mut options: Vec<_> = ssh.ssh_options.iter().collect();
    options.sort_by(|left, right| left.0.cmp(right.0));
    for (key, value) in options {
        args.push("-o".into());
        args.push(format!("{key}={value}"));
    }
    args.push("--".into());
    args.push(ssh.host.clone());
    Ok(args)
}

fn build_remote_command(
    use_sudo: bool,
    program: &str,
    args: &[&str],
) -> Result<String, Fail2banError> {
    validate_program(program)?;
    validate_arguments(args)?;
    let mut argv = Vec::with_capacity(args.len() + 3);
    if use_sudo {
        argv.push("sudo");
        argv.push("--");
    }
    argv.push(program);
    argv.extend(args.iter().copied());
    Ok(argv
        .into_iter()
        .map(posix_quote)
        .collect::<Vec<_>>()
        .join(" "))
}

fn posix_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn command_timeout(host: &Fail2banHost) -> Duration {
    host.ssh
        .as_ref()
        .and_then(|ssh| ssh.connect_timeout)
        .map(|seconds| Duration::from_secs(seconds.saturating_add(30).min(90)))
        .unwrap_or(DEFAULT_COMMAND_TIMEOUT)
}

async fn run_bounded(
    command: &mut Command,
    timeout: Duration,
    operation: &'static str,
) -> Result<CommandResult, Fail2banError> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        Fail2banError::ProcessError(format!("{operation} could not start ({:?})", error.kind()))
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Fail2banError::ProcessError("stdout pipe unavailable".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| Fail2banError::ProcessError("stderr pipe unavailable".into()))?;
    let stdout_task = tokio::spawn(read_bounded(stdout, MAX_OUTPUT_BYTES));
    let stderr_task = tokio::spawn(read_bounded(stderr, MAX_OUTPUT_BYTES));

    let status = match bounded_wait(child.wait(), timeout).await {
        Ok(result) => result.map_err(|error| {
            Fail2banError::ProcessError(format!(
                "{operation} could not be reaped ({:?})",
                error.kind()
            ))
        })?,
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            return Err(Fail2banError::Timeout(format!(
                "{operation} exceeded its bounded execution time"
            )));
        }
    };

    let stdout = stdout_task
        .await
        .map_err(|_| Fail2banError::ProcessError("stdout reader failed".into()))?
        .map_err(|_| Fail2banError::ProcessError("stdout capture failed".into()))?;
    let stderr = stderr_task
        .await
        .map_err(|_| Fail2banError::ProcessError("stderr reader failed".into()))?
        .map_err(|_| Fail2banError::ProcessError("stderr capture failed".into()))?;

    Ok(CommandResult {
        stdout: stdout.into_string(),
        stderr: stderr.into_string(),
        exit_code: status.code().unwrap_or(-1),
    })
}

async fn bounded_wait<F, T>(future: F, timeout: Duration) -> Result<T, tokio::time::error::Elapsed>
where
    F: Future<Output = T>,
{
    tokio::time::timeout(timeout, future).await
}

async fn read_bounded<R>(mut reader: R, limit: usize) -> std::io::Result<CapturedOutput>
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Vec::with_capacity(limit.min(8192));
    let mut truncated = false;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(bytes.len());
        let retained = remaining.min(read);
        bytes.extend_from_slice(&buffer[..retained]);
        truncated |= retained < read;
    }
    Ok(CapturedOutput { bytes, truncated })
}

pub(crate) fn redact_output(host: &Fail2banHost, value: &str) -> String {
    let mut redacted = value.to_string();
    if let Some(ssh) = &host.ssh {
        for secret in [
            ssh.password.as_deref(),
            ssh.private_key_passphrase.as_deref(),
            ssh.private_key_path.as_deref(),
        ]
        .into_iter()
        .flatten()
        .filter(|secret| !secret.is_empty())
        {
            redacted = redacted.replace(secret, "[REDACTED]");
        }
        redacted = redacted.replace(&format!("{}@{}", ssh.username, ssh.host), "[REMOTE]");
    }
    let assignment = regex::Regex::new(
        r"(?i)\b(password|passphrase|authorization|token|secret)\b(\s*[:=]\s*)([^\s,;]+)",
    )
    .expect("valid diagnostic redaction regex");
    redacted = assignment
        .replace_all(&redacted, "$1$2[REDACTED]")
        .into_owned();
    truncate_utf8(redacted, MAX_OUTPUT_BYTES)
}

pub(crate) fn redact_diagnostic(host: &Fail2banHost, value: &str) -> String {
    truncate_utf8(redact_output(host, value), MAX_DIAGNOSTIC_BYTES)
}

fn truncate_utf8(mut value: String, limit: usize) -> String {
    const MARKER: &str = "\n[output truncated]";
    if value.len() <= limit {
        return value;
    }
    let mut end = limit.saturating_sub(MARKER.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value.truncate(end);
    value.push_str(MARKER);
    value
}

/// Check if fail2ban server is running on the host.
pub async fn ping(host: &Fail2banHost) -> Result<bool, Fail2banError> {
    match exec(host, &["ping"]).await {
        Ok((stdout, _, code)) => Ok(code == 0 && stdout.trim().contains("pong")),
        Err(Fail2banError::ServerNotRunning) => Ok(false),
        Err(error) => Err(error),
    }
}

pub async fn version(host: &Fail2banHost) -> Result<String, Fail2banError> {
    Ok(exec_ok(host, &["version"]).await?.trim().to_string())
}

pub async fn server_status(host: &Fail2banHost) -> Result<String, Fail2banError> {
    exec_ok(host, &["status"]).await
}

pub async fn reload(host: &Fail2banHost) -> Result<(), Fail2banError> {
    exec_ok(host, &["reload"]).await?;
    info!("fail2ban configuration reloaded");
    Ok(())
}

pub async fn reload_jail(host: &Fail2banHost, jail: &str) -> Result<(), Fail2banError> {
    validate_safe_name(jail, "jail name")?;
    exec_ok(host, &["reload", jail]).await?;
    info!("fail2ban jail reloaded");
    Ok(())
}

pub async fn start_server(host: &Fail2banHost) -> Result<(), Fail2banError> {
    exec_ok(host, &["start"]).await?;
    info!("fail2ban server started");
    Ok(())
}

pub async fn stop_server(host: &Fail2banHost) -> Result<(), Fail2banError> {
    exec_ok(host, &["stop"]).await?;
    info!("fail2ban server stopped");
    Ok(())
}

pub async fn restart_server(host: &Fail2banHost) -> Result<(), Fail2banError> {
    let output = exec_program(
        host,
        host.use_sudo,
        "systemctl",
        &["restart", "fail2ban"],
        "restart fail2ban",
    )
    .await?;
    require_success("restart fail2ban", output)?;
    info!("fail2ban server restarted");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tokio::io::AsyncWriteExt;

    fn ssh_config() -> SshConfig {
        SshConfig {
            host: "server.example".into(),
            port: 22,
            username: "operator".into(),
            password: None,
            private_key_path: Some("/home/operator/key with spaces".into()),
            private_key_passphrase: None,
            ssh_options: HashMap::new(),
            connect_timeout: Some(5),
        }
    }

    #[test]
    fn remote_argv_quotes_injection_payloads_as_one_token() {
        let payload = "sshd'; touch /tmp/pwn; echo '";
        let command = build_remote_command(
            true,
            "fail2ban-client",
            &["set", payload, "banip", "192.0.2.1"],
        )
        .unwrap();
        assert_eq!(
            command,
            "'sudo' '--' 'fail2ban-client' 'set' 'sshd'\"'\"'; touch /tmp/pwn; echo '\"'\"'' 'banip' '192.0.2.1'"
        );
    }

    #[test]
    fn client_binary_policy_rejects_shell_syntax_and_relative_paths() {
        assert!(validate_program("fail2ban-client;id").is_err());
        assert!(validate_program("./fail2ban-client").is_err());
        assert!(validate_program("/usr/bin/fail2ban-client").is_ok());
    }

    #[test]
    fn ssh_args_are_noninteractive_strict_and_option_terminated() {
        let args = validated_ssh_args(&ssh_config()).unwrap();
        assert!(args.windows(2).any(|pair| pair == ["-o", "BatchMode=yes"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "StrictHostKeyChecking=yes"]));
        let separator = args.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(
            args.get(separator + 1).map(String::as_str),
            Some("server.example")
        );
    }

    #[test]
    fn unsupported_interactive_secrets_fail_closed_and_are_redacted() {
        let mut ssh = ssh_config();
        ssh.password = Some("do-not-print".into());
        assert!(matches!(
            validate_ssh_config(&ssh),
            Err(Fail2banError::AuthError(_))
        ));
        let host = Fail2banHost {
            id: "host-1".into(),
            name: "test".into(),
            description: None,
            ssh: Some(ssh),
            use_sudo: false,
            client_binary: None,
            tags: vec![],
        };
        let diagnostic = redact_diagnostic(&host, "password=do-not-print token=abc");
        assert!(!diagnostic.contains("do-not-print"));
        assert!(!diagnostic.contains("token=abc"));

        let bounded_output = "x".repeat(MAX_DIAGNOSTIC_BYTES * 2);
        assert_eq!(redact_output(&host, &bounded_output), bounded_output);
        assert_eq!(
            redact_diagnostic(&host, &bounded_output).len(),
            MAX_DIAGNOSTIC_BYTES
        );
    }

    #[tokio::test]
    async fn output_capture_drains_but_retains_only_the_bound() {
        let (mut writer, reader) = tokio::io::duplex(1024);
        let payload = vec![b'x'; MAX_OUTPUT_BYTES + 4096];
        let write = tokio::spawn(async move { writer.write_all(&payload).await });
        let captured = read_bounded(reader, MAX_OUTPUT_BYTES).await.unwrap();
        write.await.unwrap().unwrap();
        assert!(captured.truncated);
        assert_eq!(captured.into_string().len(), MAX_OUTPUT_BYTES);
    }

    #[tokio::test]
    async fn timeout_abstraction_is_deterministic() {
        let result = bounded_wait(std::future::pending::<()>(), Duration::from_millis(1)).await;
        assert!(result.is_err());
    }
}
