//! Linux Secret Service back-end.
//!
//! Uses the `secret-tool` CLI (part of `libsecret`) to interact with
//! the Secret Service D-Bus API (GNOME Keyring / KDE Wallet). The process
//! boundary is deliberately narrow: only a trusted system executable is
//! accepted, secrets are written through stdin, and child I/O is bounded.

use crate::types::*;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use zeroize::{Zeroize, Zeroizing};

const SECRET_TOOL_CANDIDATES: [&str; 3] = [
    "/usr/bin/secret-tool",
    "/bin/secret-tool",
    "/usr/local/bin/secret-tool",
];
const SAFE_ENVIRONMENT: [&str; 9] = [
    "DBUS_SESSION_BUS_ADDRESS",
    "DISPLAY",
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE",
];
const PROCESS_TIMEOUT: Duration = Duration::from_secs(15);
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const CLEANUP_CAPACITY: usize = 32;
const CLEANUP_SLOTS_PER_RUN: usize = 4;
const MAX_IDENTIFIER_BYTES: usize = 4 * 1024;
const MAX_SECRET_BYTES: usize = 1024 * 1024;
const MAX_STDERR_BYTES: usize = 16 * 1024;

type WipeProbe = Arc<AtomicBool>;

#[derive(Clone, Debug)]
struct ExecutableFacts {
    canonical_path: PathBuf,
    is_regular_file: bool,
    owner_uid: u32,
    mode: u32,
    trusted_parent_chain: bool,
}

trait ExecutableInspector {
    fn inspect(&self, candidate: &Path) -> io::Result<ExecutableFacts>;
}

struct FileSystemInspector;

impl ExecutableInspector for FileSystemInspector {
    fn inspect(&self, candidate: &Path) -> io::Result<ExecutableFacts> {
        let canonical_path = fs::canonicalize(candidate)?;
        let metadata = fs::metadata(&canonical_path)?;
        let trusted_parent_chain = trusted_parent_chain(&canonical_path)?;

        Ok(ExecutableFacts {
            canonical_path,
            is_regular_file: metadata.is_file(),
            owner_uid: metadata.uid(),
            mode: metadata.mode(),
            trusted_parent_chain,
        })
    }
}

fn trusted_parent_chain(executable: &Path) -> io::Result<bool> {
    let Some(parent) = executable.parent() else {
        return Ok(false);
    };

    for directory in parent.ancestors() {
        let metadata = fs::metadata(directory)?;
        if !metadata.is_dir() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
            return Ok(false);
        }
    }

    Ok(true)
}

#[derive(Clone, Copy, Debug)]
struct ResolveError;

trait SecretToolResolver {
    fn resolve(&self) -> Result<PathBuf, ResolveError>;
}

struct SystemResolver;

impl SecretToolResolver for SystemResolver {
    fn resolve(&self) -> Result<PathBuf, ResolveError> {
        resolve_from_candidates(&FileSystemInspector, &SECRET_TOOL_CANDIDATES)
    }
}

fn resolve_from_candidates<I: ExecutableInspector>(
    inspector: &I,
    candidates: &[&str],
) -> Result<PathBuf, ResolveError> {
    for candidate in candidates {
        let candidate = Path::new(candidate);
        if !candidate.is_absolute() {
            continue;
        }

        let Ok(facts) = inspector.inspect(candidate) else {
            continue;
        };
        let canonical_is_allowlisted = candidates
            .iter()
            .any(|allowed| Path::new(allowed) == facts.canonical_path);
        let executable_is_trusted = facts.canonical_path.is_absolute()
            && canonical_is_allowlisted
            && facts.is_regular_file
            && facts.owner_uid == 0
            && facts.mode & 0o022 == 0
            && facts.mode & 0o111 != 0
            && facts.trusted_parent_chain;

        if executable_is_trusted {
            return Ok(facts.canonical_path);
        }
    }

    Err(ResolveError)
}

struct ToolRequest {
    args: Vec<OsString>,
    stdin: Option<Zeroizing<Vec<u8>>>,
}

struct ToolOutput {
    success: bool,
    stdout: Zeroizing<Vec<u8>>,
    stdout_truncated: bool,
    wipe_probe: Option<WipeProbe>,
}

impl Drop for ToolOutput {
    fn drop(&mut self) {
        self.stdout.zeroize();
        mark_wiped(&self.wipe_probe, self.stdout.as_slice());
    }
}

#[derive(Clone, Copy, Debug)]
enum ToolRunError {
    CleanupCapacity,
    Io,
    Spawn,
    TimedOut,
    Worker,
}

static CLEANUP_SERVICE: OnceLock<Result<CleanupService, ()>> = OnceLock::new();

struct CleanupState {
    outstanding: AtomicUsize,
    orphaned: Mutex<Vec<CleanupJob>>,
}

struct CleanupService {
    sender: mpsc::SyncSender<CleanupJob>,
    state: Arc<CleanupState>,
}

struct CleanupJob {
    task: Box<dyn DeferredCleanup>,
    state: Arc<CleanupState>,
}

impl CleanupJob {
    fn try_finish(mut self) -> Option<Self> {
        if self.task.try_finish() {
            self.state.outstanding.fetch_sub(1, Ordering::AcqRel);
            None
        } else {
            Some(self)
        }
    }
}

trait DeferredCleanup: Send + 'static {
    /// Complete one non-blocking cleanup poll. Returns true only when the
    /// retained operating-system/thread handle has been joined or reaped.
    fn try_finish(&mut self) -> bool;
}

struct ThreadCleanup {
    handle: Option<JoinHandle<()>>,
}

impl DeferredCleanup for ThreadCleanup {
    fn try_finish(&mut self) -> bool {
        let Some(handle) = self.handle.as_ref() else {
            return true;
        };
        if !handle.is_finished() {
            return false;
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        true
    }
}

struct ProcessCleanup {
    child: Option<Child>,
}

impl DeferredCleanup for ProcessCleanup {
    fn try_finish(&mut self) -> bool {
        let Some(child) = self.child.as_mut() else {
            return true;
        };
        if !matches!(child.try_wait(), Ok(Some(_))) {
            return false;
        }
        self.child.take();
        true
    }
}

struct CleanupPermit {
    service: &'static CleanupService,
    active: bool,
}

impl CleanupPermit {
    fn submit(mut self, task: impl DeferredCleanup) {
        let job = CleanupJob {
            task: Box::new(task),
            state: self.service.state.clone(),
        };
        match self.service.sender.try_send(job) {
            Ok(()) => self.active = false,
            Err(error) => {
                let job = super::recover_try_send_value(error);
                let mut orphaned = self
                    .service
                    .state
                    .orphaned
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                orphaned.push(job);
                self.active = false;
            }
        }
    }
}

impl Drop for CleanupPermit {
    fn drop(&mut self) {
        if self.active {
            self.service
                .state
                .outstanding
                .fetch_sub(1, Ordering::AcqRel);
        }
    }
}

fn cleanup_service() -> Result<&'static CleanupService, ToolRunError> {
    CLEANUP_SERVICE
        .get_or_init(|| {
            let state = Arc::new(CleanupState {
                outstanding: AtomicUsize::new(0),
                orphaned: Mutex::new(Vec::new()),
            });
            let (sender, receiver) = mpsc::sync_channel::<CleanupJob>(CLEANUP_CAPACITY);
            thread::Builder::new()
                .name("vault-secret-tool-cleanup".into())
                .spawn(move || {
                    let mut pending = std::collections::VecDeque::new();
                    loop {
                        while let Ok(job) = receiver.try_recv() {
                            pending.push_back(job);
                        }
                        if let Some(job) = pending.pop_front() {
                            if let Some(job) = job.try_finish() {
                                pending.push_back(job);
                                thread::sleep(POLL_INTERVAL);
                            }
                            continue;
                        }
                        match receiver.recv() {
                            Ok(job) => pending.push_back(job),
                            Err(_) => break,
                        }
                    }
                })
                .map_err(|_| ())?;
            Ok(CleanupService { sender, state })
        })
        .as_ref()
        .map_err(|_| ToolRunError::CleanupCapacity)
}

fn reserve_cleanup_count(counter: &AtomicUsize, count: usize, capacity: usize) -> bool {
    let mut current = counter.load(Ordering::Acquire);
    loop {
        if count > capacity.saturating_sub(current) {
            return false;
        }
        match counter.compare_exchange_weak(
            current,
            current + count,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => return true,
            Err(observed) => current = observed,
        }
    }
}

fn acquire_cleanup_slots(count: usize) -> Result<Vec<CleanupPermit>, ToolRunError> {
    let service = cleanup_service()?;
    if !reserve_cleanup_count(&service.state.outstanding, count, CLEANUP_CAPACITY) {
        return Err(ToolRunError::CleanupCapacity);
    }
    Ok((0..count)
        .map(|_| CleanupPermit {
            service,
            active: true,
        })
        .collect())
}

trait SecretToolRunner {
    fn run(&self, executable: &Path, request: ToolRequest) -> Result<ToolOutput, ToolRunError>;
}

struct ProcessRunner;

impl SecretToolRunner for ProcessRunner {
    fn run(&self, executable: &Path, request: ToolRequest) -> Result<ToolOutput, ToolRunError> {
        let mut cleanup_slots = acquire_cleanup_slots(CLEANUP_SLOTS_PER_RUN)?;
        let mut command = Command::new(executable);
        command
            .args(&request.args)
            .current_dir("/")
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .process_group(0)
            .stdin(if request.stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for key in SAFE_ENVIRONMENT {
            if let Some(value) = env::var_os(key) {
                command.env(key, value);
            }
        }

        let child = command.spawn().map_err(|_| ToolRunError::Spawn)?;
        let mut child = ChildGuard::new(
            child,
            cleanup_slots.pop().expect("reserved child cleanup slot"),
        );
        let deadline = Instant::now() + PROCESS_TIMEOUT;

        let stdout = child.child_mut().stdout.take().ok_or(ToolRunError::Io)?;
        let stderr = child.child_mut().stderr.take().ok_or(ToolRunError::Io)?;
        let stdin = child.child_mut().stdin.take();

        let stdout_worker = spawn_reader(
            stdout,
            MAX_SECRET_BYTES,
            cleanup_slots.pop().expect("reserved stdout cleanup slot"),
        )?;
        let stderr_worker = spawn_reader(
            stderr,
            MAX_STDERR_BYTES,
            cleanup_slots.pop().expect("reserved stderr cleanup slot"),
        )?;
        let stdin_worker = match (stdin, request.stdin) {
            (Some(stdin), Some(secret)) => Some(spawn_writer(
                stdin,
                secret,
                cleanup_slots.pop().expect("reserved stdin cleanup slot"),
            )?),
            (None, None) => None,
            _ => return Err(ToolRunError::Io),
        };

        let status = wait_for_exit(&mut child, deadline);
        let worker_deadline = if status.is_ok() {
            deadline
        } else {
            let cleanup_deadline = Instant::now() + CLEANUP_TIMEOUT;
            terminate_and_reap(&mut child, cleanup_deadline);
            cleanup_deadline
        };
        let stdin_result = wait_for_optional_worker(stdin_worker, worker_deadline);
        let stdout_result = stdout_worker.wait(worker_deadline);
        let stderr_result = stderr_worker.wait(worker_deadline);

        let status = status?;
        if let Some(error) = first_worker_error(&stdin_result, &stdout_result, &stderr_result) {
            terminate_and_reap(&mut child, Instant::now() + CLEANUP_TIMEOUT);
            return Err(error);
        }

        // The parent has exited and all pipes reached EOF. Kill the isolated
        // process group before disarming so an unexpected descendant cannot
        // remain resident after the vault operation returns.
        terminate_and_reap(&mut child, Instant::now() + CLEANUP_TIMEOUT);

        let mut stdout = stdout_result.expect("worker result checked");
        let _stderr = stderr_result.expect("worker result checked");
        Ok(ToolOutput {
            success: status.success(),
            stdout: std::mem::replace(&mut stdout.bytes, Zeroizing::new(Vec::new())),
            stdout_truncated: stdout.truncated,
            wipe_probe: None,
        })
    }
}

fn first_worker_error<A, B, C>(
    first: &Result<A, ToolRunError>,
    second: &Result<B, ToolRunError>,
    third: &Result<C, ToolRunError>,
) -> Option<ToolRunError> {
    first
        .as_ref()
        .err()
        .or_else(|| second.as_ref().err())
        .or_else(|| third.as_ref().err())
        .copied()
}

struct ChildGuard {
    child: Option<Child>,
    process_group: Option<i32>,
    armed: bool,
    cleanup_slot: Option<CleanupPermit>,
}

impl ChildGuard {
    fn new(child: Child, cleanup_slot: CleanupPermit) -> Self {
        Self {
            process_group: i32::try_from(child.id()).ok(),
            child: Some(child),
            armed: true,
            cleanup_slot: Some(cleanup_slot),
        }
    }

    fn child_mut(&mut self) -> &mut Child {
        self.child.as_mut().expect("child guard is armed")
    }
}

trait ReapControl {
    fn kill_tree(&mut self);
    fn try_reap(&mut self) -> bool;
    fn hand_off_reap(&mut self);
}

impl ReapControl for ChildGuard {
    fn kill_tree(&mut self) {
        if !self.armed {
            return;
        }

        if let Some(process_group) = self.process_group {
            // SAFETY: the child was spawned into a new process group whose ID
            // is its positive PID. Negating it targets only that child group.
            unsafe {
                libc::kill(-process_group, libc::SIGKILL);
            }
        }
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
        }
    }

    fn try_reap(&mut self) -> bool {
        if !self.armed {
            return true;
        }

        let reaped = match self.child.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(Some(_))),
            None => true,
        };
        if reaped {
            self.child.take();
            self.armed = false;
            self.cleanup_slot.take();
        }
        reaped
    }

    fn hand_off_reap(&mut self) {
        if let Some(child) = self.child.take() {
            if let Some(cleanup_slot) = self.cleanup_slot.take() {
                cleanup_slot.submit(ProcessCleanup { child: Some(child) });
            }
        }
        self.armed = false;
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.armed {
            terminate_and_reap(self, Instant::now() + CLEANUP_TIMEOUT);
        }
    }
}

fn terminate_and_reap<C: ReapControl>(control: &mut C, deadline: Instant) {
    control.kill_tree();
    if control.try_reap() {
        return;
    }

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        thread::sleep(POLL_INTERVAL.min(remaining));
        if control.try_reap() {
            return;
        }
    }
    control.hand_off_reap();
}

struct BoundedBuffer {
    bytes: Zeroizing<Vec<u8>>,
    truncated: bool,
    wipe_probe: Option<WipeProbe>,
}

impl Drop for BoundedBuffer {
    fn drop(&mut self) {
        self.bytes.zeroize();
        mark_wiped(&self.wipe_probe, self.bytes.as_slice());
    }
}

struct SensitiveScratch {
    bytes: [u8; 8 * 1024],
    wipe_probe: Option<WipeProbe>,
}

impl SensitiveScratch {
    fn new(wipe_probe: Option<WipeProbe>) -> Self {
        Self {
            bytes: [0_u8; 8 * 1024],
            wipe_probe,
        }
    }
}

impl Drop for SensitiveScratch {
    fn drop(&mut self) {
        self.bytes.zeroize();
        mark_wiped(&self.wipe_probe, &self.bytes);
    }
}

fn mark_wiped(probe: &Option<WipeProbe>, bytes: &[u8]) {
    if let Some(probe) = probe {
        probe.store(bytes.iter().all(|byte| *byte == 0), Ordering::SeqCst);
    }
}

struct Worker<T> {
    receiver: mpsc::Receiver<io::Result<T>>,
    thread: Option<WorkerThread>,
}

struct WorkerThread {
    handle: Option<JoinHandle<()>>,
    cleanup_slot: Option<CleanupPermit>,
}

impl WorkerThread {
    fn is_finished(&self) -> bool {
        self.handle
            .as_ref()
            .map(JoinHandle::is_finished)
            .unwrap_or(true)
    }

    fn finish(mut self) -> Result<(), ToolRunError> {
        let result = self
            .handle
            .take()
            .map(|handle| handle.join().map_err(|_| ToolRunError::Worker))
            .unwrap_or(Ok(()));
        self.cleanup_slot.take();
        result
    }
}

impl Drop for WorkerThread {
    fn drop(&mut self) {
        let Some(handle) = self.handle.take() else {
            return;
        };
        if handle.is_finished() {
            let _ = handle.join();
            self.cleanup_slot.take();
        } else if let Some(cleanup_slot) = self.cleanup_slot.take() {
            cleanup_slot.submit(ThreadCleanup {
                handle: Some(handle),
            });
        }
    }
}

impl<T> Worker<T> {
    fn wait(mut self, deadline: Instant) -> Result<T, ToolRunError> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let result = match self.receiver.recv_timeout(remaining) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => return Err(ToolRunError::TimedOut),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(ToolRunError::Worker),
        };

        if let Some(thread) = self.thread.as_ref() {
            while !thread.is_finished() {
                let now = Instant::now();
                if now >= deadline {
                    return Err(ToolRunError::TimedOut);
                }
                thread::sleep(POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
            }
        }
        if let Some(thread) = self.thread.take() {
            thread.finish()?;
        }

        result.map_err(|_| ToolRunError::Io)
    }
}

fn spawn_worker<T, F>(
    name: &str,
    operation: F,
    cleanup_slot: CleanupPermit,
) -> Result<Worker<T>, ToolRunError>
where
    T: Send + 'static,
    F: FnOnce() -> io::Result<T> + Send + 'static,
{
    let (sender, receiver) = mpsc::sync_channel(1);
    let handle = thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let _ = sender.send(operation());
        })
        .map_err(|_| ToolRunError::Worker)?;
    Ok(Worker {
        receiver,
        thread: Some(WorkerThread {
            handle: Some(handle),
            cleanup_slot: Some(cleanup_slot),
        }),
    })
}

fn spawn_reader<R>(
    reader: R,
    limit: usize,
    cleanup_slot: CleanupPermit,
) -> Result<Worker<BoundedBuffer>, ToolRunError>
where
    R: Read + Send + 'static,
{
    spawn_worker(
        "vault-secret-tool-reader",
        move || read_bounded(reader, limit),
        cleanup_slot,
    )
}

fn spawn_writer<W>(
    writer: W,
    secret: Zeroizing<Vec<u8>>,
    cleanup_slot: CleanupPermit,
) -> Result<Worker<()>, ToolRunError>
where
    W: Write + Send + 'static,
{
    spawn_worker(
        "vault-secret-tool-writer",
        move || {
            let mut writer = writer;
            writer.write_all(&secret)?;
            writer.flush()
        },
        cleanup_slot,
    )
}

fn wait_for_optional_worker(
    worker: Option<Worker<()>>,
    deadline: Instant,
) -> Result<(), ToolRunError> {
    match worker {
        Some(worker) => worker.wait(deadline),
        None => Ok(()),
    }
}

fn read_bounded<R: Read>(reader: R, limit: usize) -> io::Result<BoundedBuffer> {
    read_bounded_with_probes(reader, limit, None, None)
}

fn read_bounded_with_probes<R: Read>(
    mut reader: R,
    limit: usize,
    scratch_probe: Option<WipeProbe>,
    output_probe: Option<WipeProbe>,
) -> io::Result<BoundedBuffer> {
    let mut output = BoundedBuffer {
        bytes: Zeroizing::new(Vec::with_capacity(limit.min(8 * 1024))),
        truncated: false,
        wipe_probe: output_probe,
    };
    let mut chunk = SensitiveScratch::new(scratch_probe);

    loop {
        let count = reader.read(&mut chunk.bytes)?;
        if count == 0 {
            break;
        }

        let remaining = limit.saturating_sub(output.bytes.len());
        let retained = remaining.min(count);
        output.bytes.extend_from_slice(&chunk.bytes[..retained]);
        output.truncated |= retained != count;
    }

    Ok(output)
}

fn wait_for_exit(child: &mut ChildGuard, deadline: Instant) -> Result<ExitStatus, ToolRunError> {
    loop {
        match child.child_mut().try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {}
            Err(_) => return Err(ToolRunError::Io),
        }

        let now = Instant::now();
        if now >= deadline {
            return Err(ToolRunError::TimedOut);
        }
        thread::sleep(POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
    }
}

fn validate_identifier(value: &str) -> VaultResult<()> {
    if value.len() > MAX_IDENTIFIER_BYTES || value.as_bytes().contains(&0) {
        return Err(operation_error());
    }
    Ok(())
}

fn resolve<R: SecretToolResolver>(resolver: &R) -> VaultResult<PathBuf> {
    resolver.resolve().map_err(|_| unavailable_error())
}

fn run<R: SecretToolRunner>(
    runner: &R,
    executable: &Path,
    args: Vec<OsString>,
    stdin: Option<Zeroizing<Vec<u8>>>,
) -> VaultResult<ToolOutput> {
    runner
        .run(executable, ToolRequest { args, stdin })
        .map_err(|_| operation_error())
}

fn store_secret_with<Resolver, Runner>(
    service: &str,
    account: &str,
    secret: &[u8],
    resolver: &Resolver,
    runner: &Runner,
) -> VaultResult<()>
where
    Resolver: SecretToolResolver,
    Runner: SecretToolRunner,
{
    validate_identifier(service)?;
    validate_identifier(account)?;
    if secret.len() > MAX_SECRET_BYTES {
        return Err(operation_error());
    }

    let executable = resolve(resolver)?;
    let label = format!("--label=sortOfRemoteNG: {account}");
    let request = vec![
        OsString::from("store"),
        OsString::from(label),
        OsString::from("--"),
        OsString::from("service"),
        OsString::from(service),
        OsString::from("account"),
        OsString::from(account),
    ];
    let output = run(
        runner,
        &executable,
        request,
        Some(Zeroizing::new(secret.to_vec())),
    )?;

    if output.success {
        Ok(())
    } else {
        Err(operation_error())
    }
}

fn read_secret_with<Resolver, Runner>(
    service: &str,
    account: &str,
    resolver: &Resolver,
    runner: &Runner,
) -> VaultResult<Zeroizing<Vec<u8>>>
where
    Resolver: SecretToolResolver,
    Runner: SecretToolRunner,
{
    validate_identifier(service)?;
    validate_identifier(account)?;

    let executable = resolve(resolver)?;
    let request = vec![
        OsString::from("lookup"),
        OsString::from("--"),
        OsString::from("service"),
        OsString::from(service),
        OsString::from("account"),
        OsString::from(account),
    ];
    let mut output = run(runner, &executable, request, None)?;

    if output.success && !output.stdout.is_empty() && !output.stdout_truncated {
        Ok(std::mem::replace(
            &mut output.stdout,
            Zeroizing::new(Vec::new()),
        ))
    } else if !output.success || output.stdout.is_empty() {
        Err(not_found_error())
    } else {
        Err(operation_error())
    }
}

fn delete_secret_with<Resolver, Runner>(
    service: &str,
    account: &str,
    resolver: &Resolver,
    runner: &Runner,
) -> VaultResult<()>
where
    Resolver: SecretToolResolver,
    Runner: SecretToolRunner,
{
    validate_identifier(service)?;
    validate_identifier(account)?;

    let executable = resolve(resolver)?;
    let request = vec![
        OsString::from("clear"),
        OsString::from("--"),
        OsString::from("service"),
        OsString::from(service),
        OsString::from("account"),
        OsString::from(account),
    ];
    let output = run(runner, &executable, request, None)?;

    if output.success {
        Ok(())
    } else {
        Err(not_found_error())
    }
}

fn unavailable_error() -> VaultError {
    VaultError::backend_unavailable("Linux vault backend is unavailable")
}

fn operation_error() -> VaultError {
    VaultError::platform("Linux vault operation failed")
}

fn not_found_error() -> VaultError {
    VaultError::not_found("Linux vault entry was not found")
}

/// Store a secret via `secret-tool store`.
pub(crate) fn store_secret(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {
    store_secret_with(service, account, secret, &SystemResolver, &ProcessRunner)
}

/// Read a secret via `secret-tool lookup`.
pub(crate) fn read_secret(service: &str, account: &str) -> VaultResult<Zeroizing<Vec<u8>>> {
    read_secret_with(service, account, &SystemResolver, &ProcessRunner)
}

/// Delete a secret via `secret-tool clear`.
pub(crate) fn delete_secret(service: &str, account: &str) -> VaultResult<()> {
    delete_secret_with(service, account, &SystemResolver, &ProcessRunner)
}

/// Check whether a trusted `secret-tool` is available on this system.
pub(crate) fn is_available() -> bool {
    SystemResolver.resolve().is_ok()
}

pub(crate) fn backend_name() -> &'static str {
    "Linux Secret Service (secret-tool)"
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::{HashMap, VecDeque};

    struct FakeInspector {
        facts: HashMap<PathBuf, ExecutableFacts>,
    }

    impl ExecutableInspector for FakeInspector {
        fn inspect(&self, candidate: &Path) -> io::Result<ExecutableFacts> {
            self.facts
                .get(candidate)
                .cloned()
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "fake executable not found"))
        }
    }

    struct FixedResolver(Option<PathBuf>);

    impl SecretToolResolver for FixedResolver {
        fn resolve(&self) -> Result<PathBuf, ResolveError> {
            self.0.clone().ok_or(ResolveError)
        }
    }

    #[derive(Debug)]
    struct CapturedCall {
        executable: PathBuf,
        args: Vec<String>,
        stdin: Option<Vec<u8>>,
    }

    struct FakeRunner {
        calls: RefCell<Vec<CapturedCall>>,
        outputs: RefCell<VecDeque<Result<ToolOutput, ToolRunError>>>,
    }

    impl FakeRunner {
        fn new(outputs: Vec<Result<ToolOutput, ToolRunError>>) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                outputs: RefCell::new(outputs.into()),
            }
        }
    }

    impl SecretToolRunner for FakeRunner {
        fn run(&self, executable: &Path, request: ToolRequest) -> Result<ToolOutput, ToolRunError> {
            self.calls.borrow_mut().push(CapturedCall {
                executable: executable.to_path_buf(),
                args: request
                    .args
                    .iter()
                    .map(|arg| arg.to_string_lossy().into_owned())
                    .collect(),
                stdin: request.stdin.as_ref().map(|secret| secret.to_vec()),
            });
            self.outputs
                .borrow_mut()
                .pop_front()
                .expect("fake runner output")
        }
    }

    fn tool_output(success: bool, stdout: &[u8]) -> ToolOutput {
        ToolOutput {
            success,
            stdout: Zeroizing::new(stdout.to_vec()),
            stdout_truncated: false,
            wipe_probe: None,
        }
    }

    fn executable_facts(path: &str) -> ExecutableFacts {
        ExecutableFacts {
            canonical_path: PathBuf::from(path),
            is_regular_file: true,
            owner_uid: 0,
            mode: 0o755,
            trusted_parent_chain: true,
        }
    }

    #[test]
    fn resolver_accepts_only_allowlisted_root_owned_non_writable_executables() {
        let candidates = ["/usr/bin/secret-tool"];
        let candidate = PathBuf::from(candidates[0]);
        let trusted = executable_facts(candidates[0]);
        let inspector = FakeInspector {
            facts: HashMap::from([(candidate.clone(), trusted.clone())]),
        };
        assert_eq!(
            resolve_from_candidates(&inspector, &candidates).unwrap(),
            candidate
        );

        let mut rejected = Vec::new();
        let mut facts = trusted.clone();
        facts.owner_uid = 1000;
        rejected.push(facts);
        let mut facts = trusted.clone();
        facts.mode = 0o775;
        rejected.push(facts);
        let mut facts = trusted.clone();
        facts.mode = 0o644;
        rejected.push(facts);
        let mut facts = trusted.clone();
        facts.is_regular_file = false;
        rejected.push(facts);
        let mut facts = trusted.clone();
        facts.trusted_parent_chain = false;
        rejected.push(facts);
        let mut facts = trusted;
        facts.canonical_path = PathBuf::from("/tmp/secret-tool");
        rejected.push(facts);

        for facts in rejected {
            let inspector = FakeInspector {
                facts: HashMap::from([(candidate.clone(), facts)]),
            };
            assert!(resolve_from_candidates(&inspector, &candidates).is_err());
        }
    }

    #[test]
    fn fake_runner_exercises_crud_without_a_real_keyring() {
        let executable = PathBuf::from("/usr/bin/secret-tool");
        let resolver = FixedResolver(Some(executable.clone()));
        let runner = FakeRunner::new(vec![
            Ok(tool_output(true, b"")),
            Ok(tool_output(true, b"returned-secret")),
            Ok(tool_output(true, b"")),
        ]);

        store_secret_with(
            "private-service",
            "private-account",
            b"input-secret",
            &resolver,
            &runner,
        )
        .unwrap();
        let returned =
            read_secret_with("private-service", "private-account", &resolver, &runner).unwrap();
        assert_eq!(returned.as_slice(), b"returned-secret");
        delete_secret_with("private-service", "private-account", &resolver, &runner).unwrap();

        let calls = runner.calls.borrow();
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0].executable, executable);
        assert_eq!(calls[0].stdin.as_deref(), Some(b"input-secret".as_slice()));
        assert!(calls[1].stdin.is_none());
        assert!(calls[2].stdin.is_none());
        assert!(calls.iter().all(|call| {
            call.args
                .iter()
                .all(|argument| !argument.contains("input-secret"))
        }));
        assert_eq!(calls[0].args[2], "--");
        assert_eq!(calls[1].args[1], "--");
        assert_eq!(calls[2].args[1], "--");
    }

    #[test]
    fn process_failures_are_opaque_and_redacted() {
        let resolver = FixedResolver(Some(PathBuf::from("/usr/bin/secret-tool")));
        let runner = FakeRunner::new(vec![Err(ToolRunError::TimedOut)]);
        let error = store_secret_with(
            "sensitive-service",
            "sensitive-account",
            b"sensitive-secret",
            &resolver,
            &runner,
        )
        .unwrap_err();
        let rendered = error.to_string();

        assert_eq!(error.message, "Linux vault operation failed");
        assert!(!rendered.contains("sensitive-service"));
        assert!(!rendered.contains("sensitive-account"));
        assert!(!rendered.contains("sensitive-secret"));
        assert!(!rendered.contains("/usr/bin/secret-tool"));
    }

    #[test]
    fn truncated_lookup_output_fails_closed() {
        let resolver = FixedResolver(Some(PathBuf::from("/usr/bin/secret-tool")));
        let mut output = tool_output(true, b"partial-secret");
        output.stdout_truncated = true;
        let runner = FakeRunner::new(vec![Ok(output)]);

        let error = read_secret_with("service", "account", &resolver, &runner).unwrap_err();
        assert_eq!(error.message, "Linux vault operation failed");
    }

    struct ErroringReader;

    impl Read for ErroringReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            buffer[..6].copy_from_slice(b"secret");
            Err(io::Error::new(io::ErrorKind::Other, "injected read error"))
        }
    }

    #[test]
    fn io_error_zeroizes_scratch_and_partial_output() {
        let scratch_wiped = Arc::new(AtomicBool::new(false));
        let output_wiped = Arc::new(AtomicBool::new(false));
        let result = read_bounded_with_probes(
            ErroringReader,
            MAX_SECRET_BYTES,
            Some(scratch_wiped.clone()),
            Some(output_wiped.clone()),
        );

        assert!(result.is_err());
        assert!(scratch_wiped.load(Ordering::SeqCst));
        assert!(output_wiped.load(Ordering::SeqCst));
    }

    #[test]
    fn successful_command_output_is_zeroized_after_consumption() {
        let wiped = Arc::new(AtomicBool::new(false));
        let resolver = FixedResolver(Some(PathBuf::from("/usr/bin/secret-tool")));
        let runner = FakeRunner::new(vec![Ok(ToolOutput {
            success: true,
            stdout: Zeroizing::new(b"unexpected-sensitive-output".to_vec()),
            stdout_truncated: false,
            wipe_probe: Some(wiped.clone()),
        })]);

        store_secret_with("service", "account", b"secret", &resolver, &runner).unwrap();
        assert!(wiped.load(Ordering::SeqCst));
    }

    #[test]
    fn retained_descendant_pipe_cannot_extend_worker_deadline() {
        let (_retained_sender, receiver) = mpsc::sync_channel::<io::Result<()>>(1);
        let worker = Worker {
            receiver,
            thread: None,
        };

        assert!(matches!(
            worker.wait(Instant::now()),
            Err(ToolRunError::TimedOut)
        ));
    }

    #[derive(Default)]
    struct FakeReapControl {
        killed: bool,
        reap_attempts: usize,
        handed_off: bool,
    }

    impl ReapControl for FakeReapControl {
        fn kill_tree(&mut self) {
            self.killed = true;
        }

        fn try_reap(&mut self) -> bool {
            self.reap_attempts += 1;
            false
        }

        fn hand_off_reap(&mut self) {
            self.handed_off = true;
        }
    }

    #[test]
    fn unreapable_child_is_handed_off_at_cleanup_deadline() {
        let mut control = FakeReapControl::default();
        terminate_and_reap(&mut control, Instant::now());

        assert!(control.killed);
        assert_eq!(control.reap_attempts, 1);
        assert!(control.handed_off);
    }

    #[test]
    fn repeated_unreapable_helpers_remain_capacity_accounted() {
        for _ in 0..(CLEANUP_CAPACITY * 4) {
            let mut control = FakeReapControl::default();
            terminate_and_reap(&mut control, Instant::now());
            assert!(control.killed);
            assert_eq!(control.reap_attempts, 1);
            assert!(control.handed_off);
        }

        let counter = AtomicUsize::new(0);
        assert!(reserve_cleanup_count(
            &counter,
            CLEANUP_CAPACITY,
            CLEANUP_CAPACITY
        ));
        assert!(!reserve_cleanup_count(&counter, 1, CLEANUP_CAPACITY));
        assert_eq!(counter.load(Ordering::SeqCst), CLEANUP_CAPACITY);
    }

    #[test]
    fn repeated_worker_timeouts_are_retained_by_bounded_cleanup() {
        let baseline = cleanup_service()
            .unwrap()
            .state
            .outstanding
            .load(Ordering::Acquire);
        let timeout_count = 8;
        let mut releases = Vec::with_capacity(timeout_count);

        for _ in 0..timeout_count {
            let cleanup_slot = acquire_cleanup_slots(1).unwrap().pop().unwrap();
            let (release, wait_for_release) = mpsc::channel::<()>();
            let handle = thread::spawn(move || {
                let _ = wait_for_release.recv();
            });
            let (retained_sender, receiver) = mpsc::sync_channel::<io::Result<()>>(1);
            let worker = Worker {
                receiver,
                thread: Some(WorkerThread {
                    handle: Some(handle),
                    cleanup_slot: Some(cleanup_slot),
                }),
            };

            assert!(matches!(
                worker.wait(Instant::now()),
                Err(ToolRunError::TimedOut)
            ));
            releases.push((release, retained_sender));
        }

        let outstanding = cleanup_service()
            .unwrap()
            .state
            .outstanding
            .load(Ordering::Acquire);
        assert!(outstanding <= CLEANUP_CAPACITY);
        assert!(outstanding >= baseline);
        drop(releases);

        let deadline = Instant::now() + Duration::from_secs(2);
        while cleanup_service()
            .unwrap()
            .state
            .outstanding
            .load(Ordering::Acquire)
            != baseline
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(
            cleanup_service()
                .unwrap()
                .state
                .outstanding
                .load(Ordering::Acquire),
            baseline
        );
    }

    #[test]
    fn repeated_secret_output_drops_zeroize_storage() {
        for _ in 0..256 {
            let wiped = Arc::new(AtomicBool::new(false));
            {
                let _output = ToolOutput {
                    success: true,
                    stdout: Zeroizing::new(b"drop-sensitive-output".to_vec()),
                    stdout_truncated: false,
                    wipe_probe: Some(wiped.clone()),
                };
            }
            assert!(wiped.load(Ordering::SeqCst));
        }
    }
}
