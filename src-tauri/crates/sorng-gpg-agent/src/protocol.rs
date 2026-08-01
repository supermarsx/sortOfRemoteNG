//! # Assuan Protocol Client
//!
//! Implements the Assuan IPC protocol used by gpg-agent. Provides both
//! direct socket communication and command-line fallback via
//! `tokio::process::Command`.

use log::{debug, info, warn};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::time::timeout;
use zeroize::{Zeroize, Zeroizing};

// ── Assuan Response ─────────────────────────────────────────────────

/// Parsed response from an Assuan protocol exchange.
#[derive(Debug, Clone)]
pub enum AssuanResponse {
    /// OK with optional message.
    Ok(String),
    /// ERR code message.
    Err(u32, String),
    /// Data line (D <hex-or-text>).
    Data(Vec<u8>),
    /// Status line (S <keyword> <args>).
    Status(String, String),
    /// Inquiry (INQUIRE <keyword> <args>).
    Inquire(String, String),
    /// Comment line (# ...).
    Comment(String),
}

/// Collected multi-line response.
#[derive(Debug, Clone, Default)]
pub struct AssuanResult {
    pub ok: bool,
    pub error_code: u32,
    pub error_message: String,
    pub data_lines: Vec<Vec<u8>>,
    pub status_lines: Vec<(String, String)>,
}

impl AssuanResult {
    /// Get all data concatenated as a string.
    pub fn data_as_string(&self) -> String {
        self.data_lines
            .iter()
            .map(|d| String::from_utf8_lossy(d).to_string())
            .collect::<Vec<_>>()
            .join("")
    }

    /// Get a specific status value.
    pub fn get_status(&self, keyword: &str) -> Option<&str> {
        self.status_lines
            .iter()
            .find(|(k, _)| k == keyword)
            .map(|(_, v)| v.as_str())
    }
}

// ── Assuan Protocol Encoding ────────────────────────────────────────

/// Percent-encode a string for the Assuan protocol.
pub fn assuan_percent_encode(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'%' => result.push_str("%25"),
            b'\n' => result.push_str("%0A"),
            b'\r' => result.push_str("%0D"),
            0x00 => result.push_str("%00"),
            _ => result.push(b as char),
        }
    }
    result
}

/// Percent-decode an Assuan protocol string.
pub fn assuan_percent_decode(input: &str) -> Vec<u8> {
    let mut result = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(&String::from_utf8_lossy(&bytes[i + 1..i + 3]), 16)
            {
                result.push(val);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    result
}

/// Parse a single Assuan response line.
pub fn parse_assuan_line(line: &str) -> Option<AssuanResponse> {
    let line = line.trim_end_matches('\n').trim_end_matches('\r');
    if line.is_empty() {
        return None;
    }

    if line.starts_with("OK") {
        let msg = line.get(2..).unwrap_or("").trim().to_string();
        return Some(AssuanResponse::Ok(msg));
    }

    if let Some(rest) = line.strip_prefix("ERR ") {
        let mut parts = rest.splitn(2, ' ');
        let code = parts.next().unwrap_or("0").parse::<u32>().unwrap_or(0);
        let msg = parts.next().unwrap_or("").to_string();
        return Some(AssuanResponse::Err(code, msg));
    }

    if let Some(stripped) = line.strip_prefix("D ") {
        let data = assuan_percent_decode(stripped);
        return Some(AssuanResponse::Data(data));
    }

    if let Some(rest) = line.strip_prefix("S ") {
        let mut parts = rest.splitn(2, ' ');
        let keyword = parts.next().unwrap_or("").to_string();
        let args = parts.next().unwrap_or("").to_string();
        return Some(AssuanResponse::Status(keyword, args));
    }

    if let Some(rest) = line.strip_prefix("INQUIRE ") {
        let mut parts = rest.splitn(2, ' ');
        let keyword = parts.next().unwrap_or("").to_string();
        let args = parts.next().unwrap_or("").to_string();
        return Some(AssuanResponse::Inquire(keyword, args));
    }

    if let Some(stripped) = line.strip_prefix('#') {
        return Some(AssuanResponse::Comment(stripped.trim().to_string()));
    }

    None
}

/// Parse multiple response lines into a collected result.
pub fn parse_assuan_output(output: &str) -> AssuanResult {
    let mut result = AssuanResult::default();

    for line in output.lines() {
        match parse_assuan_line(line) {
            Some(AssuanResponse::Ok(_)) => {
                result.ok = true;
            }
            Some(AssuanResponse::Err(code, msg)) => {
                result.ok = false;
                result.error_code = code;
                result.error_message = msg;
            }
            Some(AssuanResponse::Data(data)) => {
                result.data_lines.push(data);
            }
            Some(AssuanResponse::Status(kw, args)) => {
                result.status_lines.push((kw, args));
            }
            _ => {}
        }
    }

    result
}

// ── Bounded helper process execution ───────────────────────────────

const HELPER_START_ERROR: &str = "GPG helper could not be started";
const HELPER_EXECUTION_ERROR: &str = "GPG helper execution failed";
const HELPER_TIMEOUT_ERROR: &str = "GPG helper timed out";
const HELPER_OUTPUT_LIMIT_ERROR: &str = "GPG helper output exceeded safety limit";
const HELPER_INPUT_LIMIT_ERROR: &str = "GPG helper input exceeded safety limit";
const HELPER_CONFIG_ERROR: &str = "GPG helper configuration is invalid";
const HELPER_IO_JOIN_TIMEOUT: Duration = Duration::from_secs(3);
const HELPER_TERMINATION_TIMEOUT: Duration = Duration::from_secs(5);
const PROCESS_TREE_SIGNAL_TIMEOUT: Duration = Duration::from_secs(2);
const REAPER_QUEUE_CAPACITY: usize = 16;
const REAPER_WORKER_LIMIT: usize = 2;
const REAPER_RETRY_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Copy)]
struct HelperLimits {
    deadline: Duration,
    stdin_cap: usize,
    stdout_cap: usize,
    stderr_cap: usize,
}

const DISCOVERY_HELPER_LIMITS: HelperLimits = HelperLimits {
    deadline: Duration::from_secs(15),
    stdin_cap: 64 * 1024,
    stdout_cap: 1024 * 1024,
    stderr_cap: 256 * 1024,
};

const AGENT_HELPER_LIMITS: HelperLimits = HelperLimits {
    deadline: Duration::from_secs(30),
    stdin_cap: 1024 * 1024,
    stdout_cap: 8 * 1024 * 1024,
    stderr_cap: 1024 * 1024,
};

const COMMAND_HELPER_LIMITS: HelperLimits = HelperLimits {
    deadline: Duration::from_secs(120),
    stdin_cap: 64 * 1024 * 1024,
    stdout_cap: 64 * 1024 * 1024,
    stderr_cap: 1024 * 1024,
};

struct BoundedOutput {
    bytes: Zeroizing<Vec<u8>>,
    exceeded: bool,
}

struct HelperOutput {
    status: ExitStatus,
    stdout: Zeroizing<Vec<u8>>,
    stderr: Zeroizing<Vec<u8>>,
}

enum ReapTarget {
    Process {
        child: tokio::process::Child,
        process_id: Option<u32>,
    },
}

impl ReapTarget {
    async fn reap(&mut self) {
        loop {
            let reaped = match self {
                Self::Process {
                    child,
                    process_id,
                } => {
                    if matches!(child.try_wait(), Ok(Some(_))) {
                        true
                    } else {
                        if let Some(process_id) = *process_id {
                            terminate_process_tree(process_id).await;
                        }
                        let _ = child.start_kill();
                        matches!(child.try_wait(), Ok(Some(_)))
                    }
                }
            };
            if reaped {
                return;
            }
            tokio::time::sleep(REAPER_RETRY_INTERVAL).await;
        }
    }
}

struct ReaperMetrics {
    owned: AtomicUsize,
    active: AtomicUsize,
    max_active: AtomicUsize,
    completed: AtomicUsize,
}

impl ReaperMetrics {
    fn new() -> Self {
        Self {
            owned: AtomicUsize::new(0),
            active: AtomicUsize::new(0),
            max_active: AtomicUsize::new(0),
            completed: AtomicUsize::new(0),
        }
    }

    fn record_active(&self, active: usize) {
        let mut observed = self.max_active.load(Ordering::Relaxed);
        while active > observed {
            match self.max_active.compare_exchange_weak(
                observed,
                active,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(current) => observed = current,
            }
        }
    }
}

struct AccountedReapTarget {
    target: ReapTarget,
    metrics: Arc<ReaperMetrics>,
}

impl Drop for AccountedReapTarget {
    fn drop(&mut self) {
        self.metrics.owned.fetch_sub(1, Ordering::Relaxed);
    }
}

#[derive(Clone)]
struct CentralReaper {
    sender: tokio::sync::mpsc::Sender<AccountedReapTarget>,
    metrics: Arc<ReaperMetrics>,
}

static CENTRAL_REAPER: OnceLock<CentralReaper> = OnceLock::new();

impl CentralReaper {
    fn global() -> &'static Self {
        CENTRAL_REAPER.get_or_init(|| {
            let (sender, mut receiver) =
                tokio::sync::mpsc::channel::<AccountedReapTarget>(REAPER_QUEUE_CAPACITY);
            let metrics = Arc::new(ReaperMetrics::new());
            let worker_metrics = Arc::clone(&metrics);
            tokio::spawn(async move {
                let worker_slots = Arc::new(tokio::sync::Semaphore::new(REAPER_WORKER_LIMIT));
                while let Some(mut target) = receiver.recv().await {
                    let Ok(worker_slot) = Arc::clone(&worker_slots).acquire_owned().await else {
                        break;
                    };
                    let metrics = Arc::clone(&worker_metrics);
                    tokio::spawn(async move {
                        let active = metrics.active.fetch_add(1, Ordering::Relaxed) + 1;
                        metrics.record_active(active);
                        target.target.reap().await;
                        metrics.active.fetch_sub(1, Ordering::Relaxed);
                        metrics.completed.fetch_add(1, Ordering::Relaxed);
                        drop(worker_slot);
                    });
                }
            });
            Self { sender, metrics }
        })
    }

    fn try_enqueue(&self, target: ReapTarget) -> Result<(), Box<ReapTarget>> {
        let permit = match self.sender.try_reserve() {
            Ok(permit) => permit,
            Err(_) => return Err(Box::new(target)),
        };
        self.metrics.owned.fetch_add(1, Ordering::Relaxed);
        permit.send(AccountedReapTarget {
            target,
            metrics: Arc::clone(&self.metrics),
        });
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GpgCommandStatus {
    Success,
    CardAbsent,
    BadSignature,
    MissingPublicKey,
    SignatureError,
    Failed,
}

pub(crate) struct GpgCommandResult {
    status: GpgCommandStatus,
    stdout: Zeroizing<Vec<u8>>,
}

impl GpgCommandResult {
    pub(crate) fn status(&self) -> GpgCommandStatus {
        self.status
    }

    pub(crate) fn stdout(&self) -> &[u8] {
        &self.stdout
    }

    pub(crate) fn sanitized_error(&self) -> String {
        match self.status {
            GpgCommandStatus::Success => HELPER_EXECUTION_ERROR,
            GpgCommandStatus::CardAbsent => "No smart card is present",
            GpgCommandStatus::BadSignature => "GPG signature is invalid",
            GpgCommandStatus::MissingPublicKey => "GPG signature key is unavailable",
            GpgCommandStatus::SignatureError => "GPG signature verification failed",
            GpgCommandStatus::Failed => HELPER_EXECUTION_ERROR,
        }
        .to_string()
    }

    fn into_success_bytes(mut self) -> Result<Vec<u8>, String> {
        if self.status != GpgCommandStatus::Success {
            return Err(self.sanitized_error());
        }
        Ok(std::mem::take(&mut *self.stdout))
    }
}

fn validate_trusted_executable(executable: &str) -> Result<(), String> {
    if executable.is_empty()
        || executable.trim() != executable
        || executable
            .bytes()
            .any(|byte| matches!(byte, b'\0' | b'\r' | b'\n'))
    {
        return Err(HELPER_CONFIG_ERROR.to_string());
    }

    let path = Path::new(executable);
    let component_count = path.components().count();
    if component_count == 1 {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let allowed = matches!(
            name.as_str(),
            "gpg"
                | "gpg.exe"
                | "gpg2"
                | "gpg2.exe"
                | "gpgconf"
                | "gpgconf.exe"
                | "gpg-connect-agent"
                | "gpg-connect-agent.exe"
        );
        if !allowed {
            return Err(HELPER_CONFIG_ERROR.to_string());
        }
    } else if !path.is_absolute() {
        return Err(HELPER_CONFIG_ERROR.to_string());
    }

    let unsafe_script = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "bat" | "cmd" | "ps1"
            )
        });
    if unsafe_script {
        return Err(HELPER_CONFIG_ERROR.to_string());
    }

    Ok(())
}

async fn read_bounded<R>(mut reader: R, cap: usize) -> std::io::Result<BoundedOutput>
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Zeroizing::new(Vec::with_capacity(cap.min(64 * 1024)));
    let mut chunk = [0_u8; 8192];
    let mut exceeded = false;

    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(read) => read,
            Err(error) => {
                chunk.zeroize();
                return Err(error);
            }
        };
        if read == 0 {
            break;
        }

        let remaining = cap.saturating_sub(bytes.len());
        let retained = remaining.min(read);
        bytes.extend_from_slice(&chunk[..retained]);
        exceeded |= retained != read;
        chunk[..read].zeroize();
    }

    chunk.zeroize();
    Ok(BoundedOutput { bytes, exceeded })
}

async fn write_zeroizing_input(
    mut stdin: tokio::process::ChildStdin,
    mut input: Option<Zeroizing<Vec<u8>>>,
) -> std::io::Result<()> {
    let result = if let Some(bytes) = input.as_deref() {
        stdin.write_all(bytes).await
    } else {
        Ok(())
    };
    let shutdown_result = stdin.shutdown().await;
    if let Some(bytes) = input.as_mut() {
        bytes.zeroize();
    }
    result.and(shutdown_result)
}

async fn run_process_tree_signal(mut command: Command) {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let Ok(mut signal) = command.spawn() else {
        return;
    };
    if timeout(PROCESS_TREE_SIGNAL_TIMEOUT, signal.wait())
        .await
        .is_err()
    {
        let _ = signal.start_kill();
        let _ = timeout(PROCESS_TREE_SIGNAL_TIMEOUT, signal.wait()).await;
    }
}

#[cfg(windows)]
async fn terminate_process_tree(process_id: u32) {
    let Some(system_root) = std::env::var_os("SystemRoot") else {
        return;
    };
    let taskkill = Path::new(&system_root)
        .join("System32")
        .join("taskkill.exe");
    if !taskkill.is_absolute() {
        return;
    }
    let process_id = process_id.to_string();
    let mut command = Command::new(taskkill);
    command.args(["/PID", &process_id, "/T", "/F"]);
    run_process_tree_signal(command).await;
}

#[cfg(unix)]
async fn terminate_process_tree(process_id: u32) {
    let process_group = format!("-{process_id}");
    let mut command = Command::new("/bin/kill");
    command.args(["-KILL", "--", &process_group]);
    run_process_tree_signal(command).await;
}

#[cfg(not(any(unix, windows)))]
async fn terminate_process_tree(_process_id: u32) {}

async fn terminate_and_reap(mut child: tokio::process::Child, process_id: Option<u32>) {
    let cleanup = async {
        if let Some(process_id) = process_id {
            terminate_process_tree(process_id).await;
        }
        let _ = child.start_kill();
        child.wait().await.is_ok()
    };
    if !matches!(timeout(HELPER_TERMINATION_TIMEOUT, cleanup).await, Ok(true)) {
        let target = ReapTarget::Process { child, process_id };
        if let Err(mut target) = CentralReaper::global().try_enqueue(target) {
            target.reap().await;
        }
    }
}

async fn abort_and_join<T>(mut task: tokio::task::JoinHandle<T>) {
    task.abort();
    let _ = timeout(HELPER_IO_JOIN_TIMEOUT, &mut task).await;
}

async fn run_trusted_helper(
    executable: &str,
    args: &[&str],
    input: Option<Zeroizing<Vec<u8>>>,
    limits: HelperLimits,
) -> Result<HelperOutput, String> {
    run_trusted_helper_with_env(executable, args, input, limits, &[]).await
}

async fn run_trusted_helper_with_env(
    executable: &str,
    args: &[&str],
    input: Option<Zeroizing<Vec<u8>>>,
    limits: HelperLimits,
    environment: &[(&str, &str)],
) -> Result<HelperOutput, String> {
    validate_trusted_executable(executable)?;
    if args.iter().any(|arg| arg.contains('\0')) {
        return Err(HELPER_CONFIG_ERROR.to_string());
    }
    if input
        .as_ref()
        .is_some_and(|bytes| bytes.len() > limits.stdin_cap)
    {
        return Err(HELPER_INPUT_LIMIT_ERROR.to_string());
    }

    let mut command = Command::new(executable);
    command
        .args(args)
        .envs(environment.iter().copied())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x0000_0200);

    let mut child = command
        .spawn()
        .map_err(|_| HELPER_START_ERROR.to_string())?;
    let process_id = child.id();
    let Some(stdin) = child.stdin.take() else {
        terminate_and_reap(child, process_id).await;
        return Err(HELPER_EXECUTION_ERROR.to_string());
    };
    let Some(stdout) = child.stdout.take() else {
        terminate_and_reap(child, process_id).await;
        return Err(HELPER_EXECUTION_ERROR.to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        terminate_and_reap(child, process_id).await;
        return Err(HELPER_EXECUTION_ERROR.to_string());
    };

    let mut input_task = tokio::spawn(write_zeroizing_input(stdin, input));
    let mut stdout_task = tokio::spawn(read_bounded(stdout, limits.stdout_cap));
    let mut stderr_task = tokio::spawn(read_bounded(stderr, limits.stderr_cap));

    let status = match timeout(limits.deadline, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(_)) => {
            terminate_and_reap(child, process_id).await;
            tokio::join!(
                abort_and_join(input_task),
                abort_and_join(stdout_task),
                abort_and_join(stderr_task),
            );
            return Err(HELPER_EXECUTION_ERROR.to_string());
        }
        Err(_) => {
            terminate_and_reap(child, process_id).await;
            tokio::join!(
                abort_and_join(input_task),
                abort_and_join(stdout_task),
                abort_and_join(stderr_task),
            );
            return Err(HELPER_TIMEOUT_ERROR.to_string());
        }
    };

    let joined = timeout(HELPER_IO_JOIN_TIMEOUT, async {
        tokio::join!(&mut input_task, &mut stdout_task, &mut stderr_task)
    })
    .await;
    let (input_result, stdout_result, stderr_result) = match joined {
        Ok(results) => results,
        Err(_) => {
            if let Some(process_id) = process_id {
                let _ = timeout(
                    PROCESS_TREE_SIGNAL_TIMEOUT,
                    terminate_process_tree(process_id),
                )
                .await;
            }
            tokio::join!(
                abort_and_join(input_task),
                abort_and_join(stdout_task),
                abort_and_join(stderr_task),
            );
            return Err(HELPER_EXECUTION_ERROR.to_string());
        }
    };

    input_result
        .map_err(|_| HELPER_EXECUTION_ERROR.to_string())?
        .map_err(|_| HELPER_EXECUTION_ERROR.to_string())?;
    let stdout = stdout_result
        .map_err(|_| HELPER_EXECUTION_ERROR.to_string())?
        .map_err(|_| HELPER_EXECUTION_ERROR.to_string())?;
    let stderr = stderr_result
        .map_err(|_| HELPER_EXECUTION_ERROR.to_string())?
        .map_err(|_| HELPER_EXECUTION_ERROR.to_string())?;
    if stdout.exceeded || stderr.exceeded {
        return Err(HELPER_OUTPUT_LIMIT_ERROR.to_string());
    }

    Ok(HelperOutput {
        status,
        stdout: stdout.bytes,
        stderr: stderr.bytes,
    })
}

fn contains_ascii_case_insensitive(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack.windows(needle.len()).any(|window| {
            window
                .iter()
                .zip(needle)
                .all(|(left, right)| left.eq_ignore_ascii_case(right))
        })
}

fn helper_contains(output: &HelperOutput, needle: &[u8]) -> bool {
    contains_ascii_case_insensitive(&output.stdout, needle)
        || contains_ascii_case_insensitive(&output.stderr, needle)
}

fn classify_helper_output(output: HelperOutput) -> GpgCommandResult {
    let status = if helper_contains(&output, b"[GNUPG:] BADSIG") {
        GpgCommandStatus::BadSignature
    } else if helper_contains(&output, b"[GNUPG:] NO_PUBKEY") {
        GpgCommandStatus::MissingPublicKey
    } else if helper_contains(&output, b"[GNUPG:] ERRSIG")
        || helper_contains(&output, b"[GNUPG:] EXPSIG")
        || helper_contains(&output, b"[GNUPG:] EXPKEYSIG")
        || helper_contains(&output, b"[GNUPG:] REVKEYSIG")
    {
        GpgCommandStatus::SignatureError
    } else if helper_contains(&output, b"[GNUPG:] CARDCTRL 6")
        || helper_contains(&output, b"card not present")
        || helper_contains(&output, b"no smartcard")
        || helper_contains(&output, b"no smart card")
        || helper_contains(&output, b"selecting card failed")
    {
        GpgCommandStatus::CardAbsent
    } else if output.status.success() {
        GpgCommandStatus::Success
    } else {
        GpgCommandStatus::Failed
    };

    if status != GpgCommandStatus::Success {
        warn!("GPG helper operation did not succeed (diagnostics redacted)");
    }
    GpgCommandResult {
        status,
        stdout: output.stdout,
    }
}

fn agent_operation_error(operation: &'static str, result: &AssuanResult) -> String {
    if result.error_code == 0 {
        format!("{operation} failed")
    } else {
        format!("{operation} failed (agent code {})", result.error_code)
    }
}

const ASSUAN_COMMAND_LINE_CAP: usize = 2048;

#[derive(Clone, Copy)]
enum ScdDataOperation {
    Sign { hash_algorithm: &'static str },
    Decrypt,
}

impl ScdDataOperation {
    fn command(self, key_id: &str) -> String {
        match self {
            Self::Sign { hash_algorithm } => {
                format!("SCD PKSIGN --hash={hash_algorithm} {key_id}")
            }
            Self::Decrypt => format!("SCD PKDECRYPT {key_id}"),
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Sign { .. } => "SCD PKSIGN",
            Self::Decrypt => "SCD PKDECRYPT",
        }
    }
}

fn scd_hash_algorithm(hash: &[u8]) -> Result<&'static str, String> {
    match hash.len() {
        16 => Ok("md5"),
        20 => Ok("sha1"),
        28 => Ok("sha224"),
        32 => Ok("sha256"),
        48 => Ok("sha384"),
        64 => Ok("sha512"),
        _ => Err("Unsupported smart-card digest length".to_string()),
    }
}

fn validate_scd_key_id(key_id: &str) -> Result<(), String> {
    if key_id.is_empty()
        || key_id.len() > 128
        || !key_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'))
    {
        return Err("Invalid smart-card key identifier".to_string());
    }
    Ok(())
}

fn build_scd_data_script(
    key_id: &str,
    data: &[u8],
    operation: ScdDataOperation,
) -> Result<Zeroizing<Vec<u8>>, String> {
    validate_scd_key_id(key_id)?;
    if data.is_empty()
        || data
            .len()
            .checked_mul(2)
            .and_then(|length| length.checked_add(b"SCD SETDATA ".len()))
            .is_none_or(|length| length > ASSUAN_COMMAND_LINE_CAP)
    {
        return Err("Invalid or unsupported smart-card operation data".to_string());
    }

    let operation_command = operation.command(key_id);
    if operation_command.len() > ASSUAN_COMMAND_LINE_CAP {
        return Err("Invalid smart-card operation".to_string());
    }

    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut script = Zeroizing::new(Vec::with_capacity(
        64 + data.len() * 2 + operation_command.len(),
    ));
    script.extend_from_slice(b"/subst\nSCD SETDATA ");
    for byte in data {
        script.push(HEX[(byte >> 4) as usize]);
        script.push(HEX[(byte & 0x0f) as usize]);
    }
    // gpg-connect-agent stores the previous Assuan error in `$?`.  Execute
    // the private-key operation only when SETDATA completed successfully, so
    // stale card data can never be signed or decrypted after a failed setup.
    script.extend_from_slice(b"\n/if ${! $?}\n");
    script.extend_from_slice(operation_command.as_bytes());
    script.extend_from_slice(b"\n/end\n/bye\n");
    Ok(script)
}

fn parse_scd_data_operation_output(
    output: &str,
    operation: ScdDataOperation,
) -> Result<AssuanResult, String> {
    let mut result = AssuanResult::default();
    let mut completed_transactions = 0_u8;

    for line in output.lines() {
        match parse_assuan_line(line) {
            Some(AssuanResponse::Ok(_)) => {
                completed_transactions = completed_transactions.saturating_add(1);
                if completed_transactions > 2 {
                    return Err("Unexpected smart-card agent response".to_string());
                }
            }
            Some(AssuanResponse::Err(code, _)) => {
                let stage = if completed_transactions == 0 {
                    "SCD SETDATA"
                } else {
                    operation.display_name()
                };
                let failed = AssuanResult {
                    error_code: code,
                    ..AssuanResult::default()
                };
                return Err(agent_operation_error(stage, &failed));
            }
            Some(AssuanResponse::Data(data)) if completed_transactions == 1 => {
                result.data_lines.push(data);
            }
            Some(AssuanResponse::Status(keyword, args)) if completed_transactions == 1 => {
                result.status_lines.push((keyword, args));
            }
            Some(AssuanResponse::Comment(_)) | None => {}
            _ => return Err("Unexpected smart-card agent response".to_string()),
        }
    }

    if completed_transactions != 2 {
        return Err("Smart-card operation did not complete".to_string());
    }
    result.ok = true;
    Ok(result)
}

// ── Assuan Client ───────────────────────────────────────────────────

/// Client for communicating with gpg-agent via the Assuan protocol.
/// Uses command-line tools as the primary approach with protocol-aware
/// parsing of results.
pub struct AssuanClient {
    /// Path to the gpg-agent socket.
    socket_path: String,
    /// Path to the gpg-connect-agent binary.
    connect_agent_binary: String,
    /// Whether we are connected.
    connected: bool,
    /// Path to the gpg binary (for fallback operations).
    gpg_binary: String,
    /// Configured GPG home, forwarded to every helper operation.
    home_dir: Option<String>,
}

impl AssuanClient {
    /// Create a new Assuan client.
    pub fn new(gpg_binary: &str, home_dir: Option<String>) -> Self {
        Self {
            socket_path: String::new(),
            connect_agent_binary: String::new(),
            connected: false,
            gpg_binary: gpg_binary.to_string(),
            home_dir: home_dir.filter(|home| !home.is_empty()),
        }
    }

    async fn run_helper(
        &self,
        executable: &str,
        args: &[&str],
        input: Option<Zeroizing<Vec<u8>>>,
        limits: HelperLimits,
    ) -> Result<HelperOutput, String> {
        let environment = self
            .home_dir
            .as_deref()
            .map(|home| vec![("GNUPGHOME", home)])
            .unwrap_or_default();
        run_trusted_helper_with_env(executable, args, input, limits, &environment).await
    }

    /// Connect to the gpg-agent, discovering the socket path.
    pub async fn connect(&mut self) -> Result<(), String> {
        // Try to find gpg-agent socket via gpgconf
        let socket = self.get_agent_socket_path().await?;
        self.socket_path = socket;

        // Find gpg-connect-agent binary
        self.connect_agent_binary = self.find_connect_agent().await;

        // Verify agent is running
        let output = self
            .run_helper(
                &self.gpg_binary,
                &["--batch", "--no-tty", "--status-fd", "1", "--version"],
                None,
                DISCOVERY_HELPER_LIMITS,
            )
            .await?;

        if output.status.success() {
            self.connected = true;
            info!("Connected to gpg-agent");
            Ok(())
        } else {
            Err("Failed to verify gpg installation".to_string())
        }
    }

    /// Disconnect from gpg-agent.
    pub async fn disconnect(&mut self) {
        self.connected = false;
        info!("Disconnected from gpg-agent");
    }

    /// Send a command to gpg-agent via gpg-connect-agent.
    pub async fn send_command(&self, command: &str) -> Result<AssuanResult, String> {
        self.send_command_buffer(Zeroizing::new(command.to_string()))
            .await
    }

    async fn send_command_buffer(
        &self,
        mut command: Zeroizing<String>,
    ) -> Result<AssuanResult, String> {
        if command.is_empty()
            || command.len() > AGENT_HELPER_LIMITS.stdin_cap.saturating_sub(7)
            || command
                .bytes()
                .any(|byte| matches!(byte, b'\0' | b'\r' | b'\n'))
        {
            return Err("Invalid gpg-agent command".to_string());
        }
        if !self.connected && !self.connect_agent_binary.is_empty() {
            debug!("Sending gpg-agent operation");
        }

        let binary = if self.connect_agent_binary.is_empty() {
            "gpg-connect-agent".to_string()
        } else {
            self.connect_agent_binary.clone()
        };

        let mut payload = Zeroizing::new(Vec::with_capacity(command.len() + 7));
        payload.extend_from_slice(command.as_bytes());
        payload.extend_from_slice(b"\n/bye\n");
        command.zeroize();
        let output = self
            .run_helper(
                &binary,
                &["--no-autostart", "-S", &self.socket_path],
                Some(payload),
                AGENT_HELPER_LIMITS,
            )
            .await?;
        if !output.status.success() {
            return Err(HELPER_EXECUTION_ERROR.to_string());
        }

        let result = parse_assuan_output(&String::from_utf8_lossy(&output.stdout));

        if !result.ok && result.error_code != 0 {
            warn!(
                "Assuan operation returned error code {} (message redacted)",
                result.error_code
            );
        }

        Ok(result)
    }

    async fn send_scd_data_operation(
        &self,
        script: Zeroizing<Vec<u8>>,
        operation: ScdDataOperation,
    ) -> Result<AssuanResult, String> {
        if !self.connected && !self.connect_agent_binary.is_empty() {
            debug!("Sending smart-card agent operation");
        }

        let binary = if self.connect_agent_binary.is_empty() {
            "gpg-connect-agent".to_string()
        } else {
            self.connect_agent_binary.clone()
        };
        let output = self
            .run_helper(
                &binary,
                &["--no-autostart", "--no-history", "-S", &self.socket_path],
                Some(script),
                AGENT_HELPER_LIMITS,
            )
            .await?;
        if !output.status.success() {
            return Err(HELPER_EXECUTION_ERROR.to_string());
        }

        parse_scd_data_operation_output(&String::from_utf8_lossy(&output.stdout), operation)
    }

    /// Read a response from a command.
    pub fn read_response(output: &str) -> AssuanResult {
        parse_assuan_output(output)
    }

    /// Query agent info (GETINFO).
    pub async fn get_info(&self, what: &str) -> Result<String, String> {
        let cmd = format!("GETINFO {}", what);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(result.data_as_string())
        } else {
            Err(agent_operation_error("GETINFO", &result))
        }
    }

    /// Get a value from the agent (GETVAL).
    pub async fn getval(&self, key: &str) -> Result<String, String> {
        let cmd = format!("GETVAL {}", assuan_percent_encode(key));
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(result.data_as_string())
        } else {
            Err(agent_operation_error("GETVAL", &result))
        }
    }

    /// Smart card daemon: get attribute.
    pub async fn scd_getattr(&self, attr: &str) -> Result<String, String> {
        let cmd = format!("SCD GETATTR {}", attr);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            // Attributes are returned as status lines
            if let Some(val) = result.get_status(attr) {
                Ok(val.to_string())
            } else {
                Ok(result.data_as_string())
            }
        } else {
            Err(agent_operation_error("SCD GETATTR", &result))
        }
    }

    /// Smart card daemon: learn card info.
    pub async fn scd_learn(&self) -> Result<HashMap<String, String>, String> {
        let result = self.send_command("SCD LEARN --force").await?;
        let mut info = HashMap::new();
        for (key, val) in &result.status_lines {
            info.insert(key.clone(), val.clone());
        }
        Ok(info)
    }

    /// Smart card daemon: sign with card key.
    pub async fn scd_pksign(&self, keygrip: &str, hash: &[u8]) -> Result<Vec<u8>, String> {
        let operation = ScdDataOperation::Sign {
            hash_algorithm: scd_hash_algorithm(hash)?,
        };
        let script = build_scd_data_script(keygrip, hash, operation)?;
        let result = self.send_scd_data_operation(script, operation).await?;
        let signature: Vec<u8> = result.data_lines.into_iter().flatten().collect();
        if signature.is_empty() {
            Err("SCD PKSIGN returned no signature".to_string())
        } else {
            Ok(signature)
        }
    }

    /// Smart card daemon: decrypt with card key.
    pub async fn scd_pkdecrypt(&self, keygrip: &str, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        let operation = ScdDataOperation::Decrypt;
        let script = build_scd_data_script(keygrip, ciphertext, operation)?;
        let result = self.send_scd_data_operation(script, operation).await?;
        let plaintext: Vec<u8> = result.data_lines.into_iter().flatten().collect();
        if plaintext.is_empty() {
            Err("SCD PKDECRYPT returned no plaintext".to_string())
        } else {
            Ok(plaintext)
        }
    }

    /// Smart card daemon: generate key on card.
    pub async fn scd_genkey(&self, key_number: u8, force: bool) -> Result<String, String> {
        let force_flag = if force { "--force " } else { "" };
        let cmd = format!("SCD GENKEY {}{}", force_flag, key_number);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(result.data_as_string())
        } else {
            Err(agent_operation_error("SCD GENKEY", &result))
        }
    }

    /// Smart card daemon: change PIN.
    pub async fn scd_passwd(&self, chv_no: &str) -> Result<(), String> {
        let cmd = format!("SCD PASSWD {}", chv_no);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(())
        } else {
            Err(agent_operation_error("SCD PASSWD", &result))
        }
    }

    /// Smart card daemon: unblock the user PIN with the configured reset code.
    pub async fn scd_unblock_pin(&self) -> Result<(), String> {
        let result = self.send_command("SCD PASSWD --reset 1").await?;
        if result.ok {
            Ok(())
        } else {
            Err(agent_operation_error("SCD PASSWD --reset", &result))
        }
    }

    /// Kill the running gpg-agent.
    pub async fn killagent(&self) -> Result<(), String> {
        let result = self.send_command("KILLAGENT").await?;
        if result.ok {
            info!("gpg-agent killed");
            Ok(())
        } else {
            // Agent may respond with ERR right before dying
            Ok(())
        }
    }

    /// Reload the gpg-agent configuration.
    pub async fn reloadagent(&self) -> Result<(), String> {
        let result = self.send_command("RELOADAGENT").await?;
        if result.ok {
            info!("gpg-agent reloaded");
            Ok(())
        } else {
            Err(agent_operation_error("RELOADAGENT", &result))
        }
    }

    /// Query info about cached keys (KEYINFO).
    pub async fn keyinfo(&self, keygrip: &str) -> Result<Vec<(String, String)>, String> {
        let cmd = if keygrip.is_empty() {
            "KEYINFO --list".to_string()
        } else {
            format!("KEYINFO {}", keygrip)
        };
        let result = self.send_command(&cmd).await?;
        Ok(result.status_lines)
    }

    /// Preset a passphrase in the agent cache.
    pub async fn preset_passphrase(
        &self,
        keygrip: &str,
        timeout: i32,
        passphrase: &str,
    ) -> Result<(), String> {
        let mut hex_passphrase = Zeroizing::new(String::with_capacity(passphrase.len() * 2));
        for byte in passphrase.bytes() {
            write!(&mut *hex_passphrase, "{byte:02X}")
                .map_err(|_| "Failed to prepare passphrase".to_string())?;
        }
        let timeout_str = if timeout < 0 {
            "-1".to_string()
        } else {
            timeout.to_string()
        };
        let cmd = Zeroizing::new(format!(
            "PRESET_PASSPHRASE {} {} {}",
            keygrip, timeout_str, &*hex_passphrase
        ));
        let result = self.send_command_buffer(cmd).await?;
        if result.ok {
            Ok(())
        } else {
            Err(agent_operation_error("PRESET_PASSPHRASE", &result))
        }
    }

    /// Clear a cached passphrase.
    pub async fn clear_passphrase(&self, keygrip: &str) -> Result<(), String> {
        let cmd = format!("CLEAR_PASSPHRASE {}", keygrip);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(())
        } else {
            Err(agent_operation_error("CLEAR_PASSPHRASE", &result))
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /// Get the gpg-agent socket path via gpgconf.
    pub async fn get_agent_socket_path(&self) -> Result<String, String> {
        let output = self
            .run_helper(
                "gpgconf",
                &["--list-dirs", "agent-socket"],
                None,
                DISCOVERY_HELPER_LIMITS,
            )
            .await?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(path)
        } else {
            // Fallback: try standard locations
            let home = self.get_gpg_home().await.unwrap_or_default();
            if home.is_empty() {
                Err("Could not determine gpg-agent socket path".to_string())
            } else {
                Ok(format!("{}/S.gpg-agent", home))
            }
        }
    }

    /// Find the gpg-connect-agent binary.
    async fn find_connect_agent(&self) -> String {
        // Try gpg-connect-agent in PATH
        let output = self
            .run_helper(
                "gpg-connect-agent",
                &["--version"],
                None,
                DISCOVERY_HELPER_LIMITS,
            )
            .await;
        if output.is_ok_and(|result| result.status.success()) {
            return "gpg-connect-agent".to_string();
        }

        // Try alongside the gpg binary
        if !self.gpg_binary.is_empty() {
            let dir = std::path::Path::new(&self.gpg_binary)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if !dir.is_empty() {
                let candidate = format!("{}/gpg-connect-agent", dir);
                if std::path::Path::new(&candidate).exists() {
                    return candidate;
                }
                let candidate_exe = format!("{}/gpg-connect-agent.exe", dir);
                if std::path::Path::new(&candidate_exe).exists() {
                    return candidate_exe;
                }
            }
        }

        "gpg-connect-agent".to_string()
    }

    /// Get GPG home directory.
    async fn get_gpg_home(&self) -> Result<String, String> {
        if let Some(home) = &self.home_dir {
            return Ok(home.clone());
        }

        let output = self
            .run_helper(
                "gpgconf",
                &["--list-dirs", "homedir"],
                None,
                DISCOVERY_HELPER_LIMITS,
            )
            .await?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err("Could not determine GPG home directory".to_string())
        }
    }
}

// ── Helper: run a gpg command and capture output ────────────────────

/// Execute a gpg command and return stdout as a string.
pub async fn run_gpg_command(gpg_binary: &str, args: &[&str]) -> Result<String, String> {
    debug!("Running gpg command ({} arguments)", args.len());

    let output = run_gpg_command_classified(gpg_binary, args).await?;
    let stdout = output.into_success_bytes()?;
    Ok(String::from_utf8_lossy(&stdout).into_owned())
}

pub(crate) async fn run_gpg_command_classified(
    gpg_binary: &str,
    args: &[&str],
) -> Result<GpgCommandResult, String> {
    let output = run_trusted_helper(gpg_binary, args, None, COMMAND_HELPER_LIMITS).await?;
    Ok(classify_helper_output(output))
}

/// Execute a gpg command and return raw stdout bytes.
pub async fn run_gpg_command_bytes(gpg_binary: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    debug!(
        "Running gpg command for byte output ({} arguments)",
        args.len()
    );

    run_gpg_command_classified(gpg_binary, args)
        .await?
        .into_success_bytes()
}

/// Execute a gpg command with stdin input.
pub async fn run_gpg_command_with_input(
    gpg_binary: &str,
    args: &[&str],
    input: &[u8],
) -> Result<Vec<u8>, String> {
    debug!(
        "Running gpg command with input ({} arguments, {} input bytes)",
        args.len(),
        input.len()
    );

    if input.len() > COMMAND_HELPER_LIMITS.stdin_cap {
        return Err(HELPER_INPUT_LIMIT_ERROR.to_string());
    }
    run_gpg_command_with_input_classified(gpg_binary, args, input)
        .await?
        .into_success_bytes()
}

pub(crate) async fn run_gpg_command_with_input_classified(
    gpg_binary: &str,
    args: &[&str],
    input: &[u8],
) -> Result<GpgCommandResult, String> {
    if input.len() > COMMAND_HELPER_LIMITS.stdin_cap {
        return Err(HELPER_INPUT_LIMIT_ERROR.to_string());
    }
    let input = Zeroizing::new(input.to_vec());
    let output = run_trusted_helper(gpg_binary, args, Some(input), COMMAND_HELPER_LIMITS).await?;
    Ok(classify_helper_output(output))
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    const FAKE_HELPER_ARGS: &[&str] = &[
        "--ignored",
        "fake_gpg_helper",
        "--nocapture",
        "--test-threads=1",
    ];

    fn fake_helper_limits(deadline: Duration, output_cap: usize) -> HelperLimits {
        HelperLimits {
            deadline,
            stdin_cap: 4096,
            stdout_cap: output_cap,
            stderr_cap: output_cap,
        }
    }

    #[test]
    #[ignore = "spawned only as a deterministic fake GPG helper"]
    fn fake_gpg_helper() {
        match std::env::var("SORNG_GPG_FAKE_MODE").as_deref() {
            Ok("timeout") => {
                let started = std::env::var("SORNG_GPG_FAKE_STARTED").unwrap();
                let completed = std::env::var("SORNG_GPG_FAKE_COMPLETED").unwrap();
                if std::env::var_os("SORNG_GPG_FAKE_LEAF").is_some() {
                    for _ in 0..600 {
                        let mut heartbeat = std::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&completed)
                            .unwrap();
                        heartbeat.write_all(b"x").unwrap();
                        heartbeat.flush().unwrap();
                        std::thread::sleep(Duration::from_millis(50));
                    }
                } else {
                    let executable = std::env::current_exe().unwrap();
                    let mut leaf = std::process::Command::new(executable)
                        .args(FAKE_HELPER_ARGS)
                        .env("SORNG_GPG_FAKE_MODE", "timeout")
                        .env("SORNG_GPG_FAKE_LEAF", "1")
                        .env("SORNG_GPG_FAKE_STARTED", &started)
                        .env("SORNG_GPG_FAKE_COMPLETED", &completed)
                        .spawn()
                        .unwrap();
                    for _ in 0..50 {
                        if Path::new(&completed).exists() {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    std::fs::write(started, b"started").unwrap();
                    let _ = leaf.wait();
                }
            }
            Ok("output-cap") => {
                let output = vec![b'x'; 128 * 1024];
                std::io::stdout().write_all(&output).unwrap();
                std::io::stderr().write_all(&output).unwrap();
            }
            Ok("secret-error") => {
                let secret = std::env::var("SORNG_GPG_FAKE_SECRET").unwrap();
                std::io::stdout().flush().unwrap();
                std::io::stderr().write_all(secret.as_bytes()).unwrap();
                std::io::stderr().flush().unwrap();
                std::process::exit(23);
            }
            Ok("card-absent") => {
                std::io::stderr()
                    .write_all(b"[GNUPG:] CARDCTRL 6\ngpg: selecting card failed\n")
                    .unwrap();
                std::io::stderr().flush().unwrap();
                std::process::exit(2);
            }
            Ok("bad-signature") => {
                std::io::stdout()
                    .write_all(b"[GNUPG:] BADSIG DEADBEEF Test User\n")
                    .unwrap();
                std::io::stdout().flush().unwrap();
                std::process::exit(1);
            }
            _ => std::process::exit(24),
        }
    }

    #[tokio::test]
    async fn helper_timeout_terminates_and_reaps_child() {
        let executable = std::env::current_exe().unwrap();
        let executable = executable.to_string_lossy().into_owned();
        let id = uuid::Uuid::new_v4();
        let started = std::env::temp_dir().join(format!("sorng-gpg-{id}.started"));
        let completed = std::env::temp_dir().join(format!("sorng-gpg-{id}.completed"));
        let started_value = started.to_string_lossy().into_owned();
        let completed_value = completed.to_string_lossy().into_owned();
        let environment = [
            ("SORNG_GPG_FAKE_MODE", "timeout"),
            ("SORNG_GPG_FAKE_STARTED", started_value.as_str()),
            ("SORNG_GPG_FAKE_COMPLETED", completed_value.as_str()),
        ];

        let result = run_trusted_helper_with_env(
            &executable,
            FAKE_HELPER_ARGS,
            None,
            fake_helper_limits(Duration::from_secs(2), 64 * 1024),
            &environment,
        )
        .await;

        assert_eq!(result.err().as_deref(), Some(HELPER_TIMEOUT_ERROR));
        assert!(started.exists(), "fake helper did not start");
        let heartbeat_size = std::fs::metadata(&completed).map(|m| m.len()).unwrap_or(0);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(
            std::fs::metadata(&completed).map(|m| m.len()).unwrap_or(0),
            heartbeat_size,
            "a descendant of the timed-out helper was left running"
        );
        let _ = std::fs::remove_file(started);
        let _ = std::fs::remove_file(completed);
    }

    #[tokio::test]
    async fn helper_caps_stdout_and_stderr() {
        let executable = std::env::current_exe().unwrap();
        let executable = executable.to_string_lossy().into_owned();
        let environment = [("SORNG_GPG_FAKE_MODE", "output-cap")];
        let result = run_trusted_helper_with_env(
            &executable,
            FAKE_HELPER_ARGS,
            None,
            fake_helper_limits(Duration::from_secs(5), 1024),
            &environment,
        )
        .await;

        assert_eq!(result.err().as_deref(), Some(HELPER_OUTPUT_LIMIT_ERROR));
    }

    #[tokio::test]
    async fn helper_errors_do_not_disclose_secret_output() {
        let executable = std::env::current_exe().unwrap();
        let executable = executable.to_string_lossy().into_owned();
        let secret = "test-passphrase-do-not-disclose";
        let environment = [
            ("SORNG_GPG_FAKE_MODE", "secret-error"),
            ("SORNG_GPG_FAKE_SECRET", secret),
        ];
        let output = match run_trusted_helper_with_env(
            &executable,
            FAKE_HELPER_ARGS,
            Some(Zeroizing::new(secret.as_bytes().to_vec())),
            fake_helper_limits(Duration::from_secs(5), 64 * 1024),
            &environment,
        )
        .await
        {
            Ok(output) => output,
            Err(error) => panic!("fake helper failed unexpectedly: {error}"),
        };
        let error = match classify_helper_output(output).into_success_bytes() {
            Ok(_) => panic!("non-zero fake helper unexpectedly succeeded"),
            Err(error) => error,
        };

        assert_eq!(error, HELPER_EXECUTION_ERROR);
        assert!(!error.contains(secret));
    }

    #[tokio::test]
    async fn helper_status_is_classified_without_exposing_diagnostics() {
        let executable = std::env::current_exe().unwrap();
        let executable = executable.to_string_lossy().into_owned();
        for (mode, expected) in [
            ("card-absent", GpgCommandStatus::CardAbsent),
            ("bad-signature", GpgCommandStatus::BadSignature),
        ] {
            let environment = [("SORNG_GPG_FAKE_MODE", mode)];
            let output = match run_trusted_helper_with_env(
                &executable,
                FAKE_HELPER_ARGS,
                None,
                fake_helper_limits(Duration::from_secs(5), 64 * 1024),
                &environment,
            )
            .await
            {
                Ok(output) => output,
                Err(error) => panic!("fake helper failed unexpectedly: {error}"),
            };
            let result = classify_helper_output(output);
            assert_eq!(result.status(), expected);
            assert!(!result.sanitized_error().contains("DEADBEEF"));
            assert!(!result.sanitized_error().contains("selecting card"));
        }
    }

    #[test]
    fn test_assuan_percent_encode() {
        assert_eq!(assuan_percent_encode("hello"), "hello");
        assert_eq!(assuan_percent_encode("hello%world"), "hello%25world");
        assert_eq!(assuan_percent_encode("line\none"), "line%0Aone");
    }

    #[test]
    fn test_assuan_percent_decode() {
        assert_eq!(assuan_percent_decode("hello"), b"hello");
        assert_eq!(assuan_percent_decode("hello%25world"), b"hello%world");
        assert_eq!(assuan_percent_decode("line%0Aone"), b"line\none");
    }

    #[test]
    fn test_parse_ok() {
        let resp = parse_assuan_line("OK Pleased to meet you");
        assert!(matches!(resp, Some(AssuanResponse::Ok(ref m)) if m == "Pleased to meet you"));
    }

    #[test]
    fn test_parse_err() {
        let resp = parse_assuan_line("ERR 67108881 Not supported <gpg-agent>");
        let Some(AssuanResponse::Err(code, msg)) = resp else {
            unreachable!("Expected Err response");
        };
        assert_eq!(code, 67108881);
        assert_eq!(msg, "Not supported <gpg-agent>");
    }

    #[test]
    fn test_parse_data() {
        let resp = parse_assuan_line("D Hello%20World");
        let Some(AssuanResponse::Data(d)) = resp else {
            unreachable!("Expected Data response");
        };
        assert_eq!(String::from_utf8_lossy(&d), "Hello World");
    }

    #[test]
    fn test_parse_status() {
        let resp = parse_assuan_line("S PROGRESS learncard k 0 0");
        let Some(AssuanResponse::Status(kw, args)) = resp else {
            unreachable!("Expected Status response");
        };
        assert_eq!(kw, "PROGRESS");
        assert_eq!(args, "learncard k 0 0");
    }

    #[test]
    fn test_parse_inquire() {
        let resp = parse_assuan_line("INQUIRE PINENTRY.PIN");
        let Some(AssuanResponse::Inquire(kw, _)) = resp else {
            unreachable!("Expected Inquire response");
        };
        assert_eq!(kw, "PINENTRY.PIN");
    }

    #[test]
    fn test_parse_comment() {
        let resp = parse_assuan_line("# this is a comment");
        assert!(matches!(resp, Some(AssuanResponse::Comment(_))));
    }

    #[test]
    fn test_parse_multi_line_output() {
        let output = "S SERIALNO D27600012401033000050000XXXX\n\
                       S DISP-NAME Smith<<John\n\
                       OK\n";
        let result = parse_assuan_output(output);
        assert!(result.ok);
        assert_eq!(result.status_lines.len(), 2);
        assert_eq!(
            result.get_status("SERIALNO"),
            Some("D27600012401033000050000XXXX")
        );
    }

    #[test]
    fn test_assuan_result_data() {
        let output = "D line one\nD line two\nOK\n";
        let result = parse_assuan_output(output);
        assert!(result.ok);
        assert_eq!(result.data_lines.len(), 2);
        assert_eq!(result.data_as_string(), "line oneline two");
    }

    #[test]
    fn test_parse_error_output() {
        let output = "ERR 100 some error\n";
        let result = parse_assuan_output(output);
        assert!(!result.ok);
        assert_eq!(result.error_code, 100);
        assert_eq!(result.error_message, "some error");
    }

    #[test]
    fn test_empty_line() {
        assert!(parse_assuan_line("").is_none());
    }

    #[test]
    fn test_assuan_client_new() {
        let client = AssuanClient::new("gpg", Some("/tmp/isolated-gnupg".to_string()));
        assert_eq!(client.gpg_binary, "gpg");
        assert_eq!(client.home_dir.as_deref(), Some("/tmp/isolated-gnupg"));
        assert!(!client.connected);
    }

    #[test]
    fn scd_sign_script_consumes_digest_in_same_session() {
        let digest = [0xabu8; 32];
        let script = build_scd_data_script(
            "OPENPGP.1",
            &digest,
            ScdDataOperation::Sign {
                hash_algorithm: scd_hash_algorithm(&digest).unwrap(),
            },
        )
        .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&script),
            format!(
                "/subst\nSCD SETDATA {}\n/if ${{! $?}}\nSCD PKSIGN --hash=sha256 OPENPGP.1\n/end\n/bye\n",
                "AB".repeat(32)
            )
        );
    }

    #[test]
    fn scd_decrypt_script_consumes_ciphertext_in_same_session() {
        let script = build_scd_data_script(
            "OPENPGP.2",
            &[0x00, 0x01, 0xfe, 0xff],
            ScdDataOperation::Decrypt,
        )
        .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&script),
            "/subst\nSCD SETDATA 0001FEFF\n/if ${! $?}\nSCD PKDECRYPT OPENPGP.2\n/end\n/bye\n"
        );
    }

    #[test]
    fn scd_data_operations_reject_unsafe_or_unsupported_inputs() {
        assert!(build_scd_data_script(
            "OPENPGP.1\nSCD RESET",
            &[1; 32],
            ScdDataOperation::Sign {
                hash_algorithm: "sha256",
            },
        )
        .is_err());
        assert!(build_scd_data_script("OPENPGP.2", &[], ScdDataOperation::Decrypt).is_err());
        assert!(scd_hash_algorithm(&[0; 31]).is_err());
        assert!(build_scd_data_script(
            "OPENPGP.2",
            &vec![0; ASSUAN_COMMAND_LINE_CAP],
            ScdDataOperation::Decrypt,
        )
        .is_err());
    }

    #[test]
    fn scd_data_response_vectors_propagate_each_failure() {
        let operation = ScdDataOperation::Decrypt;
        let result =
            parse_scd_data_operation_output("OK\nS PADDING 0\nD plain%20text\nOK\n", operation)
                .unwrap();
        assert_eq!(result.data_lines, vec![b"plain text".to_vec()]);
        assert_eq!(result.get_status("PADDING"), Some("0"));

        assert_eq!(
            parse_scd_data_operation_output("ERR 100 rejected\n", operation).unwrap_err(),
            "SCD SETDATA failed (agent code 100)"
        );
        assert_eq!(
            parse_scd_data_operation_output("OK\nERR 200 rejected\n", operation).unwrap_err(),
            "SCD PKDECRYPT failed (agent code 200)"
        );
        assert_eq!(
            parse_scd_data_operation_output("OK\nD stale\n", operation).unwrap_err(),
            "Smart-card operation did not complete"
        );
    }
}
