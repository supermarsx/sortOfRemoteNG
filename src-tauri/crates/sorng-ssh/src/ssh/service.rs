use chrono::Utc;
use secrecy::{ExposeSecret, SecretString};
use socket2::{SockRef, TcpKeepalive};
use sorng_core::events::DynEventEmitter;
use ssh2::{ErrorCode as SshErrorCode, KeyboardInteractivePrompt, MethodType, Prompt, Session};
use std::collections::HashMap;
use std::future::Future;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
#[cfg(windows)]
use std::os::windows::io::AsRawSocket;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream as AsyncTcpStream;
use tokio::sync::{mpsc, Notify};
use uuid::Uuid;

use super::automation::process_automation_output;
use super::highlighting::process_highlight_output;
use super::recording::{record_input, record_output, record_resize};
use super::types::*;
use super::{MAX_BUFFER_SIZE, PENDING_HOST_KEY_PROMPTS, TERMINAL_BUFFERS};

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
const SCRIPT_EXECUTION_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const SCRIPT_CHANNEL_CLEANUP_TIMEOUT_MS: u32 = 5_000;
const SCRIPT_OUTPUT_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const SCRIPT_OUTPUT_LIMIT_ERROR: &str = "Remote script output exceeded the 4 MiB safety limit";
const SCRIPT_OUTPUT_READ_POLL_INTERVAL: Duration = Duration::from_millis(2);

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

#[derive(Debug)]
struct PendingSshConnection {
    cancelled: AtomicBool,
    cancellation_notify: Notify,
}

impl PendingSshConnection {
    fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            cancellation_notify: Notify::new(),
        }
    }

    fn cancel(&self) {
        if !self.cancelled.swap(true, Ordering::AcqRel) {
            self.cancellation_notify.notify_one();
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    async fn cancelled(&self) {
        if !self.is_cancelled() {
            self.cancellation_notify.notified().await;
        }
    }
}

type PendingSshConnections =
    std::sync::Arc<StdMutex<HashMap<String, std::sync::Arc<PendingSshConnection>>>>;

fn cleanup_pending_connection_artifacts(session_id: &str) {
    if let Ok(mut pending_prompts) = PENDING_HOST_KEY_PROMPTS.lock() {
        pending_prompts.remove(session_id);
    }
    let _ = super::proxy_command::stop_proxy_command(session_id);
}

struct SshConnectionAttempt {
    session_id: String,
    cancellation: std::sync::Arc<PendingSshConnection>,
    pending_connections: PendingSshConnections,
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

    fn finish(mut self) -> bool {
        let cancelled = self.cancellation.is_cancelled();
        self.unregister();
        cancelled
    }
}

impl Drop for SshConnectionAttempt {
    fn drop(&mut self) {
        if self.registered {
            self.cancellation.cancel();
            self.unregister();
            cleanup_pending_connection_artifacts(&self.session_id);
        }
    }
}

struct SshConnectionSetupGuard {
    session_id: String,
    armed: bool,
}

impl SshConnectionSetupGuard {
    fn new(session_id: String) -> Self {
        Self {
            session_id,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for SshConnectionSetupGuard {
    fn drop(&mut self) {
        if self.armed {
            cleanup_pending_connection_artifacts(&self.session_id);
        }
    }
}

struct EstablishedSshConnection {
    session_id: String,
    session: Option<SshSession>,
}

impl Drop for EstablishedSshConnection {
    fn drop(&mut self) {
        let Some(mut session) = self.session.take() else {
            return;
        };

        if let Some(handle) = session.keep_alive_handle.take() {
            handle.abort();
        }
        for (_, forward) in session.port_forwards.drain() {
            forward.handle.abort();
        }

        drop(session.session);
        while let Some(intermediate) = session.intermediate_sessions.pop() {
            drop(intermediate);
        }
        for handle in session.bridge_handles.drain(..) {
            if handle.is_finished() {
                let _ = handle.join();
            }
        }

        cleanup_pending_connection_artifacts(&self.session_id);
    }
}

pub struct SshService {
    pub sessions: HashMap<String, SshSession>,
    #[allow(dead_code)]
    connection_pool: HashMap<String, Vec<SshSession>>,
    #[allow(dead_code)]
    known_hosts: HashMap<String, String>,
    pub shells: HashMap<String, SshShellHandle>,
    pub event_emitter: Option<DynEventEmitter>,
    pending_connections: PendingSshConnections,
}

impl SshService {
    pub fn new() -> SshServiceState {
        std::sync::Arc::new(tokio::sync::Mutex::new(SshService {
            sessions: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: None,
            pending_connections: std::sync::Arc::new(StdMutex::new(HashMap::new())),
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> SshServiceState {
        std::sync::Arc::new(tokio::sync::Mutex::new(SshService {
            sessions: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: Some(emitter),
            pending_connections: std::sync::Arc::new(StdMutex::new(HashMap::new())),
        }))
    }

    fn begin_connection_attempt(&self) -> Result<(Self, SshConnectionAttempt), String> {
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
        let cancellation = std::sync::Arc::new(PendingSshConnection::new());
        pending.insert(session_id.clone(), cancellation.clone());
        drop(pending);

        let connector = Self {
            sessions: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: self.known_hosts.clone(),
            shells: HashMap::new(),
            event_emitter: self.event_emitter.clone(),
            pending_connections: self.pending_connections.clone(),
        };
        let attempt = SshConnectionAttempt {
            session_id,
            cancellation,
            pending_connections: self.pending_connections.clone(),
            registered: true,
        };

        Ok((connector, attempt))
    }

    fn cancel_pending_connection(&self, session_id: &str) -> Result<bool, String> {
        let pending = self
            .pending_connections
            .lock()
            .map_err(|_| "Failed to lock pending SSH connections".to_string())?
            .get(session_id)
            .cloned();

        if let Some(pending) = pending {
            pending.cancel();
            cleanup_pending_connection_artifacts(session_id);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn adopt_connection(
        &mut self,
        mut connection: EstablishedSshConnection,
    ) -> Result<String, String> {
        if self.sessions.contains_key(&connection.session_id) {
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

    pub async fn connect_ssh(&mut self, config: SshConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();
        let connection = self.establish_ssh_connection(session_id, config).await?;
        self.adopt_connection(connection)
    }

    async fn establish_ssh_connection(
        &mut self,
        session_id: String,
        config: SshConnectionConfig,
    ) -> Result<EstablishedSshConnection, String> {
        let mut setup_guard = SshConnectionSetupGuard::new(session_id.clone());

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
                    let s = super::proxy_command::spawn_proxy_command(
                        &session_id,
                        proxy_cmd,
                        &config.host,
                        config.port,
                        &config.username,
                        config.connect_timeout.unwrap_or(15),
                    )?;
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

        // Configure both application-level SSH keepalives and operating-system
        // TCP keepalives. The latter was previously represented in the config
        // but never applied to the socket.
        configure_tcp_options(&final_stream, &config);

        let timeout_secs = config.connect_timeout.unwrap_or(15);
        final_stream
            .set_read_timeout(Some(Duration::from_secs(timeout_secs * 2)))
            .ok();
        final_stream
            .set_write_timeout(Some(Duration::from_secs(timeout_secs)))
            .ok();

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

        sess.handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        if config.strict_host_key_checking {
            self.verify_host_key(&session_id, &mut sess, &config)
                .await?;
        }

        self.authenticate_session(&mut sess, &config)?;

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
        })
    }

    pub async fn establish_direct_connection(
        &self,
        config: &SshConnectionConfig,
    ) -> Result<TcpStream, String> {
        if let Some(proxy_config) = &config.proxy_config {
            return self.establish_proxy_connection(config, proxy_config).await;
        }

        let addr = format!("{}:{}", config.host, config.port);
        let timeout = config.connect_timeout.unwrap_or(15);

        let async_stream =
            tokio::time::timeout(Duration::from_secs(timeout), AsyncTcpStream::connect(&addr))
                .await
                .map_err(|_| {
                    format!(
                        "Connection timeout after {} seconds - host may be unreachable",
                        timeout
                    )
                })?
                .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;

        let std_stream = async_stream
            .into_std()
            .map_err(|e| format!("Failed to convert async stream: {}", e))?;

        std_stream
            .set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

        Ok(std_stream)
    }

    pub async fn establish_proxy_connection(
        &self,
        config: &SshConnectionConfig,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        let timeout = Duration::from_secs(config.connect_timeout.unwrap_or(15));

        let proxy_addr = format!("{}:{}", proxy_config.host, proxy_config.port);
        let proxy_stream = tokio::time::timeout(timeout, AsyncTcpStream::connect(&proxy_addr))
            .await
            .map_err(|_| format!("Proxy connection timeout to {}", proxy_addr))?
            .map_err(|e| format!("Failed to connect to proxy {}: {}", proxy_addr, e))?;

        let target = format!("{}:{}", config.host, config.port);

        match &proxy_config.proxy_type {
            ProxyType::Socks5 => {
                self.connect_through_socks5(proxy_stream, &target, proxy_config)
                    .await
            }
            ProxyType::Socks4 => {
                self.connect_through_socks4(proxy_stream, &target, proxy_config)
                    .await
            }
            ProxyType::Http | ProxyType::Https => {
                self.connect_through_http_proxy(proxy_stream, &target, proxy_config)
                    .await
            }
        }
    }

    pub async fn connect_through_socks5(
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
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

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
        let mut response_line = String::new();
        reader
            .read_line(&mut response_line)
            .await
            .map_err(|e| format!("Failed to read HTTP response: {}", e))?;

        let parts: Vec<&str> = response_line.split_whitespace().collect();
        if parts.len() < 2 {
            return Err("Invalid HTTP proxy response".to_string());
        }

        let status_code: u16 = parts[1]
            .parse()
            .map_err(|_| "Invalid HTTP status code".to_string())?;

        if status_code != 200 {
            return Err(format!("HTTP proxy returned status {}", status_code));
        }

        loop {
            let mut header_line = String::new();
            reader
                .read_line(&mut header_line)
                .await
                .map_err(|e| format!("Failed to read HTTP headers: {}", e))?;
            if header_line.trim().is_empty() {
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
    pub async fn establish_proxy_chain_connection(
        &self,
        config: &SshConnectionConfig,
        chain_config: &ProxyChainConfig,
    ) -> Result<TcpStream, String> {
        if chain_config.proxies.is_empty() {
            return Err("Proxy chain is empty".to_string());
        }

        match chain_config.mode {
            ProxyChainMode::Strict => {
                self.establish_strict_proxy_chain(config, chain_config)
                    .await
            }
            ProxyChainMode::Dynamic => {
                self.establish_dynamic_proxy_chain(config, chain_config)
                    .await
            }
            ProxyChainMode::Random => self.establish_random_proxy(config, chain_config).await,
        }
    }

    async fn establish_strict_proxy_chain(
        &self,
        config: &SshConnectionConfig,
        chain_config: &ProxyChainConfig,
    ) -> Result<TcpStream, String> {
        if chain_config.proxies.len() == 1 {
            return self
                .establish_proxy_connection(config, &chain_config.proxies[0])
                .await;
        }

        let first_proxy = &chain_config.proxies[0];
        let timeout = Duration::from_secs(config.connect_timeout.unwrap_or(15));

        let proxy_addr = format!("{}:{}", first_proxy.host, first_proxy.port);
        let mut current_stream =
            tokio::time::timeout(timeout, AsyncTcpStream::connect(&proxy_addr))
                .await
                .map_err(|_| format!("Proxy chain timeout connecting to {}", proxy_addr))?
                .map_err(|e| format!("Failed to connect to first proxy {}: {}", proxy_addr, e))?;

        for (i, proxy) in chain_config.proxies.iter().skip(1).enumerate() {
            let target = if i == chain_config.proxies.len() - 2 {
                format!("{}:{}", config.host, config.port)
            } else {
                format!("{}:{}", proxy.host, proxy.port)
            };

            current_stream = self
                .socks5_connect_internal(current_stream, &target, first_proxy)
                .await
                .map_err(|e| format!("Chain hop {} failed: {}", i + 1, e))?
                .0;
        }

        let final_target = format!("{}:{}", config.host, config.port);
        let last_proxy = chain_config
            .proxies
            .last()
            .expect("chain_config.proxies checked non-empty");

        let std_stream = self
            .connect_through_socks5(current_stream, &final_target, last_proxy)
            .await?;
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
    ) -> Result<TcpStream, String> {
        let mut last_error = String::from("No proxies available");

        for proxy in &chain_config.proxies {
            match self.establish_proxy_connection(config, proxy).await {
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
    ) -> Result<TcpStream, String> {
        use rand::Rng;

        let index = {
            let mut rng = rand::rngs::OsRng;
            rng.gen_range(0..chain_config.proxies.len())
        };

        let proxy = &chain_config.proxies[index];
        self.establish_proxy_connection(config, proxy).await
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

        let stream =
            TcpStream::connect(local_addr).map_err(|e| format!("Bridge connect failed: {}", e))?;
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

        let mut intermediate_sessions: Vec<Session> = Vec::new();
        let mut bridge_handles: Vec<std::thread::JoinHandle<()>> = Vec::new();

        // 1. TCP-connect to the first jump host
        let first = &config.jump_hosts[0];
        let addr = format!("{}:{}", first.host, first.port);
        let timeout = config.connect_timeout.unwrap_or(15);
        let async_stream =
            tokio::time::timeout(Duration::from_secs(timeout), AsyncTcpStream::connect(&addr))
                .await
                .map_err(|_| format!("Timeout connecting to first jump host {}", addr))?
                .map_err(|e| format!("Failed to connect to first jump host {}: {}", addr, e))?;

        let current_stream = async_stream
            .into_std()
            .map_err(|e| format!("Stream conversion failed: {}", e))?;
        current_stream
            .set_nonblocking(false)
            .map_err(|e| format!("set_nonblocking failed: {}", e))?;

        // 2. SSH session on first jump host
        let mut sess =
            Session::new().map_err(|e| format!("Failed to create jump session: {}", e))?;
        Self::apply_jump_cipher_prefs(&mut sess, first);
        sess.set_tcp_stream(current_stream);
        sess.handshake()
            .map_err(|e| format!("Jump host {} handshake failed: {}", first.host, e))?;
        self.authenticate_jump_session(&mut sess, first)?;

        // 3. Chain through remaining jump hosts
        for (i, jump) in config.jump_hosts.iter().skip(1).enumerate() {
            log::info!(
                "Chaining through jump host {}: {}:{}",
                i + 1,
                jump.host,
                jump.port
            );

            let channel = sess
                .channel_direct_tcpip(&jump.host, jump.port, None)
                .map_err(|e| {
                    format!(
                        "channel_direct_tcpip to {}:{} failed: {}",
                        jump.host, jump.port, e
                    )
                })?;

            // Switch session to non-blocking so the bridge thread can poll
            sess.set_blocking(false);
            let (bridged, handle) = Self::bridge_channel_to_stream(channel)?;
            bridge_handles.push(handle);
            intermediate_sessions.push(sess);

            sess = Session::new().map_err(|e| format!("Failed to create jump session: {}", e))?;
            Self::apply_jump_cipher_prefs(&mut sess, jump);
            sess.set_tcp_stream(bridged);
            sess.handshake()
                .map_err(|e| format!("Jump host {} handshake failed: {}", jump.host, e))?;
            self.authenticate_jump_session(&mut sess, jump)?;
        }

        // 4. Final tunnel to the actual target
        log::info!(
            "Final tunnel through last jump host to {}:{}",
            config.host,
            config.port
        );
        let channel = sess
            .channel_direct_tcpip(&config.host, config.port, None)
            .map_err(|e| {
                format!(
                    "channel_direct_tcpip to {}:{} failed: {}",
                    config.host, config.port, e
                )
            })?;

        sess.set_blocking(false);
        let (final_stream, handle) = Self::bridge_channel_to_stream(channel)?;
        bridge_handles.push(handle);
        intermediate_sessions.push(sess);

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

        let mut intermediate_sessions: Vec<Session> = Vec::new();
        let mut bridge_handles: Vec<std::thread::JoinHandle<()>> = Vec::new();

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
        let timeout = config.connect_timeout.unwrap_or(15);
        let first_stream = tokio::time::timeout(
            Duration::from_secs(timeout),
            AsyncTcpStream::connect(format!("{}:{}", first_addr.0, first_addr.1)),
        )
        .await
        .map_err(|_| {
            format!(
                "Timeout connecting to first chain hop {}:{}",
                first_addr.0, first_addr.1
            )
        })?
        .map_err(|e| format!("Failed to connect to first chain hop: {}", e))?;

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
                    match proxy.proxy_type {
                        ProxyType::Socks5 => {
                            let (s, _) = self
                                .socks5_connect_internal(async_stream, &target_str, proxy)
                                .await?;
                            current = MixedStream::Async(s);
                        }
                        ProxyType::Http | ProxyType::Https => {
                            let std_s = self
                                .connect_through_http_proxy(async_stream, &target_str, proxy)
                                .await?;
                            current = MixedStream::Sync(std_s);
                        }
                        ProxyType::Socks4 => {
                            let std_s = self
                                .connect_through_socks4(async_stream, &target_str, proxy)
                                .await?;
                            current = MixedStream::Sync(std_s);
                        }
                    }
                }
                ChainHop::SshJump(jump) => {
                    let std_stream = current.into_sync()?;

                    let mut sess =
                        Session::new().map_err(|e| format!("Session::new failed: {}", e))?;
                    Self::apply_jump_cipher_prefs(&mut sess, jump);
                    sess.set_tcp_stream(std_stream);
                    sess.handshake()
                        .map_err(|e| format!("SSH jump {} handshake failed: {}", jump.host, e))?;
                    self.authenticate_jump_session(&mut sess, jump)?;

                    let channel = sess
                        .channel_direct_tcpip(target_host, *target_port, None)
                        .map_err(|e| {
                            format!("channel_direct_tcpip to {} failed: {}", target_str, e)
                        })?;

                    sess.set_blocking(false);
                    let (bridged, handle) = Self::bridge_channel_to_stream(channel)?;
                    bridge_handles.push(handle);
                    intermediate_sessions.push(sess);

                    current = MixedStream::Sync(bridged);
                }
            }
        }

        let final_stream = current.into_sync()?;
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
        &self,
        session: &mut Session,
        config: &SshConnectionConfig,
    ) -> Result<(), String> {
        // Try public key authentication first if key is provided
        if let Some(private_key_path) = &config.private_key_path {
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
            }
        }

        // Try password authentication if password is provided
        if let Some(password) = &config.password {
            if session
                .userauth_password(&config.username, password.expose_secret())
                .is_ok()
            {
                return Ok(());
            }
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

            if session
                .userauth_keyboard_interactive(&config.username, &mut handler)
                .is_ok()
            {
                return Ok(());
            }
        }

        // Try agent authentication
        if session.userauth_agent(&config.username).is_ok() {
            return Ok(());
        }

        Err("All authentication methods failed".to_string())
    }

    fn authenticate_jump_session(
        &self,
        session: &mut Session,
        jump_config: &JumpHostConfig,
    ) -> Result<(), String> {
        // 1. Public key
        if let Some(private_key_path) = &jump_config.private_key_path {
            let passphrase = jump_config
                .private_key_passphrase
                .as_ref()
                .map(|secret| secret.expose_secret().as_str());
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
        }

        // 2. Password
        if let Some(password) = &jump_config.password {
            if session
                .userauth_password(&jump_config.username, password.expose_secret())
                .is_ok()
            {
                return Ok(());
            }
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

            if session
                .userauth_keyboard_interactive(&jump_config.username, &mut handler)
                .is_ok()
            {
                return Ok(());
            }
        }

        // 4. SSH agent
        if session.userauth_agent(&jump_config.username).is_ok() {
            return Ok(());
        }

        Err("All jump host authentication methods failed".to_string())
    }

    pub async fn update_session_auth(
        &mut self,
        session_id: &str,
        password: Option<String>,
        private_key_path: Option<String>,
        private_key_passphrase: Option<String>,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        if let Some(password) = password {
            session.config.password = Some(SecretString::new(password));
        }

        if let Some(private_key_path) = private_key_path {
            session.config.private_key_path = Some(private_key_path);
        }

        if let Some(passphrase) = private_key_passphrase {
            session.config.private_key_passphrase = Some(SecretString::new(passphrase));
        }

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

    pub async fn test_ssh_connection(&self, config: SshConnectionConfig) -> Result<String, String> {
        // Use the same priority as connect_ssh (including ProxyCommand)
        let (final_stream, _intermediate, _handles) =
            if let Some(ref proxy_cmd) = config.proxy_command {
                if proxy_cmd.command.is_some() || proxy_cmd.template.is_some() {
                    let s = super::proxy_command::spawn_proxy_command(
                        &uuid::Uuid::new_v4().to_string(),
                        proxy_cmd,
                        &config.host,
                        config.port,
                        &config.username,
                        config.connect_timeout.unwrap_or(15),
                    )?;
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

        let mut sess =
            Session::new().map_err(|e| format!("Failed to create test session: {}", e))?;
        sess.set_tcp_stream(final_stream);
        sess.handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        self.authenticate_session(&mut sess, &config)?;

        // _intermediate sessions and _handles will be dropped, cleaning up the tunnel.
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
        if stdin_data.as_ref().map_or(false, |data| {
            data.0.len() > super::integration::MAX_COMMAND_INPUT_LIMIT_BYTES
        }) {
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

        let (tx, mut rx) = mpsc::unbounded_channel::<SshShellCommand>();
        let shell_id = Uuid::new_v4().to_string();
        let session_id_owned = session_id.to_string();
        let emitter = event_emitter.clone();
        let suspend_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let shell_suspend_count = std::sync::Arc::clone(&suspend_count);

        let thread = std::thread::spawn(move || {
            let mut buffer = [0u8; 16384];
            let mut running = true;
            let mut close_reason = SshShellCloseReason::RemoteEof;
            let mut close_message: Option<String> = None;
            let mut idle_count: u32 = 0;
            const MIN_SLEEP_MS: u64 = 1;
            const MAX_SLEEP_MS: u64 = 10;
            const IDLE_THRESHOLD: u32 = 10;

            while running {
                while let Ok(cmd) = rx.try_recv() {
                    match cmd {
                        SshShellCommand::Input(data) => {
                            record_input(&session_id_owned, &data);

                            if let Err(error) = channel.write_all(data.as_bytes()) {
                                let message = error.to_string();
                                let payload = SshShellError {
                                    session_id: session_id_owned.clone(),
                                    message: message.clone(),
                                };
                                let _ = emitter.emit_event(
                                    "ssh-error",
                                    serde_json::to_value(&payload).unwrap_or_default(),
                                );
                                close_reason = SshShellCloseReason::TransportError;
                                close_message = Some(message);
                                running = false;
                                break;
                            }
                            if let Err(error) = channel.flush() {
                                let message = error.to_string();
                                let payload = SshShellError {
                                    session_id: session_id_owned.clone(),
                                    message: message.clone(),
                                };
                                let _ = emitter.emit_event(
                                    "ssh-error",
                                    serde_json::to_value(&payload).unwrap_or_default(),
                                );
                                close_reason = SshShellCloseReason::TransportError;
                                close_message = Some(message);
                                running = false;
                                break;
                            }
                            idle_count = 0;
                        }
                        SshShellCommand::SecretInput(data) => {
                            if let Err(error) = channel.write_all(data.as_bytes()) {
                                let message = error.to_string();
                                let payload = SshShellError {
                                    session_id: session_id_owned.clone(),
                                    message: message.clone(),
                                };
                                let _ = emitter.emit_event(
                                    "ssh-error",
                                    serde_json::to_value(&payload).unwrap_or_default(),
                                );
                                close_reason = SshShellCloseReason::TransportError;
                                close_message = Some(message);
                                running = false;
                                break;
                            }
                            if let Err(error) = channel.flush() {
                                let message = error.to_string();
                                let payload = SshShellError {
                                    session_id: session_id_owned.clone(),
                                    message: message.clone(),
                                };
                                let _ = emitter.emit_event(
                                    "ssh-error",
                                    serde_json::to_value(&payload).unwrap_or_default(),
                                );
                                close_reason = SshShellCloseReason::TransportError;
                                close_message = Some(message);
                                running = false;
                                break;
                            }
                            idle_count = 0;
                        }
                        SshShellCommand::Resize(cols, rows) => {
                            record_resize(&session_id_owned, cols, rows);
                            let _ = channel.request_pty_size(cols, rows, None, None);
                        }
                        SshShellCommand::Close => {
                            close_reason = SshShellCloseReason::Requested;
                            close_message = None;
                            let _ = channel.close();
                            let _ = channel.wait_close();
                            running = false;
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
                        let raw_output = String::from_utf8_lossy(&buffer[..bytes]).to_string();
                        idle_count = 0;

                        // Record and automate against the raw (unhighlighted) output
                        record_output(&session_id_owned, &raw_output);
                        process_automation_output(&session_id_owned, &raw_output);

                        // Apply regex-based syntax highlighting (injects ANSI SGR codes)
                        let output = process_highlight_output(&session_id_owned, &raw_output);

                        if let Ok(mut buffers) = TERMINAL_BUFFERS.lock() {
                            let session_buffer = buffers
                                .entry(session_id_owned.clone())
                                .or_insert_with(String::new);
                            session_buffer.push_str(&output);
                            if session_buffer.len() > MAX_BUFFER_SIZE {
                                let excess = session_buffer.len() - MAX_BUFFER_SIZE;
                                *session_buffer = session_buffer[excess..].to_string();
                            }
                        }

                        let payload = SshShellOutput {
                            session_id: session_id_owned.clone(),
                            data: output,
                        };
                        let _ = emitter.emit_event(
                            "ssh-output",
                            serde_json::to_value(&payload).unwrap_or_default(),
                        );
                    }
                    Ok(_) => {
                        idle_count = idle_count.saturating_add(1);
                    }
                    Err(error) if is_transient_shell_io_error(&error) => {
                        idle_count = idle_count.saturating_add(1);
                    }
                    Err(error) => {
                        let message = error.to_string();
                        let payload = SshShellError {
                            session_id: session_id_owned.clone(),
                            message: message.clone(),
                        };
                        let _ = emitter.emit_event(
                            "ssh-error",
                            serde_json::to_value(&payload).unwrap_or_default(),
                        );
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

            let payload = shell_closed_event(session_id_owned, close_reason, close_message);
            let _ = emitter.emit_event(
                "ssh-shell-closed",
                serde_json::to_value(&payload).unwrap_or_default(),
            );
        });

        self.shells.insert(
            session_id.to_string(),
            SshShellHandle {
                id: shell_id.clone(),
                sender: tx,
                thread,
                suspend_count,
            },
        );

        Ok(shell_id)
    }

    pub async fn send_shell_input(&mut self, session_id: &str, data: String) -> Result<(), String> {
        let shell = self.shells.get(session_id).ok_or("Shell not started")?;
        shell
            .sender
            .send(SshShellCommand::Input(data))
            .map_err(|_| "Failed to send input to shell".to_string())
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
            .map_err(|_| "Failed to send secure input to shell".to_string())
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
            .map_err(|_| "Failed to resize shell".to_string())
    }

    pub async fn stop_shell(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(shell) = self.shells.remove(session_id) {
            let _ = shell.sender.send(SshShellCommand::Close);
            let deadline = tokio::time::Instant::now() + SHELL_STOP_TIMEOUT;
            while !shell.is_finished() && tokio::time::Instant::now() < deadline {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            if !shell.is_finished() {
                self.shells.insert(session_id.to_string(), shell);
                return Err(format!(
                    "Timed out waiting for SSH shell to stop for session {}",
                    session_id
                ));
            }
            if shell.thread.join().is_err() {
                return Err(format!(
                    "SSH shell thread panicked for session {}",
                    session_id
                ));
            }
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

    pub async fn disconnect_ssh(&mut self, session_id: &str) -> Result<(), String> {
        if self.cancel_pending_connection(session_id)? {
            return Ok(());
        }

        // Do not report the backend actor as closed until the shell thread has
        // actually exited. This keeps VPN/session cleanup fail-closed when a
        // native actor cannot be stopped deterministically.
        self.stop_shell(session_id).await?;

        // Clean up X11 forwarding
        let _ = self.disable_x11_forwarding(session_id);

        // Clean up ProxyCommand
        let _ = super::proxy_command::stop_proxy_command(session_id);

        if let Some(mut session) = self.sessions.remove(session_id) {
            if let Some(handle) = session.keep_alive_handle.take() {
                handle.abort();
            }

            for (_, forward) in session.port_forwards.drain() {
                forward.handle.abort();
            }

            // Drop the main session first (closes its channel_direct_tcpip channels)
            drop(session.session);

            // Drop intermediate sessions in reverse order (innermost hop first)
            while let Some(sess) = session.intermediate_sessions.pop() {
                drop(sess);
            }

            // Bridge threads will naturally terminate once the channels are dropped;
            // join them with a bounded wait so we don't block forever.
            for handle in session.bridge_handles.drain(..) {
                let _ = handle.join();
            }
        }
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
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;

        if !session.config.compression_config.allow_runtime_update {
            return Err("Runtime compression updates are not allowed for this session".to_string());
        }

        // Update only the mutable parts (adaptive settings, tracking, etc.)
        session.config.compression_config.adaptive = new_config.adaptive;
        session.config.compression_config.track_statistics = new_config.track_statistics;
        session.config.compression_config.compress_sftp = new_config.compress_sftp;

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
    connect_ssh_on_state_with(
        state,
        config,
        |mut connector, session_id, config| async move {
            connector.establish_ssh_connection(session_id, config).await
        },
    )
    .await
}

async fn connect_ssh_on_state_with<F, Fut>(
    state: &SshServiceState,
    config: SshConnectionConfig,
    establish: F,
) -> Result<String, String>
where
    F: FnOnce(SshService, String, SshConnectionConfig) -> Fut,
    Fut: Future<Output = Result<EstablishedSshConnection, String>>,
{
    let (connector, attempt) = {
        let service = state.lock().await;
        service.begin_connection_attempt()?
    };
    let session_id = attempt.session_id.clone();
    let cancellation = attempt.cancellation.clone();

    let result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err("SSH connection cancelled".to_string()),
        result = establish(connector, session_id, config) => result,
    };

    // Keep the attempt registered until the service lock is reacquired. This
    // makes adoption atomic with a concurrent disconnect of the provisional id.
    let mut service = state.lock().await;
    let cancelled = attempt.finish();
    if cancelled {
        drop(result);
        return Err("SSH connection cancelled".to_string());
    }

    service.adopt_connection(result?)
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
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: Some(emitter),
            pending_connections: std::sync::Arc::new(StdMutex::new(HashMap::new())),
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
                move |connector, session_id, config| async move {
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

        tokio::time::timeout(Duration::from_secs(1), async {
            state.lock().await.disconnect_ssh(&session_id).await
        })
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
            let count = self.inner.read(buffer)?;
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
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: None,
            pending_connections: std::sync::Arc::new(StdMutex::new(HashMap::new())),
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
        let (sender, _receiver) = mpsc::unbounded_channel();
        let thread = std::thread::spawn(|| {});
        let session_id = "finished-shell";
        service.shells.insert(
            session_id.to_string(),
            SshShellHandle {
                id: "shell-id".to_string(),
                sender,
                thread,
                suspend_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
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
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let thread = std::thread::spawn(move || {
            assert!(matches!(
                receiver.blocking_recv(),
                Some(SshShellCommand::Close)
            ));
        });
        let session_id = "stoppable-shell";
        service.shells.insert(
            session_id.to_string(),
            SshShellHandle {
                id: "shell-id".to_string(),
                sender,
                thread,
                suspend_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
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
