//! # opkssh OIDC Login
//!
//! Handle the `opkssh login` flow, which opens a browser for OIDC authentication
//! and generates an SSH key containing the PK Token.

use crate::service::OpksshServiceState;
use crate::types::*;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock, Weak};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, watch, Mutex, Notify};
use tokio::task::JoinHandle;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const LOGIN_CANCELLED_MESSAGE: &str = "Login wait cancelled locally. Callback listener bind/shutdown remain provider-owned in this Phase C slice, so external browser/provider activity may still continue.";
const LOGIN_DEADLINE: Duration = Duration::from_secs(10 * 60);
const LOGIN_STDOUT_LIMIT: usize = 256 * 1024;
const LOGIN_STDERR_LIMIT: usize = 256 * 1024;
const LOGIN_CANCEL_GRACE: Duration = Duration::from_secs(5);
const LOGIN_REAP_GRACE: Duration = Duration::from_secs(5);
const LOGIN_ABORT_GRACE: Duration = Duration::from_secs(1);
const LOGIN_PIPE_DRAIN_GRACE: Duration = Duration::from_secs(2);
const LOGIN_OPERATION_CAP: usize = 32;
const LOGIN_TERMINAL_OPERATION_CAP: usize = 16;
const LOGIN_TERMINAL_TTL_MINUTES: i64 = 10;

#[derive(Clone, Default)]
struct LoginProcessLifecycle {
    child_started: Arc<AtomicBool>,
    child_reaped: Arc<AtomicBool>,
    child_reaped_notify: Arc<Notify>,
    process_tree: Arc<StdMutex<Option<Weak<LoginProcessTree>>>>,
}

impl LoginProcessLifecycle {
    fn mark_started(&self) {
        self.child_started.store(true, Ordering::Release);
    }

    fn mark_reaped(&self) {
        self.child_reaped.store(true, Ordering::Release);
        self.child_reaped_notify.notify_waiters();
    }

    fn clear_process_tree(&self) {
        self.process_tree
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
    }

    fn register_process_tree(&self, process_tree: &Arc<LoginProcessTree>) {
        *self
            .process_tree
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some(Arc::downgrade(process_tree));
    }

    async fn terminate_process_tree(&self) -> bool {
        let process_tree = self
            .process_tree
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .and_then(Weak::upgrade);
        if let Some(process_tree) = process_tree {
            process_tree.terminate().await;
            true
        } else {
            false
        }
    }

    fn child_started(&self) -> bool {
        self.child_started.load(Ordering::Acquire)
    }

    fn child_reaped(&self) -> bool {
        self.child_reaped.load(Ordering::Acquire)
    }

    async fn wait_until_reaped(&self) {
        while !self.child_reaped() {
            let notified = self.child_reaped_notify.notified();
            if self.child_reaped() {
                break;
            }
            notified.await;
        }
    }
}

#[derive(Clone)]
struct LoginProcessContext {
    cancellation: watch::Receiver<bool>,
    lifecycle: LoginProcessLifecycle,
}

impl LoginProcessContext {
    fn new() -> (watch::Sender<bool>, Self) {
        let (cancellation, receiver) = watch::channel(false);
        (
            cancellation,
            Self {
                cancellation: receiver,
                lifecycle: LoginProcessLifecycle::default(),
            },
        )
    }
}

tokio::task_local! {
    static LOGIN_PROCESS_CONTEXT: LoginProcessContext;
}

type LoginOperationTaskResult = Result<OpksshLoginResult, String>;
type SharedLoginOperation = Arc<Mutex<PendingLoginOperation>>;

#[derive(Default)]
struct LoginOperationRegistry {
    entries: HashMap<String, SharedLoginOperation>,
    terminal_finished_at: HashMap<String, DateTime<Utc>>,
}

impl LoginOperationRegistry {
    fn oldest_terminal_id(&self) -> Option<String> {
        self.terminal_finished_at
            .iter()
            .min_by(|left, right| left.1.cmp(right.1))
            .map(|(id, _)| id.clone())
    }

    fn remove(&mut self, operation_id: &str) {
        self.entries.remove(operation_id);
        self.terminal_finished_at.remove(operation_id);
    }

    fn prune(&mut self, now: DateTime<Utc>) {
        let cutoff = now - ChronoDuration::minutes(LOGIN_TERMINAL_TTL_MINUTES);
        let expired: Vec<String> = self
            .terminal_finished_at
            .iter()
            .filter(|(_, finished_at)| **finished_at < cutoff)
            .map(|(id, _)| id.clone())
            .collect();
        for operation_id in expired {
            self.remove(&operation_id);
        }

        while self.terminal_finished_at.len() > LOGIN_TERMINAL_OPERATION_CAP {
            let Some(operation_id) = self.oldest_terminal_id() else {
                break;
            };
            self.remove(&operation_id);
        }
    }

    fn make_room_for_running(&mut self, now: DateTime<Utc>) -> Result<(), String> {
        self.prune(now);
        while self.entries.len() >= LOGIN_OPERATION_CAP {
            let Some(operation_id) = self.oldest_terminal_id() else {
                return Err(format!(
                    "Too many OPKSSH login operations are already running (limit {LOGIN_OPERATION_CAP})"
                ));
            };
            self.remove(&operation_id);
        }
        Ok(())
    }

    fn record_terminal(&mut self, operation_id: &str, finished_at: DateTime<Utc>) {
        self.record_terminal_at(operation_id, finished_at, Utc::now());
    }

    fn record_terminal_at(
        &mut self,
        operation_id: &str,
        finished_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) {
        if self.entries.contains_key(operation_id) {
            self.terminal_finished_at
                .insert(operation_id.to_string(), finished_at);
        }
        self.prune(now);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OpksshLoginOperationStatus {
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshLoginOperation {
    pub id: String,
    pub status: OpksshLoginOperationStatus,
    pub provider: Option<String>,
    pub runtime: OpksshRuntimeStatus,
    pub browser_url: Option<String>,
    pub can_cancel: bool,
    pub message: Option<String>,
    pub result: Option<OpksshLoginResult>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

struct PendingLoginOperation {
    snapshot: OpksshLoginOperation,
    task: Option<JoinHandle<LoginOperationTaskResult>>,
    cancellation: Option<watch::Sender<bool>>,
    process_lifecycle: LoginProcessLifecycle,
    completion_notify: Arc<Notify>,
}

fn login_operations() -> &'static Mutex<LoginOperationRegistry> {
    static REGISTRY: OnceLock<Mutex<LoginOperationRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(LoginOperationRegistry::default()))
}

fn resolve_operation_provider(opts: &OpksshLoginOptions) -> Option<String> {
    opts.provider
        .clone()
        .or_else(|| opts.issuer.as_ref().map(|_| "custom-provider".to_string()))
}

fn finalize_operation(snapshot: &mut OpksshLoginOperation, outcome: LoginOperationTaskResult) {
    snapshot.finished_at = Some(Utc::now());
    snapshot.can_cancel = false;

    match outcome {
        Ok(result) => {
            snapshot.status = if result.success {
                OpksshLoginOperationStatus::Succeeded
            } else {
                OpksshLoginOperationStatus::Failed
            };
            snapshot.message = Some(result.message.clone());
            snapshot.result = Some(result);
        }
        Err(message) => {
            snapshot.status = OpksshLoginOperationStatus::Failed;
            snapshot.message = Some(message);
            snapshot.result = None;
        }
    }
}

fn mark_operation_cancelled(snapshot: &mut OpksshLoginOperation) {
    snapshot.status = OpksshLoginOperationStatus::Cancelled;
    snapshot.can_cancel = false;
    snapshot.finished_at = Some(Utc::now());
    snapshot.message = Some(LOGIN_CANCELLED_MESSAGE.to_string());
    snapshot.result = None;
}

fn zeroize_operation_details(snapshot: &mut OpksshLoginOperation) {
    if let Some(provider) = snapshot.provider.as_mut() {
        provider.zeroize();
    }
    if let Some(browser_url) = snapshot.browser_url.as_mut() {
        browser_url.zeroize();
    }
    if let Some(message) = snapshot.message.as_mut() {
        message.zeroize();
    }
    if let Some(result) = snapshot.result.as_mut() {
        if let Some(key_path) = result.key_path.as_mut() {
            key_path.zeroize();
        }
        if let Some(identity) = result.identity.as_mut() {
            identity.zeroize();
        }
        if let Some(provider) = result.provider.as_mut() {
            provider.zeroize();
        }
        result.message.zeroize();
        result.raw_output.zeroize();
    }
}

fn compact_terminal_snapshot(snapshot: &mut OpksshLoginOperation) {
    zeroize_operation_details(snapshot);
    snapshot.provider = None;
    snapshot.browser_url = None;
    snapshot.result = None;
    snapshot.can_cancel = false;
    snapshot.message = Some(
        match snapshot.status {
            OpksshLoginOperationStatus::Running => "OPKSSH login is running",
            OpksshLoginOperationStatus::Succeeded => "OPKSSH login completed successfully",
            OpksshLoginOperationStatus::Failed => "OPKSSH login failed",
            OpksshLoginOperationStatus::Cancelled => "OPKSSH login was cancelled locally",
        }
        .to_string(),
    );
}

async fn store_operation_outcome(
    operation_id: &str,
    entry: &SharedLoginOperation,
    outcome: LoginOperationTaskResult,
) -> OpksshLoginOperation {
    let (completed, finished_at) = {
        let mut pending = entry.lock().await;
        pending.task.take();
        pending.cancellation.take();
        if matches!(
            outcome.as_ref(),
            Err(message) if message == LoginProcessError::Cancelled.message()
        ) {
            mark_operation_cancelled(&mut pending.snapshot);
        } else {
            finalize_operation(&mut pending.snapshot, outcome);
        }
        let completed = pending.snapshot.clone();
        compact_terminal_snapshot(&mut pending.snapshot);
        let finished_at = pending.snapshot.finished_at.unwrap_or_else(Utc::now);
        pending.completion_notify.notify_waiters();
        (completed, finished_at)
    };

    login_operations()
        .lock()
        .await
        .record_terminal(operation_id, finished_at);
    completed
}

async fn store_cancelled_operation(
    operation_id: &str,
    entry: &SharedLoginOperation,
) -> OpksshLoginOperation {
    let (completed, finished_at) = {
        let mut pending = entry.lock().await;
        pending.task.take();
        pending.cancellation.take();
        mark_operation_cancelled(&mut pending.snapshot);
        let completed = pending.snapshot.clone();
        compact_terminal_snapshot(&mut pending.snapshot);
        let finished_at = pending.snapshot.finished_at.unwrap_or_else(Utc::now);
        pending.completion_notify.notify_waiters();
        (completed, finished_at)
    };

    login_operations()
        .lock()
        .await
        .record_terminal(operation_id, finished_at);
    completed
}

async fn wait_for_task_owner(entry: &SharedLoginOperation) {
    loop {
        let notify = {
            let pending = entry.lock().await;
            if pending.snapshot.status != OpksshLoginOperationStatus::Running
                || pending.task.is_some()
            {
                return;
            }
            pending.completion_notify.clone()
        };
        let notified = notify.notified();
        {
            let pending = entry.lock().await;
            if pending.snapshot.status != OpksshLoginOperationStatus::Running
                || pending.task.is_some()
            {
                return;
            }
        }
        notified.await;
    }
}

pub async fn start_login_operation(
    service_state: OpksshServiceState,
    opts: OpksshLoginOptions,
) -> Result<OpksshLoginOperation, String> {
    validate_login_options(&opts).map_err(|error| error.message().to_string())?;
    let (runtime, leased_cli_path) = {
        let mut svc = service_state.lock().await;
        let runtime = svc.refresh_runtime_status().await;
        let leased_cli_path = if matches!(runtime.active_backend, Some(OpksshBackendKind::Cli)) {
            svc.get_binary_path().cloned()
        } else {
            None
        };
        (runtime, leased_cli_path)
    };

    if runtime.active_backend.is_none() {
        return Err(runtime.message.clone().unwrap_or_else(|| {
            "No OPKSSH runtime is currently available. The in-process library path is not linked yet and the CLI fallback was not found.".to_string()
        }));
    }
    if matches!(runtime.active_backend, Some(OpksshBackendKind::Cli)) && leased_cli_path.is_none() {
        return Err("The selected OPKSSH CLI runtime has no executable path".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let snapshot = OpksshLoginOperation {
        id: id.clone(),
        status: OpksshLoginOperationStatus::Running,
        provider: resolve_operation_provider(&opts),
        runtime: runtime.clone(),
        browser_url: None,
        can_cancel: true,
        message: runtime.message.clone(),
        result: None,
        started_at: Utc::now(),
        finished_at: None,
    };

    let task_state = service_state.clone();
    let (cancellation, process_context) = LoginProcessContext::new();
    let process_lifecycle = process_context.lifecycle.clone();
    let completion_notify = Arc::new(Notify::new());
    let entry = Arc::new(Mutex::new(PendingLoginOperation {
        snapshot: snapshot.clone(),
        task: None,
        cancellation: Some(cancellation),
        process_lifecycle,
        completion_notify,
    }));

    let mut registry = login_operations().lock().await;
    registry.make_room_for_running(Utc::now())?;

    let task_entry = entry.clone();
    let task_id = id.clone();
    let task_snapshot = snapshot.clone();
    let (start_sender, start_receiver) = oneshot::channel();
    let task = tokio::spawn(async move {
        let _ = start_receiver.await;
        let outcome = LOGIN_PROCESS_CONTEXT
            .scope(process_context, async move {
                if let Some(binary_path) = leased_cli_path {
                    let outcome = execute_login(&binary_path, &opts).await.map(|mut result| {
                        result.clear_raw_output();
                        result
                    });
                    let mut service_snapshot = task_snapshot;
                    if matches!(
                        outcome.as_ref(),
                        Err(message) if message == LoginProcessError::Cancelled.message()
                    ) {
                        mark_operation_cancelled(&mut service_snapshot);
                    } else {
                        finalize_operation(&mut service_snapshot, outcome.clone());
                    }
                    task_state
                        .lock()
                        .await
                        .track_login_operation(&service_snapshot);
                    outcome
                } else {
                    task_state.lock().await.login(opts).await
                }
            })
            .await;
        store_operation_outcome(&task_id, &task_entry, outcome.clone()).await;
        outcome
    });
    entry
        .try_lock()
        .expect("new OPKSSH login entry cannot be contended before publication")
        .task = Some(task);
    registry.entries.insert(id, entry);
    drop(registry);
    let _ = start_sender.send(());

    Ok(snapshot)
}

pub async fn get_login_operation(
    operation_id: &str,
) -> Result<Option<OpksshLoginOperation>, String> {
    let entry = {
        let mut registry = login_operations().lock().await;
        registry.prune(Utc::now());
        registry.entries.get(operation_id).cloned()
    };

    let Some(entry) = entry else {
        return Ok(None);
    };

    let pending = entry.lock().await;
    Ok(Some(pending.snapshot.clone()))
}

pub async fn await_login_operation(operation_id: &str) -> Result<OpksshLoginOperation, String> {
    let entry = {
        let mut registry = login_operations().lock().await;
        registry.prune(Utc::now());
        registry
            .entries
            .get(operation_id)
            .cloned()
            .ok_or_else(|| format!("OPKSSH login operation '{operation_id}' was not found"))?
    };

    loop {
        let task_and_snapshot = {
            let mut pending = entry.lock().await;
            if pending.snapshot.status != OpksshLoginOperationStatus::Running {
                return Ok(pending.snapshot.clone());
            }
            pending.task.take().map(|task| {
                pending.snapshot.can_cancel = false;
                // Keep the sender in the registry while this waiter owns the
                // task. Dropping the sole sender closes the watch channel,
                // which the process supervisor treats as cancellation.
                (task, pending.snapshot.clone())
            })
        };

        let Some((task, mut completed)) = task_and_snapshot else {
            wait_for_task_owner(&entry).await;
            continue;
        };
        let outcome = task
            .await
            .unwrap_or_else(|error| Err(format!("OPKSSH login operation task failed: {error}")));
        if matches!(
            outcome.as_ref(),
            Err(message) if message == LoginProcessError::Cancelled.message()
        ) {
            mark_operation_cancelled(&mut completed);
        } else {
            finalize_operation(&mut completed, outcome);
        }
        return Ok(completed);
    }
}

pub async fn cancel_login_operation(operation_id: &str) -> Result<OpksshLoginOperation, String> {
    let entry = {
        let mut registry = login_operations().lock().await;
        registry.prune(Utc::now());
        registry
            .entries
            .get(operation_id)
            .cloned()
            .ok_or_else(|| format!("OPKSSH login operation '{operation_id}' was not found"))?
    };

    let (mut task, cancellation, process_lifecycle, already_finished, mut completed) = loop {
        let task_state = {
            let mut pending = entry.lock().await;
            if pending.snapshot.status != OpksshLoginOperationStatus::Running {
                return Ok(pending.snapshot.clone());
            }
            pending.task.take().map(|task| {
                let already_finished = task.is_finished();
                (
                    task,
                    pending.cancellation.take(),
                    pending.process_lifecycle.clone(),
                    already_finished,
                    pending.snapshot.clone(),
                )
            })
        };
        if let Some(task_state) = task_state {
            break task_state;
        }
        wait_for_task_owner(&entry).await;
    };

    if already_finished {
        let outcome = task
            .await
            .unwrap_or_else(|error| Err(format!("OPKSSH login operation task failed: {error}")));
        finalize_operation(&mut completed, outcome);
        return Ok(completed);
    }

    if let Some(cancellation) = cancellation {
        let _ = cancellation.send(true);
    }

    if let Err(message) = stop_login_task(
        &mut task,
        &process_lifecycle,
        LoginCancellationLimits::default(),
    )
    .await
    {
        store_operation_outcome(operation_id, &entry, Err(message.clone())).await;
        return Err(message);
    }

    Ok(store_cancelled_operation(operation_id, &entry).await)
}

#[derive(Clone, Copy)]
struct LoginCancellationLimits {
    cooperative_grace: Duration,
    reap_grace: Duration,
    abort_grace: Duration,
}

impl Default for LoginCancellationLimits {
    fn default() -> Self {
        Self {
            cooperative_grace: LOGIN_CANCEL_GRACE,
            reap_grace: LOGIN_REAP_GRACE,
            abort_grace: LOGIN_ABORT_GRACE,
        }
    }
}

async fn stop_login_task(
    task: &mut JoinHandle<LoginOperationTaskResult>,
    process_lifecycle: &LoginProcessLifecycle,
    limits: LoginCancellationLimits,
) -> Result<(), String> {
    if tokio::time::timeout(limits.cooperative_grace, &mut *task)
        .await
        .is_ok()
    {
        return Ok(());
    }

    if process_lifecycle.child_started() {
        let _ = tokio::time::timeout(
            limits.reap_grace,
            process_lifecycle.terminate_process_tree(),
        )
        .await;
        let reaped = process_lifecycle.child_reaped()
            || tokio::time::timeout(limits.reap_grace, process_lifecycle.wait_until_reaped())
                .await
                .is_ok();
        if !reaped {
            task.abort();
            let _ = tokio::time::timeout(limits.abort_grace, &mut *task).await;
            return Err(
                "OPKSSH login cancellation could not confirm that the CLI child was reaped"
                    .to_string(),
            );
        }
    }

    task.abort();
    if tokio::time::timeout(limits.abort_grace, &mut *task)
        .await
        .is_err()
    {
        return Err("OPKSSH login cancellation task did not stop before its deadline".to_string());
    }
    Ok(())
}

pub async fn run_login_operation(
    service_state: OpksshServiceState,
    opts: OpksshLoginOptions,
) -> Result<OpksshLoginResult, String> {
    let operation = start_login_operation(service_state, opts).await?;
    let completed = await_login_operation(&operation.id).await?;

    if let Some(result) = completed.result {
        return Ok(result);
    }

    Err(completed
        .message
        .unwrap_or_else(|| "OPKSSH login did not produce a result".to_string()))
}

/// Synthetic provider alias used to reference a custom inline provider that is
/// supplied to the opkssh CLI through the `OPKSSH_PROVIDERS` environment
/// variable instead of on the (world-readable) process argv.
const INLINE_PROVIDER_ALIAS: &str = "sorng-inline-provider";

/// Returns `true` when a custom provider is present. The entire custom provider
/// record is kept off argv, including issuer, client id, secret, and scopes.
fn uses_inline_provider(opts: &OpksshLoginOptions) -> bool {
    opts.issuer.is_some()
}

/// Build the `OPKSSH_PROVIDERS` env value for an inline custom provider so the
/// `client_secret` never appears on the process command line.
///
/// Format (matches opkssh upstream + `providers::parse_env_providers`):
/// `alias,issuer,client_id,client_secret,scopes`.
///
/// Returns `None` only for built-in provider aliases. Custom provider material
/// is always supplied through the child environment and never through argv.
pub fn build_login_env_providers(opts: &OpksshLoginOptions) -> Option<String> {
    if !uses_inline_provider(opts) {
        return None;
    }

    let issuer = opts.issuer.as_deref().unwrap_or_default();
    let client_id = opts.client_id.as_deref().unwrap_or_default();
    let secret = opts.client_secret.as_deref().unwrap_or_default();
    let scopes = opts.scopes.as_deref().unwrap_or_default();

    Some(format!(
        "{INLINE_PROVIDER_ALIAS},{issuer},{client_id},{secret},{scopes}"
    ))
}

/// Build the command-line arguments for `opkssh login`.
///
/// SECURITY: the OIDC `client_secret` is NEVER placed on argv (process argv is
/// world-readable via `ps`/`/proc/<pid>/cmdline`). When an inline custom
/// provider carries a secret, the full provider triple is supplied to the
/// opkssh child through the `OPKSSH_PROVIDERS` environment variable (see
/// [`build_login_env_providers`]) and argv only references the synthetic
/// [`INLINE_PROVIDER_ALIAS`].
pub fn build_login_args(opts: &OpksshLoginOptions) -> Vec<String> {
    let mut args = vec!["login".to_string()];

    if uses_inline_provider(opts) {
        // Provider material is delivered via OPKSSH_PROVIDERS; argv references
        // only the fixed synthetic alias.
        args.push(format!("--provider={}", INLINE_PROVIDER_ALIAS));
    } else {
        // Simple alias like "google", "azure", etc.
        if let Some(ref provider) = opts.provider {
            if opts.issuer.is_none() && opts.client_id.is_none() {
                args.push(provider.clone());
            }
        }
    }

    if let Some(ref key_name) = opts.key_file_name {
        args.push(format!("--key-file-name={}", key_name));
    }

    if opts.create_config {
        args.push("--create-config".to_string());
    }

    if let Some(ref uri) = opts.remote_redirect_uri {
        args.push(format!("--remote-redirect-uri={}", uri));
    }

    args
}

/// Redact any `client_secret` that may appear in an `OPKSSH_PROVIDERS`-style
/// value (`alias,issuer,client_id,client_secret,scopes;...`) so it can be
/// safely logged. The 4th comma-separated field of every entry is replaced
/// with `***`.
pub fn redact_env_providers(env_providers: &str) -> String {
    env_providers
        .split(';')
        .map(|entry| {
            if entry.trim().is_empty() {
                return entry.to_string();
            }
            let mut parts: Vec<String> = entry.split(',').map(|p| p.to_string()).collect();
            if parts.len() > 3 && !parts[3].is_empty() {
                parts[3] = "***".to_string();
            }
            parts.join(",")
        })
        .collect::<Vec<_>>()
        .join(";")
}

#[derive(Debug, Clone, Copy)]
struct LoginProcessLimits {
    deadline: Duration,
    pipe_drain_grace: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
}

impl Default for LoginProcessLimits {
    fn default() -> Self {
        Self {
            deadline: LOGIN_DEADLINE,
            pipe_drain_grace: LOGIN_PIPE_DRAIN_GRACE,
            stdout_limit: LOGIN_STDOUT_LIMIT,
            stderr_limit: LOGIN_STDERR_LIMIT,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum LoginProcessError {
    InvalidExecutable,
    InvalidOptions,
    Spawn,
    Pipe,
    Read,
    Wait,
    Cancelled,
    TimedOut,
    OutputLimit,
    PipeDrain,
    Reap,
}

impl LoginProcessError {
    fn message(&self) -> &'static str {
        match self {
            Self::InvalidExecutable => {
                "The configured OPKSSH executable is not a safe executable file"
            }
            Self::InvalidOptions => "The OPKSSH login options contain invalid provider data",
            Self::Spawn => "Failed to start the OPKSSH CLI fallback",
            Self::Pipe => "Failed to establish bounded OPKSSH output capture",
            Self::Read => "Failed to read bounded OPKSSH output",
            Self::Wait => "Failed while waiting for the OPKSSH CLI fallback",
            Self::Cancelled => "OPKSSH login was cancelled",
            Self::TimedOut => "OPKSSH login exceeded its allowed deadline",
            Self::OutputLimit => "OPKSSH login output exceeded its safe capture limit",
            Self::PipeDrain => "OPKSSH login output pipes did not close before the drain deadline",
            Self::Reap => "Failed to terminate and reap the OPKSSH CLI fallback",
        }
    }
}

#[derive(Debug)]
struct CapturedOutput {
    bytes: Zeroizing<Vec<u8>>,
    exceeded: bool,
}

#[derive(Debug)]
struct LoginProcessOutput {
    status: ExitStatus,
    stdout: Zeroizing<Vec<u8>>,
    stderr: Zeroizing<Vec<u8>>,
}

#[cfg(windows)]
#[repr(C)]
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

#[cfg(windows)]
#[repr(C)]
struct IoCounters {
    read_operation_count: u64,
    write_operation_count: u64,
    other_operation_count: u64,
    read_transfer_count: u64,
    write_transfer_count: u64,
    other_transfer_count: u64,
}

#[cfg(windows)]
#[repr(C)]
struct JobObjectExtendedLimitInformation {
    basic_limit_information: JobObjectBasicLimitInformation,
    io_info: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[cfg(windows)]
unsafe extern "system" {
    fn CreateJobObjectW(attributes: *const core::ffi::c_void, name: *const u16) -> isize;
    fn SetInformationJobObject(
        job: isize,
        information_class: i32,
        information: *const core::ffi::c_void,
        information_length: u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: isize, process: isize) -> i32;
    fn TerminateJobObject(job: isize, exit_code: u32) -> i32;
    fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> isize;
    fn CloseHandle(handle: isize) -> i32;
}

#[cfg(windows)]
struct WindowsProcessJob {
    handle: isize,
}

#[cfg(windows)]
impl WindowsProcessJob {
    fn attach(process_id: u32) -> Option<Self> {
        const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
        const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
        const PROCESS_TERMINATE: u32 = 0x0001;
        const PROCESS_SET_QUOTA: u32 = 0x0100;

        // SAFETY: every handle is checked for null, the information structure
        // has the documented C layout, and all opened handles are closed on
        // every failure path or by Drop.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job == 0 {
                return None;
            }
            let mut limits: JobObjectExtendedLimitInformation = std::mem::zeroed();
            limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                (&limits as *const JobObjectExtendedLimitInformation).cast(),
                std::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
            ) == 0
            {
                CloseHandle(job);
                return None;
            }

            let process = OpenProcess(PROCESS_TERMINATE | PROCESS_SET_QUOTA, 0, process_id);
            if process == 0 {
                CloseHandle(job);
                return None;
            }
            let assigned = AssignProcessToJobObject(job, process) != 0;
            CloseHandle(process);
            if !assigned {
                CloseHandle(job);
                return None;
            }

            Some(Self { handle: job })
        }
    }

    fn terminate(&self) -> bool {
        // SAFETY: handle remains owned and valid until Drop.
        unsafe { TerminateJobObject(self.handle, 1) != 0 }
    }
}

#[cfg(windows)]
impl Drop for WindowsProcessJob {
    fn drop(&mut self) {
        // KILL_ON_JOB_CLOSE ensures descendants cannot outlive supervision.
        // SAFETY: this is the sole owner of the non-null job handle.
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

struct LoginProcessTree {
    root_pid: Option<u32>,
    #[cfg(windows)]
    job: Option<WindowsProcessJob>,
}

#[cfg(unix)]
fn terminate_unix_process_group(root_pid: Option<u32>) {
    let Some(process_id) = root_pid.filter(|id| *id <= i32::MAX as u32) else {
        return;
    };
    unsafe extern "C" {
        fn kill(process_id: i32, signal: i32) -> i32;
    }
    // The child starts in its own process group, so a negative PID addresses
    // only that CLI tree and never the app's process group.
    unsafe {
        kill(-(process_id as i32), 9);
    }
}

impl LoginProcessTree {
    fn attach(child: &Child) -> Self {
        let root_pid = child.id();
        Self {
            root_pid,
            #[cfg(windows)]
            job: root_pid.and_then(WindowsProcessJob::attach),
        }
    }

    async fn terminate(&self) {
        #[cfg(windows)]
        if self.job.as_ref().is_some_and(WindowsProcessJob::terminate) {
            return;
        }

        #[cfg(unix)]
        terminate_unix_process_group(self.root_pid);

        #[cfg(windows)]
        if let Some(process_id) = self.root_pid {
            if let Some(system_root) = std::env::var_os("SystemRoot") {
                let taskkill = PathBuf::from(system_root)
                    .join("System32")
                    .join("taskkill.exe");
                if taskkill.is_file() {
                    let mut command = Command::new(taskkill);
                    command
                        .args(["/PID", &process_id.to_string(), "/T", "/F"])
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .kill_on_drop(true);
                    if let Ok(mut taskkill_child) = command.spawn() {
                        let _ = tokio::time::timeout(LOGIN_REAP_GRACE, taskkill_child.wait()).await;
                    }
                }
            }
        }
    }
}

impl Drop for LoginProcessTree {
    fn drop(&mut self) {
        #[cfg(unix)]
        terminate_unix_process_group(self.root_pid);
        // On Windows, WindowsProcessJob's KILL_ON_JOB_CLOSE Drop is the armed
        // equivalent. If attaching the job was denied, explicit cancellation
        // still uses the bounded trusted taskkill fallback above.
    }
}

fn validate_login_options(opts: &OpksshLoginOptions) -> Result<(), LoginProcessError> {
    if opts.issuer.is_none()
        && (opts.client_id.is_some() || opts.client_secret.is_some() || opts.scopes.is_some())
    {
        return Err(LoginProcessError::InvalidOptions);
    }

    if opts.client_secret.is_some() && opts.client_id.is_none() {
        return Err(LoginProcessError::InvalidOptions);
    }

    if opts.issuer.is_none() {
        if let Some(provider) = opts.provider.as_deref() {
            if provider.is_empty()
                || provider.len() > 128
                || provider.starts_with('-')
                || !provider
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
            {
                return Err(LoginProcessError::InvalidOptions);
            }
        }
    }

    for value in [
        opts.issuer.as_deref(),
        opts.client_id.as_deref(),
        opts.client_secret.as_deref(),
        opts.scopes.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if value
            .chars()
            .any(|character| matches!(character, ',' | ';' | '\r' | '\n' | '\0'))
        {
            return Err(LoginProcessError::InvalidOptions);
        }
    }

    Ok(())
}

async fn resolve_login_executable(binary_path: &Path) -> Result<PathBuf, LoginProcessError> {
    if !binary_path.is_absolute() {
        return Err(LoginProcessError::InvalidExecutable);
    }

    let resolved = tokio::fs::canonicalize(binary_path)
        .await
        .map_err(|_| LoginProcessError::InvalidExecutable)?;
    let metadata = tokio::fs::metadata(&resolved)
        .await
        .map_err(|_| LoginProcessError::InvalidExecutable)?;
    if !metadata.is_file() {
        return Err(LoginProcessError::InvalidExecutable);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(LoginProcessError::InvalidExecutable);
        }
    }

    Ok(resolved)
}

async fn read_capped<R>(mut reader: R, limit: usize) -> Result<CapturedOutput, LoginProcessError>
where
    R: AsyncRead + Unpin + Send + 'static,
{
    let mut bytes = Zeroizing::new(Vec::with_capacity(limit.min(8 * 1024)));
    let mut chunk = Zeroizing::new(vec![0_u8; 8 * 1024]);

    loop {
        let count = reader
            .read(chunk.as_mut_slice())
            .await
            .map_err(|_| LoginProcessError::Read)?;
        if count == 0 {
            return Ok(CapturedOutput {
                bytes,
                exceeded: false,
            });
        }

        let remaining = limit.saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..count.min(remaining)]);
        if count > remaining {
            chunk.zeroize();
            return Ok(CapturedOutput {
                bytes,
                exceeded: true,
            });
        }
    }
}

async fn wait_for_cancellation(receiver: &mut watch::Receiver<bool>) {
    loop {
        if *receiver.borrow_and_update() {
            return;
        }
        if receiver.changed().await.is_err() {
            return;
        }
    }
}

async fn terminate_and_reap(
    child: &mut Child,
    lifecycle: &LoginProcessLifecycle,
    process_tree: &LoginProcessTree,
) -> Result<(), LoginProcessError> {
    let _ = tokio::time::timeout(LOGIN_REAP_GRACE, process_tree.terminate()).await;
    let _ = child.start_kill();
    tokio::time::timeout(LOGIN_REAP_GRACE, child.wait())
        .await
        .map_err(|_| LoginProcessError::Reap)?
        .map_err(|_| LoginProcessError::Reap)?;
    lifecycle.mark_reaped();
    Ok(())
}

async fn supervise_login_child(
    mut child: Child,
    stdout: impl AsyncRead + Unpin + Send + 'static,
    stderr: impl AsyncRead + Unpin + Send + 'static,
    limits: LoginProcessLimits,
    mut cancellation: watch::Receiver<bool>,
    lifecycle: LoginProcessLifecycle,
    process_tree: Arc<LoginProcessTree>,
) -> Result<LoginProcessOutput, LoginProcessError> {
    let stdout_reader = read_capped(stdout, limits.stdout_limit);
    let stderr_reader = read_capped(stderr, limits.stderr_limit);
    let deadline = tokio::time::sleep(limits.deadline);
    tokio::pin!(stdout_reader, stderr_reader, deadline);

    let mut stdout_capture = None;
    let mut stderr_capture = None;

    let status = loop {
        tokio::select! {
            _ = wait_for_cancellation(&mut cancellation) => {
                terminate_and_reap(&mut child, &lifecycle, &process_tree).await?;
                return Err(LoginProcessError::Cancelled);
            }
            _ = &mut deadline => {
                terminate_and_reap(&mut child, &lifecycle, &process_tree).await?;
                return Err(LoginProcessError::TimedOut);
            }
            captured = &mut stdout_reader, if stdout_capture.is_none() => {
                let captured = match captured {
                    Ok(captured) => captured,
                    Err(error) => {
                        terminate_and_reap(&mut child, &lifecycle, &process_tree).await?;
                        return Err(error);
                    }
                };
                if captured.exceeded {
                    terminate_and_reap(&mut child, &lifecycle, &process_tree).await?;
                    return Err(LoginProcessError::OutputLimit);
                }
                stdout_capture = Some(captured);
            }
            captured = &mut stderr_reader, if stderr_capture.is_none() => {
                let captured = match captured {
                    Ok(captured) => captured,
                    Err(error) => {
                        terminate_and_reap(&mut child, &lifecycle, &process_tree).await?;
                        return Err(error);
                    }
                };
                if captured.exceeded {
                    terminate_and_reap(&mut child, &lifecycle, &process_tree).await?;
                    return Err(LoginProcessError::OutputLimit);
                }
                stderr_capture = Some(captured);
            }
            status = child.wait() => {
                let status = status.map_err(|_| LoginProcessError::Wait)?;
                lifecycle.mark_reaped();
                break status;
            }
        }
    };

    let drain = async {
        let stdout = match stdout_capture {
            Some(captured) => captured,
            None => stdout_reader.await?,
        };
        let stderr = match stderr_capture {
            Some(captured) => captured,
            None => stderr_reader.await?,
        };
        Ok::<_, LoginProcessError>((stdout, stderr))
    };
    let (stdout, stderr) = match tokio::time::timeout(limits.pipe_drain_grace, drain).await {
        Ok(result) => result?,
        Err(_) => {
            let _ = tokio::time::timeout(LOGIN_REAP_GRACE, process_tree.terminate()).await;
            return Err(LoginProcessError::PipeDrain);
        }
    };
    if stdout.exceeded || stderr.exceeded {
        return Err(LoginProcessError::OutputLimit);
    }

    Ok(LoginProcessOutput {
        status,
        stdout: stdout.bytes,
        stderr: stderr.bytes,
    })
}

async fn run_bounded_login_process(
    binary_path: &Path,
    args: &[String],
    provider_env: Option<&str>,
    limits: LoginProcessLimits,
    process_context: LoginProcessContext,
) -> Result<LoginProcessOutput, LoginProcessError> {
    let executable = resolve_login_executable(binary_path).await?;
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env_remove("OPKSSH_PROVIDERS");
    #[cfg(unix)]
    command.process_group(0);
    if let Some(provider_env) = provider_env {
        command.env("OPKSSH_PROVIDERS", provider_env);
    }

    let mut child = command.spawn().map_err(|_| LoginProcessError::Spawn)?;
    process_context.lifecycle.mark_started();
    let process_tree = Arc::new(LoginProcessTree::attach(&child));
    process_context
        .lifecycle
        .register_process_tree(&process_tree);
    let Some(stdout) = child.stdout.take() else {
        terminate_and_reap(&mut child, &process_context.lifecycle, &process_tree).await?;
        return Err(LoginProcessError::Pipe);
    };
    let Some(stderr) = child.stderr.take() else {
        terminate_and_reap(&mut child, &process_context.lifecycle, &process_tree).await?;
        return Err(LoginProcessError::Pipe);
    };

    let cleanup_lifecycle = process_context.lifecycle.clone();
    let result = supervise_login_child(
        child,
        stdout,
        stderr,
        limits,
        process_context.cancellation,
        process_context.lifecycle,
        process_tree,
    )
    .await;
    cleanup_lifecycle.clear_process_tree();
    result
}

fn redact_provider_material(
    output: &str,
    opts: &OpksshLoginOptions,
    provider_env: Option<&str>,
) -> String {
    let mut sensitive = Vec::new();
    if let Some(provider_env) = provider_env {
        if !provider_env.is_empty() {
            sensitive.push(provider_env.to_string());
        }
    }
    for value in [
        opts.issuer.as_deref(),
        opts.client_id.as_deref(),
        opts.client_secret.as_deref(),
        opts.scopes.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !value.is_empty() {
            sensitive.push(value.to_string());
        }
    }
    sensitive.sort_by_key(|value| std::cmp::Reverse(value.len()));
    sensitive.dedup();

    sensitive
        .into_iter()
        .fold(output.to_string(), |redacted, value| {
            redacted.replace(&value, "***")
        })
}

fn sanitized_raw_output(
    output: &LoginProcessOutput,
    opts: &OpksshLoginOptions,
    provider_env: Option<&str>,
) -> String {
    let stdout = Zeroizing::new(String::from_utf8_lossy(&output.stdout).into_owned());
    let stderr = Zeroizing::new(String::from_utf8_lossy(&output.stderr).into_owned());
    redact_provider_material(
        &format!("{}\n{}", stdout.as_str(), stderr.as_str()),
        opts,
        provider_env,
    )
}

fn login_failure_message(status: ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("OPKSSH login failed with exit code {code}"),
        None => "OPKSSH login was terminated before completion".to_string(),
    }
}

/// Execute `opkssh login` through the authoritative CLI fallback and parse the
/// bounded, redacted result.
pub async fn execute_login(
    binary_path: &Path,
    opts: &OpksshLoginOptions,
) -> Result<OpksshLoginResult, String> {
    validate_login_options(opts).map_err(|error| error.message().to_string())?;
    let args = Zeroizing::new(build_login_args(opts));
    let env_providers = build_login_env_providers(opts).map(Zeroizing::new);
    info!("Executing OPKSSH login through the bounded CLI fallback");

    let (standalone_cancellation, process_context) =
        match LOGIN_PROCESS_CONTEXT.try_with(Clone::clone) {
            Ok(context) => (None, context),
            Err(_) => {
                let (cancellation, context) = LoginProcessContext::new();
                (Some(cancellation), context)
            }
        };
    let output = run_bounded_login_process(
        binary_path,
        args.as_slice(),
        env_providers.as_deref().map(String::as_str),
        LoginProcessLimits::default(),
        process_context,
    )
    .await
    .map_err(|error| error.message().to_string())?;
    drop(standalone_cancellation);

    let raw_output =
        sanitized_raw_output(&output, opts, env_providers.as_deref().map(String::as_str));

    if !output.status.success() {
        return Ok(OpksshLoginResult {
            success: false,
            key_path: None,
            identity: None,
            provider: opts.provider.clone(),
            expires_at: None,
            message: login_failure_message(output.status),
            raw_output,
        });
    }

    // Parse the output to extract key path and identity
    let key_path = parse_key_path(&raw_output, opts);
    let identity = parse_identity(&raw_output);
    // Default: keys expire after 24 hours
    let expires_at = Some(Utc::now() + ChronoDuration::hours(24));

    Ok(OpksshLoginResult {
        success: true,
        key_path,
        identity,
        provider: opts.provider.clone(),
        expires_at,
        message: "Login successful".to_string(),
        raw_output,
    })
}

/// Parse key path from login output.
fn parse_key_path(output: &str, opts: &OpksshLoginOptions) -> Option<String> {
    // Look for path mentions in output
    for line in output.lines() {
        let lower = line.to_lowercase();
        if lower.contains("id_ecdsa") || lower.contains("key") && lower.contains("written") {
            // Try to extract a file path
            if let Some(path) = extract_path_from_line(line) {
                return Some(path);
            }
        }
    }

    // Fall back to default path
    let key_name = opts.key_file_name.as_deref().unwrap_or("id_ecdsa");

    dirs::home_dir().map(|h| h.join(".ssh").join(key_name).to_string_lossy().to_string())
}

/// Extract a file path from a log line.
fn extract_path_from_line(line: &str) -> Option<String> {
    // Look for paths like /home/user/.ssh/id_ecdsa or C:\Users\...
    let tokens: Vec<&str> = line.split_whitespace().collect();
    for token in tokens {
        let cleaned = token.trim_matches(|c: char| c == '\'' || c == '"' || c == '`');
        if cleaned.contains(".ssh") || cleaned.contains("id_ecdsa") || cleaned.contains("id_") {
            return Some(cleaned.to_string());
        }
    }
    None
}

/// Parse identity (email) from login output.
fn parse_identity(output: &str) -> Option<String> {
    for line in output.lines() {
        let lower = line.to_lowercase();
        if lower.contains("authenticated") || lower.contains("identity") || lower.contains("email")
        {
            // Look for something that looks like an email
            for token in line.split_whitespace() {
                let cleaned = token.trim_matches(|c: char| {
                    !c.is_alphanumeric() && c != '@' && c != '.' && c != '-' && c != '_'
                });
                if cleaned.contains('@') && cleaned.contains('.') {
                    return Some(cleaned.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_runtime_status() -> OpksshRuntimeStatus {
        let cli_backend = OpksshBackendStatus {
            kind: OpksshBackendKind::Cli,
            available: true,
            availability: OpksshRuntimeAvailability::Available,
            version: Some("opkssh v0.13.0".to_string()),
            path: Some("/usr/bin/opkssh".to_string()),
            message: None,
            login_supported: true,
            config_load_supported: false,
            provider_owns_callback_listener: true,
            provider_owns_callback_shutdown: true,
            bundle_contract: None,
        };

        OpksshRuntimeStatus {
            mode: OpksshBackendMode::Auto,
            active_backend: Some(OpksshBackendKind::Cli),
            using_fallback: true,
            library: OpksshBackendStatus {
                kind: OpksshBackendKind::Library,
                available: false,
                availability: OpksshRuntimeAvailability::Planned,
                version: None,
                path: None,
                message: Some("libopkssh is not linked yet".to_string()),
                login_supported: false,
                config_load_supported: false,
                provider_owns_callback_listener: true,
                provider_owns_callback_shutdown: true,
                bundle_contract: None,
            },
            cli: OpksshBinaryStatus {
                installed: true,
                path: Some("/usr/bin/opkssh".to_string()),
                version: Some("opkssh v0.13.0".to_string()),
                platform: "linux".to_string(),
                arch: "amd64".to_string(),
                download_url: Some("https://example.invalid/opkssh".to_string()),
                backend: cli_backend,
            },
            message: Some(
                "The in-process OPKSSH runtime is not linked yet; CLI fallback is active."
                    .to_string(),
            ),
        }
    }

    fn running_operation() -> OpksshLoginOperation {
        OpksshLoginOperation {
            id: "op-1".to_string(),
            status: OpksshLoginOperationStatus::Running,
            provider: Some("google".to_string()),
            runtime: test_runtime_status(),
            browser_url: None,
            can_cancel: true,
            message: None,
            result: None,
            started_at: Utc::now(),
            finished_at: None,
        }
    }

    fn test_registry_entry(snapshot: OpksshLoginOperation) -> SharedLoginOperation {
        Arc::new(Mutex::new(PendingLoginOperation {
            snapshot,
            task: None,
            cancellation: None,
            process_lifecycle: LoginProcessLifecycle::default(),
            completion_notify: Arc::new(Notify::new()),
        }))
    }

    fn successful_test_result(message: &str) -> OpksshLoginResult {
        OpksshLoginResult {
            success: true,
            key_path: Some("/tmp/id_ecdsa".to_string()),
            identity: Some("user@example.com".to_string()),
            provider: Some("google".to_string()),
            expires_at: None,
            message: message.to_string(),
            raw_output: String::new(),
        }
    }

    #[test]
    fn test_build_login_args_simple_alias() {
        let opts = OpksshLoginOptions {
            provider: Some("google".into()),
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert_eq!(args, vec!["login", "google"]);
    }

    #[test]
    fn test_build_login_args_custom_provider() {
        let opts = OpksshLoginOptions {
            issuer: Some("https://auth.example.com".into()),
            client_id: Some("my-client".into()),
            scopes: Some("openid profile email".into()),
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert_eq!(
            args,
            vec!["login", &format!("--provider={INLINE_PROVIDER_ALIAS}")]
        );
        assert!(args.iter().all(|argument| {
            !argument.contains("auth.example.com") && !argument.contains("my-client")
        }));
    }

    #[test]
    fn test_client_secret_never_on_argv() {
        let opts = OpksshLoginOptions {
            issuer: Some("https://auth.example.com".into()),
            client_id: Some("my-client".into()),
            client_secret: Some("super-secret".into()),
            scopes: Some("openid email".into()),
            ..Default::default()
        };
        let args = build_login_args(&opts);
        // The secret must NOT appear in any argv token.
        assert!(
            args.iter().all(|a| !a.contains("super-secret")),
            "client_secret leaked onto argv: {args:?}"
        );
        // argv references the synthetic alias instead.
        assert!(args.contains(&format!("--provider={}", INLINE_PROVIDER_ALIAS)));
    }

    #[test]
    fn test_inline_secret_goes_to_env_providers() {
        let opts = OpksshLoginOptions {
            issuer: Some("https://auth.example.com".into()),
            client_id: Some("my-client".into()),
            client_secret: Some("super-secret".into()),
            scopes: Some("openid email".into()),
            ..Default::default()
        };
        let env = build_login_env_providers(&opts).expect("env providers built");
        assert_eq!(
            env,
            format!("{INLINE_PROVIDER_ALIAS},https://auth.example.com,my-client,super-secret,openid email")
        );
    }

    #[test]
    fn test_secretless_custom_provider_stays_off_argv_and_uses_env() {
        let opts = OpksshLoginOptions {
            issuer: Some("https://auth.example.com".into()),
            client_id: Some("my-client".into()),
            scopes: Some("openid email".into()),
            ..Default::default()
        };
        let env = build_login_env_providers(&opts).expect("custom provider env");
        assert_eq!(
            env,
            format!("{INLINE_PROVIDER_ALIAS},https://auth.example.com,my-client,,openid email")
        );
        let args = build_login_args(&opts);
        assert!(args.iter().all(|argument| !argument.contains("my-client")));
    }

    #[test]
    fn test_redact_env_providers_hides_secret() {
        let redacted =
            redact_env_providers("alias,https://issuer.example,client-id,super-secret,openid");
        assert!(!redacted.contains("super-secret"));
        assert_eq!(
            redacted,
            "alias,https://issuer.example,client-id,***,openid"
        );
    }

    #[test]
    fn test_redact_env_providers_no_secret_field_unchanged() {
        let redacted = redact_env_providers("alias,https://issuer.example,client-id");
        assert_eq!(redacted, "alias,https://issuer.example,client-id");
    }

    #[test]
    fn test_build_login_args_key_file() {
        let opts = OpksshLoginOptions {
            provider: Some("google".into()),
            key_file_name: Some("my_key".into()),
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert!(args.contains(&"login".to_string()));
        assert!(args.contains(&"--key-file-name=my_key".to_string()));
    }

    #[test]
    fn test_build_login_args_create_config() {
        let opts = OpksshLoginOptions {
            create_config: true,
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert!(args.contains(&"--create-config".to_string()));
    }

    #[test]
    fn test_finalize_operation_success() {
        let mut operation = running_operation();
        finalize_operation(
            &mut operation,
            Ok(OpksshLoginResult {
                success: true,
                key_path: Some("/tmp/id_ecdsa".to_string()),
                identity: Some("user@example.com".to_string()),
                provider: Some("google".to_string()),
                expires_at: None,
                message: "Login successful".to_string(),
                raw_output: String::new(),
            }),
        );

        assert_eq!(operation.status, OpksshLoginOperationStatus::Succeeded);
        assert!(!operation.can_cancel);
        assert!(operation.finished_at.is_some());
        assert_eq!(operation.message.as_deref(), Some("Login successful"));
        assert!(operation
            .result
            .as_ref()
            .is_some_and(|result| result.success));
    }

    #[test]
    fn test_finalize_operation_error() {
        let mut operation = running_operation();
        finalize_operation(
            &mut operation,
            Err("Library mode is requested, but the in-process OPKSSH runtime is not linked yet; CLI fallback is unavailable.".to_string()),
        );

        assert_eq!(operation.status, OpksshLoginOperationStatus::Failed);
        assert!(!operation.can_cancel);
        assert!(operation.finished_at.is_some());
        assert!(operation.result.is_none());
        assert!(operation
            .message
            .as_deref()
            .is_some_and(|message| message.contains("not linked yet")));
    }

    #[test]
    fn test_mark_operation_cancelled() {
        let mut operation = running_operation();
        mark_operation_cancelled(&mut operation);

        assert_eq!(operation.status, OpksshLoginOperationStatus::Cancelled);
        assert!(!operation.can_cancel);
        assert!(operation.finished_at.is_some());
        assert!(operation.result.is_none());
        assert!(operation
            .message
            .as_deref()
            .is_some_and(|message| message.contains("provider-owned")));
    }

    #[test]
    fn terminal_registry_enforces_cap_and_expiry() {
        let now = Utc::now();
        let mut registry = LoginOperationRegistry::default();

        for index in 0..(LOGIN_TERMINAL_OPERATION_CAP + 2) {
            let id = format!("terminal-{index}");
            let finished_at = now + ChronoDuration::milliseconds(index as i64);
            let mut snapshot = running_operation();
            snapshot.id = id.clone();
            snapshot.status = OpksshLoginOperationStatus::Succeeded;
            snapshot.finished_at = Some(finished_at);
            compact_terminal_snapshot(&mut snapshot);
            registry
                .entries
                .insert(id.clone(), test_registry_entry(snapshot));
            registry.record_terminal_at(&id, finished_at, now);
        }

        assert_eq!(
            registry.terminal_finished_at.len(),
            LOGIN_TERMINAL_OPERATION_CAP
        );
        assert_eq!(registry.entries.len(), LOGIN_TERMINAL_OPERATION_CAP);
        assert!(!registry.entries.contains_key("terminal-0"));
        assert!(!registry.entries.contains_key("terminal-1"));

        let expired_id = "expired-terminal".to_string();
        let fresh_id = "fresh-terminal".to_string();
        let mut expiry_registry = LoginOperationRegistry::default();
        expiry_registry
            .entries
            .insert(expired_id.clone(), test_registry_entry(running_operation()));
        expiry_registry
            .entries
            .insert(fresh_id.clone(), test_registry_entry(running_operation()));
        expiry_registry.terminal_finished_at.insert(
            expired_id.clone(),
            now - ChronoDuration::minutes(LOGIN_TERMINAL_TTL_MINUTES + 1),
        );
        expiry_registry
            .terminal_finished_at
            .insert(fresh_id.clone(), now);
        expiry_registry.prune(now);

        assert!(!expiry_registry.entries.contains_key(&expired_id));
        assert!(expiry_registry.entries.contains_key(&fresh_id));
    }

    #[test]
    fn terminal_summary_removes_sensitive_operation_details() {
        let secret = "terminal-secret-value";
        let mut operation = running_operation();
        operation.provider = Some(format!("provider-{secret}"));
        operation.browser_url = Some(format!("https://example.invalid/?token={secret}"));
        finalize_operation(
            &mut operation,
            Ok(OpksshLoginResult {
                success: true,
                key_path: Some(format!("/tmp/{secret}")),
                identity: Some(format!("{secret}@example.invalid")),
                provider: Some(format!("provider-{secret}")),
                expires_at: None,
                message: secret.to_string(),
                raw_output: secret.repeat(1024),
            }),
        );
        compact_terminal_snapshot(&mut operation);

        assert_eq!(operation.provider, None);
        assert_eq!(operation.browser_url, None);
        assert!(operation.result.is_none());
        assert_eq!(
            operation.message.as_deref(),
            Some("OPKSSH login completed successfully")
        );
    }

    #[tokio::test]
    async fn registry_operations_can_complete_concurrently() {
        let barrier = Arc::new(tokio::sync::Barrier::new(3));
        let first_id = format!("opkssh-concurrent-a-{}", Uuid::new_v4());
        let second_id = format!("opkssh-concurrent-b-{}", Uuid::new_v4());

        for operation_id in [&first_id, &second_id] {
            let mut snapshot = running_operation();
            snapshot.id = operation_id.clone();
            let entry = test_registry_entry(snapshot);
            let task_entry = entry.clone();
            let task_id = operation_id.clone();
            let task_barrier = barrier.clone();
            let task = tokio::spawn(async move {
                task_barrier.wait().await;
                let outcome = Ok(successful_test_result("concurrent success"));
                store_operation_outcome(&task_id, &task_entry, outcome.clone()).await;
                outcome
            });
            entry.lock().await.task = Some(task);
            login_operations()
                .lock()
                .await
                .entries
                .insert(operation_id.clone(), entry);
        }

        let first_wait_id = first_id.clone();
        let second_wait_id = second_id.clone();
        let first_waiter = tokio::spawn(async move { await_login_operation(&first_wait_id).await });
        let second_waiter =
            tokio::spawn(async move { await_login_operation(&second_wait_id).await });
        tokio::task::yield_now().await;
        barrier.wait().await;

        let (first, second) = tokio::join!(first_waiter, second_waiter);
        assert_eq!(
            first
                .expect("first waiter task")
                .expect("first operation")
                .status,
            OpksshLoginOperationStatus::Succeeded
        );
        assert_eq!(
            second
                .expect("second waiter task")
                .expect("second operation")
                .status,
            OpksshLoginOperationStatus::Succeeded
        );

        let mut registry = login_operations().lock().await;
        registry.remove(&first_id);
        registry.remove(&second_id);
    }

    #[tokio::test]
    async fn awaiting_task_keeps_cancellation_owner_until_terminal_cleanup() {
        let operation_id = format!("opkssh-await-owner-{}", Uuid::new_v4());
        let mut snapshot = running_operation();
        snapshot.id = operation_id.clone();
        let entry = test_registry_entry(snapshot);
        let (cancellation, mut cancellation_receiver) = watch::channel(false);
        let task_entry = entry.clone();
        let task_id = operation_id.clone();
        let task = tokio::spawn(async move {
            let cancellation_channel_ended_early =
                tokio::time::timeout(Duration::from_millis(50), cancellation_receiver.changed())
                    .await
                    .is_ok();
            let outcome = if cancellation_channel_ended_early {
                Err("cancellation owner was dropped during task transfer".to_string())
            } else {
                Ok(successful_test_result("awaited completion"))
            };
            store_operation_outcome(&task_id, &task_entry, outcome.clone()).await;
            outcome
        });

        {
            let mut pending = entry.lock().await;
            pending.task = Some(task);
            pending.cancellation = Some(cancellation);
        }
        login_operations()
            .lock()
            .await
            .entries
            .insert(operation_id.clone(), entry.clone());

        let completed =
            tokio::time::timeout(Duration::from_secs(1), await_login_operation(&operation_id))
                .await
                .expect("awaiting login task must not leak")
                .expect("await login operation");
        assert_eq!(completed.status, OpksshLoginOperationStatus::Succeeded);
        assert!(completed.result.is_some_and(|result| result.success));

        let pending = entry.lock().await;
        assert!(pending.task.is_none());
        assert!(pending.cancellation.is_none());
        assert_eq!(
            pending.snapshot.status,
            OpksshLoginOperationStatus::Succeeded
        );
        drop(pending);

        login_operations().lock().await.remove(&operation_id);
    }

    fn fake_helper_args() -> Vec<String> {
        vec![
            "--ignored".to_string(),
            "--exact".to_string(),
            "login::tests::fake_opkssh_helper".to_string(),
            "--nocapture".to_string(),
        ]
    }

    async fn run_fake_helper(
        mode: &str,
        limits: LoginProcessLimits,
        context: LoginProcessContext,
    ) -> Result<LoginProcessOutput, LoginProcessError> {
        let executable = std::env::current_exe().expect("test executable path");
        run_bounded_login_process(
            &executable,
            &fake_helper_args(),
            Some(mode),
            limits,
            context,
        )
        .await
    }

    async fn wait_for_file(path: &Path) {
        tokio::time::timeout(Duration::from_secs(3), async {
            while !path.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("fake helper start marker");
    }

    #[test]
    #[ignore]
    fn fake_opkssh_helper() {
        use std::io::Write;

        let mode = std::env::var("OPKSSH_PROVIDERS").unwrap_or_default();
        if mode == "timeout" {
            std::thread::sleep(Duration::from_secs(30));
        } else if mode == "output-cap" {
            print!("{}", "X".repeat(128 * 1024));
            std::io::stdout().flush().expect("flush fake output");
            std::thread::sleep(Duration::from_secs(30));
        } else if let Some(marker) = mode.strip_prefix("cancel:") {
            std::fs::write(marker, b"started").expect("write start marker");
            std::thread::sleep(Duration::from_secs(30));
            std::fs::write(format!("{marker}.completed"), b"completed")
                .expect("write completion marker");
        } else if let Some(secret) = mode.strip_prefix("redact:") {
            println!(
                "provider issuer=https://auth.example.com client=my-client secret={secret} scopes=openid-email"
            );
        } else if mode == "descendant-pipe" {
            let executable = std::env::current_exe().expect("test executable path");
            let mut descendant = std::process::Command::new(executable)
                .args(fake_helper_args())
                .env("OPKSSH_PROVIDERS", "pipe-holder")
                .stdin(Stdio::null())
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("spawn inherited-pipe descendant");
            let _reaper = std::thread::spawn(move || {
                let _ = descendant.wait();
            });
        } else if mode == "pipe-holder" {
            std::thread::sleep(Duration::from_secs(30));
        } else if let Some(marker) = mode.strip_prefix("drop-tree:") {
            std::fs::write(format!("{marker}.started"), b"started")
                .expect("write drop-tree start marker");
            let executable = std::env::current_exe().expect("test executable path");
            let mut descendant = std::process::Command::new(executable)
                .args(fake_helper_args())
                .env(
                    "OPKSSH_PROVIDERS",
                    format!("delayed-write:{marker}.completed"),
                )
                .stdin(Stdio::null())
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("spawn drop-tree descendant");
            let _reaper = std::thread::spawn(move || {
                let _ = descendant.wait();
            });
            std::thread::sleep(Duration::from_secs(30));
        } else if let Some(marker) = mode.strip_prefix("delayed-write:") {
            std::thread::sleep(Duration::from_millis(750));
            std::fs::write(marker, b"descendant survived").expect("write descendant marker");
        }
    }

    #[tokio::test]
    async fn bounded_runner_enforces_login_deadline() {
        let (_cancellation, context) = LoginProcessContext::new();
        let error = run_fake_helper(
            "timeout",
            LoginProcessLimits {
                deadline: Duration::from_millis(100),
                ..LoginProcessLimits::default()
            },
            context.clone(),
        )
        .await
        .expect_err("helper should time out");
        assert_eq!(error, LoginProcessError::TimedOut);
        assert!(context.lifecycle.child_reaped());
    }

    #[tokio::test]
    async fn bounded_runner_rejects_excess_output() {
        let (_cancellation, context) = LoginProcessContext::new();
        let error = run_fake_helper(
            "output-cap",
            LoginProcessLimits {
                deadline: Duration::from_secs(3),
                pipe_drain_grace: LOGIN_PIPE_DRAIN_GRACE,
                stdout_limit: 1024,
                stderr_limit: 1024,
            },
            context.clone(),
        )
        .await
        .expect_err("helper output should exceed cap");
        assert_eq!(error, LoginProcessError::OutputLimit);
        assert!(context.lifecycle.child_reaped());
    }

    #[tokio::test]
    async fn cancel_login_operation_terminates_and_reaps_helper() {
        let operation_id = format!("opkssh-cancel-test-{}", Uuid::new_v4());
        let marker = std::env::temp_dir().join(format!("{operation_id}.started"));
        let completed_marker = PathBuf::from(format!("{}.completed", marker.display()));
        let mode = format!("cancel:{}", marker.display());
        let (cancellation, context) = LoginProcessContext::new();
        let process_lifecycle = context.lifecycle.clone();
        let task = tokio::spawn(async move {
            run_fake_helper(
                &mode,
                LoginProcessLimits {
                    deadline: Duration::from_secs(30),
                    ..LoginProcessLimits::default()
                },
                context,
            )
            .await
            .map(|_| OpksshLoginResult {
                success: true,
                key_path: None,
                identity: None,
                provider: None,
                expires_at: None,
                message: "unexpected completion".to_string(),
                raw_output: String::new(),
            })
            .map_err(|error| error.message().to_string())
        });

        let mut snapshot = running_operation();
        snapshot.id = operation_id.clone();
        login_operations().lock().await.entries.insert(
            operation_id.clone(),
            Arc::new(Mutex::new(PendingLoginOperation {
                snapshot,
                task: Some(task),
                cancellation: Some(cancellation),
                process_lifecycle: process_lifecycle.clone(),
                completion_notify: Arc::new(Notify::new()),
            })),
        );

        wait_for_file(&marker).await;
        let cancelled = cancel_login_operation(&operation_id)
            .await
            .expect("cancel operation");
        assert_eq!(cancelled.status, OpksshLoginOperationStatus::Cancelled);
        assert!(process_lifecycle.child_reaped());
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!completed_marker.exists());

        let stored_entry = login_operations()
            .lock()
            .await
            .entries
            .get(&operation_id)
            .cloned()
            .expect("retained cancellation summary");
        let stored = stored_entry.lock().await;
        assert!(stored.task.is_none());
        assert!(stored.cancellation.is_none());
        assert!(stored.snapshot.result.is_none());
        assert_eq!(stored.snapshot.provider, None);
        drop(stored);

        login_operations().lock().await.remove(&operation_id);
        let _ = std::fs::remove_file(marker);
        let _ = std::fs::remove_file(completed_marker);
    }

    #[tokio::test]
    async fn cancellation_grace_expiry_terminates_tree_before_forced_abort() {
        let operation_id = format!("opkssh-forced-cancel-test-{}", Uuid::new_v4());
        let marker = std::env::temp_dir().join(format!("{operation_id}.started"));
        let completed_marker = PathBuf::from(format!("{}.completed", marker.display()));
        let mode = format!("cancel:{}", marker.display());
        let (_cancellation, context) = LoginProcessContext::new();
        let process_lifecycle = context.lifecycle.clone();
        let mut task = tokio::spawn(async move {
            run_fake_helper(
                &mode,
                LoginProcessLimits {
                    deadline: Duration::from_secs(30),
                    ..LoginProcessLimits::default()
                },
                context,
            )
            .await
            .map(|_| successful_test_result("unexpected completion"))
            .map_err(|error| error.message().to_string())
        });

        wait_for_file(&marker).await;
        stop_login_task(
            &mut task,
            &process_lifecycle,
            LoginCancellationLimits {
                cooperative_grace: Duration::ZERO,
                reap_grace: Duration::from_secs(3),
                abort_grace: Duration::from_secs(1),
            },
        )
        .await
        .expect("forced cancellation cleanup");

        assert!(process_lifecycle.child_reaped());
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!completed_marker.exists());
        let _ = std::fs::remove_file(marker);
        let _ = std::fs::remove_file(completed_marker);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_runner_kills_descendants_in_its_process_group() {
        let operation_id = format!("opkssh-drop-tree-test-{}", Uuid::new_v4());
        let marker = std::env::temp_dir().join(operation_id);
        let started_marker = PathBuf::from(format!("{}.started", marker.display()));
        let completed_marker = PathBuf::from(format!("{}.completed", marker.display()));
        let mode = format!("drop-tree:{}", marker.display());
        let (_cancellation, context) = LoginProcessContext::new();
        let task = tokio::spawn(async move {
            run_fake_helper(
                &mode,
                LoginProcessLimits {
                    deadline: Duration::from_secs(30),
                    ..LoginProcessLimits::default()
                },
                context,
            )
            .await
        });

        wait_for_file(&started_marker).await;
        task.abort();
        let _ = tokio::time::timeout(Duration::from_secs(1), task).await;
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert!(!completed_marker.exists());

        let _ = std::fs::remove_file(started_marker);
        let _ = std::fs::remove_file(completed_marker);
    }

    #[tokio::test]
    async fn descendant_held_pipes_obey_drain_deadline() {
        let (_cancellation, context) = LoginProcessContext::new();
        let error = run_fake_helper(
            "descendant-pipe",
            LoginProcessLimits {
                deadline: Duration::from_secs(3),
                pipe_drain_grace: Duration::from_millis(100),
                stdout_limit: 1024,
                stderr_limit: 1024,
            },
            context.clone(),
        )
        .await
        .expect_err("inherited pipes must hit the drain deadline");
        assert_eq!(error, LoginProcessError::PipeDrain);
        assert!(context.lifecycle.child_reaped());
    }

    #[tokio::test]
    async fn fake_helper_provider_material_is_redacted() {
        let secret = "super-secret-provider-value";
        let mode = format!("redact:{secret}");
        let (_cancellation, context) = LoginProcessContext::new();
        let output = run_fake_helper(
            &mode,
            LoginProcessLimits {
                deadline: Duration::from_secs(3),
                ..LoginProcessLimits::default()
            },
            context,
        )
        .await
        .expect("fake helper output");
        let opts = OpksshLoginOptions {
            issuer: Some("https://auth.example.com".to_string()),
            client_id: Some("my-client".to_string()),
            client_secret: Some(secret.to_string()),
            scopes: Some("openid-email".to_string()),
            ..Default::default()
        };
        let raw_output = sanitized_raw_output(&output, &opts, Some(&mode));
        assert!(!raw_output.contains(secret));
        assert!(!raw_output.contains("https://auth.example.com"));
        assert!(!raw_output.contains("my-client"));
        assert!(!raw_output.contains("openid-email"));
        assert!(!login_failure_message(output.status).contains(secret));
    }
}
