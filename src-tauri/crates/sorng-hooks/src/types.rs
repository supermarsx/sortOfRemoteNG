//! Core types for the hook/event engine.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── Hook Events ────────────────────────────────────────────────────

/// Every lifecycle event the application can emit.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookEvent {
    AppStartup,
    AppShutdown,
    AppMinimized,
    AppRestored,
    ConnectionOpened,
    ConnectionClosed,
    ConnectionError,
    ConnectionReconnecting,
    ConnectionAuthenticated,
    SessionCreated,
    SessionDestroyed,
    SessionIdle,
    SessionResumed,
    FileTransferStarted,
    FileTransferCompleted,
    FileTransferFailed,
    BackupStarted,
    BackupCompleted,
    BackupFailed,
    SyncStarted,
    SyncCompleted,
    SyncFailed,
    SettingsChanged,
    ThemeChanged,
    CollectionOpened,
    CollectionClosed,
    CollectionModified,
    UserLoggedIn,
    UserLoggedOut,
    AutoLockTriggered,
    AutoLockReleased,
    ScriptStarted,
    ScriptCompleted,
    ScriptError,
    ExtensionLoaded,
    ExtensionUnloaded,
    ExtensionError,
    HealthCheckPassed,
    HealthCheckFailed,
    CredentialExpiring,
    CredentialExpired,
    CertificateExpiring,
    CertificateExpired,
    ScheduledTaskTriggered,
    NotificationSent,
    CommandExecuted,
    NetworkChanged,
    PortScanCompleted,
}

impl std::fmt::Display for HookEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = serde_json::to_string(self).unwrap_or_else(|_| format!("{:?}", self));
        // Strip surrounding quotes produced by serde
        let trimmed = s.trim_matches('"');
        write!(f, "{}", trimmed)
    }
}

// ─── Event Data ─────────────────────────────────────────────────────

/// Payload carried by every dispatched event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookEventData {
    pub event_id: String,
    pub event_type: HookEvent,
    pub timestamp: DateTime<Utc>,
    pub source: String,
    pub connection_id: Option<String>,
    pub session_id: Option<String>,
    pub payload: serde_json::Value,
    pub metadata: HashMap<String, String>,
}

impl HookEventData {
    /// Create a new event with a random UUID and the current timestamp.
    pub fn new(event_type: HookEvent, source: impl Into<String>) -> Self {
        Self {
            event_id: uuid::Uuid::new_v4().to_string(),
            event_type,
            timestamp: Utc::now(),
            source: source.into(),
            connection_id: None,
            session_id: None,
            payload: serde_json::Value::Null,
            metadata: HashMap::new(),
        }
    }

    pub fn with_connection(mut self, id: impl Into<String>) -> Self {
        self.connection_id = Some(id.into());
        self
    }

    pub fn with_session(mut self, id: impl Into<String>) -> Self {
        self.session_id = Some(id.into());
        self
    }

    pub fn with_payload(mut self, payload: serde_json::Value) -> Self {
        self.payload = payload;
        self
    }

    pub fn with_metadata(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.metadata.insert(key.into(), value.into());
        self
    }
}

// ─── Subscription ───────────────────────────────────────────────────

/// A registered interest in one or more event types.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookSubscription {
    pub id: String,
    pub name: String,
    pub description: String,
    pub event_types: Vec<HookEvent>,
    pub priority: i32,
    pub enabled: bool,
    pub filter: Option<HookFilter>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── Filters ────────────────────────────────────────────────────────

/// Optional filter criteria applied before a subscriber receives an event.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HookFilter {
    pub connection_ids: Option<Vec<String>>,
    pub protocols: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub hostname_pattern: Option<String>,
    pub metadata_match: Option<HashMap<String, String>>,
}

// ─── Pipeline ───────────────────────────────────────────────────────

/// An ordered sequence of steps to execute when an event is dispatched.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookPipeline {
    pub id: String,
    pub name: String,
    pub steps: Vec<PipelineStep>,
    pub enabled: bool,
    pub timeout_ms: u64,
}

/// A single step inside a pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStep {
    pub step_id: String,
    pub action: PipelineAction,
    pub condition: Option<String>,
    pub timeout_ms: u64,
}

/// The action performed by a pipeline step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineAction {
    ExecuteScript(String),
    SendNotification(NotificationTarget),
    LogEvent,
    TransformPayload(String),
    Delay(u64),
    HttpWebhook(WebhookConfig),
    Chain(String),
}

/// Configuration for an HTTP webhook action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookConfig {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body_template: Option<String>,
    pub timeout_ms: u64,
    pub retry_count: u32,
}

/// Where to send a notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationTarget {
    InApp,
    Desktop,
    Webhook(String),
    Email(String),
    Slack(String),
    Discord(String),
    Teams(String),
    Telegram(String),
    Custom(String),
}

// ─── Execution Results ──────────────────────────────────────────────

/// Result of dispatching an event to a single subscriber.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookExecutionResult {
    pub subscription_id: String,
    pub event_id: String,
    pub success: bool,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub output: Option<serde_json::Value>,
}

// ─── Stats ──────────────────────────────────────────────────────────

/// Aggregate statistics for the hook engine.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HookStats {
    pub total_events_dispatched: u64,
    pub total_subscriptions: u64,
    pub events_per_type: HashMap<String, u64>,
    pub avg_dispatch_time_ms: f64,
    pub last_event_at: Option<DateTime<Utc>>,
}

// ─── Configuration ──────────────────────────────────────────────────

/// Runtime configuration for the hook engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HooksConfig {
    pub enabled: bool,
    pub max_concurrent_dispatches: usize,
    pub default_timeout_ms: u64,
    pub event_buffer_size: usize,
    pub persist_events: bool,
    pub event_retention_hours: u64,
}

impl Default for HooksConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_concurrent_dispatches: 64,
            default_timeout_ms: 5000,
            event_buffer_size: 1000,
            persist_events: false,
            event_retention_hours: 24,
        }
    }
}
