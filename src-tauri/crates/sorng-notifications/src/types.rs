//! # Notification Types
//!
//! Core data types used across all notification modules. Defines rules, triggers,
//! conditions, channel configurations, throttle/escalation policies, templates,
//! notification records, and aggregate statistics.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Notification Rule ───────────────────────────────────────────────

/// A notification rule defines when and how to send notifications.
///
/// Rules bind triggers (event types) to channels (delivery targets) with
/// optional conditions, throttling, escalation, and template overrides.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationRule {
    /// Unique rule identifier (UUID v4).
    pub id: String,
    /// Human-readable rule name.
    pub name: String,
    /// Optional description explaining the rule's purpose.
    pub description: Option<String>,
    /// Whether the rule is active. Disabled rules are skipped during evaluation.
    pub enabled: bool,
    /// The event triggers that activate this rule.
    pub triggers: Vec<NotificationTrigger>,
    /// Conditions that must all be satisfied for the rule to fire.
    pub conditions: Vec<RuleCondition>,
    /// Channels to deliver the notification through.
    pub channels: Vec<ChannelConfig>,
    /// Optional throttle policy to limit notification frequency.
    pub throttle: Option<ThrottleConfig>,
    /// Optional escalation chain for unacknowledged alerts.
    pub escalation: Option<EscalationConfig>,
    /// Optional template ID override; when `None` a default template is used.
    pub template_id: Option<String>,
    /// Notification priority level.
    pub priority: NotificationPriority,
    /// When the rule was created.
    pub created_at: DateTime<Utc>,
    /// When the rule was last updated.
    pub updated_at: DateTime<Utc>,
}

// ── Triggers ────────────────────────────────────────────────────────

/// The event types that can trigger a notification rule.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "type", content = "value")]
pub enum NotificationTrigger {
    /// A connection changed state (connected, disconnected, error).
    ConnectionStateChange,
    /// A health-check probe returned a result.
    HealthCheckResult,
    /// A TLS/SSH certificate is about to expire.
    CertificateExpiry,
    /// A stored credential is about to expire or has been revoked.
    CredentialExpiry,
    /// A backup job completed (success or failure).
    BackupResult,
    /// A synchronisation job completed.
    SyncResult,
    /// A user script finished executing.
    ScriptResult,
    /// A session lifecycle event (started, ended, idle-timeout).
    SessionEvent,
    /// A file transfer completed.
    FileTransferResult,
    /// A scheduled task finished.
    ScheduledTaskResult,
    /// An arbitrary custom hook event with a user-defined tag.
    CustomHookEvent(String),
}

// ── Conditions ──────────────────────────────────────────────────────

/// A single condition that is evaluated against event data.
///
/// All conditions on a rule are combined with logical AND — every condition
/// must pass for the rule to fire.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleCondition {
    /// Dot-separated path into the event JSON (e.g. `"host.status"`).
    pub field: String,
    /// The comparison operator.
    pub operator: ConditionOperator,
    /// The value to compare against.
    pub value: serde_json::Value,
}

/// Comparison operators for rule conditions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConditionOperator {
    /// Field value equals the condition value.
    Equals,
    /// Field value does not equal the condition value.
    NotEquals,
    /// Field value (string) contains the condition substring.
    Contains,
    /// Field value (string) does not contain the condition substring.
    NotContains,
    /// Field value is numerically greater than the condition value.
    GreaterThan,
    /// Field value is numerically less than the condition value.
    LessThan,
    /// Field value matches a regex pattern.
    Matches,
    /// Field value is contained in the condition array.
    In,
    /// Field value is not contained in the condition array.
    NotIn,
    /// The field exists (is not null/missing) in the event data.
    Exists,
    /// The field is null, missing, or an empty string/array.
    IsEmpty,
}

// ── Channel Configurations ──────────────────────────────────────────

/// Configuration for a single delivery channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "channel_type")]
pub enum ChannelConfig {
    /// In-app notification displayed in the SortOfRemote NG UI.
    InApp {
        title: String,
        body: String,
        icon: Option<String>,
        actions: Option<Vec<String>>,
    },
    /// Operating-system desktop notification.
    Desktop {
        title: String,
        body: String,
        sound: Option<bool>,
        urgent: Option<bool>,
    },
    /// Generic HTTP webhook.
    Webhook {
        url: String,
        method: Option<String>,
        headers: Option<HashMap<String, String>>,
        body_template: Option<String>,
        timeout_ms: Option<u64>,
        retry_count: Option<u32>,
        secret: Option<String>,
    },
    /// Email notification (delivery delegated to an SMTP relay).
    Email {
        to: Vec<String>,
        cc: Option<Vec<String>>,
        bcc: Option<Vec<String>>,
        subject_template: Option<String>,
        body_template: Option<String>,
        html: Option<bool>,
    },
    /// Slack incoming-webhook notification.
    Slack {
        webhook_url: String,
        channel: Option<String>,
        username: Option<String>,
        icon_emoji: Option<String>,
        blocks_template: Option<String>,
    },
    /// Discord webhook notification.
    Discord {
        webhook_url: String,
        username: Option<String>,
        avatar_url: Option<String>,
        embeds_template: Option<String>,
    },
    /// Microsoft Teams incoming-webhook notification.
    Teams {
        webhook_url: String,
        card_template: Option<String>,
    },
    /// Telegram Bot API notification.
    Telegram {
        bot_token: String,
        chat_id: String,
        parse_mode: Option<String>,
        template: Option<String>,
    },
    /// PagerDuty Events API v2 notification.
    PagerDuty {
        routing_key: String,
        severity: Option<String>,
        source: Option<String>,
    },
    /// A generic channel backed by an external adapter.
    Generic {
        adapter_id: String,
        config: serde_json::Value,
    },
}

impl ChannelConfig {
    /// Return a short label describing the channel type.
    pub fn channel_label(&self) -> &'static str {
        match self {
            Self::InApp { .. } => "in_app",
            Self::Desktop { .. } => "desktop",
            Self::Webhook { .. } => "webhook",
            Self::Email { .. } => "email",
            Self::Slack { .. } => "slack",
            Self::Discord { .. } => "discord",
            Self::Teams { .. } => "teams",
            Self::Telegram { .. } => "telegram",
            Self::PagerDuty { .. } => "pagerduty",
            Self::Generic { .. } => "generic",
        }
    }
}

// ── Throttle ────────────────────────────────────────────────────────

/// Rate-limiting configuration for a notification rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThrottleConfig {
    /// Maximum number of notifications allowed within the window.
    pub max_per_window: u32,
    /// Window duration in seconds.
    pub window_seconds: u64,
    /// Optional fields used to create separate throttle buckets.
    pub group_by: Option<Vec<String>>,
    /// When `true`, identical title+body pairs are suppressed within the window.
    pub suppress_duplicates: bool,
}

// ── Escalation ──────────────────────────────────────────────────────

/// Escalation chain configuration — alerts are promoted to increasingly
/// urgent channels if not acknowledged within the specified delays.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscalationConfig {
    /// Ordered escalation levels (executed sequentially).
    pub levels: Vec<EscalationLevel>,
}

/// A single level in an escalation chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscalationLevel {
    /// Minutes to wait before activating this escalation level.
    pub delay_minutes: u64,
    /// Channels to deliver through at this escalation level.
    pub channels: Vec<ChannelConfig>,
    /// Optional condition expression; if set, escalation only fires when true.
    pub condition: Option<String>,
}

// ── Priority ────────────────────────────────────────────────────────

/// Notification priority level.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum NotificationPriority {
    Low,
    Normal,
    High,
    Critical,
}

impl std::fmt::Display for NotificationPriority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Low => write!(f, "low"),
            Self::Normal => write!(f, "normal"),
            Self::High => write!(f, "high"),
            Self::Critical => write!(f, "critical"),
        }
    }
}

// ── Notification Record ─────────────────────────────────────────────

/// A persisted record of a sent (or attempted) notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationRecord {
    /// Unique record identifier (UUID v4).
    pub id: String,
    /// The rule that produced this notification.
    pub rule_id: String,
    /// Snapshot of the rule name at send time.
    pub rule_name: String,
    /// Channel label through which delivery was attempted.
    pub channel: String,
    /// Priority at send time.
    pub priority: NotificationPriority,
    /// Rendered notification title.
    pub title: String,
    /// Rendered notification body.
    pub body: String,
    /// When delivery was attempted.
    pub sent_at: DateTime<Utc>,
    /// Whether delivery succeeded.
    pub delivered: bool,
    /// Error message on failure.
    pub error: Option<String>,
    /// Snapshot of the triggering event data.
    pub event_data: Option<serde_json::Value>,
}

// ── Statistics ───────────────────────────────────────────────────────

/// Aggregate statistics over the notification history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationStats {
    pub total_sent: usize,
    pub total_delivered: usize,
    pub total_failed: usize,
    pub by_channel: HashMap<String, usize>,
    pub by_priority: HashMap<String, usize>,
    pub by_rule: HashMap<String, usize>,
}

// ── Global Configuration ────────────────────────────────────────────

/// Top-level configuration for the notification subsystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationsConfig {
    /// Master switch — when `false`, no notifications are processed.
    pub enabled: bool,
    /// Global throttle applied across all rules.
    pub global_throttle: Option<ThrottleConfig>,
    /// Default channels used when a rule does not specify its own.
    pub default_channels: Vec<ChannelConfig>,
    /// Quiet-hours configuration.
    pub quiet_hours: Option<QuietHoursConfig>,
    /// Maximum number of history records to retain (FIFO eviction).
    pub max_history_size: usize,
}

impl Default for NotificationsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            global_throttle: None,
            default_channels: Vec::new(),
            quiet_hours: None,
            max_history_size: 10_000,
        }
    }
}

/// Quiet-hours policy — suppress non-critical notifications during a
/// daily time window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuietHoursConfig {
    /// Whether quiet hours are active.
    pub enabled: bool,
    /// Start time in `"HH:MM"` 24-hour format.
    pub start_time: String,
    /// End time in `"HH:MM"` 24-hour format.
    pub end_time: String,
    /// IANA timezone name (e.g. `"America/New_York"`).
    pub timezone: String,
    /// When `true`, critical-priority notifications bypass quiet hours.
    pub override_for_critical: bool,
}

// ── Templates ───────────────────────────────────────────────────────

/// A notification template with `{{variable}}` placeholders.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationTemplate {
    /// Unique template identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Title template string.
    pub title_template: String,
    /// Body template string.
    pub body_template: String,
    /// List of variable names expected by this template.
    pub variables: Vec<String>,
    /// Output format.
    pub format: TemplateFormat,
}

/// Template output format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TemplateFormat {
    PlainText,
    Markdown,
    Html,
    Json,
}
