//! Data types, enums, and configuration structs for the scheduler.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Weekday ────────────────────────────────────────────────────────

/// Days of the week for schedule definitions.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Weekday {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
    Sun,
}

impl Weekday {
    /// Convert to `chrono::Weekday`.
    pub fn to_chrono(&self) -> chrono::Weekday {
        match self {
            Self::Mon => chrono::Weekday::Mon,
            Self::Tue => chrono::Weekday::Tue,
            Self::Wed => chrono::Weekday::Wed,
            Self::Thu => chrono::Weekday::Thu,
            Self::Fri => chrono::Weekday::Fri,
            Self::Sat => chrono::Weekday::Sat,
            Self::Sun => chrono::Weekday::Sun,
        }
    }

    /// Convert from `chrono::Weekday`.
    pub fn from_chrono(w: chrono::Weekday) -> Self {
        match w {
            chrono::Weekday::Mon => Self::Mon,
            chrono::Weekday::Tue => Self::Tue,
            chrono::Weekday::Wed => Self::Wed,
            chrono::Weekday::Thu => Self::Thu,
            chrono::Weekday::Fri => Self::Fri,
            chrono::Weekday::Sat => Self::Sat,
            chrono::Weekday::Sun => Self::Sun,
        }
    }

    /// Numeric representation (0 = Sun, 1 = Mon, … 6 = Sat), matching cron convention.
    pub fn cron_number(&self) -> u32 {
        match self {
            Self::Sun => 0,
            Self::Mon => 1,
            Self::Tue => 2,
            Self::Wed => 3,
            Self::Thu => 4,
            Self::Fri => 5,
            Self::Sat => 6,
        }
    }
}

// ─── TaskSchedule ───────────────────────────────────────────────────

/// How / when a task should run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TaskSchedule {
    /// Run exactly once at the given instant.
    Once { at: DateTime<Utc> },
    /// Classic five-field cron expression (minute hour dom month dow).
    Cron { expression: String },
    /// Run every N seconds.
    Interval { every_seconds: u64 },
    /// Daily at a fixed wall-clock time (HH:MM), optionally in a given timezone.
    Daily {
        time: String,
        timezone: Option<String>,
    },
    /// Weekly on a specific weekday at HH:MM (UTC).
    Weekly { day: Weekday, time: String },
    /// Monthly on a numbered day (1–31) at HH:MM (UTC).
    Monthly { day: u8, time: String },
    /// Trigger when an external event of the given type fires.
    OnEvent { event_type: String },
}

// ─── ReportType ─────────────────────────────────────────────────────

/// Predefined report categories.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ReportType {
    ConnectionHealth,
    CredentialAudit,
    ActivitySummary,
    PerformanceReport,
}

// ─── PipelineStep ───────────────────────────────────────────────────

/// A single step inside a multi-action pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStep {
    /// The action to execute in this step.
    pub action: TaskAction,
    /// If `true` the pipeline continues even when this step fails.
    pub continue_on_error: bool,
    /// Optional delay (ms) before executing this step.
    pub delay_ms: Option<u64>,
}

// ─── TaskAction ─────────────────────────────────────────────────────

/// What the scheduler should do when a task fires.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TaskAction {
    ConnectConnection {
        connection_id: String,
    },
    DisconnectConnection {
        connection_id: String,
    },
    ExecuteScript {
        script_id: String,
        args: Option<HashMap<String, String>>,
    },
    RunDiagnostics {
        connection_ids: Vec<String>,
    },
    SendWakeOnLan {
        mac_address: String,
        port: Option<u16>,
    },
    BackupCollection {
        collection_id: Option<String>,
    },
    SyncCloud,
    RunHealthCheck {
        connection_ids: Vec<String>,
    },
    HttpRequest {
        url: String,
        method: String,
        headers: Option<HashMap<String, String>>,
        body: Option<String>,
    },
    ExecuteCommand {
        command: String,
        connection_id: Option<String>,
    },
    GenerateReport {
        report_type: ReportType,
    },
    Pipeline {
        steps: Vec<PipelineStep>,
    },
    Notify {
        channel: String,
        message: String,
    },
}

// ─── TaskCondition ──────────────────────────────────────────────────

/// Pre-conditions that must be satisfied before the task action runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TaskCondition {
    ConnectionOnline { connection_id: String },
    ConnectionOffline { connection_id: String },
    TimeWindow { start: String, end: String },
    DayOfWeek { days: Vec<Weekday> },
    Custom { expression: String },
}

// ─── RetryPolicy ────────────────────────────────────────────────────

/// Retry behaviour when a task execution fails.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicy {
    /// Maximum number of retry attempts.
    pub max_retries: u32,
    /// Initial delay between retries, in milliseconds.
    pub retry_delay_ms: u64,
    /// Multiplier applied to the delay after each retry.
    pub backoff_multiplier: f64,
    /// Upper bound for the computed delay (ms).
    pub max_delay_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            retry_delay_ms: 1000,
            backoff_multiplier: 2.0,
            max_delay_ms: 60_000,
        }
    }
}

// ─── TaskPriority ───────────────────────────────────────────────────

/// Priority levels used for ordering concurrent tasks.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum TaskPriority {
    Low,
    #[default]
    Normal,
    High,
    Critical,
}

impl TaskPriority {
    /// Numeric weight — higher is more urgent.
    pub fn weight(&self) -> u8 {
        match self {
            Self::Low => 0,
            Self::Normal => 1,
            Self::High => 2,
            Self::Critical => 3,
        }
    }
}

// ─── ScheduledTask ──────────────────────────────────────────────────

/// A complete task definition stored in the scheduler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub schedule: TaskSchedule,
    pub action: TaskAction,
    pub conditions: Vec<TaskCondition>,
    pub retry_policy: Option<RetryPolicy>,
    pub timeout_ms: Option<u64>,
    pub tags: Vec<String>,
    pub priority: TaskPriority,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub next_run_at: Option<DateTime<Utc>>,
    pub run_count: u64,
    pub fail_count: u64,
}

impl ScheduledTask {
    /// Create a new task with sensible defaults.
    pub fn new(name: impl Into<String>, schedule: TaskSchedule, action: TaskAction) -> Self {
        let now = Utc::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            description: String::new(),
            enabled: true,
            schedule,
            action,
            conditions: Vec::new(),
            retry_policy: None,
            timeout_ms: None,
            tags: Vec::new(),
            priority: TaskPriority::default(),
            created_at: now,
            updated_at: now,
            last_run_at: None,
            next_run_at: None,
            run_count: 0,
            fail_count: 0,
        }
    }
}

// ─── ExecutionStatus ────────────────────────────────────────────────

/// Outcome of a single execution attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionStatus {
    Running,
    Completed,
    Failed,
    TimedOut,
    Skipped,
    Cancelled,
}

// ─── TaskExecutionRecord ────────────────────────────────────────────

/// A log entry for one execution attempt of a task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskExecutionRecord {
    pub id: String,
    pub task_id: String,
    pub task_name: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_ms: Option<u64>,
    pub status: ExecutionStatus,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub retry_attempt: u32,
}

impl TaskExecutionRecord {
    /// Begin a new record (status = Running).
    pub fn begin(task: &ScheduledTask, retry_attempt: u32) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: task.id.clone(),
            task_name: task.name.clone(),
            started_at: Utc::now(),
            completed_at: None,
            duration_ms: None,
            status: ExecutionStatus::Running,
            result: None,
            error: None,
            retry_attempt,
        }
    }

    /// Mark the record as completed successfully.
    pub fn complete(&mut self, result: Option<serde_json::Value>) {
        let now = Utc::now();
        self.completed_at = Some(now);
        self.duration_ms = Some((now - self.started_at).num_milliseconds().max(0) as u64);
        self.status = ExecutionStatus::Completed;
        self.result = result;
    }

    /// Mark the record as failed.
    pub fn fail(&mut self, error: impl Into<String>) {
        let now = Utc::now();
        self.completed_at = Some(now);
        self.duration_ms = Some((now - self.started_at).num_milliseconds().max(0) as u64);
        self.status = ExecutionStatus::Failed;
        self.error = Some(error.into());
    }

    /// Mark the record as timed out.
    pub fn timeout(&mut self) {
        let now = Utc::now();
        self.completed_at = Some(now);
        self.duration_ms = Some((now - self.started_at).num_milliseconds().max(0) as u64);
        self.status = ExecutionStatus::TimedOut;
        self.error = Some("task timed out".to_string());
    }
}

// ─── SchedulerConfig ────────────────────────────────────────────────

/// Global settings for the scheduler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerConfig {
    /// Master switch for the entire scheduler.
    pub enabled: bool,
    /// Maximum tasks that may execute concurrently.
    pub max_concurrent_tasks: usize,
    /// Default timeout applied when a task has no explicit timeout.
    pub default_timeout_ms: u64,
    /// How many days of history to keep before cleanup.
    pub history_retention_days: u64,
    /// How often the scheduler checks for due tasks (seconds).
    pub check_interval_seconds: u64,
    /// If `true`, tasks that were missed (e.g. app was closed) will be
    /// executed immediately on the next tick.
    pub catch_up_missed: bool,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_concurrent_tasks: 5,
            default_timeout_ms: 300_000, // 5 min
            history_retention_days: 30,
            check_interval_seconds: 30,
            catch_up_missed: true,
        }
    }
}

// ─── SchedulerStats ─────────────────────────────────────────────────

/// Aggregate statistics about the scheduler's activity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerStats {
    pub total_tasks: usize,
    pub enabled_tasks: usize,
    pub total_executions: usize,
    pub successful: usize,
    pub failed: usize,
    pub avg_duration_ms: f64,
    pub next_scheduled_at: Option<DateTime<Utc>>,
    pub tasks_by_priority: HashMap<String, usize>,
}
