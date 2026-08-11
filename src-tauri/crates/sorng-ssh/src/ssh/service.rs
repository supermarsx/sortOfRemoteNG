use chrono::Utc;
use secrecy::{ExposeSecret, SecretString};
use socket2::{SockRef, TcpKeepalive};
use sorng_core::events::DynEventEmitter;
use ssh2::{ErrorCode as SshErrorCode, KeyboardInteractivePrompt, MethodType, Prompt, Session};
use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Shutdown, SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
#[cfg(windows)]
use std::os::windows::io::AsRawSocket;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream as AsyncTcpStream;
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use super::automation::process_automation_output;
use super::highlighting::process_highlight_output;
use super::output_state::{
    append_terminal_output, cleanup_session_output_state, ensure_terminal_buffer,
    StreamingUtf8Decoder,
};
use super::recording::{record_input, record_output, record_resize};
#[cfg(test)]
use super::shell_runtime::DEFAULT_MAX_ACTIVE_SSH_SHELLS;
use super::shell_runtime::{
    process_shell_admission, shell_mailbox, ShellAdmission, ShellCleanupTarget, ShellCompletion,
    ShellMailboxLimits, ShellWorkerCompletionGuard, ShellWorkerOutcome,
};
use super::types::*;
use super::PENDING_HOST_KEY_PROMPTS;

/// Bounded capacity, in 32 KiB relay chunks, for each direction of an SSH
/// port-forward / tunnel byte relay. 32 * 32 KiB = 1 MiB in flight per direction
/// per forward: large enough to keep the SSH channel and TCP window busy, but a
/// hard ceiling so a fast producer with a slow consumer applies backpressure
/// instead of growing process memory without bound (see t40-e7 F1).
const RELAY_CHANNEL_CAPACITY: usize = 32;
const DEFAULT_TCP_KEEPALIVE_INTERVAL_SECS: u64 = 60;
const MAX_TCP_KEEPALIVE_PROBES: u32 = 255;
const LIBSSH2_ERROR_EAGAIN: i32 = -37;
const SHELL_STOP_TIMEOUT: Duration = Duration::from_secs(5);
const SHELL_INPUT_COMMANDS_PER_TICK: usize = 64;
const SHELL_INPUT_BYTES_PER_TICK: usize = 64 * 1024;
const SCRIPT_EXECUTION_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const SCRIPT_CHANNEL_CLEANUP_TIMEOUT_MS: u32 = 5_000;
const SCRIPT_OUTPUT_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const SCRIPT_OUTPUT_LIMIT_ERROR: &str = "Remote script output exceeded the 4 MiB safety limit";
const SCRIPT_OUTPUT_READ_POLL_INTERVAL: Duration = Duration::from_millis(2);

/// Hard process-wide ceiling for SSH sessions that are either establishing or
/// retained. This is intentionally aligned with the native shell ceiling: a
/// connection without a shell is cheaper, but it still owns sockets, libssh2
/// state, credentials, tunnel metadata, and keepalive work.
pub const MAX_ACTIVE_OR_PENDING_SSH_SESSIONS: usize = 128;

/// Hard process-wide ceiling for concurrent DNS/TCP/proxy/libssh2 connection
/// workers. Establishment can block in native libraries, so this is
/// deliberately smaller than the retained-session ceiling.
pub const MAX_CONCURRENT_SSH_HANDSHAKES: usize = 16;

/// Maximum retained configuration payload for one active or pending SSH
/// connection. Public JSON plus serde-skipped secret bytes are both counted.
pub const MAX_SSH_RETAINED_CONFIG_BYTES: usize = 256 * 1024;

/// Aggregate retained SSH configuration budget across the process.
pub const MAX_SSH_RETAINED_CONFIG_BUDGET_BYTES: usize =
    MAX_ACTIVE_OR_PENDING_SSH_SESSIONS * MAX_SSH_RETAINED_CONFIG_BYTES;

const DEFAULT_SSH_ESTABLISHMENT_TIMEOUT: Duration = Duration::from_secs(15);
const MIN_SSH_ESTABLISHMENT_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_SSH_ESTABLISHMENT_TIMEOUT: Duration = Duration::from_secs(120);
const MIN_SSH_HOP_TIMEOUT: Duration = Duration::from_millis(100);
const MAX_SSH_HOP_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_CONCURRENT_SSH_LOCAL_PHASES: usize = 4;
const MAX_HTTP_PROXY_RESPONSE_LINE_BYTES: usize = 8 * 1024;
const MAX_HTTP_PROXY_RESPONSE_HEADER_BYTES: usize = 64 * 1024;
const HTTP_PROXY_RESPONSE_LIMIT_ERROR: &str =
    "HTTP proxy response headers exceeded the bounded parsing limit";

static SSH_LOCAL_PHASE_ADMISSION: OnceLock<Arc<Semaphore>> = OnceLock::new();

fn ssh_local_phase_admission() -> Arc<Semaphore> {
    Arc::clone(
        SSH_LOCAL_PHASE_ADMISSION
            .get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_SSH_LOCAL_PHASES))),
    )
}

async fn read_bounded_http_proxy_line<R>(
    reader: &mut R,
    consumed_header_bytes: &mut usize,
) -> Result<Vec<u8>, String>
where
    R: AsyncBufRead + Unpin,
{
    let mut line = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|_| "Failed to read HTTP proxy response".to_string())?;
        if available.is_empty() {
            return Err("HTTP proxy response ended before headers completed".to_string());
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if line.len().saturating_add(take) > MAX_HTTP_PROXY_RESPONSE_LINE_BYTES
            || consumed_header_bytes.saturating_add(take) > MAX_HTTP_PROXY_RESPONSE_HEADER_BYTES
        {
            return Err(HTTP_PROXY_RESPONSE_LIMIT_ERROR.to_string());
        }
        line.extend_from_slice(&available[..take]);
        reader.consume(take);
        *consumed_header_bytes += take;
        if line.last() == Some(&b'\n') {
            return Ok(line);
        }
    }
}

struct ZeroingCommandInput(Vec<u8>);

impl Drop for ZeroingCommandInput {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

fn remote_environment_set_failure_message(key: &str, error: &impl std::fmt::Display) -> String {
    format!(
        "Failed to set remote environment variable '{}': {} (value omitted)",
        key, error
    )
}

#[cfg(test)]
mod secret_logging_tests {
    use super::remote_environment_set_failure_message;

    #[test]
    fn remote_environment_failure_diagnostic_omits_the_value() {
        let secret_value = "remote-env-secret-that-must-not-be-logged";
        let message =
            remote_environment_set_failure_message("DEPLOY_TOKEN", &"server rejected setenv");

        assert!(message.contains("DEPLOY_TOKEN"));
        assert!(message.contains("server rejected setenv"));
        assert!(!message.contains(secret_value));
        assert!(message.contains("value omitted"));
    }
}

lazy_static::lazy_static! {
    /// `ssh2::KnownHosts::write_file` rewrites the complete file rather than
    /// merging with concurrent writers. Serialize every read/check and
    /// read-modify-write sequence across all retained integration services.
    static ref KNOWN_HOSTS_FILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
}

fn lock_known_hosts_file() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    KNOWN_HOSTS_FILE_LOCK
        .lock()
        .map_err(|_| "Failed to lock known_hosts file access".to_string())
}

fn normalized_keepalive_interval(interval_secs: Option<u64>) -> Duration {
    Duration::from_secs(
        interval_secs
            .filter(|interval| *interval > 0)
            .unwrap_or(DEFAULT_TCP_KEEPALIVE_INTERVAL_SECS)
            .min(u32::MAX as u64),
    )
}

fn normalized_keepalive_probes(probes: u32) -> u32 {
    probes.clamp(1, MAX_TCP_KEEPALIVE_PROBES)
}

fn tcp_keepalive_parameters(interval: Duration, _probes: u32) -> TcpKeepalive {
    let keepalive = TcpKeepalive::new().with_time(interval);

    #[cfg(any(
        target_os = "android",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "fuchsia",
        target_os = "illumos",
        target_os = "ios",
        target_os = "visionos",
        target_os = "linux",
        target_os = "macos",
        target_os = "netbsd",
        target_os = "tvos",
        target_os = "watchos",
        target_os = "windows",
        target_os = "cygwin",
    ))]
    let keepalive = keepalive.with_interval(interval);

    #[cfg(any(
        target_os = "android",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "fuchsia",
        target_os = "illumos",
        target_os = "ios",
        target_os = "visionos",
        target_os = "linux",
        target_os = "macos",
        target_os = "netbsd",
        target_os = "tvos",
        target_os = "watchos",
        target_os = "cygwin",
    ))]
    let keepalive = keepalive.with_retries(normalized_keepalive_probes(_probes));

    keepalive
}

#[cfg(windows)]
fn configure_windows_keepalive_retries(stream: &TcpStream, probes: u32) -> std::io::Result<()> {
    use windows_sys::Win32::Networking::WinSock::{
        setsockopt, IPPROTO_TCP, SOCKET_ERROR, TCP_KEEPCNT,
    };

    let probes = normalized_keepalive_probes(probes);
    let result = unsafe {
        setsockopt(
            stream.as_raw_socket() as usize,
            IPPROTO_TCP,
            TCP_KEEPCNT,
            (&probes as *const u32).cast(),
            std::mem::size_of_val(&probes) as i32,
        )
    };
    if result == SOCKET_ERROR {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn configure_tcp_options(stream: &TcpStream, config: &SshConnectionConfig) {
    if let Err(error) = stream.set_nodelay(config.tcp_no_delay) {
        log::warn!(
            "Failed to configure TCP_NODELAY for {}:{}: {}",
            config.host,
            config.port,
            error
        );
    }

    let socket = SockRef::from(stream);
    if !config.tcp_keepalive {
        if let Err(error) = socket.set_keepalive(false) {
            log::warn!(
                "Failed to disable TCP keepalive for {}:{}: {}",
                config.host,
                config.port,
                error
            );
        }
        return;
    }

    if let Err(error) = socket.set_keepalive(true) {
        log::warn!(
            "Failed to enable TCP keepalive for {}:{}: {}",
            config.host,
            config.port,
            error
        );
        return;
    }

    let interval = normalized_keepalive_interval(config.keep_alive_interval);
    let keepalive = tcp_keepalive_parameters(interval, config.keepalive_probes);
    if let Err(error) = socket.set_tcp_keepalive(&keepalive) {
        // Keepalive tuning is an availability aid, not a prerequisite for a
        // secure SSH transport. Preserve connectivity on platforms that reject
        // one of the optional socket parameters, but make the degraded state
        // observable instead of silently ignoring it.
        log::warn!(
            "Failed to configure TCP keepalive for {}:{}: {}",
            config.host,
            config.port,
            error
        );
    }

    #[cfg(windows)]
    if let Err(error) = configure_windows_keepalive_retries(stream, config.keepalive_probes) {
        // socket2 0.5 configures Windows keepalive time/interval through
        // SIO_KEEPALIVE_VALS but does not expose TCP_KEEPCNT. Windows itself
        // supports TCP_KEEPCNT from Windows 10 version 1703. Older kernels keep
        // their system probe count, so state that limitation rather than
        // claiming the requested value was applied.
        log::warn!(
            "Windows could not apply TCP keepalive probe count {} for {}:{}; \
             the operating-system default remains active: {}",
            normalized_keepalive_probes(config.keepalive_probes),
            config.host,
            config.port,
            error
        );
    }
}

fn is_transient_keepalive_error(error: &ssh2::Error) -> bool {
    matches!(error.code(), SshErrorCode::Session(LIBSSH2_ERROR_EAGAIN))
}

fn host_key_type_label(host_key_type: ssh2::HostKeyType) -> &'static str {
    match host_key_type {
        ssh2::HostKeyType::Rsa => "ssh-rsa",
        ssh2::HostKeyType::Dss => "ssh-dss",
        ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
        _ => "unknown",
    }
}

fn host_key_bits(raw_key: &[u8], host_key_type: ssh2::HostKeyType) -> Option<u32> {
    match host_key_type {
        ssh2::HostKeyType::Rsa => Some((raw_key.len() as u32).saturating_mul(8)),
        ssh2::HostKeyType::Ed25519 => Some(256),
        ssh2::HostKeyType::Ecdsa256 => Some(256),
        ssh2::HostKeyType::Ecdsa384 => Some(384),
        ssh2::HostKeyType::Ecdsa521 => Some(521),
        _ => None,
    }
}

fn build_host_key_info(raw_key: &[u8], host_key_type: ssh2::HostKeyType) -> SshHostKeyInfo {
    use base64::Engine;
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(raw_key);

    SshHostKeyInfo {
        fingerprint: hex::encode(hasher.finalize()),
        key_type: Some(host_key_type_label(host_key_type).to_string()),
        key_bits: host_key_bits(raw_key, host_key_type),
        public_key: Some(base64::engine::general_purpose::STANDARD.encode(raw_key)),
    }
}

struct HostKeyPersistenceContext<'a> {
    config: &'a SshConnectionConfig,
    known_hosts_path: &'a str,
    host_key: &'a [u8],
    key_type: ssh2::HostKeyType,
    replace_existing: bool,
}

fn known_host_entry_name(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{}]:{}", host, port)
    }
}

fn known_host_cleanup_names(host: &str, port: u16) -> Vec<String> {
    if port == 22 {
        vec![host.to_string(), format!("[{}]:22", host)]
    } else {
        vec![format!("[{}]:{}", host, port)]
    }
}

pub(crate) fn known_host_key_format(host_key_type: ssh2::HostKeyType) -> ssh2::KnownHostKeyFormat {
    host_key_type.into()
}

fn read_known_hosts_if_present(
    known_hosts: &mut ssh2::KnownHosts,
    path: &Path,
) -> Result<(), String> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => known_hosts
            .read_file(path, ssh2::KnownHostFileKind::OpenSSH)
            .map(|_| ())
            .map_err(|error| {
                format!(
                    "Failed to read known_hosts file {}: {error}",
                    path.display()
                )
            }),
        Ok(_) => Err(format!(
            "Failed to read known_hosts file {}: path is not a regular file",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to inspect known_hosts file {}: {error}",
            path.display()
        )),
    }
}

/// Generate a TOTP code from a secret
pub fn generate_totp_code(secret: &str) -> Result<String, String> {
    use totp_rs::{Algorithm, TOTP};

    // Try to decode the secret (it might be base32 encoded)
    let secret_bytes = if secret.chars().all(|c| c.is_ascii_alphanumeric()) {
        // Likely base32 encoded
        data_encoding::BASE32_NOPAD
            .decode(secret.to_uppercase().as_bytes())
            .unwrap_or_else(|_| secret.as_bytes().to_vec())
    } else {
        secret.as_bytes().to_vec()
    };

    let totp = TOTP::new(
        Algorithm::SHA1,
        6,  // 6 digits
        1,  // 1 step
        30, // 30 second period
        secret_bytes,
    )
    .map_err(|e| format!("Failed to create TOTP: {}", e))?;

    totp.generate_current()
        .map_err(|e| format!("Failed to generate TOTP: {}", e))
}

fn shebang_path_for_interpreter(interpreter: &str) -> &str {
    match interpreter {
        "bash" => "/usr/bin/env bash",
        "sh" => "/bin/sh",
        "python" | "python3" => "/usr/bin/env python3",
        "perl" => "/usr/bin/env perl",
        "powershell" => "/usr/bin/env pwsh",
        other => other,
    }
}

fn prepare_uploaded_script(script: &str, interpreter: &str) -> String {
    if script.starts_with("#!") {
        script.to_string()
    } else {
        format!(
            "#!{}\n{}",
            shebang_path_for_interpreter(interpreter),
            script
        )
    }
}

fn build_script_invocation(remote_path: &str, interpreter: &str) -> String {
    let quoted_path = shell_escape::escape(remote_path.into()).to_string();

    match interpreter {
        // BusyBox / Alpine-style systems often have `sh` but not `bash`.
        // Prefer bash when available, but transparently fall back to sh for
        // portable scripts such as the built-in Script Manager templates.
        "bash" => format!(
            "if command -v bash >/dev/null 2>&1; then bash {path}; elif [ -x /bin/bash ]; then /bin/bash {path}; elif command -v sh >/dev/null 2>&1; then sh {path}; elif [ -x /bin/sh ]; then /bin/sh {path}; else {path}; fi",
            path = quoted_path,
        ),
        "sh" => format!(
            "if command -v sh >/dev/null 2>&1; then sh {path}; elif [ -x /bin/sh ]; then /bin/sh {path}; else {path}; fi",
            path = quoted_path,
        ),
        "python" | "python3" => format!(
            "if command -v python3 >/dev/null 2>&1; then python3 {path}; elif command -v python >/dev/null 2>&1; then python {path}; else {path}; fi",
            path = quoted_path,
        ),
        "perl" => format!(
            "if command -v perl >/dev/null 2>&1; then perl {path}; else {path}; fi",
            path = quoted_path,
        ),
        "powershell" => format!(
            "if command -v pwsh >/dev/null 2>&1; then pwsh -File {path}; elif command -v powershell >/dev/null 2>&1; then powershell -File {path}; else {path}; fi",
            path = quoted_path,
        ),
        other => format!("{} {}", shell_escape::escape(other.into()), quoted_path),
    }
}

fn wrap_script_invocation_with_exit_sentinel(invocation: &str) -> String {
    format!(
        "{invocation}; __sorng_ec=$?; printf '\n__SORNG_EXIT:%s\n' \"$__sorng_ec\"; exit $__sorng_ec"
    )
}

fn parse_script_stdout_and_exit(raw_stdout: &str, raw_exit: i32) -> (String, i32) {
    if let Some(pos) = raw_stdout.rfind("__SORNG_EXIT:") {
        let before = raw_stdout[..pos].trim_end().to_string();
        let code_str = raw_stdout[pos + "__SORNG_EXIT:".len()..].trim();
        let code = code_str.parse::<i32>().unwrap_or(raw_exit);
        (before, code)
    } else {
        (raw_stdout.to_string(), raw_exit)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ScriptOutputReadError {
    OutputLimitExceeded,
    DeadlineExceeded,
    Cancelled,
    StdoutReadFailed,
    StderrReadFailed,
}

impl ScriptOutputReadError {
    fn user_message(self) -> &'static str {
        match self {
            Self::OutputLimitExceeded => SCRIPT_OUTPUT_LIMIT_ERROR,
            Self::DeadlineExceeded => "Remote script execution exceeded the five-minute deadline",
            Self::Cancelled => "Remote script output collection was cancelled",
            Self::StdoutReadFailed => "Failed to read remote script stdout",
            Self::StderrReadFailed => "Failed to read remote script stderr",
        }
    }

    fn priority(self) -> u8 {
        match self {
            Self::OutputLimitExceeded => 0,
            Self::DeadlineExceeded => 1,
            Self::StdoutReadFailed | Self::StderrReadFailed => 2,
            Self::Cancelled => 3,
        }
    }
}

#[derive(Clone, Copy)]
enum ScriptOutputStream {
    Stdout,
    Stderr,
}

impl ScriptOutputStream {
    fn read_error(self) -> ScriptOutputReadError {
        match self {
            Self::Stdout => ScriptOutputReadError::StdoutReadFailed,
            Self::Stderr => ScriptOutputReadError::StderrReadFailed,
        }
    }
}

fn read_script_stream_bounded<R: Read>(
    mut reader: R,
    stream: ScriptOutputStream,
    bytes_read: Arc<AtomicUsize>,
    byte_limit: usize,
    deadline: Instant,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<u8>, ScriptOutputReadError> {
    let mut output = Vec::new();
    let mut chunk = [0_u8; 8 * 1024];

    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(ScriptOutputReadError::Cancelled);
        }
        if Instant::now() >= deadline {
            cancelled.store(true, Ordering::Release);
            return Err(ScriptOutputReadError::DeadlineExceeded);
        }

        match reader.read(&mut chunk) {
            Ok(0) => return Ok(output),
            Ok(count) => {
                if cancelled.load(Ordering::Acquire) {
                    return Err(ScriptOutputReadError::Cancelled);
                }

                let reserved = bytes_read
                    .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                        current
                            .checked_add(count)
                            .filter(|next| *next <= byte_limit)
                    })
                    .is_ok();
                if !reserved {
                    cancelled.store(true, Ordering::Release);
                    return Err(ScriptOutputReadError::OutputLimitExceeded);
                }
                output.extend_from_slice(&chunk[..count]);
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                std::thread::sleep(SCRIPT_OUTPUT_READ_POLL_INTERVAL.min(remaining));
            }
            Err(_) => {
                cancelled.store(true, Ordering::Release);
                return Err(stream.read_error());
            }
        }
    }
}

fn read_script_output_bounded<Stdout, Stderr>(
    stdout: Stdout,
    stderr: Stderr,
    byte_limit: usize,
    deadline: Instant,
    cancelled: Arc<AtomicBool>,
) -> Result<(Vec<u8>, Vec<u8>), ScriptOutputReadError>
where
    Stdout: Read + Send,
    Stderr: Read + Send,
{
    let bytes_read = Arc::new(AtomicUsize::new(0));
    let (stdout_result, stderr_result) = std::thread::scope(|scope| {
        let stdout_bytes_read = Arc::clone(&bytes_read);
        let stdout_cancelled = Arc::clone(&cancelled);
        let stdout_task = scope.spawn(move || {
            read_script_stream_bounded(
                stdout,
                ScriptOutputStream::Stdout,
                stdout_bytes_read,
                byte_limit,
                deadline,
                stdout_cancelled,
            )
        });

        let stderr_bytes_read = Arc::clone(&bytes_read);
        let stderr_cancelled = Arc::clone(&cancelled);
        let stderr_task = scope.spawn(move || {
            read_script_stream_bounded(
                stderr,
                ScriptOutputStream::Stderr,
                stderr_bytes_read,
                byte_limit,
                deadline,
                stderr_cancelled,
            )
        });

        let stdout_result = stdout_task
            .join()
            .unwrap_or(Err(ScriptOutputReadError::StdoutReadFailed));
        let stderr_result = stderr_task
            .join()
            .unwrap_or(Err(ScriptOutputReadError::StderrReadFailed));
        (stdout_result, stderr_result)
    });

    if stdout_result.is_err() || stderr_result.is_err() {
        let error = [stdout_result.as_ref().err(), stderr_result.as_ref().err()]
            .into_iter()
            .flatten()
            .copied()
            .min_by_key(|error| error.priority())
            .unwrap_or(ScriptOutputReadError::Cancelled);
        return Err(error);
    }

    Ok((
        stdout_result.unwrap_or_default(),
        stderr_result.unwrap_or_default(),
    ))
}

fn is_transient_shell_io_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
    ) || error
        .to_string()
        .to_ascii_lowercase()
        .contains("timed out waiting on socket")
}

fn shell_closed_event(
    session_id: String,
    reason: SshShellCloseReason,
    message: Option<String>,
) -> SshShellClosed {
    SshShellClosed {
        session_id,
        reason,
        recoverable: reason != SshShellCloseReason::Requested,
        message,
    }
}

fn prepare_shell_output(session_id: &str, raw_output: &str) -> Option<SshShellOutput> {
    if raw_output.is_empty() {
        return None;
    }

    // Recording and automation consume the unhighlighted terminal text.
    record_output(session_id, raw_output);
    process_automation_output(session_id, raw_output);

    // Replay and renderer delivery use the same highlighted UTF-8 stream, so
    // their sequence offsets describe the exact bytes the renderer receives.
    let output = process_highlight_output(session_id, raw_output);
    let replay = append_terminal_output(session_id, &output).ok();
    Some(SshShellOutput {
        session_id: session_id.to_string(),
        data: output,
        generation: replay.map(|metadata| metadata.generation),
        sequence_start: replay.map(|metadata| metadata.sequence_start),
        sequence_end: replay.map(|metadata| metadata.sequence_end),
        retained_start: replay.map(|metadata| metadata.retained_start),
        dropped_bytes: replay.map(|metadata| metadata.dropped_bytes),
    })
}

fn emit_shell_output(payload: SshShellOutput, emitter: &DynEventEmitter) {
    let _ = emitter.emit_event(
        "ssh-output",
        serde_json::to_value(&payload).unwrap_or_default(),
    );
}

fn write_shell_input(channel: &mut ssh2::Channel, data: &[u8]) -> Result<(), String> {
    channel.write_all(data).map_err(|error| error.to_string())?;
    channel.flush().map_err(|error| error.to_string())
}

fn emit_shell_error(session_id: &str, message: &str, emitter: &DynEventEmitter) {
    let payload = SshShellError {
        session_id: session_id.to_string(),
        message: message.to_string(),
    };
    let _ = emitter.emit_event(
        "ssh-error",
        serde_json::to_value(&payload).unwrap_or_default(),
    );
}

#[derive(Debug)]
struct PendingSshConnection {
    cancellation: tokio::sync::watch::Sender<bool>,
}

impl PendingSshConnection {
    fn new() -> Self {
        let (cancellation, _receiver) = tokio::sync::watch::channel(false);
        Self { cancellation }
    }

    fn cancel(&self) {
        self.cancellation.send_replace(true);
    }

    fn is_cancelled(&self) -> bool {
        *self.cancellation.borrow()
    }

    async fn cancelled(&self) {
        let mut cancellation = self.cancellation.subscribe();
        if *cancellation.borrow_and_update() {
            return;
        }
        while cancellation.changed().await.is_ok() {
            if *cancellation.borrow_and_update() {
                return;
            }
        }
    }
}

type PendingSshConnections =
    std::sync::Arc<StdMutex<HashMap<String, std::sync::Arc<PendingSshConnection>>>>;

pub const SSH_CONNECTION_TIMEOUT_ERROR_CODE: &str = "SSH_CONNECTION_TIMEOUT";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SshConnectionTimeoutError {
    Phase { phase: String, timeout_ms: u64 },
}

impl std::fmt::Display for SshConnectionTimeoutError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Phase { phase, timeout_ms } => write!(
                formatter,
                "{SSH_CONNECTION_TIMEOUT_ERROR_CODE}: SSH establishment phase '{phase}' exceeded its {timeout_ms} ms deadline"
            ),
        }
    }
}

impl std::error::Error for SshConnectionTimeoutError {}

fn contextualize_ssh_connection_error(context: &str, error: String) -> String {
    if let Some(detail) = error.strip_prefix(SSH_CONNECTION_TIMEOUT_ERROR_CODE) {
        let detail = detail.trim_start_matches(':').trim_start();
        format!("{SSH_CONNECTION_TIMEOUT_ERROR_CODE}: {context}: {detail}")
    } else {
        format!("{context}: {error}")
    }
}

const ESTABLISHMENT_ACTIVE: u8 = 0;
const ESTABLISHMENT_TIMED_OUT: u8 = 1;
const ESTABLISHMENT_CANCELLED: u8 = 2;
const ESTABLISHMENT_COMPLETED: u8 = 3;

fn clamped_ssh_establishment_timeout(configured_secs: Option<u64>) -> Duration {
    Duration::from_secs(configured_secs.unwrap_or(DEFAULT_SSH_ESTABLISHMENT_TIMEOUT.as_secs()))
        .clamp(MIN_SSH_ESTABLISHMENT_TIMEOUT, MAX_SSH_ESTABLISHMENT_TIMEOUT)
}

fn clamped_ssh_hop_timeout(configured_ms: u64) -> Duration {
    Duration::from_millis(configured_ms).clamp(MIN_SSH_HOP_TIMEOUT, MAX_SSH_HOP_TIMEOUT)
}

fn duration_millis_u64(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn is_native_ssh_socket_timeout(error: &str) -> bool {
    error.contains("[Session(-9)]") || error.contains("Timed out waiting on socket")
}

fn shutdown_establishment_sockets(sockets: &StdMutex<Vec<TcpStream>>) {
    let sockets = sockets
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    for socket in sockets.iter() {
        let _ = socket.shutdown(Shutdown::Both);
    }
}

struct SshEstablishmentControl {
    deadline: Instant,
    overall_timeout: Duration,
    cancellation: Arc<PendingSshConnection>,
    sockets: Arc<StdMutex<Vec<TcpStream>>>,
    outcome: Arc<AtomicU8>,
    runtime: tokio::runtime::Handle,
    watchdog: StdMutex<Option<tokio::task::JoinHandle<()>>>,
}

impl SshEstablishmentControl {
    fn new(
        config: &SshConnectionConfig,
        cancellation: Arc<PendingSshConnection>,
    ) -> Result<Arc<Self>, String> {
        Self::new_with_timeout(
            clamped_ssh_establishment_timeout(config.connect_timeout),
            cancellation,
        )
    }

    fn new_with_timeout(
        overall_timeout: Duration,
        cancellation: Arc<PendingSshConnection>,
    ) -> Result<Arc<Self>, String> {
        let overall_timeout = overall_timeout.clamp(
            #[cfg(not(test))]
            MIN_SSH_ESTABLISHMENT_TIMEOUT,
            #[cfg(test)]
            Duration::from_millis(10),
            MAX_SSH_ESTABLISHMENT_TIMEOUT,
        );
        let runtime = tokio::runtime::Handle::try_current()
            .map_err(|error| format!("SSH establishment requires a Tokio runtime: {error}"))?;
        let deadline = Instant::now() + overall_timeout;
        let sockets = Arc::new(StdMutex::new(Vec::new()));
        let outcome = Arc::new(AtomicU8::new(ESTABLISHMENT_ACTIVE));
        let watchdog_sockets = Arc::clone(&sockets);
        let watchdog_outcome = Arc::clone(&outcome);
        let watchdog_cancellation = Arc::clone(&cancellation);
        let watchdog = runtime.spawn(async move {
            tokio::select! {
                biased;
                _ = watchdog_cancellation.cancelled() => {
                    if watchdog_outcome.compare_exchange(
                        ESTABLISHMENT_ACTIVE,
                        ESTABLISHMENT_CANCELLED,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    ).is_ok() {
                        shutdown_establishment_sockets(&watchdog_sockets);
                    }
                }
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => {
                    if watchdog_outcome.compare_exchange(
                        ESTABLISHMENT_ACTIVE,
                        ESTABLISHMENT_TIMED_OUT,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    ).is_ok() {
                        shutdown_establishment_sockets(&watchdog_sockets);
                    }
                }
            }
        });

        Ok(Arc::new(Self {
            deadline,
            overall_timeout,
            cancellation,
            sockets,
            outcome,
            runtime,
            watchdog: StdMutex::new(Some(watchdog)),
        }))
    }

    fn timeout_error(&self, phase: &str, timeout: Duration) -> String {
        SshConnectionTimeoutError::Phase {
            phase: phase.to_string(),
            timeout_ms: duration_millis_u64(timeout),
        }
        .to_string()
    }

    fn trigger(&self, outcome: u8) {
        let transition = self.outcome.compare_exchange(
            ESTABLISHMENT_ACTIVE,
            outcome,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        if transition.is_ok() || transition == Err(outcome) {
            shutdown_establishment_sockets(&self.sockets);
        }
    }

    fn expire_phase(&self, deadline: Instant) {
        if deadline >= self.deadline {
            self.trigger(ESTABLISHMENT_TIMED_OUT);
        } else {
            shutdown_establishment_sockets(&self.sockets);
        }
    }

    fn ensure_active(&self, phase: &str) -> Result<(), String> {
        if self.cancellation.is_cancelled()
            || self.outcome.load(Ordering::Acquire) == ESTABLISHMENT_CANCELLED
        {
            self.trigger(ESTABLISHMENT_CANCELLED);
            return Err("SSH connection cancelled".to_string());
        }
        if Instant::now() >= self.deadline
            || self.outcome.load(Ordering::Acquire) == ESTABLISHMENT_TIMED_OUT
        {
            self.trigger(ESTABLISHMENT_TIMED_OUT);
            return Err(self.timeout_error(phase, self.overall_timeout));
        }
        Ok(())
    }

    fn effective_deadline(&self, requested: Duration) -> Result<(Instant, Duration), String> {
        self.ensure_active("overall")?;
        let now = Instant::now();
        let remaining = self.deadline.saturating_duration_since(now);
        let effective = requested.min(remaining);
        Ok((now + effective, effective))
    }

    async fn run_async_phase<T, F>(
        &self,
        phase: &str,
        requested: Duration,
        future: F,
    ) -> Result<T, String>
    where
        F: Future<Output = Result<T, String>>,
    {
        let (deadline, effective) = self.effective_deadline(requested)?;
        self.run_async_until(phase, deadline, effective, future)
            .await
    }

    async fn run_async_until<T, F>(
        &self,
        phase: &str,
        deadline: Instant,
        effective: Duration,
        future: F,
    ) -> Result<T, String>
    where
        F: Future<Output = Result<T, String>>,
    {
        tokio::pin!(future);
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => {
                self.trigger(ESTABLISHMENT_CANCELLED);
                Err("SSH connection cancelled".to_string())
            }
            _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => {
                self.expire_phase(deadline);
                Err(self.timeout_error(phase, effective))
            }
            result = &mut future => result,
        }
    }

    async fn run_isolated_local_phase<T, F>(
        self: &Arc<Self>,
        phase: &str,
        requested: Duration,
        session_lease: Option<Arc<SshSessionAdmissionLease>>,
        operation: F,
    ) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&SshIsolatedPhaseContext) -> Result<T, String> + Send + 'static,
    {
        self.run_isolated_local_phase_with_admission(
            phase,
            requested,
            session_lease,
            ssh_local_phase_admission(),
            operation,
        )
        .await
    }

    async fn run_isolated_local_phase_with_admission<T, F>(
        self: &Arc<Self>,
        phase: &str,
        requested: Duration,
        session_lease: Option<Arc<SshSessionAdmissionLease>>,
        admission: Arc<Semaphore>,
        operation: F,
    ) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&SshIsolatedPhaseContext) -> Result<T, String> + Send + 'static,
    {
        let (deadline, effective) = self.effective_deadline(requested)?;
        let permit = self
            .run_async_until(phase, deadline, effective, async move {
                admission
                    .acquire_owned()
                    .await
                    .map_err(|_| "SSH local phase admission is closed".to_string())
            })
            .await?;
        let context = SshIsolatedPhaseContext {
            control: Arc::clone(self),
            phase: phase.to_string(),
            deadline,
            effective,
        };
        let worker = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let _session_lease = session_lease;
            operation(&context)
        });
        self.run_async_until(phase, deadline, effective, async move {
            worker
                .await
                .map_err(|error| format!("SSH local phase worker failed: {error}"))?
        })
        .await
    }

    fn track_blocking_socket(&self, stream: &TcpStream, phase: &str) -> Result<(), String> {
        self.ensure_active(phase)?;
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            self.trigger(ESTABLISHMENT_TIMED_OUT);
            return Err(self.timeout_error(phase, self.overall_timeout));
        }
        // Windows socket clones do not reliably share SO_RCVTIMEO/SO_SNDTIMEO
        // resets with the retained handle. The watchdog's shutdown clone plus
        // libssh2's per-call timeout provide the deadline there without leaking
        // a one-shot establishment timeout into the live session.
        #[cfg(not(windows))]
        {
            let remaining = remaining.max(Duration::from_millis(1));
            stream.set_read_timeout(Some(remaining)).map_err(|error| {
                format!("Failed to configure SSH establishment read deadline: {error}")
            })?;
            stream.set_write_timeout(Some(remaining)).map_err(|error| {
                format!("Failed to configure SSH establishment write deadline: {error}")
            })?;
        }
        let tracked = stream
            .try_clone()
            .map_err(|error| format!("Failed to track SSH establishment socket: {error}"))?;
        self.sockets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(tracked);
        self.ensure_active(phase)
    }

    fn complete(&self) -> Result<(), String> {
        self.ensure_active("overall")?;
        if self
            .outcome
            .compare_exchange(
                ESTABLISHMENT_ACTIVE,
                ESTABLISHMENT_COMPLETED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_err()
        {
            self.ensure_active("overall")?;
            return Err("SSH establishment state transition failed".to_string());
        }
        if let Some(watchdog) = self
            .watchdog
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            watchdog.abort();
        }
        let mut sockets = self
            .sockets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        #[cfg(not(windows))]
        let reset_result = {
            let mut reset_error = None;
            for socket in sockets.iter() {
                if let Err(error) = socket.set_read_timeout(None) {
                    reset_error.get_or_insert_with(|| {
                        format!("Failed to clear SSH establishment read deadline: {error}")
                    });
                }
                if let Err(error) = socket.set_write_timeout(None) {
                    reset_error.get_or_insert_with(|| {
                        format!("Failed to clear SSH establishment write deadline: {error}")
                    });
                }
            }
            reset_error
        };
        #[cfg(not(windows))]
        if let Some(error) = reset_result {
            for socket in sockets.iter() {
                let _ = socket.shutdown(Shutdown::Both);
            }
            sockets.clear();
            return Err(error);
        }
        sockets.clear();
        Ok(())
    }

    fn arm_blocking_phase(
        self: &Arc<Self>,
        phase: &str,
        requested: Duration,
    ) -> Result<SshBlockingPhaseGuard, String> {
        let (deadline, effective) = self.effective_deadline(requested)?;
        let cancellation = Arc::clone(&self.cancellation);
        let sockets = Arc::clone(&self.sockets);
        let outcome = Arc::clone(&self.outcome);
        let is_overall_deadline = deadline >= self.deadline;
        let task = self.runtime.spawn(async move {
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => {
                    if outcome.compare_exchange(
                        ESTABLISHMENT_ACTIVE,
                        ESTABLISHMENT_CANCELLED,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    ).is_ok() {
                        shutdown_establishment_sockets(&sockets);
                    }
                }
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => {
                    if is_overall_deadline {
                        if outcome.compare_exchange(
                            ESTABLISHMENT_ACTIVE,
                            ESTABLISHMENT_TIMED_OUT,
                            Ordering::AcqRel,
                            Ordering::Acquire,
                        ).is_ok() {
                            shutdown_establishment_sockets(&sockets);
                        }
                    } else {
                        shutdown_establishment_sockets(&sockets);
                    }
                }
            }
        });
        Ok(SshBlockingPhaseGuard {
            control: Arc::clone(self),
            phase: phase.to_string(),
            deadline,
            effective,
            is_overall_deadline,
            task: Some(task),
        })
    }

    fn run_blocking_phase<T, F>(
        self: &Arc<Self>,
        phase: &str,
        requested: Duration,
        operation: F,
    ) -> Result<T, String>
    where
        F: FnOnce(&SshBlockingPhaseGuard) -> Result<T, String>,
    {
        let guard = self.arm_blocking_phase(phase, requested)?;
        let result = operation(&guard);
        guard.finish(result)
    }
}

impl Drop for SshEstablishmentControl {
    fn drop(&mut self) {
        if let Ok(watchdog) = self.watchdog.get_mut() {
            if let Some(watchdog) = watchdog.take() {
                watchdog.abort();
            }
        }
        self.sockets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }
}

struct SshBlockingPhaseGuard {
    control: Arc<SshEstablishmentControl>,
    phase: String,
    deadline: Instant,
    effective: Duration,
    is_overall_deadline: bool,
    task: Option<tokio::task::JoinHandle<()>>,
}

trait SshDeadlinePhase {
    fn ensure_active(&self) -> Result<(), String>;
    fn configure_session_timeout(&self, session: &Session) -> Result<(), String>;
}

struct SshIsolatedPhaseContext {
    control: Arc<SshEstablishmentControl>,
    phase: String,
    deadline: Instant,
    effective: Duration,
}

impl SshIsolatedPhaseContext {
    async fn run_async<T, F>(&self, future: F) -> Result<T, String>
    where
        F: Future<Output = Result<T, String>>,
    {
        self.control
            .run_async_until(&self.phase, self.deadline, self.effective, future)
            .await
    }
}

impl SshDeadlinePhase for SshIsolatedPhaseContext {
    fn ensure_active(&self) -> Result<(), String> {
        self.control.ensure_active(&self.phase)?;
        if Instant::now() >= self.deadline {
            self.control.expire_phase(self.deadline);
            return Err(self.control.timeout_error(&self.phase, self.effective));
        }
        Ok(())
    }

    fn configure_session_timeout(&self, session: &Session) -> Result<(), String> {
        self.ensure_active()?;
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        let timeout_ms = remaining
            .as_millis()
            .saturating_add(1)
            .clamp(1, u32::MAX as u128) as u32;
        session.set_timeout(timeout_ms);
        Ok(())
    }
}

impl SshDeadlinePhase for SshBlockingPhaseGuard {
    fn ensure_active(&self) -> Result<(), String> {
        self.control.ensure_active(&self.phase)?;
        if Instant::now() >= self.deadline {
            self.control.expire_phase(self.deadline);
            return Err(self.control.timeout_error(&self.phase, self.effective));
        }
        Ok(())
    }

    fn configure_session_timeout(&self, session: &Session) -> Result<(), String> {
        self.ensure_active()?;
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        let timeout_ms = remaining
            .as_millis()
            .saturating_add(1)
            .clamp(1, u32::MAX as u128) as u32;
        session.set_timeout(timeout_ms);
        Ok(())
    }
}

impl SshBlockingPhaseGuard {
    fn finish<T>(mut self, result: Result<T, String>) -> Result<T, String> {
        if let Some(task) = self.task.take() {
            task.abort();
        }
        if self.control.cancellation.is_cancelled()
            || self.control.outcome.load(Ordering::Acquire) == ESTABLISHMENT_CANCELLED
        {
            self.control.trigger(ESTABLISHMENT_CANCELLED);
            return Err("SSH connection cancelled".to_string());
        }
        let native_socket_timeout = result
            .as_ref()
            .is_err_and(|error| is_native_ssh_socket_timeout(error));
        if Instant::now() >= self.deadline
            || self.control.outcome.load(Ordering::Acquire) == ESTABLISHMENT_TIMED_OUT
            || native_socket_timeout
        {
            if self.is_overall_deadline {
                self.control.trigger(ESTABLISHMENT_TIMED_OUT);
            } else {
                shutdown_establishment_sockets(&self.control.sockets);
            }
            return Err(self.control.timeout_error(&self.phase, self.effective));
        }
        result
    }
}

impl Drop for SshBlockingPhaseGuard {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

pub const SSH_SESSION_CAPACITY_ERROR_CODE: &str = "SSH_SESSION_CAPACITY";
pub const SSH_HANDSHAKE_CAPACITY_ERROR_CODE: &str = "SSH_HANDSHAKE_CAPACITY";
pub const SSH_CONFIG_CAPACITY_ERROR_CODE: &str = "SSH_CONFIG_CAPACITY";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SshConnectionAdmissionError {
    SessionCapacity { limit: usize },
    HandshakeCapacity { limit: usize },
    ConfigTooLarge { bytes: usize, limit: usize },
    ConfigBudget { bytes: usize, limit: usize },
    ConfigAccounting,
}

impl std::fmt::Display for SshConnectionAdmissionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SessionCapacity { limit } => write!(
                formatter,
                "{SSH_SESSION_CAPACITY_ERROR_CODE}: active or pending SSH session limit reached ({limit})"
            ),
            Self::HandshakeCapacity { limit } => write!(
                formatter,
                "{SSH_HANDSHAKE_CAPACITY_ERROR_CODE}: concurrent SSH handshake limit reached ({limit})"
            ),
            Self::ConfigTooLarge { bytes, limit } => write!(
                formatter,
                "{SSH_CONFIG_CAPACITY_ERROR_CODE}: retained SSH connection configuration is {bytes} bytes; limit is {limit} bytes"
            ),
            Self::ConfigBudget { bytes, limit } => write!(
                formatter,
                "{SSH_CONFIG_CAPACITY_ERROR_CODE}: aggregate retained SSH configuration budget reached while reserving {bytes} bytes ({limit} byte limit)"
            ),
            Self::ConfigAccounting => write!(
                formatter,
                "{SSH_CONFIG_CAPACITY_ERROR_CODE}: SSH configuration size accounting overflowed"
            ),
        }
    }
}

impl std::error::Error for SshConnectionAdmissionError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SshConnectionAdmissionLimits {
    max_sessions: usize,
    max_handshakes: usize,
    max_config_bytes: usize,
    config_budget_bytes: usize,
}

impl Default for SshConnectionAdmissionLimits {
    fn default() -> Self {
        Self {
            max_sessions: MAX_ACTIVE_OR_PENDING_SSH_SESSIONS,
            max_handshakes: MAX_CONCURRENT_SSH_HANDSHAKES,
            max_config_bytes: MAX_SSH_RETAINED_CONFIG_BYTES,
            config_budget_bytes: MAX_SSH_RETAINED_CONFIG_BUDGET_BYTES,
        }
    }
}

#[derive(Debug)]
struct SshConnectionAdmission {
    session_slots: Arc<Semaphore>,
    handshake_slots: Arc<Semaphore>,
    config_bytes: Arc<Semaphore>,
    limits: SshConnectionAdmissionLimits,
}

impl SshConnectionAdmission {
    fn new(limits: SshConnectionAdmissionLimits) -> Arc<Self> {
        assert!(limits.max_sessions > 0);
        assert!(limits.max_handshakes > 0);
        assert!(limits.max_config_bytes > 0);
        assert!(limits.config_budget_bytes > 0);
        assert!(limits.max_handshakes < limits.max_sessions);
        assert!(u32::try_from(limits.config_budget_bytes).is_ok());
        Arc::new(Self {
            session_slots: Arc::new(Semaphore::new(limits.max_sessions)),
            handshake_slots: Arc::new(Semaphore::new(limits.max_handshakes)),
            config_bytes: Arc::new(Semaphore::new(limits.config_budget_bytes)),
            limits,
        })
    }

    fn reserve_session(
        self: &Arc<Self>,
        config: &SshConnectionConfig,
    ) -> Result<Arc<SshSessionAdmissionLease>, SshConnectionAdmissionError> {
        let payload_bytes = retained_ssh_config_bytes(config)?;
        if payload_bytes > self.limits.max_config_bytes {
            return Err(SshConnectionAdmissionError::ConfigTooLarge {
                bytes: payload_bytes,
                limit: self.limits.max_config_bytes,
            });
        }
        // Reserve the full per-session ceiling up front. Runtime auth updates
        // may replace serde-skipped secrets, so charging only the initial byte
        // count would let retained state grow beyond the aggregate budget.
        let reserved_bytes = self.limits.max_config_bytes;
        let payload_permits = u32::try_from(reserved_bytes)
            .map_err(|_| SshConnectionAdmissionError::ConfigAccounting)?;
        let session_slot = Arc::clone(&self.session_slots)
            .try_acquire_owned()
            .map_err(|_| SshConnectionAdmissionError::SessionCapacity {
                limit: self.limits.max_sessions,
            })?;
        let config_bytes =
            match Arc::clone(&self.config_bytes).try_acquire_many_owned(payload_permits) {
                Ok(permit) => permit,
                Err(_) => {
                    drop(session_slot);
                    return Err(SshConnectionAdmissionError::ConfigBudget {
                        bytes: reserved_bytes,
                        limit: self.limits.config_budget_bytes,
                    });
                }
            };
        Ok(Arc::new(SshSessionAdmissionLease {
            _session_slot: session_slot,
            _config_bytes: config_bytes,
            _retained_config_bytes: reserved_bytes,
        }))
    }

    fn reserve_handshake(
        self: &Arc<Self>,
    ) -> Result<OwnedSemaphorePermit, SshConnectionAdmissionError> {
        Arc::clone(&self.handshake_slots)
            .try_acquire_owned()
            .map_err(|_| SshConnectionAdmissionError::HandshakeCapacity {
                limit: self.limits.max_handshakes,
            })
    }

    #[cfg(test)]
    fn snapshot(&self) -> SshConnectionAdmissionSnapshot {
        SshConnectionAdmissionSnapshot {
            active_or_pending: self
                .limits
                .max_sessions
                .saturating_sub(self.session_slots.available_permits()),
            active_handshakes: self
                .limits
                .max_handshakes
                .saturating_sub(self.handshake_slots.available_permits()),
            retained_config_bytes: self
                .limits
                .config_budget_bytes
                .saturating_sub(self.config_bytes.available_permits()),
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct SshConnectionAdmissionSnapshot {
    active_or_pending: usize,
    active_handshakes: usize,
    retained_config_bytes: usize,
}

#[derive(Debug)]
struct SshSessionAdmissionLease {
    _session_slot: OwnedSemaphorePermit,
    _config_bytes: OwnedSemaphorePermit,
    _retained_config_bytes: usize,
}

struct SshConnectionWorkerLease {
    _session: Arc<SshSessionAdmissionLease>,
    _handshake: OwnedSemaphorePermit,
    cleanup_key: PendingSshCleanupKey,
    _proxy_command_reservation: Option<super::proxy_command::ProxyCommandProducerReservation>,
}

static PROCESS_SSH_CONNECTION_ADMISSION: OnceLock<Arc<SshConnectionAdmission>> = OnceLock::new();

fn process_ssh_connection_admission() -> Arc<SshConnectionAdmission> {
    Arc::clone(
        PROCESS_SSH_CONNECTION_ADMISSION
            .get_or_init(|| SshConnectionAdmission::new(SshConnectionAdmissionLimits::default())),
    )
}

fn checked_add_retained_bytes(
    total: &mut usize,
    bytes: usize,
) -> Result<(), SshConnectionAdmissionError> {
    *total = total
        .checked_add(bytes)
        .ok_or(SshConnectionAdmissionError::ConfigAccounting)?;
    Ok(())
}

fn add_secret_bytes(
    total: &mut usize,
    secret: Option<&SecretString>,
) -> Result<(), SshConnectionAdmissionError> {
    if let Some(secret) = secret {
        checked_add_retained_bytes(total, secret.expose_secret().len())?;
    }
    Ok(())
}

fn add_secret_list_bytes(
    total: &mut usize,
    secrets: &[SecretString],
) -> Result<(), SshConnectionAdmissionError> {
    for secret in secrets {
        checked_add_retained_bytes(total, secret.expose_secret().len())?;
    }
    Ok(())
}

fn add_jump_secret_bytes(
    total: &mut usize,
    jump: &JumpHostConfig,
) -> Result<(), SshConnectionAdmissionError> {
    add_secret_bytes(total, jump.password.as_ref())?;
    add_secret_bytes(total, jump.private_key_passphrase.as_ref())?;
    add_secret_bytes(total, jump.totp_secret.as_ref())?;
    add_secret_list_bytes(total, &jump.keyboard_interactive_responses)
}

fn add_proxy_secret_bytes(
    total: &mut usize,
    proxy: &ProxyConfig,
) -> Result<(), SshConnectionAdmissionError> {
    add_secret_bytes(total, proxy.password.as_ref())
}

fn retained_ssh_config_bytes(
    config: &SshConnectionConfig,
) -> Result<usize, SshConnectionAdmissionError> {
    let mut total = serde_json::to_vec(config)
        .map_err(|_| SshConnectionAdmissionError::ConfigAccounting)?
        .len();
    add_secret_bytes(&mut total, config.password.as_ref())?;
    add_secret_bytes(&mut total, config.private_key_passphrase.as_ref())?;
    add_secret_bytes(&mut total, config.totp_secret.as_ref())?;
    add_secret_list_bytes(&mut total, &config.keyboard_interactive_responses)?;
    add_secret_bytes(&mut total, config.sk_pin.as_ref())?;
    for jump in &config.jump_hosts {
        add_jump_secret_bytes(&mut total, jump)?;
    }
    if let Some(proxy) = &config.proxy_config {
        add_proxy_secret_bytes(&mut total, proxy)?;
    }
    if let Some(chain) = &config.proxy_chain {
        for proxy in &chain.proxies {
            add_proxy_secret_bytes(&mut total, proxy)?;
        }
    }
    if let Some(chain) = &config.mixed_chain {
        for hop in &chain.hops {
            match hop {
                ChainHop::SshJump(jump) => add_jump_secret_bytes(&mut total, jump)?,
                ChainHop::Proxy(proxy) => add_proxy_secret_bytes(&mut total, proxy)?,
            }
        }
    }
    if let Some(proxy_command) = &config.proxy_command {
        add_secret_bytes(&mut total, proxy_command.proxy_password.as_ref())?;
    }
    Ok(total.max(1))
}

const MAX_DETACHED_SSH_CLEANUP_WORKERS: usize = 4;
static NEXT_SSH_CLEANUP_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct PendingSshCleanupKey {
    session_id: String,
    generation: u64,
}

impl PendingSshCleanupKey {
    fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            generation: NEXT_SSH_CLEANUP_GENERATION.fetch_add(1, Ordering::AcqRel),
        }
    }
}

static PENDING_SSH_ARTIFACT_CLEANUPS: OnceLock<StdMutex<HashSet<PendingSshCleanupKey>>> =
    OnceLock::new();

fn pending_ssh_artifact_cleanups_lock(
) -> std::sync::MutexGuard<'static, HashSet<PendingSshCleanupKey>> {
    PENDING_SSH_ARTIFACT_CLEANUPS
        .get_or_init(|| StdMutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(|poisoned| {
            log::error!("Pending SSH artifact-cleanup registry was poisoned; recovering");
            poisoned.into_inner()
        })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DetachedSshCleanupOutcome {
    Complete,
    Retry,
}

type DetachedSshCleanupTask = Box<dyn FnMut() -> DetachedSshCleanupOutcome + Send + 'static>;
type DetachedSshCleanupSlot = Arc<StdMutex<Option<DetachedSshCleanupTask>>>;

struct DetachedSshCleanupQueueState {
    tasks: VecDeque<DetachedSshCleanupSlot>,
    in_flight: usize,
    shutting_down: bool,
}

struct DetachedSshCleanupShared {
    state: StdMutex<DetachedSshCleanupQueueState>,
    changed: std::sync::Condvar,
}

struct DetachedSshCleanupExecutor {
    shared: Arc<DetachedSshCleanupShared>,
    _workers: Vec<std::thread::JoinHandle<()>>,
}

static DETACHED_SSH_CLEANUP_EXECUTOR: OnceLock<Result<DetachedSshCleanupExecutor, String>> =
    OnceLock::new();

fn run_detached_ssh_cleanup_slot(slot: &DetachedSshCleanupSlot) -> DetachedSshCleanupOutcome {
    let mut task = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let outcome = match task.as_mut() {
        Some(task) => task(),
        None => DetachedSshCleanupOutcome::Complete,
    };
    if outcome == DetachedSshCleanupOutcome::Complete {
        task.take();
    }
    outcome
}

fn attempt_detached_ssh_cleanup(slot: &DetachedSshCleanupSlot) -> DetachedSshCleanupOutcome {
    let attempt_slot = Arc::clone(slot);
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        run_detached_ssh_cleanup_slot(&attempt_slot)
    })) {
        Ok(outcome) => outcome,
        Err(_) => {
            log::error!("Detached SSH cleanup task panicked; retaining task for retry");
            DetachedSshCleanupOutcome::Retry
        }
    }
}

fn run_detached_ssh_cleanup_until_complete(slot: &DetachedSshCleanupSlot) {
    while attempt_detached_ssh_cleanup(slot) == DetachedSshCleanupOutcome::Retry {
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn detached_ssh_cleanup_worker(shared: Arc<DetachedSshCleanupShared>) {
    loop {
        let slot = {
            let mut state = shared
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            while state.tasks.is_empty() && !state.shutting_down {
                state = shared
                    .changed
                    .wait(state)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            if state.shutting_down {
                return;
            }
            let Some(slot) = state.tasks.pop_front() else {
                continue;
            };
            state.in_flight += 1;
            slot
        };
        let outcome = attempt_detached_ssh_cleanup(&slot);
        if outcome == DetachedSshCleanupOutcome::Retry {
            std::thread::sleep(Duration::from_millis(10));
        }
        let mut state = shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        debug_assert!(state.in_flight > 0);
        state.in_flight -= 1;
        let retry_synchronously =
            outcome == DetachedSshCleanupOutcome::Retry && state.shutting_down;
        if outcome == DetachedSshCleanupOutcome::Retry && !state.shutting_down {
            state.tasks.push_back(Arc::clone(&slot));
        }
        drop(state);
        shared.changed.notify_all();
        if retry_synchronously {
            run_detached_ssh_cleanup_until_complete(&slot);
        }
    }
}

fn build_detached_ssh_cleanup_executor(
    mut spawn_worker: impl FnMut(
        usize,
        Arc<DetachedSshCleanupShared>,
    ) -> std::io::Result<std::thread::JoinHandle<()>>,
) -> Result<DetachedSshCleanupExecutor, String> {
    let shared = Arc::new(DetachedSshCleanupShared {
        state: StdMutex::new(DetachedSshCleanupQueueState {
            tasks: VecDeque::new(),
            in_flight: 0,
            shutting_down: false,
        }),
        changed: std::sync::Condvar::new(),
    });
    let mut workers = Vec::with_capacity(MAX_DETACHED_SSH_CLEANUP_WORKERS);
    for index in 0..MAX_DETACHED_SSH_CLEANUP_WORKERS {
        match spawn_worker(index, Arc::clone(&shared)) {
            Ok(worker) => workers.push(worker),
            Err(error) => {
                shared
                    .state
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .shutting_down = true;
                shared.changed.notify_all();
                for worker in workers {
                    let _ = worker.join();
                }
                return Err(format!(
                    "Failed to initialize detached SSH cleanup worker {index}: {error}"
                ));
            }
        }
    }
    Ok(DetachedSshCleanupExecutor {
        shared,
        _workers: workers,
    })
}

fn initialize_detached_ssh_cleanup_executor() -> Result<DetachedSshCleanupExecutor, String> {
    build_detached_ssh_cleanup_executor(|index, shared| {
        std::thread::Builder::new()
            .name(format!("ssh-cleanup-reaper-{index}"))
            .spawn(move || detached_ssh_cleanup_worker(shared))
    })
}

fn detached_ssh_cleanup_executor() -> Result<&'static DetachedSshCleanupExecutor, String> {
    match DETACHED_SSH_CLEANUP_EXECUTOR.get_or_init(initialize_detached_ssh_cleanup_executor) {
        Ok(executor) => Ok(executor),
        Err(error) => Err(error.clone()),
    }
}

impl DetachedSshCleanupExecutor {
    fn enqueue(&self, slot: DetachedSshCleanupSlot) -> Result<(), String> {
        let mut state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.shutting_down {
            return Err("Detached SSH cleanup executor is shutting down".to_string());
        }
        while state.tasks.len().saturating_add(state.in_flight)
            >= MAX_ACTIVE_OR_PENDING_SSH_SESSIONS
            && !state.shutting_down
        {
            state = self
                .shared
                .changed
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        if state.shutting_down {
            return Err("Detached SSH cleanup executor is shutting down".to_string());
        }
        state.tasks.push_back(slot);
        drop(state);
        self.shared.changed.notify_all();
        Ok(())
    }
}

fn dispatch_detached_ssh_cleanup_with(
    task: impl FnMut() -> DetachedSshCleanupOutcome + Send + 'static,
    enqueue: impl FnOnce(DetachedSshCleanupSlot) -> Result<(), String>,
) {
    let slot: DetachedSshCleanupSlot = Arc::new(StdMutex::new(Some(Box::new(task))));
    let queued = enqueue(Arc::clone(&slot));
    if let Err(error) = queued {
        log::error!("{error}");
        // The original slot still owns the closure whenever initialization or
        // enqueue fails, so exceptional fallback cannot detach native handles.
        run_detached_ssh_cleanup_until_complete(&slot);
    }
}

fn dispatch_detached_ssh_cleanup(task: impl FnMut() -> DetachedSshCleanupOutcome + Send + 'static) {
    dispatch_detached_ssh_cleanup_with(task, |slot| detached_ssh_cleanup_executor()?.enqueue(slot));
}

fn dispatch_deduplicated_pending_ssh_cleanup(
    cleanup_key: &PendingSshCleanupKey,
    admission_lease: Option<Arc<SshSessionAdmissionLease>>,
    mut cleanup_native: impl FnMut() -> Result<(), String> + Send + 'static,
    enqueue: impl FnOnce(DetachedSshCleanupSlot) -> Result<(), String>,
) {
    if !pending_ssh_artifact_cleanups_lock().insert(cleanup_key.clone()) {
        // The first cleanup owns an equivalent Arc admission lease and retains
        // the key through every retry. A duplicate Attempt/SetupGuard request
        // can return without consuming another bounded executor slot.
        return;
    }
    let cleanup_key = cleanup_key.clone();
    let mut admission_lease = admission_lease;
    let cleanup = move || {
        if cleanup_native().is_ok() {
            drop(admission_lease.take());
            pending_ssh_artifact_cleanups_lock().remove(&cleanup_key);
            DetachedSshCleanupOutcome::Complete
        } else {
            DetachedSshCleanupOutcome::Retry
        }
    };
    dispatch_detached_ssh_cleanup_with(cleanup, enqueue);
}

fn cleanup_pending_connection_artifacts_with(
    cleanup_key: &PendingSshCleanupKey,
    admission_lease: Option<Arc<SshSessionAdmissionLease>>,
    enqueue: impl FnOnce(DetachedSshCleanupSlot) -> Result<(), String>,
) {
    if let Ok(mut pending_prompts) = PENDING_HOST_KEY_PROMPTS.lock() {
        pending_prompts.remove(&cleanup_key.session_id);
    }
    let session_id = cleanup_key.session_id.clone();
    dispatch_deduplicated_pending_ssh_cleanup(
        cleanup_key,
        admission_lease,
        move || super::proxy_command::stop_proxy_command_and_wait(&session_id),
        enqueue,
    );
}

fn cleanup_pending_connection_artifacts(
    cleanup_key: &PendingSshCleanupKey,
    admission_lease: Option<Arc<SshSessionAdmissionLease>>,
) {
    cleanup_pending_connection_artifacts_with(cleanup_key, admission_lease, |slot| {
        detached_ssh_cleanup_executor()?.enqueue(slot)
    });
}

struct SshConnectionAttempt {
    session_id: String,
    cancellation: std::sync::Arc<PendingSshConnection>,
    pending_connections: PendingSshConnections,
    session_lease: Arc<SshSessionAdmissionLease>,
    handshake_lease: Option<OwnedSemaphorePermit>,
    cleanup_key: PendingSshCleanupKey,
    proxy_command_reservation: Option<super::proxy_command::ProxyCommandProducerReservation>,
    registered: bool,
}

impl SshConnectionAttempt {
    fn unregister(&mut self) {
        if let Ok(mut pending) = self.pending_connections.lock() {
            let owns_entry = pending
                .get(&self.session_id)
                .is_some_and(|current| std::sync::Arc::ptr_eq(current, &self.cancellation));
            if owns_entry {
                pending.remove(&self.session_id);
            }
        }
        self.registered = false;
    }

    fn take_worker_lease(&mut self) -> SshConnectionWorkerLease {
        SshConnectionWorkerLease {
            _session: Arc::clone(&self.session_lease),
            _handshake: self
                .handshake_lease
                .take()
                .expect("SSH connection attempt owns one handshake permit"),
            cleanup_key: self.cleanup_key.clone(),
            _proxy_command_reservation: self.proxy_command_reservation.take(),
        }
    }

    fn finish(mut self) -> (bool, Arc<SshSessionAdmissionLease>) {
        let cancelled = self.cancellation.is_cancelled();
        let session_lease = Arc::clone(&self.session_lease);
        self.unregister();
        (cancelled, session_lease)
    }
}

impl Drop for SshConnectionAttempt {
    fn drop(&mut self) {
        if self.registered {
            self.cancellation.cancel();
            self.unregister();
            // Producer acknowledgement must precede any cleanup dispatch that
            // can backpressure on the bounded queue. Otherwise a queued stop
            // can wait for this guard while this same Drop waits for capacity.
            drop(self.proxy_command_reservation.take());
            cleanup_pending_connection_artifacts(
                &self.cleanup_key,
                Some(Arc::clone(&self.session_lease)),
            );
        }
    }
}

struct SshConnectionSetupGuard {
    cleanup_key: PendingSshCleanupKey,
    admission_lease: Option<Arc<SshSessionAdmissionLease>>,
    proxy_command_reservation: Option<super::proxy_command::ProxyCommandProducerReservation>,
    armed: bool,
}

impl SshConnectionSetupGuard {
    fn new(
        cleanup_key: PendingSshCleanupKey,
        admission_lease: Option<Arc<SshSessionAdmissionLease>>,
        proxy_command_reservation: Option<super::proxy_command::ProxyCommandProducerReservation>,
    ) -> Self {
        Self {
            cleanup_key,
            admission_lease,
            proxy_command_reservation,
            armed: true,
        }
    }

    fn proxy_command_reservation(
        &self,
    ) -> Option<&super::proxy_command::ProxyCommandProducerReservation> {
        self.proxy_command_reservation.as_ref()
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for SshConnectionSetupGuard {
    fn drop(&mut self) {
        // Release the exact producer generation before cleanup can wait for it
        // or backpressure on a queue filled with older cleanup requests.
        drop(self.proxy_command_reservation.take());
        if self.armed {
            cleanup_pending_connection_artifacts(&self.cleanup_key, self.admission_lease.take());
        }
    }
}

struct EstablishmentBridgeCleanup {
    intermediate_sessions: Vec<Session>,
    bridge_handles: Vec<std::thread::JoinHandle<()>>,
    admission_lease: Option<Arc<SshSessionAdmissionLease>>,
}

impl EstablishmentBridgeCleanup {
    fn new(admission_lease: Option<Arc<SshSessionAdmissionLease>>) -> Result<Self, String> {
        detached_ssh_cleanup_executor()?;
        Ok(Self {
            intermediate_sessions: Vec::new(),
            bridge_handles: Vec::new(),
            admission_lease,
        })
    }

    fn from_parts(
        intermediate_sessions: Vec<Session>,
        bridge_handles: Vec<std::thread::JoinHandle<()>>,
        admission_lease: Option<Arc<SshSessionAdmissionLease>>,
    ) -> Self {
        Self {
            intermediate_sessions,
            bridge_handles,
            admission_lease,
        }
    }

    fn take_parts(&mut self) -> (Vec<Session>, Vec<std::thread::JoinHandle<()>>) {
        (
            std::mem::take(&mut self.intermediate_sessions),
            std::mem::take(&mut self.bridge_handles),
        )
    }
}

impl Drop for EstablishmentBridgeCleanup {
    fn drop(&mut self) {
        if self.intermediate_sessions.is_empty() && self.bridge_handles.is_empty() {
            return;
        }
        let mut intermediate_sessions = Some(std::mem::take(&mut self.intermediate_sessions));
        let mut bridge_handles = std::mem::take(&mut self.bridge_handles);
        let mut admission_lease = self.admission_lease.take();
        dispatch_detached_ssh_cleanup(move || {
            drop(intermediate_sessions.take());
            while let Some(handle) = bridge_handles.pop() {
                let _ = handle.join();
            }
            drop(admission_lease.take());
            DetachedSshCleanupOutcome::Complete
        });
    }
}

struct EstablishedSshConnection {
    session_id: String,
    session: Option<SshSession>,
    cleanup_session_lease: Option<Arc<SshSessionAdmissionLease>>,
}

impl Drop for EstablishedSshConnection {
    fn drop(&mut self) {
        let Some(session) = self.session.take() else {
            return;
        };
        let session_id = self.session_id.clone();
        let cleanup = DetachedSessionCleanup {
            session,
            admission_lease: self.cleanup_session_lease.take(),
        };
        if let Ok(mut pending_prompts) = PENDING_HOST_KEY_PROMPTS.lock() {
            pending_prompts.remove(&session_id);
        }

        let mut proxy_cleaned = false;
        let mut cleanup = Some(cleanup);
        let reap = move || {
            // Keep the session lease inside `cleanup` until ProxyCommand and
            // every native bridge worker have actually exited.
            if !proxy_cleaned {
                if super::proxy_command::stop_proxy_command_and_wait(&session_id).is_err() {
                    return DetachedSshCleanupOutcome::Retry;
                }
                proxy_cleaned = true;
            }
            if let Some(cleanup) = cleanup.take() {
                let _ = cleanup.finish_bridges(Instant::now() + SHELL_STOP_TIMEOUT);
            }
            DetachedSshCleanupOutcome::Complete
        };
        dispatch_detached_ssh_cleanup(reap);
    }
}

struct DetachedShellCleanup {
    session_id: String,
    target: ShellCleanupTarget,
    sender: Option<ShellMailboxSender>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl DetachedShellCleanup {
    fn request_shutdown(&self) {
        self.target.cancellation.store(true, Ordering::Release);
        if let Some(sender) = &self.sender {
            sender.request_close();
        }
    }

    async fn finish(mut self, deadline: tokio::time::Instant) -> Result<(), String> {
        let outcome = self
            .target
            .completion
            .wait_until(deadline)
            .await
            .map_err(|_| {
                format!(
                    "Timed out waiting for SSH shell generation {} to stop for session {}; worker detached safely",
                    self.target.generation, self.session_id
                )
            })?;

        if let Some(thread) = self.thread.take() {
            while !thread.is_finished() {
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!(
                        "Timed out joining SSH shell generation {} for session {}; worker detached safely",
                        self.target.generation, self.session_id
                    ));
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            if thread.join().is_err() || outcome == ShellWorkerOutcome::Panicked {
                return Err(format!(
                    "SSH shell generation {} panicked for session {}",
                    self.target.generation, self.session_id
                ));
            }
        } else if outcome == ShellWorkerOutcome::Panicked {
            return Err(format!(
                "Detached SSH shell generation {} panicked for session {}",
                self.target.generation, self.session_id
            ));
        }
        Ok(())
    }
}

struct DetachedSessionCleanup {
    session: SshSession,
    admission_lease: Option<Arc<SshSessionAdmissionLease>>,
}

impl DetachedSessionCleanup {
    fn finish_bridges(self, deadline: Instant) -> Result<(), String> {
        let DetachedSessionCleanup {
            session,
            admission_lease,
        } = self;
        let SshSession {
            id: session_id,
            session,
            mut port_forwards,
            keep_alive_handle,
            mut intermediate_sessions,
            mut bridge_handles,
            ..
        } = session;

        if let Some(handle) = keep_alive_handle {
            handle.abort();
        }
        for (_, forward) in port_forwards.drain() {
            forward.handle.abort();
        }

        // These potentially expensive native drops intentionally happen after
        // the service mutex has been released.
        drop(session);
        while let Some(intermediate) = intermediate_sessions.pop() {
            drop(intermediate);
        }
        let mut errors = Vec::new();
        let mut deadline_exceeded = false;
        for (index, handle) in bridge_handles.drain(..).enumerate() {
            while !handle.is_finished() {
                if Instant::now() >= deadline {
                    deadline_exceeded = true;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            if handle.join().is_err() {
                errors.push(format!(
                    "SSH bridge {} panicked while disconnecting session {}",
                    index, session_id
                ));
            }
        }
        if deadline_exceeded {
            errors.push(format!(
                "Timed out waiting for SSH bridges to stop for session {}; cleanup completed after the deadline",
                session_id
            ));
        }
        // Explicitly retain admission until all bridge joins above complete.
        drop(admission_lease);
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }
}

struct SshDisconnectPlan {
    session_id: String,
    pending_connection: Option<Arc<PendingSshConnection>>,
    shell: Option<DetachedShellCleanup>,
    session: Option<DetachedSessionCleanup>,
}

fn dispatch_proxy_command_disconnect_cleanup(
    session_id: String,
    admission_lease: Option<Arc<SshSessionAdmissionLease>>,
) -> Option<tokio::task::JoinHandle<Result<(), String>>> {
    // `begin_connection_attempt` reserves every service-owned ProxyCommand
    // before its native worker can launch. A confirmed-absent registry entry
    // therefore cannot late-register for this attempt, and avoiding a needless
    // blocking-pool job keeps non-ProxyCommand disconnects responsive at scale.
    if !super::proxy_command::has_proxy_command_lifecycle(&session_id) {
        return None;
    }
    Some(tokio::task::spawn_blocking(move || {
        let _admission_lease = admission_lease;
        super::proxy_command::stop_proxy_command_and_wait(&session_id)
    }))
}

impl SshDisconnectPlan {
    async fn execute(self, timeout: Duration) -> Result<(), String> {
        let deadline = tokio::time::Instant::now() + timeout;
        let mut errors = Vec::new();
        let SshDisconnectPlan {
            session_id,
            pending_connection,
            shell,
            session,
        } = self;
        let shell_publication = shell
            .as_ref()
            .map(|cleanup| Arc::clone(&cleanup.target.publication));

        if let Some(pending) = pending_connection {
            pending.cancel();
        }
        if let Ok(mut pending_prompts) = PENDING_HOST_KEY_PROMPTS.lock() {
            pending_prompts.remove(&session_id);
        }
        if let Some(shell) = &shell {
            shell.request_shutdown();
        }
        if let Err(error) = super::x11::stop_x11_forwarding(&session_id) {
            errors.push(error);
        }

        let proxy_admission_lease = session
            .as_ref()
            .and_then(|cleanup| cleanup.admission_lease.clone());
        let proxy_cleanup =
            dispatch_proxy_command_disconnect_cleanup(session_id.clone(), proxy_admission_lease);
        let session_cleanup = async move {
            let Some(session) = session else {
                return Ok(());
            };
            let worker_deadline = Instant::now() + timeout;
            let cleanup =
                tokio::task::spawn_blocking(move || session.finish_bridges(worker_deadline));
            match tokio::time::timeout_at(deadline, cleanup).await {
                Ok(Ok(result)) => result,
                Ok(Err(error)) => Err(format!("SSH transport cleanup task failed: {error}")),
                Err(_) => Err(
                    "Timed out cleaning SSH transports; cleanup worker detached safely".to_string(),
                ),
            }
        };
        let shell_cleanup = async move {
            match shell {
                Some(shell) => shell.finish(deadline).await,
                None => Ok(()),
            }
        };
        let proxy_cleanup = async move {
            let Some(proxy_cleanup) = proxy_cleanup else {
                return Ok(());
            };
            match tokio::time::timeout_at(deadline, proxy_cleanup).await {
                Ok(Ok(result)) => result,
                Ok(Err(error)) => Err(format!("ProxyCommand cleanup task failed: {error}")),
                Err(_) => Err(
                    "Timed out cleaning ProxyCommand; cleanup worker detached safely".to_string(),
                ),
            }
        };

        let (proxy_result, session_result, shell_result) =
            tokio::join!(proxy_cleanup, session_cleanup, shell_cleanup);
        for result in [proxy_result, session_result, shell_result] {
            if let Err(error) = result {
                errors.push(error);
            }
        }

        let publication_drained = match shell_publication {
            Some(publication) => match publication.wait_until_drained(deadline).await {
                Ok(()) => true,
                Err(()) => {
                    errors.push(format!(
                        "Timed out waiting for SSH shell output publication for session {}; output state retained for cleanup retry",
                        session_id
                    ));
                    false
                }
            },
            None => true,
        };
        if publication_drained {
            if let Err(error) = cleanup_session_output_state(&session_id) {
                errors.push(error);
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }
}

pub struct SshService {
    pub sessions: HashMap<String, SshSession>,
    session_admission_leases: HashMap<String, Arc<SshSessionAdmissionLease>>,
    #[allow(dead_code)]
    connection_pool: HashMap<String, Vec<SshSession>>,
    #[allow(dead_code)]
    known_hosts: HashMap<String, String>,
    pub shells: HashMap<String, SshShellHandle>,
    pub event_emitter: Option<DynEventEmitter>,
    pending_connections: PendingSshConnections,
    connection_admission: Arc<SshConnectionAdmission>,
    establishment_control: Option<Arc<SshEstablishmentControl>>,
    establishment_session_lease: Option<Arc<SshSessionAdmissionLease>>,
    shell_admission: Arc<ShellAdmission>,
}

impl SshService {
    pub fn new() -> SshServiceState {
        std::sync::Arc::new(tokio::sync::Mutex::new(SshService {
            sessions: HashMap::new(),
            session_admission_leases: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: None,
            pending_connections: std::sync::Arc::new(StdMutex::new(HashMap::new())),
            connection_admission: process_ssh_connection_admission(),
            establishment_control: None,
            establishment_session_lease: None,
            shell_admission: process_shell_admission(),
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> SshServiceState {
        std::sync::Arc::new(tokio::sync::Mutex::new(SshService {
            sessions: HashMap::new(),
            session_admission_leases: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: Some(emitter),
            pending_connections: std::sync::Arc::new(StdMutex::new(HashMap::new())),
            connection_admission: process_ssh_connection_admission(),
            establishment_control: None,
            establishment_session_lease: None,
            shell_admission: process_shell_admission(),
        }))
    }

    #[cfg(test)]
    fn new_with_connection_limits(limits: SshConnectionAdmissionLimits) -> SshServiceState {
        std::sync::Arc::new(tokio::sync::Mutex::new(SshService {
            sessions: HashMap::new(),
            session_admission_leases: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: None,
            pending_connections: std::sync::Arc::new(StdMutex::new(HashMap::new())),
            connection_admission: SshConnectionAdmission::new(limits),
            establishment_control: None,
            establishment_session_lease: None,
            shell_admission: Arc::new(ShellAdmission::new(DEFAULT_MAX_ACTIVE_SSH_SHELLS)),
        }))
    }

    fn begin_connection_attempt(
        &self,
        config: &SshConnectionConfig,
    ) -> Result<(Self, SshConnectionAttempt), String> {
        // Establish cleanup capacity before leases, sessions, or native bridge
        // handles can exist for this attempt.
        detached_ssh_cleanup_executor()?;
        let session_lease = self
            .connection_admission
            .reserve_session(config)
            .map_err(|error| error.to_string())?;
        let handshake_lease = self
            .connection_admission
            .reserve_handshake()
            .map_err(|error| error.to_string())?;
        let mut pending = self
            .pending_connections
            .lock()
            .map_err(|_| "Failed to lock pending SSH connections".to_string())?;

        let session_id = loop {
            let candidate = Uuid::new_v4().to_string();
            if !self.sessions.contains_key(&candidate) && !pending.contains_key(&candidate) {
                break candidate;
            }
        };
        let cleanup_key = PendingSshCleanupKey::new(&session_id);
        let proxy_command_reservation = config
            .proxy_command
            .as_ref()
            .filter(|proxy| proxy.command.is_some() || proxy.template.is_some())
            .map(|_| super::proxy_command::reserve_proxy_command_session(&session_id))
            .transpose()?;
        let cancellation = std::sync::Arc::new(PendingSshConnection::new());
        let establishment_control =
            SshEstablishmentControl::new(config, Arc::clone(&cancellation))?;
        pending.insert(session_id.clone(), cancellation.clone());
        drop(pending);

        let connector = Self {
            sessions: HashMap::new(),
            session_admission_leases: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: self.known_hosts.clone(),
            shells: HashMap::new(),
            event_emitter: self.event_emitter.clone(),
            pending_connections: self.pending_connections.clone(),
            connection_admission: Arc::clone(&self.connection_admission),
            establishment_control: Some(establishment_control),
            establishment_session_lease: Some(Arc::clone(&session_lease)),
            shell_admission: Arc::clone(&self.shell_admission),
        };
        let attempt = SshConnectionAttempt {
            session_id,
            cancellation,
            pending_connections: self.pending_connections.clone(),
            session_lease,
            handshake_lease: Some(handshake_lease),
            cleanup_key,
            proxy_command_reservation,
            registered: true,
        };

        Ok((connector, attempt))
    }

    fn establishment_control(
        &self,
        config: &SshConnectionConfig,
    ) -> Result<Arc<SshEstablishmentControl>, String> {
        match &self.establishment_control {
            Some(control) => Ok(Arc::clone(control)),
            None => SshEstablishmentControl::new(config, Arc::new(PendingSshConnection::new())),
        }
    }

    fn local_phase_worker(&self) -> Self {
        Self {
            sessions: HashMap::new(),
            session_admission_leases: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: self.known_hosts.clone(),
            shells: HashMap::new(),
            event_emitter: self.event_emitter.clone(),
            pending_connections: Arc::clone(&self.pending_connections),
            connection_admission: Arc::clone(&self.connection_admission),
            establishment_control: self.establishment_control.clone(),
            establishment_session_lease: self.establishment_session_lease.clone(),
            shell_admission: Arc::clone(&self.shell_admission),
        }
    }

    async fn resolve_establishment_addresses(
        &self,
        host: String,
        port: u16,
        control: &Arc<SshEstablishmentControl>,
        phase: &str,
        timeout: Duration,
    ) -> Result<Vec<SocketAddr>, String> {
        if let Ok(address) = host.parse::<IpAddr>() {
            return Ok(vec![SocketAddr::new(address, port)]);
        }

        control
            .run_isolated_local_phase(
                phase,
                timeout,
                self.establishment_session_lease.clone(),
                move |context| {
                    context.ensure_active()?;
                    let addresses = (host.as_str(), port)
                        .to_socket_addrs()
                        .map_err(|_| "Failed to resolve SSH establishment endpoint".to_string())?
                        .collect::<Vec<_>>();
                    context.ensure_active()?;
                    if addresses.is_empty() {
                        Err("SSH establishment resolver returned no addresses".to_string())
                    } else {
                        Ok(addresses)
                    }
                },
            )
            .await
    }

    async fn connect_establishment_addresses(
        &self,
        addresses: Vec<SocketAddr>,
        control: &Arc<SshEstablishmentControl>,
        phase: &str,
        timeout: Duration,
    ) -> Result<AsyncTcpStream, String> {
        control
            .run_async_phase(phase, timeout, async move {
                let mut last_error = None;
                for address in addresses {
                    match AsyncTcpStream::connect(address).await {
                        Ok(stream) => return Ok(stream),
                        Err(error) => last_error = Some(error),
                    }
                }
                Err(match last_error {
                    Some(error) => {
                        format!("Failed to connect to SSH establishment endpoint: {error}")
                    }
                    None => "SSH establishment resolver returned no addresses".to_string(),
                })
            })
            .await
    }

    async fn authenticate_session_isolated(
        &self,
        mut session: Session,
        config: SshConnectionConfig,
        control: &Arc<SshEstablishmentControl>,
        phase: &str,
        timeout: Duration,
    ) -> Result<Session, String> {
        control
            .run_isolated_local_phase(
                phase,
                timeout,
                self.establishment_session_lease.clone(),
                move |context| {
                    Self::authenticate_session(&mut session, &config, context)?;
                    Ok(session)
                },
            )
            .await
    }

    async fn authenticate_jump_session_isolated(
        &self,
        mut session: Session,
        jump: JumpHostConfig,
        control: &Arc<SshEstablishmentControl>,
        phase: &str,
        timeout: Duration,
    ) -> Result<Session, String> {
        control
            .run_isolated_local_phase(
                phase,
                timeout,
                self.establishment_session_lease.clone(),
                move |context| {
                    Self::authenticate_jump_session(&mut session, &jump, context)?;
                    Ok(session)
                },
            )
            .await
    }

    async fn verify_host_key_isolated(
        &self,
        mut session: Session,
        session_id: String,
        config: SshConnectionConfig,
        control: &Arc<SshEstablishmentControl>,
    ) -> Result<Session, String> {
        let worker = self.local_phase_worker();
        let runtime = tokio::runtime::Handle::current();
        control
            .run_isolated_local_phase(
                "host-key-verification",
                control.overall_timeout,
                self.establishment_session_lease.clone(),
                move |context| {
                    runtime.block_on(context.run_async(worker.verify_host_key(
                        &session_id,
                        &mut session,
                        &config,
                    )))?;
                    Ok(session)
                },
            )
            .await
    }

    fn pending_connection(
        &self,
        session_id: &str,
    ) -> Result<Option<Arc<PendingSshConnection>>, String> {
        let pending = self
            .pending_connections
            .lock()
            .map_err(|_| "Failed to lock pending SSH connections".to_string())?
            .get(session_id)
            .cloned();
        Ok(pending)
    }

    fn adopt_connection(
        &mut self,
        mut connection: EstablishedSshConnection,
        admission_lease: Arc<SshSessionAdmissionLease>,
    ) -> Result<String, String> {
        if self.sessions.contains_key(&connection.session_id)
            || self
                .session_admission_leases
                .contains_key(&connection.session_id)
        {
            return Err(format!(
                "SSH session id collision while adopting {}",
                connection.session_id
            ));
        }

        let session_id = connection.session_id.clone();
        let session = connection
            .session
            .take()
            .ok_or_else(|| "Established SSH connection has no session".to_string())?;
        self.sessions.insert(session_id.clone(), session);
        self.session_admission_leases
            .insert(session_id.clone(), admission_lease);
        Ok(session_id)
    }

    fn pause_shell_io(
        &self,
        session_id: &str,
    ) -> Option<std::sync::Arc<std::sync::atomic::AtomicUsize>> {
        self.shells.get(session_id).map(|shell| {
            shell
                .suspend_count
                .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
            std::sync::Arc::clone(&shell.suspend_count)
        })
    }

    fn resume_shell_io(pause_handle: Option<std::sync::Arc<std::sync::atomic::AtomicUsize>>) {
        if let Some(counter) = pause_handle {
            let _ = counter.fetch_update(
                std::sync::atomic::Ordering::AcqRel,
                std::sync::atomic::Ordering::Acquire,
                |value| value.checked_sub(1),
            );
        }
    }

    fn prune_finished_shell(&mut self, session_id: &str) {
        let is_finished = self
            .shells
            .get(session_id)
            .is_some_and(SshShellHandle::is_finished);
        if !is_finished {
            return;
        }

        if let Some(shell) = self.shells.remove(session_id) {
            if shell.thread.join().is_err() {
                log::warn!("SSH shell thread panicked for session {}", session_id);
            }
        }
    }

    fn detach_shell_cleanup(
        &mut self,
        session_id: &str,
    ) -> Result<Option<DetachedShellCleanup>, String> {
        let shell = self.shells.remove(session_id);
        let target = self
            .shell_admission
            .tombstone(session_id, shell.as_ref().map(|handle| handle.generation))?;

        match (shell, target) {
            (Some(shell), Some(target)) => Ok(Some(DetachedShellCleanup {
                session_id: session_id.to_string(),
                target,
                sender: Some(shell.sender),
                thread: Some(shell.thread),
            })),
            (Some(shell), None) => {
                // The worker may have completed between handle removal and the
                // registry lookup. Its completion signal and finished handle
                // still provide an observable, bounded join.
                let target = ShellCleanupTarget::completed_without_registry(
                    shell.generation,
                    shell.sender.cancellation(),
                    Arc::clone(&shell.completion),
                );
                Ok(Some(DetachedShellCleanup {
                    session_id: session_id.to_string(),
                    target,
                    sender: Some(shell.sender),
                    thread: Some(shell.thread),
                }))
            }
            (None, Some(target)) => Ok(Some(DetachedShellCleanup {
                session_id: session_id.to_string(),
                target,
                sender: None,
                thread: None,
            })),
            (None, None) => Ok(None),
        }
    }

    fn detach_disconnect(&mut self, session_id: &str) -> Result<SshDisconnectPlan, String> {
        let pending_connection = self.pending_connection(session_id)?;
        let shell = self.detach_shell_cleanup(session_id)?;

        let admission_lease = self.session_admission_leases.remove(session_id);
        let session = self
            .sessions
            .remove(session_id)
            .map(|session| DetachedSessionCleanup {
                session,
                admission_lease,
            });

        Ok(SshDisconnectPlan {
            session_id: session_id.to_string(),
            pending_connection,
            shell,
            session,
        })
    }

    pub fn is_session_alive(&self, session_id: &str) -> bool {
        if !self.sessions.contains_key(session_id) {
            return false;
        }
        match self.shells.get(session_id) {
            Some(shell) => !shell.is_finished(),
            None => true,
        }
    }

    pub fn active_shell_id(&self, session_id: &str) -> Option<String> {
        self.shells
            .get(session_id)
            .filter(|shell| !shell.is_finished())
            .map(|shell| shell.id.clone())
    }

    async fn establish_ssh_connection(
        &mut self,
        session_id: String,
        config: SshConnectionConfig,
        cleanup_key: PendingSshCleanupKey,
        proxy_command_reservation: Option<super::proxy_command::ProxyCommandProducerReservation>,
    ) -> Result<EstablishedSshConnection, String> {
        let mut setup_guard = SshConnectionSetupGuard::new(
            cleanup_key,
            self.establishment_session_lease.clone(),
            proxy_command_reservation,
        );
        let control = self.establishment_control(&config)?;
        control.ensure_active("overall")?;

        // Connection method priority:
        // 0. ProxyCommand (spawns external command whose stdio IS the transport)
        // 1. Mixed chain  (SSH jumps + proxy hops interleaved)
        // 2. Proxy chain  (multiple proxies)
        // 3. Single proxy
        // 4. Jump hosts   (pure SSH multi-hop)
        // 5. Direct
        //
        // Note: OpenVPN/VPN is a pre-connection layer handled by the frontend.
        // When openvpn_config is present, the VPN is assumed to already be connected
        // at the OS level, and traffic is routed through it automatically.

        if let Some(ref openvpn_config) = config.openvpn_config {
            log::info!(
                "[{}] OpenVPN pre-layer active (connection_id={}); VPN assumed connected at OS level",
                session_id, openvpn_config.connection_id
            );
        }

        let (final_stream, intermediate_sessions, bridge_handles) =
            if let Some(ref proxy_cmd) = config.proxy_command {
                if proxy_cmd.command.is_some() || proxy_cmd.template.is_some() {
                    let s = control.run_blocking_phase(
                        "proxy-command-spawn",
                        control.overall_timeout,
                        |_phase| {
                            let reservation =
                                setup_guard.proxy_command_reservation().ok_or_else(|| {
                                    "SSH connection worker is missing its ProxyCommand reservation"
                                        .to_string()
                                })?;
                            super::proxy_command::spawn_reserved_proxy_command(
                                reservation,
                                &session_id,
                                proxy_cmd,
                                &config.host,
                                config.port,
                                &config.username,
                                control.overall_timeout.as_secs(),
                            )
                        },
                    )?;
                    control.track_blocking_socket(&s, "proxy-command-relay")?;
                    (s, Vec::new(), Vec::new())
                } else if let Some(ref mixed_chain) = config.mixed_chain {
                    self.establish_mixed_chain_connection(&config, mixed_chain)
                        .await?
                } else {
                    let s = self.establish_direct_connection(&config).await?;
                    (s, Vec::new(), Vec::new())
                }
            } else if let Some(ref mixed_chain) = config.mixed_chain {
                self.establish_mixed_chain_connection(&config, mixed_chain)
                    .await?
            } else if let Some(ref proxy_chain) = config.proxy_chain {
                let s = self
                    .establish_proxy_chain_connection(&config, proxy_chain)
                    .await?;
                (s, Vec::new(), Vec::new())
            } else if let Some(ref proxy_config) = config.proxy_config {
                let s = self
                    .establish_proxy_connection(&config, proxy_config)
                    .await?;
                (s, Vec::new(), Vec::new())
            } else if !config.jump_hosts.is_empty() {
                self.establish_jump_connection(&config).await?
            } else {
                let s = self.establish_direct_connection(&config).await?;
                (s, Vec::new(), Vec::new())
            };
        let mut bridge_cleanup = EstablishmentBridgeCleanup::from_parts(
            intermediate_sessions,
            bridge_handles,
            self.establishment_session_lease.clone(),
        );
        control.track_blocking_socket(&final_stream, "final-ssh-transport")?;

        // Configure both application-level SSH keepalives and operating-system
        // TCP keepalives. The latter was previously represented in the config
        // but never applied to the socket.
        configure_tcp_options(&final_stream, &config);

        let mut sess = Session::new().map_err(|e| format!("Failed to create session: {}", e))?;
        sess.set_tcp_stream(final_stream);

        if config.compression {
            sess.set_compress(true);
        }

        // ── Apply full compression configuration ───────────────────────
        self.apply_compression_config(&mut sess, &config)?;

        // ── Apply cipher / KEX / MAC / host-key preferences ────────────
        if !config.preferred_ciphers.is_empty() {
            let ciphers = config.preferred_ciphers.join(",");
            sess.method_pref(MethodType::CryptCs, &ciphers)
                .map_err(|e| format!("Failed to set client→server ciphers: {}", e))?;
            sess.method_pref(MethodType::CryptSc, &ciphers)
                .map_err(|e| format!("Failed to set server→client ciphers: {}", e))?;
        }
        if !config.preferred_macs.is_empty() {
            let macs = config.preferred_macs.join(",");
            sess.method_pref(MethodType::MacCs, &macs)
                .map_err(|e| format!("Failed to set client→server MACs: {}", e))?;
            sess.method_pref(MethodType::MacSc, &macs)
                .map_err(|e| format!("Failed to set server→client MACs: {}", e))?;
        }
        if !config.preferred_kex.is_empty() {
            let kex = config.preferred_kex.join(",");
            sess.method_pref(MethodType::Kex, &kex)
                .map_err(|e| format!("Failed to set KEX preferences: {}", e))?;
        }
        if !config.preferred_host_key_algorithms.is_empty() {
            let host_keys = config.preferred_host_key_algorithms.join(",");
            sess.method_pref(MethodType::HostKey, &host_keys)
                .map_err(|e| format!("Failed to set host-key algorithm preferences: {}", e))?;
        }

        control.run_blocking_phase("final-ssh-handshake", control.overall_timeout, |phase| {
            phase.configure_session_timeout(&sess)?;
            sess.handshake()
                .map_err(|e| format!("SSH handshake failed: {}", e))
        })?;

        if config.strict_host_key_checking {
            sess = self
                .verify_host_key_isolated(sess, session_id.clone(), config.clone(), &control)
                .await?;
        }

        sess = self
            .authenticate_session_isolated(
                sess,
                config.clone(),
                &control,
                "final-ssh-authentication",
                control.overall_timeout,
            )
            .await?;
        control.complete()?;
        sess.set_timeout(0);
        for intermediate_session in &bridge_cleanup.intermediate_sessions {
            intermediate_session.set_timeout(0);
        }

        let (intermediate_sessions, bridge_handles) = bridge_cleanup.take_parts();

        let mut session = SshSession {
            id: session_id.clone(),
            session: sess,
            config: config.clone(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            port_forwards: HashMap::new(),
            keep_alive_handle: None,
            intermediate_sessions,
            bridge_handles,
            compression_stats: SshCompressionStats::default(),
        };

        // Populate negotiated compression info from the handshake result
        Self::populate_compression_stats(&mut session);

        if let Some(interval) = config.keep_alive_interval.filter(|interval| *interval > 0) {
            // Configure the ssh2 library to send SSH keepalive packets
            let interval = interval.min(u32::MAX as u64);
            session.session.set_keepalive(true, interval as u32);
            session.keep_alive_handle =
                Some(self.start_keep_alive(session_id.clone(), interval, session.session.clone()));
        }

        setup_guard.disarm();
        Ok(EstablishedSshConnection {
            session_id,
            session: Some(session),
            cleanup_session_lease: self.establishment_session_lease.clone(),
        })
    }

    async fn establish_direct_connection(
        &self,
        config: &SshConnectionConfig,
    ) -> Result<TcpStream, String> {
        let owns_control = self.establishment_control.is_none();
        let control = self.establishment_control(config)?;
        let stream = self
            .establish_direct_connection_with_control(config, &control)
            .await?;
        if owns_control {
            control.complete()?;
        }
        Ok(stream)
    }

    async fn establish_direct_connection_with_control(
        &self,
        config: &SshConnectionConfig,
        control: &Arc<SshEstablishmentControl>,
    ) -> Result<TcpStream, String> {
        if let Some(proxy_config) = &config.proxy_config {
            return self
                .establish_proxy_connection_with_control(
                    config,
                    proxy_config,
                    control,
                    control.overall_timeout,
                )
                .await;
        }

        let addresses = self
            .resolve_establishment_addresses(
                config.host.clone(),
                config.port,
                control,
                "direct-dns-resolution",
                control.overall_timeout,
            )
            .await?;
        let async_stream = self
            .connect_establishment_addresses(
                addresses,
                control,
                "direct-tcp-connect",
                control.overall_timeout,
            )
            .await?;

        let std_stream = async_stream
            .into_std()
            .map_err(|e| format!("Failed to convert async stream: {}", e))?;

        std_stream
            .set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;
        control.track_blocking_socket(&std_stream, "direct-tcp-connect")?;

        Ok(std_stream)
    }

    async fn establish_proxy_connection(
        &self,
        config: &SshConnectionConfig,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        let owns_control = self.establishment_control.is_none();
        let control = self.establishment_control(config)?;
        let stream = self
            .establish_proxy_connection_with_control(
                config,
                proxy_config,
                &control,
                control.overall_timeout,
            )
            .await?;
        if owns_control {
            control.complete()?;
        }
        Ok(stream)
    }

    async fn establish_proxy_connection_with_control(
        &self,
        config: &SshConnectionConfig,
        proxy_config: &ProxyConfig,
        control: &Arc<SshEstablishmentControl>,
        phase_timeout: Duration,
    ) -> Result<TcpStream, String> {
        let proxy_addresses = self
            .resolve_establishment_addresses(
                proxy_config.host.clone(),
                proxy_config.port,
                control,
                "proxy-dns-resolution",
                phase_timeout,
            )
            .await?;
        let proxy_stream = self
            .connect_establishment_addresses(
                proxy_addresses,
                control,
                "proxy-tcp-connect",
                phase_timeout,
            )
            .await?;

        let target = format!("{}:{}", config.host, config.port);

        let stream = match &proxy_config.proxy_type {
            ProxyType::Socks5 => {
                control
                    .run_async_phase(
                        "socks5-proxy-negotiation",
                        phase_timeout,
                        self.connect_through_socks5(proxy_stream, &target, proxy_config),
                    )
                    .await
            }
            ProxyType::Socks4 => {
                control
                    .run_async_phase(
                        "socks4-proxy-negotiation",
                        phase_timeout,
                        self.connect_through_socks4(proxy_stream, &target, proxy_config),
                    )
                    .await
            }
            ProxyType::Http | ProxyType::Https => {
                control
                    .run_async_phase(
                        "http-proxy-negotiation",
                        phase_timeout,
                        self.connect_through_http_proxy(proxy_stream, &target, proxy_config),
                    )
                    .await
            }
        }?;
        control.track_blocking_socket(&stream, "proxy-negotiation")?;
        Ok(stream)
    }

    async fn connect_through_socks5(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let auth_required = proxy_config.username.is_some();
        let greeting = if auth_required {
            vec![0x05, 0x02, 0x00, 0x02]
        } else {
            vec![0x05, 0x01, 0x00]
        };

        stream
            .write_all(&greeting)
            .await
            .map_err(|e| format!("Failed to send SOCKS5 greeting: {}", e))?;

        let mut response = [0u8; 2];
        stream
            .read_exact(&mut response)
            .await
            .map_err(|e| format!("Failed to read SOCKS5 greeting response: {}", e))?;

        if response[0] != 0x05 {
            return Err("Invalid SOCKS5 response version".to_string());
        }

        if response[1] == 0x02 {
            let username = proxy_config.username.as_deref().unwrap_or("");
            let password = proxy_config
                .password
                .as_ref()
                .map(|secret| secret.expose_secret().as_str())
                .unwrap_or("");

            let mut auth_request = vec![0x01];
            auth_request.push(username.len() as u8);
            auth_request.extend_from_slice(username.as_bytes());
            auth_request.push(password.len() as u8);
            auth_request.extend_from_slice(password.as_bytes());

            stream
                .write_all(&auth_request)
                .await
                .map_err(|e| format!("Failed to send SOCKS5 auth: {}", e))?;

            let mut auth_response = [0u8; 2];
            stream
                .read_exact(&mut auth_response)
                .await
                .map_err(|e| format!("Failed to read SOCKS5 auth response: {}", e))?;

            if auth_response[1] != 0x00 {
                return Err("SOCKS5 authentication failed".to_string());
            }
        } else if response[1] != 0x00 {
            return Err(format!(
                "SOCKS5 server requires unsupported auth method: {}",
                response[1]
            ));
        }

        let parts: Vec<&str> = target.split(':').collect();
        if parts.len() != 2 {
            return Err("Invalid target address format".to_string());
        }
        let host = parts[0];
        let port: u16 = parts[1]
            .parse()
            .map_err(|_| "Invalid port number".to_string())?;

        let mut request = vec![0x05, 0x01, 0x00];

        if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
            request.push(0x01);
            request.extend_from_slice(&ip.octets());
        } else if let Ok(ip) = host.parse::<std::net::Ipv6Addr>() {
            request.push(0x04);
            request.extend_from_slice(&ip.octets());
        } else {
            request.push(0x03);
            request.push(host.len() as u8);
            request.extend_from_slice(host.as_bytes());
        }

        request.extend_from_slice(&port.to_be_bytes());

        stream
            .write_all(&request)
            .await
            .map_err(|e| format!("Failed to send SOCKS5 connect request: {}", e))?;

        let mut connect_response = [0u8; 10];
        stream
            .read_exact(&mut connect_response)
            .await
            .map_err(|e| format!("Failed to read SOCKS5 connect response: {}", e))?;

        if connect_response[1] != 0x00 {
            let error_msg = match connect_response[1] {
                0x01 => "General SOCKS server failure",
                0x02 => "Connection not allowed by ruleset",
                0x03 => "Network unreachable",
                0x04 => "Host unreachable",
                0x05 => "Connection refused",
                0x06 => "TTL expired",
                0x07 => "Command not supported",
                0x08 => "Address type not supported",
                _ => "Unknown SOCKS5 error",
            };
            return Err(format!("SOCKS5 connect failed: {}", error_msg));
        }

        let std_stream = stream
            .into_std()
            .map_err(|e| format!("Failed to convert stream: {}", e))?;
        std_stream
            .set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

        Ok(std_stream)
    }

    async fn connect_through_socks4(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let parts: Vec<&str> = target.split(':').collect();
        if parts.len() != 2 {
            return Err("Invalid target address format".to_string());
        }
        let host = parts[0];
        let port: u16 = parts[1]
            .parse()
            .map_err(|_| "Invalid port number".to_string())?;

        let ip: std::net::Ipv4Addr = host
            .parse()
            .map_err(|_| "SOCKS4 only supports IPv4 addresses, not domain names".to_string())?;

        let mut request = vec![0x04, 0x01];
        request.extend_from_slice(&port.to_be_bytes());
        request.extend_from_slice(&ip.octets());

        if let Some(username) = &proxy_config.username {
            request.extend_from_slice(username.as_bytes());
        }
        request.push(0x00);

        stream
            .write_all(&request)
            .await
            .map_err(|e| format!("Failed to send SOCKS4 request: {}", e))?;

        let mut response = [0u8; 8];
        stream
            .read_exact(&mut response)
            .await
            .map_err(|e| format!("Failed to read SOCKS4 response: {}", e))?;

        if response[1] != 0x5A {
            let error_msg = match response[1] {
                0x5B => "Request rejected or failed",
                0x5C => "Request failed (no identd)",
                0x5D => "Request failed (identd mismatch)",
                _ => "Unknown SOCKS4 error",
            };
            return Err(format!("SOCKS4 connect failed: {}", error_msg));
        }

        let std_stream = stream
            .into_std()
            .map_err(|e| format!("Failed to convert stream: {}", e))?;
        std_stream
            .set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

        Ok(std_stream)
    }

    async fn connect_through_http_proxy(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        use tokio::io::BufReader;

        let mut request = format!("CONNECT {} HTTP/1.1\r\nHost: {}\r\n", target, target);

        if let (Some(username), Some(password)) = (&proxy_config.username, &proxy_config.password) {
            let credentials = format!("{}:{}", username, password.expose_secret());
            let encoded = data_encoding::BASE64.encode(credentials.as_bytes());
            request.push_str(&format!("Proxy-Authorization: Basic {}\r\n", encoded));
        }

        request.push_str("\r\n");

        stream
            .write_all(request.as_bytes())
            .await
            .map_err(|e| format!("Failed to send HTTP CONNECT: {}", e))?;

        let mut reader = BufReader::new(&mut stream);
        let mut consumed_header_bytes = 0_usize;
        let response_line =
            read_bounded_http_proxy_line(&mut reader, &mut consumed_header_bytes).await?;
        let response_line = std::str::from_utf8(&response_line)
            .map_err(|_| "Invalid HTTP proxy response".to_string())?;
        let mut parts = response_line.split_whitespace();
        let _version = parts
            .next()
            .ok_or_else(|| "Invalid HTTP proxy response".to_string())?;
        let status_code: u16 = parts
            .next()
            .ok_or_else(|| "Invalid HTTP proxy response".to_string())?
            .parse()
            .map_err(|_| "Invalid HTTP status code".to_string())?;

        if status_code != 200 {
            return Err(format!("HTTP proxy returned status {}", status_code));
        }

        loop {
            let header_line =
                read_bounded_http_proxy_line(&mut reader, &mut consumed_header_bytes).await?;
            if header_line == b"\r\n" || header_line == b"\n" {
                break;
            }
        }

        drop(reader);
        let std_stream = stream
            .into_std()
            .map_err(|e| format!("Failed to convert stream: {}", e))?;
        std_stream
            .set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

        Ok(std_stream)
    }

    /// Establish connection through a proxy chain
    async fn establish_proxy_chain_connection(
        &self,
        config: &SshConnectionConfig,
        chain_config: &ProxyChainConfig,
    ) -> Result<TcpStream, String> {
        if chain_config.proxies.is_empty() {
            return Err("Proxy chain is empty".to_string());
        }

        let owns_control = self.establishment_control.is_none();
        let control = self.establishment_control(config)?;
        let hop_timeout = clamped_ssh_hop_timeout(chain_config.hop_timeout_ms);

        let stream = match chain_config.mode {
            ProxyChainMode::Strict => {
                self.establish_strict_proxy_chain(config, chain_config, &control, hop_timeout)
                    .await
            }
            ProxyChainMode::Dynamic => {
                self.establish_dynamic_proxy_chain(config, chain_config, &control, hop_timeout)
                    .await
            }
            ProxyChainMode::Random => {
                self.establish_random_proxy(config, chain_config, &control, hop_timeout)
                    .await
            }
        }?;
        if owns_control {
            control.complete()?;
        }
        Ok(stream)
    }

    async fn establish_strict_proxy_chain(
        &self,
        config: &SshConnectionConfig,
        chain_config: &ProxyChainConfig,
        control: &Arc<SshEstablishmentControl>,
        hop_timeout: Duration,
    ) -> Result<TcpStream, String> {
        if chain_config.proxies.len() == 1 {
            return self
                .establish_proxy_connection_with_control(
                    config,
                    &chain_config.proxies[0],
                    control,
                    hop_timeout,
                )
                .await;
        }

        let first_proxy = &chain_config.proxies[0];

        let proxy_addresses = self
            .resolve_establishment_addresses(
                first_proxy.host.clone(),
                first_proxy.port,
                control,
                "proxy-chain-hop-1-dns-resolution",
                hop_timeout,
            )
            .await?;
        let mut current_stream = self
            .connect_establishment_addresses(
                proxy_addresses,
                control,
                "proxy-chain-hop-1-tcp",
                hop_timeout,
            )
            .await?;

        for (i, proxy) in chain_config.proxies.iter().skip(1).enumerate() {
            let target = if i == chain_config.proxies.len() - 2 {
                format!("{}:{}", config.host, config.port)
            } else {
                format!("{}:{}", proxy.host, proxy.port)
            };

            let phase = format!("proxy-chain-hop-{}-negotiation", i + 1);
            current_stream = control
                .run_async_phase(
                    &phase,
                    hop_timeout,
                    self.socks5_connect_internal(current_stream, &target, first_proxy),
                )
                .await
                .map_err(|error| {
                    contextualize_ssh_connection_error(
                        &format!("Chain hop {} failed", i + 1),
                        error,
                    )
                })?
                .0;
        }

        let final_target = format!("{}:{}", config.host, config.port);
        let last_proxy = chain_config
            .proxies
            .last()
            .expect("chain_config.proxies checked non-empty");

        let std_stream = control
            .run_async_phase(
                "proxy-chain-final-negotiation",
                hop_timeout,
                self.connect_through_socks5(current_stream, &final_target, last_proxy),
            )
            .await?;
        control.track_blocking_socket(&std_stream, "proxy-chain-final-negotiation")?;
        Ok(std_stream)
    }

    async fn socks5_connect_internal(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<(AsyncTcpStream, ()), String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let auth_required = proxy_config.username.is_some();
        let greeting = if auth_required {
            vec![0x05, 0x02, 0x00, 0x02]
        } else {
            vec![0x05, 0x01, 0x00]
        };

        stream
            .write_all(&greeting)
            .await
            .map_err(|e| format!("SOCKS5 greeting failed: {}", e))?;

        let mut response = [0u8; 2];
        stream
            .read_exact(&mut response)
            .await
            .map_err(|e| format!("SOCKS5 response failed: {}", e))?;

        if response[0] != 0x05 {
            return Err("Invalid SOCKS5 version".to_string());
        }

        if response[1] == 0x02 {
            let username = proxy_config.username.as_deref().unwrap_or("");
            let password = proxy_config
                .password
                .as_ref()
                .map(|secret| secret.expose_secret().as_str())
                .unwrap_or("");

            let mut auth = vec![0x01];
            auth.push(username.len() as u8);
            auth.extend_from_slice(username.as_bytes());
            auth.push(password.len() as u8);
            auth.extend_from_slice(password.as_bytes());

            stream
                .write_all(&auth)
                .await
                .map_err(|e| format!("Auth failed: {}", e))?;

            let mut auth_resp = [0u8; 2];
            stream
                .read_exact(&mut auth_resp)
                .await
                .map_err(|e| format!("Auth response failed: {}", e))?;

            if auth_resp[1] != 0x00 {
                return Err("SOCKS5 auth rejected".to_string());
            }
        } else if response[1] != 0x00 {
            return Err("Unsupported auth method".to_string());
        }

        let parts: Vec<&str> = target.split(':').collect();
        let host = parts[0];
        let port: u16 = parts[1].parse().unwrap_or(22);

        let mut request = vec![0x05, 0x01, 0x00, 0x03];
        request.push(host.len() as u8);
        request.extend_from_slice(host.as_bytes());
        request.extend_from_slice(&port.to_be_bytes());

        stream
            .write_all(&request)
            .await
            .map_err(|e| format!("Connect request failed: {}", e))?;

        let mut resp = [0u8; 10];
        stream
            .read_exact(&mut resp)
            .await
            .map_err(|e| format!("Connect response failed: {}", e))?;

        if resp[1] != 0x00 {
            return Err(format!("SOCKS5 connect failed with code {}", resp[1]));
        }

        Ok((stream, ()))
    }

    async fn establish_dynamic_proxy_chain(
        &self,
        config: &SshConnectionConfig,
        chain_config: &ProxyChainConfig,
        control: &Arc<SshEstablishmentControl>,
        hop_timeout: Duration,
    ) -> Result<TcpStream, String> {
        let mut last_error = String::from("No proxies available");

        for proxy in &chain_config.proxies {
            match self
                .establish_proxy_connection_with_control(config, proxy, control, hop_timeout)
                .await
            {
                Ok(stream) => return Ok(stream),
                Err(e) => {
                    log::warn!(
                        "Proxy {}:{} failed: {}, trying next",
                        proxy.host,
                        proxy.port,
                        e
                    );
                    last_error = e;
                }
            }
        }

        Err(format!(
            "All proxies in chain failed. Last error: {}",
            last_error
        ))
    }

    async fn establish_random_proxy(
        &self,
        config: &SshConnectionConfig,
        chain_config: &ProxyChainConfig,
        control: &Arc<SshEstablishmentControl>,
        hop_timeout: Duration,
    ) -> Result<TcpStream, String> {
        use rand::Rng;

        let index = {
            let mut rng = rand::rngs::OsRng;
            rng.gen_range(0..chain_config.proxies.len())
        };

        let proxy = &chain_config.proxies[index];
        self.establish_proxy_connection_with_control(config, proxy, control, hop_timeout)
            .await
    }

    #[allow(dead_code)] // Retained for future opt-in tunnel-mode wiring (see e10 notes).
    async fn establish_openvpn_connection(
        &self,
        config: &SshConnectionConfig,
        openvpn_config: &OpenVPNConfig,
    ) -> Result<TcpStream, String> {
        // OpenVPN creates a system-level TUN interface. Once the VPN is connected,
        // the OS routing table directs traffic through the VPN tunnel automatically.
        // The frontend is responsible for ensuring the VPN connection is active
        // before calling connect_ssh with openvpn_config set.
        log::info!(
            "OpenVPN config present (connection_id={}); proceeding with direct TCP connect via OS routing",
            openvpn_config.connection_id
        );
        self.establish_direct_connection(config).await
    }

    // ── Bridge helper ────────────────────────────────────────────────
    //
    // Converts an ssh2::Channel into a regular TcpStream by spawning a
    // relay thread with a local TCP socket pair.  The Session that owns
    // the channel **must** be set to non-blocking (`set_blocking(false)`)
    // *before* this function is called.
    //
    fn bridge_channel_to_stream(
        mut channel: ssh2::Channel,
    ) -> Result<(TcpStream, std::thread::JoinHandle<()>), String> {
        let listener =
            TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Bridge bind failed: {}", e))?;
        let local_addr = listener
            .local_addr()
            .map_err(|e| format!("Bridge addr failed: {}", e))?;
        // Establish the client side before a native worker owns the listener,
        // so every post-spawn path can transfer or join the worker handle.
        let stream =
            TcpStream::connect(local_addr).map_err(|e| format!("Bridge connect failed: {}", e))?;

        let handle = std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            drop(listener);

            stream.set_read_timeout(Some(Duration::from_millis(2))).ok();
            stream.set_write_timeout(Some(Duration::from_secs(10))).ok();

            let mut buf = [0u8; 32768];
            loop {
                // channel → local stream
                match channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if stream.write_all(&buf[..n]).is_err() {
                            break;
                        }
                        stream.flush().ok();
                    }
                    Err(ref e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(_) => break,
                }

                // local stream → channel
                match stream.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if channel.write_all(&buf[..n]).is_err() {
                            break;
                        }
                        channel.flush().ok();
                    }
                    Err(ref e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(ref e) if e.kind() == ErrorKind::TimedOut => {}
                    Err(_) => break,
                }

                if channel.eof() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        });

        Ok((stream, handle))
    }

    // ── Proper multi-hop SSH jump chaining ────────────────────────────
    //
    // For N jump hosts J0..J(N-1) reaching final target T:
    //   1. TCP-connect to J0
    //   2. SSH session + auth on J0
    //   3. For each subsequent jump Ji (i=1..N-1):
    //        channel_direct_tcpip(Ji) → bridge → TcpStream
    //        SSH session + auth on Ji
    //   4. channel_direct_tcpip(T) → bridge → TcpStream
    //   5. Return that stream (plus all intermediate sessions/handles)
    //
    async fn establish_jump_connection(
        &self,
        config: &SshConnectionConfig,
    ) -> Result<(TcpStream, Vec<Session>, Vec<std::thread::JoinHandle<()>>), String> {
        if config.jump_hosts.is_empty() {
            return Err("No jump hosts configured".to_string());
        }
        let control = self.establishment_control(config)?;

        let mut bridge_cleanup =
            EstablishmentBridgeCleanup::new(self.establishment_session_lease.clone())?;

        // 1. TCP-connect to the first jump host
        let first = &config.jump_hosts[0];
        let addresses = self
            .resolve_establishment_addresses(
                first.host.clone(),
                first.port,
                &control,
                "jump-hop-1-dns-resolution",
                control.overall_timeout,
            )
            .await?;
        let async_stream = self
            .connect_establishment_addresses(
                addresses,
                &control,
                "jump-hop-1-tcp",
                control.overall_timeout,
            )
            .await?;

        let current_stream = async_stream
            .into_std()
            .map_err(|e| format!("Stream conversion failed: {}", e))?;
        current_stream
            .set_nonblocking(false)
            .map_err(|e| format!("set_nonblocking failed: {}", e))?;
        control.track_blocking_socket(&current_stream, "jump-hop-1-tcp")?;

        // 2. SSH session on first jump host
        let mut sess =
            Session::new().map_err(|e| format!("Failed to create jump session: {}", e))?;
        Self::apply_jump_cipher_prefs(&mut sess, first);
        sess.set_tcp_stream(current_stream);
        control.run_blocking_phase("jump-hop-1-handshake", control.overall_timeout, |phase| {
            phase.configure_session_timeout(&sess)?;
            sess.handshake()
                .map_err(|e| format!("Jump host {} handshake failed: {}", first.host, e))
        })?;
        sess = self
            .authenticate_jump_session_isolated(
                sess,
                first.clone(),
                &control,
                "jump-hop-1-authentication",
                control.overall_timeout,
            )
            .await?;

        // 3. Chain through remaining jump hosts
        for (i, jump) in config.jump_hosts.iter().skip(1).enumerate() {
            log::info!(
                "Chaining through jump host {}: {}:{}",
                i + 1,
                jump.host,
                jump.port
            );

            let channel_phase = format!("jump-hop-{}-channel-open", i + 1);
            let channel =
                control.run_blocking_phase(&channel_phase, control.overall_timeout, |phase| {
                    phase.configure_session_timeout(&sess)?;
                    sess.channel_direct_tcpip(&jump.host, jump.port, None)
                        .map_err(|e| {
                            format!(
                                "channel_direct_tcpip to {}:{} failed: {}",
                                jump.host, jump.port, e
                            )
                        })
                })?;

            // Switch session to non-blocking so the bridge thread can poll
            sess.set_blocking(false);
            let (bridged, handle) = Self::bridge_channel_to_stream(channel)?;
            bridge_cleanup.bridge_handles.push(handle);
            control.track_blocking_socket(&bridged, &channel_phase)?;
            bridge_cleanup.intermediate_sessions.push(sess);

            sess = Session::new().map_err(|e| format!("Failed to create jump session: {}", e))?;
            Self::apply_jump_cipher_prefs(&mut sess, jump);
            sess.set_tcp_stream(bridged);
            let hop_number = i + 2;
            control.run_blocking_phase(
                &format!("jump-hop-{hop_number}-handshake"),
                control.overall_timeout,
                |phase| {
                    phase.configure_session_timeout(&sess)?;
                    sess.handshake()
                        .map_err(|e| format!("Jump host {} handshake failed: {}", jump.host, e))
                },
            )?;
            sess = self
                .authenticate_jump_session_isolated(
                    sess,
                    jump.clone(),
                    &control,
                    &format!("jump-hop-{hop_number}-authentication"),
                    control.overall_timeout,
                )
                .await?;
        }

        // 4. Final tunnel to the actual target
        log::info!(
            "Final tunnel through last jump host to {}:{}",
            config.host,
            config.port
        );
        let channel = control.run_blocking_phase(
            "jump-final-channel-open",
            control.overall_timeout,
            |phase| {
                phase.configure_session_timeout(&sess)?;
                sess.channel_direct_tcpip(&config.host, config.port, None)
                    .map_err(|e| {
                        format!(
                            "channel_direct_tcpip to {}:{} failed: {}",
                            config.host, config.port, e
                        )
                    })
            },
        )?;

        sess.set_blocking(false);
        let (final_stream, handle) = Self::bridge_channel_to_stream(channel)?;
        bridge_cleanup.bridge_handles.push(handle);
        control.track_blocking_socket(&final_stream, "jump-final-channel-open")?;
        bridge_cleanup.intermediate_sessions.push(sess);

        let (intermediate_sessions, bridge_handles) = bridge_cleanup.take_parts();
        Ok((final_stream, intermediate_sessions, bridge_handles))
    }

    // ── Mixed chain (SSH jumps + proxy hops interleaved) ──────────────
    //
    // Processes hops left-to-right.  For each hop[i] the current stream
    // already reaches that hop; the hop then connects onward to the
    // *next* hop (or the final SSH target if it is the last).
    //
    async fn establish_mixed_chain_connection(
        &self,
        config: &SshConnectionConfig,
        chain: &MixedChainConfig,
    ) -> Result<(TcpStream, Vec<Session>, Vec<std::thread::JoinHandle<()>>), String> {
        if chain.hops.is_empty() {
            return Err("Mixed chain has no hops".to_string());
        }
        let control = self.establishment_control(config)?;
        let hop_timeout = clamped_ssh_hop_timeout(chain.hop_timeout_ms);

        let mut bridge_cleanup =
            EstablishmentBridgeCleanup::new(self.establishment_session_lease.clone())?;

        // Build the target list: for hop[i] the target is hop[i+1].address(),
        // except for the last hop whose target is the final SSH destination.
        let targets: Vec<(String, u16)> = (0..chain.hops.len())
            .map(|i| {
                if i + 1 < chain.hops.len() {
                    chain.hops[i + 1].address()
                } else {
                    (config.host.clone(), config.port)
                }
            })
            .collect();

        // TCP-connect to the first hop
        let first_addr = chain.hops[0].address();
        let addresses = self
            .resolve_establishment_addresses(
                first_addr.0,
                first_addr.1,
                &control,
                "mixed-chain-hop-1-dns-resolution",
                hop_timeout,
            )
            .await?;
        let first_stream = self
            .connect_establishment_addresses(
                addresses,
                &control,
                "mixed-chain-hop-1-tcp",
                hop_timeout,
            )
            .await?;

        // We track the stream in an enum so we can switch between async / sync
        // as needed by different hop types.
        enum MixedStream {
            Async(AsyncTcpStream),
            Sync(TcpStream),
        }

        impl MixedStream {
            fn into_async(self) -> Result<AsyncTcpStream, String> {
                match self {
                    MixedStream::Async(s) => Ok(s),
                    MixedStream::Sync(s) => {
                        s.set_nonblocking(true)
                            .map_err(|e| format!("set_nonblocking: {}", e))?;
                        AsyncTcpStream::from_std(s).map_err(|e| format!("from_std: {}", e))
                    }
                }
            }

            fn into_sync(self) -> Result<TcpStream, String> {
                match self {
                    MixedStream::Sync(s) => Ok(s),
                    MixedStream::Async(s) => {
                        let s = s.into_std().map_err(|e| format!("into_std: {}", e))?;
                        s.set_nonblocking(false)
                            .map_err(|e| format!("set_nonblocking: {}", e))?;
                        Ok(s)
                    }
                }
            }
        }

        let mut current = MixedStream::Async(first_stream);

        for (i, hop) in chain.hops.iter().enumerate() {
            let (target_host, target_port) = &targets[i];
            let target_str = format!("{}:{}", target_host, target_port);

            log::info!(
                "Mixed chain hop {}/{}: {} → {}",
                i + 1,
                chain.hops.len(),
                hop.label(),
                target_str,
            );

            match hop {
                ChainHop::Proxy(proxy) => {
                    let async_stream = current.into_async()?;
                    let phase = format!("mixed-chain-hop-{}-proxy-negotiation", i + 1);
                    match proxy.proxy_type {
                        ProxyType::Socks5 => {
                            let (s, _) = control
                                .run_async_phase(
                                    &phase,
                                    hop_timeout,
                                    self.socks5_connect_internal(async_stream, &target_str, proxy),
                                )
                                .await?;
                            current = MixedStream::Async(s);
                        }
                        ProxyType::Http | ProxyType::Https => {
                            let std_s = control
                                .run_async_phase(
                                    &phase,
                                    hop_timeout,
                                    self.connect_through_http_proxy(
                                        async_stream,
                                        &target_str,
                                        proxy,
                                    ),
                                )
                                .await?;
                            current = MixedStream::Sync(std_s);
                        }
                        ProxyType::Socks4 => {
                            let std_s = control
                                .run_async_phase(
                                    &phase,
                                    hop_timeout,
                                    self.connect_through_socks4(async_stream, &target_str, proxy),
                                )
                                .await?;
                            current = MixedStream::Sync(std_s);
                        }
                    }
                }
                ChainHop::SshJump(jump) => {
                    let std_stream = current.into_sync()?;
                    let handshake_phase = format!("mixed-chain-hop-{}-ssh-handshake", i + 1);
                    control.track_blocking_socket(&std_stream, &handshake_phase)?;

                    let mut sess =
                        Session::new().map_err(|e| format!("Session::new failed: {}", e))?;
                    Self::apply_jump_cipher_prefs(&mut sess, jump);
                    sess.set_tcp_stream(std_stream);
                    control.run_blocking_phase(&handshake_phase, hop_timeout, |phase| {
                        phase.configure_session_timeout(&sess)?;
                        sess.handshake()
                            .map_err(|e| format!("SSH jump {} handshake failed: {}", jump.host, e))
                    })?;
                    sess = self
                        .authenticate_jump_session_isolated(
                            sess,
                            jump.clone(),
                            &control,
                            &format!("mixed-chain-hop-{}-ssh-authentication", i + 1),
                            hop_timeout,
                        )
                        .await?;

                    let channel_phase = format!("mixed-chain-hop-{}-channel-open", i + 1);
                    let channel =
                        control.run_blocking_phase(&channel_phase, hop_timeout, |phase| {
                            phase.configure_session_timeout(&sess)?;
                            sess.channel_direct_tcpip(target_host, *target_port, None)
                                .map_err(|e| {
                                    format!("channel_direct_tcpip to {} failed: {}", target_str, e)
                                })
                        })?;

                    sess.set_blocking(false);
                    let (bridged, handle) = Self::bridge_channel_to_stream(channel)?;
                    bridge_cleanup.bridge_handles.push(handle);
                    control.track_blocking_socket(&bridged, &channel_phase)?;
                    bridge_cleanup.intermediate_sessions.push(sess);

                    current = MixedStream::Sync(bridged);
                }
            }
        }

        let final_stream = current.into_sync()?;
        control.track_blocking_socket(&final_stream, "mixed-chain-final-transport")?;
        let (intermediate_sessions, bridge_handles) = bridge_cleanup.take_parts();
        Ok((final_stream, intermediate_sessions, bridge_handles))
    }

    /// Apply per-hop cipher / KEX / MAC / host-key preferences.
    fn apply_jump_cipher_prefs(sess: &mut Session, jump: &JumpHostConfig) {
        if !jump.preferred_ciphers.is_empty() {
            let list = jump.preferred_ciphers.join(",");
            let _ = sess.method_pref(MethodType::CryptCs, &list);
            let _ = sess.method_pref(MethodType::CryptSc, &list);
        }
        if !jump.preferred_macs.is_empty() {
            let list = jump.preferred_macs.join(",");
            let _ = sess.method_pref(MethodType::MacCs, &list);
            let _ = sess.method_pref(MethodType::MacSc, &list);
        }
        if !jump.preferred_kex.is_empty() {
            let list = jump.preferred_kex.join(",");
            let _ = sess.method_pref(MethodType::Kex, &list);
        }
        if !jump.preferred_host_key_algorithms.is_empty() {
            let list = jump.preferred_host_key_algorithms.join(",");
            let _ = sess.method_pref(MethodType::HostKey, &list);
        }
    }

    fn authenticate_session(
        session: &mut Session,
        config: &SshConnectionConfig,
        phase: &dyn SshDeadlinePhase,
    ) -> Result<(), String> {
        // Try public key authentication first if key is provided
        if let Some(private_key_path) = &config.private_key_path {
            phase.ensure_active()?;
            if let Ok(private_key_content) = std::fs::read_to_string(private_key_path) {
                // Check if this is an SK (security-key) type — these require FIDO2 touch
                if super::fido2::is_sk_private_key(&private_key_content) {
                    log::info!(
                        "SK key detected at {}. User touch on FIDO2 authenticator may be required.",
                        private_key_path
                    );

                    if config.sk_pin.is_some() || config.sk_application.is_some() {
                        log::warn!(
                            "SK key auth for {} is relying on the system OpenSSH helper prompt; backend SSH_SK_* env injection is disabled to avoid cross-session secret leakage.",
                            private_key_path
                        );
                    }
                }

                let passphrase = config
                    .private_key_passphrase
                    .as_ref()
                    .map(|secret| secret.expose_secret().as_str());

                phase.configure_session_timeout(session)?;
                if session
                    .userauth_pubkey_file(
                        &config.username,
                        None,
                        Path::new(private_key_path),
                        passphrase,
                    )
                    .is_ok()
                {
                    return Ok(());
                }
                phase.ensure_active()?;
            }
            phase.ensure_active()?;
        }

        // Try password authentication if password is provided
        if let Some(password) = &config.password {
            phase.configure_session_timeout(session)?;
            if session
                .userauth_password(&config.username, password.expose_secret())
                .is_ok()
            {
                return Ok(());
            }
            phase.ensure_active()?;
        }

        // Try keyboard-interactive authentication (for MFA/2FA)
        if config.password.is_some()
            || config.totp_secret.is_some()
            || !config.keyboard_interactive_responses.is_empty()
        {
            struct KeyboardInteractiveHandler {
                password: Option<SecretString>,
                totp_secret: Option<SecretString>,
                responses: Vec<SecretString>,
            }

            impl KeyboardInteractivePrompt for KeyboardInteractiveHandler {
                fn prompt(
                    &mut self,
                    _username: &str,
                    _instructions: &str,
                    prompts: &[Prompt],
                ) -> Vec<String> {
                    prompts
                        .iter()
                        .map(|prompt| {
                            let prompt_lower = prompt.text.to_lowercase();

                            if prompt_lower.contains("verification")
                                || prompt_lower.contains("code")
                                || prompt_lower.contains("token")
                                || prompt_lower.contains("otp")
                                || prompt_lower.contains("2fa")
                                || prompt_lower.contains("mfa")
                            {
                                if let Some(ref secret) = self.totp_secret {
                                    if let Ok(code) = generate_totp_code(secret.expose_secret()) {
                                        return code;
                                    }
                                }
                                for resp in &self.responses {
                                    if !resp.expose_secret().is_empty() {
                                        return resp.expose_secret().to_string();
                                    }
                                }
                            }

                            if prompt_lower.contains("password") {
                                if let Some(ref pwd) = self.password {
                                    return pwd.expose_secret().to_string();
                                }
                            }

                            if let Some(ref pwd) = self.password {
                                return pwd.expose_secret().to_string();
                            }

                            String::new()
                        })
                        .collect()
                }
            }

            let mut handler = KeyboardInteractiveHandler {
                password: config.password.clone(),
                totp_secret: config.totp_secret.clone(),
                responses: config.keyboard_interactive_responses.clone(),
            };

            phase.configure_session_timeout(session)?;
            if session
                .userauth_keyboard_interactive(&config.username, &mut handler)
                .is_ok()
            {
                return Ok(());
            }
            phase.ensure_active()?;
        }

        // Try agent authentication
        phase.configure_session_timeout(session)?;
        if session.userauth_agent(&config.username).is_ok() {
            return Ok(());
        }
        phase.ensure_active()?;

        Err("All authentication methods failed".to_string())
    }

    fn authenticate_jump_session(
        session: &mut Session,
        jump_config: &JumpHostConfig,
        phase: &dyn SshDeadlinePhase,
    ) -> Result<(), String> {
        // 1. Public key
        if let Some(private_key_path) = &jump_config.private_key_path {
            let passphrase = jump_config
                .private_key_passphrase
                .as_ref()
                .map(|secret| secret.expose_secret().as_str());
            phase.configure_session_timeout(session)?;
            if session
                .userauth_pubkey_file(
                    &jump_config.username,
                    None,
                    Path::new(private_key_path),
                    passphrase,
                )
                .is_ok()
            {
                return Ok(());
            }
            phase.ensure_active()?;
        }

        // 2. Password
        if let Some(password) = &jump_config.password {
            phase.configure_session_timeout(session)?;
            if session
                .userauth_password(&jump_config.username, password.expose_secret())
                .is_ok()
            {
                return Ok(());
            }
            phase.ensure_active()?;
        }

        // 3. Keyboard-interactive (TOTP / MFA)
        if jump_config.password.is_some()
            || jump_config.totp_secret.is_some()
            || !jump_config.keyboard_interactive_responses.is_empty()
        {
            struct JumpKbdHandler {
                password: Option<SecretString>,
                totp_secret: Option<SecretString>,
                responses: Vec<SecretString>,
            }

            impl KeyboardInteractivePrompt for JumpKbdHandler {
                fn prompt(
                    &mut self,
                    _username: &str,
                    _instructions: &str,
                    prompts: &[Prompt],
                ) -> Vec<String> {
                    prompts
                        .iter()
                        .map(|prompt| {
                            let lower = prompt.text.to_lowercase();

                            // OTP / TOTP
                            if lower.contains("verification")
                                || lower.contains("code")
                                || lower.contains("token")
                                || lower.contains("otp")
                                || lower.contains("2fa")
                                || lower.contains("mfa")
                            {
                                if let Some(ref secret) = self.totp_secret {
                                    if let Ok(code) = generate_totp_code(secret.expose_secret()) {
                                        return code;
                                    }
                                }
                                for r in &self.responses {
                                    if !r.expose_secret().is_empty() {
                                        return r.expose_secret().to_string();
                                    }
                                }
                            }

                            // Password
                            if lower.contains("password") {
                                if let Some(ref p) = self.password {
                                    return p.expose_secret().to_string();
                                }
                            }

                            self.password
                                .as_ref()
                                .map(|password| password.expose_secret().to_string())
                                .unwrap_or_default()
                        })
                        .collect()
                }
            }

            let mut handler = JumpKbdHandler {
                password: jump_config.password.clone(),
                totp_secret: jump_config.totp_secret.clone(),
                responses: jump_config.keyboard_interactive_responses.clone(),
            };

            phase.configure_session_timeout(session)?;
            if session
                .userauth_keyboard_interactive(&jump_config.username, &mut handler)
                .is_ok()
            {
                return Ok(());
            }
            phase.ensure_active()?;
        }

        // 4. SSH agent
        phase.configure_session_timeout(session)?;
        if session.userauth_agent(&jump_config.username).is_ok() {
            return Ok(());
        }
        phase.ensure_active()?;

        Err("All jump host authentication methods failed".to_string())
    }

    pub async fn update_session_auth(
        &mut self,
        session_id: &str,
        password: Option<String>,
        private_key_path: Option<String>,
        private_key_passphrase: Option<String>,
    ) -> Result<(), String> {
        let mut next_config = self
            .sessions
            .get(session_id)
            .ok_or("Session not found")?
            .config
            .clone();

        if let Some(password) = password {
            next_config.password = Some(SecretString::new(password));
        }

        if let Some(private_key_path) = private_key_path {
            next_config.private_key_path = Some(private_key_path);
        }

        if let Some(passphrase) = private_key_passphrase {
            next_config.private_key_passphrase = Some(SecretString::new(passphrase));
        }

        let retained_bytes =
            retained_ssh_config_bytes(&next_config).map_err(|error| error.to_string())?;
        let limit = self.connection_admission.limits.max_config_bytes;
        if retained_bytes > limit {
            return Err(SshConnectionAdmissionError::ConfigTooLarge {
                bytes: retained_bytes,
                limit,
            }
            .to_string());
        }

        self.sessions
            .get_mut(session_id)
            .ok_or("Session not found")?
            .config = next_config;

        Ok(())
    }

    async fn verify_host_key(
        &self,
        session_id: &str,
        session: &mut Session,
        config: &SshConnectionConfig,
    ) -> Result<(), String> {
        let known_hosts_path = match config.known_hosts_path.clone() {
            Some(path) => path,
            None => dirs::home_dir()
                .ok_or_else(|| {
                    "Host key verification failed: unable to determine the home directory for known_hosts"
                        .to_string()
                })?
                .join(".ssh")
                .join("known_hosts")
                .to_string_lossy()
                .to_string(),
        };

        let (host_key, key_type) = session.host_key().ok_or("No host key available")?;
        let host_key = host_key.to_vec();
        let host_key_info = build_host_key_info(&host_key, key_type);

        let check_result = {
            let _known_hosts_guard = lock_known_hosts_file()?;
            let mut known_hosts = session
                .known_hosts()
                .map_err(|e| format!("Failed to create known_hosts handle: {}", e))?;

            read_known_hosts_if_present(&mut known_hosts, Path::new(&known_hosts_path))?;

            known_hosts.check_port(&config.host, config.port, &host_key)
        };

        match check_result {
            ssh2::CheckResult::Match => {
                log::info!("Host key verified for {}", config.host);
                Ok(())
            }
            ssh2::CheckResult::NotFound => {
                let decision =
                    if Self::should_accept_new_host_key(config, ssh2::CheckResult::NotFound) {
                        SshHostKeyPromptDecision::AcceptAndSave
                    } else {
                        self.prompt_for_host_key_decision(
                            session_id,
                            config,
                            &host_key_info,
                            SshHostKeyPromptStatus::FirstUse,
                        )
                        .await?
                    };
                let persistence = HostKeyPersistenceContext {
                    config,
                    known_hosts_path: &known_hosts_path,
                    host_key: &host_key,
                    key_type,
                    replace_existing: false,
                };
                self.apply_host_key_decision(session, &persistence, decision)
            }
            ssh2::CheckResult::Mismatch => {
                if config.accept_new_host_keys {
                    return Err(Self::accept_new_mismatch_error(config));
                }
                let decision = self
                    .prompt_for_host_key_decision(
                        session_id,
                        config,
                        &host_key_info,
                        SshHostKeyPromptStatus::Mismatch,
                    )
                    .await?;
                let persistence = HostKeyPersistenceContext {
                    config,
                    known_hosts_path: &known_hosts_path,
                    host_key: &host_key,
                    key_type,
                    replace_existing: true,
                };
                self.apply_host_key_decision(session, &persistence, decision)
            }
            ssh2::CheckResult::Failure => Err(format!(
                "Host key verification failed for {}: internal error checking known_hosts",
                config.host
            )),
        }
    }

    fn should_accept_new_host_key(
        config: &SshConnectionConfig,
        check_result: ssh2::CheckResult,
    ) -> bool {
        config.strict_host_key_checking
            && config.accept_new_host_keys
            && matches!(check_result, ssh2::CheckResult::NotFound)
    }

    fn accept_new_mismatch_error(config: &SshConnectionConfig) -> String {
        format!(
            "Host key verification failed for {}: known host key changed; refusing to overwrite accept-new trust",
            config.host
        )
    }

    async fn prompt_for_host_key_decision(
        &self,
        session_id: &str,
        config: &SshConnectionConfig,
        host_key_info: &SshHostKeyInfo,
        status: SshHostKeyPromptStatus,
    ) -> Result<SshHostKeyPromptDecision, String> {
        self.prompt_for_host_key_decision_with_timeout(
            session_id,
            config,
            host_key_info,
            status,
            Duration::from_secs(120),
        )
        .await
    }

    async fn prompt_for_host_key_decision_with_timeout(
        &self,
        session_id: &str,
        config: &SshConnectionConfig,
        host_key_info: &SshHostKeyInfo,
        status: SshHostKeyPromptStatus,
        timeout: Duration,
    ) -> Result<SshHostKeyPromptDecision, String> {
        let emitter = self
            .event_emitter
            .clone()
            .ok_or_else(|| "No event emitter configured for host-key verification".to_string())?;
        let (decision_tx, decision_rx) = tokio::sync::oneshot::channel();

        {
            let mut pending = PENDING_HOST_KEY_PROMPTS
                .lock()
                .map_err(|e| format!("Failed to lock host-key prompt map: {}", e))?;
            pending.insert(session_id.to_string(), decision_tx);
        }

        let payload = SshHostKeyPromptEvent {
            session_id: session_id.to_string(),
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            status,
            fingerprint: host_key_info.fingerprint.clone(),
            key_type: host_key_info.key_type.clone(),
            key_bits: host_key_info.key_bits,
            public_key: host_key_info.public_key.clone(),
        };

        let payload = serde_json::to_value(payload)
            .map_err(|e| format!("Failed to serialize host-key prompt payload: {}", e))?;
        if let Err(error) = emitter.emit_event("ssh://host-key-prompt", payload) {
            let mut pending = PENDING_HOST_KEY_PROMPTS
                .lock()
                .map_err(|e| format!("Failed to lock host-key prompt map: {}", e))?;
            pending.remove(session_id);
            return Err(format!("Failed to emit host-key prompt: {}", error));
        }

        match tokio::time::timeout(timeout, decision_rx).await {
            Ok(Ok(decision)) => Ok(decision),
            Ok(Err(_)) => Err(format!(
                "Host key verification failed for {}: prompt response channel closed",
                config.host
            )),
            Err(_) => {
                let mut pending = PENDING_HOST_KEY_PROMPTS
                    .lock()
                    .map_err(|e| format!("Failed to lock host-key prompt map: {}", e))?;
                pending.remove(session_id);
                Err(format!(
                    "Host key verification timed out for {} after waiting for user confirmation",
                    config.host
                ))
            }
        }
    }

    fn apply_host_key_decision(
        &self,
        session: &mut Session,
        persistence: &HostKeyPersistenceContext<'_>,
        decision: SshHostKeyPromptDecision,
    ) -> Result<(), String> {
        match decision {
            SshHostKeyPromptDecision::AcceptOnce => Ok(()),
            SshHostKeyPromptDecision::AcceptAndSave => self.persist_host_key(session, persistence),
            SshHostKeyPromptDecision::Reject => Err(format!(
                "Host key verification failed for {}: key rejected by user",
                persistence.config.host
            )),
        }
    }

    fn persist_host_key(
        &self,
        session: &mut Session,
        persistence: &HostKeyPersistenceContext<'_>,
    ) -> Result<(), String> {
        let _known_hosts_guard = lock_known_hosts_file()?;
        let mut known_hosts = session
            .known_hosts()
            .map_err(|e| format!("Failed to create known_hosts handle: {}", e))?;

        read_known_hosts_if_present(&mut known_hosts, Path::new(persistence.known_hosts_path))?;

        match known_hosts.check_port(
            &persistence.config.host,
            persistence.config.port,
            persistence.host_key,
        ) {
            ssh2::CheckResult::Match => return Ok(()),
            ssh2::CheckResult::Mismatch if !persistence.replace_existing => {
                return Err(format!(
                    "Host key verification failed for {}: known_hosts changed before first-use persistence; refusing to overwrite",
                    persistence.config.host
                ));
            }
            ssh2::CheckResult::Failure => {
                return Err(format!(
                    "Host key verification failed for {}: internal error rechecking known_hosts before persistence",
                    persistence.config.host
                ));
            }
            ssh2::CheckResult::NotFound | ssh2::CheckResult::Mismatch => {}
        }

        if persistence.replace_existing {
            let cleanup_names =
                known_host_cleanup_names(&persistence.config.host, persistence.config.port);
            let existing_hosts = known_hosts
                .hosts()
                .map_err(|e| format!("Failed to enumerate known_hosts entries: {}", e))?;

            for host in existing_hosts {
                if let Some(name) = host.name() {
                    if cleanup_names.iter().any(|candidate| candidate == name) {
                        known_hosts.remove(&host).map_err(|e| {
                            format!("Failed to replace existing known_hosts entry: {}", e)
                        })?;
                    }
                }
            }
        }

        known_hosts
            .add(
                &known_host_entry_name(&persistence.config.host, persistence.config.port),
                persistence.host_key,
                "Added by SortOfRemoteNG",
                known_host_key_format(persistence.key_type),
            )
            .map_err(|e| format!("Failed to add host key to known_hosts: {}", e))?;

        if let Some(parent) = Path::new(persistence.known_hosts_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create known_hosts directory: {}", e))?;
        }

        known_hosts
            .write_file(
                Path::new(persistence.known_hosts_path),
                ssh2::KnownHostFileKind::OpenSSH,
            )
            .map_err(|e| format!("Failed to write known_hosts file: {}", e))?;

        log::info!(
            "Host key for {} {} in known_hosts",
            persistence.config.host,
            if persistence.replace_existing {
                "updated"
            } else {
                "added"
            }
        );
        Ok(())
    }

    fn start_keep_alive(
        &self,
        session_id: String,
        interval_secs: u64,
        session: Session,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(interval_secs));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            // Tokio intervals tick immediately. The server only needs a probe
            // after the configured idle interval, so consume the initial tick.
            tick.tick().await;
            loop {
                tick.tick().await;
                match session.keepalive_send() {
                    Ok(seconds_to_next) => {
                        log::debug!(
                            "Sent SSH keepalive for session {}; next due in {}s",
                            session_id,
                            seconds_to_next
                        );
                    }
                    Err(error) if is_transient_keepalive_error(&error) => {
                        log::debug!(
                            "SSH keepalive for session {} would block; retrying on next interval",
                            session_id
                        );
                    }
                    Err(error) => {
                        // The shell reader owns user-facing transport failure
                        // reporting and emits exactly one close event. Stop this
                        // auxiliary task so a dead transport cannot create an
                        // unbounded stream of duplicate diagnostics.
                        log::warn!("SSH keepalive failed for session {}: {}", session_id, error);
                        break;
                    }
                }
            }
        })
    }

    pub async fn validate_key_file(
        &self,
        key_path: &str,
        _passphrase: Option<&str>,
    ) -> Result<bool, String> {
        if !Path::new(key_path).exists() {
            return Err(format!("Key file does not exist: {}", key_path));
        }

        let key_content = std::fs::read_to_string(key_path)
            .map_err(|e| format!("Failed to read key file: {}", e))?;

        // Accept standard PEM private keys and OpenSSH-format SK keys
        let is_standard =
            key_content.contains("-----BEGIN") && key_content.contains("PRIVATE KEY-----");
        let is_sk = super::fido2::is_sk_private_key(&key_content);

        if !is_standard && !is_sk {
            return Err("File does not appear to be a valid private key".to_string());
        }

        Ok(true)
    }

    pub async fn generate_ssh_key(
        &self,
        key_type: &str,
        bits: Option<usize>,
        passphrase: Option<String>,
    ) -> Result<(String, String), String> {
        use ssh_key::rand_core::OsRng;
        use ssh_key::LineEnding;
        use ssh_key::{Algorithm, PrivateKey};

        let lower = key_type.to_lowercase();

        // Security-key types are generated via ssh-keygen (requires FIDO2 hardware)
        if lower == "ed25519-sk" || lower == "ecdsa-sk" {
            return self.generate_sk_key(key_type, passphrase).await;
        }

        let private_key = match lower.as_str() {
            "rsa" => {
                let bit_size = bits.unwrap_or(3072);
                PrivateKey::random(&mut OsRng, Algorithm::Rsa { hash: None }).map_err(|e| {
                    format!(
                        "Failed to generate RSA-{} key: {}. Using ssh_key default size. {}",
                        bit_size, e, ""
                    )
                })?
            }
            "ed25519" => PrivateKey::random(&mut OsRng, Algorithm::Ed25519)
                .map_err(|e| format!("Failed to generate Ed25519 key: {}", e))?,
            "ecdsa" | "ecdsa-p256" => PrivateKey::random(
                &mut OsRng,
                Algorithm::Ecdsa {
                    curve: ssh_key::EcdsaCurve::NistP256,
                },
            )
            .map_err(|e| format!("Failed to generate ECDSA key: {}", e))?,
            _ => {
                return Err(format!(
                "Unsupported key type: {}. Supported: rsa, ed25519, ecdsa, ed25519-sk, ecdsa-sk",
                key_type
            ))
            }
        };

        let final_priv_key = if let Some(pass) = passphrase.filter(|p| !p.is_empty()) {
            private_key
                .encrypt(&mut OsRng, pass.as_bytes())
                .map_err(|e| format!("Failed to encrypt key with passphrase: {}", e))?
                .to_openssh(LineEnding::LF)
                .map_err(|e| format!("Failed to encode encrypted key: {}", e))?
                .to_string()
        } else {
            private_key
                .to_openssh(LineEnding::LF)
                .map_err(|e| format!("Failed to encode private key: {}", e))?
                .to_string()
        };

        let public_key = private_key.public_key();
        let public_key_str = public_key
            .to_openssh()
            .map_err(|e| format!("Failed to encode public key: {}", e))?;

        Ok((final_priv_key, public_key_str))
    }

    /// Generate an SK (security-key) SSH key pair using the system's ssh-keygen.
    ///
    /// This requires OpenSSH 8.2+ and a connected FIDO2 authenticator.
    /// The user will be prompted to touch their security key during generation.
    async fn generate_sk_key(
        &self,
        key_type: &str,
        passphrase: Option<String>,
    ) -> Result<(String, String), String> {
        use super::fido2::{Fido2Provider, OpenSshSkProvider, SkKeyGenOptions};
        use super::sk_keys::SkAlgorithm;

        let algorithm = match key_type.to_lowercase().as_str() {
            "ed25519-sk" => SkAlgorithm::Ed25519Sk,
            "ecdsa-sk" => SkAlgorithm::EcdsaSk,
            _ => return Err(format!("Unsupported SK key type: {}", key_type)),
        };

        let provider = OpenSshSkProvider::new();
        let opts = SkKeyGenOptions {
            algorithm,
            passphrase: passphrase.map(SecretString::new),
            ..Default::default()
        };

        let result = provider.generate_key(&opts).await?;
        Ok((result.private_key_openssh, result.public_key_openssh))
    }

    /// Generate an SK key with full options (used by the Tauri command).
    pub async fn generate_sk_key_full(
        &self,
        request: super::types::SkKeyGenerationRequest,
    ) -> Result<super::types::SkKeyGenerationResponse, String> {
        use super::fido2::{Fido2Provider, OpenSshSkProvider, SkKeyGenOptions};
        use super::sk_keys::SkAlgorithm;

        let algorithm = match request.key_type.to_lowercase().as_str() {
            "ed25519-sk" => SkAlgorithm::Ed25519Sk,
            "ecdsa-sk" => SkAlgorithm::EcdsaSk,
            _ => {
                return Err(format!(
                    "Unsupported SK key type: {}. Use ed25519-sk or ecdsa-sk.",
                    request.key_type
                ))
            }
        };

        let provider = OpenSshSkProvider::new();
        let opts = SkKeyGenOptions {
            algorithm,
            application: request.application.clone(),
            user: request.user.clone(),
            user_presence_required: !request.no_touch_required,
            user_verification_required: request.verify_required,
            resident: request.resident,
            device_path: request.device_path.clone(),
            pin: request.pin.clone(),
            comment: request.comment.clone(),
            passphrase: request.passphrase.clone(),
            ..Default::default()
        };

        let result = provider.generate_key(&opts).await?;

        // Write the generated keys to the requested output path
        let priv_path = std::path::PathBuf::from(&request.output_path);
        let pub_path = priv_path.with_extension("pub");

        tokio::fs::write(&priv_path, &result.private_key_openssh)
            .await
            .map_err(|e| format!("Failed to write private key: {}", e))?;

        // Set permissions on private key (Unix only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            std::fs::set_permissions(&priv_path, perms)
                .map_err(|e| format!("Failed to set key file permissions: {}", e))?;
        }

        tokio::fs::write(&pub_path, &result.public_key_openssh)
            .await
            .map_err(|e| format!("Failed to write public key: {}", e))?;

        let fingerprint = result.public_key.fingerprint_sha256();

        Ok(super::types::SkKeyGenerationResponse {
            private_key_path: priv_path.to_string_lossy().to_string(),
            public_key_path: pub_path.to_string_lossy().to_string(),
            public_key_content: result.public_key_openssh,
            fingerprint,
            resident: request.resident,
            algorithm: request.key_type,
        })
    }

    async fn test_ssh_connection_inner(
        &self,
        session_id: String,
        config: SshConnectionConfig,
        cleanup_key: PendingSshCleanupKey,
        proxy_command_reservation: Option<super::proxy_command::ProxyCommandProducerReservation>,
    ) -> Result<String, String> {
        let setup_guard = SshConnectionSetupGuard::new(
            cleanup_key,
            self.establishment_session_lease.clone(),
            proxy_command_reservation,
        );
        let control = self.establishment_control(&config)?;
        control.ensure_active("overall")?;
        // Use the same priority as connect_ssh (including ProxyCommand)
        let (final_stream, intermediate_sessions, bridge_handles) =
            if let Some(ref proxy_cmd) = config.proxy_command {
                if proxy_cmd.command.is_some() || proxy_cmd.template.is_some() {
                    let s = control.run_blocking_phase(
                        "proxy-command-spawn",
                        control.overall_timeout,
                        |_phase| {
                            let reservation =
                            setup_guard.proxy_command_reservation().ok_or_else(|| {
                                "SSH connection test worker is missing its ProxyCommand reservation"
                                    .to_string()
                            })?;
                            super::proxy_command::spawn_reserved_proxy_command(
                                reservation,
                                &session_id,
                                proxy_cmd,
                                &config.host,
                                config.port,
                                &config.username,
                                control.overall_timeout.as_secs(),
                            )
                        },
                    )?;
                    control.track_blocking_socket(&s, "proxy-command-relay")?;
                    (s, Vec::new(), Vec::new())
                } else if let Some(ref mixed_chain) = config.mixed_chain {
                    self.establish_mixed_chain_connection(&config, mixed_chain)
                        .await?
                } else {
                    let s = self.establish_direct_connection(&config).await?;
                    (s, Vec::new(), Vec::new())
                }
            } else if let Some(ref mixed_chain) = config.mixed_chain {
                self.establish_mixed_chain_connection(&config, mixed_chain)
                    .await?
            } else if let Some(ref proxy_chain) = config.proxy_chain {
                let s = self
                    .establish_proxy_chain_connection(&config, proxy_chain)
                    .await?;
                (s, Vec::new(), Vec::new())
            } else if let Some(ref proxy_config) = config.proxy_config {
                let s = self
                    .establish_proxy_connection(&config, proxy_config)
                    .await?;
                (s, Vec::new(), Vec::new())
            } else if !config.jump_hosts.is_empty() {
                self.establish_jump_connection(&config).await?
            } else {
                let s = self.establish_direct_connection(&config).await?;
                (s, Vec::new(), Vec::new())
            };
        let bridge_cleanup = EstablishmentBridgeCleanup::from_parts(
            intermediate_sessions,
            bridge_handles,
            self.establishment_session_lease.clone(),
        );
        control.track_blocking_socket(&final_stream, "final-ssh-transport")?;

        let mut sess =
            Session::new().map_err(|e| format!("Failed to create test session: {}", e))?;
        sess.set_tcp_stream(final_stream);
        control.run_blocking_phase("final-ssh-handshake", control.overall_timeout, |phase| {
            phase.configure_session_timeout(&sess)?;
            sess.handshake()
                .map_err(|e| format!("SSH handshake failed: {}", e))
        })?;

        if config.strict_host_key_checking {
            sess = self
                .verify_host_key_isolated(sess, session_id.clone(), config.clone(), &control)
                .await?;
        }

        sess = self
            .authenticate_session_isolated(
                sess,
                config.clone(),
                &control,
                "final-ssh-authentication",
                control.overall_timeout,
            )
            .await?;
        control.complete()?;
        sess.set_timeout(0);

        // The guard drops intermediate sessions and joins every native bridge;
        // its session lease remains retained until that cleanup actually exits.
        drop(sess);
        drop(bridge_cleanup);
        Ok("SSH connection test successful".to_string())
    }

    pub async fn execute_command(
        &mut self,
        session_id: &str,
        command: String,
        timeout: Option<u64>,
    ) -> Result<String, String> {
        let output = self
            .execute_command_capped(
                session_id,
                command,
                timeout,
                super::integration::DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES,
            )
            .await?;

        if output.exit_status != 0 {
            return Err(Self::command_failure_message(&output));
        }
        if output.was_truncated() {
            return Err(format!(
                "Command completed with exit code 0, but output exceeded the {}-byte combined capture limit (stdout truncated: {}, stderr truncated: {}); excess output was drained",
                output.capture_limit_bytes,
                output.stdout_truncated,
                output.stderr_truncated
            ));
        }

        String::from_utf8(output.stdout)
            .map_err(|error| Self::cap_command_error(format!("Invalid UTF-8 output: {error}")))
    }

    /// Execute a command while retaining at most `max_output_bytes` across
    /// stdout and stderr combined. Both streams continue to be drained after
    /// that budget is exhausted so a verbose remote process cannot deadlock on
    /// a full SSH channel window.
    pub async fn execute_command_capped(
        &mut self,
        session_id: &str,
        command: String,
        timeout: Option<u64>,
        max_output_bytes: usize,
    ) -> Result<super::integration::SshCommandOutput, String> {
        self.execute_command_capped_with_input(session_id, command, timeout, max_output_bytes, None)
            .await
    }

    pub async fn execute_command_capped_with_input(
        &mut self,
        session_id: &str,
        command: String,
        timeout: Option<u64>,
        max_output_bytes: usize,
        stdin_data: Option<Vec<u8>>,
    ) -> Result<super::integration::SshCommandOutput, String> {
        let mut stdin_data = stdin_data.map(ZeroingCommandInput);
        if stdin_data
            .as_ref()
            .is_some_and(|data| data.0.len() > super::integration::MAX_COMMAND_INPUT_LIMIT_BYTES)
        {
            return Err(format!(
                "SSH command input exceeds the {} byte limit",
                super::integration::MAX_COMMAND_INPUT_LIMIT_BYTES
            ));
        }
        if max_output_bytes > super::integration::MAX_COMMAND_OUTPUT_LIMIT_BYTES {
            return Err(format!(
                "Requested SSH command capture limit {max_output_bytes} exceeds the hard limit of {} bytes",
                super::integration::MAX_COMMAND_OUTPUT_LIMIT_BYTES
            ));
        }
        if !self.sessions.contains_key(session_id) {
            return Err("Session not found".to_string());
        }

        let shell_pause = self.pause_shell_io(session_id);
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        // Temporarily switch to blocking mode for command execution.
        // The shell thread uses non-blocking mode, but exec channels
        // need blocking reads. Save and restore the previous state.
        let was_blocking = session.session.is_blocking();
        if !was_blocking {
            session.session.set_blocking(true);
        }

        let result = (|| -> Result<super::integration::SshCommandOutput, String> {
            let mut channel = session.session.channel_session().map_err(|error| {
                Self::cap_command_error(format!("Failed to create channel: {error}"))
            })?;

            // Keep channel setup blocking, then alternate non-blocking reads
            // across both streams so neither stream can starve the other.
            let timeout_ms = timeout.unwrap_or(30_000).clamp(1, 300_000);
            session
                .session
                .set_timeout(timeout_ms.min(u32::MAX as u64) as u32);

            channel.exec(&command).map_err(|error| {
                Self::cap_command_error(format!("Failed to execute command: {error}"))
            })?;

            if let Some(data) = stdin_data.as_mut() {
                channel.write_all(&data.0).map_err(|error| {
                    Self::cap_command_error(format!("Failed to write SSH command input: {error}"))
                })?;
                channel.send_eof().map_err(|error| {
                    Self::cap_command_error(format!("Failed to close SSH command input: {error}"))
                })?;
            }

            session.session.set_blocking(false);
            let deadline = std::time::Instant::now()
                .checked_add(std::time::Duration::from_millis(timeout_ms))
                .ok_or_else(|| "SSH command timeout is outside the supported range".to_string())?;
            let mut output = super::integration::SshCommandOutput {
                stdout: Vec::new(),
                stderr: Vec::new(),
                exit_status: -1,
                stdout_truncated: false,
                stderr_truncated: false,
                capture_limit_bytes: max_output_bytes,
            };
            let mut stdout_buffer = [0_u8; 16 * 1024];
            let mut stderr_buffer = [0_u8; 16 * 1024];

            loop {
                let mut made_progress = false;

                match channel.read(&mut stdout_buffer) {
                    Ok(0) => {}
                    Ok(bytes_read) => {
                        made_progress = true;
                        let remaining = max_output_bytes.saturating_sub(
                            output.stdout.len().saturating_add(output.stderr.len()),
                        );
                        Self::append_captured_output(
                            &mut output.stdout,
                            &stdout_buffer[..bytes_read],
                            remaining,
                            &mut output.stdout_truncated,
                        );
                    }
                    Err(error) if is_transient_shell_io_error(&error) => {}
                    Err(error) => {
                        return Err(Self::cap_command_error(format!(
                            "Failed to read SSH command stdout: {error}"
                        )));
                    }
                }

                {
                    let mut stderr_stream = channel.stderr();
                    match stderr_stream.read(&mut stderr_buffer) {
                        Ok(0) => {}
                        Ok(bytes_read) => {
                            made_progress = true;
                            let remaining = max_output_bytes.saturating_sub(
                                output.stdout.len().saturating_add(output.stderr.len()),
                            );
                            Self::append_captured_output(
                                &mut output.stderr,
                                &stderr_buffer[..bytes_read],
                                remaining,
                                &mut output.stderr_truncated,
                            );
                        }
                        Err(error) if is_transient_shell_io_error(&error) => {}
                        Err(error) => {
                            return Err(Self::cap_command_error(format!(
                                "Failed to read SSH command stderr: {error}"
                            )));
                        }
                    }
                }

                if channel.eof() {
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    let _ = channel.close();
                    return Err(format!(
                        "SSH command timed out after {timeout_ms} ms; the retained session must be discarded"
                    ));
                }
                if !made_progress {
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            }

            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                let _ = channel.close();
                return Err(format!(
                    "SSH command timed out after {timeout_ms} ms while awaiting channel close; the retained session must be discarded"
                ));
            }

            session.session.set_blocking(true);
            session
                .session
                .set_timeout(remaining.as_millis().clamp(1, u32::MAX as u128) as u32);
            channel.wait_close().map_err(|error| {
                Self::cap_command_error(format!("Failed to close SSH command channel: {error}"))
            })?;
            output.exit_status = channel.exit_status().unwrap_or(-1);
            Ok(output)
        })();

        // Restore the exact previous session mode even though the drain loop
        // deliberately switches between blocking setup and non-blocking I/O.
        session.session.set_blocking(was_blocking);
        // Reset timeout
        session.session.set_timeout(0);
        Self::resume_shell_io(shell_pause);

        result
    }

    fn append_captured_output(
        destination: &mut Vec<u8>,
        bytes: &[u8],
        remaining: usize,
        truncated: &mut bool,
    ) {
        let retained = remaining.min(bytes.len());
        destination.extend_from_slice(&bytes[..retained]);
        if retained < bytes.len() {
            *truncated = true;
        }
    }

    fn command_failure_message(output: &super::integration::SshCommandOutput) -> String {
        let mut message = format!("Command failed with exit code {}", output.exit_status);
        if output.was_truncated() {
            message.push_str(&format!(
                " [capture exceeded {} bytes; stdout truncated: {}, stderr truncated: {}]",
                output.capture_limit_bytes, output.stdout_truncated, output.stderr_truncated
            ));
        }
        Self::cap_command_error(message)
    }

    fn cap_command_error(mut error: String) -> String {
        const MAX_ERROR_BYTES: usize = 64 * 1024;
        if error.len() <= MAX_ERROR_BYTES {
            return error;
        }

        let mut boundary = MAX_ERROR_BYTES;
        while !error.is_char_boundary(boundary) {
            boundary -= 1;
        }
        error.truncate(boundary);
        error.push_str(" [error truncated]");
        error
    }

    pub async fn execute_command_interactive(
        &mut self,
        session_id: &str,
        command: String,
    ) -> Result<String, String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let mut channel = session
            .session
            .channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        channel
            .request_pty("xterm", None, None)
            .map_err(|e| format!("Failed to request PTY: {}", e))?;

        channel
            .exec(&command)
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let mut output = String::new();
        channel
            .read_to_string(&mut output)
            .map_err(|e| format!("Failed to read output: {}", e))?;

        channel
            .wait_close()
            .map_err(|e| format!("Failed to close channel: {}", e))?;

        Ok(output)
    }

    pub async fn start_shell(
        &mut self,
        session_id: &str,
        event_emitter: DynEventEmitter,
    ) -> Result<String, String> {
        self.prune_finished_shell(session_id);
        if let Some(existing) = self.shells.get(session_id) {
            return Ok(existing.id.clone());
        }

        let (tx, rx) = shell_mailbox(ShellMailboxLimits::default());
        let completion = ShellCompletion::new();
        let admission_lease = self.shell_admission.try_acquire(
            session_id,
            tx.cancellation(),
            Arc::clone(&completion),
        )?;
        let shell_generation = admission_lease.generation();

        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        session.session.set_blocking(true);

        let mut channel = session
            .session
            .channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        if session.config.agent_forwarding {
            if let Err(e) = channel.request_auth_agent_forwarding() {
                log::warn!(
                    "Failed to request agent forwarding: {} (continuing without)",
                    e
                );
            }
        }

        // ── X11 forwarding ──────────────────────────────────────────
        // HONEST UNSUPPORTED: the underlying SSH transport (ssh2/libssh2
        // 0.9.x) exposes no `x11-req` channel-request binding, so the remote
        // sshd can never be told to forward X11. Earlier code logged
        // "X11 forwarding requested" and spun up a local proxy listener, which
        // misled users into believing forwarding was active when it was a
        // silent no-op. We now surface an explicit, clearly-logged unsupported
        // status and do NOT start the (non-functional) proxy listener.
        if let Some(ref x11_cfg) = session.config.x11_forwarding {
            if x11_cfg.enabled {
                log::warn!(
                    "[{}] X11 forwarding requested (trusted={}) but is NOT supported by the \
                     current SSH backend (ssh2/libssh2 has no x11-req binding); ignoring. \
                     The remote session will have no DISPLAY forwarded.",
                    session_id,
                    x11_cfg.trusted
                );
            }
        }

        // ── Environment variables ───────────────────────────────────
        for (key, value) in &session.config.environment {
            if let Err(e) = channel.setenv(key, value) {
                // Remote environment values commonly carry tokens and other
                // credentials. Keep the variable name and transport error for
                // diagnosis, but never place the value in logs.
                log::warn!("{}", remote_environment_set_failure_message(key, &e));
            }
        }

        // ── PTY type ────────────────────────────────────────────────
        let pty_type = session.config.pty_type.as_deref().unwrap_or("xterm");
        channel
            .request_pty(pty_type, None, None)
            .map_err(|e| format!("Failed to request PTY: {}", e))?;

        channel
            .shell()
            .map_err(|e| format!("Failed to start shell: {}", e))?;

        session.session.set_blocking(false);

        // Release the mutable borrow on self.sessions.
        let _ = session;

        // Re-borrow session for the remaining work
        let _session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        // Allocate the generation before the actor starts so an immediate
        // snapshot (before first output) has stable replay identity.
        ensure_terminal_buffer(session_id)?;
        let shell_id = Uuid::new_v4().to_string();
        let session_id_owned = session_id.to_string();
        let emitter = event_emitter.clone();
        let suspend_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let shell_suspend_count = std::sync::Arc::clone(&suspend_count);
        let shell_admission = Arc::clone(&self.shell_admission);
        let completion_for_thread = Arc::clone(&completion);

        // Keep Rust's platform-default thread stack. The admission ceiling is
        // the resource guard; changing stack size requires separate measured
        // proof that libssh2 and every authentication path fit safely.
        let thread = std::thread::Builder::new()
            .name(format!("ssh-shell-{shell_generation}"))
            .spawn(move || {
                let _admission_lease = admission_lease;
                let completion_guard = ShellWorkerCompletionGuard::new(completion_for_thread);
                // Rebind captures after the lifecycle guards so channel and
                // mailbox destruction completes before the admission lease is
                // released, including during panic unwinding.
                let mut channel = channel;
                let mut rx = rx;
                let session_id_owned = session_id_owned;
                let emitter = emitter;
                let shell_admission = shell_admission;
                let shell_suspend_count = shell_suspend_count;
                let mut buffer = [0u8; 16384];
                let mut decoder = StreamingUtf8Decoder::new();
                let mut running = true;
                let mut close_reason = SshShellCloseReason::RemoteEof;
                let mut close_message: Option<String> = None;
                let mut idle_count: u32 = 0;
                const MIN_SLEEP_MS: u64 = 1;
                const MAX_SLEEP_MS: u64 = 10;
                const IDLE_THRESHOLD: u32 = 10;

                while running {
                    if rx.close_requested() {
                        close_reason = SshShellCloseReason::Requested;
                        close_message = None;
                        let _ = channel.close();
                        let _ = channel.wait_close();
                        break;
                    }

                    if let Some((cols, rows)) = rx.take_latest_resize() {
                        record_resize(&session_id_owned, cols, rows);
                        let _ = channel.request_pty_size(cols, rows, None, None);
                        idle_count = 0;
                    }

                    let input_commands = rx.drain_input_tick(
                        SHELL_INPUT_COMMANDS_PER_TICK,
                        SHELL_INPUT_BYTES_PER_TICK,
                    );
                    for command in input_commands {
                        if rx.close_requested() {
                            close_reason = SshShellCloseReason::Requested;
                            close_message = None;
                            let _ = channel.close();
                            let _ = channel.wait_close();
                            running = false;
                            break;
                        }
                        match command {
                            SshShellCommand::Input(data) => {
                                record_input(&session_id_owned, &data);
                                if let Err(message) =
                                    write_shell_input(&mut channel, data.as_bytes())
                                {
                                    emit_shell_error(&session_id_owned, &message, &emitter);
                                    close_reason = SshShellCloseReason::TransportError;
                                    close_message = Some(message);
                                    running = false;
                                    break;
                                }
                                idle_count = 0;
                            }
                            SshShellCommand::SecretInput(data) => {
                                if let Err(message) =
                                    write_shell_input(&mut channel, data.as_bytes())
                                {
                                    emit_shell_error(&session_id_owned, &message, &emitter);
                                    close_reason = SshShellCloseReason::TransportError;
                                    close_message = Some(message);
                                    running = false;
                                    break;
                                }
                                idle_count = 0;
                            }
                            SshShellCommand::Resize(..) | SshShellCommand::Close => {
                                // Resize and Close never enter the input queue.
                            }
                        }
                    }

                    if !running {
                        break;
                    }

                    if shell_suspend_count.load(std::sync::atomic::Ordering::Acquire) > 0 {
                        idle_count = 0;
                        std::thread::sleep(Duration::from_millis(MAX_SLEEP_MS));
                        continue;
                    }

                    match channel.read(&mut buffer) {
                        Ok(bytes) if bytes > 0 => {
                            idle_count = 0;
                            let raw_output = decoder.push(&buffer[..bytes]);
                            if let Some(payload) = shell_admission
                                .publish_if_current(&session_id_owned, shell_generation, || {
                                    prepare_shell_output(&session_id_owned, &raw_output)
                                })
                                .flatten()
                            {
                                emit_shell_output(payload, &emitter);
                            }
                        }
                        Ok(_) => {
                            idle_count = idle_count.saturating_add(1);
                        }
                        Err(error) if is_transient_shell_io_error(&error) => {
                            idle_count = idle_count.saturating_add(1);
                        }
                        Err(error) => {
                            let message = error.to_string();
                            emit_shell_error(&session_id_owned, &message, &emitter);
                            close_reason = SshShellCloseReason::TransportError;
                            close_message = Some(message);
                            running = false;
                        }
                    }

                    if running && channel.eof() {
                        close_reason = SshShellCloseReason::RemoteEof;
                        close_message = None;
                        running = false;
                    }

                    let sleep_ms = if idle_count > IDLE_THRESHOLD {
                        MAX_SLEEP_MS
                    } else {
                        MIN_SLEEP_MS
                    };
                    std::thread::sleep(Duration::from_millis(sleep_ms));
                }

                // Preserve an incomplete UTF-8 suffix at transport EOF instead
                // of silently losing it. Tombstoned generations cannot recreate
                // replay state after disconnect has detached them.
                let final_output = decoder.finish();
                if let Some(payload) = shell_admission
                    .publish_if_current(&session_id_owned, shell_generation, || {
                        prepare_shell_output(&session_id_owned, &final_output)
                    })
                    .flatten()
                {
                    emit_shell_output(payload, &emitter);
                }

                drop(rx);
                drop(channel);
                let payload = shell_closed_event(session_id_owned, close_reason, close_message);
                let _ = emitter.emit_event(
                    "ssh-shell-closed",
                    serde_json::to_value(&payload).unwrap_or_default(),
                );
                drop(decoder);
                drop(shell_suspend_count);
                drop(shell_admission);
                drop(emitter);
                drop(_admission_lease);
                // The lease removes this generation from process-wide
                // admission before completion becomes observable. A retry
                // that wakes on successful completion therefore cannot race
                // an old generation that still owns its permit.
                completion_guard.complete();
            })
            .map_err(|error| format!("Failed to spawn SSH shell worker: {error}"))?;

        self.shells.insert(
            session_id.to_string(),
            SshShellHandle {
                id: shell_id.clone(),
                sender: tx,
                thread,
                suspend_count,
                completion,
                generation: shell_generation,
            },
        );

        Ok(shell_id)
    }

    pub async fn send_shell_input(&mut self, session_id: &str, data: String) -> Result<(), String> {
        let shell = self.shells.get(session_id).ok_or("Shell not started")?;
        shell
            .sender
            .send(SshShellCommand::Input(data))
            .map_err(|error| format!("Failed to send input to shell: {error}"))
    }

    pub async fn send_shell_secret_input(
        &mut self,
        session_id: &str,
        data: zeroize::Zeroizing<String>,
    ) -> Result<(), String> {
        let shell = self.shells.get(session_id).ok_or("Shell not started")?;
        shell
            .sender
            .send(SshShellCommand::SecretInput(data))
            .map_err(|error| format!("Failed to send secure input to shell: {error}"))
    }

    pub async fn resize_shell(
        &mut self,
        session_id: &str,
        cols: u32,
        rows: u32,
    ) -> Result<(), String> {
        let shell = self.shells.get(session_id).ok_or("Shell not started")?;
        shell
            .sender
            .send(SshShellCommand::Resize(cols, rows))
            .map_err(|error| format!("Failed to resize shell: {error}"))
    }

    pub async fn stop_shell(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(shell) = self.detach_shell_cleanup(session_id)? {
            shell.request_shutdown();
            shell
                .finish(tokio::time::Instant::now() + SHELL_STOP_TIMEOUT)
                .await?;
        }
        Ok(())
    }

    pub async fn stop_port_forward(
        &mut self,
        session_id: &str,
        forward_id: &str,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        if let Some(handle) = session.port_forwards.remove(forward_id) {
            handle.handle.abort();
            log::info!(
                "Port forward {} stopped for session {}",
                forward_id,
                session_id
            );
            Ok(())
        } else {
            Err(format!("Port forward {} not found", forward_id))
        }
    }

    pub async fn setup_port_forward(
        &mut self,
        session_id: &str,
        config: PortForwardConfig,
    ) -> Result<String, String> {
        let forward_id = Uuid::new_v4().to_string();

        let handle = match config.direction {
            PortForwardDirection::Local => {
                let session = self
                    .sessions
                    .get_mut(session_id)
                    .ok_or("Session not found")?;
                session.last_activity = Utc::now();
                Self::setup_local_port_forward(session, &config, forward_id.clone()).await?
            }
            PortForwardDirection::Remote => {
                let session = self
                    .sessions
                    .get_mut(session_id)
                    .ok_or("Session not found")?;
                session.last_activity = Utc::now();
                Self::setup_remote_port_forward(session, &config, forward_id.clone()).await?
            }
            PortForwardDirection::Dynamic => {
                let session = self
                    .sessions
                    .get_mut(session_id)
                    .ok_or("Session not found")?;
                session.last_activity = Utc::now();
                Self::setup_dynamic_port_forward(session, &config, forward_id.clone()).await?
            }
        };

        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session.last_activity = Utc::now();
        session.port_forwards.insert(forward_id.clone(), handle);
        Ok(forward_id)
    }

    /// Resolve and validate the bind address for a local/dynamic port forward.
    ///
    /// Secure-by-default policy (t6 finding #10, user decision 2026-06-11):
    /// - An empty `local_host` defaults to loopback (`127.0.0.1`).
    /// - A loopback bind (`127.0.0.1`, `::1`, `localhost`) is always allowed.
    /// - A non-loopback / wildcard bind (e.g. `0.0.0.0`, `::`, a LAN/public
    ///   interface) is REJECTED unless `allow_non_loopback_bind` is explicitly
    ///   set on the forward config.
    ///
    /// Returns the effective bind host string to use, or an actionable error.
    fn resolve_forward_bind(config: &PortForwardConfig) -> Result<String, String> {
        let requested = config.local_host.trim();
        let host = if requested.is_empty() {
            "127.0.0.1"
        } else {
            requested
        };

        let is_loopback = match host.parse::<std::net::IpAddr>() {
            Ok(ip) => ip.is_loopback(),
            // Non-IP literals: only the conventional loopback hostname is
            // treated as loopback. Anything else is considered non-loopback.
            Err(_) => host.eq_ignore_ascii_case("localhost"),
        };

        if is_loopback || config.allow_non_loopback_bind {
            Ok(host.to_string())
        } else {
            Err(format!(
                "Refusing to bind SSH port forward to non-loopback address '{}'. \
                 Port forwards default to loopback (127.0.0.1) so the tunnel is only \
                 reachable from this machine. To deliberately expose this forward to \
                 other hosts on the network, set `allow_non_loopback_bind = true` on \
                 the port-forward configuration.",
                host
            ))
        }
    }

    async fn setup_local_port_forward(
        session: &mut SshSession,
        config: &PortForwardConfig,
        id: String,
    ) -> Result<PortForwardHandle, String> {
        let bind_host = Self::resolve_forward_bind(config)?;
        let listener = std::net::TcpListener::bind(format!("{}:{}", bind_host, config.local_port))
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Failed to set non-blocking: {}", e))?;

        let session_clone = session.session.clone();
        let config_clone = config.clone();
        let id_clone = id.clone();

        let handle = tokio::spawn(async move {
            let listener = tokio::net::TcpListener::from_std(listener).map_err(
                |e| -> Box<dyn std::error::Error + Send + Sync> {
                    format!("Failed to convert listener: {}", e).into()
                },
            )?;

            log::info!(
                "Local port forward started on {}:{} -> {}:{}",
                config_clone.local_host,
                config_clone.local_port,
                config_clone.remote_host,
                config_clone.remote_port
            );

            loop {
                match listener.accept().await {
                    Ok((local_stream, peer_addr)) => {
                        log::debug!("Accepted local connection from {}", peer_addr);

                        let session = session_clone.clone();
                        let remote_host = config_clone.remote_host.clone();
                        let remote_port = config_clone.remote_port;
                        let id = id_clone.clone();

                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_local_forward_connection(
                                local_stream,
                                session,
                                &remote_host,
                                remote_port,
                            )
                            .await
                            {
                                log::error!("[{}] Local forward connection error: {}", id, e);
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("Failed to accept connection: {}", e);
                    }
                }
            }
        });

        Ok(PortForwardHandle {
            id: id.clone(),
            config: config.clone(),
            handle,
        })
    }

    async fn handle_local_forward_connection(
        local_stream: tokio::net::TcpStream,
        session: Session,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut channel = tokio::task::spawn_blocking({
            let session = session.clone();
            let remote_host = remote_host.to_string();
            move || {
                session
                    .channel_direct_tcpip(&remote_host, remote_port, None)
                    .map_err(|e| format!("Failed to create channel: {}", e))
            }
        })
        .await??;

        let (mut local_read, mut local_write) = local_stream.into_split();

        let (tx_to_remote, mut rx_to_remote) = mpsc::channel::<Vec<u8>>(RELAY_CHANNEL_CAPACITY);
        let (tx_to_local, mut rx_to_local) = mpsc::channel::<Vec<u8>>(RELAY_CHANNEL_CAPACITY);

        let ssh_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];

            loop {
                let mut progressed = false;

                while let Ok(data) = rx_to_remote.try_recv() {
                    progressed = true;
                    if let Err(e) = channel.write_all(&data) {
                        log::debug!("SSH channel write error: {}", e);
                        return;
                    }
                    let _ = channel.flush();
                }

                match channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        progressed = true;
                        // blocking_send applies backpressure: if the local writer is
                        // behind, this parks the relay thread (which stops draining the
                        // SSH channel and closes the TCP window) rather than buffering
                        // unboundedly.
                        if tx_to_local.blocking_send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(e) if e.kind() == ErrorKind::TimedOut => {}
                    Err(_) => break,
                }

                if channel.eof() {
                    break;
                }

                // Only idle-sleep when neither direction moved data this pass; under
                // active load we loop immediately so the poll adds no latency.
                if !progressed {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }

            let _ = channel.close();
            let _ = channel.wait_close();
        });

        let local_to_remote = tokio::spawn(async move {
            let mut buf = [0u8; 32768];
            loop {
                match local_read.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_remote.send(buf[..n].to_vec()).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let remote_to_local = tokio::spawn(async move {
            while let Some(data) = rx_to_local.recv().await {
                if local_write.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        tokio::select! {
            _ = local_to_remote => {}
            _ = remote_to_local => {}
        }

        let _ = tokio::task::spawn_blocking(move || {
            let _ = ssh_thread.join();
        })
        .await;

        Ok(())
    }

    async fn setup_remote_port_forward(
        session: &mut SshSession,
        config: &PortForwardConfig,
        id: String,
    ) -> Result<PortForwardHandle, String> {
        let (listener, actual_port) = session
            .session
            .channel_forward_listen(config.remote_port, Some(&config.remote_host), None)
            .map_err(|e| format!("Failed to setup remote port forward: {}", e))?;

        let config_clone = config.clone();
        let id_clone = id.clone();

        let bound_port = if actual_port > 0 {
            actual_port
        } else {
            config.remote_port
        };
        if actual_port > 0 && actual_port != config.remote_port {
            log::info!(
                "Remote port forward bound to {} (requested {})",
                actual_port,
                config.remote_port
            );
        }

        let handle = tokio::spawn(async move {
            log::info!(
                "Remote port forward listening on {}:{} -> {}:{}",
                config_clone.remote_host,
                bound_port,
                config_clone.local_host,
                config_clone.local_port
            );

            let listener = std::sync::Arc::new(std::sync::Mutex::new(listener));

            loop {
                let channel = match tokio::task::spawn_blocking({
                    let listener = listener.clone();
                    move || {
                        let mut listener =
                            listener.lock().map_err(|e| format!("Lock error: {}", e))?;
                        listener
                            .accept()
                            .map_err(|e| format!("Accept error: {}", e))
                    }
                })
                .await
                {
                    Ok(Ok(channel)) => channel,
                    Ok(Err(e)) => {
                        log::debug!("[{}] Forward accept error: {}", id_clone, e);
                        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                        continue;
                    }
                    Err(e) => {
                        log::error!("[{}] Task error: {}", id_clone, e);
                        break Err(format!("Task join error: {}", e).into());
                    }
                };

                log::debug!("[{}] Accepted remote forward connection", id_clone);

                let local_host = config_clone.local_host.clone();
                let local_port = config_clone.local_port;
                let id = id_clone.clone();

                tokio::spawn(async move {
                    if let Err(e) =
                        Self::handle_remote_forward_connection(channel, &local_host, local_port)
                            .await
                    {
                        log::error!("[{}] Remote forward connection error: {}", id, e);
                    }
                });
            }
        });

        Ok(PortForwardHandle {
            id: id.clone(),
            config: config.clone(),
            handle,
        })
    }

    async fn handle_remote_forward_connection(
        mut channel: ssh2::Channel,
        local_host: &str,
        local_port: u16,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let local_stream = tokio::net::TcpStream::connect(format!("{}:{}", local_host, local_port))
            .await
            .map_err(|e| format!("Failed to connect to local target: {}", e))?;

        let (mut local_read, mut local_write) = local_stream.into_split();

        let (tx_to_local, mut rx_to_local) = mpsc::channel::<Vec<u8>>(RELAY_CHANNEL_CAPACITY);
        let (tx_to_remote, mut rx_to_remote) = mpsc::channel::<Vec<u8>>(RELAY_CHANNEL_CAPACITY);

        let ssh_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];

            loop {
                let mut progressed = false;

                while let Ok(data) = rx_to_remote.try_recv() {
                    progressed = true;
                    if let Err(e) = channel.write_all(&data) {
                        log::debug!("Remote forward SSH write error: {}", e);
                        return;
                    }
                    let _ = channel.flush();
                }

                match channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        progressed = true;
                        // blocking_send applies backpressure: if the local writer is
                        // behind, this parks the relay thread (which stops draining the
                        // SSH channel and closes the TCP window) rather than buffering
                        // unboundedly.
                        if tx_to_local.blocking_send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(e) if e.kind() == ErrorKind::TimedOut => {}
                    Err(_) => break,
                }

                if channel.eof() {
                    break;
                }

                // Only idle-sleep when neither direction moved data this pass; under
                // active load we loop immediately so the poll adds no latency.
                if !progressed {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }

            let _ = channel.close();
            let _ = channel.wait_close();
        });

        let local_to_remote = tokio::spawn(async move {
            let mut buf = [0u8; 32768];
            loop {
                match local_read.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_remote.send(buf[..n].to_vec()).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let remote_to_local = tokio::spawn(async move {
            while let Some(data) = rx_to_local.recv().await {
                if local_write.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        tokio::select! {
            _ = local_to_remote => {}
            _ = remote_to_local => {}
        }

        let _ = tokio::task::spawn_blocking(move || {
            let _ = ssh_thread.join();
        })
        .await;

        Ok(())
    }

    async fn setup_dynamic_port_forward(
        session: &mut SshSession,
        config: &PortForwardConfig,
        id: String,
    ) -> Result<PortForwardHandle, String> {
        let bind_host = Self::resolve_forward_bind(config)?;
        let listener = TcpListener::bind(format!("{}:{}", bind_host, config.local_port))
            .map_err(|e| format!("Failed to bind SOCKS port: {}", e))?;

        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Failed to set non-blocking: {}", e))?;

        let session_clone = session.session.clone();
        let config_clone = config.clone();
        let id_clone = id.clone();

        let handle = tokio::spawn(async move {
            let listener = tokio::net::TcpListener::from_std(listener).map_err(
                |e| -> Box<dyn std::error::Error + Send + Sync> {
                    format!("Failed to convert listener: {}", e).into()
                },
            )?;

            log::info!(
                "SOCKS5 proxy started on {}:{}",
                config_clone.local_host,
                config_clone.local_port
            );

            loop {
                match listener.accept().await {
                    Ok((client_stream, peer_addr)) => {
                        log::debug!("[{}] SOCKS5 client connected from {}", id_clone, peer_addr);

                        let session = session_clone.clone();
                        let id = id_clone.clone();

                        tokio::spawn(async move {
                            if let Err(e) =
                                Self::handle_socks5_connection(client_stream, session).await
                            {
                                log::debug!("[{}] SOCKS5 connection error: {}", id, e);
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("SOCKS5 accept error: {}", e);
                    }
                }
            }
        });

        Ok(PortForwardHandle {
            id: id.clone(),
            config: config.clone(),
            handle,
        })
    }

    async fn handle_socks5_connection(
        mut client_stream: tokio::net::TcpStream,
        session: Session,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut buf = [0u8; 258];
        let n = client_stream.read(&mut buf).await?;

        if n < 2 || buf[0] != 0x05 {
            return Err("Invalid SOCKS version".into());
        }

        let n_methods = buf[1] as usize;
        if n < 2 + n_methods {
            return Err("Invalid SOCKS auth methods".into());
        }

        let methods = &buf[2..2 + n_methods];
        if !methods.contains(&0x00) {
            client_stream.write_all(&[0x05, 0xFF]).await?;
            return Err("No acceptable auth method".into());
        }

        client_stream.write_all(&[0x05, 0x00]).await?;

        let n = client_stream.read(&mut buf).await?;
        if n < 4 {
            return Err("Invalid SOCKS request".into());
        }

        if buf[0] != 0x05 {
            return Err("Invalid SOCKS version in request".into());
        }

        let cmd = buf[1];
        let atype = buf[3];

        if cmd != 0x01 {
            client_stream
                .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            return Err(format!("Unsupported SOCKS command: {}", cmd).into());
        }

        let (target_host, target_port, _addr_end) = match atype {
            0x01 => {
                if n < 10 {
                    return Err("Invalid IPv4 address length".into());
                }
                let addr = format!("{}.{}.{}.{}", buf[4], buf[5], buf[6], buf[7]);
                let port = u16::from_be_bytes([buf[8], buf[9]]);
                (addr, port, 10)
            }
            0x03 => {
                let domain_len = buf[4] as usize;
                if n < 5 + domain_len + 2 {
                    return Err("Invalid domain name length".into());
                }
                let domain = String::from_utf8_lossy(&buf[5..5 + domain_len]).to_string();
                let port = u16::from_be_bytes([buf[5 + domain_len], buf[6 + domain_len]]);
                (domain, port, 7 + domain_len)
            }
            0x04 => {
                if n < 22 {
                    return Err("Invalid IPv6 address length".into());
                }
                let addr = format!(
                    "{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}",
                    u16::from_be_bytes([buf[4], buf[5]]),
                    u16::from_be_bytes([buf[6], buf[7]]),
                    u16::from_be_bytes([buf[8], buf[9]]),
                    u16::from_be_bytes([buf[10], buf[11]]),
                    u16::from_be_bytes([buf[12], buf[13]]),
                    u16::from_be_bytes([buf[14], buf[15]]),
                    u16::from_be_bytes([buf[16], buf[17]]),
                    u16::from_be_bytes([buf[18], buf[19]])
                );
                let port = u16::from_be_bytes([buf[20], buf[21]]);
                (addr, port, 22)
            }
            _ => {
                client_stream
                    .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                    .await?;
                return Err(format!("Unsupported address type: {}", atype).into());
            }
        };

        log::debug!("SOCKS5 CONNECT to {}:{}", target_host, target_port);

        let channel = match tokio::task::spawn_blocking({
            let session = session.clone();
            let host = target_host.clone();
            move || session.channel_direct_tcpip(&host, target_port, None)
        })
        .await?
        {
            Ok(ch) => ch,
            Err(e) => {
                client_stream
                    .write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                    .await?;
                return Err(format!("Failed to connect via SSH: {}", e).into());
            }
        };

        let response = [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        client_stream.write_all(&response).await?;

        Self::forward_socks5_traffic(client_stream, channel).await
    }

    async fn forward_socks5_traffic(
        client_stream: tokio::net::TcpStream,
        mut channel: ssh2::Channel,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let (mut client_read, mut client_write) = client_stream.into_split();

        let (tx_to_client, mut rx_to_client) = mpsc::channel::<Vec<u8>>(RELAY_CHANNEL_CAPACITY);
        let (tx_to_remote, mut rx_to_remote) = mpsc::channel::<Vec<u8>>(RELAY_CHANNEL_CAPACITY);

        let ssh_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];

            loop {
                let mut progressed = false;

                while let Ok(data) = rx_to_remote.try_recv() {
                    progressed = true;
                    if let Err(e) = channel.write_all(&data) {
                        log::debug!("SOCKS5 SSH write error: {}", e);
                        return;
                    }
                    let _ = channel.flush();
                }

                match channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        progressed = true;
                        // blocking_send applies backpressure: if the client writer is
                        // behind, this parks the relay thread (which stops draining the
                        // SSH channel and closes the TCP window) rather than buffering
                        // unboundedly.
                        if tx_to_client.blocking_send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(e) if e.kind() == ErrorKind::TimedOut => {}
                    Err(_) => break,
                }

                if channel.eof() {
                    break;
                }

                // Only idle-sleep when neither direction moved data this pass; under
                // active load we loop immediately so the poll adds no latency.
                if !progressed {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }

            let _ = channel.close();
            let _ = channel.wait_close();
        });

        let client_to_remote = tokio::spawn(async move {
            let mut buf = [0u8; 32768];
            loop {
                match client_read.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_remote.send(buf[..n].to_vec()).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let remote_to_client = tokio::spawn(async move {
            while let Some(data) = rx_to_client.recv().await {
                if client_write.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        tokio::select! {
            _ = client_to_remote => {}
            _ = remote_to_client => {}
        }

        let _ = tokio::task::spawn_blocking(move || {
            let _ = ssh_thread.join();
        })
        .await;

        Ok(())
    }

    pub async fn list_directory(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<SftpDirEntry>, String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let sftp = session
            .session
            .sftp()
            .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

        let entries = sftp
            .readdir(Path::new(path))
            .map_err(|e| format!("Failed to read directory: {}", e))?;

        Ok(entries
            .into_iter()
            .map(|(path, stat)| SftpDirEntry {
                path: path.to_string_lossy().to_string(),
                file_type: if stat.is_dir() { "directory" } else { "file" }.to_string(),
                size: stat.size.unwrap_or(0),
                modified: stat.mtime.unwrap_or(0),
            })
            .collect())
    }

    pub async fn upload_file(
        &mut self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let sftp = session
            .session
            .sftp()
            .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

        let mut local_file = std::fs::File::open(local_path)
            .map_err(|e| format!("Failed to open local file: {}", e))?;

        let mut remote_file = sftp
            .create(Path::new(remote_path))
            .map_err(|e| format!("Failed to create remote file: {}", e))?;

        std::io::copy(&mut local_file, &mut remote_file)
            .map_err(|e| format!("Failed to copy file: {}", e))?;

        Ok(())
    }

    pub async fn download_file(
        &mut self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let sftp = session
            .session
            .sftp()
            .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

        let mut remote_file = sftp
            .open(Path::new(remote_path))
            .map_err(|e| format!("Failed to open remote file: {}", e))?;

        let mut local_file = std::fs::File::create(local_path)
            .map_err(|e| format!("Failed to create local file: {}", e))?;

        std::io::copy(&mut remote_file, &mut local_file)
            .map_err(|e| format!("Failed to copy file: {}", e))?;

        Ok(())
    }

    pub async fn get_session_info(&self, session_id: &str) -> Result<SshSessionInfo, String> {
        let session = self.sessions.get(session_id).ok_or("Session not found")?;

        Ok(SshSessionInfo {
            id: session.id.clone(),
            config: session.config.clone(),
            connected_at: session.connected_at,
            last_activity: session.last_activity,
            is_alive: self.is_session_alive(session_id),
        })
    }

    pub async fn list_sessions(&self) -> Vec<SshSessionInfo> {
        self.sessions
            .values()
            .map(|session| SshSessionInfo {
                id: session.id.clone(),
                config: session.config.clone(),
                connected_at: session.connected_at,
                last_activity: session.last_activity,
                is_alive: self.is_session_alive(&session.id),
            })
            .collect()
    }

    // ── Mixed-chain helpers exposed to commands layer ───────────────────

    /// Validate a mixed chain config and return per-hop info.
    pub fn validate_mixed_chain(chain: &MixedChainConfig) -> Result<MixedChainStatus, String> {
        if chain.hops.is_empty() {
            return Err("Mixed chain has no hops".to_string());
        }

        let mut ssh_jump_count = 0usize;
        let mut proxy_count = 0usize;
        let mut hops = Vec::with_capacity(chain.hops.len());

        for (i, hop) in chain.hops.iter().enumerate() {
            let (hop_type, host, port) = match hop {
                ChainHop::SshJump(j) => {
                    ssh_jump_count += 1;
                    ("ssh_jump".to_string(), j.host.clone(), j.port)
                }
                ChainHop::Proxy(p) => {
                    proxy_count += 1;
                    (
                        format!("{:?}", p.proxy_type).to_lowercase(),
                        p.host.clone(),
                        p.port,
                    )
                }
            };
            hops.push(ChainHopInfo {
                index: i,
                label: hop.label(),
                hop_type,
                host,
                port,
            });
        }

        Ok(MixedChainStatus {
            total_hops: chain.hops.len(),
            ssh_jump_count,
            proxy_count,
            hops,
        })
    }

    /// Build a MixedChainConfig from the legacy `jump_hosts` field.
    pub fn jump_hosts_to_mixed_chain(jump_hosts: &[JumpHostConfig]) -> MixedChainConfig {
        MixedChainConfig {
            hops: jump_hosts.iter().cloned().map(ChainHop::SshJump).collect(),
            hop_timeout_ms: 10000,
        }
    }

    /// Build a MixedChainConfig from the legacy `proxy_chain` field.
    pub fn proxy_chain_to_mixed_chain(proxy_chain: &ProxyChainConfig) -> MixedChainConfig {
        MixedChainConfig {
            hops: proxy_chain
                .proxies
                .iter()
                .cloned()
                .map(ChainHop::Proxy)
                .collect(),
            hop_timeout_ms: proxy_chain.hop_timeout_ms,
        }
    }

    // Advanced SSH features

    /// Execute a script on the remote server by writing it to a temp file,
    /// making it executable, running it, capturing stdout/stderr/exit-code,
    /// and cleaning up.
    pub async fn execute_script(
        &mut self,
        session_id: &str,
        script: &str,
        interpreter: Option<&str>,
    ) -> Result<super::types::ScriptExecutionResult, String> {
        use std::io::Write;
        use uuid::Uuid;

        let interpreter = interpreter.unwrap_or("bash");
        let script_id = Uuid::new_v4().to_string().replace('-', "");
        // Use /tmp with a recognisable prefix so admins can identify stale files
        let remote_path = format!("/tmp/.sorng_script_{}", &script_id[..16]);

        if !self.sessions.contains_key(session_id) {
            return Err("Session not found".to_string());
        }

        let shell_pause = self.pause_shell_io(session_id);

        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = chrono::Utc::now();

        let was_blocking = session.session.is_blocking();
        if !was_blocking {
            session.session.set_blocking(true);
        }

        let result = (|| -> Result<super::types::ScriptExecutionResult, String> {
            // ── 1. Write the script to a temp file via SCP ──────────────
            let full_script = prepare_uploaded_script(script, interpreter);
            let script_bytes = full_script.as_bytes();

            let mut channel = session
                .session
                .scp_send(
                    std::path::Path::new(&remote_path),
                    0o700,
                    script_bytes.len() as u64,
                    None,
                )
                .map_err(|e| format!("Failed to open SCP channel for script upload: {}", e))?;

            channel
                .write_all(script_bytes)
                .map_err(|e| format!("Failed to write script to remote: {}", e))?;

            channel
                .send_eof()
                .map_err(|e| format!("SCP send_eof: {}", e))?;
            channel
                .wait_eof()
                .map_err(|e| format!("SCP wait_eof: {}", e))?;
            channel.close().map_err(|e| format!("SCP close: {}", e))?;
            channel
                .wait_close()
                .map_err(|e| format!("SCP wait_close: {}", e))?;

            // ── 2. Execute the script file ──────────────────────────────
            //   Run it and capture exit code separately so we always get
            //   the real exit code even if the script outputs nothing.
            let exec_command = wrap_script_invocation_with_exit_sentinel(&build_script_invocation(
                &remote_path,
                interpreter,
            ));

            let execution_result = (|| -> Result<_, String> {
                let mut exec_ch = session
                    .session
                    .channel_session()
                    .map_err(|e| format!("Failed to create exec channel: {}", e))?;
                let deadline = Instant::now() + SCRIPT_EXECUTION_TIMEOUT;

                session
                    .session
                    .set_timeout(SCRIPT_EXECUTION_TIMEOUT.as_millis() as u32);
                exec_ch
                    .exec(&exec_command)
                    .map_err(|e| format!("Failed to execute script: {}", e))?;
                let _ = exec_ch.send_eof();

                // A blocking read of stdout before stderr can deadlock when the
                // remote process fills its stderr window. Drain both SSH
                // streams concurrently in nonblocking mode under one atomic
                // byte budget instead.
                session.session.set_blocking(false);
                let cancellation = Arc::new(AtomicBool::new(false));
                let output_result = read_script_output_bounded(
                    exec_ch.stream(0),
                    exec_ch.stderr(),
                    SCRIPT_OUTPUT_LIMIT_BYTES,
                    deadline,
                    cancellation,
                );
                session.session.set_blocking(true);

                if output_result.is_err() || Instant::now() >= deadline {
                    session
                        .session
                        .set_timeout(SCRIPT_CHANNEL_CLEANUP_TIMEOUT_MS);
                    let _ = exec_ch.close();
                    let _ = exec_ch.wait_close();
                } else {
                    let remaining_ms = deadline
                        .saturating_duration_since(Instant::now())
                        .as_millis()
                        .clamp(1, u32::MAX as u128) as u32;
                    session.session.set_timeout(remaining_ms);
                    if exec_ch.wait_close().is_err() {
                        let _ = exec_ch.close();
                        session
                            .session
                            .set_timeout(SCRIPT_CHANNEL_CLEANUP_TIMEOUT_MS);
                        let _ = exec_ch.wait_close();
                    }
                }

                let raw_exit = exec_ch.exit_status().unwrap_or(-1);
                let (stdout_buf, stderr_buf) =
                    output_result.map_err(|error| error.user_message().to_string())?;
                let raw_stdout = String::from_utf8_lossy(&stdout_buf).to_string();
                let stderr = String::from_utf8_lossy(&stderr_buf).to_string();

                // Parse the sentinel to extract the real exit code and clean stdout
                let (stdout, exit_code) = parse_script_stdout_and_exit(&raw_stdout, raw_exit);

                Ok(super::types::ScriptExecutionResult {
                    stdout,
                    stderr,
                    exit_code,
                    remote_path: remote_path.clone(),
                })
            })();

            // ── 3. Clean up the temp file, including failure paths ──────
            session
                .session
                .set_timeout(SCRIPT_CHANNEL_CLEANUP_TIMEOUT_MS);
            if let Ok(mut rm_ch) = session.session.channel_session() {
                let rm_cmd = format!("rm -f {}", shell_escape::escape(remote_path.clone().into()));
                let _ = rm_ch.exec(&rm_cmd);
                let _ = rm_ch.send_eof();
                let _ = rm_ch.close();
                let _ = rm_ch.wait_close();
            }

            execution_result
        })();

        // Restore previous session state
        if !was_blocking {
            session.session.set_blocking(false);
        }
        session.session.set_timeout(0);
        Self::resume_shell_io(shell_pause);

        result
    }

    pub async fn transfer_file_scp(
        &mut self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        direction: TransferDirection,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        match direction {
            TransferDirection::Upload => {
                let _scp_command = format!("scp -t {}", remote_path);
                let file_size = std::fs::metadata(local_path)
                    .map_err(|e| format!("Failed to get file metadata: {}", e))?
                    .len() as u64;
                let mut channel = session
                    .session
                    .scp_send(Path::new(remote_path), 0o644, file_size, None)
                    .map_err(|e| format!("Failed to initiate SCP upload: {}", e))?;

                let content = std::fs::read(local_path)
                    .map_err(|e| format!("Failed to read local file: {}", e))?;

                channel
                    .write_all(&content)
                    .map_err(|e| format!("Failed to write file content: {}", e))?;

                channel
                    .send_eof()
                    .map_err(|e| format!("Failed to send EOF: {}", e))?;

                channel
                    .wait_eof()
                    .map_err(|e| format!("Failed to wait for EOF: {}", e))?;

                channel
                    .close()
                    .map_err(|e| format!("Failed to close channel: {}", e))?;

                channel
                    .wait_close()
                    .map_err(|e| format!("Failed to wait for close: {}", e))?;
            }
            TransferDirection::Download => {
                let (mut channel, stat) = session
                    .session
                    .scp_recv(Path::new(remote_path))
                    .map_err(|e| format!("Failed to initiate SCP download: {}", e))?;

                let file_size = stat.size();
                let mut content = Vec::with_capacity(file_size as usize);

                std::io::copy(&mut channel, &mut content)
                    .map_err(|e| format!("Failed to read file content: {}", e))?;

                std::fs::write(local_path, content)
                    .map_err(|e| format!("Failed to write local file: {}", e))?;
            }
        }

        Ok(())
    }

    pub async fn monitor_process(
        &mut self,
        session_id: &str,
        process_name: &str,
    ) -> Result<Vec<ProcessInfo>, String> {
        let command = format!(
            "ps aux | grep {} | grep -v grep",
            shell_escape::escape(process_name.into())
        );
        let output = self.execute_command(session_id, command, None).await?;

        let mut processes = Vec::new();
        for line in output.lines().skip(1) {
            if let Ok(process) = self.parse_process_line(line) {
                processes.push(process);
            }
        }

        Ok(processes)
    }

    fn parse_process_line(&self, line: &str) -> Result<ProcessInfo, String> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 11 {
            return Err("Invalid process line format".to_string());
        }

        Ok(ProcessInfo {
            user: parts[0].to_string(),
            pid: parts[1].parse().map_err(|_| "Invalid PID")?,
            cpu_percent: parts[2].parse().unwrap_or(0.0),
            mem_percent: parts[3].parse().unwrap_or(0.0),
            command: parts[10..].join(" "),
        })
    }

    pub async fn get_system_info(&mut self, session_id: &str) -> Result<SystemInfo, String> {
        let uname_output = self
            .execute_command(session_id, "uname -a".to_string(), None)
            .await?;
        let cpu_info = self
            .execute_command(session_id, "cat /proc/cpuinfo | head -5".to_string(), None)
            .await?;
        let mem_info = self
            .execute_command(session_id, "free -h".to_string(), None)
            .await?;
        let disk_info = self
            .execute_command(session_id, "df -h".to_string(), None)
            .await?;

        Ok(SystemInfo {
            uname: uname_output.trim().to_string(),
            cpu_info: cpu_info.trim().to_string(),
            memory_info: mem_info.trim().to_string(),
            disk_info: disk_info.trim().to_string(),
        })
    }

    // ===============================
    // Compression Support
    // ===============================

    /// Apply the full compression configuration to an `ssh2::Session` before
    /// handshake.  This sets `set_compress`, negotiates algorithms via
    /// `MethodType::CompCs` / `CompSc`, and validates the compression level.
    fn apply_compression_config(
        &self,
        sess: &mut Session,
        config: &SshConnectionConfig,
    ) -> Result<(), String> {
        let comp = &config.compression_config;

        // If the new config is explicitly disabled and the legacy flag is also off, bail out.
        if !comp.enabled && !config.compression {
            // Make sure no compression algorithm is offered except "none".
            sess.method_pref(MethodType::CompCs, "none")
                .map_err(|e| format!("Failed to disable C→S compression: {e}"))?;
            sess.method_pref(MethodType::CompSc, "none")
                .map_err(|e| format!("Failed to disable S→C compression: {e}"))?;
            return Ok(());
        }

        // Enable the underlying libssh2 compression flag.
        sess.set_compress(true);

        // Determine per-direction algorithm preference strings.
        let cs_pref = comp
            .client_to_server
            .as_ref()
            .map(|d| d.algorithm.to_method_pref().to_string())
            .unwrap_or_else(|| comp.algorithm.to_method_pref().to_string());

        let sc_pref = comp
            .server_to_client
            .as_ref()
            .map(|d| d.algorithm.to_method_pref().to_string())
            .unwrap_or_else(|| comp.algorithm.to_method_pref().to_string());

        sess.method_pref(MethodType::CompCs, &cs_pref)
            .map_err(|e| format!("Failed to set C→S compression algorithm preference: {e}"))?;
        sess.method_pref(MethodType::CompSc, &sc_pref)
            .map_err(|e| format!("Failed to set S→C compression algorithm preference: {e}"))?;

        Ok(())
    }

    /// After handshake, inspect negotiated compression methods and populate the
    /// initial compression stats on the session.
    fn populate_compression_stats(session: &mut SshSession) {
        let comp = &session.config.compression_config;
        if !comp.enabled && !session.config.compression {
            return;
        }

        let cs_algo = session
            .session
            .methods(MethodType::CompCs)
            .map(|s| s.to_string())
            .unwrap_or_else(|| "none".to_string());
        let sc_algo = session
            .session
            .methods(MethodType::CompSc)
            .map(|s| s.to_string())
            .unwrap_or_else(|| "none".to_string());

        let active = cs_algo != "none" || sc_algo != "none";

        session.compression_stats = SshCompressionStats {
            negotiated_cs_algorithm: cs_algo,
            negotiated_sc_algorithm: sc_algo,
            compression_active: active,
            ..Default::default()
        };
    }

    /// Retrieve compression information for a live session.
    pub fn get_compression_info(&self, session_id: &str) -> Result<SshCompressionInfo, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;

        Ok(SshCompressionInfo {
            session_id: session_id.to_string(),
            config: session.config.compression_config.clone(),
            stats: session.compression_stats.clone(),
            negotiated_cs_algorithm: session.compression_stats.negotiated_cs_algorithm.clone(),
            negotiated_sc_algorithm: session.compression_stats.negotiated_sc_algorithm.clone(),
        })
    }

    /// Update the compression config stored on a live session.
    ///
    /// Note: SSH compression algorithms are negotiated at handshake time and
    /// cannot be changed mid-session at the transport level.  This method
    /// updates the stored config for informational / UI purposes and adjusts
    /// adaptive-compression parameters that do not require re-negotiation.
    pub fn update_compression_config(
        &mut self,
        session_id: &str,
        new_config: SshCompressionConfig,
    ) -> Result<SshCompressionInfo, String> {
        let current = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;

        if !current.config.compression_config.allow_runtime_update {
            return Err("Runtime compression updates are not allowed for this session".to_string());
        }

        let mut next_config = current.config.clone();
        // Update only the mutable parts (adaptive settings, tracking, etc.)
        next_config.compression_config.adaptive = new_config.adaptive;
        next_config.compression_config.track_statistics = new_config.track_statistics;
        next_config.compression_config.compress_sftp = new_config.compress_sftp;

        let retained_bytes =
            retained_ssh_config_bytes(&next_config).map_err(|error| error.to_string())?;
        let limit = self.connection_admission.limits.max_config_bytes;
        if retained_bytes > limit {
            return Err(SshConnectionAdmissionError::ConfigTooLarge {
                bytes: retained_bytes,
                limit,
            }
            .to_string());
        }

        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        session.config = next_config;

        Ok(SshCompressionInfo {
            session_id: session_id.to_string(),
            config: session.config.compression_config.clone(),
            stats: session.compression_stats.clone(),
            negotiated_cs_algorithm: session.compression_stats.negotiated_cs_algorithm.clone(),
            negotiated_sc_algorithm: session.compression_stats.negotiated_sc_algorithm.clone(),
        })
    }

    /// Reset the compression statistics counters for a session.
    pub fn reset_compression_stats(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;

        let old = &session.compression_stats;
        session.compression_stats = SshCompressionStats {
            negotiated_cs_algorithm: old.negotiated_cs_algorithm.clone(),
            negotiated_sc_algorithm: old.negotiated_sc_algorithm.clone(),
            compression_active: old.compression_active,
            ..Default::default()
        };
        Ok(())
    }

    /// Return a list of compression algorithms supported by the linked libssh2.
    pub fn list_supported_compression_algorithms() -> Vec<String> {
        vec![
            "none".to_string(),
            "zlib".to_string(),
            "zlib@openssh.com".to_string(),
        ]
    }

    /// Determine whether SFTP transfer data should be compressed based on the
    /// session's `SshCompressionConfig` and the file being transferred.
    pub fn should_compress_sftp_transfer(
        config: &SshCompressionConfig,
        file_name: Option<&str>,
    ) -> bool {
        if !config.enabled || !config.compress_sftp {
            return false;
        }

        // If adaptive compression is enabled, check against incompressible extensions.
        if config.adaptive.enabled {
            if let Some(name) = file_name {
                let lower = name.to_lowercase();
                for ext in &config.adaptive.incompressible_extensions {
                    if lower.ends_with(&format!(".{ext}")) {
                        return false;
                    }
                }
            }
        }

        true
    }

    /// Check whether a payload of the given size should be compressed based on
    /// the adaptive compression settings.
    pub fn should_compress_payload(config: &SshCompressionConfig, payload_size: u64) -> bool {
        if !config.enabled {
            return false;
        }
        if !config.adaptive.enabled {
            return true; // always compress when adaptive is off
        }
        payload_size >= config.adaptive.min_payload_bytes
    }
}

/// App-layer disconnect entry point. The shared service mutex is held only
/// long enough to detach the session's resources and create a cleanup plan;
/// all cancellation, native drops, completion waits, and joins run afterward.
#[doc(hidden)]
pub async fn disconnect_ssh_on_state(
    state: &SshServiceState,
    session_id: &str,
) -> Result<(), String> {
    disconnect_ssh_on_state_with_timeout(state, session_id, SHELL_STOP_TIMEOUT).await
}

async fn disconnect_ssh_on_state_with_timeout(
    state: &SshServiceState,
    session_id: &str,
    timeout: Duration,
) -> Result<(), String> {
    let plan = {
        let mut service = state.lock().await;
        service.detach_disconnect(session_id)?
    };
    plan.execute(timeout).await
}

/// App-layer connection entry point that keeps connection establishment
/// cancellable without holding the shared service lock.
///
/// This must remain public because the Tauri app compiles its command wrapper
/// in a separate crate and reaches this function through a public re-export.
#[doc(hidden)]
pub async fn connect_ssh_on_state(
    state: &SshServiceState,
    config: SshConnectionConfig,
) -> Result<String, String> {
    connect_ssh_on_state_with(state, config, establish_ssh_in_blocking_worker).await
}

/// Test an SSH path under the same process-wide admission and blocking-worker
/// contract as a retained connection, without holding the shared service lock.
pub async fn test_ssh_connection_on_state(
    state: &SshServiceState,
    config: SshConnectionConfig,
) -> Result<String, String> {
    let (connector, attempt) = {
        let service = state.lock().await;
        service.begin_connection_attempt(&config)?
    };
    run_admitted_ssh_connection_test(connector, attempt, config).await
}

async fn finish_timed_out_proxy_command_cleanup(
    session_id: String,
    admission_lease: Arc<SshSessionAdmissionLease>,
) {
    const CLEANUP_WAIT: Duration = Duration::from_millis(2_500);
    let deadline = tokio::time::Instant::now() + CLEANUP_WAIT;
    let cleanup_session_id = session_id.clone();
    let cleanup = tokio::task::spawn_blocking(move || {
        let _admission_lease = admission_lease;
        super::proxy_command::stop_proxy_command_and_wait(&cleanup_session_id)
    });
    let _ = tokio::time::timeout_at(deadline, cleanup).await;

    // The establishment worker may have won the cleanup race. In that case its
    // stop call owns the registry entry until native relay joins finish, so wait
    // for the same bounded cleanup instead of returning a typed timeout while a
    // visible helper entry is still retained.
    while tokio::time::Instant::now() < deadline {
        match super::proxy_command::get_proxy_command_status(&session_id) {
            Ok(None) | Err(_) => return,
            Ok(Some(_)) => tokio::time::sleep(Duration::from_millis(5)).await,
        }
    }
}

async fn run_admitted_ssh_connection_test(
    connector: SshService,
    mut attempt: SshConnectionAttempt,
    config: SshConnectionConfig,
) -> Result<String, String> {
    let session_id = attempt.session_id.clone();
    let cancellation = Arc::clone(&attempt.cancellation);
    let control = connector
        .establishment_control
        .as_ref()
        .cloned()
        .ok_or_else(|| "SSH connection test is missing establishment control".to_string())?;
    let worker_lease = attempt.take_worker_lease();
    let timeout_session_id = session_id.clone();
    let timeout_session_lease = Arc::clone(&attempt.session_lease);
    let runtime = tokio::runtime::Handle::current();
    let worker = tokio::task::spawn_blocking(move || {
        let mut worker_lease = worker_lease;
        let cleanup_key = worker_lease.cleanup_key.clone();
        let proxy_command_reservation = worker_lease._proxy_command_reservation.take();
        let result = runtime.block_on(connector.test_ssh_connection_inner(
            session_id,
            config,
            cleanup_key,
            proxy_command_reservation,
        ));
        drop(worker_lease);
        result
    });
    let result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err("SSH connection cancelled".to_string()),
        _ = tokio::time::sleep_until(tokio::time::Instant::from_std(control.deadline)) => {
            control.trigger(ESTABLISHMENT_TIMED_OUT);
            finish_timed_out_proxy_command_cleanup(
                timeout_session_id,
                timeout_session_lease,
            ).await;
            Err(control.timeout_error("overall", control.overall_timeout))
        },
        result = worker => result
            .map_err(|error| format!("SSH connection test worker failed: {error}"))?,
    };
    let (cancelled, session_lease) = attempt.finish();
    drop(session_lease);
    if cancelled {
        drop(result);
        return Err("SSH connection cancelled".to_string());
    }
    result
}

async fn establish_ssh_in_blocking_worker(
    mut connector: SshService,
    session_id: String,
    config: SshConnectionConfig,
    worker_lease: SshConnectionWorkerLease,
) -> Result<EstablishedSshConnection, String> {
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        // Both permits belong to the real native worker. Dropping the async
        // JoinHandle cannot release capacity while DNS, TCP, proxy, libssh2
        // handshake, host-key verification, or authentication is still alive.
        let mut worker_lease = worker_lease;
        let cleanup_key = worker_lease.cleanup_key.clone();
        let proxy_command_reservation = worker_lease._proxy_command_reservation.take();
        let result = runtime.block_on(connector.establish_ssh_connection(
            session_id,
            config,
            cleanup_key,
            proxy_command_reservation,
        ));
        drop(worker_lease);
        result
    })
    .await
    .map_err(|error| format!("SSH connection worker failed: {error}"))?
}

async fn connect_ssh_on_state_with<F, Fut>(
    state: &SshServiceState,
    config: SshConnectionConfig,
    establish: F,
) -> Result<String, String>
where
    F: FnOnce(SshService, String, SshConnectionConfig, SshConnectionWorkerLease) -> Fut,
    Fut: Future<Output = Result<EstablishedSshConnection, String>>,
{
    let (connector, mut attempt) = {
        let service = state.lock().await;
        service.begin_connection_attempt(&config)?
    };
    let session_id = attempt.session_id.clone();
    let cancellation = attempt.cancellation.clone();
    let control = connector
        .establishment_control
        .as_ref()
        .cloned()
        .ok_or_else(|| "SSH connection attempt is missing establishment control".to_string())?;
    let worker_lease = attempt.take_worker_lease();
    let timeout_session_id = session_id.clone();
    let timeout_session_lease = Arc::clone(&attempt.session_lease);

    let result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err("SSH connection cancelled".to_string()),
        _ = tokio::time::sleep_until(tokio::time::Instant::from_std(control.deadline)) => {
            control.trigger(ESTABLISHMENT_TIMED_OUT);
            finish_timed_out_proxy_command_cleanup(
                timeout_session_id,
                timeout_session_lease,
            ).await;
            Err(control.timeout_error("overall", control.overall_timeout))
        },
        result = establish(connector, session_id, config, worker_lease) => result,
    };

    // Keep the attempt registered until the service lock is reacquired. This
    // makes adoption atomic with a concurrent disconnect of the provisional id.
    let mut service = state.lock().await;
    let (cancelled, session_lease) = attempt.finish();
    if cancelled {
        drop(result);
        return Err("SSH connection cancelled".to_string());
    }

    service.adopt_connection(result?, session_lease)
}

#[cfg(test)]
mod connection_admission_tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Condvar, Mutex};
    use tokio::net::TcpListener as TokioTcpListener;

    #[derive(Default)]
    struct BlockingGate {
        open: Mutex<bool>,
        changed: Condvar,
    }

    impl BlockingGate {
        fn wait(&self) {
            let mut open = self.open.lock().expect("gate mutex poisoned");
            while !*open {
                open = self.changed.wait(open).expect("gate mutex poisoned");
            }
        }

        fn open(&self) {
            *self.open.lock().expect("gate mutex poisoned") = true;
            self.changed.notify_all();
        }
    }

    fn config() -> SshConnectionConfig {
        serde_json::from_value(json!({
            "host": "127.0.0.1",
            "port": 22,
            "username": "admission-test",
            "password": null,
            "private_key_path": null,
            "private_key_passphrase": null,
            "jump_hosts": [],
            "proxy_config": null,
            "proxy_chain": null,
            "mixed_chain": null,
            "openvpn_config": null,
            "connect_timeout": 1,
            "keep_alive_interval": 30,
            "strict_host_key_checking": false,
            "known_hosts_path": null,
            "totp_secret": null,
            "keyboard_interactive_responses": []
        }))
        .expect("valid SSH admission test config")
    }

    fn limits(max_sessions: usize, max_handshakes: usize) -> SshConnectionAdmissionLimits {
        SshConnectionAdmissionLimits {
            max_sessions,
            max_handshakes,
            max_config_bytes: MAX_SSH_RETAINED_CONFIG_BYTES,
            config_budget_bytes: max_sessions * MAX_SSH_RETAINED_CONFIG_BYTES,
        }
    }

    async fn await_proxy_disconnect_cleanup(
        handle: tokio::task::JoinHandle<Result<(), String>>,
        stage: &str,
    ) {
        tokio::time::timeout(Duration::from_secs(3), handle)
            .await
            .unwrap_or_else(|_| panic!("{stage} ProxyCommand cleanup timed out"))
            .unwrap_or_else(|error| panic!("{stage} ProxyCommand cleanup task failed: {error}"))
            .unwrap_or_else(|error| panic!("{stage} ProxyCommand cleanup failed: {error}"));
    }

    #[test]
    fn timeout_contract_is_clamped_typed_and_secret_free() {
        assert_eq!(
            clamped_ssh_establishment_timeout(None),
            DEFAULT_SSH_ESTABLISHMENT_TIMEOUT
        );
        assert_eq!(
            clamped_ssh_establishment_timeout(Some(0)),
            MIN_SSH_ESTABLISHMENT_TIMEOUT
        );
        assert_eq!(
            clamped_ssh_establishment_timeout(Some(u64::MAX)),
            MAX_SSH_ESTABLISHMENT_TIMEOUT
        );
        assert_eq!(clamped_ssh_hop_timeout(0), MIN_SSH_HOP_TIMEOUT);
        assert_eq!(clamped_ssh_hop_timeout(u64::MAX), MAX_SSH_HOP_TIMEOUT);

        let error = SshConnectionTimeoutError::Phase {
            phase: "final-ssh-authentication".to_string(),
            timeout_ms: 1_250,
        }
        .to_string();
        assert_eq!(
            error,
            "SSH_CONNECTION_TIMEOUT: SSH establishment phase 'final-ssh-authentication' exceeded its 1250 ms deadline"
        );
        let contextual = contextualize_ssh_connection_error("Chain hop 2 failed", error.clone());
        assert!(contextual.starts_with(SSH_CONNECTION_TIMEOUT_ERROR_CODE));
        assert!(contextual.contains("Chain hop 2 failed"));
        assert!(contextual.contains("final-ssh-authentication"));
        for sensitive in ["secret-password", "private-user", "sensitive.example"] {
            assert!(!error.contains(sensitive));
            assert!(!contextual.contains(sensitive));
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn four_stalled_resolvers_block_a_fifth_spawn_and_recover_accounting() {
        let local_admission = Arc::new(Semaphore::new(MAX_CONCURRENT_SSH_LOCAL_PHASES));
        let admission = SshConnectionAdmission::new(limits(8, 1));
        let gate = Arc::new(BlockingGate::default());
        let entered = Arc::new(AtomicUsize::new(0));
        let mut workers = Vec::new();

        for _ in 0..MAX_CONCURRENT_SSH_LOCAL_PHASES {
            let control = SshEstablishmentControl::new_with_timeout(
                Duration::from_secs(5),
                Arc::new(PendingSshConnection::new()),
            )
            .unwrap();
            let session_lease = admission.reserve_session(&config()).unwrap();
            let worker_gate = Arc::clone(&gate);
            let worker_entered = Arc::clone(&entered);
            let worker_admission = Arc::clone(&local_admission);
            workers.push(tokio::spawn(async move {
                let result = control
                    .run_isolated_local_phase_with_admission(
                        "dns-resolution",
                        Duration::from_secs(5),
                        Some(session_lease),
                        worker_admission,
                        move |context| {
                            context.ensure_active()?;
                            worker_entered.fetch_add(1, Ordering::AcqRel);
                            worker_gate.wait();
                            context.ensure_active()
                        },
                    )
                    .await;
                if result.is_ok() {
                    control.complete().unwrap();
                }
                result
            }));
        }

        tokio::time::timeout(Duration::from_secs(2), async {
            while entered.load(Ordering::Acquire) != MAX_CONCURRENT_SSH_LOCAL_PHASES {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("four injected resolver workers should enter the local lane");
        assert_eq!(
            admission.snapshot(),
            SshConnectionAdmissionSnapshot {
                active_or_pending: MAX_CONCURRENT_SSH_LOCAL_PHASES,
                active_handshakes: 0,
                retained_config_bytes: MAX_CONCURRENT_SSH_LOCAL_PHASES
                    * MAX_SSH_RETAINED_CONFIG_BYTES,
            }
        );

        let fifth_started = Arc::new(AtomicUsize::new(0));
        let fifth_started_worker = Arc::clone(&fifth_started);
        let fifth_control = SshEstablishmentControl::new_with_timeout(
            Duration::from_millis(50),
            Arc::new(PendingSshConnection::new()),
        )
        .unwrap();
        let fifth_error = fifth_control
            .run_isolated_local_phase_with_admission(
                "dns-resolution",
                Duration::from_millis(50),
                Some(admission.reserve_session(&config()).unwrap()),
                Arc::clone(&local_admission),
                move |_context| {
                    fifth_started_worker.fetch_add(1, Ordering::AcqRel);
                    Ok(())
                },
            )
            .await
            .unwrap_err();
        assert!(fifth_error.starts_with(SSH_CONNECTION_TIMEOUT_ERROR_CODE));
        assert_eq!(
            fifth_started.load(Ordering::Acquire),
            0,
            "the fifth resolver operation must not spawn without a local permit"
        );

        gate.open();
        for worker in workers {
            worker.await.unwrap().unwrap();
        }
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
    }

    #[test]
    fn detached_cleanup_executor_init_fails_closed_at_first_and_partial_worker() {
        let first = build_detached_ssh_cleanup_executor(|_, _| {
            Err(std::io::Error::other(
                "injected first cleanup worker failure",
            ))
        });
        assert!(matches!(first, Err(error) if error.contains("worker 0")));

        let partial = build_detached_ssh_cleanup_executor(|index, shared| {
            if index == 1 {
                Err(std::io::Error::other(
                    "injected partial cleanup worker failure",
                ))
            } else {
                std::thread::Builder::new()
                    .name("ssh-test-partial-cleanup".to_string())
                    .spawn(move || detached_ssh_cleanup_worker(shared))
            }
        });
        assert!(matches!(partial, Err(error) if error.contains("worker 1")));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn saturated_cleanup_queue_deduplicates_all_producer_side_requests() {
        let executor = Arc::new(
            build_detached_ssh_cleanup_executor(|index, shared| {
                std::thread::Builder::new()
                    .name(format!("ssh-test-saturated-cleanup-{index}"))
                    .spawn(move || detached_ssh_cleanup_worker(shared))
            })
            .expect("test cleanup executor should initialize"),
        );
        let admission = SshConnectionAdmission::new(limits(
            MAX_ACTIVE_OR_PENDING_SSH_SESSIONS,
            MAX_CONCURRENT_SSH_HANDSHAKES,
        ));
        let mut cleanup_keys = Vec::with_capacity(MAX_ACTIVE_OR_PENDING_SSH_SESSIONS);
        let mut producer_gates = Vec::with_capacity(MAX_ACTIVE_OR_PENDING_SSH_SESSIONS);
        let mut duplicate_leases = Vec::with_capacity(MAX_ACTIVE_OR_PENDING_SSH_SESSIONS);
        for _ in 0..MAX_ACTIVE_OR_PENDING_SSH_SESSIONS {
            let cleanup_key =
                PendingSshCleanupKey::new(&format!("saturated-dedup-{}", Uuid::new_v4()));
            let producer_released = Arc::new(AtomicBool::new(false));
            let cleanup_released = Arc::clone(&producer_released);
            let lease = admission.reserve_session(&config()).unwrap();
            duplicate_leases.push(Arc::clone(&lease));
            cleanup_keys.push(cleanup_key.clone());
            producer_gates.push(producer_released);
            let task_executor = Arc::clone(&executor);
            dispatch_deduplicated_pending_ssh_cleanup(
                &cleanup_key,
                Some(lease),
                move || {
                    while !cleanup_released.load(Ordering::Acquire) {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    Ok(())
                },
                move |slot| task_executor.enqueue(slot),
            );
        }
        {
            let state = executor
                .shared
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            assert_eq!(
                state.tasks.len() + state.in_flight,
                MAX_ACTIVE_OR_PENDING_SSH_SESSIONS
            );
        }
        assert_eq!(
            admission.snapshot().active_or_pending,
            MAX_ACTIVE_OR_PENDING_SSH_SESSIONS
        );
        assert!(cleanup_keys
            .iter()
            .all(|key| pending_ssh_artifact_cleanups_lock().contains(key)));

        let duplicate_enqueues = Arc::new(AtomicUsize::new(0));
        let enqueued_duplicates = Arc::clone(&duplicate_enqueues);
        let duplicate_executor = Arc::clone(&executor);
        let (duplicates_done, duplicates_finished) = std::sync::mpsc::channel();
        let duplicate_keys = cleanup_keys.clone();
        let duplicates = std::thread::spawn(move || {
            for (cleanup_key, lease) in duplicate_keys.iter().zip(duplicate_leases) {
                let executor = Arc::clone(&duplicate_executor);
                let enqueue_count = Arc::clone(&enqueued_duplicates);
                dispatch_deduplicated_pending_ssh_cleanup(
                    cleanup_key,
                    Some(lease),
                    || Ok(()),
                    move |slot| {
                        enqueue_count.fetch_add(1, Ordering::AcqRel);
                        executor.enqueue(slot)
                    },
                );
            }
            duplicates_done.send(()).unwrap();
        });

        let duplicates_returned_before_release = duplicates_finished
            .recv_timeout(Duration::from_secs(1))
            .is_ok();
        let duplicate_enqueue_count_before_release = duplicate_enqueues.load(Ordering::Acquire);
        let retained_before_release = admission.snapshot().active_or_pending;
        let executor_load_before_release = {
            let state = executor
                .shared
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.tasks.len() + state.in_flight
        };

        for gate in &producer_gates {
            gate.store(true, Ordering::Release);
        }
        duplicates
            .join()
            .expect("duplicate producer should not panic");

        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let drained = {
                    let state = executor
                        .shared
                        .state
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    state.tasks.is_empty() && state.in_flight == 0
                };
                if drained {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("test cleanup executor should drain");
        {
            let mut state = executor
                .shared
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.shutting_down = true;
        }
        executor.shared.changed.notify_all();
        let executor = match Arc::try_unwrap(executor) {
            Ok(executor) => executor,
            Err(_) => panic!("test cleanup executor should have one owner"),
        };
        for worker in executor._workers {
            worker.join().expect("test cleanup worker should stop");
        }

        assert!(
            duplicates_returned_before_release,
            "all duplicate producer-side requests must return while the queue is saturated"
        );
        assert_eq!(duplicate_enqueue_count_before_release, 0);
        assert_eq!(retained_before_release, MAX_ACTIVE_OR_PENDING_SSH_SESSIONS);
        assert_eq!(
            executor_load_before_release,
            MAX_ACTIVE_OR_PENDING_SSH_SESSIONS
        );
        assert_eq!(
            admission.snapshot(),
            SshConnectionAdmissionSnapshot::default()
        );
        assert!(cleanup_keys
            .iter()
            .all(|key| !pending_ssh_artifact_cleanups_lock().contains(key)));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn setup_guard_acknowledges_exact_proxy_generation_before_cleanup() {
        let session_id = format!("proxy-setup-guard-ack-{}", Uuid::new_v4());
        let cleanup_key = PendingSshCleanupKey::new(&session_id);
        let reservation =
            super::super::proxy_command::reserve_proxy_command_session(&session_id).unwrap();
        let guard = SshConnectionSetupGuard::new(cleanup_key.clone(), None, Some(reservation));

        drop(guard);
        assert!(
            !super::super::proxy_command::has_proxy_command_lifecycle_for_test(&session_id),
            "armed setup guard must acknowledge its exact reservation before dispatch"
        );
        tokio::time::timeout(Duration::from_secs(2), async {
            while pending_ssh_artifact_cleanups_lock().contains(&cleanup_key) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("setup-guard cleanup should drain its generation key");
    }

    #[test]
    fn deduplicated_cleanup_enqueue_failure_retries_and_clears_generation_key() {
        let admission = SshConnectionAdmission::new(limits(2, 1));
        let cleanup_key =
            PendingSshCleanupKey::new(&format!("dedup-enqueue-failure-{}", Uuid::new_v4()));
        let attempts = Arc::new(AtomicUsize::new(0));
        let cleanup_attempts = Arc::clone(&attempts);
        let mut panic_once = true;

        dispatch_deduplicated_pending_ssh_cleanup(
            &cleanup_key,
            Some(admission.reserve_session(&config()).unwrap()),
            move || {
                cleanup_attempts.fetch_add(1, Ordering::AcqRel);
                if panic_once {
                    panic_once = false;
                    panic!("injected deduplicated cleanup panic");
                }
                Ok(())
            },
            |_| Err("injected deduplicated cleanup enqueue failure".to_string()),
        );

        assert_eq!(attempts.load(Ordering::Acquire), 2);
        assert_eq!(
            admission.snapshot(),
            SshConnectionAdmissionSnapshot::default()
        );
        assert!(!pending_ssh_artifact_cleanups_lock().contains(&cleanup_key));
    }

    #[test]
    fn detached_cleanup_enqueue_failure_joins_bridge_and_releases_lease_once() {
        let admission = SshConnectionAdmission::new(limits(2, 1));
        let lease = admission.reserve_session(&config()).unwrap();
        let bridge_exits = Arc::new(AtomicUsize::new(0));
        let bridge_exited = Arc::clone(&bridge_exits);
        let bridge = std::thread::spawn(move || {
            bridge_exited.fetch_add(1, Ordering::AcqRel);
        });
        let cleanup_runs = Arc::new(AtomicUsize::new(0));
        let cleanup_ran = Arc::clone(&cleanup_runs);
        let mut bridge = Some(bridge);
        let mut lease = Some(lease);

        dispatch_detached_ssh_cleanup_with(
            move || {
                cleanup_ran.fetch_add(1, Ordering::AcqRel);
                if let Some(bridge) = bridge.take() {
                    let _ = bridge.join();
                }
                drop(lease.take());
                DetachedSshCleanupOutcome::Complete
            },
            |_| Err("injected cleanup worker spawn failure".to_string()),
        );

        assert_eq!(cleanup_runs.load(Ordering::Acquire), 1);
        assert_eq!(bridge_exits.load(Ordering::Acquire), 1);
        assert_eq!(
            admission.snapshot(),
            SshConnectionAdmissionSnapshot::default()
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn detached_cleanup_panic_retries_bridge_and_next_task_exactly_once() {
        detached_ssh_cleanup_executor().expect("cleanup executor should initialize");
        let admission = SshConnectionAdmission::new(limits(4, 1));
        let gate = Arc::new(BlockingGate::default());
        let bridge_gate = Arc::clone(&gate);
        let bridge_exits = Arc::new(AtomicUsize::new(0));
        let bridge_exited = Arc::clone(&bridge_exits);
        let bridge = std::thread::spawn(move || {
            bridge_gate.wait();
            bridge_exited.fetch_add(1, Ordering::AcqRel);
        });
        let mut bridge_handles = vec![bridge];
        let mut lease = Some(admission.reserve_session(&config()).unwrap());
        let mut panic_once = true;
        dispatch_detached_ssh_cleanup(move || {
            if panic_once {
                panic_once = false;
                panic!("injected detached SSH task panic after claim");
            }
            while let Some(handle) = bridge_handles.pop() {
                let _ = handle.join();
            }
            drop(lease.take());
            DetachedSshCleanupOutcome::Complete
        });
        assert_eq!(admission.snapshot().active_or_pending, 1);
        gate.open();
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
        assert_eq!(bridge_exits.load(Ordering::Acquire), 1);

        let next_runs = Arc::new(AtomicUsize::new(0));
        let next_ran = Arc::clone(&next_runs);
        dispatch_detached_ssh_cleanup(move || {
            next_ran.fetch_add(1, Ordering::AcqRel);
            DetachedSshCleanupOutcome::Complete
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while next_runs.load(Ordering::Acquire) != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("cleanup worker should continue after recovered panic");
        assert_eq!(next_runs.load(Ordering::Acquire), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn detached_cleanup_retry_requeues_fairly_before_later_complete_task() {
        detached_ssh_cleanup_executor().expect("cleanup executor should initialize");
        let retry_open = Arc::new(AtomicBool::new(false));
        let retry_gate = Arc::clone(&retry_open);
        let retry_attempts = Arc::new(AtomicUsize::new(0));
        let attempts = Arc::clone(&retry_attempts);
        let retry_returns = Arc::new(AtomicUsize::new(0));
        let retry_returned = Arc::clone(&retry_returns);
        let first_completions = Arc::new(AtomicUsize::new(0));
        let first_completed = Arc::clone(&first_completions);
        dispatch_detached_ssh_cleanup(move || {
            attempts.fetch_add(1, Ordering::AcqRel);
            if !retry_gate.load(Ordering::Acquire) {
                retry_returned.fetch_add(1, Ordering::AcqRel);
                return DetachedSshCleanupOutcome::Retry;
            }
            first_completed.fetch_add(1, Ordering::AcqRel);
            DetachedSshCleanupOutcome::Complete
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while retry_returns.load(Ordering::Acquire) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("retrying cleanup should make its first attempt");

        let second_completions = Arc::new(AtomicUsize::new(0));
        let second_completed = Arc::clone(&second_completions);
        dispatch_detached_ssh_cleanup(move || {
            second_completed.fetch_add(1, Ordering::AcqRel);
            DetachedSshCleanupOutcome::Complete
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while second_completions.load(Ordering::Acquire) != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("later cleanup must not be starved by a retrying task");
        assert_eq!(first_completions.load(Ordering::Acquire), 0);
        assert!(retry_attempts.load(Ordering::Acquire) >= 1);

        retry_open.store(true, Ordering::Release);
        tokio::time::timeout(Duration::from_secs(2), async {
            while first_completions.load(Ordering::Acquire) != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("retrying cleanup should complete after its gate opens");
        assert_eq!(first_completions.load(Ordering::Acquire), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn proxy_disconnect_dispatch_covers_absent_reserved_active_and_stopping() {
        let admission = SshConnectionAdmission::new(limits(4, 1));

        let absent_id = format!("proxy-dispatch-absent-{}", Uuid::new_v4());
        let absent = dispatch_proxy_command_disconnect_cleanup(
            absent_id,
            Some(admission.reserve_session(&config()).unwrap()),
        );
        assert!(absent.is_none(), "absent lifecycle must dispatch no worker");
        assert_eq!(
            admission.snapshot(),
            SshConnectionAdmissionSnapshot::default()
        );

        let reserved_id = format!("proxy-dispatch-reserved-{}", Uuid::new_v4());
        let reservation =
            super::super::proxy_command::reserve_proxy_command_session(&reserved_id).unwrap();
        let reserved = dispatch_proxy_command_disconnect_cleanup(
            reserved_id.clone(),
            Some(admission.reserve_session(&config()).unwrap()),
        )
        .expect("reserved lifecycle must dispatch cleanup");
        assert_eq!(admission.snapshot().active_or_pending, 1);
        drop(reservation);
        await_proxy_disconnect_cleanup(reserved, "reserved").await;
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;

        let active_id = format!("proxy-dispatch-active-{}", Uuid::new_v4());
        let (release_active, blocked_active) = std::sync::mpsc::channel();
        super::super::proxy_command::install_blocked_relay_for_accounting_test(
            &active_id,
            blocked_active,
        )
        .unwrap();
        let active = dispatch_proxy_command_disconnect_cleanup(
            active_id,
            Some(admission.reserve_session(&config()).unwrap()),
        )
        .expect("active lifecycle must dispatch cleanup");
        assert_eq!(admission.snapshot().active_or_pending, 1);
        release_active.send(()).unwrap();
        await_proxy_disconnect_cleanup(active, "active").await;
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;

        let stopping_id = format!("proxy-dispatch-stopping-{}", Uuid::new_v4());
        let (release_stopping, blocked_stopping) = std::sync::mpsc::channel();
        super::super::proxy_command::install_blocked_relay_for_accounting_test(
            &stopping_id,
            blocked_stopping,
        )
        .unwrap();
        super::super::proxy_command::begin_proxy_command_cleanup_for_test(&stopping_id).unwrap();
        let stopping = dispatch_proxy_command_disconnect_cleanup(
            stopping_id,
            Some(admission.reserve_session(&config()).unwrap()),
        )
        .expect("stopping lifecycle must dispatch cleanup");
        assert_eq!(admission.snapshot().active_or_pending, 1);
        release_stopping.send(()).unwrap();
        await_proxy_disconnect_cleanup(stopping, "stopping").await;
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rejected_proxy_cleanup_keeps_admission_until_retry_and_actual_join() {
        let admission = SshConnectionAdmission::new(limits(4, 1));
        let session_id = format!("proxy-retry-accounting-{}", Uuid::new_v4());
        let (release, blocked_relay) = std::sync::mpsc::channel();
        super::super::proxy_command::install_blocked_relay_for_accounting_test(
            &session_id,
            blocked_relay,
        )
        .unwrap();
        super::super::proxy_command::reject_next_cleanup_enqueue_for_test(&session_id).unwrap();
        let lease = admission.reserve_session(&config()).unwrap();
        cleanup_pending_connection_artifacts(&PendingSshCleanupKey::new(&session_id), Some(lease));

        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(super::super::proxy_command::has_proxy_command_lifecycle_for_test(&session_id));
        assert_eq!(admission.snapshot().active_or_pending, 1);

        release.send(()).unwrap();
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
        assert!(!super::super::proxy_command::has_proxy_command_lifecycle_for_test(&session_id));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pre_adoption_bridge_reaper_retains_capacity_until_native_exit() {
        let admission = SshConnectionAdmission::new(limits(4, 1));
        let gate = Arc::new(BlockingGate::default());
        let worker_gate = Arc::clone(&gate);
        let exited = Arc::new(AtomicBool::new(false));
        let worker_exited = Arc::clone(&exited);
        let handle = std::thread::spawn(move || {
            worker_gate.wait();
            worker_exited.store(true, Ordering::Release);
        });
        let cleanup = EstablishmentBridgeCleanup::from_parts(
            Vec::new(),
            vec![handle],
            Some(admission.reserve_session(&config()).unwrap()),
        );
        drop(cleanup);

        assert_eq!(admission.snapshot().active_or_pending, 1);
        gate.open();
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
        assert!(exited.load(Ordering::Acquire));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn blocked_proxy_relay_retains_session_accounting_through_actual_join() {
        let admission = SshConnectionAdmission::new(limits(4, 1));
        let session_id = format!("proxy-accounting-{}", Uuid::new_v4());
        let (release, blocked_relay) = std::sync::mpsc::channel();
        super::super::proxy_command::install_blocked_relay_for_accounting_test(
            &session_id,
            blocked_relay,
        )
        .unwrap();
        let session_lease = admission.reserve_session(&config()).unwrap();
        let cleanup_session_id = session_id.clone();
        let cleanup = tokio::task::spawn_blocking(move || {
            let _session_lease = session_lease;
            super::super::proxy_command::stop_proxy_command_and_wait(&cleanup_session_id)
        });

        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if super::super::proxy_command::get_proxy_command_status(&session_id)
                    .unwrap()
                    .is_none()
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("blocked relay should enter stopping state");
        tokio::time::sleep(Duration::from_millis(2_100)).await;
        assert!(!cleanup.is_finished());
        assert_eq!(
            admission.snapshot(),
            SshConnectionAdmissionSnapshot {
                active_or_pending: 1,
                active_handshakes: 0,
                retained_config_bytes: MAX_SSH_RETAINED_CONFIG_BYTES,
            }
        );

        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(3), cleanup)
            .await
            .expect("actual ProxyCommand relay cleanup should complete")
            .unwrap()
            .unwrap();
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
        assert!(
            super::super::proxy_command::get_proxy_command_status(&session_id)
                .unwrap()
                .is_none()
        );
    }

    async fn assert_stalling_proxy_protocol_times_out(proxy_type: ProxyType, expected_phase: &str) {
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let peer = tokio::spawn(async move {
            let (mut peer, _) = listener.accept().await.unwrap();
            let mut first_request = [0_u8; 256];
            let read = peer.read(&mut first_request).await.unwrap();
            assert!(read > 0, "proxy client should send its negotiation request");
            std::future::pending::<()>().await;
        });
        let proxy = ProxyConfig {
            proxy_type,
            host: "127.0.0.1".to_string(),
            port: address.port(),
            username: None,
            password: None,
        };
        let control = SshEstablishmentControl::new_with_timeout(
            Duration::from_millis(200),
            Arc::new(PendingSshConnection::new()),
        )
        .unwrap();
        let state = SshService::new();
        let service = state.lock().await;
        let error = service
            .establish_proxy_connection_with_control(
                &config(),
                &proxy,
                &control,
                Duration::from_millis(50),
            )
            .await
            .unwrap_err();
        assert!(
            error.starts_with(&format!(
                "{SSH_CONNECTION_TIMEOUT_ERROR_CODE}: SSH establishment phase '{expected_phase}'"
            )),
            "unexpected proxy timeout: {error}"
        );
        peer.abort();
        let _ = peer.await;
    }

    #[tokio::test]
    async fn stalled_socks5_and_http_negotiations_have_typed_deadlines() {
        assert_stalling_proxy_protocol_times_out(ProxyType::Socks5, "socks5-proxy-negotiation")
            .await;
        assert_stalling_proxy_protocol_times_out(ProxyType::Http, "http-proxy-negotiation").await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn oversized_http_connect_line_is_bounded_and_releases_accounting() {
        let state = SshService::new_with_connection_limits(limits(4, 1));
        let admission = Arc::clone(&state.lock().await.connection_admission);
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let peer = tokio::spawn(async move {
            let (mut peer, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let read = peer.read(&mut request).await.unwrap();
            assert!(read > 0, "HTTP proxy should receive CONNECT request");
            peer.write_all(&vec![b'A'; MAX_HTTP_PROXY_RESPONSE_LINE_BYTES + 1])
                .await
                .unwrap();
            peer.shutdown().await.unwrap();
        });

        let mut attempt_config = config();
        attempt_config.connect_timeout = Some(2);
        attempt_config.proxy_config = Some(ProxyConfig {
            proxy_type: ProxyType::Http,
            host: "127.0.0.1".to_string(),
            port: address.port(),
            username: None,
            password: None,
        });
        let error = connect_ssh_on_state(&state, attempt_config)
            .await
            .unwrap_err();
        assert_eq!(error, HTTP_PROXY_RESPONSE_LIMIT_ERROR);
        peer.await.unwrap();
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
    }

    #[tokio::test]
    async fn cancellation_broadcast_wakes_every_waiter_and_closes_tracked_socket() {
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = AsyncTcpStream::connect(address).await.unwrap();
        let (mut peer, _) = listener.accept().await.unwrap();
        let client = client.into_std().unwrap();
        client.set_nonblocking(false).unwrap();
        let cancellation = Arc::new(PendingSshConnection::new());
        let control = SshEstablishmentControl::new_with_timeout(
            Duration::from_secs(10),
            Arc::clone(&cancellation),
        )
        .unwrap();
        control
            .track_blocking_socket(&client, "cancellation-broadcast-test")
            .unwrap();

        let mut waiters = Vec::new();
        for _ in 0..8 {
            let waiter = Arc::clone(&cancellation);
            waiters.push(tokio::spawn(async move { waiter.cancelled().await }));
        }
        tokio::task::yield_now().await;
        cancellation.cancel();
        tokio::time::timeout(Duration::from_secs(1), async {
            for waiter in waiters {
                waiter.await.unwrap();
            }
        })
        .await
        .expect("broadcast cancellation did not wake every waiter");

        let mut byte = [0_u8; 1];
        let closure = tokio::time::timeout(Duration::from_secs(1), peer.read(&mut byte))
            .await
            .expect("tracked socket did not close after broadcast cancellation");
        assert!(
            matches!(closure, Ok(0))
                || closure.as_ref().is_err_and(|error| {
                    error.kind() == std::io::ErrorKind::ConnectionReset
                        || error.kind() == std::io::ErrorKind::ConnectionAborted
                        || error.raw_os_error() == Some(10053)
                        || error.raw_os_error() == Some(10054)
                }),
            "unexpected tracked-socket closure result: {closure:?}"
        );
        assert_eq!(
            control.outcome.load(Ordering::Acquire),
            ESTABLISHMENT_CANCELLED
        );
    }

    #[tokio::test]
    async fn standalone_direct_helper_clears_socket_deadlines_before_return() {
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let accept = tokio::spawn(async move { listener.accept().await.unwrap().0 });
        let mut direct_config = config();
        direct_config.port = address.port();
        let state = SshService::new();
        let stream = state
            .lock()
            .await
            .establish_direct_connection(&direct_config)
            .await
            .unwrap();
        assert_eq!(stream.read_timeout().unwrap(), None);
        assert_eq!(stream.write_timeout().unwrap(), None);
        drop(stream);
        drop(accept.await.unwrap());
    }

    #[tokio::test]
    async fn expired_socket_tracking_returns_typed_timeout_not_invalid_input() {
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = AsyncTcpStream::connect(address).await.unwrap();
        let (_peer, _) = listener.accept().await.unwrap();
        let client = client.into_std().unwrap();
        client.set_nonblocking(false).unwrap();
        let control = SshEstablishmentControl::new_with_timeout(
            Duration::from_millis(10),
            Arc::new(PendingSshConnection::new()),
        )
        .unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        let error = control
            .track_blocking_socket(&client, "expired-track")
            .unwrap_err();
        assert!(error.starts_with(SSH_CONNECTION_TIMEOUT_ERROR_CODE));
        assert!(!error.contains("Invalid argument"));
    }

    fn fake_connection(
        session_id: String,
        config: SshConnectionConfig,
    ) -> EstablishedSshConnection {
        let session = ssh2::Session::new().expect("create fake SSH session");
        EstablishedSshConnection {
            session_id: session_id.clone(),
            session: Some(SshSession {
                id: session_id,
                session,
                config,
                connected_at: Utc::now(),
                last_activity: Utc::now(),
                port_forwards: HashMap::new(),
                keep_alive_handle: None,
                intermediate_sessions: Vec::new(),
                bridge_handles: Vec::new(),
                compression_stats: SshCompressionStats::default(),
            }),
            cleanup_session_lease: None,
        }
    }

    async fn wait_for_snapshot(
        admission: &SshConnectionAdmission,
        expected: SshConnectionAdmissionSnapshot,
    ) {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if admission.snapshot() == expected {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap_or_else(|_| {
            panic!(
                "SSH admission did not reach {expected:?}; current snapshot: {:?}",
                admission.snapshot()
            )
        });
    }

    async fn connect_fake(state: &SshServiceState, config: SshConnectionConfig) -> String {
        connect_ssh_on_state_with(
            state,
            config,
            |_connector, session_id, config, worker_lease| async move {
                let _worker_lease = worker_lease;
                Ok(fake_connection(session_id, config))
            },
        )
        .await
        .expect("fake SSH connection should be adopted")
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn state_wrapper_100_500_1000_pressure_is_fail_fast_and_exactly_bounded() {
        for attempts in [100_usize, 500, 1_000] {
            let state = SshService::new_with_connection_limits(limits(
                MAX_ACTIVE_OR_PENDING_SSH_SESSIONS,
                MAX_CONCURRENT_SSH_HANDSHAKES,
            ));
            let admission = Arc::clone(&state.lock().await.connection_admission);
            let gate = Arc::new(tokio::sync::Semaphore::new(0));
            let entered = Arc::new(AtomicUsize::new(0));
            let rejected_settled = Arc::new(AtomicUsize::new(0));
            let mut tasks = Vec::with_capacity(attempts);

            for _ in 0..attempts {
                let connecting_state = Arc::clone(&state);
                let worker_gate = Arc::clone(&gate);
                let worker_entered = Arc::clone(&entered);
                let task_rejected_settled = Arc::clone(&rejected_settled);
                tasks.push(tokio::spawn(async move {
                    let result = connect_ssh_on_state_with(
                        &connecting_state,
                        config(),
                        move |_connector, session_id, config, worker_lease| async move {
                            let _worker_lease = worker_lease;
                            worker_entered.fetch_add(1, Ordering::AcqRel);
                            let _gate_permit = worker_gate
                                .acquire()
                                .await
                                .expect("fake establishment gate should remain open");
                            Ok(fake_connection(session_id, config))
                        },
                    )
                    .await;
                    if result.is_err() {
                        task_rejected_settled.fetch_add(1, Ordering::AcqRel);
                    }
                    result
                }));
            }

            tokio::time::timeout(Duration::from_secs(5), async {
                while entered.load(Ordering::Acquire) + rejected_settled.load(Ordering::Acquire)
                    != attempts
                {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("all bounded fake establishment tasks should enter");

            assert_eq!(
                admission.snapshot(),
                SshConnectionAdmissionSnapshot {
                    active_or_pending: MAX_CONCURRENT_SSH_HANDSHAKES,
                    active_handshakes: MAX_CONCURRENT_SSH_HANDSHAKES,
                    retained_config_bytes: MAX_CONCURRENT_SSH_HANDSHAKES
                        * MAX_SSH_RETAINED_CONFIG_BYTES,
                }
            );

            gate.add_permits(MAX_CONCURRENT_SSH_HANDSHAKES);
            let mut sessions = Vec::with_capacity(MAX_CONCURRENT_SSH_HANDSHAKES);
            let mut rejected = 0_usize;
            for task in tasks {
                match task.await.expect("wrapper task should not panic") {
                    Ok(session_id) => sessions.push(session_id),
                    Err(error) => {
                        assert!(
                            error.starts_with(SSH_HANDSHAKE_CAPACITY_ERROR_CODE),
                            "unexpected wrapper rejection: {error}"
                        );
                        rejected += 1;
                    }
                }
            }
            assert_eq!(sessions.len(), MAX_CONCURRENT_SSH_HANDSHAKES);
            assert_eq!(rejected, attempts - MAX_CONCURRENT_SSH_HANDSHAKES);

            for session_id in sessions {
                disconnect_ssh_on_state(&state, &session_id).await.unwrap();
            }
            wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
        }
    }

    #[test]
    fn retained_config_counts_secrets_and_enforces_per_session_and_aggregate_budgets() {
        let mut with_secret = config();
        with_secret.password = Some(SecretString::new("secret-value".to_string()));
        let public_bytes = serde_json::to_vec(&with_secret).unwrap().len();
        let retained_bytes = retained_ssh_config_bytes(&with_secret).unwrap();
        assert_eq!(retained_bytes, public_bytes + "secret-value".len());

        let admission = SshConnectionAdmission::new(SshConnectionAdmissionLimits {
            max_sessions: 4,
            max_handshakes: 1,
            max_config_bytes: retained_bytes,
            config_budget_bytes: retained_bytes * 2,
        });
        let first = admission.reserve_session(&with_secret).unwrap();
        let second = admission.reserve_session(&with_secret).unwrap();
        assert_eq!(first._retained_config_bytes, retained_bytes);
        assert_eq!(second._retained_config_bytes, retained_bytes);
        assert_eq!(
            admission.reserve_session(&with_secret).unwrap_err(),
            SshConnectionAdmissionError::ConfigBudget {
                bytes: retained_bytes,
                limit: retained_bytes * 2,
            }
        );
        drop((first, second));
        assert_eq!(
            admission.snapshot(),
            SshConnectionAdmissionSnapshot::default()
        );

        let mut oversized = config();
        oversized
            .environment
            .insert("PAYLOAD".into(), "x".repeat(MAX_SSH_RETAINED_CONFIG_BYTES));
        assert!(matches!(
            SshConnectionAdmission::new(SshConnectionAdmissionLimits::default())
                .reserve_session(&oversized),
            Err(SshConnectionAdmissionError::ConfigTooLarge {
                limit: MAX_SSH_RETAINED_CONFIG_BYTES,
                ..
            })
        ));
    }

    #[tokio::test]
    async fn runtime_config_growth_is_rejected_transactionally_for_auth_and_compression() {
        let mut initial_config = config();
        initial_config.compression_config.allow_runtime_update = true;
        let retained_bytes = retained_ssh_config_bytes(&initial_config).unwrap();
        let per_session_limit = retained_bytes + 128;
        let state = SshService::new_with_connection_limits(SshConnectionAdmissionLimits {
            max_sessions: 4,
            max_handshakes: 1,
            max_config_bytes: per_session_limit,
            config_budget_bytes: per_session_limit * 4,
        });
        let admission = Arc::clone(&state.lock().await.connection_admission);
        let session_id = connect_fake(&state, initial_config).await;

        let mut service = state.lock().await;
        let auth_error = service
            .update_session_auth(
                &session_id,
                Some("secret".repeat(per_session_limit)),
                None,
                None,
            )
            .await
            .unwrap_err();
        assert!(auth_error.starts_with(SSH_CONFIG_CAPACITY_ERROR_CODE));
        assert!(service.sessions[&session_id].config.password.is_none());

        let original_extensions = service.sessions[&session_id]
            .config
            .compression_config
            .adaptive
            .incompressible_extensions
            .clone();
        let mut compression = service.sessions[&session_id]
            .config
            .compression_config
            .clone();
        compression.adaptive.incompressible_extensions =
            vec!["extension".repeat(per_session_limit)];
        let compression_error = service
            .update_compression_config(&session_id, compression)
            .unwrap_err();
        assert!(compression_error.starts_with(SSH_CONFIG_CAPACITY_ERROR_CODE));
        assert_eq!(
            service.sessions[&session_id]
                .config
                .compression_config
                .adaptive
                .incompressible_extensions,
            original_extensions
        );
        drop(service);

        assert_eq!(
            admission.snapshot(),
            SshConnectionAdmissionSnapshot {
                active_or_pending: 1,
                active_handshakes: 0,
                retained_config_bytes: per_session_limit,
            }
        );
        disconnect_ssh_on_state(&state, &session_id).await.unwrap();
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelled_attempt_keeps_worker_owned_capacity_until_native_work_exits() {
        let state = SshService::new_with_connection_limits(limits(4, 1));
        let admission = Arc::clone(&state.lock().await.connection_admission);
        let gate = Arc::new(BlockingGate::default());
        let worker_gate = Arc::clone(&gate);
        let (session_id_tx, session_id_rx) = tokio::sync::oneshot::channel();
        let connecting_state = Arc::clone(&state);
        let connect = tokio::spawn(async move {
            connect_ssh_on_state_with(
                &connecting_state,
                config(),
                move |_connector, session_id, _config, worker_lease| async move {
                    tokio::task::spawn_blocking(move || {
                        let _worker_lease = worker_lease;
                        session_id_tx
                            .send(session_id)
                            .expect("publish provisional session id");
                        worker_gate.wait();
                        Err("fake native worker stopped".to_string())
                    })
                    .await
                    .expect("fake native worker should not panic")
                },
            )
            .await
        });

        let session_id = session_id_rx.await.expect("worker should start");
        assert_eq!(
            admission.snapshot(),
            SshConnectionAdmissionSnapshot {
                active_or_pending: 1,
                active_handshakes: 1,
                retained_config_bytes: MAX_SSH_RETAINED_CONFIG_BYTES,
            }
        );
        disconnect_ssh_on_state(&state, &session_id)
            .await
            .expect("pending connect cancellation should succeed");
        assert_eq!(
            connect
                .await
                .expect("connect task should not panic")
                .unwrap_err(),
            "SSH connection cancelled"
        );
        assert_eq!(
            admission.snapshot().active_or_pending,
            1,
            "detached native worker must retain its session permit"
        );
        assert_eq!(admission.snapshot().active_handshakes, 1);

        gate.open();
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
    }

    #[tokio::test]
    async fn adoption_and_disconnect_churn_transfer_and_release_the_same_lease() {
        let state = SshService::new_with_connection_limits(limits(4, 2));
        let admission = Arc::clone(&state.lock().await.connection_admission);
        let config = config();
        // Duplicate endpoints remain valid SSH sessions; admission is strictly
        // resource-based and does not silently introduce VNC-style deduping.
        let first = connect_fake(&state, config.clone()).await;
        let second = connect_fake(&state, config.clone()).await;
        assert_ne!(first, second);
        assert_eq!(
            admission.snapshot(),
            SshConnectionAdmissionSnapshot {
                active_or_pending: 2,
                active_handshakes: 0,
                retained_config_bytes: MAX_SSH_RETAINED_CONFIG_BYTES * 2,
            }
        );
        disconnect_ssh_on_state(&state, &first).await.unwrap();
        disconnect_ssh_on_state(&state, &second).await.unwrap();
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;

        for _ in 0..100 {
            let session_id = connect_fake(&state, config.clone()).await;
            assert_eq!(admission.snapshot().active_or_pending, 1);
            disconnect_ssh_on_state(&state, &session_id).await.unwrap();
            assert_eq!(
                admission.snapshot(),
                SshConnectionAdmissionSnapshot::default()
            );
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn watchdog_reaps_all_sixteen_stalled_workers_before_next_admission() {
        let state = SshService::new_with_connection_limits(limits(32, 16));
        let admission = Arc::clone(&state.lock().await.connection_admission);
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut tasks = Vec::with_capacity(16);

        for _ in 0..16 {
            let connecting_state = Arc::clone(&state);
            let mut attempt_config = config();
            attempt_config.port = address.port();
            attempt_config.connect_timeout = Some(2);
            tasks.push(tokio::spawn(async move {
                connect_ssh_on_state(&connecting_state, attempt_config).await
            }));
        }

        let mut stalled_peers = Vec::with_capacity(16);
        tokio::time::timeout(Duration::from_secs(2), async {
            while stalled_peers.len() < 16 {
                stalled_peers.push(listener.accept().await.unwrap().0);
            }
        })
        .await
        .expect("all sixteen bounded workers should reach the loopback listener");
        assert_eq!(admission.snapshot().active_handshakes, 16);

        for task in tasks {
            let error = tokio::time::timeout(Duration::from_secs(4), task)
                .await
                .expect("watchdog did not stop a stalled SSH worker")
                .expect("stalled SSH worker task should not panic")
                .unwrap_err();
            assert!(
                error.starts_with(SSH_CONNECTION_TIMEOUT_ERROR_CODE),
                "stalled worker returned an untyped error: {error}"
            );
        }
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
        drop(stalled_peers);

        let connecting_state = Arc::clone(&state);
        let mut next_config = config();
        next_config.port = address.port();
        next_config.connect_timeout = Some(2);
        let next =
            tokio::spawn(async move { connect_ssh_on_state(&connecting_state, next_config).await });
        let (mut next_peer, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .expect("the seventeenth attempt was not admitted")
            .unwrap();
        assert_eq!(admission.snapshot().active_handshakes, 1);
        let _ = next_peer.write_all(b"not-an-ssh-server\r\n").await;
        let _ = next_peer.shutdown().await;
        drop(next_peer);
        let error = next.await.unwrap().unwrap_err();
        assert!(!error.starts_with(SSH_HANDSHAKE_CAPACITY_ERROR_CODE));
        assert!(!error.starts_with(SSH_SESSION_CAPACITY_ERROR_CODE));
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
    }

    #[cfg(windows)]
    fn process_is_alive(pid: u32) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
        const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

        // SAFETY: the handle is checked for null and closed on every successful
        // OpenProcess path; no ownership escapes this helper.
        unsafe {
            let process = OpenProcess(SYNCHRONIZE_ACCESS, 0, pid);
            if process.is_null() {
                return false;
            }
            let alive = WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
            CloseHandle(process);
            alive
        }
    }

    #[cfg(not(windows))]
    fn process_is_alive(pid: u32) -> bool {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .is_ok_and(|status| status.success())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn proxy_command_timeout_reaps_helper_and_registry_before_capacity_release() {
        #[cfg(windows)]
        let command =
            "powershell.exe -NoLogo -NoProfile -NonInteractive -Command Start-Sleep -Seconds 60"
                .to_string();
        #[cfg(not(windows))]
        let command = "sleep 60".to_string();

        let mut attempt_config = config();
        attempt_config.connect_timeout = Some(1);
        attempt_config.proxy_command = Some(ProxyCommandConfig {
            command: Some(command.clone()),
            template: None,
            proxy_host: None,
            proxy_port: None,
            proxy_username: None,
            proxy_password: None,
            proxy_type: None,
            timeout_secs: Some(1),
            command_confirmed: false,
        });
        super::super::proxy_command::mark_proxy_command_confirmed(&command);

        let state = SshService::new_with_connection_limits(limits(4, 1));
        let admission = Arc::clone(&state.lock().await.connection_admission);
        let connecting_state = Arc::clone(&state);
        let connect =
            tokio::spawn(
                async move { connect_ssh_on_state(&connecting_state, attempt_config).await },
            );

        let session_id = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Some(session_id) = state
                    .lock()
                    .await
                    .pending_connections
                    .lock()
                    .unwrap()
                    .keys()
                    .next()
                    .cloned()
                {
                    break session_id;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("ProxyCommand attempt should register");
        let helper_pid = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Some(status) =
                    super::super::proxy_command::get_proxy_command_status(&session_id).unwrap()
                {
                    break status.pid.expect("ProxyCommand helper should have a pid");
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("ProxyCommand helper should become visible");

        let error = tokio::time::timeout(Duration::from_secs(4), connect)
            .await
            .expect("ProxyCommand timeout did not stop its worker")
            .expect("ProxyCommand connection task should not panic")
            .unwrap_err();
        assert!(error.starts_with(SSH_CONNECTION_TIMEOUT_ERROR_CODE));
        assert!(
            super::super::proxy_command::get_proxy_command_status(&session_id)
                .unwrap()
                .is_none(),
            "timed-out ProxyCommand must leave no registry entry"
        );
        assert!(
            !process_is_alive(helper_pid),
            "timed-out ProxyCommand helper process {helper_pid} is still alive"
        );
        wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_loopback_cancellation_closes_worker_socket_before_capacity_releases() {
        let state = SshService::new_with_connection_limits(limits(4, 1));
        let admission = Arc::clone(&state.lock().await.connection_admission);
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        for _ in 0..8 {
            let mut attempt_config = config();
            attempt_config.port = address.port();
            let connecting_state = Arc::clone(&state);
            let connect = tokio::spawn(async move {
                connect_ssh_on_state(&connecting_state, attempt_config).await
            });
            let (mut peer, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
                .await
                .expect("real loopback connect timed out")
                .unwrap();
            let pending = Arc::clone(&state.lock().await.pending_connections);
            let session_id = pending
                .lock()
                .unwrap()
                .keys()
                .next()
                .cloned()
                .expect("provisional loopback session should be registered");
            assert_eq!(
                admission.snapshot(),
                SshConnectionAdmissionSnapshot {
                    active_or_pending: 1,
                    active_handshakes: 1,
                    retained_config_bytes: MAX_SSH_RETAINED_CONFIG_BYTES,
                }
            );

            disconnect_ssh_on_state(&state, &session_id).await.unwrap();
            assert_eq!(
                connect.await.unwrap().unwrap_err(),
                "SSH connection cancelled"
            );
            let _ = peer.write_all(b"not-an-ssh-server\r\n").await;
            let _ = peer.shutdown().await;
            let mut observed_client_bytes = 0_usize;
            tokio::time::timeout(Duration::from_secs(3), async {
                let mut bytes = [0_u8; 256];
                loop {
                    match peer.read(&mut bytes).await {
                        Ok(0) => break,
                        Ok(read) => {
                            observed_client_bytes = observed_client_bytes.saturating_add(read);
                            assert!(
                                observed_client_bytes <= 4 * 1024,
                                "invalid loopback server received unbounded client handshake bytes"
                            );
                        }
                        Err(error)
                            if error.kind() == std::io::ErrorKind::ConnectionReset
                                || error.kind() == std::io::ErrorKind::ConnectionAborted
                                || error.raw_os_error() == Some(10053)
                                || error.raw_os_error() == Some(10054) =>
                        {
                            break;
                        }
                        Err(error) => panic!("unexpected loopback peer read error: {error}"),
                    }
                }
            })
            .await
            .expect("SSH loopback worker did not close its socket");
            wait_for_snapshot(&admission, SshConnectionAdmissionSnapshot::default()).await;
        }
    }
}

#[cfg(test)]
mod host_key_prompt_tests {
    use super::*;
    use serde_json::json;
    use sorng_core::events::{AppEventEmitter, DynEventEmitter};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct RecordingEmitter {
        events: Mutex<Vec<(String, serde_json::Value)>>,
    }

    impl AppEventEmitter for RecordingEmitter {
        fn emit_event(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
            self.events
                .lock()
                .expect("recording emitter mutex poisoned")
                .push((event.to_string(), payload));
            Ok(())
        }
    }

    fn test_service(emitter: DynEventEmitter) -> SshService {
        SshService {
            sessions: HashMap::new(),
            session_admission_leases: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: Some(emitter),
            pending_connections: std::sync::Arc::new(StdMutex::new(HashMap::new())),
            connection_admission: SshConnectionAdmission::new(
                SshConnectionAdmissionLimits::default(),
            ),
            establishment_control: None,
            establishment_session_lease: None,
            shell_admission: Arc::new(ShellAdmission::new(DEFAULT_MAX_ACTIVE_SSH_SHELLS)),
        }
    }

    fn test_config() -> SshConnectionConfig {
        serde_json::from_value(json!({
            "host": "example.com",
            "port": 22,
            "username": "tester",
            "password": null,
            "private_key_path": null,
            "private_key_passphrase": null,
            "jump_hosts": [],
            "proxy_config": null,
            "proxy_chain": null,
            "mixed_chain": null,
            "openvpn_config": null,
            "connect_timeout": 15,
            "keep_alive_interval": 30,
            "strict_host_key_checking": true,
            "known_hosts_path": null,
            "totp_secret": null,
            "keyboard_interactive_responses": []
        }))
        .expect("valid ssh config json")
    }

    fn test_host_key_info() -> SshHostKeyInfo {
        SshHostKeyInfo {
            fingerprint: "SHA256:test-fingerprint".to_string(),
            key_type: Some("ssh-ed25519".to_string()),
            key_bits: Some(256),
            public_key: Some("AAAAC3NzaC1lZDI1NTE5AAAAITestKey".to_string()),
        }
    }

    fn clear_pending_prompt(session_id: &str) {
        PENDING_HOST_KEY_PROMPTS
            .lock()
            .expect("pending host-key prompt map poisoned")
            .remove(session_id);
    }

    async fn wait_for_pending_prompt(session_id: &str) {
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let contains_session = PENDING_HOST_KEY_PROMPTS
                    .lock()
                    .expect("pending host-key prompt map poisoned")
                    .contains_key(session_id);
                if contains_session {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("pending host-key prompt never appeared");
    }

    fn respond_to_prompt(session_id: &str, decision: SshHostKeyPromptDecision) {
        let sender = PENDING_HOST_KEY_PROMPTS
            .lock()
            .expect("pending host-key prompt map poisoned")
            .remove(session_id)
            .expect("expected pending host-key prompt sender");
        sender
            .send(decision)
            .expect("decision receiver should still be waiting");
    }

    #[tokio::test]
    async fn prompt_for_host_key_decision_emits_payload_and_accepts_save() {
        clear_pending_prompt("session-accept-save");

        let emitter = Arc::new(RecordingEmitter::default());
        let service = test_service(emitter.clone());
        let config = test_config();
        let session_id = "session-accept-save".to_string();

        let prompt_task = tokio::spawn(async move {
            service
                .prompt_for_host_key_decision_with_timeout(
                    &session_id,
                    &config,
                    &test_host_key_info(),
                    SshHostKeyPromptStatus::FirstUse,
                    Duration::from_secs(1),
                )
                .await
        });

        wait_for_pending_prompt("session-accept-save").await;

        {
            let events = emitter
                .events
                .lock()
                .expect("recording emitter mutex poisoned");
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].0, "ssh://host-key-prompt");
            assert_eq!(events[0].1["session_id"], "session-accept-save");
            assert_eq!(events[0].1["host"], "example.com");
            assert_eq!(events[0].1["status"], "first_use");
            assert_eq!(events[0].1["fingerprint"], "SHA256:test-fingerprint");
        }

        respond_to_prompt(
            "session-accept-save",
            SshHostKeyPromptDecision::AcceptAndSave,
        );

        assert_eq!(
            prompt_task.await.expect("prompt task should complete"),
            Ok(SshHostKeyPromptDecision::AcceptAndSave),
        );
        clear_pending_prompt("session-accept-save");
    }

    #[tokio::test]
    async fn prompt_for_host_key_decision_accept_once_roundtrips() {
        clear_pending_prompt("session-accept-once");

        let emitter = Arc::new(RecordingEmitter::default());
        let service = test_service(emitter);
        let config = test_config();
        let session_id = "session-accept-once".to_string();

        let prompt_task = tokio::spawn(async move {
            service
                .prompt_for_host_key_decision_with_timeout(
                    &session_id,
                    &config,
                    &test_host_key_info(),
                    SshHostKeyPromptStatus::FirstUse,
                    Duration::from_secs(1),
                )
                .await
        });

        wait_for_pending_prompt("session-accept-once").await;
        respond_to_prompt("session-accept-once", SshHostKeyPromptDecision::AcceptOnce);

        assert_eq!(
            prompt_task.await.expect("prompt task should complete"),
            Ok(SshHostKeyPromptDecision::AcceptOnce),
        );
        clear_pending_prompt("session-accept-once");
    }

    #[tokio::test]
    async fn prompt_for_host_key_decision_reject_roundtrips() {
        clear_pending_prompt("session-reject");

        let emitter = Arc::new(RecordingEmitter::default());
        let service = test_service(emitter);
        let config = test_config();
        let session_id = "session-reject".to_string();

        let prompt_task = tokio::spawn(async move {
            service
                .prompt_for_host_key_decision_with_timeout(
                    &session_id,
                    &config,
                    &test_host_key_info(),
                    SshHostKeyPromptStatus::Mismatch,
                    Duration::from_secs(1),
                )
                .await
        });

        wait_for_pending_prompt("session-reject").await;
        respond_to_prompt("session-reject", SshHostKeyPromptDecision::Reject);

        assert_eq!(
            prompt_task.await.expect("prompt task should complete"),
            Ok(SshHostKeyPromptDecision::Reject),
        );
        clear_pending_prompt("session-reject");
    }

    #[tokio::test]
    async fn prompt_for_host_key_decision_times_out_and_clears_pending_entry() {
        clear_pending_prompt("session-timeout");

        let emitter = Arc::new(RecordingEmitter::default());
        let service = test_service(emitter);
        let config = test_config();

        let result = service
            .prompt_for_host_key_decision_with_timeout(
                "session-timeout",
                &config,
                &test_host_key_info(),
                SshHostKeyPromptStatus::FirstUse,
                Duration::from_millis(10),
            )
            .await;

        let error = result.expect_err("prompt should time out without a response");
        assert!(error.contains("timed out"));
        assert!(!PENDING_HOST_KEY_PROMPTS
            .lock()
            .expect("pending host-key prompt map poisoned")
            .contains_key("session-timeout"));
        clear_pending_prompt("session-timeout");
    }

    #[tokio::test]
    async fn pending_host_key_prompt_does_not_starve_service_or_block_cancellation() {
        let emitter = Arc::new(RecordingEmitter::default());
        let state = Arc::new(tokio::sync::Mutex::new(test_service(emitter)));
        let config = test_config();
        let (session_id_tx, session_id_rx) = tokio::sync::oneshot::channel();
        let connecting_state = state.clone();

        let connect_task = tokio::spawn(async move {
            connect_ssh_on_state_with(
                &connecting_state,
                config,
                move |connector, session_id, config, worker_lease| async move {
                    let _worker_lease = worker_lease;
                    session_id_tx
                        .send(session_id.clone())
                        .expect("test should receive provisional session id");
                    connector
                        .prompt_for_host_key_decision_with_timeout(
                            &session_id,
                            &config,
                            &test_host_key_info(),
                            SshHostKeyPromptStatus::FirstUse,
                            Duration::from_secs(30),
                        )
                        .await?;
                    Err("test connection stopped after prompt".to_string())
                },
            )
            .await
        });

        let session_id = session_id_rx
            .await
            .expect("connect task should expose its provisional session id");
        wait_for_pending_prompt(&session_id).await;

        let sessions = tokio::time::timeout(Duration::from_secs(1), async {
            state.lock().await.list_sessions().await
        })
        .await
        .expect("session status should not wait behind a host-key prompt");
        assert!(sessions.is_empty());

        tokio::time::timeout(
            Duration::from_secs(1),
            disconnect_ssh_on_state(&state, &session_id),
        )
        .await
        .expect("disconnect should not wait behind a host-key prompt")
        .expect("pending connection cancellation should succeed");

        let error = tokio::time::timeout(Duration::from_secs(1), connect_task)
            .await
            .expect("cancelled connection should finish promptly")
            .expect("connect task should not panic")
            .expect_err("cancelled connection should fail");
        assert_eq!(error, "SSH connection cancelled");
        assert!(!PENDING_HOST_KEY_PROMPTS
            .lock()
            .expect("pending host-key prompt map poisoned")
            .contains_key(&session_id));
    }
}

impl SshService {
    /// Update running compression statistics after data transfer.
    pub fn update_compression_stats(
        stats: &mut SshCompressionStats,
        direction: &str, // "send" or "recv"
        original_bytes: u64,
        compressed_bytes: u64,
    ) {
        match direction {
            "send" => {
                stats.bytes_sent_uncompressed += original_bytes;
                stats.bytes_sent_compressed += compressed_bytes;
                if stats.bytes_sent_uncompressed > 0 {
                    stats.send_ratio =
                        stats.bytes_sent_compressed as f64 / stats.bytes_sent_uncompressed as f64;
                }
            }
            "recv" => {
                stats.bytes_recv_uncompressed += original_bytes;
                stats.bytes_recv_compressed += compressed_bytes;
                if stats.bytes_recv_uncompressed > 0 {
                    stats.recv_ratio =
                        stats.bytes_recv_compressed as f64 / stats.bytes_recv_uncompressed as f64;
                }
            }
            _ => {}
        }
    }
}

// ── Unit tests for execute_script helper logic ──────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::output_state::{
        is_recording_active, record_output_entry, start_recording_state, stop_recording_state,
        terminal_buffer_snapshot, terminal_buffer_text,
    };
    use crate::ssh::types::ScriptExecutionResult;
    use serde_json::json;

    fn output_deadline() -> Instant {
        Instant::now() + Duration::from_secs(1)
    }

    #[test]
    fn script_output_accepts_exact_combined_limit() {
        let cancellation = Arc::new(AtomicBool::new(false));
        let output = read_script_output_bounded(
            std::io::Cursor::new(b"abc".to_vec()),
            std::io::Cursor::new(b"de".to_vec()),
            5,
            output_deadline(),
            cancellation,
        )
        .expect("the exact combined limit must be accepted");

        assert_eq!(output.0, b"abc");
        assert_eq!(output.1, b"de");
    }

    #[test]
    fn script_output_overflow_returns_only_the_fixed_limit_error() {
        let secret = b"secret-output".to_vec();
        let error = read_script_output_bounded(
            std::io::Cursor::new(secret.clone()),
            std::io::Cursor::new(Vec::new()),
            secret.len() - 1,
            output_deadline(),
            Arc::new(AtomicBool::new(false)),
        )
        .expect_err("output beyond the combined limit must fail");

        assert_eq!(error, ScriptOutputReadError::OutputLimitExceeded);
        assert_eq!(error.user_message(), SCRIPT_OUTPUT_LIMIT_ERROR);
        assert!(!error.user_message().contains("secret-output"));
    }

    #[test]
    fn script_output_drains_stderr_independently() {
        let output = read_script_output_bounded(
            std::io::Cursor::new(Vec::new()),
            std::io::Cursor::new(b"stderr-only".to_vec()),
            64,
            output_deadline(),
            Arc::new(AtomicBool::new(false)),
        )
        .expect("stderr should be drained even when stdout is empty");

        assert!(output.0.is_empty());
        assert_eq!(output.1, b"stderr-only");
    }

    #[test]
    fn script_output_keeps_binary_bytes_bounded_and_utf8_safe() {
        let binary = vec![0xff, 0xfe, b'a', 0x00];
        let output = read_script_output_bounded(
            std::io::Cursor::new(binary.clone()),
            std::io::Cursor::new(Vec::new()),
            binary.len(),
            output_deadline(),
            Arc::new(AtomicBool::new(false)),
        )
        .expect("binary output within the limit should be retained");

        assert_eq!(output.0, binary);
        assert_eq!(String::from_utf8_lossy(&output.0), "\u{fffd}\u{fffd}a\0");
    }

    struct CancellingReader {
        inner: std::io::Cursor<Vec<u8>>,
        cancellation: Arc<AtomicBool>,
    }

    impl Read for CancellingReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let count = std::io::Read::read(&mut self.inner, buffer)?;
            if count > 0 {
                self.cancellation.store(true, Ordering::Release);
            }
            Ok(count)
        }
    }

    #[test]
    fn script_output_cancellation_stops_both_readers() {
        let cancellation = Arc::new(AtomicBool::new(false));
        let error = read_script_output_bounded(
            CancellingReader {
                inner: std::io::Cursor::new(vec![b'x'; 32]),
                cancellation: Arc::clone(&cancellation),
            },
            std::io::Cursor::new(vec![b'y'; 32]),
            128,
            output_deadline(),
            cancellation,
        )
        .expect_err("shared cancellation must stop output collection");

        assert_eq!(error, ScriptOutputReadError::Cancelled);
    }

    fn empty_test_service() -> SshService {
        SshService {
            sessions: HashMap::new(),
            session_admission_leases: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: None,
            pending_connections: std::sync::Arc::new(StdMutex::new(HashMap::new())),
            connection_admission: SshConnectionAdmission::new(
                SshConnectionAdmissionLimits::default(),
            ),
            establishment_control: None,
            establishment_session_lease: None,
            shell_admission: Arc::new(ShellAdmission::new(DEFAULT_MAX_ACTIVE_SSH_SHELLS)),
        }
    }

    fn tcp_test_config() -> SshConnectionConfig {
        serde_json::from_value(json!({
            "host": "127.0.0.1",
            "port": 22,
            "username": "tester",
            "password": null,
            "private_key_path": null,
            "private_key_passphrase": null,
            "jump_hosts": [],
            "proxy_config": null,
            "proxy_chain": null,
            "mixed_chain": null,
            "openvpn_config": null,
            "connect_timeout": 15,
            "keep_alive_interval": 30,
            "strict_host_key_checking": false,
            "known_hosts_path": null,
            "totp_secret": null,
            "keyboard_interactive_responses": []
        }))
        .expect("valid SSH test config")
    }

    async fn connect_fake_service_session(state: &SshServiceState) -> String {
        connect_ssh_on_state_with(
            state,
            tcp_test_config(),
            |_connector, session_id, config, worker_lease| async move {
                let _worker_lease = worker_lease;
                let session = ssh2::Session::new()
                    .map_err(|error| format!("failed to create test SSH session: {error}"))?;
                Ok(EstablishedSshConnection {
                    session_id: session_id.clone(),
                    session: Some(SshSession {
                        id: session_id,
                        session,
                        config,
                        connected_at: Utc::now(),
                        last_activity: Utc::now(),
                        port_forwards: HashMap::new(),
                        keep_alive_handle: None,
                        intermediate_sessions: Vec::new(),
                        bridge_handles: Vec::new(),
                        compression_stats: SshCompressionStats::default(),
                    }),
                    cleanup_session_lease: None,
                })
            },
        )
        .await
        .expect("fake SSH session should be adopted")
    }

    fn install_stalled_shell(service: &mut SshService, session_id: &str) -> Arc<AtomicBool> {
        let (sender, receiver) = shell_mailbox(ShellMailboxLimits::default());
        let completion = ShellCompletion::new();
        let lease = service
            .shell_admission
            .try_acquire(session_id, sender.cancellation(), Arc::clone(&completion))
            .expect("test shell should receive an admission permit");
        let generation = lease.generation();
        let release = Arc::new(AtomicBool::new(false));
        let release_worker = Arc::clone(&release);
        let completion_for_thread = Arc::clone(&completion);
        let thread = std::thread::spawn(move || {
            let _lease = lease;
            let guard = ShellWorkerCompletionGuard::new(completion_for_thread);
            let _receiver = receiver;
            while !release_worker.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(1));
            }
            guard.complete();
        });
        service.shells.insert(
            session_id.to_string(),
            SshShellHandle {
                id: format!("shell-{generation}"),
                sender,
                thread,
                suspend_count: Arc::new(AtomicUsize::new(0)),
                completion,
                generation,
            },
        );
        release
    }

    #[tokio::test]
    async fn disconnect_and_reconnect_clean_real_output_and_recording_lifecycle() {
        let state = Arc::new(tokio::sync::Mutex::new(empty_test_service()));
        let first_session_id = connect_fake_service_session(&state).await;
        let first_generation = ensure_terminal_buffer(&first_session_id).unwrap();
        append_terminal_output(&first_session_id, "first output").unwrap();
        start_recording_state(
            &first_session_id,
            "127.0.0.1".into(),
            "tester".into(),
            80,
            24,
            false,
            RecordingLimits::default(),
            RecordingClosePolicy::Discard,
        )
        .unwrap();
        record_output_entry(&first_session_id, "first output");
        assert!(is_recording_active(&first_session_id).unwrap());

        disconnect_ssh_on_state(&state, &first_session_id)
            .await
            .expect("real disconnect path should clean the first session");
        assert_eq!(terminal_buffer_text(&first_session_id).unwrap(), "");
        let disconnected =
            terminal_buffer_snapshot(&first_session_id, Some(first_generation), Some(0)).unwrap();
        assert!(disconnected.gap);
        assert!(disconnected.generation_changed);
        assert!(!is_recording_active(&first_session_id).unwrap());
        assert!(stop_recording_state(&first_session_id).is_err());

        let second_session_id = connect_fake_service_session(&state).await;
        assert_ne!(second_session_id, first_session_id);
        assert_eq!(terminal_buffer_text(&second_session_id).unwrap(), "");
        let second_generation = ensure_terminal_buffer(&second_session_id).unwrap();
        assert_ne!(second_generation, first_generation);
        let reconnected =
            terminal_buffer_snapshot(&second_session_id, Some(second_generation), Some(0)).unwrap();
        assert_eq!(reconnected.data, "");
        assert!(!reconnected.gap);
        assert!(!reconnected.generation_changed);

        disconnect_ssh_on_state(&state, &second_session_id)
            .await
            .expect("second fake session should cleanly disconnect");
    }

    #[tokio::test]
    async fn synthetic_stalled_worker_disconnect_releases_lock_and_meets_deadline() {
        // The transport/session is real service state, while the deliberately
        // stalled shell worker is synthetic so this test stays deterministic
        // and does not claim external SSH-server coverage.
        let state = Arc::new(tokio::sync::Mutex::new(empty_test_service()));
        let session_id = connect_fake_service_session(&state).await;
        ensure_terminal_buffer(&session_id).unwrap();
        append_terminal_output(&session_id, "before disconnect").unwrap();
        let release = {
            let mut service = state.lock().await;
            install_stalled_shell(&mut service, &session_id)
        };

        let disconnect_state = Arc::clone(&state);
        let disconnect_session_id = session_id.clone();
        let disconnect = tokio::spawn(async move {
            disconnect_ssh_on_state_with_timeout(
                &disconnect_state,
                &disconnect_session_id,
                Duration::from_millis(75),
            )
            .await
        });

        tokio::time::timeout(Duration::from_millis(50), async {
            loop {
                let service = state.lock().await;
                if !service.shells.contains_key(&session_id) {
                    break;
                }
                drop(service);
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("disconnect should detach the shell without monopolizing the service lock");

        let sessions = tokio::time::timeout(Duration::from_millis(25), async {
            state.lock().await.list_sessions().await
        })
        .await
        .expect("status reads must progress while detached cleanup is stalled");
        assert!(sessions.is_empty());
        assert_eq!(
            terminal_buffer_text(&session_id).unwrap(),
            "before disconnect"
        );

        let error = tokio::time::timeout(Duration::from_millis(250), disconnect)
            .await
            .expect("disconnect must return at its cleanup deadline")
            .expect("disconnect task must not panic")
            .expect_err("the deliberately stalled worker must time out");
        assert!(error.contains("worker detached safely"));
        assert_eq!(terminal_buffer_text(&session_id).unwrap(), "");

        // The timed-out generation remains tombstoned, so it cannot overlap a
        // replacement. Releasing the worker lets an idempotent retry observe
        // completion and clear the admission entry without a retained handle.
        let (probe_sender, probe_receiver) = shell_mailbox(ShellMailboxLimits::default());
        let admission_error = state
            .lock()
            .await
            .shell_admission
            .try_acquire(
                &session_id,
                probe_sender.cancellation(),
                ShellCompletion::new(),
            )
            .expect_err("the old generation must retain admission until it exits");
        assert!(admission_error.contains("still stopping"));
        drop((probe_sender, probe_receiver));

        release.store(true, Ordering::Release);
        tokio::time::timeout(
            Duration::from_secs(1),
            disconnect_ssh_on_state(&state, &session_id),
        )
        .await
        .expect("cleanup retry should observe detached worker completion")
        .expect("cleanup retry should succeed");
        assert_eq!(state.lock().await.shell_admission.active_count(), 0);
    }

    #[test]
    fn accept_new_trusts_only_first_seen_host_keys() {
        let mut config = tcp_test_config();
        config.strict_host_key_checking = true;
        config.accept_new_host_keys = true;

        assert!(SshService::should_accept_new_host_key(
            &config,
            ssh2::CheckResult::NotFound
        ));
        assert!(!SshService::should_accept_new_host_key(
            &config,
            ssh2::CheckResult::Mismatch
        ));
    }

    #[test]
    fn accept_new_persists_first_key_and_refuses_mismatch_without_overwrite() {
        let temp = tempfile::tempdir().unwrap();
        let known_hosts_path = temp.path().join("known_hosts");
        let known_hosts_path = known_hosts_path.to_string_lossy().to_string();
        let mut config = tcp_test_config();
        config.strict_host_key_checking = true;
        config.accept_new_host_keys = true;
        config.known_hosts_path = Some(known_hosts_path.clone());
        let first_key = b"first-fixture-host-key";
        let mut session = Session::new().unwrap();
        let service = empty_test_service();
        let persistence = HostKeyPersistenceContext {
            config: &config,
            known_hosts_path: &known_hosts_path,
            host_key: first_key,
            key_type: ssh2::HostKeyType::Ed25519,
            replace_existing: false,
        };

        service
            .persist_host_key(&mut session, &persistence)
            .unwrap();
        let before = std::fs::read(&known_hosts_path).unwrap();
        assert!(!before.is_empty());

        assert!(SshService::accept_new_mismatch_error(&config).contains("refusing to overwrite"));
        assert_eq!(std::fs::read(&known_hosts_path).unwrap(), before);
    }

    #[test]
    fn accept_new_does_not_treat_known_hosts_read_failures_as_first_use() {
        let temp = tempfile::tempdir().unwrap();
        let session = Session::new().unwrap();
        let mut known_hosts = session.known_hosts().unwrap();

        let missing = temp.path().join("missing-known-hosts");
        read_known_hosts_if_present(&mut known_hosts, &missing).unwrap();

        let directory = temp.path();
        let error = read_known_hosts_if_present(&mut known_hosts, directory).unwrap_err();
        assert_eq!(
            error,
            format!(
                "Failed to read known_hosts file {}: path is not a regular file",
                directory.display()
            )
        );
    }

    #[test]
    fn concurrent_first_use_persistence_preserves_both_hosts() {
        let temp = tempfile::tempdir().unwrap();
        let known_hosts_path = temp
            .path()
            .join("known_hosts")
            .to_string_lossy()
            .to_string();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));

        let handles: Vec<_> = [
            ("alpha.example.test", b"alpha-fixture-key".as_slice()),
            ("beta.example.test", b"beta-fixture-key".as_slice()),
        ]
        .into_iter()
        .map(|(host, key)| {
            let barrier = barrier.clone();
            let known_hosts_path = known_hosts_path.clone();
            std::thread::spawn(move || {
                let mut config = tcp_test_config();
                config.host = host.to_string();
                config.port = 22;
                config.known_hosts_path = Some(known_hosts_path.clone());
                let mut session = Session::new().unwrap();
                let service = empty_test_service();
                let persistence = HostKeyPersistenceContext {
                    config: &config,
                    known_hosts_path: &known_hosts_path,
                    host_key: key,
                    key_type: ssh2::HostKeyType::Ed25519,
                    replace_existing: false,
                };

                barrier.wait();
                service.persist_host_key(&mut session, &persistence)
            })
        })
        .collect();

        for handle in handles {
            handle.join().unwrap().unwrap();
        }

        let persisted = std::fs::read_to_string(known_hosts_path).unwrap();
        assert!(persisted.contains("alpha.example.test"));
        assert!(persisted.contains("beta.example.test"));
    }

    // ── Sentinel parsing ────────────────────────────────────────

    #[test]
    fn sentinel_extracts_exit_code_zero() {
        let raw = "hello world\n\n__SORNG_EXIT:0\n";
        let (stdout, code) = super::parse_script_stdout_and_exit(raw, -1);
        assert_eq!(stdout, "hello world");
        assert_eq!(code, 0);
    }

    #[test]
    fn sentinel_extracts_nonzero_exit_code() {
        let raw = "some output\n__SORNG_EXIT:42\n";
        let (stdout, code) = super::parse_script_stdout_and_exit(raw, -1);
        assert_eq!(stdout, "some output");
        assert_eq!(code, 42);
    }

    #[test]
    fn sentinel_uses_raw_exit_when_code_unparseable() {
        let raw = "output\n__SORNG_EXIT:NaN\n";
        let (stdout, code) = super::parse_script_stdout_and_exit(raw, 99);
        assert_eq!(stdout, "output");
        assert_eq!(code, 99);
    }

    #[test]
    fn sentinel_missing_falls_back_to_raw() {
        let raw = "just plain output\n";
        let (stdout, code) = super::parse_script_stdout_and_exit(raw, 5);
        assert_eq!(stdout, "just plain output\n");
        assert_eq!(code, 5);
    }

    #[test]
    fn sentinel_empty_stdout() {
        let raw = "__SORNG_EXIT:0\n";
        let (stdout, code) = super::parse_script_stdout_and_exit(raw, -1);
        assert_eq!(stdout, "");
        assert_eq!(code, 0);
    }

    #[test]
    fn sentinel_multiline_output_preserves_content() {
        let raw = "line1\nline2\nline3\n\n__SORNG_EXIT:0\n";
        let (stdout, code) = super::parse_script_stdout_and_exit(raw, -1);
        assert_eq!(stdout, "line1\nline2\nline3");
        assert_eq!(code, 0);
    }

    #[test]
    fn sentinel_uses_last_occurrence() {
        // If script output accidentally contains the sentinel pattern,
        // rfind ensures we use the last one (the real one).
        let raw = "fake: __SORNG_EXIT:99\nreal output\n__SORNG_EXIT:0\n";
        let (stdout, code) = super::parse_script_stdout_and_exit(raw, -1);
        assert_eq!(stdout, "fake: __SORNG_EXIT:99\nreal output");
        assert_eq!(code, 0);
    }

    #[test]
    fn shell_timeout_errors_are_treated_as_transient() {
        let error = std::io::Error::new(std::io::ErrorKind::TimedOut, "timed out");
        assert!(super::is_transient_shell_io_error(&error));
    }

    #[test]
    fn shell_socket_timeout_message_is_treated_as_transient() {
        let error = std::io::Error::other("Timed out waiting on socket");
        assert!(super::is_transient_shell_io_error(&error));
    }

    #[test]
    fn unrelated_shell_errors_are_not_treated_as_transient() {
        let error = std::io::Error::new(std::io::ErrorKind::ConnectionReset, "connection reset");
        assert!(!super::is_transient_shell_io_error(&error));
    }

    #[test]
    fn shell_close_event_marks_requested_close_as_intentional() {
        let event = super::shell_closed_event(
            "session-requested".to_string(),
            SshShellCloseReason::Requested,
            None,
        );

        assert!(!event.recoverable);
        assert_eq!(
            serde_json::to_value(event).expect("serialize requested close"),
            json!({
                "session_id": "session-requested",
                "reason": "requested",
                "recoverable": false,
                "message": null
            })
        );
    }

    #[test]
    fn shell_close_event_marks_transport_failure_as_recoverable() {
        let event = super::shell_closed_event(
            "session-transport".to_string(),
            SshShellCloseReason::TransportError,
            Some("transport read".to_string()),
        );

        assert!(event.recoverable);
        assert_eq!(
            serde_json::to_value(event).expect("serialize transport close"),
            json!({
                "session_id": "session-transport",
                "reason": "transport_error",
                "recoverable": true,
                "message": "transport read"
            })
        );
    }

    #[test]
    fn zero_keepalive_interval_uses_safe_tcp_default() {
        assert_eq!(
            super::normalized_keepalive_interval(Some(0)),
            Duration::from_secs(DEFAULT_TCP_KEEPALIVE_INTERVAL_SECS)
        );
    }

    #[test]
    fn keepalive_probe_count_is_bounded_to_socket_contract() {
        assert_eq!(super::normalized_keepalive_probes(0), 1);
        assert_eq!(super::normalized_keepalive_probes(3), 3);
        assert_eq!(
            super::normalized_keepalive_probes(u32::MAX),
            MAX_TCP_KEEPALIVE_PROBES
        );
    }

    #[test]
    fn configured_tcp_keepalive_is_applied_and_can_be_disabled() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback listener");
        let client = TcpStream::connect(listener.local_addr().expect("listener address"))
            .expect("connect loopback client");
        let (_server, _) = listener.accept().expect("accept loopback client");
        let mut config = tcp_test_config();
        config.tcp_keepalive = true;
        config.keep_alive_interval = Some(30);
        config.keepalive_probes = 7;

        super::configure_tcp_options(&client, &config);
        assert!(SockRef::from(&client)
            .keepalive()
            .expect("read enabled keepalive"));

        #[cfg(windows)]
        {
            use windows_sys::Win32::Networking::WinSock::{
                getsockopt, IPPROTO_TCP, SOCKET_ERROR, TCP_KEEPCNT,
            };

            let mut probes = 0u32;
            let mut probes_len = std::mem::size_of_val(&probes) as i32;
            let result = unsafe {
                getsockopt(
                    client.as_raw_socket() as usize,
                    IPPROTO_TCP,
                    TCP_KEEPCNT,
                    (&mut probes as *mut u32).cast(),
                    &mut probes_len,
                )
            };
            assert_ne!(
                result,
                SOCKET_ERROR,
                "read Windows TCP_KEEPCNT: {}",
                std::io::Error::last_os_error()
            );
            assert_eq!(probes, 7);
        }

        config.tcp_keepalive = false;
        super::configure_tcp_options(&client, &config);
        assert!(!SockRef::from(&client)
            .keepalive()
            .expect("read disabled keepalive"));
    }

    #[test]
    fn finished_shell_handles_are_not_reported_active_and_are_pruned() {
        let mut service = empty_test_service();
        let session_id = "finished-shell";
        let (sender, receiver) = shell_mailbox(ShellMailboxLimits::default());
        let completion = ShellCompletion::new();
        let lease = service
            .shell_admission
            .try_acquire(session_id, sender.cancellation(), Arc::clone(&completion))
            .unwrap();
        let generation = lease.generation();
        let completion_for_thread = Arc::clone(&completion);
        let thread = std::thread::spawn(move || {
            let _lease = lease;
            let guard = ShellWorkerCompletionGuard::new(completion_for_thread);
            drop(receiver);
            guard.complete();
        });
        service.shells.insert(
            session_id.to_string(),
            SshShellHandle {
                id: "shell-id".to_string(),
                sender,
                thread,
                suspend_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                completion,
                generation,
            },
        );
        while !service.shells[session_id].is_finished() {
            std::thread::yield_now();
        }

        assert_eq!(service.active_shell_id(session_id), None);
        service.prune_finished_shell(session_id);
        assert!(!service.shells.contains_key(session_id));
    }

    #[tokio::test]
    async fn stop_shell_waits_for_actor_exit_before_reporting_success() {
        let mut service = empty_test_service();
        let session_id = "stoppable-shell";
        let (sender, receiver) = shell_mailbox(ShellMailboxLimits::default());
        let completion = ShellCompletion::new();
        let lease = service
            .shell_admission
            .try_acquire(session_id, sender.cancellation(), Arc::clone(&completion))
            .unwrap();
        let generation = lease.generation();
        let completion_for_thread = Arc::clone(&completion);
        let thread = std::thread::spawn(move || {
            let _lease = lease;
            let guard = ShellWorkerCompletionGuard::new(completion_for_thread);
            while !receiver.close_requested() {
                std::thread::yield_now();
            }
            guard.complete();
        });
        service.shells.insert(
            session_id.to_string(),
            SshShellHandle {
                id: "shell-id".to_string(),
                sender,
                thread,
                suspend_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                completion,
                generation,
            },
        );

        service
            .stop_shell(session_id)
            .await
            .expect("shell actor should stop");
        assert!(!service.shells.contains_key(session_id));
    }

    #[test]
    fn sentinel_negative_exit_code() {
        let raw = "output\n__SORNG_EXIT:-1\n";
        let (_stdout, code) = super::parse_script_stdout_and_exit(raw, 0);
        assert_eq!(code, -1);
    }

    // ── Shebang insertion ───────────────────────────────────────

    #[test]
    fn shebang_inserted_for_bash() {
        let result = super::prepare_uploaded_script("echo hello", "bash");
        assert!(result.starts_with("#!/usr/bin/env bash\n"));
        assert!(result.contains("echo hello"));
    }

    #[test]
    fn shebang_inserted_for_python() {
        let result = super::prepare_uploaded_script("print('hi')", "python3");
        assert!(result.starts_with("#!/usr/bin/env python3\n"));
    }

    #[test]
    fn shebang_inserted_for_sh() {
        let result = super::prepare_uploaded_script("ls -la", "sh");
        assert!(result.starts_with("#!/bin/sh\n"));
    }

    #[test]
    fn shebang_inserted_for_perl() {
        let result = super::prepare_uploaded_script("print 42", "perl");
        assert!(result.starts_with("#!/usr/bin/env perl\n"));
    }

    #[test]
    fn shebang_inserted_for_powershell() {
        let result = super::prepare_uploaded_script("Get-Process", "powershell");
        assert!(result.starts_with("#!/usr/bin/env pwsh\n"));
    }

    #[test]
    fn shebang_not_duplicated_if_present() {
        let script = "#!/bin/bash\necho hello";
        let result = super::prepare_uploaded_script(script, "bash");
        assert_eq!(result, script);
        // Should NOT double-shebang
        assert_eq!(result.matches("#!").count(), 1);
    }

    #[test]
    fn custom_interpreter_path_used_as_is() {
        let result = super::prepare_uploaded_script("puts 'hi'", "/usr/local/bin/ruby");
        assert!(result.starts_with("#!/usr/local/bin/ruby\n"));
    }

    // ── Invocation fallback logic ───────────────────────────────

    #[test]
    fn bash_invocation_falls_back_to_sh() {
        let command = super::build_script_invocation("/tmp/test-script", "bash");
        assert!(command.contains("command -v bash"));
        assert!(command.contains("command -v sh"));
        assert!(command.contains("sh /tmp/test-script"));
    }

    #[test]
    fn sh_invocation_prefers_sh() {
        let command = super::build_script_invocation("/tmp/test-script", "sh");
        assert!(command.contains("command -v sh"));
        assert!(!command.contains("command -v bash"));
    }

    #[test]
    fn powershell_invocation_prefers_pwsh_and_falls_back_to_powershell() {
        let command = super::build_script_invocation("/tmp/test-script", "powershell");
        assert!(command.contains("command -v pwsh"));
        assert!(command.contains("command -v powershell"));
        assert!(command.contains("-File /tmp/test-script"));
    }

    // ── ScriptExecutionResult ───────────────────────────────────

    #[test]
    fn script_execution_result_serializes_to_camel_case() {
        let result = ScriptExecutionResult {
            stdout: "ok".into(),
            stderr: "".into(),
            exit_code: 0,
            remote_path: "/tmp/x".into(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"exitCode\""));
        assert!(json.contains("\"remotePath\""));
        assert!(!json.contains("\"exit_code\""));
        assert!(!json.contains("\"remote_path\""));
    }

    #[test]
    fn script_execution_result_deserializes_from_camel_case() {
        let json = r#"{"stdout":"out","stderr":"err","exitCode":1,"remotePath":"/tmp/y"}"#;
        let result: ScriptExecutionResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.stdout, "out");
        assert_eq!(result.stderr, "err");
        assert_eq!(result.exit_code, 1);
        assert_eq!(result.remote_path, "/tmp/y");
    }

    // ── Port-forward bind policy (t6 #10: loopback-default + opt-in) ─────

    use crate::ssh::types::{PortForwardConfig, PortForwardDirection};

    fn forward_config(local_host: &str, allow_non_loopback_bind: bool) -> PortForwardConfig {
        PortForwardConfig {
            local_host: local_host.to_string(),
            local_port: 8080,
            remote_host: "db.internal".to_string(),
            remote_port: 3306,
            direction: PortForwardDirection::Local,
            allow_non_loopback_bind,
        }
    }

    #[test]
    fn forward_bind_loopback_is_allowed() {
        let cfg = forward_config("127.0.0.1", false);
        assert_eq!(
            super::SshService::resolve_forward_bind(&cfg).unwrap(),
            "127.0.0.1"
        );
    }

    #[test]
    fn forward_bind_ipv6_loopback_and_localhost_allowed() {
        assert_eq!(
            super::SshService::resolve_forward_bind(&forward_config("::1", false)).unwrap(),
            "::1"
        );
        assert_eq!(
            super::SshService::resolve_forward_bind(&forward_config("localhost", false)).unwrap(),
            "localhost"
        );
    }

    #[test]
    fn forward_bind_empty_host_defaults_to_loopback() {
        let cfg = forward_config("", false);
        assert_eq!(
            super::SshService::resolve_forward_bind(&cfg).unwrap(),
            "127.0.0.1"
        );
    }

    #[test]
    fn forward_bind_non_loopback_rejected_without_optin() {
        for host in ["0.0.0.0", "::", "192.168.1.50", "10.0.0.1"] {
            let cfg = forward_config(host, false);
            let err = super::SshService::resolve_forward_bind(&cfg)
                .expect_err("non-loopback bind without opt-in must be rejected");
            assert!(err.contains(host), "error should name the host: {err}");
            assert!(
                err.contains("allow_non_loopback_bind"),
                "error should explain how to opt in: {err}"
            );
        }
    }

    #[test]
    fn forward_bind_non_loopback_allowed_with_optin() {
        let cfg = forward_config("0.0.0.0", true);
        assert_eq!(
            super::SshService::resolve_forward_bind(&cfg).unwrap(),
            "0.0.0.0"
        );
    }
}
