//! All data types, error handling, and configuration for the extensions engine.

use std::collections::HashMap;
use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── Error ──────────────────────────────────────────────────────────

/// Kinds of extension errors.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExtErrorKind {
    /// Extension manifest is invalid or missing required fields.
    ManifestInvalid,
    /// Extension not found in the registry.
    NotFound,
    /// Extension is already installed.
    AlreadyInstalled,
    /// Extension is already enabled/disabled.
    AlreadyInState,
    /// Permission denied — the extension lacks the required permission.
    PermissionDenied,
    /// Sandbox resource limit exceeded.
    SandboxViolation,
    /// Script syntax or runtime error.
    ScriptError,
    /// Hook registration or dispatch error.
    HookError,
    /// Storage read/write error.
    StorageError,
    /// Dependency not satisfied.
    DependencyError,
    /// Extension version conflict.
    VersionConflict,
    /// Extension is in an invalid state for the requested operation.
    InvalidState,
    /// I/O or filesystem error.
    IoError,
    /// Script execution timed out.
    Timeout,
    /// API call not available.
    ApiUnavailable,
    /// Catch-all.
    Unknown,
}

impl fmt::Display for ExtErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

/// Top-level error type for the extensions engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtError {
    pub kind: ExtErrorKind,
    pub message: String,
    /// The offending extension ID, if applicable.
    pub extension_id: Option<String>,
}

impl ExtError {
    pub fn new(kind: ExtErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
            extension_id: None,
        }
    }

    pub fn with_ext(mut self, id: impl Into<String>) -> Self {
        self.extension_id = Some(id.into());
        self
    }

    // ── Named constructors ───────────────────────────────────────

    pub fn manifest(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::ManifestInvalid, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::NotFound, msg)
    }

    pub fn already_installed(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::AlreadyInstalled, msg)
    }

    pub fn already_in_state(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::AlreadyInState, msg)
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::PermissionDenied, msg)
    }

    pub fn sandbox(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::SandboxViolation, msg)
    }

    pub fn script(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::ScriptError, msg)
    }

    pub fn hook(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::HookError, msg)
    }

    pub fn storage(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::StorageError, msg)
    }

    pub fn dependency(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::DependencyError, msg)
    }

    pub fn version_conflict(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::VersionConflict, msg)
    }

    pub fn invalid_state(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::InvalidState, msg)
    }

    pub fn io(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::IoError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::Timeout, msg)
    }

    pub fn api_unavailable(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::ApiUnavailable, msg)
    }

    pub fn unknown(msg: impl Into<String>) -> Self {
        Self::new(ExtErrorKind::Unknown, msg)
    }
}

impl fmt::Display for ExtError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(ref ext_id) = self.extension_id {
            write!(f, "[{}] {}: {}", ext_id, self.kind, self.message)
        } else {
            write!(f, "{}: {}", self.kind, self.message)
        }
    }
}

impl std::error::Error for ExtError {}

/// Convenience alias.
pub type ExtResult<T> = Result<T, ExtError>;

// ─── Extension Status ───────────────────────────────────────────────

/// The lifecycle status of an extension.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExtensionStatus {
    /// Installed but not yet enabled.
    Installed,
    /// Active and running.
    Enabled,
    /// Manually disabled by the user.
    Disabled,
    /// In error state due to a runtime failure.
    Error,
    /// Currently being updated.
    Updating,
    /// Uninstallation pending (will be removed on next restart).
    PendingRemoval,
}

impl fmt::Display for ExtensionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Installed => write!(f, "installed"),
            Self::Enabled => write!(f, "enabled"),
            Self::Disabled => write!(f, "disabled"),
            Self::Error => write!(f, "error"),
            Self::Updating => write!(f, "updating"),
            Self::PendingRemoval => write!(f, "pending_removal"),
        }
    }
}

// ─── Extension Type ─────────────────────────────────────────────────

/// What kind of extension this is.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExtensionType {
    /// A general-purpose script that runs in the sandbox.
    Script,
    /// A connection provider (e.g. a custom protocol adapter).
    ConnectionProvider,
    /// A UI theme or visual customization.
    Theme,
    /// A toolbar / utility tool.
    Tool,
    /// A dashboard widget.
    Widget,
    /// An import/export format adapter.
    ImportExport,
    /// An authentication provider.
    AuthProvider,
    /// A notification channel (e.g. Slack, Discord, custom webhook).
    NotificationChannel,
    /// A credential store adapter.
    CredentialStore,
    /// A monitoring / health-check plugin.
    Monitor,
}

impl fmt::Display for ExtensionType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

// ─── Permissions ────────────────────────────────────────────────────

/// Fine-grained permission tokens that extensions may request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Permission {
    // ── Connection ──
    /// Read the connection tree / list.
    ConnectionRead,
    /// Create or modify connections.
    ConnectionWrite,
    /// Initiate / tear-down connections.
    ConnectionConnect,

    // ── Storage ──
    /// Read own extension storage.
    StorageRead,
    /// Write own extension storage.
    StorageWrite,

    // ── Network ──
    /// Make outbound HTTP requests.
    NetworkHttp,
    /// Open arbitrary TCP sockets.
    NetworkTcp,

    // ── Filesystem ──
    /// Read files (within allowed paths).
    FileRead,
    /// Write files (within allowed paths).
    FileWrite,

    // ── System ──
    /// Read basic system / host information.
    SystemInfo,
    /// Execute local processes.
    ProcessExec,
    /// Access environment variables.
    EnvRead,
    /// Access clipboard.
    ClipboardAccess,

    // ── UI ──
    /// Send desktop / in-app notifications.
    NotificationSend,
    /// Modify menus or toolbars.
    MenuModify,
    /// Open dialogs.
    DialogOpen,

    // ── Events ──
    /// Subscribe to application events.
    EventSubscribe,
    /// Emit custom events.
    EventEmit,

    // ── Crypto ──
    /// Access secure random / hashing APIs.
    CryptoAccess,

    // ── Settings ──
    /// Read application settings.
    SettingsRead,
    /// Write application settings.
    SettingsWrite,

    // ── Custom ──
    /// An arbitrary custom permission string.
    Custom(String),
}

impl fmt::Display for Permission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Custom(s) => write!(f, "custom:{}", s),
            other => write!(f, "{:?}", other),
        }
    }
}

/// A set of permissions that can be grouped together.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionGroup {
    pub name: String,
    pub description: String,
    pub permissions: Vec<Permission>,
}

// ─── Hook Events ────────────────────────────────────────────────────

/// Application lifecycle and domain events that extensions can subscribe to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum HookEvent {
    // ── App Lifecycle ──
    AppStartup,
    AppShutdown,
    AppFocused,
    AppBlurred,

    // ── Connection Lifecycle ──
    ConnectionOpened,
    ConnectionClosed,
    ConnectionError,
    ConnectionReconnecting,

    // ── Session Lifecycle ──
    SessionCreated,
    SessionDestroyed,
    SessionIdle,
    SessionResumed,

    // ── File Transfer ──
    FileTransferStarted,
    FileTransferProgress,
    FileTransferCompleted,
    FileTransferFailed,

    // ── Authentication ──
    UserLoggedIn,
    UserLoggedOut,
    AuthFailed,

    // ── Settings ──
    SettingsChanged,
    ThemeChanged,

    // ── Extensions ──
    ExtensionLoaded,
    ExtensionUnloaded,
    ExtensionError,

    // ── Network ──
    NetworkStatusChanged,
    HostDiscovered,

    // ── Data ──
    DataImported,
    DataExported,
    BackupCreated,

    // ── Scheduling ──
    ScheduledTaskTriggered,
    TimerFired,

    // ── Custom event emitted by other extensions ──
    Custom(String),
}

impl fmt::Display for HookEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Custom(s) => write!(f, "custom:{}", s),
            other => write!(f, "{:?}", other),
        }
    }
}

/// A hook registration mapping an event to a handler function name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookRegistration {
    /// The event to listen for.
    pub event: HookEvent,
    /// The handler function name in the extension's script.
    pub handler: String,
    /// Priority (lower number = higher priority, default 100).
    pub priority: i32,
    /// Whether this hook is currently active.
    pub enabled: bool,
}

impl HookRegistration {
    pub fn new(event: HookEvent, handler: impl Into<String>) -> Self {
        Self {
            event,
            handler: handler.into(),
            priority: 100,
            enabled: true,
        }
    }

    pub fn with_priority(mut self, priority: i32) -> Self {
        self.priority = priority;
        self
    }
}

/// Payload delivered to a hook handler when an event fires.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookPayload {
    /// The event that was fired.
    pub event: HookEvent,
    /// Timestamp of the event.
    pub timestamp: DateTime<Utc>,
    /// Arbitrary JSON data associated with the event.
    pub data: serde_json::Value,
    /// The source that triggered the event (e.g. "app", "extension:<id>").
    pub source: String,
}

/// The result of a single hook handler invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookResult {
    pub extension_id: String,
    pub hook_event: String,
    pub handler: String,
    pub success: bool,
    pub output: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: u64,
}

// ─── Sandbox Configuration ──────────────────────────────────────────

/// Resource limits and isolation settings for sandboxed execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    /// Maximum memory usage in megabytes.
    pub max_memory_mb: u64,
    /// Maximum wall-clock execution time per invocation in milliseconds.
    pub max_execution_time_ms: u64,
    /// Maximum number of script instructions per invocation.
    pub max_instructions: u64,
    /// Maximum call stack depth.
    pub max_call_depth: u32,
    /// Maximum number of concurrent API calls.
    pub max_concurrent_api_calls: u32,
    /// Whether outbound network access is allowed.
    pub allow_network: bool,
    /// Whether filesystem access is allowed.
    pub allow_file_access: bool,
    /// Whether process execution is allowed.
    pub allow_process_exec: bool,
    /// Allowed outbound hosts for network requests.
    pub allowed_hosts: Vec<String>,
    /// Allowed filesystem paths.
    pub allowed_paths: Vec<String>,
    /// Maximum number of API calls per minute (rate limit).
    pub api_rate_limit_per_min: u32,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            max_memory_mb: 64,
            max_execution_time_ms: 30_000,
            max_instructions: 1_000_000,
            max_call_depth: 64,
            max_concurrent_api_calls: 10,
            allow_network: false,
            allow_file_access: false,
            allow_process_exec: false,
            allowed_hosts: Vec::new(),
            allowed_paths: Vec::new(),
            api_rate_limit_per_min: 60,
        }
    }
}

/// Tracks resource utilization during sandboxed execution.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxMetrics {
    /// Instructions executed so far.
    pub instructions_executed: u64,
    /// Approximate memory used in bytes.
    pub memory_used_bytes: u64,
    /// Current call-stack depth.
    pub current_call_depth: u32,
    /// API calls made in the current minute window.
    pub api_calls_this_minute: u32,
    /// Total API calls made.
    pub total_api_calls: u64,
    /// Wall-clock time elapsed in milliseconds.
    pub elapsed_ms: u64,
}

// ─── Extension Manifest ─────────────────────────────────────────────

/// A dependency on another extension.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionDependency {
    /// The required extension's ID.
    pub extension_id: String,
    /// Minimum version (semver). `None` means any version.
    pub min_version: Option<String>,
    /// Maximum version (semver). `None` means any version.
    pub max_version: Option<String>,
    /// Whether this dependency is optional.
    pub optional: bool,
}

/// A setting definition in the extension's settings schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingDefinition {
    /// Setting key.
    pub key: String,
    /// Human-readable label.
    pub label: String,
    /// Description / help text.
    pub description: Option<String>,
    /// The data type of the setting.
    pub setting_type: SettingType,
    /// Default value.
    pub default_value: Option<serde_json::Value>,
    /// Whether this setting is required.
    pub required: bool,
    /// Allowed values (for enum types).
    pub options: Option<Vec<SettingOption>>,
    /// Validation regex pattern (for string types).
    pub validation_pattern: Option<String>,
}

/// The data type of an extension setting.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SettingType {
    String,
    Number,
    Boolean,
    Select,
    MultiSelect,
    Password,
    FilePath,
    Color,
    Json,
}

/// A selectable option for enum-type settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingOption {
    pub label: String,
    pub value: serde_json::Value,
}

/// Top-level extension manifest — the "package.json" of an extension.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionManifest {
    /// Unique extension ID (reverse-dns style, e.g. "com.example.my-ext").
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Semver version string.
    pub version: String,
    /// Short description.
    pub description: String,
    /// Author name or email.
    pub author: String,
    /// SPDX license identifier.
    pub license: Option<String>,
    /// Project homepage URL.
    pub homepage: Option<String>,
    /// Source repository URL.
    pub repository: Option<String>,
    /// Minimum app version this extension is compatible with.
    pub min_app_version: Option<String>,
    /// Maximum app version this extension is compatible with.
    pub max_app_version: Option<String>,
    /// The type of extension.
    pub extension_type: ExtensionType,
    /// Permissions requested by the extension.
    pub permissions: Vec<Permission>,
    /// Hook registrations.
    pub hooks: Vec<HookRegistration>,
    /// The main script entry point (filename relative to extension dir).
    pub entry_point: String,
    /// Optional icon filename (relative to extension dir).
    pub icon: Option<String>,
    /// Settings schema.
    pub settings_schema: Vec<SettingDefinition>,
    /// Dependencies on other extensions.
    pub dependencies: Vec<ExtensionDependency>,
    /// Free-form tags for categorization.
    pub tags: Vec<String>,
    /// Keywords for search / discoverability.
    pub keywords: Vec<String>,
    /// When the manifest was originally created.
    pub created_at: DateTime<Utc>,
    /// When the manifest was last updated.
    pub updated_at: DateTime<Utc>,
}

// ─── Extension State ────────────────────────────────────────────────

/// The full runtime state of an installed extension.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionState {
    /// The validated manifest.
    pub manifest: ExtensionManifest,
    /// Current lifecycle status.
    pub status: ExtensionStatus,
    /// When the extension was installed.
    pub installed_at: DateTime<Utc>,
    /// When the extension was last enabled.
    pub enabled_at: Option<DateTime<Utc>>,
    /// When the extension was last disabled.
    pub disabled_at: Option<DateTime<Utc>>,
    /// Last error message, if any.
    pub last_error: Option<String>,
    /// Total number of times the extension's handlers were invoked.
    pub execution_count: u64,
    /// Total execution time across all invocations in milliseconds.
    pub total_execution_time_ms: u64,
    /// Current user settings (key → value).
    pub settings: HashMap<String, serde_json::Value>,
    /// Sandbox configuration overrides.
    pub sandbox_config: SandboxConfig,
    /// The script source code (loaded from entry_point file).
    pub script_source: Option<String>,
    /// SHA-256 hash of the script source for integrity checking.
    pub script_hash: Option<String>,
}

// ─── Storage ────────────────────────────────────────────────────────

/// A single key-value entry in per-extension storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageEntry {
    /// The storage key.
    pub key: String,
    /// The stored value (arbitrary JSON).
    pub value: serde_json::Value,
    /// When the entry was created.
    pub created_at: DateTime<Utc>,
    /// When the entry was last updated.
    pub updated_at: DateTime<Utc>,
}

/// Summary information about an extension's storage usage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageSummary {
    /// Number of entries.
    pub entry_count: usize,
    /// Approximate total size in bytes.
    pub total_size_bytes: u64,
    /// Oldest entry timestamp.
    pub oldest_entry: Option<DateTime<Utc>>,
    /// Newest entry timestamp.
    pub newest_entry: Option<DateTime<Utc>>,
}

// ─── Script / Runtime ───────────────────────────────────────────────

/// A value in the script runtime.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ScriptValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    String(String),
    Array(Vec<ScriptValue>),
    Object(HashMap<String, ScriptValue>),
}

impl ScriptValue {
    /// Try to convert to a boolean.
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Bool(b) => Some(*b),
            Self::Int(i) => Some(*i != 0),
            Self::String(s) => Some(!s.is_empty()),
            Self::Null => Some(false),
            _ => None,
        }
    }

    /// Try to convert to an integer.
    pub fn as_int(&self) -> Option<i64> {
        match self {
            Self::Int(i) => Some(*i),
            Self::Float(f) => Some(*f as i64),
            Self::Bool(b) => Some(if *b { 1 } else { 0 }),
            Self::String(s) => s.parse().ok(),
            _ => None,
        }
    }

    /// Try to convert to a float.
    pub fn as_float(&self) -> Option<f64> {
        match self {
            Self::Float(f) => Some(*f),
            Self::Int(i) => Some(*i as f64),
            Self::String(s) => s.parse().ok(),
            _ => None,
        }
    }

    /// Try to convert to a string.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(s) => Some(s),
            _ => None,
        }
    }

    /// Convert to a display string.
    pub fn to_display_string(&self) -> String {
        match self {
            Self::Null => "null".to_string(),
            Self::Bool(b) => b.to_string(),
            Self::Int(i) => i.to_string(),
            Self::Float(f) => f.to_string(),
            Self::String(s) => s.clone(),
            Self::Array(a) => {
                let items: Vec<String> = a.iter().map(|v| v.to_display_string()).collect();
                format!("[{}]", items.join(", "))
            }
            Self::Object(o) => {
                let items: Vec<String> = o
                    .iter()
                    .map(|(k, v)| format!("{}: {}", k, v.to_display_string()))
                    .collect();
                format!("{{{}}}", items.join(", "))
            }
        }
    }

    /// Check if the value is truthy.
    pub fn is_truthy(&self) -> bool {
        match self {
            Self::Null => false,
            Self::Bool(b) => *b,
            Self::Int(i) => *i != 0,
            Self::Float(f) => *f != 0.0,
            Self::String(s) => !s.is_empty(),
            Self::Array(a) => !a.is_empty(),
            Self::Object(o) => !o.is_empty(),
        }
    }
}

impl From<serde_json::Value> for ScriptValue {
    fn from(v: serde_json::Value) -> Self {
        match v {
            serde_json::Value::Null => Self::Null,
            serde_json::Value::Bool(b) => Self::Bool(b),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Self::Int(i)
                } else {
                    Self::Float(n.as_f64().unwrap_or(0.0))
                }
            }
            serde_json::Value::String(s) => Self::String(s),
            serde_json::Value::Array(arr) => {
                Self::Array(arr.into_iter().map(ScriptValue::from).collect())
            }
            serde_json::Value::Object(map) => {
                let obj: HashMap<String, ScriptValue> = map
                    .into_iter()
                    .map(|(k, v)| (k, ScriptValue::from(v)))
                    .collect();
                Self::Object(obj)
            }
        }
    }
}

impl From<ScriptValue> for serde_json::Value {
    fn from(v: ScriptValue) -> Self {
        match v {
            ScriptValue::Null => serde_json::Value::Null,
            ScriptValue::Bool(b) => serde_json::Value::Bool(b),
            ScriptValue::Int(i) => serde_json::Value::Number(serde_json::Number::from(i)),
            ScriptValue::Float(f) => serde_json::Number::from_f64(f)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null),
            ScriptValue::String(s) => serde_json::Value::String(s),
            ScriptValue::Array(arr) => {
                serde_json::Value::Array(arr.into_iter().map(serde_json::Value::from).collect())
            }
            ScriptValue::Object(map) => {
                let obj: serde_json::Map<String, serde_json::Value> = map
                    .into_iter()
                    .map(|(k, v)| (k, serde_json::Value::from(v)))
                    .collect();
                serde_json::Value::Object(obj)
            }
        }
    }
}

/// A single instruction in the extension script.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScriptInstruction {
    /// Set a variable: `let <name> = <expression>`.
    SetVar { name: String, value: ScriptValue },
    /// Call a built-in API function.
    CallApi {
        function: String,
        args: Vec<ScriptValue>,
        /// Variable name to store the result in (optional).
        result_var: Option<String>,
    },
    /// Conditional block.
    If {
        condition: ScriptCondition,
        then_block: Vec<ScriptInstruction>,
        else_block: Vec<ScriptInstruction>,
    },
    /// Loop a fixed number of times.
    Loop {
        count: u64,
        iterator_var: String,
        body: Vec<ScriptInstruction>,
    },
    /// While loop.
    While {
        condition: ScriptCondition,
        body: Vec<ScriptInstruction>,
    },
    /// Return a value.
    Return { value: ScriptValue },
    /// Log a message (maps to log::info!).
    Log { level: LogLevel, message: String },
    /// Emit a custom event.
    EmitEvent {
        event_name: String,
        data: ScriptValue,
    },
    /// Sleep / delay in milliseconds.
    Sleep { ms: u64 },
    /// Try-catch block for error handling.
    TryCatch {
        try_block: Vec<ScriptInstruction>,
        catch_var: String,
        catch_block: Vec<ScriptInstruction>,
    },
    /// Break out of a loop.
    Break,
    /// Continue to the next iteration of a loop.
    Continue,
    /// No-op (used for comments / markers).
    Noop { comment: Option<String> },
}

/// Conditions for if/while instructions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScriptCondition {
    /// Check if a variable is truthy.
    VarTruthy(String),
    /// Compare two values.
    Compare {
        left: ScriptValue,
        op: CompareOp,
        right: ScriptValue,
    },
    /// Logical AND of two conditions.
    And(Box<ScriptCondition>, Box<ScriptCondition>),
    /// Logical OR of two conditions.
    Or(Box<ScriptCondition>, Box<ScriptCondition>),
    /// Logical NOT.
    Not(Box<ScriptCondition>),
    /// Always true.
    Always,
}

/// Comparison operators.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CompareOp {
    Equal,
    NotEqual,
    LessThan,
    LessEqual,
    GreaterThan,
    GreaterEqual,
    Contains,
    StartsWith,
    EndsWith,
    Matches,
}

/// Log levels for script logging.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// A parsed extension script — a named collection of handlers.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtensionScript {
    /// Named handler functions in the script.
    pub handlers: HashMap<String, Vec<ScriptInstruction>>,
    /// Global initialization instructions (run once on load).
    pub init: Vec<ScriptInstruction>,
    /// Cleanup instructions (run on unload).
    pub cleanup: Vec<ScriptInstruction>,
}

/// The result of executing a script handler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub success: bool,
    pub output: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub instructions_executed: u64,
    pub memory_used_bytes: u64,
    pub log_output: Vec<LogEntry>,
}

/// A log entry produced during script execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub level: LogLevel,
    pub message: String,
    pub timestamp: DateTime<Utc>,
}

// ─── API ────────────────────────────────────────────────────────────

/// Categories of APIs that extensions can call.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ApiCategory {
    /// Key-value storage operations.
    Storage,
    /// HTTP client operations.
    Http,
    /// Connection management.
    Connections,
    /// Event / hook operations.
    Events,
    /// Notification operations.
    Notifications,
    /// Crypto / hashing operations.
    Crypto,
    /// String / data utilities.
    Utility,
    /// Logging operations.
    Logging,
    /// Settings management.
    Settings,
    /// UI operations (dialogs, menus).
    Ui,
}

/// Metadata about an available API function.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiFunction {
    /// The fully-qualified function name (e.g. "storage.get").
    pub name: String,
    /// Human-readable description.
    pub description: String,
    /// Which API category this belongs to.
    pub category: ApiCategory,
    /// Required permissions to call this function.
    pub required_permissions: Vec<Permission>,
    /// Parameter descriptions.
    pub parameters: Vec<ApiParameter>,
    /// Return value description.
    pub returns: Option<String>,
}

/// Description of an API function parameter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiParameter {
    pub name: String,
    pub description: String,
    pub param_type: String,
    pub required: bool,
    pub default_value: Option<serde_json::Value>,
}

// ─── Registry / Marketplace ─────────────────────────────────────────

/// Search / filter criteria for browsing extensions.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtensionFilter {
    /// Match extension name or description.
    pub query: Option<String>,
    /// Filter by extension type.
    pub extension_type: Option<ExtensionType>,
    /// Filter by status.
    pub status: Option<ExtensionStatus>,
    /// Filter by tag.
    pub tag: Option<String>,
    /// Filter by author.
    pub author: Option<String>,
    /// Include only extensions with these permissions.
    pub has_permissions: Option<Vec<Permission>>,
    /// Sort field.
    pub sort_by: Option<ExtensionSortField>,
    /// Sort ascending.
    pub ascending: bool,
    /// Maximum results to return.
    pub limit: Option<usize>,
    /// Offset for pagination.
    pub offset: Option<usize>,
}

/// Fields to sort extension lists by.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExtensionSortField {
    Name,
    InstalledAt,
    UpdatedAt,
    ExecutionCount,
    Author,
    Status,
}

/// A summary view of an installed extension (used in lists).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub extension_type: ExtensionType,
    pub status: ExtensionStatus,
    pub installed_at: DateTime<Utc>,
    pub execution_count: u64,
    pub tags: Vec<String>,
    pub has_settings: bool,
    pub permission_count: usize,
    pub hook_count: usize,
}

// ─── Engine Configuration ───────────────────────────────────────────

/// Global configuration for the extensions engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    /// Whether the extension engine is enabled at all.
    pub enabled: bool,
    /// Default sandbox configuration for new extensions.
    pub default_sandbox: SandboxConfig,
    /// Maximum number of extensions that can be installed.
    pub max_extensions: usize,
    /// Maximum size of per-extension storage in bytes.
    pub max_storage_per_extension_bytes: u64,
    /// Whether to auto-enable extensions upon installation.
    pub auto_enable_on_install: bool,
    /// Whether to allow extensions to execute processes.
    pub allow_process_execution: bool,
    /// Whether to allow extensions to access the network.
    pub allow_network_access: bool,
    /// Global rate limit across all extensions (API calls/min).
    pub global_rate_limit_per_min: u32,
    /// Whether to log all extension API calls.
    pub audit_logging: bool,
    /// Extensions base directory path.
    pub extensions_dir: String,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            default_sandbox: SandboxConfig::default(),
            max_extensions: 100,
            max_storage_per_extension_bytes: 10 * 1024 * 1024, // 10 MB
            auto_enable_on_install: false,
            allow_process_execution: false,
            allow_network_access: false,
            global_rate_limit_per_min: 600,
            audit_logging: true,
            extensions_dir: "extensions".to_string(),
        }
    }
}

/// Statistics about the extensions engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStats {
    /// Total installed extensions.
    pub total_installed: usize,
    /// Total enabled extensions.
    pub total_enabled: usize,
    /// Total disabled extensions.
    pub total_disabled: usize,
    /// Total in error state.
    pub total_errored: usize,
    /// Total hook handlers registered.
    pub total_hooks: usize,
    /// Total script executions since startup.
    pub total_executions: u64,
    /// Total storage entries across all extensions.
    pub total_storage_entries: usize,
    /// Total storage size across all extensions in bytes.
    pub total_storage_bytes: u64,
    /// Engine uptime in seconds.
    pub uptime_seconds: u64,
    /// Global API calls made this minute.
    pub api_calls_this_minute: u32,
}

/// An audit log entry for extension activity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Unique entry ID.
    pub id: String,
    /// The extension that performed the action.
    pub extension_id: String,
    /// A human-readable action description.
    pub action: String,
    /// The API function called, if applicable.
    pub api_function: Option<String>,
    /// Whether the action succeeded.
    pub success: bool,
    /// Error message, if the action failed.
    pub error: Option<String>,
    /// Additional details.
    pub details: Option<serde_json::Value>,
    /// When the action occurred.
    pub timestamp: DateTime<Utc>,
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let err = ExtError::manifest("missing 'id' field");
        assert_eq!(err.to_string(), "ManifestInvalid: missing 'id' field");

        let err_with_ext =
            ExtError::permission_denied("network access denied").with_ext("com.example.test");
        assert!(err_with_ext.to_string().contains("com.example.test"));
        assert!(err_with_ext.to_string().contains("network access denied"));
    }

    #[test]
    fn status_display() {
        assert_eq!(ExtensionStatus::Enabled.to_string(), "enabled");
        assert_eq!(ExtensionStatus::Disabled.to_string(), "disabled");
        assert_eq!(
            ExtensionStatus::PendingRemoval.to_string(),
            "pending_removal"
        );
    }

    #[test]
    fn script_value_conversions() {
        let v = ScriptValue::Int(42);
        assert_eq!(v.as_int(), Some(42));
        assert_eq!(v.as_float(), Some(42.0));
        assert!(v.is_truthy());

        let v = ScriptValue::String("hello".into());
        assert_eq!(v.as_str(), Some("hello"));
        assert!(v.is_truthy());

        let v = ScriptValue::Null;
        assert!(!v.is_truthy());
        assert_eq!(v.as_bool(), Some(false));
    }

    #[test]
    fn script_value_from_json() {
        let json = serde_json::json!({"key": "value", "num": 42});
        let sv = ScriptValue::from(json.clone());
        let back: serde_json::Value = sv.into();
        assert_eq!(json, back);
    }

    #[test]
    fn script_value_display() {
        assert_eq!(ScriptValue::Null.to_display_string(), "null");
        assert_eq!(ScriptValue::Bool(true).to_display_string(), "true");
        assert_eq!(ScriptValue::Int(7).to_display_string(), "7");
        assert_eq!(ScriptValue::String("hi".into()).to_display_string(), "hi");
    }

    #[test]
    fn default_sandbox_config() {
        let cfg = SandboxConfig::default();
        assert_eq!(cfg.max_memory_mb, 64);
        assert_eq!(cfg.max_execution_time_ms, 30_000);
        assert!(!cfg.allow_network);
        assert!(!cfg.allow_file_access);
        assert!(!cfg.allow_process_exec);
    }

    #[test]
    fn default_engine_config() {
        let cfg = EngineConfig::default();
        assert!(cfg.enabled);
        assert_eq!(cfg.max_extensions, 100);
        assert!(!cfg.allow_process_execution);
        assert!(cfg.audit_logging);
    }

    #[test]
    fn hook_registration_builder() {
        let hook = HookRegistration::new(HookEvent::AppStartup, "on_startup").with_priority(50);
        assert_eq!(hook.priority, 50);
        assert!(hook.enabled);
        assert_eq!(hook.handler, "on_startup");
    }

    #[test]
    fn permission_display() {
        assert_eq!(Permission::ConnectionRead.to_string(), "ConnectionRead");
        assert_eq!(
            Permission::Custom("my.perm".into()).to_string(),
            "custom:my.perm"
        );
    }

    #[test]
    fn extension_filter_default() {
        let filter = ExtensionFilter::default();
        assert!(filter.query.is_none());
        assert!(filter.extension_type.is_none());
        assert!(!filter.ascending);
    }

    #[test]
    fn script_value_empty_collections() {
        let empty_arr = ScriptValue::Array(vec![]);
        assert!(!empty_arr.is_truthy());

        let empty_obj = ScriptValue::Object(HashMap::new());
        assert!(!empty_obj.is_truthy());
    }

    #[test]
    fn script_value_nested_roundtrip() {
        let json = serde_json::json!({
            "users": [
                {"name": "Alice", "age": 30},
                {"name": "Bob", "age": 25}
            ],
            "count": 2,
            "active": true
        });
        let sv = ScriptValue::from(json.clone());
        let back: serde_json::Value = sv.into();
        assert_eq!(json, back);
    }

    #[test]
    fn error_with_extension_id() {
        let err = ExtError::not_found("no such extension").with_ext("com.example.missing");
        assert_eq!(err.extension_id.as_deref(), Some("com.example.missing"));
        assert_eq!(err.kind, ExtErrorKind::NotFound);
    }

    #[test]
    fn sandbox_metrics_default() {
        let m = SandboxMetrics::default();
        assert_eq!(m.instructions_executed, 0);
        assert_eq!(m.memory_used_bytes, 0);
        assert_eq!(m.api_calls_this_minute, 0);
    }

    #[test]
    fn script_value_as_int_from_string() {
        let v = ScriptValue::String("123".into());
        assert_eq!(v.as_int(), Some(123));
    }

    #[test]
    fn script_value_as_float_from_string() {
        let v = ScriptValue::String("3.14".into());
        let f = v.as_float().unwrap();
        assert!((f - 3.14).abs() < 0.001);
    }
}
