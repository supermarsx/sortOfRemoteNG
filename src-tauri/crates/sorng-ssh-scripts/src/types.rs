// ── sorng-ssh-scripts/src/types.rs ───────────────────────────────────────────
//! Comprehensive types for the SSH script execution engine.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Script Trigger Types
// ═══════════════════════════════════════════════════════════════════════════════

/// All possible triggers that can fire a script.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ScriptTrigger {
    /// Run when an SSH session is established (post-authentication).
    Login {
        /// Optional delay in milliseconds after login before executing.
        #[serde(default)]
        delay_ms: u64,
    },
    /// Run just before an SSH session disconnects.
    Logout {
        /// If true, run even if the session errored.
        #[serde(default)]
        run_on_error: bool,
    },
    /// Run when a previously-dropped SSH session reconnects.
    Reconnect,
    /// Run on SSH connection failure (auth failure, timeout, etc.).
    ConnectionError {
        /// Retry the script N times on each error event (0 = once).
        #[serde(default)]
        max_retries: u32,
        /// Delay between retries in ms.
        #[serde(default = "default_retry_delay")]
        retry_delay_ms: u64,
    },
    /// Run once at a fixed interval while the session is alive.
    Interval {
        /// Interval in milliseconds between executions.
        interval_ms: u64,
        /// Maximum number of runs (0 = unlimited).
        #[serde(default)]
        max_runs: u64,
        /// Whether to run immediately on attach, then repeat.
        #[serde(default)]
        run_immediately: bool,
    },
    /// Run according to a cron expression (UTC).
    Cron {
        /// Standard 5-field or 6-field cron expression.
        expression: String,
        /// Optional timezone name (default: UTC).
        #[serde(default = "default_timezone")]
        timezone: String,
    },
    /// Run when terminal output matches a regex pattern.
    OutputMatch {
        /// Regex pattern to watch for.
        pattern: String,
        /// Maximum times to trigger (0 = unlimited).
        #[serde(default)]
        max_triggers: u64,
        /// Cooldown in ms between successive triggers.
        #[serde(default = "default_cooldown")]
        cooldown_ms: u64,
    },
    /// Run when the session has been idle for a specified duration.
    Idle {
        /// Idle threshold in milliseconds.
        idle_ms: u64,
        /// Whether to repeat when idle resumes and triggers again.
        #[serde(default)]
        repeat: bool,
    },
    /// Run when a file on the remote host changes (stat-based polling).
    FileWatch {
        /// Absolute path on the remote host.
        remote_path: String,
        /// Poll interval in milliseconds.
        #[serde(default = "default_file_poll")]
        poll_interval_ms: u64,
        /// Which change to detect.
        #[serde(default)]
        watch_type: FileWatchType,
    },
    /// Run when the SSH session window/terminal is resized.
    Resize,
    /// Manual invocation only (user clicks "Run").
    Manual,
    /// Run at a specific wall-clock time (once or daily repetition).
    Scheduled {
        /// ISO 8601 datetime for one-shot, or HH:MM:SS for daily.
        at: String,
        /// If true, fire every day at that time.
        #[serde(default)]
        daily: bool,
        /// Optional timezone.
        #[serde(default = "default_timezone")]
        timezone: String,
    },
    /// Run when a specific environment variable is set or changes on the remote.
    EnvChange {
        /// Variable name to watch.
        variable: String,
        /// Optional expected value (if None, any change triggers).
        #[serde(default)]
        expected_value: Option<String>,
        /// Poll interval in ms.
        #[serde(default = "default_env_poll")]
        poll_interval_ms: u64,
    },
    /// Run when system load/metric crosses a threshold on the remote host.
    MetricThreshold {
        /// Metric name: "cpu", "memory", "disk", "load1m", "load5m", "load15m".
        metric: String,
        /// Threshold value (0.0–100.0 for percent-based, absolute for load).
        threshold: f64,
        /// "above" or "below".
        #[serde(default = "default_direction")]
        direction: String,
        /// Poll interval in ms.
        #[serde(default = "default_metric_poll")]
        poll_interval_ms: u64,
        /// Cooldown between repeated triggers.
        #[serde(default = "default_cooldown")]
        cooldown_ms: u64,
    },
    /// Composite: run when another script finishes (chaining).
    AfterScript {
        /// ID of the prerequisite script.
        script_id: String,
        /// Only fire if the prerequisite succeeded.
        #[serde(default = "default_true")]
        require_success: bool,
    },
    /// Run when SSH keepalive fails (network disruption detected).
    KeepaliveFailed,
    /// Run when a port-forward is established or torn down.
    PortForwardChange {
        /// "established" or "closed".
        #[serde(default)]
        event_type: Option<String>,
    },
    /// Run when the SSH host key changes (potential MITM).
    HostKeyChanged,
}

/// File-watch detection type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum FileWatchType {
    /// File is modified (mtime change).
    #[default]
    Modified,
    /// File is created.
    Created,
    /// File is deleted.
    Deleted,
    /// Any change (created, modified, or deleted).
    Any,
}

fn default_retry_delay() -> u64 {
    5000
}
fn default_timezone() -> String {
    "UTC".to_string()
}
fn default_cooldown() -> u64 {
    5000
}
fn default_file_poll() -> u64 {
    10000
}
fn default_env_poll() -> u64 {
    30000
}
fn default_metric_poll() -> u64 {
    15000
}
fn default_direction() -> String {
    "above".to_string()
}
fn default_true() -> bool {
    true
}
fn default_timeout() -> u64 {
    30000
}

// ═══════════════════════════════════════════════════════════════════════════════
// Script Definition
// ═══════════════════════════════════════════════════════════════════════════════

/// The language/type of a script.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ScriptLanguage {
    #[default]
    Bash,
    Sh,
    PowerShell,
    Python,
    Perl,
    Batch,
    JavaScript,
    Raw,
}

/// Execution mode for how the script body is sent to the remote.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ExecutionMode {
    /// Run via `ssh exec` (non-interactive single command).
    #[default]
    Exec,
    /// Feed commands into the interactive shell (PTY).
    Shell,
    /// Upload as a temp file and execute.
    Upload,
    /// Run on the local machine (not the remote).
    Local,
}

/// Failure handling strategy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum OnFailure {
    /// Log and continue.
    #[default]
    Continue,
    /// Retry up to `max_retries` times.
    Retry,
    /// Abort the entire script chain.
    Abort,
    /// Run a fallback script.
    RunFallback { fallback_script_id: String },
}

/// Condition that must be met before a script is eligible to run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ScriptCondition {
    /// OS on the remote must match.
    OsMatch { os: String },
    /// A remote command's exit code must be 0.
    CommandSucceeds { command: String },
    /// A remote command must produce output matching a regex.
    CommandOutputMatches { command: String, pattern: String },
    /// A specific remote file must exist.
    FileExists { path: String },
    /// A remote env var must equal a value.
    EnvEquals { variable: String, value: String },
    /// Current time must be within a window (HH:MM–HH:MM).
    TimeWindow {
        start: String,
        end: String,
        timezone: Option<String>,
    },
    /// Session must have been alive for at least N ms.
    SessionAge { min_age_ms: u64 },
    /// A variable in the script context must match.
    VariableEquals { name: String, value: String },
    /// Previous script run must have exited with a specific code.
    PreviousExitCode { script_id: String, exit_code: i32 },
    /// All sub-conditions must pass.
    All { conditions: Vec<ScriptCondition> },
    /// At least one sub-condition must pass.
    Any { conditions: Vec<ScriptCondition> },
    /// The sub-condition must NOT pass.
    Not { condition: Box<ScriptCondition> },
}

/// A variable definition (key-value pair with optional source).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptVariable {
    /// Variable name (used as `$VAR` or `{{var}}`).
    pub name: String,
    /// Default value.
    pub default_value: String,
    /// Where to source the value from at runtime.
    #[serde(default)]
    pub source: VariableSource,
    /// Description for the UI.
    #[serde(default)]
    pub description: Option<String>,
    /// If true, value is masked in logs/UI.
    #[serde(default)]
    pub sensitive: bool,
}

/// Where a variable's runtime value comes from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum VariableSource {
    /// Use the hardcoded default.
    #[default]
    Static,
    /// Prompt the user (only for manual triggers).
    Prompt { label: String },
    /// Run a command on the remote and capture stdout.
    RemoteCommand { command: String },
    /// Read from a remote file.
    RemoteFile { path: String },
    /// Read from a remote environment variable.
    RemoteEnv { variable: String },
    /// Use a value from connection metadata.
    ConnectionMeta { field: String },
    /// From the previous script's output in a chain.
    PreviousOutput { script_id: String },
    /// Current timestamp.
    Timestamp { format: Option<String> },
}

/// Notification to send after script execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptNotification {
    /// When to send: "always", "onSuccess", "onFailure".
    pub when: String,
    /// Channel: "toast", "log", "event", "webhook".
    pub channel: String,
    /// Title for the notification.
    pub title: String,
    /// Body template (supports `{{variables}}`).
    pub body: String,
    /// For webhook channel: URL to POST to.
    #[serde(default)]
    pub webhook_url: Option<String>,
}

/// An SSH event script definition with all metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshEventScript {
    /// Unique ID.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Optional description.
    #[serde(default)]
    pub description: Option<String>,
    /// Whether the script is active.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Script body.
    pub content: String,
    /// Language/interpreter.
    #[serde(default)]
    pub language: ScriptLanguage,
    /// How to execute on the remote.
    #[serde(default)]
    pub execution_mode: ExecutionMode,
    /// What triggers this script.
    pub trigger: ScriptTrigger,
    /// Pre-conditions (all must pass for script to run).
    #[serde(default)]
    pub conditions: Vec<ScriptCondition>,
    /// Variables to inject into the script environment.
    #[serde(default)]
    pub variables: Vec<ScriptVariable>,
    /// Execution timeout in ms (0 = no timeout).
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    /// What to do on failure.
    #[serde(default)]
    pub on_failure: OnFailure,
    /// Maximum retry count (only used when on_failure == Retry).
    #[serde(default)]
    pub max_retries: u32,
    /// Delay between retries in ms.
    #[serde(default = "default_retry_delay")]
    pub retry_delay_ms: u64,
    /// Run as a specific remote user (sudo/su).
    #[serde(default)]
    pub run_as_user: Option<String>,
    /// Working directory on the remote.
    #[serde(default)]
    pub working_directory: Option<String>,
    /// Additional env vars to inject on the remote.
    #[serde(default)]
    pub environment: HashMap<String, String>,
    /// Notification rules.
    #[serde(default)]
    pub notifications: Vec<ScriptNotification>,
    /// Tags for filtering/organization.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Optional group/category.
    #[serde(default)]
    pub category: Option<String>,
    /// Priority for ordering when multiple scripts fire on the same event (lower = first).
    #[serde(default)]
    pub priority: i32,
    /// Connection filter: only run for these connection IDs (empty = all).
    #[serde(default)]
    pub connection_ids: Vec<String>,
    /// Connection filter: only run for connections matching these host patterns (glob).
    #[serde(default)]
    pub host_patterns: Vec<String>,
    /// ISO 8601 datetime of creation.
    pub created_at: DateTime<Utc>,
    /// ISO 8601 datetime of last update.
    pub updated_at: DateTime<Utc>,
    /// Who created it.
    #[serde(default)]
    pub author: Option<String>,
    /// Version number (incremented on each save).
    #[serde(default)]
    pub version: u32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Script Chains
// ═══════════════════════════════════════════════════════════════════════════════

/// A chain entry: a script with optional condition and delay.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainStep {
    /// Script ID to run at this step.
    pub script_id: String,
    /// Delay before running this step (ms).
    #[serde(default)]
    pub delay_ms: u64,
    /// Extra condition for this step (on top of the script's own conditions).
    #[serde(default)]
    pub condition: Option<ScriptCondition>,
    /// If true, continue the chain even if this step fails.
    #[serde(default)]
    pub continue_on_failure: bool,
}

/// A named chain of scripts to run in sequence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptChain {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub trigger: ScriptTrigger,
    pub steps: Vec<ChainStep>,
    /// If true, abort the entire chain on first step failure.
    #[serde(default)]
    pub abort_on_failure: bool,
    /// Tags.
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Execution History
// ═══════════════════════════════════════════════════════════════════════════════

/// Outcome of a single script execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionStatus {
    Success,
    Failed,
    Timeout,
    Cancelled,
    Skipped,
    ConditionNotMet,
}

/// A record of one script run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecord {
    /// Unique execution ID.
    pub id: String,
    /// Script ID.
    pub script_id: String,
    /// Script name (denormalized for history readability).
    pub script_name: String,
    /// Session ID this ran on (if applicable).
    #[serde(default)]
    pub session_id: Option<String>,
    /// Connection ID.
    #[serde(default)]
    pub connection_id: Option<String>,
    /// Which trigger fired.
    pub trigger_type: String,
    /// Start time.
    pub started_at: DateTime<Utc>,
    /// End time.
    #[serde(default)]
    pub ended_at: Option<DateTime<Utc>>,
    /// Duration in ms.
    #[serde(default)]
    pub duration_ms: u64,
    /// Exit code from the remote command (if any).
    #[serde(default)]
    pub exit_code: Option<i32>,
    /// Standard output captured (may be truncated).
    #[serde(default)]
    pub stdout: Option<String>,
    /// Standard error captured.
    #[serde(default)]
    pub stderr: Option<String>,
    /// Overall status.
    pub status: ExecutionStatus,
    /// Error message (if failed).
    #[serde(default)]
    pub error: Option<String>,
    /// Variables that were resolved for this run.
    #[serde(default)]
    pub resolved_variables: HashMap<String, String>,
    /// Retry attempt number (0 = first try).
    #[serde(default)]
    pub attempt: u32,
    /// Chain execution ID (if part of a chain).
    #[serde(default)]
    pub chain_execution_id: Option<String>,
    /// Step index within the chain.
    #[serde(default)]
    pub chain_step_index: Option<usize>,
}

/// Chain execution record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainExecutionRecord {
    pub id: String,
    pub chain_id: String,
    pub chain_name: String,
    pub session_id: Option<String>,
    pub connection_id: Option<String>,
    pub trigger_type: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub duration_ms: u64,
    pub status: ExecutionStatus,
    pub step_results: Vec<ExecutionRecord>,
    pub error: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Script Events (emitted to frontend)
// ═══════════════════════════════════════════════════════════════════════════════

/// Events emitted to the Tauri frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum ScriptEvent {
    /// A script started executing.
    Started {
        execution_id: String,
        script_id: String,
        script_name: String,
        session_id: Option<String>,
        trigger_type: String,
    },
    /// A script finished.
    Completed {
        execution_id: String,
        script_id: String,
        script_name: String,
        status: ExecutionStatus,
        duration_ms: u64,
        exit_code: Option<i32>,
        error: Option<String>,
    },
    /// Script output chunk (real-time streaming).
    Output {
        execution_id: String,
        script_id: String,
        stream: String, // "stdout" | "stderr"
        data: String,
    },
    /// A scheduled script's next run time.
    NextRun {
        script_id: String,
        next_at: DateTime<Utc>,
    },
    /// Condition check result.
    ConditionResult {
        script_id: String,
        passed: bool,
        condition_desc: String,
    },
    /// Variable resolved.
    VariableResolved {
        execution_id: String,
        name: String,
        value: String,
        source: String,
    },
    /// Scheduler tick.
    SchedulerTick {
        active_timers: u64,
        next_fires: Vec<SchedulerEntry>,
    },
}

/// Entry visible in the scheduler dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerEntry {
    pub script_id: String,
    pub script_name: String,
    pub trigger_type: String,
    pub next_fire: Option<DateTime<Utc>>,
    pub last_fire: Option<DateTime<Utc>>,
    pub run_count: u64,
    pub is_active: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Request / Response helpers for Tauri commands
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScriptRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub content: String,
    #[serde(default)]
    pub language: ScriptLanguage,
    #[serde(default)]
    pub execution_mode: ExecutionMode,
    pub trigger: ScriptTrigger,
    #[serde(default)]
    pub conditions: Vec<ScriptCondition>,
    #[serde(default)]
    pub variables: Vec<ScriptVariable>,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub on_failure: OnFailure,
    #[serde(default)]
    pub max_retries: u32,
    #[serde(default = "default_retry_delay")]
    pub retry_delay_ms: u64,
    #[serde(default)]
    pub run_as_user: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub environment: HashMap<String, String>,
    #[serde(default)]
    pub notifications: Vec<ScriptNotification>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub host_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScriptRequest {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub language: Option<ScriptLanguage>,
    #[serde(default)]
    pub execution_mode: Option<ExecutionMode>,
    #[serde(default)]
    pub trigger: Option<ScriptTrigger>,
    #[serde(default)]
    pub conditions: Option<Vec<ScriptCondition>>,
    #[serde(default)]
    pub variables: Option<Vec<ScriptVariable>>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub on_failure: Option<OnFailure>,
    #[serde(default)]
    pub max_retries: Option<u32>,
    #[serde(default)]
    pub retry_delay_ms: Option<u64>,
    #[serde(default)]
    pub run_as_user: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub environment: Option<HashMap<String, String>>,
    #[serde(default)]
    pub notifications: Option<Vec<ScriptNotification>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub priority: Option<i32>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub connection_ids: Option<Vec<String>>,
    #[serde(default)]
    pub host_patterns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChainRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub trigger: ScriptTrigger,
    pub steps: Vec<ChainStep>,
    #[serde(default)]
    pub abort_on_failure: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChainRequest {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub trigger: Option<ScriptTrigger>,
    #[serde(default)]
    pub steps: Option<Vec<ChainStep>>,
    #[serde(default)]
    pub abort_on_failure: Option<bool>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunScriptRequest {
    pub script_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    /// Override variables for this run.
    #[serde(default)]
    pub variable_overrides: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunChainRequest {
    pub chain_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub variable_overrides: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    #[serde(default)]
    pub script_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub status: Option<ExecutionStatus>,
    #[serde(default)]
    pub trigger_type: Option<String>,
    #[serde(default)]
    pub since: Option<DateTime<Utc>>,
    #[serde(default)]
    pub until: Option<DateTime<Utc>>,
    #[serde(default)]
    pub limit: Option<u64>,
    #[serde(default)]
    pub offset: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResponse {
    pub records: Vec<ExecutionRecord>,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptStats {
    pub script_id: String,
    pub total_runs: u64,
    pub success_count: u64,
    pub failure_count: u64,
    pub timeout_count: u64,
    pub avg_duration_ms: f64,
    pub last_run: Option<DateTime<Utc>>,
    pub last_status: Option<ExecutionStatus>,
}

/// SSH lifecycle event used internally to fire scripts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshLifecycleEvent {
    pub event_type: SshLifecycleEventType,
    pub session_id: String,
    pub connection_id: Option<String>,
    pub host: Option<String>,
    pub username: Option<String>,
    pub timestamp: DateTime<Utc>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SshLifecycleEventType {
    Connected,
    Disconnected,
    Reconnected,
    ConnectionError,
    KeepaliveFailed,
    Idle,
    Resize,
    PortForwardEstablished,
    PortForwardClosed,
    HostKeyChanged,
    OutputMatch,
}

/// Import/export format for scripts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptBundle {
    pub version: String,
    pub exported_at: DateTime<Utc>,
    pub scripts: Vec<SshEventScript>,
    pub chains: Vec<ScriptChain>,
}
