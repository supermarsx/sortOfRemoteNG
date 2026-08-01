//! # ProxyCommand
//!
//! Implements OpenSSH-style ProxyCommand support.  A ProxyCommand spawns an
//! external process whose stdin/stdout are used as the SSH transport instead
//! of a direct TCP connection.
//!
//! Common use cases:
//! - `ssh -W %h:%p jumpbox`   (OpenSSH stdio forward through a jump host)
//! - `nc -X 5 -x proxy:1080 %h %p`  (SOCKS5 via netcat)
//! - `ncat --proxy-type socks5 --proxy proxy:1080 %h %p`
//! - `socat - TCP:%h:%p`
//! - `connect -H proxy:3128 %h %p`  (HTTP CONNECT via connect-proxy)
//! - `corkscrew proxy 3128 %h %p`  (HTTP CONNECT via corkscrew)
//!
//! The module converts the child process's stdio into a `std::net::TcpStream`
//! compatible pipe by using an intermediate TCP socket pair.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex as StdMutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::types::*;

// ── Import-confirmation gate ──────────────────────────────────────────

/// Stable, machine-detectable error code emitted when an unconfirmed
/// (import/sync-origin) ProxyCommand is about to be executed.
///
/// The whole `spawn_proxy_command` / `connect_ssh` error surface is
/// `Result<_, String>`, so this is returned as a string that BEGINS with this
/// exact prefix. The Wave-2 frontend detects a confirmation-required failure by
/// testing `error.startsWith("PROXY_COMMAND_CONFIRMATION_REQUIRED")` (and may
/// strip the prefix to show the human-readable tail). Keep this literal stable.
pub const PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE: &str = "PROXY_COMMAND_CONFIRMATION_REQUIRED";

/// Stable error code for a proxy password that would have to be exposed in the
/// system shell command line. The current ProxyCommand transport reserves child
/// stdin/stdout for SSH bytes and has no helper-specific credential-file or
/// direct-environment contract, so it must fail closed rather than inventing an
/// unsafe generic channel.
pub const PROXY_COMMAND_UNSAFE_PASSWORD_CHANNEL_CODE: &str =
    "PROXY_COMMAND_UNSAFE_PASSWORD_CHANNEL";

/// Typed error for the ProxyCommand execution path. The crate's public API is
/// stringly-typed (`Result<_, String>`); this enum exists so the gate and its
/// tests have a single source of truth for the wire string via `Display`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProxyCommandError {
    /// The ProxyCommand is configured but not yet confirmed by the user. It
    /// arrived from an untrusted origin (import/sync) and must be reviewed and
    /// confirmed once before it is allowed to execute.
    ConfirmationRequired,
    /// The configured password can only be supplied to this helper through a
    /// shell/process argument. Process arguments are observable by other local
    /// processes and must not carry proxy credentials.
    UnsafePasswordChannel,
}

impl std::fmt::Display for ProxyCommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProxyCommandError::ConfirmationRequired => write!(
                f,
                "{}: This SSH connection's ProxyCommand has not been confirmed. \
                 It may have been added via import or sync. Review the command \
                 and confirm it once before connecting.",
                PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE
            ),
            ProxyCommandError::UnsafePasswordChannel => write!(
                f,
                "{}: Proxy passwords cannot be expanded into ProxyCommand shell \
                 arguments. This helper has no configured safe environment, stdin, \
                 or credential-file channel; use key/agent authentication or a \
                 helper-specific protected credential channel.",
                PROXY_COMMAND_UNSAFE_PASSWORD_CHANNEL_CODE
            ),
        }
    }
}

/// Compute a stable identity for an expanded ProxyCommand string. The backend
/// confirmation registry is keyed by this so that confirming one specific
/// command does not implicitly trust a *different* (e.g. edited or re-imported)
/// command — any change re-arms the gate.
fn command_fingerprint(expanded_cmd: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(expanded_cmd.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ── Global ProxyCommand state ─────────────────────────────────────────

lazy_static::lazy_static! {
    /// Active ProxyCommand child processes indexed by SSH session id.
    pub static ref PROXY_COMMANDS: StdMutex<HashMap<String, ProxyCommandState>> = StdMutex::new(HashMap::new());

    /// One-shot fingerprints of ProxyCommand strings the user has explicitly
    /// confirmed at runtime via [`confirm_proxy_command`]. The gate is
    /// intentionally keyed only by the expanded command fingerprint so imported
    /// or persisted boolean flags cannot bless different command contents.
    static ref CONFIRMED_PROXY_COMMANDS: StdMutex<std::collections::HashSet<String>> =
        StdMutex::new(std::collections::HashSet::new());

    static ref PROXY_CREDENTIAL_FLAG_RE: regex::Regex = regex::Regex::new(
        r#"(?i)(?P<prefix>^|\s)(?P<flag>--(?:proxy-auth|password|passphrase|token|(?:api[-_]?)?key)|-p)(?P<space>\s+)(?:"[^"]*"|'[^']*'|[^\s]+)"#,
    )
    .expect("valid ProxyCommand credential flag regex");
    static ref PROXY_CREDENTIAL_ASSIGNMENT_RE: regex::Regex = regex::Regex::new(
        r#"(?i)\b(?P<key>[a-z0-9_-]*(?:password|passphrase|token|(?:api[-_]?)?key)[a-z0-9_-]*)(?P<separator>\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)"#,
    )
    .expect("valid ProxyCommand credential assignment regex");
    static ref PROXY_URI_USERINFO_RE: regex::Regex = regex::Regex::new(
        r#"(?i)\b(?P<scheme>[a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/@\s]+@(?P<host>[^/\s]+)"#,
    )
    .expect("valid ProxyCommand URI userinfo regex");
    static ref PROXY_BARE_USERINFO_RE: regex::Regex = regex::Regex::new(
        r#"(?i)(?P<prefix>^|\s)[^/\s:@]+:[^/@\s]+@(?P<host>[^/\s]+)"#,
    )
    .expect("valid ProxyCommand bare userinfo regex");
}

/// Record that the user has reviewed and confirmed a specific expanded
/// ProxyCommand string. After this, [`spawn_proxy_command`] may make one attempt
/// to execute that exact command. The acknowledgement is consumed before spawn.
///
/// There is intentionally no invented caller/session key here: the backend SSH
/// session id does not exist until `connect_ssh` succeeds, while confirmation is
/// requested after the gated attempt fails. The exact fingerprint plus atomic
/// one-shot consumption is therefore the narrowest identity available at both
/// ends of the existing command contract.
pub fn mark_proxy_command_confirmed(expanded_cmd: &str) {
    if let Ok(mut set) = CONFIRMED_PROXY_COMMANDS.lock() {
        set.insert(command_fingerprint(expanded_cmd));
    }
}

/// Consume the one-shot acknowledgement for an exact expanded ProxyCommand.
/// Lock poisoning and missing or mismatched fingerprints fail closed with the
/// same opaque, actionable error before any process is started.
fn require_proxy_command_confirmation(expanded_cmd: &str) -> Result<(), String> {
    let confirmed = CONFIRMED_PROXY_COMMANDS
        .lock()
        .map(|mut set| set.remove(&command_fingerprint(expanded_cmd)))
        .unwrap_or(false);

    if confirmed {
        Ok(())
    } else {
        Err(ProxyCommandError::ConfirmationRequired.to_string())
    }
}

const RELAY_POLL_INTERVAL: Duration = Duration::from_millis(100);
const STOP_JOIN_TIMEOUT: Duration = Duration::from_secs(2);
const CHILD_REAP_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_STDERR_BYTES_RECORDED: usize = 64 * 1024;
const MAX_PROXY_COMMAND_DIAGNOSTIC_BYTES: usize = 16 * 1024;
const PROXY_COMMAND_TRUNCATED_MARKER: &str = "...[TRUNCATED]";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LifecycleStage {
    Bind,
    Accept,
    Registry,
    AfterSpawn,
}

#[derive(Default)]
struct LifecycleHooks {
    #[cfg(test)]
    failure: Option<LifecycleStage>,
    #[cfg(test)]
    spawned_pid: Option<Arc<std::sync::atomic::AtomicU32>>,
}

impl LifecycleHooks {
    fn should_fail(&self, stage: LifecycleStage) -> bool {
        #[cfg(test)]
        {
            self.failure == Some(stage)
        }
        #[cfg(not(test))]
        {
            let _ = stage;
            false
        }
    }

    fn record_spawned_pid(&self, pid: u32) {
        #[cfg(test)]
        if let Some(observer) = &self.spawned_pid {
            observer.store(pid, Ordering::SeqCst);
        }
        #[cfg(not(test))]
        let _ = pid;
    }
}

struct ManagedThread {
    name: &'static str,
    done: Receiver<()>,
    handle: Option<JoinHandle<()>>,
}

impl std::fmt::Debug for ManagedThread {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ManagedThread")
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

impl ManagedThread {
    fn spawn(name: &'static str, task: impl FnOnce() + Send + 'static) -> std::io::Result<Self> {
        let (done_tx, done) = mpsc::sync_channel(1);
        let handle = std::thread::Builder::new()
            .name(name.to_string())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(task));
                let _ = done_tx.send(());
                if result.is_err() {
                    log::error!("ProxyCommand worker '{name}' panicked");
                }
            })?;
        Ok(Self {
            name,
            done,
            handle: Some(handle),
        })
    }

    fn join_until(mut self, deadline: Instant) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let finished = match self.done.recv_timeout(remaining) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => true,
            Err(RecvTimeoutError::Timeout) => false,
        };

        if finished {
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        } else {
            log::warn!(
                "ProxyCommand worker '{}' did not stop before its join deadline",
                self.name
            );
        }
    }
}

#[cfg(windows)]
struct ProcessTreeGuard {
    job: std::os::windows::io::OwnedHandle,
    assigned: AtomicBool,
}

#[cfg(windows)]
impl ProcessTreeGuard {
    fn prepare() -> std::io::Result<Self> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle};
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        let raw_job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw_job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let job = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(raw_job) };
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Self {
            job,
            assigned: AtomicBool::new(false),
        })
    }

    fn attach(&self, child: &Child) -> std::io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;

        let assigned =
            unsafe { AssignProcessToJobObject(self.job.as_raw_handle(), child.as_raw_handle()) };
        if assigned == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            self.assigned.store(true, Ordering::Release);
            Ok(())
        }
    }

    fn terminate(&self, pid: u32) {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        if self.assigned.load(Ordering::Acquire) {
            unsafe {
                TerminateJobObject(self.job.as_raw_handle(), 1);
            }
        } else {
            terminate_unmanaged_process_tree(pid);
        }
    }
}

#[cfg(not(windows))]
struct ProcessTreeGuard;

#[cfg(not(windows))]
impl ProcessTreeGuard {
    fn prepare() -> std::io::Result<Self> {
        Ok(Self)
    }

    fn attach(&self, _child: &Child) -> std::io::Result<()> {
        Ok(())
    }

    fn terminate(&self, pid: u32) {
        terminate_unmanaged_process_tree(pid);
    }
}

#[cfg(windows)]
fn terminate_unmanaged_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    if let Ok(mut killer) = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            if matches!(killer.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = killer.kill();
        let _ = killer.wait();
    }
}

#[cfg(not(windows))]
fn terminate_unmanaged_process_tree(pid: u32) {
    let _ = Command::new("kill")
        .args(["-KILL", "--", &format!("-{pid}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Runtime state for an active ProxyCommand process.
pub struct ProxyCommandState {
    pub session_id: String,
    /// The redacted expanded command string. Raw command text must not outlive
    /// the immediate spawn call because it may contain user-supplied secrets.
    pub command: String,
    /// The child process handle remains controllable for the entire session.
    child: Option<Arc<StdMutex<Child>>>,
    process_tree: Option<Arc<ProcessTreeGuard>>,
    control_socket: Option<TcpStream>,
    /// Cancellation flag.
    pub cancelled: Arc<AtomicBool>,
    relay_handles: Vec<ManagedThread>,
    stderr_bytes: Arc<AtomicUsize>,
    stderr_truncated: Arc<AtomicBool>,
    stopping: bool,
}

struct StderrCaptureCounters {
    bytes: Arc<AtomicUsize>,
    truncated: Arc<AtomicBool>,
}

impl std::fmt::Debug for ProxyCommandState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProxyCommandState")
            .field("session_id", &self.session_id)
            .field("command", &self.command)
            .field("pid", &self.child.as_ref().map(child_pid))
            .field("cancelled", &self.cancelled.load(Ordering::Relaxed))
            .field("stderr_bytes", &self.stderr_bytes.load(Ordering::Relaxed))
            .field(
                "stderr_truncated",
                &self.stderr_truncated.load(Ordering::Relaxed),
            )
            .field("stopping", &self.stopping)
            .finish_non_exhaustive()
    }
}

impl ProxyCommandState {
    fn active(
        session_id: &str,
        expanded_command: &str,
        child: Arc<StdMutex<Child>>,
        process_tree: Arc<ProcessTreeGuard>,
        control_socket: TcpStream,
        cancelled: Arc<AtomicBool>,
        stderr: StderrCaptureCounters,
    ) -> Self {
        Self {
            session_id: session_id.to_string(),
            command: redact_proxy_credentials(expanded_command),
            child: Some(child),
            process_tree: Some(process_tree),
            control_socket: Some(control_socket),
            cancelled,
            relay_handles: Vec::new(),
            stderr_bytes: stderr.bytes,
            stderr_truncated: stderr.truncated,
            stopping: false,
        }
    }

    #[cfg(test)]
    fn retained(
        session_id: &str,
        expanded_command: &str,
        cancelled: Arc<AtomicBool>,
        relay_handles: Vec<ManagedThread>,
    ) -> Self {
        Self {
            session_id: session_id.to_string(),
            command: redact_proxy_credentials(expanded_command),
            child: None,
            process_tree: None,
            control_socket: None,
            cancelled,
            relay_handles,
            stderr_bytes: Arc::new(AtomicUsize::new(0)),
            stderr_truncated: Arc::new(AtomicBool::new(false)),
            stopping: false,
        }
    }
}

fn child_pid(child: &Arc<StdMutex<Child>>) -> u32 {
    child
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .id()
}

fn proxy_commands_lock() -> std::sync::MutexGuard<'static, HashMap<String, ProxyCommandState>> {
    PROXY_COMMANDS.lock().unwrap_or_else(|poisoned| {
        log::error!("ProxyCommand registry lock was poisoned; recovering for cleanup");
        poisoned.into_inner()
    })
}

// ── Template expansion ────────────────────────────────────────────────

/// Validates that a string is a safe hostname or IP address (no shell metacharacters).
fn validate_shell_safe(input: &str) -> Result<String, String> {
    // Allow alphanumeric, dots, hyphens, underscores, colons (IPv6), square brackets
    if input
        .chars()
        .all(|c| c.is_alphanumeric() || ".-_:[]".contains(c))
    {
        Ok(input.to_string())
    } else {
        Err(format!(
            "Invalid characters in input: '{}'",
            input.chars().take(20).collect::<String>()
        ))
    }
}

/// Redact credentials from a proxy command string before it is logged or
/// returned to the frontend.
///
/// This masks:
/// - `--proxy-auth user:pass` (ncat) and `-P pass` (connect) flag values
/// - inline `user:pass@host` authorities (connect / ssh URLs)
/// - and then defers to the shared [`crate::redact::redact_secrets`] sweep
///   which additionally catches `-p<password>` flags, `key=secret`/`token`
///   pairs, private-key blocks, and AWS/GCP token shapes.
///
/// Callers must use the redacted value anywhere the expanded command can reach
/// a log sink or a serialised `ProxyCommandStatus`.
///
/// NOTE: must be `pub` (not `pub(crate)`) — `proxy_command_cmds.rs` is
/// `include!`-d into BOTH `sorng-ssh` and the `app` crate (via the
/// `src-tauri/src/ssh_commands.rs` shim, which re-exports this module with
/// `pub use crate::ssh::proxy_command::*`). A `pub(crate)` item would not flow
/// through that glob re-export into the app compile context, breaking the
/// `use super::proxy_command::*;` import there (E0425). Mirrors the other
/// `pub` proxy-command symbols referenced the same way.
pub fn redact_proxy_credentials(cmd: &str) -> String {
    fn prefix_at_char_boundary(value: &str, max_bytes: usize) -> &str {
        if value.len() <= max_bytes {
            return value;
        }

        let mut end = max_bytes;
        while end > 0 && !value.is_char_boundary(end) {
            end -= 1;
        }
        &value[..end]
    }

    // Bound every regex sweep and every retained diagnostic. This prevents a
    // hostile imported command from amplifying log/status memory use. Anything
    // beyond the prefix is discarded, never copied into diagnostics.
    let input_truncated = cmd.len() > MAX_PROXY_COMMAND_DIAGNOSTIC_BYTES;
    let bounded = prefix_at_char_boundary(cmd, MAX_PROXY_COMMAND_DIAGNOSTIC_BYTES);

    let result =
        PROXY_CREDENTIAL_FLAG_RE.replace_all(bounded, "${prefix}${flag}${space}[REDACTED]");
    let result =
        PROXY_CREDENTIAL_ASSIGNMENT_RE.replace_all(&result, "${key}${separator}[REDACTED]");
    let result = PROXY_URI_USERINFO_RE.replace_all(&result, "${scheme}[REDACTED]@${host}");
    let result = PROXY_BARE_USERINFO_RE.replace_all(&result, "${prefix}[REDACTED]@${host}");

    // Defer to the shared crate-wide secret sweep for attached -p secrets,
    // private-key blocks, and provider token shapes.
    let result = crate::redact::redact_secrets(&result, &[]);
    let output_truncated = result.len() > MAX_PROXY_COMMAND_DIAGNOSTIC_BYTES;

    if input_truncated || output_truncated {
        let content_limit =
            MAX_PROXY_COMMAND_DIAGNOSTIC_BYTES - PROXY_COMMAND_TRUNCATED_MARKER.len();
        let mut bounded_result = prefix_at_char_boundary(&result, content_limit).to_string();
        bounded_result.push_str(PROXY_COMMAND_TRUNCATED_MARKER);
        bounded_result
    } else {
        result
    }
}

/// Expand `%h`, `%p`, `%r` placeholders in a command string.
pub fn expand_command(
    template: &str,
    host: &str,
    port: u16,
    username: &str,
) -> Result<String, String> {
    if template.contains("{proxy_password}") {
        return Err(ProxyCommandError::UnsafePasswordChannel.to_string());
    }

    let safe_host = validate_shell_safe(host)?;
    let safe_user = validate_shell_safe(username)?;
    Ok(template
        .replace("%h", &safe_host)
        .replace("%p", &port.to_string())
        .replace("%r", &safe_user))
}

/// Build the full command string from a `ProxyCommandConfig`.
pub fn build_command_string(
    config: &ProxyCommandConfig,
    host: &str,
    port: u16,
    username: &str,
) -> Result<String, String> {
    if let Some(ref cmd) = config.command {
        // Direct command — just expand placeholders
        return expand_command(cmd, host, port, username);
    }

    let template = config
        .template
        .as_ref()
        .ok_or("ProxyCommand requires either 'command' or 'template'")?;

    let proxy_host = validate_shell_safe(config.proxy_host.as_deref().unwrap_or("127.0.0.1"))?;
    let proxy_port = config.proxy_port.unwrap_or(1080);
    let safe_host = validate_shell_safe(host)?;
    if let Some(ref user) = config.proxy_username {
        validate_shell_safe(user)?;
    }

    match template {
        ProxyCommandTemplate::Nc => {
            // nc %h %p
            Ok(format!("nc {} {}", safe_host, port))
        }
        ProxyCommandTemplate::Ncat => {
            // ncat --proxy-type <type> --proxy <host:port> [--proxy-auth user:pass] %h %p
            // Ncat only accepts proxy authentication through --proxy-auth, which
            // would expose the password in both the shell and process argv.
            if config.proxy_password.is_some() {
                return Err(ProxyCommandError::UnsafePasswordChannel.to_string());
            }
            let proxy_type = config.proxy_type.as_deref().unwrap_or("socks5");
            let safe_proxy_type = validate_shell_safe(proxy_type)?;
            let mut cmd = format!(
                "ncat --proxy-type {} --proxy {}:{} ",
                safe_proxy_type, proxy_host, proxy_port
            );
            cmd.push_str(&format!("{} {}", safe_host, port));
            Ok(cmd)
        }
        ProxyCommandTemplate::Socat => {
            // socat - TCP:%h:%p
            Ok(format!("socat - TCP:{}:{}", safe_host, port))
        }
        ProxyCommandTemplate::Connect => {
            // connect -H proxy:port %h %p   (HTTP CONNECT)
            // connect -S proxy:port %h %p   (SOCKS)
            // The current connect helper integration has no verified protected
            // credential channel. Do not fall back to user:pass@host argv.
            if config.proxy_password.is_some() {
                return Err(ProxyCommandError::UnsafePasswordChannel.to_string());
            }
            let flag = match config.proxy_type.as_deref() {
                Some("socks4") | Some("socks5") => "-S",
                _ => "-H",
            };
            let mut cmd = format!("connect {} {}:{} ", flag, proxy_host, proxy_port);
            cmd.push_str(&format!("{} {}", safe_host, port));
            Ok(cmd)
        }
        ProxyCommandTemplate::Corkscrew => {
            // corkscrew proxy_host proxy_port target_host target_port [auth_file]
            Ok(format!(
                "corkscrew {} {} {} {}",
                proxy_host, proxy_port, safe_host, port
            ))
        }
        ProxyCommandTemplate::SshStdio => {
            // ssh -W %h:%p <proxy_host> [-p proxy_port] [-l proxy_user]
            let mut cmd = format!("ssh -W {}:{} ", safe_host, port);
            if let Some(user) = &config.proxy_username {
                let safe_user = validate_shell_safe(user)?;
                cmd.push_str(&format!("-l {} ", safe_user));
            }
            if proxy_port != 22 {
                cmd.push_str(&format!("-p {} ", proxy_port));
            }
            cmd.push_str(&proxy_host);
            Ok(cmd)
        }
    }
}

// ── Core: spawn ProxyCommand and produce a TcpStream ──────────────────

/// Spawn the ProxyCommand child process and return a `TcpStream` whose
/// reads/writes are relayed to the child's stdout/stdin respectively.
///
/// This works by:
/// 1. Binding and synchronously connecting a private loopback relay.
/// 2. Reserving the session registry and preparing a process-tree guard.
/// 3. Spawning and immediately registering the guarded helper process.
/// 4. Starting bounded stderr, relay, and process-monitor workers.
///
/// The caller (service.rs `connect_ssh`) uses the returned stream exactly
/// like a direct TCP connection.
pub fn spawn_proxy_command(
    session_id: &str,
    config: &ProxyCommandConfig,
    host: &str,
    port: u16,
    username: &str,
    connect_timeout: u64,
) -> Result<TcpStream, String> {
    spawn_proxy_command_inner(
        session_id,
        config,
        host,
        port,
        username,
        connect_timeout,
        &LifecycleHooks::default(),
    )
}

fn spawn_proxy_command_inner(
    session_id: &str,
    config: &ProxyCommandConfig,
    host: &str,
    port: u16,
    username: &str,
    connect_timeout: u64,
    hooks: &LifecycleHooks,
) -> Result<TcpStream, String> {
    let cmd_string = build_command_string(config, host, port, username)?;

    // ── Import-confirmation gate ──────────────────────────────────────
    // ProxyCommand stays fully free-form, but the exact expanded command must
    // be confirmed for this exact execution attempt before it is ever spawned.
    // The acknowledgement is consumed here, before `spawn_shell_command`, so it
    // cannot be replayed. Persisted/imported
    // `command_confirmed` booleans are deliberately ignored here because they
    // are not bound to the expanded command fingerprint.
    if let Err(error) = require_proxy_command_confirmation(&cmd_string) {
        log::warn!(
            "[{}] Refusing unconfirmed ProxyCommand (import/sync origin): {}",
            session_id,
            redact_proxy_credentials(&cmd_string)
        );
        return Err(error);
    }

    // Redact credentials from log output
    let redacted_cmd = redact_proxy_credentials(&cmd_string);

    if hooks.should_fail(LifecycleStage::Bind) {
        return Err("Failed to bind ProxyCommand relay listener: injected failure".to_string());
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind ProxyCommand relay listener: {}", e))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to configure ProxyCommand relay listener: {e}"))?;
    let relay_addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get relay address: {}", e))?;

    let timeout = Duration::from_secs(if connect_timeout > 0 {
        connect_timeout
    } else {
        15
    });

    if hooks.should_fail(LifecycleStage::Accept) {
        return Err("Failed to accept ProxyCommand relay: injected failure".to_string());
    }

    // Establish and accept the private relay before spawning anything. This
    // makes bind/accept readiness a hard precondition rather than a child-leak
    // path hidden in a background thread.
    let stream = TcpStream::connect_timeout(&relay_addr, timeout)
        .map_err(|e| format!("Failed to connect to ProxyCommand relay: {}", e))?;
    let accept_deadline = Instant::now() + timeout;
    let relay_socket = loop {
        match listener.accept() {
            Ok((socket, _)) => break socket,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= accept_deadline {
                    return Err("Timed out accepting ProxyCommand relay".to_string());
                }
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(error) => {
                return Err(format!("Failed to accept ProxyCommand relay: {error}"));
            }
        }
    };
    drop(listener);

    stream
        .set_nonblocking(false)
        .map_err(|e| format!("Failed to set blocking mode: {}", e))?;
    relay_socket
        .set_read_timeout(Some(RELAY_POLL_INTERVAL))
        .map_err(|e| format!("Failed to configure ProxyCommand relay reads: {e}"))?;
    relay_socket
        .set_write_timeout(Some(RELAY_POLL_INTERVAL))
        .map_err(|e| format!("Failed to configure ProxyCommand relay writes: {e}"))?;
    let mut socket_read = relay_socket
        .try_clone()
        .map_err(|e| format!("Failed to clone ProxyCommand relay socket: {e}"))?;
    let mut socket_write = relay_socket
        .try_clone()
        .map_err(|e| format!("Failed to clone ProxyCommand relay socket: {e}"))?;
    let monitor_socket = relay_socket
        .try_clone()
        .map_err(|e| format!("Failed to clone ProxyCommand control socket: {e}"))?;

    if hooks.should_fail(LifecycleStage::Registry) {
        return Err("Failed to reserve ProxyCommand registry: injected failure".to_string());
    }

    // Hold the registry lock from the duplicate check through child insertion.
    // Thus a helper cannot exist unless its listener is ready and the registry
    // is ready to retain a controllable process-tree handle.
    let mut commands = proxy_commands_lock();
    if commands.contains_key(session_id) {
        return Err(format!(
            "ProxyCommand session '{session_id}' is already active or stopping"
        ));
    }

    let process_tree = Arc::new(
        ProcessTreeGuard::prepare()
            .map_err(|e| format!("Failed to prepare ProxyCommand process guard: {e}"))?,
    );
    log::info!("[{}] Spawning ProxyCommand: {}", session_id, redacted_cmd);
    let mut child = spawn_shell_command(&cmd_string)
        .map_err(|e| format!("Failed to spawn ProxyCommand: {}", e))?;
    hooks.record_spawned_pid(child.id());
    if let Err(error) = process_tree.attach(&child) {
        process_tree.terminate(child.id());
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!(
            "Failed to attach ProxyCommand process-tree guard: {error}"
        ));
    }

    let child = Arc::new(StdMutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    let stderr_bytes = Arc::new(AtomicUsize::new(0));
    let stderr_truncated = Arc::new(AtomicBool::new(false));
    commands.insert(
        session_id.to_string(),
        ProxyCommandState::active(
            session_id,
            &cmd_string,
            child.clone(),
            process_tree.clone(),
            relay_socket,
            cancelled.clone(),
            StderrCaptureCounters {
                bytes: stderr_bytes.clone(),
                truncated: stderr_truncated.clone(),
            },
        ),
    );

    if hooks.should_fail(LifecycleStage::AfterSpawn) {
        drop(commands);
        let _ = stop_proxy_command(session_id);
        return Err("ProxyCommand setup failed after spawn: injected failure".to_string());
    }

    let (mut child_stdin, mut child_stdout, mut child_stderr) = {
        let mut child_guard = child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match (
            child_guard.stdin.take(),
            child_guard.stdout.take(),
            child_guard.stderr.take(),
        ) {
            (Some(stdin), Some(stdout), Some(stderr)) => (stdin, stdout, stderr),
            _ => {
                drop(child_guard);
                drop(commands);
                let _ = stop_proxy_command(session_id);
                return Err("ProxyCommand did not expose all required stdio pipes".to_string());
            }
        }
    };

    let stderr_counter = stderr_bytes.clone();
    let stderr_was_truncated = stderr_truncated.clone();
    let stderr_worker = ManagedThread::spawn("proxy-stderr", move || {
        let mut buffer = [0u8; 8192];
        loop {
            match child_stderr.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let _ = stderr_counter.fetch_update(
                        Ordering::Relaxed,
                        Ordering::Relaxed,
                        |current| {
                            Some(current.saturating_add(count).min(MAX_STDERR_BYTES_RECORDED))
                        },
                    );
                    if stderr_counter.load(Ordering::Relaxed) == MAX_STDERR_BYTES_RECORDED {
                        stderr_was_truncated.store(true, Ordering::Relaxed);
                    }
                }
                Err(_) => break,
            }
        }
    });
    let stderr_worker = match stderr_worker {
        Ok(worker) => worker,
        Err(error) => {
            drop(commands);
            let _ = stop_proxy_command(session_id);
            return Err(format!(
                "Failed to start ProxyCommand stderr drain: {error}"
            ));
        }
    };
    commands
        .get_mut(session_id)
        .expect("ProxyCommand state retained while registry lock is held")
        .relay_handles
        .push(stderr_worker);

    let stdout_cancelled = cancelled.clone();
    let session_id_stdout = session_id.to_string();
    let stdout_worker = ManagedThread::spawn("proxy-stdout", move || {
        let mut buffer = [0u8; 32 * 1024];
        loop {
            if stdout_cancelled.load(Ordering::Acquire) {
                break;
            }
            match child_stdout.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if socket_write.write_all(&buffer[..count]).is_err() {
                        break;
                    }
                    let _ = socket_write.flush();
                }
                Err(_) => break,
            }
        }
        let _ = socket_write.shutdown(Shutdown::Write);
        log::debug!(
            "[{}] ProxyCommand stdout-to-socket relay ended",
            session_id_stdout
        );
    });
    let stdout_worker = match stdout_worker {
        Ok(worker) => worker,
        Err(error) => {
            drop(commands);
            let _ = stop_proxy_command(session_id);
            return Err(format!(
                "Failed to start ProxyCommand stdout relay: {error}"
            ));
        }
    };
    commands
        .get_mut(session_id)
        .expect("ProxyCommand state retained while registry lock is held")
        .relay_handles
        .push(stdout_worker);

    let stdin_cancelled = cancelled.clone();
    let session_id_stdin = session_id.to_string();
    let stdin_worker = ManagedThread::spawn("proxy-stdin", move || {
        let mut buffer = [0u8; 32 * 1024];
        loop {
            if stdin_cancelled.load(Ordering::Acquire) {
                break;
            }
            match socket_read.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if child_stdin.write_all(&buffer[..count]).is_err() {
                        break;
                    }
                    let _ = child_stdin.flush();
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(_) => break,
            }
        }
        let _ = socket_read.shutdown(Shutdown::Read);
        log::debug!(
            "[{}] ProxyCommand socket-to-stdin relay ended",
            session_id_stdin
        );
    });
    let stdin_worker = match stdin_worker {
        Ok(worker) => worker,
        Err(error) => {
            drop(commands);
            let _ = stop_proxy_command(session_id);
            return Err(format!("Failed to start ProxyCommand stdin relay: {error}"));
        }
    };
    commands
        .get_mut(session_id)
        .expect("ProxyCommand state retained while registry lock is held")
        .relay_handles
        .push(stdin_worker);

    let monitor_child = child.clone();
    let monitor_tree = process_tree.clone();
    let monitor_cancelled = cancelled.clone();
    let session_id_monitor = session_id.to_string();
    let monitor_worker = ManagedThread::spawn("proxy-monitor", move || loop {
        if monitor_cancelled.load(Ordering::Acquire) {
            break;
        }
        let exited = monitor_child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .try_wait();
        match exited {
            Ok(Some(status)) => {
                monitor_cancelled.store(true, Ordering::Release);
                let _ = monitor_socket.shutdown(Shutdown::Both);
                monitor_tree.terminate(child_pid(&monitor_child));
                log::info!(
                    "[{}] ProxyCommand exited with {}; descendants terminated",
                    session_id_monitor,
                    status
                );
                break;
            }
            Ok(None) => std::thread::sleep(RELAY_POLL_INTERVAL),
            Err(error) => {
                monitor_cancelled.store(true, Ordering::Release);
                let _ = monitor_socket.shutdown(Shutdown::Both);
                monitor_tree.terminate(child_pid(&monitor_child));
                log::warn!(
                    "[{}] ProxyCommand status check failed: {}",
                    session_id_monitor,
                    error
                );
                break;
            }
        }
    });
    let monitor_worker = match monitor_worker {
        Ok(worker) => worker,
        Err(error) => {
            drop(commands);
            let _ = stop_proxy_command(session_id);
            return Err(format!("Failed to start ProxyCommand monitor: {error}"));
        }
    };
    commands
        .get_mut(session_id)
        .expect("ProxyCommand state retained while registry lock is held")
        .relay_handles
        .push(monitor_worker);
    drop(commands);

    log::info!(
        "[{}] ProxyCommand connected via relay at {}",
        session_id,
        relay_addr
    );

    Ok(stream)
}

/// Stop a ProxyCommand process for a session.
pub fn stop_proxy_command(session_id: &str) -> Result<(), String> {
    let (cancelled, socket, child, process_tree, workers, stderr_bytes, stderr_truncated) = {
        let mut commands = proxy_commands_lock();
        let Some(state) = commands.get_mut(session_id) else {
            return Ok(());
        };
        if state.stopping {
            return Ok(());
        }
        state.stopping = true;
        state.cancelled.store(true, Ordering::Release);
        (
            state.cancelled.clone(),
            state.control_socket.take(),
            state.child.take(),
            state.process_tree.take(),
            std::mem::take(&mut state.relay_handles),
            state.stderr_bytes.clone(),
            state.stderr_truncated.clone(),
        )
    };

    cancelled.store(true, Ordering::Release);
    if let Some(socket) = socket {
        let _ = socket.shutdown(Shutdown::Both);
    }

    if let Some(child_handle) = &child {
        let pid = child_pid(child_handle);
        if let Some(process_tree) = &process_tree {
            process_tree.terminate(pid);
        } else {
            terminate_unmanaged_process_tree(pid);
        }
        let mut child_guard = child_handle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = child_guard.kill();
        let deadline = Instant::now() + CHILD_REAP_TIMEOUT;
        loop {
            match child_guard.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    drop(child_guard);
                    std::thread::sleep(Duration::from_millis(10));
                    child_guard = child_handle
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                }
                _ => {
                    let _ = child_guard.kill();
                    let _ = child_guard.wait();
                    break;
                }
            }
        }
    }

    let join_deadline = Instant::now() + STOP_JOIN_TIMEOUT;
    for worker in workers {
        worker.join_until(join_deadline);
    }
    drop(process_tree);
    drop(child);

    proxy_commands_lock().remove(session_id);
    log::info!(
        "[{}] ProxyCommand stopped (stderr drained: {} bytes{})",
        session_id,
        stderr_bytes.load(Ordering::Relaxed),
        if stderr_truncated.load(Ordering::Relaxed) {
            ", truncated"
        } else {
            ""
        }
    );
    Ok(())
}

/// Get ProxyCommand status for a session.
pub fn get_proxy_command_status(session_id: &str) -> Result<Option<ProxyCommandStatus>, String> {
    let mut commands = proxy_commands_lock();
    let Some(state) = commands.get_mut(session_id) else {
        return Ok(None);
    };
    let pid = state.child.as_ref().map(child_pid);
    let alive = if state.cancelled.load(Ordering::Acquire) || state.stopping {
        false
    } else if let Some(child) = &state.child {
        child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .try_wait()
            .map_err(|error| format!("Failed to inspect ProxyCommand process: {error}"))?
            .is_none()
    } else {
        false
    };

    Ok(Some(ProxyCommandStatus {
        session_id: session_id.to_string(),
        command: redact_proxy_credentials(&state.command),
        alive,
        pid,
    }))
}

// ── OS shell spawning ─────────────────────────────────────────────────

/// Spawn a command via the system shell with piped stdin/stdout.
pub fn spawn_shell_command(cmd: &str) -> std::io::Result<Child> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("cmd")
            .args(["/C", cmd])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW)
            .spawn()
    }

    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;

        Command::new("sh")
            .args(["-c", cmd])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::types::{ProxyCommandConfig, ProxyCommandTemplate};
    use secrecy::SecretString;
    use std::sync::atomic::{AtomicU32, AtomicU64};

    static FAKE_HELPER_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    struct TestSessionGuard(String);

    impl TestSessionGuard {
        fn new(session_id: &str) -> Self {
            Self(session_id.to_string())
        }
    }

    impl Drop for TestSessionGuard {
        fn drop(&mut self) {
            let _ = stop_proxy_command(&self.0);
        }
    }

    fn free_form_config(command_confirmed: bool) -> ProxyCommandConfig {
        ProxyCommandConfig {
            command: Some("nc %h %p".to_string()),
            template: None,
            proxy_host: None,
            proxy_port: None,
            proxy_username: None,
            proxy_password: None,
            proxy_type: None,
            timeout_secs: Some(5),
            command_confirmed,
        }
    }

    fn fake_helper_config(mode: &str, marker: Option<&std::path::Path>) -> ProxyCommandConfig {
        let executable = std::env::current_exe().expect("test executable path");
        let token = FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        #[cfg(windows)]
        let command = format!(
            "set \"SORNG_PROXY_HELPER_MODE={mode}\" && set \"SORNG_PROXY_HELPER_TOKEN={token}\" && set \"SORNG_PROXY_HELPER_MARKER={}\" && \"{}\" proxy_command_fake_helper_entry --ignored --nocapture --test-threads=1",
            marker.map_or_else(String::new, |path| path.display().to_string()),
            executable.display()
        );
        #[cfg(not(windows))]
        let command = format!(
            "SORNG_PROXY_HELPER_MODE='{}' SORNG_PROXY_HELPER_TOKEN='{}' SORNG_PROXY_HELPER_MARKER='{}' '{}' proxy_command_fake_helper_entry --ignored --nocapture --test-threads=1",
            mode.replace('\'', "'\\''"),
            token,
            marker
                .map_or_else(String::new, |path| path.display().to_string())
                .replace('\'', "'\\''"),
            executable.display().to_string().replace('\'', "'\\''")
        );

        let mut config = free_form_config(false);
        config.command = Some(command);
        config
    }

    fn run_fake_helper(
        session_id: &str,
        mode: &str,
        marker: Option<&std::path::Path>,
        failure: Option<LifecycleStage>,
        spawned_pid: Arc<AtomicU32>,
    ) -> Result<TcpStream, String> {
        let config = fake_helper_config(mode, marker);
        let expanded = build_command_string(&config, "host.example.com", 22, "user").unwrap();
        mark_proxy_command_confirmed(&expanded);
        spawn_proxy_command_inner(
            session_id,
            &config,
            "host.example.com",
            22,
            "user",
            2,
            &LifecycleHooks {
                failure,
                spawned_pid: Some(spawned_pid),
            },
        )
    }

    fn process_is_alive(pid: u32) -> bool {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let output = Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/NH"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .expect("tasklist must be available");
            String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
        }
        #[cfg(not(windows))]
        {
            Command::new("kill")
                .args(["-0", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
        }
    }

    fn wait_until(predicate: impl Fn() -> bool, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if predicate() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        predicate()
    }

    #[test]
    #[ignore]
    fn proxy_command_fake_helper_entry() {
        let mode = std::env::var("SORNG_PROXY_HELPER_MODE").unwrap_or_default();
        match mode.as_str() {
            "stderr-flood" => {
                let chunk = [b'x'; 8192];
                let mut stderr = std::io::stderr().lock();
                for _ in 0..512 {
                    stderr.write_all(&chunk).expect("write fake stderr");
                }
                stderr.flush().expect("flush fake stderr");
            }
            "tree" => {
                let marker = std::env::var_os("SORNG_PROXY_HELPER_MARKER")
                    .map(std::path::PathBuf::from)
                    .expect("tree helper marker");
                let child = Command::new(std::env::current_exe().unwrap())
                    .args([
                        "proxy_command_fake_helper_entry",
                        "--ignored",
                        "--nocapture",
                        "--test-threads=1",
                    ])
                    .env("SORNG_PROXY_HELPER_MODE", "leaf")
                    .spawn()
                    .expect("spawn fake descendant");
                std::fs::write(marker, child.id().to_string()).expect("write descendant pid");
                std::mem::forget(child);
            }
            "idle" | "leaf" => {}
            other => panic!("unknown fake helper mode: {other}"),
        }

        loop {
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn lifecycle_preflight_failures_never_spawn_or_register_a_helper() {
        for (index, stage) in [
            LifecycleStage::Bind,
            LifecycleStage::Accept,
            LifecycleStage::Registry,
        ]
        .into_iter()
        .enumerate()
        {
            let session_id = format!("proxy-preflight-{index}");
            let spawned_pid = Arc::new(AtomicU32::new(0));
            run_fake_helper(&session_id, "idle", None, Some(stage), spawned_pid.clone())
                .expect_err("preflight fault must fail closed");
            assert_eq!(spawned_pid.load(Ordering::SeqCst), 0);
            assert!(get_proxy_command_status(&session_id).unwrap().is_none());
        }
    }

    #[test]
    fn failure_after_spawn_reaps_helper_and_removes_registry_state() {
        let session_id = "proxy-after-spawn-failure";
        let spawned_pid = Arc::new(AtomicU32::new(0));
        run_fake_helper(
            session_id,
            "idle",
            None,
            Some(LifecycleStage::AfterSpawn),
            spawned_pid.clone(),
        )
        .expect_err("post-spawn fault must roll back");
        let pid = spawned_pid.load(Ordering::SeqCst);
        assert_ne!(pid, 0, "fault must occur after helper spawn");
        assert!(
            wait_until(|| !process_is_alive(pid), Duration::from_secs(2)),
            "post-spawn rollback left helper {pid} alive"
        );
        assert!(get_proxy_command_status(session_id).unwrap().is_none());
    }

    #[test]
    fn stderr_flood_is_bounded_and_does_not_block_stop() {
        let session_id = "proxy-stderr-flood";
        let spawned_pid = Arc::new(AtomicU32::new(0));
        let _stream = run_fake_helper(session_id, "stderr-flood", None, None, spawned_pid.clone())
            .expect("stderr-flood helper must start");
        let _cleanup = TestSessionGuard::new(session_id);
        assert!(wait_until(
            || {
                proxy_commands_lock().get(session_id).is_some_and(|state| {
                    state.stderr_bytes.load(Ordering::Relaxed) == MAX_STDERR_BYTES_RECORDED
                })
            },
            Duration::from_secs(5)
        ));
        stop_proxy_command(session_id).expect("stderr-flood helper must stop");
        let pid = spawned_pid.load(Ordering::SeqCst);
        assert!(wait_until(
            || !process_is_alive(pid),
            Duration::from_secs(2)
        ));
        assert!(get_proxy_command_status(session_id).unwrap().is_none());
    }

    #[test]
    fn stop_shuts_down_relay_reaps_helper_and_removes_state() {
        let session_id = "proxy-stop-reap";
        let spawned_pid = Arc::new(AtomicU32::new(0));
        let mut stream = run_fake_helper(session_id, "idle", None, None, spawned_pid.clone())
            .expect("fake helper must start");
        let _cleanup = TestSessionGuard::new(session_id);
        let status = get_proxy_command_status(session_id)
            .unwrap()
            .expect("registered ProxyCommand");
        assert!(status.alive);
        assert_eq!(status.pid, Some(spawned_pid.load(Ordering::SeqCst)));

        stop_proxy_command(session_id).expect("fake helper must stop");
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let mut byte = [0u8; 1];
        assert!(
            !matches!(stream.read(&mut byte), Err(error) if error.kind() == std::io::ErrorKind::TimedOut),
            "relay socket stayed open after stop"
        );
        let pid = spawned_pid.load(Ordering::SeqCst);
        assert!(wait_until(
            || !process_is_alive(pid),
            Duration::from_secs(2)
        ));
        assert!(get_proxy_command_status(session_id).unwrap().is_none());
    }

    #[test]
    fn stop_terminates_and_reaps_the_entire_helper_process_tree() {
        let session_id = "proxy-tree-reap";
        let marker = std::env::temp_dir().join(format!(
            "sorng-proxy-tree-{}-{}",
            std::process::id(),
            FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_file(&marker);
        let spawned_pid = Arc::new(AtomicU32::new(0));
        let _stream = run_fake_helper(session_id, "tree", Some(&marker), None, spawned_pid.clone())
            .expect("tree helper must start");
        let _cleanup = TestSessionGuard::new(session_id);
        assert!(wait_until(|| marker.exists(), Duration::from_secs(5)));
        let descendant_pid: u32 = std::fs::read_to_string(&marker)
            .unwrap()
            .trim()
            .parse()
            .unwrap();

        stop_proxy_command(session_id).expect("tree helper must stop");
        let root_pid = spawned_pid.load(Ordering::SeqCst);
        assert!(wait_until(
            || !process_is_alive(root_pid),
            Duration::from_secs(2)
        ));
        assert!(wait_until(
            || !process_is_alive(descendant_pid),
            Duration::from_secs(2)
        ));
        assert!(get_proxy_command_status(session_id).unwrap().is_none());
        let _ = std::fs::remove_file(marker);
    }

    #[test]
    fn unconfirmed_proxy_command_is_refused_with_confirmation_required() {
        // This payload would create a marker if a shell were reached. An
        // imported config defaults command_confirmed=false, so the exact-command
        // gate must reject it before spawn.
        let marker = std::env::temp_dir().join(format!(
            "sorng-unconfirmed-proxy-command-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&marker);

        let mut cfg = free_form_config(false);
        #[cfg(windows)]
        let command = format!("echo unexpected > \"{}\"", marker.display());
        #[cfg(not(windows))]
        let command = format!("printf unexpected > '{}'", marker.display());
        cfg.command = Some(command);

        let err = spawn_proxy_command("sess-unconfirmed", &cfg, "host.example.com", 22, "user", 1)
            .expect_err("unconfirmed ProxyCommand must be refused, not spawned");
        assert!(
            err.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE),
            "error must carry the stable detection prefix, got: {err}"
        );
        // It must not have registered/spawned anything.
        assert!(
            get_proxy_command_status("sess-unconfirmed")
                .unwrap()
                .is_none(),
            "refused ProxyCommand must not register a session"
        );
        assert!(
            !marker.exists(),
            "unconfirmed ProxyCommand reached the system shell"
        );
    }

    #[test]
    fn confirmed_flag_does_not_bypass_fingerprint_gate() {
        // command_confirmed may arrive from persisted/imported config, so it
        // must not bypass the fingerprint-scoped runtime confirmation gate.
        let cfg = free_form_config(true);
        let err = spawn_proxy_command(
            "sess-confirmed-flag",
            &cfg,
            "host.example.com",
            22,
            "user",
            1,
        )
        .expect_err("confirmed flag alone must be refused, not spawned");
        assert!(
            err.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE),
            "confirmed flag alone must still require confirmation, got: {err}"
        );
    }

    #[test]
    fn runtime_confirmation_is_one_shot() {
        // An acknowledgement authorizes exactly one attempt for the exact
        // expanded command and is consumed before any process can be spawned.
        // No stable backend session id exists at confirmation time, so this
        // atomic token is deliberately not widened with a synthetic caller id.
        let cfg = free_form_config(false);
        let expanded = build_command_string(&cfg, "runtime.example.com", 2222, "alice").unwrap();
        mark_proxy_command_confirmed(&expanded);

        require_proxy_command_confirmation(&expanded)
            .expect("the exact confirmed command must clear the gate once");
        let replay = require_proxy_command_confirmation(&expanded)
            .expect_err("a consumed acknowledgement must not be replayable");
        assert!(replay.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE));
    }

    #[test]
    fn runtime_confirmation_is_fingerprint_scoped() {
        // Confirming one command must not implicitly trust a different one.
        let cfg = free_form_config(false);
        let expanded = build_command_string(&cfg, "trusted.example.com", 22, "user").unwrap();
        mark_proxy_command_confirmed(&expanded);

        // A different host → different expansion → still gated.
        let other = build_command_string(&cfg, "evil.example.com", 22, "user").unwrap();
        let err = require_proxy_command_confirmation(&other)
            .expect_err("a different command must remain gated");
        assert!(err.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE));

        // A mismatched attempt must not consume the acknowledgement for the
        // exact command the user reviewed.
        require_proxy_command_confirmation(&expanded)
            .expect("the exact command acknowledgement must remain available");
    }

    #[test]
    fn confirmation_required_error_string_is_stable() {
        let s = ProxyCommandError::ConfirmationRequired.to_string();
        assert!(s.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE));
    }

    #[test]
    fn no_proxy_command_configured_is_never_built_or_gated() {
        // The connect path only reaches the gate when command OR template is
        // set (service.rs: `proxy_cmd.command.is_some() || template.is_some()`).
        // A config with neither is not a ProxyCommand connection at all — prove
        // it doesn't even produce a command string to gate.
        let mut cfg = free_form_config(false);
        cfg.command = None;
        cfg.template = None;
        assert!(
            build_command_string(&cfg, "host", 22, "user").is_err(),
            "empty ProxyCommand config must not yield an executable command"
        );
    }

    #[test]
    fn proxy_password_placeholder_is_rejected_without_exposing_the_secret() {
        let secret = "placeholder-proxy-secret";
        let mut cfg = free_form_config(false);
        cfg.command = Some("proxy-helper --password {proxy_password} %h %p".to_string());
        cfg.proxy_password = Some(SecretString::new(secret.into()));

        let err = build_command_string(&cfg, "host.example.com", 22, "alice")
            .expect_err("proxy passwords must never expand into shell arguments");

        assert!(err.starts_with(PROXY_COMMAND_UNSAFE_PASSWORD_CHANNEL_CODE));
        assert!(!err.contains(secret), "secret leaked through error: {err}");
    }

    #[test]
    fn password_bearing_builtin_templates_fail_closed_before_argv_is_built() {
        let secret = "builtin-proxy-secret";

        for template in [ProxyCommandTemplate::Ncat, ProxyCommandTemplate::Connect] {
            let mut cfg = free_form_config(false);
            cfg.command = None;
            cfg.template = Some(template);
            cfg.proxy_host = Some("proxy.example.com".to_string());
            cfg.proxy_username = Some("alice".to_string());
            cfg.proxy_password = Some(SecretString::new(secret.into()));

            let err = build_command_string(&cfg, "target.example.com", 22, "alice")
                .expect_err("argv-only proxy password helpers must fail closed");

            assert!(err.starts_with(PROXY_COMMAND_UNSAFE_PASSWORD_CHANNEL_CODE));
            assert!(!err.contains(secret), "secret leaked through error: {err}");
        }
    }

    #[test]
    fn retained_proxy_command_state_contains_only_redacted_diagnostics() {
        let secret = "retained-proxy-secret";
        let raw =
            format!("ncat --proxy-auth alice:{secret} proxy.example.com target.example.com 22");
        let state = ProxyCommandState::retained(
            "secret-retention-test",
            &raw,
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            Vec::new(),
        );

        assert!(!state.command.contains(secret));
        assert!(state.command.contains("[REDACTED]"));
        assert!(!format!("{state:?}").contains(secret));
    }

    #[test]
    fn logs_and_status_redact_literal_credentials_case_insensitively() {
        let secrets = [
            "FlagSecret",
            "ShortSecret",
            "AssignmentSecret",
            "PhraseSecret",
            "TokenSecret",
            "KeySecret",
            "UriSecret",
            "AuthSecret",
        ];
        let raw = "proxy-helper --PaSsWoRd FlagSecret -P 'ShortSecret' \
                   PASSWORD=AssignmentSecret PassPhrase:'PhraseSecret' \
                   TOKEN = TokenSecret Api_Key=KeySecret \
                   https://alice:UriSecret@proxy.example \
                   --PROXY-AUTH bob:AuthSecret target.example 22";

        // This is the exact value used by the production log call.
        let log_value = redact_proxy_credentials(raw);
        let session_id = "proxy-command-redaction-status";
        let state = ProxyCommandState::retained(
            session_id,
            raw,
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            Vec::new(),
        );
        PROXY_COMMANDS
            .lock()
            .expect("ProxyCommand state lock")
            .insert(session_id.to_string(), state);
        let status = get_proxy_command_status(session_id)
            .expect("status lookup")
            .expect("retained status");
        PROXY_COMMANDS
            .lock()
            .expect("ProxyCommand state lock")
            .remove(session_id);

        for secret in secrets {
            assert!(!log_value.contains(secret), "log retained {secret}");
            assert!(!status.command.contains(secret), "status retained {secret}");
        }
        assert!(log_value.contains("[REDACTED]"));
        assert!(status.command.contains("[REDACTED]"));
    }

    #[test]
    fn proxy_command_diagnostics_are_bounded() {
        let raw = format!(
            "proxy-helper --password {}",
            "oversized-secret".repeat(MAX_PROXY_COMMAND_DIAGNOSTIC_BYTES)
        );
        let redacted = redact_proxy_credentials(&raw);

        assert!(redacted.len() <= MAX_PROXY_COMMAND_DIAGNOSTIC_BYTES);
        assert!(redacted.ends_with(PROXY_COMMAND_TRUNCATED_MARKER));
        assert!(!redacted.contains("oversized-secret"));
    }

    #[test]
    fn redacts_inline_user_pass_at_host() {
        let cmd = "connect -S alice:s3cr3t@proxy.example.com:1080 target.example.com 22";
        let red = redact_proxy_credentials(cmd);
        assert!(!red.contains("s3cr3t"), "password leaked: {red}");
        assert!(!red.contains("alice:s3cr3t"), "user:pass leaked: {red}");
        // The non-secret host/port context is preserved.
        assert!(red.contains("target.example.com"));
        assert!(red.contains("[REDACTED]@"));
    }

    #[test]
    fn redacts_ncat_proxy_auth_flag() {
        let cmd = "ncat --proxy-type socks5 --proxy 10.0.0.1:1080 --proxy-auth bob:hunter2 host 22";
        let red = redact_proxy_credentials(cmd);
        assert!(!red.contains("hunter2"), "proxy-auth secret leaked: {red}");
        assert!(
            !red.contains("bob:hunter2"),
            "proxy-auth pair leaked: {red}"
        );
        assert!(red.contains("--proxy-auth [REDACTED]"));
    }

    #[test]
    fn redacts_short_password_flag_via_shared_sweep() {
        // -psecret is caught by the shared crate::redact sweep.
        let cmd = "someproxy -psupersecret host 22";
        let red = redact_proxy_credentials(cmd);
        assert!(!red.contains("supersecret"), "-p secret leaked: {red}");
    }

    #[test]
    fn leaves_credential_free_command_intact() {
        let cmd = "nc target.example.com 22";
        assert_eq!(redact_proxy_credentials(cmd), cmd);
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────
