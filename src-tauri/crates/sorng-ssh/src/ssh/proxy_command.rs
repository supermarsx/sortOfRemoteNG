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

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Condvar, Mutex as StdMutex, OnceLock};
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
const MAX_PROXY_COMMAND_REAPERS: usize = 4;
const MAX_PROXY_COMMAND_LIFECYCLES: usize = 128;
const MAX_STDERR_BYTES_RECORDED: usize = 64 * 1024;
const MAX_PROXY_COMMAND_DIAGNOSTIC_BYTES: usize = 16 * 1024;
const PROXY_COMMAND_TRUNCATED_MARKER: &str = "...[TRUNCATED]";
static NEXT_PROXY_COMMAND_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LifecycleStage {
    Bind,
    Accept,
    Registry,
    Reaper,
    #[cfg(windows)]
    BeforeAttach,
    AfterSpawn,
}

#[cfg(test)]
#[derive(Default)]
struct LifecyclePublicationGateState {
    entered: bool,
    released: bool,
}

#[cfg(test)]
type LifecyclePublicationGate = Arc<(StdMutex<LifecyclePublicationGateState>, Condvar)>;

#[derive(Default)]
struct LifecycleHooks {
    #[cfg(test)]
    failure: Option<LifecycleStage>,
    #[cfg(test)]
    spawned_pid: Option<Arc<std::sync::atomic::AtomicU32>>,
    #[cfg(test)]
    lifecycle_count_override: Option<usize>,
    #[cfg(test)]
    publication_gate: Option<LifecyclePublicationGate>,
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

    fn lifecycle_count(&self, actual: usize) -> usize {
        #[cfg(test)]
        {
            self.lifecycle_count_override.unwrap_or(actual)
        }
        #[cfg(not(test))]
        {
            actual
        }
    }

    fn wait_before_publication(&self) {
        #[cfg(test)]
        if let Some(gate) = &self.publication_gate {
            let (state, changed) = &**gate;
            let mut state = state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.entered = true;
            changed.notify_all();
            while !state.released {
                state = changed
                    .wait(state)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        }
    }
}

struct ManagedThread {
    name: &'static str,
    done: Receiver<()>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Clone)]
struct ProxyCommandCleanupCompletion {
    state: Arc<(StdMutex<bool>, Condvar)>,
}

impl ProxyCommandCleanupCompletion {
    fn pending() -> Self {
        Self {
            state: Arc::new((StdMutex::new(false), Condvar::new())),
        }
    }

    fn completed() -> Self {
        let completion = Self::pending();
        completion.complete();
        completion
    }

    fn complete(&self) {
        let (completed, changed) = &*self.state;
        *completed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
        changed.notify_all();
    }

    fn wait(&self) {
        let (completed, changed) = &*self.state;
        let mut completed = completed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while !*completed {
            completed = changed
                .wait(completed)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    fn wait_until(&self, deadline: Instant) -> bool {
        let (completed, changed) = &*self.state;
        let mut completed = completed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while !*completed {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            let (next, timed_out) = changed
                .wait_timeout(completed, remaining)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            completed = next;
            if timed_out.timed_out() && !*completed {
                return false;
            }
        }
        true
    }

    #[cfg(test)]
    fn is_complete(&self) -> bool {
        *self
            .state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn same_as(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.state, &other.state)
    }
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

    fn join_inner(&mut self) {
        let _ = self.done.recv();
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }

    fn join(mut self) {
        self.join_inner();
    }
}

impl Drop for ManagedThread {
    fn drop(&mut self) {
        if self.handle.is_some() {
            log::error!(
                "ProxyCommand worker '{}' reached fallback Drop; joining instead of detaching",
                self.name
            );
            self.join_inner();
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

#[cfg(windows)]
#[repr(C)]
struct ThreadEntry32 {
    size: u32,
    usage: u32,
    thread_id: u32,
    owner_process_id: u32,
    base_priority: i32,
    priority_delta: i32,
    flags: u32,
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "CreateToolhelp32Snapshot"]
    fn create_toolhelp32_snapshot(flags: u32, process_id: u32) -> *mut std::ffi::c_void;
    #[link_name = "Thread32First"]
    fn thread32_first(snapshot: *mut std::ffi::c_void, entry: *mut ThreadEntry32) -> i32;
    #[link_name = "Thread32Next"]
    fn thread32_next(snapshot: *mut std::ffi::c_void, entry: *mut ThreadEntry32) -> i32;
}

#[cfg(windows)]
fn resume_suspended_child(child: &Child) -> std::io::Result<()> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    // std::process intentionally does not expose CreateProcessW's primary
    // thread handle. The process was created suspended, so it still has only
    // that initial thread; enumerate it by owner PID and resume it only after
    // the process has inherited the kill-on-close job.
    const TH32CS_SNAPTHREAD: u32 = 0x0000_0004;
    let raw_snapshot = unsafe { create_toolhelp32_snapshot(TH32CS_SNAPTHREAD, 0) };
    if raw_snapshot == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error());
    }
    let snapshot = unsafe { OwnedHandle::from_raw_handle(raw_snapshot) };
    let mut entry = ThreadEntry32 {
        size: std::mem::size_of::<ThreadEntry32>() as u32,
        usage: 0,
        thread_id: 0,
        owner_process_id: 0,
        base_priority: 0,
        priority_delta: 0,
        flags: 0,
    };

    let mut has_entry = unsafe { thread32_first(snapshot.as_raw_handle(), &mut entry) } != 0;
    while has_entry {
        if entry.owner_process_id == child.id() {
            let raw_thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.thread_id) };
            if raw_thread.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            let thread = unsafe { OwnedHandle::from_raw_handle(raw_thread) };
            let previous_suspend_count = unsafe { ResumeThread(thread.as_raw_handle()) };
            if previous_suspend_count == u32::MAX {
                return Err(std::io::Error::last_os_error());
            }
            if previous_suspend_count != 1 {
                return Err(std::io::Error::other(format!(
                    "ProxyCommand primary thread had unexpected suspend count {previous_suspend_count}"
                )));
            }
            return Ok(());
        }
        has_entry = unsafe { thread32_next(snapshot.as_raw_handle(), &mut entry) } != 0;
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "ProxyCommand primary thread was not found",
    ))
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
    cleanup_completion: Option<ProxyCommandCleanupCompletion>,
    cleanup_enqueued: bool,
    generation: u64,
    active: bool,
    producer_released: bool,
    native_cleanup_complete: bool,
    #[cfg(test)]
    cleanup_gate: Option<Receiver<()>>,
    #[cfg(test)]
    reject_cleanup_enqueue_once: bool,
    #[cfg(test)]
    panic_cleanup_before_claim_once: bool,
    #[cfg(test)]
    panic_cleanup_after_claim_once: bool,
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
    fn reserved(session_id: &str, generation: u64) -> Self {
        Self {
            session_id: session_id.to_string(),
            command: String::new(),
            child: None,
            process_tree: None,
            control_socket: None,
            cancelled: Arc::new(AtomicBool::new(false)),
            relay_handles: Vec::new(),
            stderr_bytes: Arc::new(AtomicUsize::new(0)),
            stderr_truncated: Arc::new(AtomicBool::new(false)),
            stopping: false,
            cleanup_completion: None,
            cleanup_enqueued: false,
            generation,
            active: false,
            producer_released: false,
            native_cleanup_complete: false,
            #[cfg(test)]
            cleanup_gate: None,
            #[cfg(test)]
            reject_cleanup_enqueue_once: false,
            #[cfg(test)]
            panic_cleanup_before_claim_once: false,
            #[cfg(test)]
            panic_cleanup_after_claim_once: false,
        }
    }

    fn activate(
        &mut self,
        expanded_command: &str,
        child: Arc<StdMutex<Child>>,
        process_tree: Arc<ProcessTreeGuard>,
        control_socket: TcpStream,
        cancelled: Arc<AtomicBool>,
        stderr: StderrCaptureCounters,
    ) {
        self.command = redact_proxy_credentials(expanded_command);
        self.child = Some(child);
        self.process_tree = Some(process_tree);
        self.control_socket = Some(control_socket);
        self.cancelled = cancelled;
        self.stderr_bytes = stderr.bytes;
        self.stderr_truncated = stderr.truncated;
        self.active = true;
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
            cleanup_completion: None,
            cleanup_enqueued: false,
            generation: 0,
            active: true,
            producer_released: true,
            native_cleanup_complete: false,
            #[cfg(test)]
            cleanup_gate: None,
            #[cfg(test)]
            reject_cleanup_enqueue_once: false,
            #[cfg(test)]
            panic_cleanup_before_claim_once: false,
            #[cfg(test)]
            panic_cleanup_after_claim_once: false,
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

fn validate_proxy_command_registration(
    commands: &HashMap<String, ProxyCommandState>,
    session_id: &str,
    lifecycle_count: usize,
) -> Result<(), String> {
    if commands.contains_key(session_id) {
        return Err(format!(
            "ProxyCommand session '{session_id}' is already active or stopping"
        ));
    }
    if lifecycle_count >= MAX_PROXY_COMMAND_LIFECYCLES {
        return Err(format!(
            "ProxyCommand lifecycle limit reached ({MAX_PROXY_COMMAND_LIFECYCLES} active or stopping)"
        ));
    }
    Ok(())
}

pub(crate) struct ProxyCommandProducerReservation {
    session_id: String,
    generation: u64,
}

impl ProxyCommandProducerReservation {
    fn matches(&self, session_id: &str, generation: u64) -> bool {
        self.session_id == session_id && self.generation == generation
    }
}

impl Drop for ProxyCommandProducerReservation {
    fn drop(&mut self) {
        acknowledge_proxy_command_producer(&self.session_id, self.generation);
    }
}

fn insert_proxy_command_reservation(
    commands: &mut HashMap<String, ProxyCommandState>,
    session_id: &str,
    lifecycle_count: usize,
) -> Result<ProxyCommandProducerReservation, String> {
    validate_proxy_command_registration(commands, session_id, lifecycle_count)?;
    let generation = NEXT_PROXY_COMMAND_GENERATION.fetch_add(1, Ordering::AcqRel);
    commands.insert(
        session_id.to_string(),
        ProxyCommandState::reserved(session_id, generation),
    );
    Ok(ProxyCommandProducerReservation {
        session_id: session_id.to_string(),
        generation,
    })
}

pub(crate) fn reserve_proxy_command_session(
    session_id: &str,
) -> Result<ProxyCommandProducerReservation, String> {
    relay_reaper_queue()?;
    let mut commands = proxy_commands_lock();
    let lifecycle_count = commands.len();
    insert_proxy_command_reservation(&mut commands, session_id, lifecycle_count)
}

fn reserve_proxy_command_session_with_hooks(
    session_id: &str,
    hooks: &LifecycleHooks,
) -> Result<ProxyCommandProducerReservation, String> {
    let mut commands = proxy_commands_lock();
    let lifecycle_count = hooks.lifecycle_count(commands.len());
    insert_proxy_command_reservation(&mut commands, session_id, lifecycle_count)
}

fn acknowledge_proxy_command_producer(session_id: &str, generation: u64) {
    let mut commands = proxy_commands_lock();
    let Some(state) = commands.get_mut(session_id) else {
        return;
    };
    if state.generation != generation {
        return;
    }
    state.producer_released = true;
    let should_remove = !state.active || (state.stopping && state.native_cleanup_complete);
    let completion = should_remove
        .then(|| state.cleanup_completion.clone())
        .flatten();
    if should_remove {
        commands.remove(session_id);
    }
    drop(commands);
    if let Some(completion) = completion {
        completion.complete();
    }
}

struct RelayReapTask {
    session_id: String,
    child: Option<Arc<StdMutex<Child>>>,
    process_tree: Option<Arc<ProcessTreeGuard>>,
    control_socket: Option<TcpStream>,
    workers: Vec<ManagedThread>,
    completion: ProxyCommandCleanupCompletion,
    stderr_bytes: Arc<AtomicUsize>,
    stderr_truncated: Arc<AtomicBool>,
    #[cfg(test)]
    cleanup_gate: Option<Receiver<()>>,
}

#[derive(Clone)]
struct RelayReapTicket {
    session_id: String,
    completion: ProxyCommandCleanupCompletion,
    #[cfg(test)]
    reject_enqueue: bool,
    #[cfg(test)]
    panic_before_claim: bool,
    #[cfg(test)]
    panic_after_claim: bool,
}

struct RelayReaperQueueState {
    tickets: VecDeque<RelayReapTicket>,
    shutting_down: bool,
}

struct RelayReaperShared {
    state: StdMutex<RelayReaperQueueState>,
    changed: Condvar,
}

struct RelayReaper {
    shared: Arc<RelayReaperShared>,
    _workers: Vec<JoinHandle<()>>,
}

static RELAY_REAPER_QUEUE: OnceLock<Result<RelayReaper, String>> = OnceLock::new();
static ACTIVE_RELAY_REAPERS: AtomicUsize = AtomicUsize::new(0);
static PEAK_RELAY_REAPERS: AtomicUsize = AtomicUsize::new(0);
#[cfg(test)]
static RELAY_REAP_PANIC_RECOVERIES: AtomicUsize = AtomicUsize::new(0);

fn finish_proxy_command_cleanup(task: &mut RelayReapTask) {
    #[cfg(test)]
    if let Some(gate) = task.cleanup_gate.take() {
        let _ = gate.recv();
    }

    if let Some(child_handle) = &task.child {
        let pid = child_pid(child_handle);
        if let Some(process_tree) = &task.process_tree {
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

    while let Some(worker) = task.workers.pop() {
        worker.join();
    }
    drop(task.control_socket.take());
    drop(task.process_tree.take());
    drop(task.child.take());

    let mut commands = proxy_commands_lock();
    let complete_now = if let Some(state) = commands.get_mut(&task.session_id) {
        let owns_cleanup = state
            .cleanup_completion
            .as_ref()
            .is_some_and(|current| current.same_as(&task.completion));
        if owns_cleanup {
            state.native_cleanup_complete = true;
            if state.producer_released {
                commands.remove(&task.session_id);
                true
            } else {
                false
            }
        } else {
            true
        }
    } else {
        true
    };
    drop(commands);

    log::info!(
        "[{}] ProxyCommand stopped (stderr drained: {} bytes{})",
        task.session_id,
        task.stderr_bytes.load(Ordering::Relaxed),
        if task.stderr_truncated.load(Ordering::Relaxed) {
            ", truncated"
        } else {
            ""
        }
    );
    if complete_now {
        task.completion.complete();
    }
}

fn finish_proxy_command_cleanup_slot(slot: &Arc<StdMutex<Option<RelayReapTask>>>) {
    let mut task = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(task) = task.as_mut() {
        finish_proxy_command_cleanup(task);
    }
    task.take();
}

fn claim_proxy_command_cleanup(ticket: &RelayReapTicket) -> Option<RelayReapTask> {
    let mut commands = proxy_commands_lock();
    let state = commands.get_mut(&ticket.session_id)?;
    let owns_cleanup = state
        .cleanup_completion
        .as_ref()
        .is_some_and(|current| current.same_as(&ticket.completion));
    if !owns_cleanup || !state.active {
        return None;
    }
    Some(RelayReapTask {
        session_id: ticket.session_id.clone(),
        child: state.child.take(),
        process_tree: state.process_tree.take(),
        control_socket: state.control_socket.take(),
        workers: std::mem::take(&mut state.relay_handles),
        completion: ticket.completion.clone(),
        stderr_bytes: state.stderr_bytes.clone(),
        stderr_truncated: state.stderr_truncated.clone(),
        #[cfg(test)]
        cleanup_gate: state.cleanup_gate.take(),
    })
}

fn claim_proxy_command_cleanup_from_slot(
    ticket_slot: &Arc<StdMutex<Option<RelayReapTicket>>>,
) -> Option<(RelayReapTask, bool)> {
    let mut ticket_slot = ticket_slot
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let ticket = ticket_slot.as_mut()?;
    #[cfg(test)]
    if std::mem::take(&mut ticket.panic_before_claim) {
        panic!("injected ProxyCommand cleanup panic before ownership claim");
    }
    let Some(task) = claim_proxy_command_cleanup(ticket) else {
        ticket_slot.take();
        return None;
    };
    #[cfg(test)]
    let panic_after_claim = ticket.panic_after_claim;
    #[cfg(not(test))]
    let panic_after_claim = false;
    ticket_slot.take();
    Some((task, panic_after_claim))
}

fn process_relay_reap_ticket(ticket: RelayReapTicket) -> Option<RelayReapTicket> {
    let ticket_slot = Arc::new(StdMutex::new(Some(ticket)));
    let claim_slot = Arc::clone(&ticket_slot);
    let claimed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        claim_proxy_command_cleanup_from_slot(&claim_slot)
    }));
    let (task, panic_after_claim) = (match claimed {
        Ok(claimed) => claimed,
        Err(_) => {
            #[cfg(test)]
            RELAY_REAP_PANIC_RECOVERIES.fetch_add(1, Ordering::AcqRel);
            log::error!(
                "ProxyCommand cleanup attempt panicked before claim; requeueing retained ticket"
            );
            return ticket_slot
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();
        }
    })?;
    #[cfg(not(test))]
    let _ = panic_after_claim;
    let task_slot = Arc::new(StdMutex::new(Some(task)));
    let worker_slot = Arc::clone(&task_slot);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        #[cfg(test)]
        if panic_after_claim {
            panic!("injected ProxyCommand cleanup panic after ownership claim");
        }
        finish_proxy_command_cleanup_slot(&worker_slot);
    }));
    if result.is_err() {
        #[cfg(test)]
        RELAY_REAP_PANIC_RECOVERIES.fetch_add(1, Ordering::AcqRel);
        log::error!("ProxyCommand cleanup attempt panicked after claim; retrying owned task");
        finish_proxy_command_cleanup_slot(&task_slot);
    }
    None
}

fn relay_reaper_worker(shared: Arc<RelayReaperShared>) {
    loop {
        let ticket = {
            let mut state = shared
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            while state.tickets.is_empty() && !state.shutting_down {
                state = shared
                    .changed
                    .wait(state)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            if state.shutting_down {
                return;
            }
            let Some(ticket) = state.tickets.pop_front() else {
                continue;
            };
            ticket
        };
        let active = ACTIVE_RELAY_REAPERS.fetch_add(1, Ordering::AcqRel) + 1;
        PEAK_RELAY_REAPERS.fetch_max(active, Ordering::AcqRel);
        if let Some(ticket) = process_relay_reap_ticket(ticket) {
            let mut state = shared
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.tickets.push_back(ticket);
            drop(state);
            shared.changed.notify_one();
            std::thread::yield_now();
        }
        ACTIVE_RELAY_REAPERS.fetch_sub(1, Ordering::AcqRel);
    }
}

fn build_relay_reaper(
    mut spawn_worker: impl FnMut(usize, Arc<RelayReaperShared>) -> std::io::Result<JoinHandle<()>>,
) -> Result<RelayReaper, String> {
    let shared = Arc::new(RelayReaperShared {
        state: StdMutex::new(RelayReaperQueueState {
            tickets: VecDeque::new(),
            shutting_down: false,
        }),
        changed: Condvar::new(),
    });
    let mut workers = Vec::with_capacity(MAX_PROXY_COMMAND_REAPERS);
    for index in 0..MAX_PROXY_COMMAND_REAPERS {
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
                    "Failed to initialize ProxyCommand cleanup reaper {index}: {error}"
                ));
            }
        }
    }
    Ok(RelayReaper {
        shared,
        _workers: workers,
    })
}

fn initialize_relay_reaper() -> Result<RelayReaper, String> {
    build_relay_reaper(|index, shared| {
        std::thread::Builder::new()
            .name(format!("proxy-relay-reaper-{index}"))
            .spawn(move || relay_reaper_worker(shared))
    })
}

fn relay_reaper_queue() -> Result<&'static RelayReaper, String> {
    match RELAY_REAPER_QUEUE.get_or_init(initialize_relay_reaper) {
        Ok(reaper) => Ok(reaper),
        Err(error) => Err(error.clone()),
    }
}

impl RelayReaper {
    fn enqueue(&self, ticket: RelayReapTicket) -> Result<(), String> {
        #[cfg(test)]
        if ticket.reject_enqueue {
            return Err("ProxyCommand cleanup queue rejected an injected ticket".to_string());
        }
        let mut state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.shutting_down {
            return Err("ProxyCommand cleanup reaper is shutting down".to_string());
        }
        if state.tickets.len() >= MAX_PROXY_COMMAND_LIFECYCLES {
            return Err(
                "ProxyCommand cleanup queue invariant exceeded; ownership retained for retry"
                    .to_string(),
            );
        }
        state.tickets.push_back(ticket);
        drop(state);
        self.shared.changed.notify_one();
        Ok(())
    }
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
/// 3. Creating the helper inside its OS process-tree boundary. Windows creates
///    it suspended, attaches the job, then resumes it; Unix assigns the process
///    group atomically at spawn.
/// 4. Registering the helper and starting bounded stderr, relay, and monitor
///    workers.
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
        None,
    )
}

pub(crate) fn spawn_reserved_proxy_command(
    reservation: &ProxyCommandProducerReservation,
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
        Some(reservation),
    )
}

// Keeping the connection fields explicit makes the production and failure-injection
// call sites auditable; bundling them would only hide this lifecycle boundary.
#[allow(clippy::too_many_arguments)]
fn spawn_proxy_command_inner(
    session_id: &str,
    config: &ProxyCommandConfig,
    host: &str,
    port: u16,
    username: &str,
    connect_timeout: u64,
    hooks: &LifecycleHooks,
    reserved_by: Option<&ProxyCommandProducerReservation>,
) -> Result<TcpStream, String> {
    let cmd_string = build_command_string(config, host, port, username)?;

    if hooks.should_fail(LifecycleStage::Reaper) {
        return Err(
            "Failed to initialize ProxyCommand cleanup reaper: injected failure".to_string(),
        );
    }
    // Cleanup infrastructure must exist before confirmation is consumed and
    // before a listener, helper, process-tree handle, or relay worker exists.
    relay_reaper_queue()?;
    let local_reservation = if reserved_by.is_none() {
        Some(reserve_proxy_command_session_with_hooks(session_id, hooks)?)
    } else {
        None
    };
    let reservation = reserved_by
        .or(local_reservation.as_ref())
        .expect("ProxyCommand spawn always owns or borrows a producer reservation");
    if reservation.session_id != session_id {
        return Err(format!(
            "ProxyCommand reservation for '{}' cannot spawn session '{session_id}'",
            reservation.session_id
        ));
    }

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
    let state = commands
        .get(session_id)
        .ok_or_else(|| format!("ProxyCommand session '{session_id}' lost its reservation"))?;
    if !reservation.matches(session_id, state.generation) {
        return Err(format!(
            "ProxyCommand session '{session_id}' reservation generation changed before helper spawn"
        ));
    }
    if state.stopping {
        return Err(format!(
            "ProxyCommand session '{session_id}' was cancelled before helper spawn"
        ));
    }
    if state.active {
        return Err(format!(
            "ProxyCommand session '{session_id}' is already active"
        ));
    }

    let process_tree = Arc::new(
        ProcessTreeGuard::prepare()
            .map_err(|e| format!("Failed to prepare ProxyCommand process guard: {e}"))?,
    );
    log::info!("[{}] Spawning ProxyCommand: {}", session_id, redacted_cmd);
    #[cfg(windows)]
    let mut child = spawn_suspended_shell_command(&cmd_string)
        .map_err(|e| format!("Failed to spawn suspended ProxyCommand: {e}"))?;
    #[cfg(not(windows))]
    let mut child = spawn_shell_command(&cmd_string)
        .map_err(|e| format!("Failed to spawn ProxyCommand: {e}"))?;
    hooks.record_spawned_pid(child.id());

    #[cfg(windows)]
    if hooks.should_fail(LifecycleStage::BeforeAttach) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(
            "ProxyCommand setup failed before process-tree attachment: injected failure"
                .to_string(),
        );
    }

    if let Err(error) = process_tree.attach(&child) {
        process_tree.terminate(child.id());
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!(
            "Failed to attach ProxyCommand process-tree guard: {error}"
        ));
    }
    #[cfg(windows)]
    if let Err(error) = resume_suspended_child(&child) {
        process_tree.terminate(child.id());
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!(
            "Failed to resume guarded ProxyCommand process: {error}"
        ));
    }

    let child = Arc::new(StdMutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    let stderr_bytes = Arc::new(AtomicUsize::new(0));
    let stderr_truncated = Arc::new(AtomicBool::new(false));
    hooks.wait_before_publication();
    commands
        .get_mut(session_id)
        .expect("reserved ProxyCommand remains locked through publication")
        .activate(
            &cmd_string,
            child.clone(),
            process_tree.clone(),
            relay_socket,
            cancelled.clone(),
            StderrCaptureCounters {
                bytes: stderr_bytes.clone(),
                truncated: stderr_truncated.clone(),
            },
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

fn begin_proxy_command_cleanup(session_id: &str) -> Result<ProxyCommandCleanupCompletion, String> {
    {
        let commands = proxy_commands_lock();
        let Some(state) = commands.get(session_id) else {
            return Ok(ProxyCommandCleanupCompletion::completed());
        };
        if state.cleanup_enqueued {
            if let Some(completion) = &state.cleanup_completion {
                return Ok(completion.clone());
            }
            log::error!("ProxyCommand '{session_id}' marked cleanup-enqueued without a completion");
        }
    }

    // Every production ProxyCommand initializes this pool before helper spawn.
    // Resolve it again before taking ownership so an injected/test-only state
    // also fails without losing any relay handles.
    let reaper = relay_reaper_queue()?;
    let mut commands = proxy_commands_lock();
    let Some(state) = commands.get_mut(session_id) else {
        return Ok(ProxyCommandCleanupCompletion::completed());
    };
    let completion = state
        .cleanup_completion
        .get_or_insert_with(ProxyCommandCleanupCompletion::pending)
        .clone();
    state.stopping = true;
    state.cancelled.store(true, Ordering::Release);
    if !state.active {
        state.native_cleanup_complete = true;
        let producer_released = state.producer_released;
        if producer_released {
            commands.remove(session_id);
        }
        drop(commands);
        if producer_released {
            completion.complete();
        }
        return Ok(completion);
    }
    if !state.cleanup_enqueued {
        if let Some(socket) = &state.control_socket {
            let _ = socket.shutdown(Shutdown::Both);
        }
        reaper.enqueue(RelayReapTicket {
            session_id: session_id.to_string(),
            completion: completion.clone(),
            #[cfg(test)]
            reject_enqueue: std::mem::take(&mut state.reject_cleanup_enqueue_once),
            #[cfg(test)]
            panic_before_claim: std::mem::take(&mut state.panic_cleanup_before_claim_once),
            #[cfg(test)]
            panic_after_claim: std::mem::take(&mut state.panic_cleanup_after_claim_once),
        })?;
        state.cleanup_enqueued = true;
    }
    drop(commands);
    Ok(completion)
}

/// Stop a ProxyCommand process for a session. All native cleanup ownership is
/// transferred immediately to the fixed reaper pool. The compatibility caller
/// waits only until the API-entry deadline; actual cleanup continues under the
/// retained registry tombstone.
pub fn stop_proxy_command(session_id: &str) -> Result<(), String> {
    let deadline = Instant::now() + STOP_JOIN_TIMEOUT;
    let completion = begin_proxy_command_cleanup(session_id)?;
    let _ = completion.wait_until(deadline);
    Ok(())
}

/// Stop a ProxyCommand and wait until every relay thread has actually exited.
/// Callers retaining resource-accounting leases should use this inside their
/// detached cleanup worker.
pub fn stop_proxy_command_and_wait(session_id: &str) -> Result<(), String> {
    loop {
        match begin_proxy_command_cleanup(session_id) {
            Ok(completion) => {
                completion.wait();
                return Ok(());
            }
            Err(error) => {
                // Lease-owning service callers must never release admission
                // while a retryable tombstone still owns native resources.
                log::error!(
                    "[{session_id}] ProxyCommand cleanup enqueue failed; retaining ownership and retrying: {error}"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn install_blocked_relay_for_accounting_test(
    session_id: &str,
    release: Receiver<()>,
) -> Result<(), String> {
    relay_reaper_queue()?;
    {
        let mut commands = proxy_commands_lock();
        validate_proxy_command_registration(&commands, session_id, commands.len())?;
        commands.insert(
            session_id.to_string(),
            ProxyCommandState::retained(
                session_id,
                "test-helper",
                Arc::new(AtomicBool::new(false)),
                Vec::new(),
            ),
        );
    }
    let worker = ManagedThread::spawn("proxy-accounting-test-relay", move || {
        let _ = release.recv();
    });
    let worker = match worker {
        Ok(worker) => worker,
        Err(error) => {
            proxy_commands_lock().remove(session_id);
            return Err(format!("Failed to start accounting test relay: {error}"));
        }
    };
    let mut commands = proxy_commands_lock();
    commands
        .get_mut(session_id)
        .expect("accounting test reservation remains registered")
        .relay_handles
        .push(worker);
    Ok(())
}

#[cfg(test)]
pub(crate) fn reject_next_cleanup_enqueue_for_test(session_id: &str) -> Result<(), String> {
    let mut commands = proxy_commands_lock();
    let state = commands
        .get_mut(session_id)
        .ok_or_else(|| "ProxyCommand cleanup rejection test session is missing".to_string())?;
    state.reject_cleanup_enqueue_once = true;
    Ok(())
}

#[cfg(test)]
pub(crate) fn begin_proxy_command_cleanup_for_test(session_id: &str) -> Result<(), String> {
    begin_proxy_command_cleanup(session_id).map(drop)
}

#[cfg(test)]
pub(crate) fn has_proxy_command_lifecycle_for_test(session_id: &str) -> bool {
    has_proxy_command_lifecycle(session_id)
}

/// Reports registry ownership, including Reserved and Stopping tombstones that
/// are deliberately hidden from the user-facing status API. SSH service
/// producers reserve before their native worker launches, so an absent entry at
/// disconnect cannot appear later for that same service attempt.
pub(crate) fn has_proxy_command_lifecycle(session_id: &str) -> bool {
    proxy_commands_lock().contains_key(session_id)
}

/// Get ProxyCommand status for a session.
pub fn get_proxy_command_status(session_id: &str) -> Result<Option<ProxyCommandStatus>, String> {
    let mut commands = proxy_commands_lock();
    let Some(state) = commands.get_mut(session_id) else {
        return Ok(None);
    };
    if state.stopping || !state.active {
        return Ok(None);
    }
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

#[cfg(windows)]
fn windows_shell_command(cmd: &str, extra_creation_flags: u32) -> Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new("cmd.exe");
    command
        .args(["/D", "/S", "/C"])
        // cmd.exe does not use MSVCRT argv parsing. `/S /C` requires one outer
        // quote pair around the exact command string; raw_arg prevents Rust
        // from adding a second, incompatible layer of argument escaping.
        .raw_arg(format!("\"{cmd}\""))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW | extra_creation_flags);
    command
}

#[cfg(windows)]
fn spawn_suspended_shell_command(cmd: &str) -> std::io::Result<Child> {
    const CREATE_SUSPENDED: u32 = 0x0000_0004;
    windows_shell_command(cmd, CREATE_SUSPENDED).spawn()
}

/// Spawn a command via the system shell with piped stdin/stdout.
pub fn spawn_shell_command(cmd: &str) -> std::io::Result<Child> {
    #[cfg(windows)]
    {
        windows_shell_command(cmd, 0).spawn()
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

    #[cfg(windows)]
    struct TestFileCleanup(std::path::PathBuf);

    #[cfg(windows)]
    impl Drop for TestFileCleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
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
                lifecycle_count_override: None,
                publication_gate: None,
            },
            None,
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

    fn gated_managed_thread(
        gate: Arc<(StdMutex<bool>, Condvar)>,
        exited: Arc<AtomicUsize>,
    ) -> ManagedThread {
        ManagedThread::spawn("proxy-test-gated-relay", move || {
            let (open, changed) = &*gate;
            let mut open = open.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            while !*open {
                open = changed
                    .wait(open)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            exited.fetch_add(1, Ordering::AcqRel);
        })
        .expect("gated ProxyCommand test relay should start")
    }

    fn open_gate(gate: &Arc<(StdMutex<bool>, Condvar)>) {
        let (open, changed) = &**gate;
        *open.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
        changed.notify_all();
    }

    fn wait_for_publication_gate(gate: &LifecyclePublicationGate) -> bool {
        wait_until(
            || {
                gate.0
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .entered
            },
            Duration::from_secs(2),
        )
    }

    fn release_publication_gate(gate: &LifecyclePublicationGate) {
        let (state, changed) = &**gate;
        state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .released = true;
        changed.notify_all();
    }

    #[test]
    fn producer_drop_after_pre_spawn_error_releases_exact_reservation() {
        let session_id = format!(
            "proxy-producer-drop-{}",
            FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let reservation =
            reserve_proxy_command_session(&session_id).expect("reservation should succeed");
        let config = fake_helper_config("idle", None);
        let spawned_pid = Arc::new(AtomicU32::new(0));

        let error = spawn_proxy_command_inner(
            &session_id,
            &config,
            "host.example.com",
            22,
            "user",
            2,
            &LifecycleHooks {
                spawned_pid: Some(Arc::clone(&spawned_pid)),
                ..LifecycleHooks::default()
            },
            Some(&reservation),
        )
        .expect_err("unconfirmed command should fail before helper spawn");
        assert!(error.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE));
        assert_eq!(spawned_pid.load(Ordering::SeqCst), 0);
        assert!(proxy_commands_lock().contains_key(&session_id));
        assert!(get_proxy_command_status(&session_id).unwrap().is_none());

        drop(reservation);
        assert!(wait_until(
            || !proxy_commands_lock().contains_key(&session_id),
            Duration::from_secs(2)
        ));
    }

    #[test]
    fn stop_before_reservation_claim_prevents_helper_spawn_until_producer_ack() {
        let session_id = format!(
            "proxy-stop-before-claim-{}",
            FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let reservation =
            reserve_proxy_command_session(&session_id).expect("reservation should succeed");
        let completion = begin_proxy_command_cleanup(&session_id)
            .expect("reserved lifecycle should enter stopping state");
        assert!(!completion.is_complete());

        let config = fake_helper_config("idle", None);
        let expanded = build_command_string(&config, "host.example.com", 22, "user").unwrap();
        mark_proxy_command_confirmed(&expanded);
        let spawned_pid = Arc::new(AtomicU32::new(0));
        let error = spawn_proxy_command_inner(
            &session_id,
            &config,
            "host.example.com",
            22,
            "user",
            2,
            &LifecycleHooks {
                spawned_pid: Some(Arc::clone(&spawned_pid)),
                ..LifecycleHooks::default()
            },
            Some(&reservation),
        )
        .expect_err("stopped reservation must fail before helper spawn");
        assert!(error.contains("cancelled before helper spawn"));
        assert_eq!(spawned_pid.load(Ordering::SeqCst), 0);
        assert!(proxy_commands_lock().contains_key(&session_id));

        drop(reservation);
        assert!(wait_until(
            || completion.is_complete(),
            Duration::from_secs(2)
        ));
        assert!(!proxy_commands_lock().contains_key(&session_id));
    }

    #[test]
    fn stop_during_guarded_spawn_waits_for_publication_and_reaps_helper() {
        let session_id = format!(
            "proxy-stop-during-publication-{}",
            FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let reservation =
            reserve_proxy_command_session(&session_id).expect("reservation should succeed");
        let config = fake_helper_config("idle", None);
        let expanded = build_command_string(&config, "host.example.com", 22, "user").unwrap();
        mark_proxy_command_confirmed(&expanded);
        let spawned_pid = Arc::new(AtomicU32::new(0));
        let publication_gate: LifecyclePublicationGate = Arc::default();
        let spawn_gate = Arc::clone(&publication_gate);
        let spawn_pid = Arc::clone(&spawned_pid);
        let spawn_session_id = session_id.clone();
        let spawn_thread = std::thread::spawn(move || {
            spawn_proxy_command_inner(
                &spawn_session_id,
                &config,
                "host.example.com",
                22,
                "user",
                2,
                &LifecycleHooks {
                    spawned_pid: Some(spawn_pid),
                    publication_gate: Some(spawn_gate),
                    ..LifecycleHooks::default()
                },
                Some(&reservation),
            )
        });

        assert!(wait_for_publication_gate(&publication_gate));
        let pid = spawned_pid.load(Ordering::SeqCst);
        assert_ne!(pid, 0, "helper must exist before Active publication");
        let (stop_started_tx, stop_started_rx) = mpsc::channel();
        let (stop_done_tx, stop_done_rx) = mpsc::channel();
        let stop_session_id = session_id.clone();
        let stop_thread = std::thread::spawn(move || {
            stop_started_tx.send(()).unwrap();
            let result = stop_proxy_command_and_wait(&stop_session_id);
            stop_done_tx.send(result).unwrap();
        });
        stop_started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("stop thread should start before publication is released");
        assert!(
            stop_done_rx
                .recv_timeout(Duration::from_millis(50))
                .is_err(),
            "stop cannot finish while guarded publication owns the registry lock"
        );

        release_publication_gate(&publication_gate);
        let stream = spawn_thread
            .join()
            .expect("spawn worker should not panic")
            .expect("guarded helper should publish before stop claims it");
        drop(stream);
        stop_done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("stop should finish after producer acknowledgement")
            .expect("published helper cleanup should succeed");
        stop_thread.join().expect("stop worker should not panic");
        assert!(wait_until(
            || !process_is_alive(pid),
            Duration::from_secs(2)
        ));
        assert!(!proxy_commands_lock().contains_key(&session_id));
    }

    #[test]
    fn relay_reaper_initialization_fails_closed_at_first_and_partial_worker() {
        let first =
            build_relay_reaper(|_, _| Err(std::io::Error::other("injected first-worker failure")));
        assert!(matches!(first, Err(error) if error.contains("reaper 0")));

        let partial = build_relay_reaper(|index, shared| {
            if index == 1 {
                Err(std::io::Error::other("injected partial-worker failure"))
            } else {
                std::thread::Builder::new()
                    .name("proxy-test-partial-reaper".to_string())
                    .spawn(move || relay_reaper_worker(shared))
            }
        });
        assert!(matches!(partial, Err(error) if error.contains("reaper 1")));
    }

    #[test]
    fn slow_cleanup_keeps_tombstone_but_stop_obeys_api_entry_deadline() {
        relay_reaper_queue().expect("cleanup reaper should initialize");
        let session_id = format!(
            "proxy-slow-cleanup-{}",
            FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let (release, cleanup_gate) = mpsc::channel();
        let mut state = ProxyCommandState::retained(
            &session_id,
            "test-helper",
            Arc::new(AtomicBool::new(false)),
            Vec::new(),
        );
        state.cleanup_gate = Some(cleanup_gate);
        proxy_commands_lock().insert(session_id.clone(), state);

        let started = Instant::now();
        stop_proxy_command(&session_id).expect("bounded stop should enqueue cleanup");
        let elapsed = started.elapsed();
        assert!(
            elapsed >= STOP_JOIN_TIMEOUT.saturating_sub(Duration::from_millis(100)),
            "stop returned before its completion wait: {elapsed:?}"
        );
        assert!(
            elapsed < STOP_JOIN_TIMEOUT + Duration::from_secs(2),
            "stop exceeded its API-entry deadline excessively: {elapsed:?}"
        );
        let completion = proxy_commands_lock()
            .get(&session_id)
            .and_then(|state| state.cleanup_completion.clone())
            .expect("slow cleanup must retain its tombstone and completion");
        assert!(!completion.is_complete());

        release.send(()).expect("release slow cleanup");
        assert!(wait_until(
            || completion.is_complete(),
            Duration::from_secs(2)
        ));
        assert!(!proxy_commands_lock().contains_key(&session_id));
    }

    #[test]
    fn rejected_cleanup_ticket_retains_ownership_and_retries_same_completion() {
        relay_reaper_queue().expect("cleanup reaper should initialize");
        let session_id = format!(
            "proxy-rejected-ticket-{}",
            FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let gate = Arc::new((StdMutex::new(false), Condvar::new()));
        let exited = Arc::new(AtomicUsize::new(0));
        let worker = gated_managed_thread(Arc::clone(&gate), Arc::clone(&exited));
        let mut state = ProxyCommandState::retained(
            &session_id,
            "test-helper",
            Arc::new(AtomicBool::new(false)),
            vec![worker],
        );
        state.reject_cleanup_enqueue_once = true;
        proxy_commands_lock().insert(session_id.clone(), state);
        let error = match begin_proxy_command_cleanup(&session_id) {
            Ok(_) => panic!("injected queue rejection must surface"),
            Err(error) => error,
        };
        assert!(error.contains("rejected"));
        let retained_completion = {
            let commands = proxy_commands_lock();
            let state = commands
                .get(&session_id)
                .expect("rejected ticket keeps its tombstone");
            assert!(!state.cleanup_enqueued);
            assert_eq!(state.relay_handles.len(), 1);
            state.cleanup_completion.clone().unwrap()
        };
        assert!(!retained_completion.is_complete());
        assert_eq!(exited.load(Ordering::Acquire), 0);

        let retry = begin_proxy_command_cleanup(&session_id)
            .expect("retry should enqueue the retained tombstone");
        assert!(retry.same_as(&retained_completion));
        open_gate(&gate);
        assert!(wait_until(|| retry.is_complete(), Duration::from_secs(2)));
        assert_eq!(exited.load(Ordering::Acquire), 1);
        assert!(!proxy_commands_lock().contains_key(&session_id));
    }

    #[test]
    fn before_claim_panic_requeues_ticket_and_worker_processes_next_ticket() {
        relay_reaper_queue().expect("cleanup reaper should initialize");
        let recovered_before = RELAY_REAP_PANIC_RECOVERIES.load(Ordering::Acquire);
        let exited = Arc::new(AtomicUsize::new(0));
        let mut session_ids = Vec::new();
        for index in 0..2 {
            let session_id = format!(
                "proxy-preclaim-panic-recovery-{}-{index}",
                FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            );
            let worker_exited = Arc::clone(&exited);
            let worker = ManagedThread::spawn("proxy-test-preclaim-relay", move || {
                worker_exited.fetch_add(1, Ordering::AcqRel);
            })
            .expect("completed relay should start");
            let mut state = ProxyCommandState::retained(
                &session_id,
                "test-helper",
                Arc::new(AtomicBool::new(false)),
                vec![worker],
            );
            if index == 0 {
                state.panic_cleanup_before_claim_once = true;
            }
            proxy_commands_lock().insert(session_id.clone(), state);
            session_ids.push(session_id);
        }

        let first = begin_proxy_command_cleanup(&session_ids[0]).unwrap();
        let second = begin_proxy_command_cleanup(&session_ids[1]).unwrap();
        assert!(wait_until(|| first.is_complete(), Duration::from_secs(2)));
        assert!(wait_until(|| second.is_complete(), Duration::from_secs(2)));
        assert_eq!(exited.load(Ordering::Acquire), 2);
        assert!(
            RELAY_REAP_PANIC_RECOVERIES.load(Ordering::Acquire) > recovered_before,
            "injected pre-claim panic was not recovered"
        );
        for session_id in session_ids {
            assert!(!proxy_commands_lock().contains_key(&session_id));
        }
    }

    #[test]
    fn after_claim_panic_retries_owned_task_and_worker_processes_next_ticket() {
        relay_reaper_queue().expect("cleanup reaper should initialize");
        let recovered_before = RELAY_REAP_PANIC_RECOVERIES.load(Ordering::Acquire);
        let exited = Arc::new(AtomicUsize::new(0));
        let mut session_ids = Vec::new();
        for index in 0..2 {
            let session_id = format!(
                "proxy-panic-recovery-{}-{index}",
                FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            );
            let worker_exited = Arc::clone(&exited);
            let worker = ManagedThread::spawn("proxy-test-completed-relay", move || {
                worker_exited.fetch_add(1, Ordering::AcqRel);
            })
            .expect("completed relay should start");
            let mut state = ProxyCommandState::retained(
                &session_id,
                "test-helper",
                Arc::new(AtomicBool::new(false)),
                vec![worker],
            );
            if index == 0 {
                state.panic_cleanup_after_claim_once = true;
            }
            proxy_commands_lock().insert(session_id.clone(), state);
            session_ids.push(session_id);
        }

        let first = begin_proxy_command_cleanup(&session_ids[0]).unwrap();
        let second = begin_proxy_command_cleanup(&session_ids[1]).unwrap();
        assert!(wait_until(|| first.is_complete(), Duration::from_secs(2)));
        assert!(wait_until(|| second.is_complete(), Duration::from_secs(2)));
        assert_eq!(exited.load(Ordering::Acquire), 2);
        assert!(
            RELAY_REAP_PANIC_RECOVERIES.load(Ordering::Acquire) > recovered_before,
            "injected after-claim panic was not recovered"
        );
        for session_id in session_ids {
            assert!(!proxy_commands_lock().contains_key(&session_id));
        }
    }

    #[test]
    fn lifecycle_cap_accepts_128_and_rejects_helper_129_before_spawn() {
        let mut lifecycles = HashMap::new();
        for index in 0..MAX_PROXY_COMMAND_LIFECYCLES {
            let session_id = format!("proxy-cap-reservation-{index}");
            validate_proxy_command_registration(&lifecycles, &session_id, lifecycles.len())
                .expect("each lifecycle through 128 should be accepted");
            lifecycles.insert(
                session_id.clone(),
                ProxyCommandState::retained(
                    &session_id,
                    "test-helper",
                    Arc::new(AtomicBool::new(false)),
                    Vec::new(),
                ),
            );
        }
        assert!(validate_proxy_command_registration(
            &lifecycles,
            "proxy-cap-local-129",
            lifecycles.len(),
        )
        .unwrap_err()
        .contains("lifecycle limit"));

        let config = fake_helper_config("idle", None);
        let expanded = build_command_string(&config, "host.example.com", 22, "user").unwrap();
        mark_proxy_command_confirmed(&expanded);
        let spawned_pid = Arc::new(AtomicU32::new(0));
        let error = spawn_proxy_command_inner(
            "proxy-cap-129",
            &config,
            "host.example.com",
            22,
            "user",
            2,
            &LifecycleHooks {
                failure: None,
                spawned_pid: Some(Arc::clone(&spawned_pid)),
                lifecycle_count_override: Some(MAX_PROXY_COMMAND_LIFECYCLES),
                publication_gate: None,
            },
            None,
        )
        .expect_err("the 129th ProxyCommand must fail before helper spawn");
        assert!(error.contains("lifecycle limit"));
        assert_eq!(spawned_pid.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn timed_out_relay_join_transfers_handle_and_shared_completion_to_reaper() {
        let session_id = format!(
            "proxy-blocked-relay-{}",
            FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let gate = Arc::new((StdMutex::new(false), Condvar::new()));
        let exited = Arc::new(AtomicUsize::new(0));
        let worker = gated_managed_thread(Arc::clone(&gate), Arc::clone(&exited));
        proxy_commands_lock().insert(
            session_id.clone(),
            ProxyCommandState::retained(
                &session_id,
                "test-helper",
                Arc::new(AtomicBool::new(false)),
                vec![worker],
            ),
        );

        let started = Instant::now();
        let completion =
            begin_proxy_command_cleanup(&session_id).expect("blocked relay cleanup should start");
        assert!(started.elapsed() < Duration::from_millis(500));
        assert!(!completion.is_complete());
        assert_eq!(exited.load(Ordering::Acquire), 0);
        assert!(get_proxy_command_status(&session_id).unwrap().is_none());
        assert!(proxy_commands_lock().contains_key(&session_id));

        let same_completion = begin_proxy_command_cleanup(&session_id)
            .expect("concurrent cleanup should reuse its completion");
        assert!(completion.same_as(&same_completion));

        open_gate(&gate);
        assert!(wait_until(
            || completion.is_complete(),
            Duration::from_secs(2)
        ));
        assert_eq!(exited.load(Ordering::Acquire), 1);
        assert!(!proxy_commands_lock().contains_key(&session_id));
    }

    #[test]
    fn relay_reaper_pool_is_fixed_and_queued_jobs_eventually_join() {
        let reaper = relay_reaper_queue().expect("cleanup reaper should initialize");
        assert_eq!(reaper._workers.len(), MAX_PROXY_COMMAND_REAPERS);
        let gate = Arc::new((StdMutex::new(false), Condvar::new()));
        let exited = Arc::new(AtomicUsize::new(0));
        let job_count = MAX_PROXY_COMMAND_REAPERS * 2;
        let mut session_ids = Vec::with_capacity(job_count);
        let mut completions = Vec::with_capacity(job_count);

        for index in 0..job_count {
            let session_id = format!(
                "proxy-reaper-bound-{}-{index}",
                FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            );
            let worker = gated_managed_thread(Arc::clone(&gate), Arc::clone(&exited));
            proxy_commands_lock().insert(
                session_id.clone(),
                ProxyCommandState::retained(
                    &session_id,
                    "test-helper",
                    Arc::new(AtomicBool::new(false)),
                    vec![worker],
                ),
            );
            completions.push(
                begin_proxy_command_cleanup(&session_id)
                    .expect("queued relay cleanup should start"),
            );
            session_ids.push(session_id);
        }

        assert!(
            PEAK_RELAY_REAPERS.load(Ordering::Acquire) <= MAX_PROXY_COMMAND_REAPERS,
            "detached cleanup spawned beyond the fixed reaper pool"
        );
        open_gate(&gate);
        for completion in &completions {
            assert!(wait_until(
                || completion.is_complete(),
                Duration::from_secs(5)
            ));
        }
        assert_eq!(exited.load(Ordering::Acquire), job_count);
        for session_id in session_ids {
            assert!(!proxy_commands_lock().contains_key(&session_id));
        }
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
            LifecycleStage::Reaper,
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

    #[cfg(windows)]
    #[test]
    fn suspended_helper_cannot_execute_before_process_tree_attachment() {
        let session_id = "proxy-suspended-before-attach";
        let marker = std::env::temp_dir().join(format!(
            "sorng-proxy-suspended-{}-{}",
            std::process::id(),
            FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _marker_cleanup = TestFileCleanup(marker.clone());
        let _ = std::fs::remove_file(&marker);
        let spawned_pid = Arc::new(AtomicU32::new(0));

        run_fake_helper(
            session_id,
            "tree",
            Some(&marker),
            Some(LifecycleStage::BeforeAttach),
            spawned_pid.clone(),
        )
        .expect_err("a failure before job attachment must fail closed");

        let pid = spawned_pid.load(Ordering::SeqCst);
        assert_ne!(pid, 0, "the suspended shell must have been created");
        assert!(wait_until(
            || !process_is_alive(pid),
            Duration::from_secs(2)
        ));
        assert!(
            !marker.exists(),
            "the suspended ProxyCommand ran before process-tree attachment"
        );
        assert!(get_proxy_command_status(session_id).unwrap().is_none());
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
        let stop_started = Instant::now();
        stop_proxy_command(session_id).expect("stderr-flood helper must stop");
        assert!(
            stop_started.elapsed() < Duration::from_secs(5),
            "bounded stderr shutdown exceeded the lifecycle deadline"
        );
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

    #[cfg(windows)]
    #[test]
    fn windows_shell_preserves_quoted_executable_arguments_and_metacharacters() {
        let token = FAKE_HELPER_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let script = std::env::temp_dir().join(format!(
            "sorng proxy quoted helper {} {token}.cmd",
            std::process::id()
        ));
        let marker = std::env::temp_dir().join(format!(
            "sorng proxy quoted output {} {token}.txt",
            std::process::id()
        ));
        let _script_cleanup = TestFileCleanup(script.clone());
        let _marker_cleanup = TestFileCleanup(marker.clone());
        let _ = std::fs::remove_file(&script);
        let _ = std::fs::remove_file(&marker);
        std::fs::write(
            &script,
            "@echo off\r\n<nul set /p \"=%~2\" > \"%~1\"\r\nexit /b 0\r\n",
        )
        .expect("write quoted ProxyCommand helper");

        let literal_argument = "alpha & beta | gamma";
        let command = format!(
            "call \"{}\" \"{}\" \"{}\" && >> \"{}\" echo :shell-chain-ok",
            script.display(),
            marker.display(),
            literal_argument,
            marker.display()
        );
        let output = spawn_shell_command(&command)
            .expect("spawn quoted ProxyCommand helper")
            .wait_with_output()
            .expect("wait for quoted ProxyCommand helper");

        assert!(
            output.status.success(),
            "quoted ProxyCommand failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let recorded = std::fs::read_to_string(&marker).expect("read quoted helper marker");
        assert_eq!(
            recorded.replace("\r\n", "\n").trim_end(),
            format!("{literal_argument}:shell-chain-ok")
        );
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
        cfg.proxy_password = Some(SecretString::from(secret.to_string()));

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
            cfg.proxy_password = Some(SecretString::from(secret.to_string()));

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
