use std::fmt;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const MAX_ACTIVE_POWERSHELL_SESSIONS: usize = 32;
pub const MAX_EVENT_CAPACITY: usize = 8_192;
pub const MAX_EVENT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_COMMAND_QUEUE_CAPACITY: usize = 256;
pub const MAX_SCRIPT_BYTES: usize = 1024 * 1024;
pub const MAX_INPUT_TEXT_BYTES: usize = 1024 * 1024;

#[derive(Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PowerShellSshAuth {
    Password {
        password: String,
    },
    PrivateKey {
        path: PathBuf,
        #[serde(default)]
        passphrase: Option<String>,
    },
    Agent,
}

impl fmt::Debug for PowerShellSshAuth {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Password { .. } => formatter.write_str("Password([REDACTED])"),
            Self::PrivateKey { path, passphrase } => formatter
                .debug_struct("PrivateKey")
                .field("path", path)
                .field("passphrase", &passphrase.as_ref().map(|_| "[REDACTED]"))
                .finish(),
            Self::Agent => formatter.write_str("Agent(unsupported)"),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PowerShellSshHostKeyPolicy {
    PinnedSha256 { fingerprint: String },
    KnownHosts { path: PathBuf },
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellSshSessionOptions {
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub username: String,
    pub auth: PowerShellSshAuth,
    pub host_key_policy: PowerShellSshHostKeyPolicy,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default = "default_subsystem")]
    pub subsystem: String,
    #[serde(default = "default_connect_timeout_ms")]
    pub connect_timeout_ms: u64,
    #[serde(default = "default_request_timeout_ms")]
    pub request_timeout_ms: u64,
    #[serde(default = "default_event_capacity")]
    pub event_capacity: usize,
    #[serde(default = "default_command_queue_capacity")]
    pub command_queue_capacity: usize,
    #[serde(default = "default_queue_wait_timeout_ms")]
    pub queue_wait_timeout_ms: u64,
}

impl fmt::Debug for PowerShellSshSessionOptions {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PowerShellSshSessionOptions")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("auth", &self.auth)
            .field("host_key_policy", &self.host_key_policy)
            .field("connection_id", &self.connection_id)
            .field("subsystem", &self.subsystem)
            .field("connect_timeout_ms", &self.connect_timeout_ms)
            .field("request_timeout_ms", &self.request_timeout_ms)
            .field("event_capacity", &self.event_capacity)
            .field("command_queue_capacity", &self.command_queue_capacity)
            .field("queue_wait_timeout_ms", &self.queue_wait_timeout_ms)
            .finish()
    }
}

impl PowerShellSshSessionOptions {
    pub(crate) fn validate(&self) -> Result<(), PowerShellSessionError> {
        if self.host.trim().is_empty() || self.host.len() > 253 {
            return Err(PowerShellSessionError::invalid("host"));
        }
        if self.port == 0 {
            return Err(PowerShellSessionError::invalid("port"));
        }
        if self.username.trim().is_empty() || self.username.len() > 256 {
            return Err(PowerShellSessionError::invalid("username"));
        }
        if self.connection_id.as_ref().is_some_and(|id| id.len() > 256) {
            return Err(PowerShellSessionError::invalid("connectionId"));
        }
        if self.subsystem.is_empty()
            || !self
                .subsystem
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        {
            return Err(PowerShellSessionError::invalid("subsystem"));
        }
        if self.connect_timeout_ms == 0
            || self.connect_timeout_ms > 300_000
            || self.request_timeout_ms == 0
            || self.request_timeout_ms > 300_000
        {
            return Err(PowerShellSessionError::invalid("timeouts"));
        }
        if self.event_capacity == 0
            || self.event_capacity > MAX_EVENT_CAPACITY
            || self.command_queue_capacity == 0
            || self.command_queue_capacity > MAX_COMMAND_QUEUE_CAPACITY
            || self.queue_wait_timeout_ms == 0
            || self.queue_wait_timeout_ms > 60_000
        {
            return Err(PowerShellSessionError::invalid("limits"));
        }
        if matches!(self.auth, PowerShellSshAuth::Agent) {
            return Err(PowerShellSessionError::AuthenticationUnsupported);
        }
        Ok(())
    }
}

const fn default_ssh_port() -> u16 {
    22
}

fn default_subsystem() -> String {
    "powershell".to_owned()
}

const fn default_connect_timeout_ms() -> u64 {
    15_000
}

const fn default_request_timeout_ms() -> u64 {
    30_000
}

const fn default_event_capacity() -> usize {
    2_048
}

const fn default_command_queue_capacity() -> usize {
    64
}

const fn default_queue_wait_timeout_ms() -> u64 {
    2_000
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum PowerShellPipelineInput {
    Null,
    String(String),
    Boolean(bool),
    Integer(i64),
    Float(f64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PowerShellSessionPhase {
    Ready,
    Running,
    Cancelling,
    Closing,
    Closed,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PowerShellStreamKind {
    Output,
    Error,
    Warning,
    Verbose,
    Debug,
    Information,
    Progress,
    PipelineState,
    SessionState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellProgress {
    pub activity: Option<String>,
    pub activity_id: Option<i32>,
    pub status_description: Option<String>,
    pub current_operation: Option<String>,
    pub parent_activity_id: Option<i32>,
    pub percent_complete: Option<i32>,
    pub seconds_remaining: Option<i32>,
    pub record_type: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellSessionEvent {
    pub session_id: String,
    pub sequence: u64,
    pub timestamp_ms: i64,
    pub pipeline_id: Option<String>,
    pub kind: PowerShellStreamKind,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<PowerShellProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pipeline_state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellEventEnvelope {
    pub event: PowerShellSessionEvent,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellEventReplay {
    pub session_id: String,
    pub oldest_sequence: u64,
    pub next_sequence: u64,
    pub truncated: bool,
    pub evicted_events: u64,
    pub events: Vec<PowerShellSessionEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellSessionCapabilities {
    pub transport: String,
    pub persistent_runspace: bool,
    pub pipeline_input: bool,
    pub pipeline_cancellation: bool,
    pub all_streams: bool,
    pub progress_records: bool,
    pub bounded_replay: bool,
    pub ui_reattach: bool,
    pub transport_reconnect: bool,
    pub wsman_available: bool,
    pub max_concurrent_pipelines: usize,
}

impl Default for PowerShellSessionCapabilities {
    fn default() -> Self {
        Self {
            transport: "ssh".to_owned(),
            persistent_runspace: true,
            pipeline_input: true,
            pipeline_cancellation: true,
            all_streams: true,
            progress_records: true,
            bounded_replay: true,
            ui_reattach: true,
            transport_reconnect: false,
            wsman_available: false,
            max_concurrent_pipelines: 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellSessionStats {
    pub opened_at_ms: i64,
    pub last_activity_at_ms: i64,
    pub closed_at_ms: Option<i64>,
    pub pipelines_started: u64,
    pub pipelines_completed: u64,
    pub pipelines_failed: u64,
    pub pipelines_cancelled: u64,
    pub input_objects_sent: u64,
    pub events_emitted: u64,
    pub delivery_failures: u64,
    pub replay_evictions: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellSessionDiagnostics {
    pub transport: String,
    pub host_key_verification: String,
    pub authentication: String,
    pub runspace_health: String,
    pub active_pipeline: Option<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellSession {
    pub id: String,
    pub connection_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub runspace_id: String,
    pub phase: PowerShellSessionPhase,
    pub active_pipeline_id: Option<String>,
    pub input_open: bool,
    pub terminal_error_code: Option<String>,
    pub capabilities: PowerShellSessionCapabilities,
    pub stats: PowerShellSessionStats,
    pub diagnostics: PowerShellSessionDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellPipelineStarted {
    pub session_id: String,
    pub pipeline_id: String,
    pub input_open: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", content = "details", rename_all = "snake_case")]
pub enum PowerShellSessionError {
    InvalidConfiguration { field: String },
    AuthenticationUnsupported,
    SessionLimitReached,
    SessionNotFound,
    SessionClosed,
    PipelineBusy,
    PipelineNotRunning,
    PipelineInputClosed,
    ScriptTooLarge,
    InputTooLarge,
    CommandQueueFull,
    CommandTimedOut,
    DeliveryUnavailable,
    ConnectionFailed,
    RunspaceOpenFailed,
    ProtocolFailed,
}

impl fmt::Display for PowerShellSessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidConfiguration { .. } => "PowerShell session configuration is invalid",
            Self::AuthenticationUnsupported => {
                "SSH agent authentication is not available for strict PowerShell remoting"
            }
            Self::SessionLimitReached => "the PowerShell session limit has been reached",
            Self::SessionNotFound => "the PowerShell session was not found",
            Self::SessionClosed => "the PowerShell session is closed",
            Self::PipelineBusy => "a PowerShell pipeline is already running",
            Self::PipelineNotRunning => "no PowerShell pipeline is running",
            Self::PipelineInputClosed => "the active PowerShell pipeline does not accept input",
            Self::ScriptTooLarge => "the PowerShell script exceeds the configured safety limit",
            Self::InputTooLarge => "the PowerShell input value exceeds the configured safety limit",
            Self::CommandQueueFull => "the PowerShell session command queue is full",
            Self::CommandTimedOut => "the PowerShell session command timed out",
            Self::DeliveryUnavailable => "PowerShell event delivery is unavailable",
            Self::ConnectionFailed => "the strict SSH connection could not be established",
            Self::RunspaceOpenFailed => "the PowerShell runspace could not be opened",
            Self::ProtocolFailed => "the PowerShell remoting protocol failed",
        })
    }
}

impl std::error::Error for PowerShellSessionError {}

impl PowerShellSessionError {
    pub(crate) fn invalid(field: impl Into<String>) -> Self {
        Self::InvalidConfiguration {
            field: field.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidConfiguration { .. } => "invalid_configuration",
            Self::AuthenticationUnsupported => "authentication_unsupported",
            Self::SessionLimitReached => "session_limit_reached",
            Self::SessionNotFound => "session_not_found",
            Self::SessionClosed => "session_closed",
            Self::PipelineBusy => "pipeline_busy",
            Self::PipelineNotRunning => "pipeline_not_running",
            Self::PipelineInputClosed => "pipeline_input_closed",
            Self::ScriptTooLarge => "script_too_large",
            Self::InputTooLarge => "input_too_large",
            Self::CommandQueueFull => "command_queue_full",
            Self::CommandTimedOut => "command_timed_out",
            Self::DeliveryUnavailable => "delivery_unavailable",
            Self::ConnectionFailed => "connection_failed",
            Self::RunspaceOpenFailed => "runspace_open_failed",
            Self::ProtocolFailed => "protocol_failed",
        }
    }
}
