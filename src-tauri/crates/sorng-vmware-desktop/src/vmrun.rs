//! VMware `vmrun` CLI wrapper.
//!
//! `vmrun` is the primary command-line tool shipped with Workstation, Player,
//! and Fusion.  This module wraps every useful sub-command in an ergonomic
//! async Rust API, parsing stdout/stderr into typed results.

use crate::error::{VmwError, VmwErrorKind, VmwResult};
use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{Child, Command},
    sync::{mpsc, oneshot, Semaphore},
    task::JoinHandle,
};

const MAX_TOOL_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_CONCURRENT_TOOL_JOBS: usize = 2;
const MAX_VMDK_SIZE_MB: u64 = 8 * 1024 * 1024 * 1024;
const OUTPUT_DRAIN_GRACE: Duration = Duration::from_secs(5);
const OUTPUT_ABORT_GRACE: Duration = Duration::from_secs(1);
const PROCESS_REAP_GRACE: Duration = Duration::from_secs(5);
const PROCESS_REAP_RETRY: Duration = Duration::from_millis(100);
static TOOL_JOB_LIMIT: Semaphore = Semaphore::const_new(MAX_CONCURRENT_TOOL_JOBS);

#[derive(Clone, Copy)]
enum DesktopToolJob {
    VmRun,
    OvfImport,
    OvfExport,
    VmdkCreate,
    VmdkDefragment,
    VmdkShrink,
    VmdkExpand,
    VmdkConvert,
    VmdkRename,
}

impl DesktopToolJob {
    fn label(self) -> &'static str {
        match self {
            Self::VmRun => "vmrun command",
            Self::OvfImport => "OVF import",
            Self::OvfExport => "OVF export",
            Self::VmdkCreate => "VMDK creation",
            Self::VmdkDefragment => "VMDK defragmentation",
            Self::VmdkShrink => "VMDK shrink",
            Self::VmdkExpand => "VMDK expansion",
            Self::VmdkConvert => "VMDK conversion",
            Self::VmdkRename => "VMDK rename",
        }
    }

    fn deadline(self) -> Duration {
        let seconds = match self {
            Self::VmRun => 60,
            Self::OvfImport | Self::OvfExport => 12 * 60 * 60,
            Self::VmdkDefragment | Self::VmdkShrink | Self::VmdkConvert => 12 * 60 * 60,
            Self::VmdkCreate | Self::VmdkExpand => 8 * 60 * 60,
            Self::VmdkRename => 10 * 60,
        };
        Duration::from_secs(seconds)
    }
}

#[cfg(unix)]
mod process_tree {
    use std::{io, os::unix::process::CommandExt};
    use tokio::process::{Child, Command};

    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }

    const SIGKILL: i32 = 9;

    pub(super) fn configure(command: &mut Command) {
        command.as_std_mut().process_group(0);
    }

    pub(super) struct ProcessTree {
        process_group: i32,
    }

    impl ProcessTree {
        pub(super) fn attach(child: &Child) -> io::Result<Self> {
            let process_group = child
                .id()
                .ok_or_else(|| io::Error::other("VMware process has no process id"))?;
            Ok(Self {
                process_group: process_group as i32,
            })
        }

        pub(super) fn terminate(&mut self) {
            // The child was placed in a fresh process group before spawn, so a
            // negative PID targets it and every descendant it created.
            unsafe {
                let _ = kill(-self.process_group, SIGKILL);
            }
        }
    }

    impl Drop for ProcessTree {
        fn drop(&mut self) {
            self.terminate();
        }
    }
}

#[cfg(windows)]
mod process_tree {
    use std::{ffi::c_void, io, ptr};
    use tokio::process::{Child, Command};

    type Handle = *mut c_void;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

    #[repr(C)]
    #[derive(Default)]
    struct JobObjectBasicLimitInformation {
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
    struct JobObjectExtendedLimitInformation {
        basic_limit_information: JobObjectBasicLimitInformation,
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
    }

    pub(super) fn configure(_command: &mut Command) {}

    pub(super) struct ProcessTree {
        job: Handle,
    }

    // The job handle is exclusively owned and may move with its supervising
    // future between Tokio worker threads.
    unsafe impl Send for ProcessTree {}

    impl ProcessTree {
        pub(super) fn attach(child: &Child) -> io::Result<Self> {
            let process = child
                .raw_handle()
                .ok_or_else(|| io::Error::other("VMware process has no process handle"))?;
            let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }

            let mut limits = JobObjectExtendedLimitInformation::default();
            limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = unsafe {
                SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    (&raw const limits).cast(),
                    std::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
                )
            };
            let assigned =
                configured != 0 && unsafe { AssignProcessToJobObject(job, process.cast()) } != 0;
            if !assigned {
                let error = io::Error::last_os_error();
                unsafe {
                    let _ = CloseHandle(job);
                }
                return Err(error);
            }
            Ok(Self { job })
        }

        pub(super) fn terminate(&mut self) {
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

use process_tree::ProcessTree;

struct CancelJobOnDrop(Option<oneshot::Sender<()>>);

impl CancelJobOnDrop {
    fn disarm(&mut self) {
        self.0.take();
    }
}

impl Drop for CancelJobOnDrop {
    fn drop(&mut self) {
        if let Some(cancel) = self.0.take() {
            let _ = cancel.send(());
        }
    }
}

fn job_error(job: DesktopToolJob, kind: VmwErrorKind, detail: &str) -> VmwError {
    VmwError::new(
        kind,
        format!(
            "{} {}; verify the VMware tool installation, available disk space, and file permissions",
            job.label(),
            detail
        ),
    )
}

fn cleanup_error(job: DesktopToolJob) -> VmwError {
    job_error(
        job,
        VmwErrorKind::Timeout,
        "could not confirm bounded process and output cleanup",
    )
}

fn validate_path_argument(value: &str, label: &str) -> VmwResult<()> {
    if value.trim().is_empty()
        || value.len() > 32 * 1024
        || value.starts_with('-')
        || value.chars().any(|ch| matches!(ch, '\0' | '\r' | '\n'))
    {
        return Err(VmwError::new(
            VmwErrorKind::InvalidConfig,
            format!("{label} is not a valid local path argument"),
        ));
    }
    Ok(())
}

fn validate_disk_type(disk_type: &str) -> VmwResult<&'static str> {
    match disk_type {
        "monolithicSparse" => Ok("0"),
        "twoGbMaxExtentSparse" => Ok("1"),
        "monolithicFlat" => Ok("2"),
        "twoGbMaxExtentFlat" => Ok("4"),
        _ => Err(VmwError::new(
            VmwErrorKind::InvalidConfig,
            "unsupported VMDK disk type",
        )),
    }
}

fn validate_adapter_type(adapter_type: &str) -> VmwResult<()> {
    match adapter_type {
        "ide" | "buslogic" | "lsilogic" | "lsilogicsas" | "pvscsi" => Ok(()),
        _ => Err(VmwError::new(
            VmwErrorKind::InvalidConfig,
            "unsupported VMDK adapter type",
        )),
    }
}

fn validate_trusted_tool(
    path: &Path,
    expected_name: &str,
    job: DesktopToolJob,
) -> VmwResult<PathBuf> {
    let matches_expected_name = path
        .file_name()
        .and_then(OsStr::to_str)
        .map(|name| {
            if cfg!(target_os = "windows") {
                name.eq_ignore_ascii_case(expected_name)
            } else {
                name == expected_name
            }
        })
        .unwrap_or(false);

    if !path.is_absolute() || !matches_expected_name {
        return Err(job_error(
            job,
            VmwErrorKind::InvalidConfig,
            "requires an absolute, recognized VMware executable path",
        ));
    }

    let canonical = std::fs::canonicalize(path).map_err(|_| {
        job_error(
            job,
            VmwErrorKind::VmRunNotFound,
            "could not locate its required executable",
        )
    })?;
    if !canonical.is_file() {
        return Err(job_error(
            job,
            VmwErrorKind::VmRunNotFound,
            "requires a regular executable file",
        ));
    }
    Ok(canonical)
}

async fn drain_output_bounded<R>(mut stream: R, overflow: mpsc::Sender<()>) -> std::io::Result<bool>
where
    R: AsyncRead + Unpin,
{
    let mut buffer = [0_u8; 16 * 1024];
    let mut total = 0_usize;
    let mut exceeded = false;
    loop {
        let read = stream.read(&mut buffer).await?;
        if read == 0 {
            return Ok(exceeded);
        }
        total = total.saturating_add(read);
        if total > MAX_TOOL_OUTPUT_BYTES && !exceeded {
            exceeded = true;
            let _ = overflow.try_send(());
        }
    }
}

async fn retry_until_reaped<F>(grace: Duration, retry: Duration, mut terminate_and_poll: F) -> bool
where
    F: FnMut() -> bool,
{
    let deadline = tokio::time::Instant::now() + grace;
    let retry = retry.max(Duration::from_millis(1));
    loop {
        if terminate_and_poll() {
            return true;
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return false;
        }
        tokio::time::sleep(retry.min(remaining)).await;
    }
}

async fn terminate_and_reap(child: &mut Child, process_tree: &mut ProcessTree) -> bool {
    retry_until_reaped(PROCESS_REAP_GRACE, PROCESS_REAP_RETRY, || {
        process_tree.terminate();
        let _ = child.start_kill();
        matches!(child.try_wait(), Ok(Some(_)))
    })
    .await
}

async fn terminate_child_and_reap(child: &mut Child) -> bool {
    retry_until_reaped(PROCESS_REAP_GRACE, PROCESS_REAP_RETRY, || {
        let _ = child.start_kill();
        matches!(child.try_wait(), Ok(Some(_)))
    })
    .await
}

async fn abort_and_join_reader<T>(mut task: JoinHandle<T>) -> bool {
    task.abort();
    tokio::time::timeout(OUTPUT_ABORT_GRACE, &mut task)
        .await
        .is_ok()
}

async fn stop_readers<Stdout, Stderr>(
    stdout_task: JoinHandle<Stdout>,
    stderr_task: JoinHandle<Stderr>,
) -> bool {
    let (stdout_stopped, stderr_stopped) = tokio::join!(
        abort_and_join_reader(stdout_task),
        abort_and_join_reader(stderr_task)
    );
    stdout_stopped && stderr_stopped
}

async fn wait_for_readers(
    mut stdout_task: JoinHandle<std::io::Result<bool>>,
    mut stderr_task: JoinHandle<std::io::Result<bool>>,
    job: DesktopToolJob,
    grace: Duration,
) -> VmwResult<bool> {
    let readers = tokio::time::timeout(grace, async {
        let (stdout, stderr) = tokio::join!(&mut stdout_task, &mut stderr_task);
        let stdout = stdout
            .map_err(|_| job_error(job, VmwErrorKind::InternalError, "output handling failed"))?
            .map_err(|_| job_error(job, VmwErrorKind::IoError, "output handling failed"))?;
        let stderr = stderr
            .map_err(|_| job_error(job, VmwErrorKind::InternalError, "output handling failed"))?
            .map_err(|_| job_error(job, VmwErrorKind::IoError, "output handling failed"))?;
        Ok(stdout || stderr)
    })
    .await;
    match readers {
        Ok(result) => result,
        Err(_) if stop_readers(stdout_task, stderr_task).await => Err(job_error(
            job,
            VmwErrorKind::Timeout,
            "output handling timed out",
        )),
        Err(_) => Err(cleanup_error(job)),
    }
}

async fn supervise_tool_process(
    mut command: Command,
    job: DesktopToolJob,
    deadline: Duration,
    mut cancel: oneshot::Receiver<()>,
) -> VmwResult<()> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    process_tree::configure(&mut command);

    let mut child = command.spawn().map_err(|_| {
        job_error(
            job,
            VmwErrorKind::IoError,
            "could not start its VMware executable",
        )
    })?;
    let mut process_tree = match ProcessTree::attach(&child) {
        Ok(process_tree) => process_tree,
        Err(_) => {
            if !terminate_child_and_reap(&mut child).await {
                return Err(cleanup_error(job));
            }
            return Err(job_error(
                job,
                VmwErrorKind::IoError,
                "could not establish process-tree supervision",
            ));
        }
    };
    let Some(stdout) = child.stdout.take() else {
        let reaped = terminate_and_reap(&mut child, &mut process_tree).await;
        return Err(if reaped {
            job_error(
                job,
                VmwErrorKind::InternalError,
                "could not capture bounded output",
            )
        } else {
            cleanup_error(job)
        });
    };
    let Some(stderr) = child.stderr.take() else {
        let reaped = terminate_and_reap(&mut child, &mut process_tree).await;
        return Err(if reaped {
            job_error(
                job,
                VmwErrorKind::InternalError,
                "could not capture bounded output",
            )
        } else {
            cleanup_error(job)
        });
    };

    let (overflow_tx, mut overflow_rx) = mpsc::channel(1);
    let stdout_task = tokio::spawn(drain_output_bounded(stdout, overflow_tx.clone()));
    let stderr_task = tokio::spawn(drain_output_bounded(stderr, overflow_tx.clone()));
    drop(overflow_tx);

    let status = tokio::select! {
        biased;
        Some(()) = overflow_rx.recv() => {
            let reaped = terminate_and_reap(&mut child, &mut process_tree).await;
            let readers_stopped = stop_readers(stdout_task, stderr_task).await;
            if !reaped || !readers_stopped {
                return Err(cleanup_error(job));
            }
            return Err(job_error(job, VmwErrorKind::CommandFailed, "produced excessive output and was stopped"));
        }
        _ = &mut cancel => {
            let reaped = terminate_and_reap(&mut child, &mut process_tree).await;
            let readers_stopped = stop_readers(stdout_task, stderr_task).await;
            if !reaped || !readers_stopped {
                return Err(cleanup_error(job));
            }
            return Err(job_error(job, VmwErrorKind::CommandFailed, "was cancelled"));
        }
        _ = tokio::time::sleep(deadline) => {
            let reaped = terminate_and_reap(&mut child, &mut process_tree).await;
            let readers_stopped = stop_readers(stdout_task, stderr_task).await;
            if !reaped || !readers_stopped {
                return Err(cleanup_error(job));
            }
            return Err(job_error(job, VmwErrorKind::Timeout, "exceeded its safety deadline and was stopped"));
        }
        status = child.wait() => match status {
            Ok(status) => status,
            Err(_) => {
                let reaped = terminate_and_reap(&mut child, &mut process_tree).await;
                let readers_stopped = stop_readers(stdout_task, stderr_task).await;
                if !reaped || !readers_stopped {
                    return Err(cleanup_error(job));
                }
                return Err(job_error(job, VmwErrorKind::IoError, "could not determine completion status"));
            }
        },
    };

    process_tree.terminate();
    if wait_for_readers(stdout_task, stderr_task, job, OUTPUT_DRAIN_GRACE).await? {
        return Err(job_error(
            job,
            VmwErrorKind::CommandFailed,
            "produced excessive output and was stopped",
        ));
    }
    if !status.success() {
        return Err(job_error(
            job,
            VmwErrorKind::CommandFailed,
            "failed; consult the local VMware tool logs for details",
        ));
    }
    Ok(())
}

async fn run_supervised_tool(
    command: Command,
    job: DesktopToolJob,
    deadline: Duration,
) -> VmwResult<()> {
    let permit = TOOL_JOB_LIMIT.acquire().await.map_err(|_| {
        job_error(
            job,
            VmwErrorKind::InternalError,
            "could not acquire an execution slot",
        )
    })?;
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let mut cancel_on_drop = CancelJobOnDrop(Some(cancel_tx));
    let worker = tokio::spawn(async move {
        let _permit = permit;
        supervise_tool_process(command, job, deadline, cancel_rx).await
    });
    let result = worker.await;
    cancel_on_drop.disarm();
    result.map_err(|_| {
        job_error(
            job,
            VmwErrorKind::InternalError,
            "execution supervision failed",
        )
    })?
}

struct CapturedVmRunStream {
    bytes: Vec<u8>,
    exceeded: bool,
}

async fn capture_vmrun_output_bounded<R>(
    mut stream: R,
    overflow: mpsc::Sender<()>,
) -> std::io::Result<CapturedVmRunStream>
where
    R: AsyncRead + Unpin,
{
    let mut buffer = [0_u8; 16 * 1024];
    let mut bytes = Vec::new();
    let mut total = 0_usize;
    let mut exceeded = false;
    loop {
        let read = stream.read(&mut buffer).await?;
        if read == 0 {
            return Ok(CapturedVmRunStream { bytes, exceeded });
        }
        let remaining = MAX_TOOL_OUTPUT_BYTES.saturating_sub(bytes.len());
        bytes.extend_from_slice(&buffer[..read.min(remaining)]);
        total = total.saturating_add(read);
        if total > MAX_TOOL_OUTPUT_BYTES && !exceeded {
            exceeded = true;
            let _ = overflow.try_send(());
        }
    }
}

async fn supervise_vmrun_process(
    mut command: Command,
    deadline: Duration,
    mut cancel: oneshot::Receiver<()>,
) -> VmwResult<String> {
    let job = DesktopToolJob::VmRun;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    process_tree::configure(&mut command);

    let mut child = command.spawn().map_err(|_| {
        job_error(
            job,
            VmwErrorKind::IoError,
            "could not start its trusted executable",
        )
    })?;
    let mut process_tree = match ProcessTree::attach(&child) {
        Ok(process_tree) => process_tree,
        Err(_) => {
            if !terminate_child_and_reap(&mut child).await {
                return Err(cleanup_error(job));
            }
            return Err(job_error(
                job,
                VmwErrorKind::IoError,
                "could not establish process-tree supervision",
            ));
        }
    };
    let stdout = child.stdout.take().ok_or_else(|| {
        job_error(
            job,
            VmwErrorKind::InternalError,
            "could not capture bounded output",
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        job_error(
            job,
            VmwErrorKind::InternalError,
            "could not capture bounded output",
        )
    })?;

    let (overflow_tx, mut overflow_rx) = mpsc::channel(1);
    let mut stdout_task = tokio::spawn(capture_vmrun_output_bounded(stdout, overflow_tx.clone()));
    let mut stderr_task = tokio::spawn(capture_vmrun_output_bounded(stderr, overflow_tx.clone()));
    drop(overflow_tx);

    let status = tokio::select! {
        biased;
        Some(()) = overflow_rx.recv() => {
            let reaped = terminate_and_reap(&mut child, &mut process_tree).await;
            let readers_stopped = stop_readers(stdout_task, stderr_task).await;
            if !reaped || !readers_stopped {
                return Err(cleanup_error(job));
            }
            return Err(job_error(job, VmwErrorKind::CommandFailed, "produced excessive output and was stopped"));
        }
        _ = &mut cancel => {
            let reaped = terminate_and_reap(&mut child, &mut process_tree).await;
            let readers_stopped = stop_readers(stdout_task, stderr_task).await;
            if !reaped || !readers_stopped {
                return Err(cleanup_error(job));
            }
            return Err(job_error(job, VmwErrorKind::CommandFailed, "was cancelled"));
        }
        _ = tokio::time::sleep(deadline) => {
            let reaped = terminate_and_reap(&mut child, &mut process_tree).await;
            let readers_stopped = stop_readers(stdout_task, stderr_task).await;
            if !reaped || !readers_stopped {
                return Err(cleanup_error(job));
            }
            return Err(job_error(job, VmwErrorKind::Timeout, "exceeded its safety deadline and was stopped"));
        }
        status = child.wait() => match status {
            Ok(status) => status,
            Err(_) => {
                let reaped = terminate_and_reap(&mut child, &mut process_tree).await;
                let readers_stopped = stop_readers(stdout_task, stderr_task).await;
                if !reaped || !readers_stopped {
                    return Err(cleanup_error(job));
                }
                return Err(job_error(job, VmwErrorKind::IoError, "could not determine completion status"));
            }
        },
    };

    process_tree.terminate();
    let readers = tokio::time::timeout(OUTPUT_DRAIN_GRACE, async {
        let stdout = (&mut stdout_task)
            .await
            .map_err(|_| job_error(job, VmwErrorKind::InternalError, "output handling failed"))?
            .map_err(|_| job_error(job, VmwErrorKind::IoError, "output handling failed"))?;
        let stderr = (&mut stderr_task)
            .await
            .map_err(|_| job_error(job, VmwErrorKind::InternalError, "output handling failed"))?
            .map_err(|_| job_error(job, VmwErrorKind::IoError, "output handling failed"))?;
        Ok::<_, VmwError>((stdout, stderr))
    })
    .await;
    let (stdout, stderr) = match readers {
        Ok(result) => result?,
        Err(_) => {
            return Err(if stop_readers(stdout_task, stderr_task).await {
                job_error(job, VmwErrorKind::Timeout, "output handling timed out")
            } else {
                cleanup_error(job)
            });
        }
    };
    if stdout.exceeded || stderr.exceeded {
        return Err(job_error(
            job,
            VmwErrorKind::CommandFailed,
            "produced excessive output and was stopped",
        ));
    }
    if !status.success() {
        return Err(job_error(
            job,
            VmwErrorKind::CommandFailed,
            "failed; consult the local VMware tool logs for details",
        ));
    }
    Ok(String::from_utf8_lossy(&stdout.bytes).into_owned())
}

async fn run_supervised_vmrun(command: Command, deadline: Duration) -> VmwResult<String> {
    let job = DesktopToolJob::VmRun;
    let permit = TOOL_JOB_LIMIT.acquire().await.map_err(|_| {
        job_error(
            job,
            VmwErrorKind::InternalError,
            "could not acquire an execution slot",
        )
    })?;
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let mut cancel_on_drop = CancelJobOnDrop(Some(cancel_tx));
    let worker = tokio::spawn(async move {
        let _permit = permit;
        supervise_vmrun_process(command, deadline, cancel_rx).await
    });
    let result = worker.await;
    cancel_on_drop.disarm();
    result.map_err(|_| {
        job_error(
            job,
            VmwErrorKind::InternalError,
            "execution supervision failed",
        )
    })?
}

async fn run_desktop_tool(executable: &Path, args: &[&str], job: DesktopToolJob) -> VmwResult<()> {
    let mut command = Command::new(executable);
    command.args(args);
    run_supervised_tool(command, job, job.deadline()).await
}

/// Wraps the vmrun executable and provides typed access to its commands.
#[derive(Debug, Clone)]
pub struct VmRun {
    /// Absolute path to the vmrun binary.
    pub path: PathBuf,
    /// Host type flag: either "-T ws" (Workstation / Player) or "-T fusion".
    pub host_type: String,
    /// Default timeout for commands (seconds).
    pub timeout_secs: u64,
}

impl VmRun {
    // ── Construction ─────────────────────────────────────────────────────

    /// Try to auto-detect vmrun on the current platform.
    pub fn detect() -> VmwResult<Self> {
        let path = Self::find_vmrun()?;
        let host_type = if cfg!(target_os = "macos") {
            "fusion".to_string()
        } else {
            "ws".to_string()
        };
        Ok(Self {
            path,
            host_type,
            timeout_secs: 60,
        })
    }

    /// Create with an explicit path.
    pub fn new(path: impl Into<PathBuf>, host_type: impl Into<String>, timeout: u64) -> Self {
        Self {
            path: path.into(),
            host_type: host_type.into(),
            timeout_secs: timeout,
        }
    }

    fn find_vmrun() -> VmwResult<PathBuf> {
        // Common locations
        let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
            vec![
                PathBuf::from(r"C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe"),
                PathBuf::from(r"C:\Program Files\VMware\VMware Workstation\vmrun.exe"),
                PathBuf::from(r"C:\Program Files (x86)\VMware\VMware Player\vmrun.exe"),
                PathBuf::from(r"C:\Program Files\VMware\VMware Player\vmrun.exe"),
            ]
        } else if cfg!(target_os = "macos") {
            vec![
                PathBuf::from("/Applications/VMware Fusion.app/Contents/Library/vmrun"),
                PathBuf::from("/Applications/VMware Fusion.app/Contents/Public/vmrun"),
            ]
        } else {
            vec![
                PathBuf::from("/usr/bin/vmrun"),
                PathBuf::from("/usr/local/bin/vmrun"),
            ]
        };

        for p in &candidates {
            if p.exists() {
                return Ok(p.clone());
            }
        }
        Err(VmwError::vmrun_not_found())
    }

    // ── Internal helpers ─────────────────────────────────────────────────

    fn trusted_vmrun_path(&self) -> VmwResult<PathBuf> {
        let expected_name = if cfg!(target_os = "windows") {
            "vmrun.exe"
        } else {
            "vmrun"
        };
        validate_trusted_tool(&self.path, expected_name, DesktopToolJob::VmRun)
    }

    fn command(&self, args: &[&str]) -> VmwResult<Command> {
        if !matches!(self.host_type.as_str(), "ws" | "fusion") {
            return Err(VmwError::new(
                VmwErrorKind::InvalidConfig,
                "unsupported VMware desktop host type",
            ));
        }
        let executable = self.trusted_vmrun_path()?;
        let mut command = Command::new(executable);
        command.arg("-T").arg(&self.host_type).args(args);
        Ok(command)
    }

    fn reject_argv_guest_auth<T>(&self, _user: &str, _pass: &str) -> VmwResult<T> {
        Err(VmwError::new(
            VmwErrorKind::InvalidConfig,
            "VMware guest operations are disabled because vmrun only accepts guest passwords on the process command line",
        ))
    }

    async fn run(&self, args: &[&str]) -> VmwResult<String> {
        let command = self.command(args)?;
        run_supervised_vmrun(command, Duration::from_secs(self.timeout_secs)).await
    }

    async fn run_long(&self, args: &[&str], timeout_secs: u64) -> VmwResult<String> {
        let command = self.command(args)?;
        run_supervised_vmrun(command, Duration::from_secs(timeout_secs)).await
    }

    // ── VM Lifecycle ─────────────────────────────────────────────────────

    /// List absolute paths of all running VMs.
    pub async fn list(&self) -> VmwResult<Vec<String>> {
        let out = self.run(&["list"]).await?;
        let mut vms = Vec::new();
        for line in out.lines().skip(1) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                vms.push(trimmed.to_string());
            }
        }
        Ok(vms)
    }

    /// Power on a VM.
    pub async fn start(&self, vmx: &str, gui: bool) -> VmwResult<()> {
        let mode = if gui { "gui" } else { "nogui" };
        self.run(&["start", vmx, mode]).await?;
        Ok(())
    }

    /// Power off a VM (hard).
    pub async fn stop(&self, vmx: &str, hard: bool) -> VmwResult<()> {
        let mode = if hard { "hard" } else { "soft" };
        self.run(&["stop", vmx, mode]).await?;
        Ok(())
    }

    /// Reset a VM.
    pub async fn reset(&self, vmx: &str, hard: bool) -> VmwResult<()> {
        let mode = if hard { "hard" } else { "soft" };
        self.run(&["reset", vmx, mode]).await?;
        Ok(())
    }

    /// Suspend a VM.
    pub async fn suspend(&self, vmx: &str, hard: bool) -> VmwResult<()> {
        let mode = if hard { "hard" } else { "soft" };
        self.run(&["suspend", vmx, mode]).await?;
        Ok(())
    }

    /// Pause a VM.
    pub async fn pause(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["pause", vmx]).await?;
        Ok(())
    }

    /// Unpause a VM.
    pub async fn unpause(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["unpause", vmx]).await?;
        Ok(())
    }

    /// Delete a VM (deletes all files).
    pub async fn delete_vm(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["deleteVM", vmx]).await?;
        Ok(())
    }

    // ── Snapshots ────────────────────────────────────────────────────────

    /// List snapshots for a VM.
    pub async fn list_snapshots(&self, vmx: &str) -> VmwResult<Vec<String>> {
        let out = self.run(&["listSnapshots", vmx]).await?;
        let mut snaps = Vec::new();
        for line in out.lines().skip(1) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                snaps.push(trimmed.to_string());
            }
        }
        Ok(snaps)
    }

    /// Create a snapshot.
    pub async fn snapshot(&self, vmx: &str, name: &str) -> VmwResult<()> {
        self.run(&["snapshot", vmx, name]).await?;
        Ok(())
    }

    /// Revert to a snapshot.
    pub async fn revert_to_snapshot(&self, vmx: &str, name: &str) -> VmwResult<()> {
        self.run(&["revertToSnapshot", vmx, name]).await?;
        Ok(())
    }

    /// Delete a snapshot.
    pub async fn delete_snapshot(
        &self,
        vmx: &str,
        name: &str,
        and_children: bool,
    ) -> VmwResult<()> {
        if and_children {
            self.run(&["deleteSnapshot", vmx, name, "andDeleteChildren"])
                .await?;
        } else {
            self.run(&["deleteSnapshot", vmx, name]).await?;
        }
        Ok(())
    }

    // ── Cloning ──────────────────────────────────────────────────────────

    /// Clone a VM (Workstation Pro / Fusion Pro only).
    pub async fn clone_vm(
        &self,
        source_vmx: &str,
        dest_vmx: &str,
        clone_type: &str,
        snapshot_name: Option<&str>,
    ) -> VmwResult<()> {
        let ct = match clone_type {
            "linked" => "linked",
            _ => "full",
        };
        let mut args: Vec<&str> = vec!["clone", source_vmx, dest_vmx, ct];
        if let Some(snap) = snapshot_name {
            args.push("-snapshot");
            args.push(snap);
        }
        self.run_long(&args, 600).await?;
        Ok(())
    }

    // ── Guest Operations ─────────────────────────────────────────────────

    /// Run a program in the guest.
    #[allow(clippy::too_many_arguments)]
    pub async fn run_program_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        program: &str,
        args_str: Option<&str>,
        no_wait: bool,
        interactive: bool,
    ) -> VmwResult<String> {
        let _ = (vmx, program, args_str, no_wait, interactive);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Run a script in the guest (bash, cmd, powershell, etc.).
    pub async fn run_script_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        interpreter: &str,
        script_text: &str,
        no_wait: bool,
    ) -> VmwResult<String> {
        let _ = (vmx, interpreter, script_text, no_wait);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Copy a file from host to guest.
    pub async fn copy_file_from_host_to_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        host_path: &str,
        guest_path: &str,
    ) -> VmwResult<()> {
        let _ = (vmx, host_path, guest_path);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Copy a file from guest to host.
    pub async fn copy_file_from_guest_to_host(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        guest_path: &str,
        host_path: &str,
    ) -> VmwResult<()> {
        let _ = (vmx, guest_path, host_path);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Create a directory in the guest.
    pub async fn create_directory_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        dir_path: &str,
    ) -> VmwResult<()> {
        let _ = (vmx, dir_path);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Delete a directory in the guest.
    pub async fn delete_directory_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        dir_path: &str,
    ) -> VmwResult<()> {
        let _ = (vmx, dir_path);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Delete a file in the guest.
    pub async fn delete_file_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        file_path: &str,
    ) -> VmwResult<()> {
        let _ = (vmx, file_path);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Check if a file exists in the guest.
    pub async fn file_exists_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        file_path: &str,
    ) -> VmwResult<bool> {
        let _ = (vmx, file_path);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Check if a directory exists in the guest.
    pub async fn directory_exists_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        dir_path: &str,
    ) -> VmwResult<bool> {
        let _ = (vmx, dir_path);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Rename a file in the guest.
    pub async fn rename_file_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        old_name: &str,
        new_name: &str,
    ) -> VmwResult<()> {
        let _ = (vmx, old_name, new_name);
        self.reject_argv_guest_auth(user, pass)
    }

    /// List directory contents in the guest.
    pub async fn list_directory_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        dir_path: &str,
    ) -> VmwResult<Vec<String>> {
        let _ = (vmx, dir_path);
        self.reject_argv_guest_auth(user, pass)
    }

    /// List running processes in the guest.
    pub async fn list_processes_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
    ) -> VmwResult<String> {
        let _ = vmx;
        self.reject_argv_guest_auth(user, pass)
    }

    /// Kill a guest process by PID.
    pub async fn kill_process_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        pid: u64,
    ) -> VmwResult<()> {
        let _ = (vmx, pid);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Read an environment variable in the guest.
    pub async fn read_variable(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        var_type: &str,
        name: &str,
    ) -> VmwResult<String> {
        let _ = (vmx, var_type, name);
        self.reject_argv_guest_auth(user, pass)
    }

    /// Write a variable to the VMX runtime or guest environment.
    pub async fn write_variable(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        var_type: &str,
        name: &str,
        value: &str,
    ) -> VmwResult<()> {
        let _ = (vmx, var_type, name, value);
        self.reject_argv_guest_auth(user, pass)
    }

    // ── Shared Folders ───────────────────────────────────────────────────

    /// Enable shared folders for a VM.
    pub async fn enable_shared_folders(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["enableSharedFolders", vmx]).await?;
        Ok(())
    }

    /// Disable shared folders for a VM.
    pub async fn disable_shared_folders(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["disableSharedFolders", vmx]).await?;
        Ok(())
    }

    /// Add a shared folder.
    pub async fn add_shared_folder(
        &self,
        vmx: &str,
        share_name: &str,
        host_path: &str,
    ) -> VmwResult<()> {
        self.run(&["addSharedFolder", vmx, share_name, host_path])
            .await?;
        Ok(())
    }

    /// Remove a shared folder.
    pub async fn remove_shared_folder(&self, vmx: &str, share_name: &str) -> VmwResult<()> {
        self.run(&["removeSharedFolder", vmx, share_name]).await?;
        Ok(())
    }

    /// Set shared folder writable/read-only.
    pub async fn set_shared_folder_state(
        &self,
        vmx: &str,
        share_name: &str,
        host_path: &str,
        writable: bool,
    ) -> VmwResult<()> {
        let perm = if writable { "writable" } else { "readonly" };
        self.run(&["setSharedFolderState", vmx, share_name, host_path, perm])
            .await?;
        Ok(())
    }

    // ── Network Adapters ─────────────────────────────────────────────────

    /// List virtual network adapters for a VM (Workstation only).
    pub async fn list_network_adapters(&self, vmx: &str) -> VmwResult<String> {
        self.run(&["listNetworkAdapters", vmx]).await
    }

    // ── VMware Tools & IP ────────────────────────────────────────────────

    /// Get the IP address of the guest.
    pub async fn get_guest_ip_address(&self, vmx: &str, wait: bool) -> VmwResult<String> {
        let mut args: Vec<&str> = vec!["getGuestIPAddress", vmx];
        if wait {
            args.push("-wait");
        }
        let out = self.run(&args).await?;
        Ok(out.trim().to_string())
    }

    /// Check if VMware Tools is running in the guest.
    pub async fn check_tools_state(&self, vmx: &str) -> VmwResult<String> {
        let out = self.run(&["checkToolsState", vmx]).await?;
        Ok(out.trim().to_string())
    }

    /// Install VMware Tools in the guest.
    pub async fn install_tools(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["installTools", vmx]).await?;
        Ok(())
    }

    // ── OVF / OVA ────────────────────────────────────────────────────────

    /// Import an OVF/OVA (via ovftool if available alongside vmrun).
    pub async fn import_ovf(&self, source: &str, dest_vmx: &str) -> VmwResult<()> {
        validate_path_argument(source, "OVF source")?;
        validate_path_argument(dest_vmx, "OVF destination")?;
        // vmrun does not have import; we look for ovftool next to vmrun
        let ovftool = self.find_ovftool(DesktopToolJob::OvfImport)?;
        run_desktop_tool(&ovftool, &[source, dest_vmx], DesktopToolJob::OvfImport).await
    }

    /// Export a VM to OVF/OVA.
    pub async fn export_ovf(&self, vmx: &str, dest: &str) -> VmwResult<()> {
        validate_path_argument(vmx, "VMX source")?;
        validate_path_argument(dest, "OVF destination")?;
        let ovftool = self.find_ovftool(DesktopToolJob::OvfExport)?;
        run_desktop_tool(&ovftool, &[vmx, dest], DesktopToolJob::OvfExport).await
    }

    fn find_ovftool(&self, job: DesktopToolJob) -> VmwResult<PathBuf> {
        let dir = self.path.parent().unwrap_or(Path::new(""));
        let candidates = if cfg!(target_os = "windows") {
            vec![
                dir.join("ovftool").join("ovftool.exe"),
                dir.join("OVFTool").join("ovftool.exe"),
                PathBuf::from(r"C:\Program Files\VMware\VMware OVF Tool\ovftool.exe"),
            ]
        } else if cfg!(target_os = "macos") {
            vec![
                dir.join("ovftool"),
                dir.parent()
                    .unwrap_or(Path::new(""))
                    .join("OVFTool")
                    .join("ovftool"),
            ]
        } else {
            vec![
                PathBuf::from("/usr/bin/ovftool"),
                PathBuf::from("/usr/local/bin/ovftool"),
            ]
        };
        for c in &candidates {
            if c.exists() {
                let expected_name = if cfg!(target_os = "windows") {
                    "ovftool.exe"
                } else {
                    "ovftool"
                };
                return validate_trusted_tool(c, expected_name, job);
            }
        }
        Err(job_error(
            job,
            VmwErrorKind::VmRunNotFound,
            "could not locate the ovftool executable",
        ))
    }

    // ── VMDK ─────────────────────────────────────────────────────────────

    /// Create a virtual disk using vmware-vdiskmanager (ships with WS/Fusion).
    pub async fn create_disk(
        &self,
        path: &str,
        size_mb: u64,
        disk_type: Option<&str>,
        adapter_type: Option<&str>,
    ) -> VmwResult<()> {
        validate_path_argument(path, "VMDK destination")?;
        if size_mb == 0 || size_mb > MAX_VMDK_SIZE_MB {
            return Err(VmwError::new(
                VmwErrorKind::InvalidConfig,
                "VMDK size is outside the supported safety range",
            ));
        }
        let job = DesktopToolJob::VmdkCreate;
        let vdm = self.find_vdiskmanager(job)?;
        let size_str = format!("{}MB", size_mb);
        let mut args = vec!["-c", "-s", size_str.as_str()];
        if let Some(dt) = disk_type {
            args.extend_from_slice(&["-t", validate_disk_type(dt)?]);
        }
        if let Some(at) = adapter_type {
            validate_adapter_type(at)?;
            args.extend_from_slice(&["-a", at]);
        }
        args.push(path);
        run_desktop_tool(&vdm, &args, job).await
    }

    /// Defragment a virtual disk.
    pub async fn defragment_disk(&self, vmdk_path: &str) -> VmwResult<()> {
        validate_path_argument(vmdk_path, "VMDK path")?;
        let job = DesktopToolJob::VmdkDefragment;
        let vdm = self.find_vdiskmanager(job)?;
        run_desktop_tool(&vdm, &["-d", vmdk_path], job).await
    }

    /// Shrink a virtual disk.
    pub async fn shrink_disk(&self, vmdk_path: &str) -> VmwResult<()> {
        validate_path_argument(vmdk_path, "VMDK path")?;
        let job = DesktopToolJob::VmdkShrink;
        let vdm = self.find_vdiskmanager(job)?;
        run_desktop_tool(&vdm, &["-k", vmdk_path], job).await
    }

    /// Expand a virtual disk.
    pub async fn expand_disk(&self, vmdk_path: &str, new_size_mb: u64) -> VmwResult<()> {
        validate_path_argument(vmdk_path, "VMDK path")?;
        if new_size_mb == 0 || new_size_mb > MAX_VMDK_SIZE_MB {
            return Err(VmwError::new(
                VmwErrorKind::InvalidConfig,
                "expanded VMDK size is outside the supported safety range",
            ));
        }
        let job = DesktopToolJob::VmdkExpand;
        let vdm = self.find_vdiskmanager(job)?;
        let size_str = format!("{}MB", new_size_mb);
        run_desktop_tool(&vdm, &["-x", &size_str, vmdk_path], job).await
    }

    /// Convert a virtual disk type.
    pub async fn convert_disk(&self, source: &str, dest: &str, disk_type: &str) -> VmwResult<()> {
        validate_path_argument(source, "source VMDK path")?;
        validate_path_argument(dest, "destination VMDK path")?;
        if source == dest {
            return Err(VmwError::new(
                VmwErrorKind::InvalidConfig,
                "source and destination VMDK paths must differ",
            ));
        }
        let job = DesktopToolJob::VmdkConvert;
        let vdm = self.find_vdiskmanager(job)?;
        let disk_type = validate_disk_type(disk_type)?;
        run_desktop_tool(&vdm, &["-r", source, "-t", disk_type, dest], job).await
    }

    /// Rename a VMDK.
    pub async fn rename_disk(&self, source: &str, dest: &str) -> VmwResult<()> {
        validate_path_argument(source, "source VMDK path")?;
        validate_path_argument(dest, "destination VMDK path")?;
        if source == dest {
            return Err(VmwError::new(
                VmwErrorKind::InvalidConfig,
                "source and destination VMDK paths must differ",
            ));
        }
        let job = DesktopToolJob::VmdkRename;
        let vdm = self.find_vdiskmanager(job)?;
        run_desktop_tool(&vdm, &["-n", source, dest], job).await
    }

    fn find_vdiskmanager(&self, job: DesktopToolJob) -> VmwResult<PathBuf> {
        let dir = self.path.parent().unwrap_or(Path::new(""));
        let name = if cfg!(target_os = "windows") {
            "vmware-vdiskmanager.exe"
        } else {
            "vmware-vdiskmanager"
        };
        let candidate = dir.join(name);
        if candidate.exists() {
            return validate_trusted_tool(&candidate, name, job);
        }
        Err(job_error(
            job,
            VmwErrorKind::VmRunNotFound,
            "could not locate the vmware-vdiskmanager executable",
        ))
    }
}

#[cfg(test)]
mod supervised_tool_tests {
    use super::*;
    use std::{
        fs,
        future::pending,
        io::Write,
        sync::{
            atomic::{AtomicBool, AtomicU64, Ordering},
            Arc,
        },
        time::Instant,
    };

    const FAKE_MODE: &str = "SORNG_VMWARE_FAKE_HELPER_MODE";
    const FAKE_PID_FILE: &str = "SORNG_VMWARE_FAKE_HELPER_PID_FILE";
    const FAKE_MARKER_FILE: &str = "SORNG_VMWARE_FAKE_HELPER_MARKER_FILE";
    const FAKE_CHILD_STARTED_FILE: &str = "SORNG_VMWARE_FAKE_CHILD_STARTED_FILE";
    const FAKE_CHILD_MARKER_FILE: &str = "SORNG_VMWARE_FAKE_CHILD_MARKER_FILE";
    const FAKE_SECRET: &str = "SORNG_VMWARE_FAKE_HELPER_SECRET";
    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    fn unique_test_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sorng-vmware-{label}-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn fake_command(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().expect("test executable"));
        command
            .arg("--exact")
            .arg("vmrun::supervised_tool_tests::fake_helper_entry")
            .arg("--nocapture")
            .env(FAKE_MODE, mode);
        command
    }

    async fn wait_for_file(path: &Path) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !path.exists() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(path.exists(), "fake helper did not start");
    }

    #[test]
    fn fake_helper_entry() {
        let Ok(mode) = std::env::var(FAKE_MODE) else {
            return;
        };
        match mode.as_str() {
            "sleep" => {
                let pid_file = std::env::var_os(FAKE_PID_FILE).expect("pid file");
                let marker_file = std::env::var_os(FAKE_MARKER_FILE).expect("marker file");
                fs::write(pid_file, std::process::id().to_string()).expect("write pid");
                std::thread::sleep(Duration::from_secs(10));
                fs::write(marker_file, b"completed").expect("write completion marker");
            }
            "overflow" => {
                let output = vec![b'X'; MAX_TOOL_OUTPUT_BYTES + 64 * 1024];
                let stderr_output = output.clone();
                let stdout = std::thread::spawn(move || {
                    std::io::stdout().write_all(&output).expect("write stdout");
                });
                let stderr = std::thread::spawn(move || {
                    std::io::stderr()
                        .write_all(&stderr_output)
                        .expect("write stderr");
                });
                stdout.join().expect("stdout writer");
                stderr.join().expect("stderr writer");
            }
            "spawn-child" => {
                let child_started = std::env::var_os(FAKE_CHILD_STARTED_FILE).expect("child start");
                let child_marker = std::env::var_os(FAKE_CHILD_MARKER_FILE).expect("child marker");
                let mut child =
                    std::process::Command::new(std::env::current_exe().expect("test executable"))
                        .arg("--exact")
                        .arg("vmrun::supervised_tool_tests::fake_helper_entry")
                        .arg("--nocapture")
                        .env(FAKE_MODE, "child-sleep")
                        .env(FAKE_CHILD_STARTED_FILE, child_started)
                        .env(FAKE_CHILD_MARKER_FILE, child_marker)
                        .spawn()
                        .expect("spawn child helper");
                let _ = child.wait();
            }
            "retain-pipes" => {
                let child_started = std::env::var_os(FAKE_CHILD_STARTED_FILE).expect("child start");
                let child_marker = std::env::var_os(FAKE_CHILD_MARKER_FILE).expect("child marker");
                let child =
                    std::process::Command::new(std::env::current_exe().expect("test executable"))
                        .arg("--exact")
                        .arg("vmrun::supervised_tool_tests::fake_helper_entry")
                        .arg("--nocapture")
                        .env(FAKE_MODE, "child-sleep")
                        .env(FAKE_CHILD_STARTED_FILE, &child_started)
                        .env(FAKE_CHILD_MARKER_FILE, child_marker)
                        .spawn()
                        .expect("spawn pipe-retaining child helper");
                let start_deadline = Instant::now() + Duration::from_secs(5);
                while !Path::new(&child_started).exists() && Instant::now() < start_deadline {
                    std::thread::sleep(Duration::from_millis(20));
                }
                assert!(
                    Path::new(&child_started).exists(),
                    "pipe-retaining child did not start"
                );
                drop(child);
            }
            "child-sleep" => {
                let child_started = std::env::var_os(FAKE_CHILD_STARTED_FILE).expect("child start");
                let child_marker = std::env::var_os(FAKE_CHILD_MARKER_FILE).expect("child marker");
                fs::write(child_started, b"started").expect("write child start");
                std::thread::sleep(Duration::from_millis(1_500));
                fs::write(child_marker, b"completed").expect("write child marker");
            }
            "failure" => {
                let secret = std::env::var(FAKE_SECRET).expect("secret");
                eprintln!("authentication failed for {secret} at C:\\sensitive\\private.vmdk");
                std::process::exit(17);
            }
            _ => std::process::exit(18),
        }
    }

    #[tokio::test]
    async fn timeout_terminates_and_reaps_fake_helper() {
        let pid_file = unique_test_path("timeout-pid");
        let marker_file = unique_test_path("timeout-marker");
        let mut command = fake_command("sleep");
        command
            .env(FAKE_PID_FILE, &pid_file)
            .env(FAKE_MARKER_FILE, &marker_file);

        let result =
            run_supervised_tool(command, DesktopToolJob::VmdkRename, Duration::from_secs(2)).await;

        assert!(matches!(
            result,
            Err(VmwError {
                kind: VmwErrorKind::Timeout,
                ..
            })
        ));
        assert!(pid_file.exists(), "fake helper did not publish its pid");
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert!(!marker_file.exists(), "timed-out helper was not terminated");
        let _ = fs::remove_file(pid_file);
    }

    #[tokio::test]
    async fn output_cap_stops_noisy_fake_helper() {
        let result = run_supervised_tool(
            fake_command("overflow"),
            DesktopToolJob::VmdkConvert,
            Duration::from_secs(10),
        )
        .await
        .expect_err("excessive helper output must fail closed");
        assert!(matches!(result.kind, VmwErrorKind::CommandFailed));
        assert!(result.message.contains("excessive output"));
    }

    #[tokio::test]
    async fn legacy_runner_caps_output() {
        let result = run_supervised_vmrun(fake_command("overflow"), Duration::from_secs(10))
            .await
            .expect_err("legacy vmrun output must be capped");
        assert!(matches!(result.kind, VmwErrorKind::CommandFailed));
        assert!(result.message.contains("excessive output"));
    }

    #[tokio::test]
    async fn legacy_timeout_reaps_the_entire_process_tree() {
        let child_started = unique_test_path("legacy-child-started");
        let child_marker = unique_test_path("legacy-child-marker");
        let mut command = fake_command("spawn-child");
        command
            .env(FAKE_CHILD_STARTED_FILE, &child_started)
            .env(FAKE_CHILD_MARKER_FILE, &child_marker);

        let result = run_supervised_vmrun(command, Duration::from_millis(500))
            .await
            .expect_err("legacy vmrun process tree must time out");
        assert!(matches!(result.kind, VmwErrorKind::Timeout));
        assert!(child_started.exists(), "descendant helper did not start");
        tokio::time::sleep(Duration::from_millis(1_500)).await;
        assert!(
            !child_marker.exists(),
            "timed-out descendant helper was not terminated"
        );
        let _ = fs::remove_file(child_started);
    }

    #[tokio::test]
    async fn retained_pipe_descendant_is_terminated_before_reader_grace_expires() {
        let child_started = unique_test_path("retained-pipe-started");
        let child_marker = unique_test_path("retained-pipe-marker");
        let mut command = fake_command("retain-pipes");
        command
            .env(FAKE_CHILD_STARTED_FILE, &child_started)
            .env(FAKE_CHILD_MARKER_FILE, &child_marker);

        run_supervised_tool(command, DesktopToolJob::VmdkRename, Duration::from_secs(10))
            .await
            .expect("process-tree shutdown must close descendant-retained pipes");
        assert!(child_started.exists(), "pipe-retaining child did not start");
        tokio::time::sleep(Duration::from_millis(1_500)).await;
        assert!(
            !child_marker.exists(),
            "pipe-retaining descendant was not terminated"
        );
        let _ = fs::remove_file(child_started);
    }

    struct ReaderDropSignal(Arc<AtomicBool>);

    impl Drop for ReaderDropSignal {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn reader_grace_timeout_aborts_and_joins_both_tasks() {
        let stdout_dropped = Arc::new(AtomicBool::new(false));
        let stderr_dropped = Arc::new(AtomicBool::new(false));
        let stdout_signal = Arc::clone(&stdout_dropped);
        let stderr_signal = Arc::clone(&stderr_dropped);
        let stdout_task = tokio::spawn(async move {
            let _drop_signal = ReaderDropSignal(stdout_signal);
            pending::<()>().await;
            Ok(false)
        });
        let stderr_task = tokio::spawn(async move {
            let _drop_signal = ReaderDropSignal(stderr_signal);
            pending::<()>().await;
            Ok(false)
        });
        let started = Instant::now();

        let result = wait_for_readers(
            stdout_task,
            stderr_task,
            DesktopToolJob::VmdkRename,
            Duration::from_millis(50),
        )
        .await;

        assert!(matches!(
            result,
            Err(VmwError {
                kind: VmwErrorKind::Timeout,
                ..
            })
        ));
        assert!(stdout_dropped.load(Ordering::SeqCst));
        assert!(stderr_dropped.load(Ordering::SeqCst));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn reap_timeout_retries_and_is_hard_bounded() {
        let attempts = AtomicU64::new(0);
        let started = Instant::now();
        let reaped =
            retry_until_reaped(Duration::from_millis(60), Duration::from_millis(10), || {
                attempts.fetch_add(1, Ordering::SeqCst);
                false
            })
            .await;

        assert!(!reaped);
        assert!(attempts.load(Ordering::SeqCst) >= 2);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn guest_password_never_reaches_argv_and_auth_fails_closed() {
        let secret = "never-put-this-password-in-argv";
        let vmrun = VmRun::new("vmrun", "ws", 1);
        let result = vmrun
            .run_program_in_guest(
                "guest.vmx",
                "guest-user",
                secret,
                "guest-program",
                None,
                false,
                false,
            )
            .await
            .expect_err("vmrun guest password authentication must fail closed");

        assert!(matches!(result.kind, VmwErrorKind::InvalidConfig));
        assert!(!result.message.contains(secret));
        assert!(!result.message.contains("guest-user"));
        assert!(result.message.contains("process command line"));
    }

    #[tokio::test]
    async fn legacy_runner_rejects_untrusted_executable_paths() {
        let vmrun = VmRun::new("vmrun", "ws", 1);
        let result = vmrun
            .list()
            .await
            .expect_err("relative vmrun paths must be rejected before spawn");
        assert!(matches!(result.kind, VmwErrorKind::InvalidConfig));
    }

    #[tokio::test]
    async fn helper_failure_redacts_output_and_paths() {
        let secret = "never-return-this-secret";
        let mut command = fake_command("failure");
        command.env(FAKE_SECRET, secret);
        let result =
            run_supervised_tool(command, DesktopToolJob::OvfImport, Duration::from_secs(10))
                .await
                .expect_err("failing helper must return an error");

        assert!(!result.message.contains(secret));
        assert!(!result.message.contains("private.vmdk"));
        assert!(!result.message.contains("sensitive"));
    }

    #[tokio::test]
    async fn dropping_job_future_cancels_fake_helper() {
        let pid_file = unique_test_path("cancel-pid");
        let marker_file = unique_test_path("cancel-marker");
        let mut command = fake_command("sleep");
        command
            .env(FAKE_PID_FILE, &pid_file)
            .env(FAKE_MARKER_FILE, &marker_file);
        let job = tokio::spawn(run_supervised_tool(
            command,
            DesktopToolJob::VmdkDefragment,
            Duration::from_secs(30),
        ));
        wait_for_file(&pid_file).await;

        job.abort();
        let _ = job.await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert!(!marker_file.exists(), "cancelled helper was not terminated");
        let _ = fs::remove_file(pid_file);
    }

    #[test]
    fn validates_paths_disk_types_and_adapter_types() {
        assert!(validate_path_argument("C:\\VMs\\disk.vmdk", "path").is_ok());
        assert!(validate_path_argument("-delete", "path").is_err());
        assert!(validate_path_argument("bad\npath", "path").is_err());
        assert!(validate_path_argument("", "path").is_err());
        assert_eq!(validate_disk_type("monolithicFlat").unwrap(), "2");
        assert!(validate_disk_type("unknown").is_err());
        assert!(validate_adapter_type("pvscsi").is_ok());
        assert!(validate_adapter_type("arbitrary-option").is_err());
    }
}
