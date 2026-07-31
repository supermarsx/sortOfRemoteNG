//! Shared hardened process boundary for both Docker Compose command surfaces.

use std::collections::HashMap;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const DEFAULT_OPERATION_TIMEOUT: Duration = Duration::from_secs(300);
pub const MAX_CAPTURE_BYTES: usize = 4 * 1024 * 1024;

const MAX_ENV_VALUE_BYTES: usize = 16 * 1024;
const MAX_ENV_TOTAL_BYTES: usize = 64 * 1024;
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
const GRACEFUL_TERMINATION_WINDOW: Duration = Duration::from_millis(250);
const FORCE_REAP_WINDOW: Duration = Duration::from_millis(1_250);
const CAPTURE_FINISH_WINDOW: Duration = Duration::from_secs(1);
const CAPTURE_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Debug)]
pub enum ProcessBoundaryError {
    ExecutableUnavailable,
    InvalidEnvironment,
    InvalidTimeout,
    SpawnFailed,
    ProcessTreeUnavailable,
    MonitorFailed,
    TimedOut,
    CaptureFailed,
}

#[derive(Debug)]
pub struct CapturedOutput {
    pub bytes: Vec<u8>,
    pub truncated: bool,
}

#[derive(Debug)]
pub struct ProcessOutput {
    pub status: ExitStatus,
    pub stdout: CapturedOutput,
    pub stderr: CapturedOutput,
}

type CaptureResult = io::Result<CapturedOutput>;

struct CaptureWorker {
    receiver: mpsc::Receiver<CaptureResult>,
    cancelled: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

pub fn append_environment_passthrough(
    args: &mut Vec<String>,
    values: &HashMap<String, String>,
    flag: &str,
) -> Result<Vec<(String, String)>, ProcessBoundaryError> {
    let mut names: Vec<&String> = values.keys().collect();
    names.sort_unstable();
    let mut total_bytes = 0_usize;
    let mut environment = Vec::with_capacity(names.len());

    for name in names {
        let value = &values[name];
        if !valid_environment_name(name) || reserved_host_environment_name(name) {
            return Err(ProcessBoundaryError::InvalidEnvironment);
        }
        if value.as_bytes().contains(&0) || value.len() > MAX_ENV_VALUE_BYTES {
            return Err(ProcessBoundaryError::InvalidEnvironment);
        }
        total_bytes = total_bytes
            .saturating_add(name.len())
            .saturating_add(value.len());
        if total_bytes > MAX_ENV_TOTAL_BYTES {
            return Err(ProcessBoundaryError::InvalidEnvironment);
        }

        args.push(flag.to_string());
        args.push(name.clone());
        environment.push((name.clone(), value.clone()));
    }

    Ok(environment)
}

pub fn resolve_trusted_executable(name: &str) -> Result<PathBuf, ProcessBoundaryError> {
    if !matches!(name, "docker" | "docker-compose") {
        return Err(ProcessBoundaryError::ExecutableUnavailable);
    }

    let file_name = executable_file_name(name);
    let roots = trusted_executable_roots();
    let mut candidates = explicit_executable_candidates(&file_name, &roots);
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|directory| directory.join(&file_name)));
    }

    for candidate in candidates {
        let Ok(canonical) = fs::canonicalize(candidate) else {
            continue;
        };
        if canonical.is_file()
            && path_is_under_trusted_root(&canonical, &roots)
            && executable_permissions_are_trusted(&canonical)
        {
            return Ok(canonical);
        }
    }

    Err(ProcessBoundaryError::ExecutableUnavailable)
}

pub fn unavailable_executable_path(name: &str) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(format!(r"C:\__sorng_unavailable__\{}.exe", name))
    }
    #[cfg(not(windows))]
    {
        PathBuf::from(format!("/__sorng_unavailable__/{}", name))
    }
}

pub fn execute(
    program: &Path,
    args: &[String],
    environment: &[(String, String)],
    working_directory: Option<&Path>,
    timeout: Duration,
    capture_limit: usize,
) -> Result<ProcessOutput, ProcessBoundaryError> {
    let mut command = Command::new(program);
    command.args(args);
    execute_command(
        command,
        program,
        environment,
        working_directory,
        timeout,
        capture_limit,
    )
}

fn execute_command(
    mut command: Command,
    program: &Path,
    environment: &[(String, String)],
    working_directory: Option<&Path>,
    timeout: Duration,
    capture_limit: usize,
) -> Result<ProcessOutput, ProcessBoundaryError> {
    if timeout.is_zero() {
        return Err(ProcessBoundaryError::InvalidTimeout);
    }

    configure_minimal_environment(&mut command, program, environment)?;
    if let Some(directory) = working_directory {
        command.current_dir(validated_working_directory(directory)?);
    }
    platform::configure_process_tree(&mut command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = command
        .spawn()
        .map_err(|_| ProcessBoundaryError::SpawnFailed)?;
    let mut guard = ChildGuard::new(child)?;
    let stdout = guard
        .child_mut()?
        .stdout
        .take()
        .ok_or(ProcessBoundaryError::CaptureFailed)?;
    let stderr = guard
        .child_mut()?
        .stderr
        .take()
        .ok_or(ProcessBoundaryError::CaptureFailed)?;
    let stdout_capture = capture_bounded(stdout, capture_limit);
    let stderr_capture = capture_bounded(stderr, capture_limit);
    let deadline = Instant::now() + timeout;

    let status = loop {
        match guard.child_mut()?.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                let now = Instant::now();
                if now >= deadline {
                    guard.terminate_and_reap();
                    discard_captures(stdout_capture, stderr_capture);
                    return Err(ProcessBoundaryError::TimedOut);
                }
                thread::sleep(PROCESS_POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
            }
            Err(_) => {
                guard.terminate_and_reap();
                discard_captures(stdout_capture, stderr_capture);
                return Err(ProcessBoundaryError::MonitorFailed);
            }
        }
    };

    guard.disarm();
    let (stdout, stderr) = finish_captures(stdout_capture, stderr_capture)?;
    Ok(ProcessOutput {
        status,
        stdout,
        stderr,
    })
}

fn valid_environment_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some('_') | Some('A'..='Z') | Some('a'..='z'))
        && name.len() <= 128
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn validated_working_directory(path: &Path) -> Result<PathBuf, ProcessBoundaryError> {
    let rendered = path.as_os_str().to_string_lossy();
    if !path.is_absolute()
        || rendered.is_empty()
        || rendered.len() > 4_096
        || rendered.contains('\0')
    {
        return Err(ProcessBoundaryError::InvalidEnvironment);
    }
    let canonical = fs::canonicalize(path).map_err(|_| ProcessBoundaryError::InvalidEnvironment)?;
    if !canonical.is_dir() {
        return Err(ProcessBoundaryError::InvalidEnvironment);
    }
    Ok(canonical)
}

fn reserved_host_environment_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper == "PATH"
        || upper == "PATHEXT"
        || upper == "COMSPEC"
        || upper == "SYSTEMROOT"
        || upper == "WINDIR"
        || upper == "HOME"
        || upper == "USERPROFILE"
        || upper == "APPDATA"
        || upper == "LOCALAPPDATA"
        || upper == "TEMP"
        || upper == "TMP"
        || upper == "TMPDIR"
        || upper == "XDG_CONFIG_HOME"
        || upper == "XDG_RUNTIME_DIR"
        || upper == "SSL_CERT_FILE"
        || upper == "SSL_CERT_DIR"
        || upper == "SSH_AUTH_SOCK"
        || upper == "BASH_ENV"
        || upper == "ENV"
        || upper == "SHELLOPTS"
        || upper == "CDPATH"
        || upper == "PYTHONPATH"
        || upper == "PYTHONHOME"
        || upper == "PERL5LIB"
        || upper == "RUBYLIB"
        || upper == "NODE_OPTIONS"
        || upper == "NODE_PATH"
        || upper == "JAVA_TOOL_OPTIONS"
        || upper == "JDK_JAVA_OPTIONS"
        || upper == "GODEBUG"
        || upper == "GOMAXPROCS"
        || upper == "NO_PROXY"
        || upper.starts_with("DOCKER_")
        || upper.starts_with("COMPOSE_")
        || upper.starts_with("BUILDKIT_")
        || upper.starts_with("CONTAINERD_")
        || upper.starts_with("LD_")
        || upper.starts_with("DYLD_")
        || upper.starts_with("OTEL_")
        || upper.ends_with("_PROXY")
}

fn configure_minimal_environment(
    command: &mut Command,
    program: &Path,
    environment: &[(String, String)],
) -> Result<(), ProcessBoundaryError> {
    command.env_clear();

    for name in [
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "LC_ALL",
    ] {
        if let Some(value) = env::var_os(name) {
            command.env(name, value);
        }
    }

    #[cfg(windows)]
    {
        let windows_directory =
            platform::windows_directory().ok_or(ProcessBoundaryError::InvalidEnvironment)?;
        command.env("SystemRoot", &windows_directory);
        command.env("WINDIR", windows_directory);
    }

    command.env("PATH", trusted_child_path(program)?);
    #[cfg(windows)]
    command.env("PATHEXT", ".COM;.EXE;.BAT;.CMD");

    let mut total_bytes = 0_usize;
    for (name, value) in environment {
        if !valid_environment_name(name)
            || reserved_host_environment_name(name)
            || value.as_bytes().contains(&0)
            || value.len() > MAX_ENV_VALUE_BYTES
        {
            return Err(ProcessBoundaryError::InvalidEnvironment);
        }
        total_bytes = total_bytes
            .saturating_add(name.len())
            .saturating_add(value.len());
        if total_bytes > MAX_ENV_TOTAL_BYTES {
            return Err(ProcessBoundaryError::InvalidEnvironment);
        }
        command.env(name, value);
    }

    Ok(())
}

fn trusted_child_path(program: &Path) -> Result<OsString, ProcessBoundaryError> {
    let mut paths = Vec::new();
    if let Some(parent) = program.parent() {
        paths.push(parent.to_path_buf());
    }
    #[cfg(windows)]
    paths.push(platform::system_directory().ok_or(ProcessBoundaryError::InvalidEnvironment)?);
    #[cfg(not(windows))]
    paths.extend([
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ]);
    paths.sort_unstable();
    paths.dedup();
    env::join_paths(paths).map_err(|_| ProcessBoundaryError::InvalidEnvironment)
}

fn executable_file_name(name: &str) -> OsString {
    #[cfg(windows)]
    {
        OsString::from(format!("{}.exe", name))
    }
    #[cfg(not(windows))]
    {
        OsString::from(name)
    }
}

fn trusted_executable_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    roots.extend(platform::trusted_executable_roots());
    #[cfg(not(windows))]
    roots.extend([
        PathBuf::from("/usr/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/Applications/Docker.app/Contents/Resources/bin"),
    ]);

    roots
        .into_iter()
        .filter_map(|root| fs::canonicalize(root).ok())
        .collect()
}

fn explicit_executable_candidates(file_name: &OsString, roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for root in roots {
        candidates.push(root.join(file_name));
        #[cfg(windows)]
        {
            candidates.push(
                root.join("Docker")
                    .join("Docker")
                    .join("resources")
                    .join("bin")
                    .join(file_name),
            );
            candidates.push(root.join("System32").join(file_name));
        }
    }
    candidates
}

fn path_is_under_trusted_root(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

#[cfg(unix)]
fn executable_permissions_are_trusted(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    path.ancestors().enumerate().all(|(index, ancestor)| {
        let Ok(metadata) = fs::metadata(ancestor) else {
            return false;
        };
        unix_owner_and_mode_are_trusted(metadata.uid(), metadata.mode(), index == 0)
    })
}

#[cfg(unix)]
fn unix_owner_and_mode_are_trusted(uid: u32, mode: u32, executable: bool) -> bool {
    uid == 0 && mode & 0o022 == 0 && (!executable || mode & 0o111 != 0)
}

#[cfg(not(unix))]
fn executable_permissions_are_trusted(_path: &Path) -> bool {
    true
}

fn capture_bounded<R>(mut reader: R, limit: usize) -> CaptureWorker
where
    R: platform::CaptureReader,
{
    let (sender, receiver) = mpsc::sync_channel(1);
    let cancelled = Arc::new(AtomicBool::new(false));
    let worker_cancelled = Arc::clone(&cancelled);
    let join = thread::spawn(move || {
        let result = reader.prepare_capture().and_then(|()| {
            let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
            let mut truncated = false;
            let mut chunk = [0_u8; 8 * 1024];
            loop {
                if worker_cancelled.load(Ordering::Acquire) {
                    return Err(io::Error::new(
                        io::ErrorKind::Interrupted,
                        "capture cancelled",
                    ));
                }
                let Some(read) = reader.read_capture(&mut chunk)? else {
                    thread::sleep(CAPTURE_POLL_INTERVAL);
                    continue;
                };
                if read == 0 {
                    break;
                }
                let remaining = limit.saturating_sub(bytes.len());
                let retained = remaining.min(read);
                bytes.extend_from_slice(&chunk[..retained]);
                truncated |= retained < read;
            }
            Ok(CapturedOutput { bytes, truncated })
        });
        drop(reader);
        let _ = sender.send(result);
    });
    CaptureWorker {
        receiver,
        cancelled,
        join: Some(join),
    }
}

fn finish_captures(
    stdout: CaptureWorker,
    stderr: CaptureWorker,
) -> Result<(CapturedOutput, CapturedOutput), ProcessBoundaryError> {
    let deadline = Instant::now() + CAPTURE_FINISH_WINDOW;
    let stdout_result = stdout.finish(deadline);
    let stderr_result = stderr.finish(deadline);
    match (stdout_result, stderr_result) {
        (Ok(stdout), Ok(stderr)) => Ok((stdout, stderr)),
        _ => Err(ProcessBoundaryError::CaptureFailed),
    }
}

fn discard_captures(stdout: CaptureWorker, stderr: CaptureWorker) {
    stdout.cancel();
    stderr.cancel();
    let _ = stdout.cancel_and_join(Instant::now() + CAPTURE_FINISH_WINDOW);
    let _ = stderr.cancel_and_join(Instant::now() + CAPTURE_FINISH_WINDOW);
}

impl CaptureWorker {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    fn finish(mut self, deadline: Instant) -> Result<CapturedOutput, ProcessBoundaryError> {
        let result = match self
            .receiver
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        {
            Ok(result) => result,
            Err(_) => {
                self.cancel();
                let cancellation_deadline = Instant::now() + CAPTURE_FINISH_WINDOW;
                let received = self
                    .receiver
                    .recv_timeout(cancellation_deadline.saturating_duration_since(Instant::now()));
                let joined = self.join_until(Instant::now() + CAPTURE_FINISH_WINDOW);
                if received.is_err() || joined.is_err() {
                    return Err(ProcessBoundaryError::CaptureFailed);
                }
                return Err(ProcessBoundaryError::CaptureFailed);
            }
        };
        self.join_until(Instant::now() + CAPTURE_FINISH_WINDOW)?;
        result.map_err(|_| ProcessBoundaryError::CaptureFailed)
    }

    fn cancel_and_join(mut self, deadline: Instant) -> Result<(), ProcessBoundaryError> {
        self.cancel();
        let received = self
            .receiver
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| ProcessBoundaryError::CaptureFailed);
        let joined = self.join_until(Instant::now() + CAPTURE_FINISH_WINDOW);
        match (received, joined) {
            (Ok(_), Ok(())) => Ok(()),
            _ => Err(ProcessBoundaryError::CaptureFailed),
        }
    }

    fn join_until(&mut self, deadline: Instant) -> Result<(), ProcessBoundaryError> {
        let Some(join) = self.join.as_ref() else {
            return Ok(());
        };
        while !join.is_finished() {
            let now = Instant::now();
            if now >= deadline {
                return Err(ProcessBoundaryError::CaptureFailed);
            }
            thread::sleep(CAPTURE_POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
        }
        self.join
            .take()
            .ok_or(ProcessBoundaryError::CaptureFailed)?
            .join()
            .map_err(|_| ProcessBoundaryError::CaptureFailed)
    }
}

impl Drop for CaptureWorker {
    fn drop(&mut self) {
        self.cancel();
        let deadline = Instant::now() + CAPTURE_FINISH_WINDOW;
        while self
            .join
            .as_ref()
            .map(|join| !join.is_finished())
            .unwrap_or(false)
            && Instant::now() < deadline
        {
            thread::sleep(CAPTURE_POLL_INTERVAL);
        }
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

struct ChildGuard {
    child: Option<Child>,
    tree: Option<platform::ProcessTree>,
}

impl ChildGuard {
    fn new(mut child: Child) -> Result<Self, ProcessBoundaryError> {
        let Some(tree) = platform::ProcessTree::attach(&child) else {
            let _ = child.kill();
            let deadline = Instant::now() + FORCE_REAP_WINDOW;
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    break;
                }
                thread::sleep(PROCESS_POLL_INTERVAL);
            }
            return Err(ProcessBoundaryError::ProcessTreeUnavailable);
        };
        Ok(Self {
            child: Some(child),
            tree: Some(tree),
        })
    }

    fn child_mut(&mut self) -> Result<&mut Child, ProcessBoundaryError> {
        self.child
            .as_mut()
            .ok_or(ProcessBoundaryError::MonitorFailed)
    }

    fn disarm(&mut self) {
        if let Some(tree) = self.tree.as_ref() {
            tree.terminate(true);
        }
        self.tree.take();
        self.child.take();
    }

    fn terminate_and_reap(&mut self) {
        if self.child.is_none() {
            self.tree.take();
            return;
        }
        if let Some(tree) = self.tree.as_ref() {
            tree.terminate(false);
        }
        if !self.reap_until(Instant::now() + GRACEFUL_TERMINATION_WINDOW) {
            if let Some(tree) = self.tree.as_ref() {
                tree.terminate(true);
            }
            if let Some(child) = self.child.as_mut() {
                let _ = child.kill();
            }
            let _ = self.reap_until(Instant::now() + FORCE_REAP_WINDOW);
        }
        self.tree.take();
        self.child.take();
    }

    fn reap_until(&mut self, deadline: Instant) -> bool {
        loop {
            let Some(child) = self.child.as_mut() else {
                return true;
            };
            match child.try_wait() {
                Ok(Some(_)) => {
                    self.child.take();
                    return true;
                }
                Ok(None) => {}
                Err(_) => return false,
            }
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            thread::sleep(PROCESS_POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
        }
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        self.terminate_and_reap();
    }
}

#[cfg(unix)]
mod platform {
    use std::io::{self, Read};
    use std::os::unix::io::AsRawFd;
    use std::os::unix::process::CommandExt;
    use std::process::{Child, ChildStderr, ChildStdout, Command};

    const SIGTERM: i32 = 15;
    const SIGKILL: i32 = 9;
    const F_GETFL: i32 = 3;
    const F_SETFL: i32 = 4;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    const O_NONBLOCK: i32 = 0x800;
    #[cfg(any(target_os = "solaris", target_os = "illumos"))]
    const O_NONBLOCK: i32 = 0x80;
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "solaris",
        target_os = "illumos"
    )))]
    const O_NONBLOCK: i32 = 0x4;

    unsafe extern "C" {
        fn fcntl(file_descriptor: i32, command: i32, ...) -> i32;
        fn kill(pid: i32, signal: i32) -> i32;
    }

    pub trait CaptureReader: Send + 'static {
        fn prepare_capture(&self) -> io::Result<()>;
        fn read_capture(&mut self, buffer: &mut [u8]) -> io::Result<Option<usize>>;
    }

    fn prepare_capture(file_descriptor: i32) -> io::Result<()> {
        let flags = unsafe { fcntl(file_descriptor, F_GETFL) };
        if flags == -1 {
            return Err(io::Error::last_os_error());
        }
        if unsafe { fcntl(file_descriptor, F_SETFL, flags | O_NONBLOCK) } == -1 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    macro_rules! impl_capture_reader {
        ($reader:ty) => {
            impl CaptureReader for $reader {
                fn prepare_capture(&self) -> io::Result<()> {
                    prepare_capture(self.as_raw_fd())
                }

                fn read_capture(&mut self, buffer: &mut [u8]) -> io::Result<Option<usize>> {
                    match Read::read(self, buffer) {
                        Ok(read) => Ok(Some(read)),
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(None),
                        Err(error) if error.kind() == io::ErrorKind::Interrupted => Ok(None),
                        Err(error) => Err(error),
                    }
                }
            }
        };
    }

    impl_capture_reader!(ChildStdout);
    impl_capture_reader!(ChildStderr);

    pub struct ProcessTree {
        process_group: i32,
    }

    pub fn configure_process_tree(command: &mut Command) {
        command.process_group(0);
    }

    impl ProcessTree {
        pub fn attach(child: &Child) -> Option<Self> {
            i32::try_from(child.id())
                .ok()
                .map(|process_group| Self { process_group })
        }

        pub fn terminate(&self, force: bool) {
            let signal = if force { SIGKILL } else { SIGTERM };
            unsafe {
                let _ = kill(-self.process_group, signal);
            }
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::{c_void, OsString};
    use std::io::{self, Read};
    use std::mem;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::PathBuf;
    use std::process::{Child, ChildStderr, ChildStdout, Command};

    type Handle = *mut c_void;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
    const MAX_WINDOWS_PATH_CHARS: usize = 32_768;
    const ERROR_HANDLE_EOF: i32 = 38;
    const ERROR_BROKEN_PIPE: i32 = 109;
    const ERROR_PIPE_NOT_CONNECTED: i32 = 233;

    #[repr(C)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    const FOLDER_ID_PROGRAM_FILES: Guid = Guid {
        data1: 0x905e63b6,
        data2: 0xc1bf,
        data3: 0x494e,
        data4: [0xb2, 0x9c, 0x65, 0xb7, 0x32, 0xd3, 0xd2, 0x1a],
    };
    const FOLDER_ID_PROGRAM_FILES_X64: Guid = Guid {
        data1: 0x6d809377,
        data2: 0x6af0,
        data3: 0x444b,
        data4: [0x89, 0x57, 0xa3, 0x77, 0x3f, 0x02, 0x20, 0x0e],
    };
    const FOLDER_ID_PROGRAM_FILES_X86: Guid = Guid {
        data1: 0x7c5a40ef,
        data2: 0xa0fb,
        data3: 0x4bfc,
        data4: [0x87, 0x4a, 0xc0, 0xf2, 0xe0, 0xb9, 0xfa, 0x8e],
    };

    #[repr(C)]
    #[derive(Default)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            information_class: i32,
            information: *const c_void,
            information_length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
        fn GetWindowsDirectoryW(buffer: *mut u16, size: u32) -> u32;
        fn PeekNamedPipe(
            pipe: Handle,
            buffer: *mut c_void,
            buffer_size: u32,
            bytes_read: *mut u32,
            total_bytes_available: *mut u32,
            bytes_left: *mut u32,
        ) -> i32;
    }

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHGetKnownFolderPath(
            folder_id: *const Guid,
            flags: u32,
            token: Handle,
            path: *mut *mut u16,
        ) -> i32;
    }

    #[link(name = "ole32")]
    unsafe extern "system" {
        fn CoTaskMemFree(memory: *const c_void);
    }

    pub trait CaptureReader: Send + 'static {
        fn prepare_capture(&self) -> io::Result<()>;
        fn read_capture(&mut self, buffer: &mut [u8]) -> io::Result<Option<usize>>;
    }

    fn pipe_is_closed(error: &io::Error) -> bool {
        matches!(
            error.raw_os_error(),
            Some(ERROR_HANDLE_EOF) | Some(ERROR_BROKEN_PIPE) | Some(ERROR_PIPE_NOT_CONNECTED)
        )
    }

    macro_rules! impl_capture_reader {
        ($reader:ty) => {
            impl CaptureReader for $reader {
                fn prepare_capture(&self) -> io::Result<()> {
                    Ok(())
                }

                fn read_capture(&mut self, buffer: &mut [u8]) -> io::Result<Option<usize>> {
                    let mut available = 0_u32;
                    let peeked = unsafe {
                        PeekNamedPipe(
                            self.as_raw_handle().cast(),
                            std::ptr::null_mut(),
                            0,
                            std::ptr::null_mut(),
                            &mut available,
                            std::ptr::null_mut(),
                        )
                    };
                    if peeked == 0 {
                        let error = io::Error::last_os_error();
                        return if pipe_is_closed(&error) {
                            Ok(Some(0))
                        } else {
                            Err(error)
                        };
                    }
                    if available == 0 {
                        return Ok(None);
                    }
                    let read_limit = buffer.len().min(available as usize);
                    match Read::read(self, &mut buffer[..read_limit]) {
                        Ok(read) => Ok(Some(read)),
                        Err(error) if pipe_is_closed(&error) => Ok(Some(0)),
                        Err(error) if error.kind() == io::ErrorKind::Interrupted => Ok(None),
                        Err(error) => Err(error),
                    }
                }
            }
        };
    }

    impl_capture_reader!(ChildStdout);
    impl_capture_reader!(ChildStderr);

    fn directory_from_system_api(
        function: unsafe extern "system" fn(*mut u16, u32) -> u32,
    ) -> Option<PathBuf> {
        let mut buffer = vec![0_u16; 260];
        loop {
            let length = unsafe { function(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
            if length == 0 || length > MAX_WINDOWS_PATH_CHARS {
                return None;
            }
            if length < buffer.len() {
                buffer.truncate(length);
                return Some(PathBuf::from(OsString::from_wide(&buffer)));
            }
            buffer.resize(length.saturating_add(1), 0);
        }
    }

    fn known_folder(folder_id: &Guid) -> Option<PathBuf> {
        unsafe {
            let mut raw_path = std::ptr::null_mut();
            if SHGetKnownFolderPath(folder_id, 0, std::ptr::null_mut(), &mut raw_path) < 0
                || raw_path.is_null()
            {
                return None;
            }
            let mut length = 0_usize;
            while length < MAX_WINDOWS_PATH_CHARS && *raw_path.add(length) != 0 {
                length += 1;
            }
            let path = if length < MAX_WINDOWS_PATH_CHARS {
                Some(PathBuf::from(OsString::from_wide(
                    std::slice::from_raw_parts(raw_path, length),
                )))
            } else {
                None
            };
            CoTaskMemFree(raw_path.cast());
            path
        }
    }

    pub fn trusted_executable_roots() -> Vec<PathBuf> {
        let mut roots = [
            known_folder(&FOLDER_ID_PROGRAM_FILES),
            known_folder(&FOLDER_ID_PROGRAM_FILES_X64),
            known_folder(&FOLDER_ID_PROGRAM_FILES_X86),
            system_directory(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        roots.sort_unstable();
        roots.dedup();
        roots
    }

    pub fn system_directory() -> Option<PathBuf> {
        directory_from_system_api(GetSystemDirectoryW)
    }

    pub fn windows_directory() -> Option<PathBuf> {
        directory_from_system_api(GetWindowsDirectoryW)
    }

    pub struct ProcessTree {
        job: Handle,
    }

    unsafe impl Send for ProcessTree {}

    pub fn configure_process_tree(_command: &mut Command) {}

    impl ProcessTree {
        pub fn attach(child: &Child) -> Option<Self> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return None;
                }
                let mut limits = ExtendedLimitInformation::default();
                limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let configured = SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    (&limits as *const ExtendedLimitInformation).cast(),
                    mem::size_of::<ExtendedLimitInformation>() as u32,
                ) != 0;
                let assigned =
                    configured && AssignProcessToJobObject(job, child.as_raw_handle().cast()) != 0;
                if !assigned {
                    let _ = CloseHandle(job);
                    return None;
                }
                Some(Self { job })
            }
        }

        pub fn terminate(&self, _force: bool) {
            unsafe {
                let _ = TerminateJobObject(self.job, 1);
            }
        }
    }

    impl Drop for ProcessTree {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.job);
            }
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use std::io::{self, Read};
    use std::process::{Child, ChildStderr, ChildStdout, Command};

    pub trait CaptureReader: Send + 'static {
        fn prepare_capture(&self) -> io::Result<()>;
        fn read_capture(&mut self, buffer: &mut [u8]) -> io::Result<Option<usize>>;
    }

    macro_rules! impl_capture_reader {
        ($reader:ty) => {
            impl CaptureReader for $reader {
                fn prepare_capture(&self) -> io::Result<()> {
                    Ok(())
                }

                fn read_capture(&mut self, buffer: &mut [u8]) -> io::Result<Option<usize>> {
                    Read::read(self, buffer).map(Some)
                }
            }
        };
    }

    impl_capture_reader!(ChildStdout);
    impl_capture_reader!(ChildStderr);

    pub struct ProcessTree;

    pub fn configure_process_tree(_command: &mut Command) {}

    impl ProcessTree {
        pub fn attach(_child: &Child) -> Option<Self> {
            None
        }

        pub fn terminate(&self, _force: bool) {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct PendingCapture {
        closed: Arc<AtomicBool>,
    }

    impl Drop for PendingCapture {
        fn drop(&mut self) {
            self.closed.store(true, Ordering::Release);
        }
    }

    impl platform::CaptureReader for PendingCapture {
        fn prepare_capture(&self) -> io::Result<()> {
            Ok(())
        }

        fn read_capture(&mut self, _buffer: &mut [u8]) -> io::Result<Option<usize>> {
            Ok(None)
        }
    }

    #[test]
    fn reserved_environment_names_fail_closed() {
        for name in [
            "PATH",
            "docker_host",
            "COMPOSE_FILE",
            "HTTPS_PROXY",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
            "NODE_OPTIONS",
        ] {
            let values = HashMap::from([(name.to_string(), "secret".to_string())]);
            assert!(append_environment_passthrough(&mut Vec::new(), &values, "-e").is_err());
        }
    }

    #[test]
    fn safe_environment_name_uses_name_only_in_argv() {
        let secret = "not-in-argv".to_string();
        let values = HashMap::from([("APP_TOKEN".to_string(), secret.clone())]);
        let mut args = Vec::new();
        let environment = append_environment_passthrough(&mut args, &values, "-e").unwrap();
        assert_eq!(args, vec!["-e".to_string(), "APP_TOKEN".to_string()]);
        assert!(!args.iter().any(|arg| arg.contains(&secret)));
        assert_eq!(environment, vec![("APP_TOKEN".to_string(), secret)]);
    }

    #[test]
    fn cancelled_capture_worker_closes_reader_and_joins() {
        let closed = Arc::new(AtomicBool::new(false));
        let worker = capture_bounded(
            PendingCapture {
                closed: Arc::clone(&closed),
            },
            1024,
        );
        worker
            .cancel_and_join(Instant::now() + CAPTURE_FINISH_WINDOW)
            .unwrap();
        assert!(closed.load(Ordering::Acquire));
    }

    #[cfg(unix)]
    #[test]
    fn unix_trust_requires_root_owned_non_writable_path_chain() {
        assert!(unix_owner_and_mode_are_trusted(0, 0o100755, true));
        assert!(!unix_owner_and_mode_are_trusted(1000, 0o100755, true));
        assert!(!unix_owner_and_mode_are_trusted(0, 0o100775, true));
        assert!(!unix_owner_and_mode_are_trusted(0, 0o100757, true));
    }

    #[test]
    fn boundary_fake_process_helper() {
        let Some(mode) = env::var_os("SORNG_PROCESS_BOUNDARY_TEST_MODE") else {
            return;
        };
        match mode.to_string_lossy().as_ref() {
            "environment" => {
                if env::var_os("SORNG_SHOULD_HAVE_BEEN_CLEARED").is_some()
                    || env::var("APP_TOKEN").ok().as_deref() != Some("child-secret")
                {
                    std::process::exit(41);
                }
            }
            "tree-hang" => {
                let _descendant = Command::new(env::current_exe().unwrap())
                    .args([
                        "boundary_descendant_helper",
                        "--nocapture",
                        "--test-threads=1",
                    ])
                    .spawn()
                    .unwrap();
                thread::sleep(Duration::from_secs(30));
            }
            "orphan-pipe" => {
                let _descendant = Command::new(env::current_exe().unwrap())
                    .args([
                        "boundary_descendant_helper",
                        "--nocapture",
                        "--test-threads=1",
                    ])
                    .spawn()
                    .unwrap();
            }
            "flood" => {
                let payload = vec![b'x'; 32 * 1024];
                std::io::stdout().write_all(&payload).unwrap();
                std::io::stderr().write_all(&payload).unwrap();
            }
            _ => {}
        }
    }

    #[test]
    fn boundary_descendant_helper() {
        if env::var_os("SORNG_PROCESS_BOUNDARY_TEST_MODE").is_some() {
            thread::sleep(Duration::from_secs(30));
        }
    }

    fn helper_args() -> Vec<String> {
        vec![
            "boundary_fake_process_helper".to_string(),
            "--nocapture".to_string(),
            "--test-threads=1".to_string(),
        ]
    }

    fn run_helper(
        mode: &str,
        timeout: Duration,
        limit: usize,
    ) -> Result<ProcessOutput, ProcessBoundaryError> {
        let executable = env::current_exe().unwrap();
        let environment = vec![
            (
                "SORNG_PROCESS_BOUNDARY_TEST_MODE".to_string(),
                mode.to_string(),
            ),
            ("APP_TOKEN".to_string(), "child-secret".to_string()),
        ];
        execute(
            &executable,
            &helper_args(),
            &environment,
            None,
            timeout,
            limit,
        )
    }

    #[test]
    fn inherited_environment_is_cleared_before_spawn() {
        let executable = env::current_exe().unwrap();
        let mut command = Command::new(&executable);
        command
            .args(helper_args())
            .env("SORNG_SHOULD_HAVE_BEEN_CLEARED", "yes");
        let environment = vec![
            (
                "SORNG_PROCESS_BOUNDARY_TEST_MODE".to_string(),
                "environment".to_string(),
            ),
            ("APP_TOKEN".to_string(), "child-secret".to_string()),
        ];
        let output = execute_command(
            command,
            &executable,
            &environment,
            None,
            Duration::from_secs(3),
            1024,
        )
        .unwrap();
        assert!(output.status.success());
    }

    #[test]
    fn timeout_cleans_descendant_tree_and_returns_bounded() {
        let started = Instant::now();
        assert!(matches!(
            run_helper("tree-hang", Duration::from_millis(100), 1024),
            Err(ProcessBoundaryError::TimedOut)
        ));
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn successful_parent_cannot_leave_pipe_worker_blocked_on_descendant() {
        let started = Instant::now();
        let output = run_helper("orphan-pipe", Duration::from_secs(3), 1024).unwrap();
        assert!(output.status.success());
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn output_capture_remains_bounded() {
        let output = run_helper("flood", Duration::from_secs(3), 1024).unwrap();
        assert_eq!(output.stdout.bytes.len(), 1024);
        assert_eq!(output.stderr.bytes.len(), 1024);
        assert!(output.stdout.truncated);
        assert!(output.stderr.truncated);
    }

    #[test]
    fn workspace_test_binary_is_not_a_trusted_docker_location() {
        let executable = fs::canonicalize(env::current_exe().unwrap()).unwrap();
        assert!(!path_is_under_trusted_root(
            &executable,
            &trusted_executable_roots()
        ));
    }

    #[test]
    fn relative_working_directory_fails_before_spawn() {
        let executable = env::current_exe().unwrap();
        assert!(matches!(
            execute(
                &executable,
                &helper_args(),
                &[],
                Some(Path::new("relative-directory")),
                Duration::from_secs(1),
                1024,
            ),
            Err(ProcessBoundaryError::InvalidEnvironment)
        ));
    }
}
