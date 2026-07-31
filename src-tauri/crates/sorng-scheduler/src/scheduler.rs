//! Core scheduler: task storage, due-task detection, tick loop,
//! history management, and statistics.

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, Utc};
use log::info;
use std::collections::HashMap;

use crate::cron;
use crate::error::SchedulerError;
use crate::executor::TaskExecutor;
use crate::types::*;

pub const MAX_SCHEDULED_TASKS: usize = 2_048;
pub const MAX_HISTORY_RECORDS: usize = 10_000;
pub const MAX_HISTORY_QUERY: usize = 1_000;
pub const MAX_UPCOMING_QUERY: usize = 512;
pub const MAX_EXECUTION_BATCH: usize = 64;
pub const MAX_HISTORY_RETENTION_DAYS: u64 = 3_650;
pub const MAX_CHECK_INTERVAL_SECONDS: u64 = 3_600;
pub const MAX_TASK_TIMEOUT_MS: u64 = 86_400_000;
pub const MAX_TASK_PAYLOAD_BYTES: usize = 2 * 1_048_576;
pub const MAX_SCHEDULER_PAYLOAD_BYTES: usize = 64 * 1_048_576;

const MAX_TASK_ID_BYTES: usize = 128;
const MAX_TASK_NAME_BYTES: usize = 256;
const MAX_DESCRIPTION_BYTES: usize = 16_384;
const MAX_TAGS: usize = 64;
const MAX_TAG_BYTES: usize = 128;
const MAX_CONDITIONS: usize = 32;
const MAX_CONNECTION_IDS: usize = 512;
const MAX_MAP_ENTRIES: usize = 128;
const MAX_MAP_KEY_BYTES: usize = 256;
const MAX_MAP_VALUE_BYTES: usize = 16_384;
const MAX_PIPELINE_DEPTH: usize = 8;
const MAX_PIPELINE_STEPS: usize = 256;
const MAX_PIPELINE_DELAY_MS: u64 = 86_400_000;
const MAX_INTERVAL_SECONDS: u64 = 31_536_000;
const MAX_COMMAND_BYTES: usize = 32_768;
const MAX_HTTP_BODY_BYTES: usize = 1_048_576;
const MAX_MESSAGE_BYTES: usize = 65_536;
const MAX_RETRIES: u32 = 10;

fn invalid(message: impl Into<String>) -> SchedulerError {
    SchedulerError::InvalidInput(message.into())
}

fn add_payload(total: &mut usize, bytes: usize) -> Result<(), SchedulerError> {
    *total = total
        .checked_add(bytes)
        .ok_or_else(|| invalid("aggregate task payload size overflow"))?;
    if *total > MAX_TASK_PAYLOAD_BYTES {
        return Err(invalid(format!(
            "aggregate task payload exceeds {MAX_TASK_PAYLOAD_BYTES} bytes"
        )));
    }
    Ok(())
}

fn validate_required_text(
    label: &str,
    value: &str,
    max_bytes: usize,
) -> Result<(), SchedulerError> {
    if value.trim().is_empty() {
        return Err(invalid(format!("{label} must not be empty")));
    }
    if value.len() > max_bytes {
        return Err(invalid(format!("{label} exceeds {max_bytes} bytes")));
    }
    Ok(())
}

fn validate_optional_text(
    label: &str,
    value: &str,
    max_bytes: usize,
) -> Result<(), SchedulerError> {
    if value.len() > max_bytes {
        return Err(invalid(format!("{label} exceeds {max_bytes} bytes")));
    }
    Ok(())
}

fn validate_identifier(label: &str, value: &str) -> Result<(), SchedulerError> {
    validate_required_text(label, value, MAX_TASK_ID_BYTES)
}

fn validate_identifier_list(label: &str, values: &[String]) -> Result<(), SchedulerError> {
    if values.is_empty() {
        return Err(invalid(format!("{label} must not be empty")));
    }
    if values.len() > MAX_CONNECTION_IDS {
        return Err(invalid(format!(
            "{label} exceeds {MAX_CONNECTION_IDS} entries"
        )));
    }
    for value in values {
        validate_identifier(label, value)?;
    }
    Ok(())
}

fn validate_map(label: &str, values: &HashMap<String, String>) -> Result<(), SchedulerError> {
    if values.len() > MAX_MAP_ENTRIES {
        return Err(invalid(format!(
            "{label} exceeds {MAX_MAP_ENTRIES} entries"
        )));
    }
    for (key, value) in values {
        validate_required_text(&format!("{label} key"), key, MAX_MAP_KEY_BYTES)?;
        validate_optional_text(&format!("{label} value"), value, MAX_MAP_VALUE_BYTES)?;
    }
    Ok(())
}

fn validate_utc_time(label: &str, value: &str) -> Result<(), SchedulerError> {
    let bytes = value.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b':'
        || !bytes[0].is_ascii_digit()
        || !bytes[1].is_ascii_digit()
        || !bytes[3].is_ascii_digit()
        || !bytes[4].is_ascii_digit()
    {
        return Err(invalid(format!("{label} must use HH:MM")));
    }
    let hour = (bytes[0] - b'0') as u32 * 10 + (bytes[1] - b'0') as u32;
    let minute = (bytes[3] - b'0') as u32 * 10 + (bytes[4] - b'0') as u32;
    if NaiveTime::from_hms_opt(hour, minute, 0).is_none() {
        return Err(invalid(format!("{label} is outside a valid UTC day")));
    }
    Ok(())
}

fn validate_schedule(schedule: &TaskSchedule) -> Result<(), SchedulerError> {
    match schedule {
        TaskSchedule::Once { .. } => Ok(()),
        TaskSchedule::Cron { expression } => cron::validate(expression),
        TaskSchedule::Interval { every_seconds } => {
            if !(1..=MAX_INTERVAL_SECONDS).contains(every_seconds) {
                return Err(invalid(format!(
                    "interval must be between 1 and {MAX_INTERVAL_SECONDS} seconds"
                )));
            }
            Ok(())
        }
        TaskSchedule::Daily { time, timezone } => {
            validate_utc_time("daily time", time)?;
            if let Some(timezone) = timezone {
                if !matches!(timezone.as_str(), "UTC" | "Etc/UTC" | "Z") {
                    return Err(invalid(
                        "daily timezone is unsupported; use UTC until timezone scheduling is implemented",
                    ));
                }
            }
            Ok(())
        }
        TaskSchedule::Weekly { time, .. } => validate_utc_time("weekly time", time),
        TaskSchedule::Monthly { day, time } => {
            if !(1..=31).contains(day) {
                return Err(invalid("monthly day must be between 1 and 31"));
            }
            validate_utc_time("monthly time", time)
        }
        TaskSchedule::OnEvent { event_type } => {
            validate_required_text("event type", event_type, 128)
        }
    }
}

fn validate_condition(condition: &TaskCondition) -> Result<(), SchedulerError> {
    match condition {
        TaskCondition::ConnectionOnline { connection_id }
        | TaskCondition::ConnectionOffline { connection_id } => {
            validate_identifier("condition connection id", connection_id)
        }
        TaskCondition::TimeWindow { start, end } => {
            validate_utc_time("time window start", start)?;
            validate_utc_time("time window end", end)?;
            if start == end {
                return Err(invalid("time window start and end must differ"));
            }
            Ok(())
        }
        TaskCondition::DayOfWeek { days } => {
            if days.is_empty() || days.len() > 7 {
                return Err(invalid("day-of-week condition must contain 1 to 7 days"));
            }
            Ok(())
        }
        TaskCondition::Custom { expression } => {
            validate_required_text("custom condition", expression, 2_048)
        }
    }
}

fn validate_action(
    action: &TaskAction,
    depth: usize,
    total_steps: &mut usize,
    total_payload: &mut usize,
) -> Result<(), SchedulerError> {
    if depth > MAX_PIPELINE_DEPTH {
        return Err(invalid(format!(
            "pipeline nesting exceeds {MAX_PIPELINE_DEPTH} levels"
        )));
    }

    match action {
        TaskAction::ConnectConnection { connection_id }
        | TaskAction::DisconnectConnection { connection_id } => {
            add_payload(total_payload, connection_id.len())?;
            validate_identifier("connection id", connection_id)
        }
        TaskAction::ExecuteScript { script_id, args } => {
            add_payload(total_payload, script_id.len())?;
            validate_identifier("script id", script_id)?;
            if let Some(args) = args {
                validate_map("script arguments", args)?;
                for (key, value) in args {
                    add_payload(total_payload, key.len())?;
                    add_payload(total_payload, value.len())?;
                }
            }
            Ok(())
        }
        TaskAction::RunDiagnostics { connection_ids }
        | TaskAction::RunHealthCheck { connection_ids } => {
            for connection_id in connection_ids {
                add_payload(total_payload, connection_id.len())?;
            }
            validate_identifier_list("connection ids", connection_ids)
        }
        TaskAction::SendWakeOnLan { mac_address, port } => {
            add_payload(total_payload, mac_address.len())?;
            validate_required_text("MAC address", mac_address, 32)?;
            if matches!(port, Some(0)) {
                return Err(invalid("Wake-on-LAN port must not be zero"));
            }
            Ok(())
        }
        TaskAction::BackupCollection { collection_id } => {
            if let Some(collection_id) = collection_id {
                add_payload(total_payload, collection_id.len())?;
                validate_identifier("collection id", collection_id)?;
            }
            Ok(())
        }
        TaskAction::SyncCloud | TaskAction::GenerateReport { .. } => Ok(()),
        TaskAction::HttpRequest {
            url,
            method,
            headers,
            body,
        } => {
            add_payload(total_payload, url.len())?;
            add_payload(total_payload, method.len())?;
            validate_required_text("HTTP URL", url, 4_096)?;
            validate_required_text("HTTP method", method, 16)?;
            if let Some(headers) = headers {
                validate_map("HTTP headers", headers)?;
                for (key, value) in headers {
                    add_payload(total_payload, key.len())?;
                    add_payload(total_payload, value.len())?;
                }
            }
            if let Some(body) = body {
                validate_optional_text("HTTP body", body, MAX_HTTP_BODY_BYTES)?;
                add_payload(total_payload, body.len())?;
            }
            Ok(())
        }
        TaskAction::ExecuteCommand {
            command,
            connection_id,
        } => {
            add_payload(total_payload, command.len())?;
            validate_required_text("command", command, MAX_COMMAND_BYTES)?;
            if let Some(connection_id) = connection_id {
                add_payload(total_payload, connection_id.len())?;
                validate_identifier("connection id", connection_id)?;
            }
            Ok(())
        }
        TaskAction::Pipeline { steps } => {
            if steps.is_empty() {
                return Err(invalid("pipeline must contain at least one step"));
            }
            *total_steps = total_steps
                .checked_add(steps.len())
                .ok_or_else(|| invalid("pipeline step count overflow"))?;
            if *total_steps > MAX_PIPELINE_STEPS {
                return Err(invalid(format!(
                    "pipeline exceeds {MAX_PIPELINE_STEPS} total steps"
                )));
            }
            for step in steps {
                if step.delay_ms.unwrap_or(0) > MAX_PIPELINE_DELAY_MS {
                    return Err(invalid(format!(
                        "pipeline delay exceeds {MAX_PIPELINE_DELAY_MS} ms"
                    )));
                }
                validate_action(&step.action, depth + 1, total_steps, total_payload)?;
            }
            Ok(())
        }
        TaskAction::Notify { channel, message } => {
            add_payload(total_payload, channel.len())?;
            add_payload(total_payload, message.len())?;
            validate_required_text("notification channel", channel, 128)?;
            validate_optional_text("notification message", message, MAX_MESSAGE_BYTES)
        }
    }
}

pub fn validate_scheduler_config(config: &SchedulerConfig) -> Result<(), SchedulerError> {
    if !(1..=MAX_EXECUTION_BATCH).contains(&config.max_concurrent_tasks) {
        return Err(invalid(format!(
            "max_concurrent_tasks must be between 1 and {MAX_EXECUTION_BATCH}"
        )));
    }
    if !(1..=MAX_TASK_TIMEOUT_MS).contains(&config.default_timeout_ms) {
        return Err(invalid(format!(
            "default timeout must be between 1 and {MAX_TASK_TIMEOUT_MS} ms"
        )));
    }
    if !(1..=MAX_HISTORY_RETENTION_DAYS).contains(&config.history_retention_days) {
        return Err(invalid(format!(
            "history retention must be between 1 and {MAX_HISTORY_RETENTION_DAYS} days"
        )));
    }
    if !(1..=MAX_CHECK_INTERVAL_SECONDS).contains(&config.check_interval_seconds) {
        return Err(invalid(format!(
            "check interval must be between 1 and {MAX_CHECK_INTERVAL_SECONDS} seconds"
        )));
    }
    Ok(())
}

fn sanitize_scheduler_config(mut config: SchedulerConfig) -> SchedulerConfig {
    config.max_concurrent_tasks = config.max_concurrent_tasks.clamp(1, MAX_EXECUTION_BATCH);
    config.default_timeout_ms = config.default_timeout_ms.clamp(1, MAX_TASK_TIMEOUT_MS);
    config.history_retention_days = config
        .history_retention_days
        .clamp(1, MAX_HISTORY_RETENTION_DAYS);
    config.check_interval_seconds = config
        .check_interval_seconds
        .clamp(1, MAX_CHECK_INTERVAL_SECONDS);
    config
}

pub(crate) fn validate_task(task: &ScheduledTask) -> Result<usize, SchedulerError> {
    let mut total_payload = 0usize;
    add_payload(&mut total_payload, task.id.len())?;
    add_payload(&mut total_payload, task.name.len())?;
    add_payload(&mut total_payload, task.description.len())?;
    validate_identifier("task id", &task.id)?;
    validate_required_text("task name", &task.name, MAX_TASK_NAME_BYTES)?;
    validate_optional_text("task description", &task.description, MAX_DESCRIPTION_BYTES)?;
    validate_schedule(&task.schedule)?;
    match &task.schedule {
        TaskSchedule::Cron { expression } => add_payload(&mut total_payload, expression.len())?,
        TaskSchedule::Daily { time, timezone } => {
            add_payload(&mut total_payload, time.len())?;
            if let Some(timezone) = timezone {
                add_payload(&mut total_payload, timezone.len())?;
            }
        }
        TaskSchedule::Weekly { time, .. } | TaskSchedule::Monthly { time, .. } => {
            add_payload(&mut total_payload, time.len())?
        }
        TaskSchedule::OnEvent { event_type } => add_payload(&mut total_payload, event_type.len())?,
        TaskSchedule::Once { .. } | TaskSchedule::Interval { .. } => {}
    }

    if task.conditions.len() > MAX_CONDITIONS {
        return Err(invalid(format!("task exceeds {MAX_CONDITIONS} conditions")));
    }
    for condition in &task.conditions {
        validate_condition(condition)?;
        match condition {
            TaskCondition::ConnectionOnline { connection_id }
            | TaskCondition::ConnectionOffline { connection_id } => {
                add_payload(&mut total_payload, connection_id.len())?
            }
            TaskCondition::TimeWindow { start, end } => {
                add_payload(&mut total_payload, start.len())?;
                add_payload(&mut total_payload, end.len())?;
            }
            TaskCondition::Custom { expression } => {
                add_payload(&mut total_payload, expression.len())?
            }
            TaskCondition::DayOfWeek { .. } => {}
        }
    }

    let mut total_steps = 0usize;
    validate_action(&task.action, 0, &mut total_steps, &mut total_payload)?;

    if task.tags.len() > MAX_TAGS {
        return Err(invalid(format!("task exceeds {MAX_TAGS} tags")));
    }
    for tag in &task.tags {
        validate_required_text("task tag", tag, MAX_TAG_BYTES)?;
        add_payload(&mut total_payload, tag.len())?;
    }

    if let Some(policy) = &task.retry_policy {
        if policy.max_retries > MAX_RETRIES {
            return Err(invalid(format!(
                "retry policy exceeds {MAX_RETRIES} retries"
            )));
        }
        if policy.max_retries > 0 && policy.retry_delay_ms == 0 {
            return Err(invalid(
                "retry delay must be non-zero when retries are enabled",
            ));
        }
        if policy.retry_delay_ms > MAX_PIPELINE_DELAY_MS
            || policy.max_delay_ms > MAX_PIPELINE_DELAY_MS
            || policy.max_delay_ms < policy.retry_delay_ms
        {
            return Err(invalid(
                "retry delays must be ordered and no greater than 86400000 ms",
            ));
        }
        if !policy.backoff_multiplier.is_finite()
            || !(1.0..=100.0).contains(&policy.backoff_multiplier)
        {
            return Err(invalid(
                "retry backoff multiplier must be finite and between 1 and 100",
            ));
        }
    }

    if let Some(timeout_ms) = task.timeout_ms {
        if !(1..=MAX_TASK_TIMEOUT_MS).contains(&timeout_ms) {
            return Err(invalid(format!(
                "task timeout must be between 1 and {MAX_TASK_TIMEOUT_MS} ms"
            )));
        }
    }
    Ok(total_payload)
}

fn task_collection_payload(
    tasks: &HashMap<String, ScheduledTask>,
    excluded_id: Option<&str>,
) -> Result<usize, SchedulerError> {
    let mut total = 0usize;
    for task in tasks.values() {
        if excluded_id == Some(task.id.as_str()) {
            continue;
        }
        total = total
            .checked_add(validate_task(task)?)
            .ok_or_else(|| invalid("aggregate scheduler payload size overflow"))?;
        if total > MAX_SCHEDULER_PAYLOAD_BYTES {
            return Err(SchedulerError::CapacityExceeded(format!(
                "scheduler task payload exceeds {MAX_SCHEDULER_PAYLOAD_BYTES} bytes"
            )));
        }
    }
    Ok(total)
}

/// The main scheduler that owns tasks, history, and configuration.
pub struct Scheduler {
    /// All registered tasks keyed by their ID.
    pub tasks: HashMap<String, ScheduledTask>,
    /// Execution history (newest last).
    pub history: Vec<TaskExecutionRecord>,
    /// Global scheduler configuration.
    pub config: SchedulerConfig,
    /// Whether the scheduler is currently active.
    pub running: bool,
    /// Task executor.
    executor: TaskExecutor,
}

impl Scheduler {
    /// Create a scheduler with the default configuration.
    pub fn new() -> Self {
        Self {
            tasks: HashMap::new(),
            history: Vec::new(),
            config: SchedulerConfig::default(),
            running: SchedulerConfig::default().enabled,
            executor: TaskExecutor::new(),
        }
    }

    /// Create a scheduler with a custom configuration. Values are clamped to
    /// safe invariants because this legacy constructor cannot return an error.
    /// Interactive configuration updates are rejected strictly instead.
    pub fn with_config(config: SchedulerConfig) -> Self {
        let config = sanitize_scheduler_config(config);
        Self {
            tasks: HashMap::new(),
            history: Vec::new(),
            running: config.enabled,
            config,
            executor: TaskExecutor::new(),
        }
    }

    // ── Task CRUD ───────────────────────────────────────────────

    /// Register a new task.  Its `next_run_at` will be computed automatically.
    pub fn add_task(&mut self, mut task: ScheduledTask) -> Result<String, SchedulerError> {
        if self.tasks.contains_key(&task.id) {
            return Err(SchedulerError::DuplicateTask(task.id.clone()));
        }
        if self.tasks.len() >= MAX_SCHEDULED_TASKS {
            return Err(SchedulerError::CapacityExceeded(format!(
                "at most {MAX_SCHEDULED_TASKS} tasks may be registered"
            )));
        }
        let task_payload = validate_task(&task)?;
        let existing_payload = task_collection_payload(&self.tasks, None)?;
        if existing_payload
            .checked_add(task_payload)
            .filter(|total| *total <= MAX_SCHEDULER_PAYLOAD_BYTES)
            .is_none()
        {
            return Err(SchedulerError::CapacityExceeded(format!(
                "scheduler task payload exceeds {MAX_SCHEDULER_PAYLOAD_BYTES} bytes"
            )));
        }
        let now = Utc::now();
        task.created_at = now;
        task.updated_at = now;
        task.last_run_at = None;
        task.run_count = 0;
        task.fail_count = 0;
        task.next_run_at = self.calculate_next_run(&task);
        let id = task.id.clone();
        self.tasks.insert(id.clone(), task);
        Ok(id)
    }

    /// Remove a task by ID.
    pub fn remove_task(&mut self, task_id: &str) -> Result<ScheduledTask, SchedulerError> {
        self.tasks
            .remove(task_id)
            .ok_or_else(|| SchedulerError::TaskNotFound(task_id.to_string()))
    }

    /// Replace a task with an updated version.  The ID must already exist.
    pub fn update_task(&mut self, mut task: ScheduledTask) -> Result<(), SchedulerError> {
        let task_payload = validate_task(&task)?;
        let existing_payload = task_collection_payload(&self.tasks, Some(&task.id))?;
        if existing_payload
            .checked_add(task_payload)
            .filter(|total| *total <= MAX_SCHEDULER_PAYLOAD_BYTES)
            .is_none()
        {
            return Err(SchedulerError::CapacityExceeded(format!(
                "scheduler task payload exceeds {MAX_SCHEDULER_PAYLOAD_BYTES} bytes"
            )));
        }
        let existing = self
            .tasks
            .get(&task.id)
            .ok_or_else(|| SchedulerError::TaskNotFound(task.id.clone()))?;
        task.created_at = existing.created_at;
        task.last_run_at = existing.last_run_at;
        task.run_count = existing.run_count;
        task.fail_count = existing.fail_count;
        task.updated_at = Utc::now();
        task.next_run_at = self.calculate_next_run(&task);
        self.tasks.insert(task.id.clone(), task);
        Ok(())
    }

    /// Get a reference to a task by ID.
    pub fn get_task(&self, task_id: &str) -> Result<&ScheduledTask, SchedulerError> {
        self.tasks
            .get(task_id)
            .ok_or_else(|| SchedulerError::TaskNotFound(task_id.to_string()))
    }

    /// List all tasks.
    pub fn list_tasks(&self) -> Vec<&ScheduledTask> {
        self.tasks.values().collect()
    }

    /// Enable a task.
    pub fn enable_task(&mut self, task_id: &str) -> Result<(), SchedulerError> {
        let task = self
            .tasks
            .get_mut(task_id)
            .ok_or_else(|| SchedulerError::TaskNotFound(task_id.to_string()))?;
        task.enabled = true;
        task.updated_at = Utc::now();
        // Recalculate next run since the task was just enabled.
        task.next_run_at = calculate_next_run_for(task);
        Ok(())
    }

    /// Disable a task.
    pub fn disable_task(&mut self, task_id: &str) -> Result<(), SchedulerError> {
        let task = self
            .tasks
            .get_mut(task_id)
            .ok_or_else(|| SchedulerError::TaskNotFound(task_id.to_string()))?;
        task.enabled = false;
        task.next_run_at = None;
        task.updated_at = Utc::now();
        Ok(())
    }

    // ── Schedule calculation ────────────────────────────────────

    /// Compute the next run time for a task based on its schedule.
    pub fn calculate_next_run(&self, task: &ScheduledTask) -> Option<DateTime<Utc>> {
        calculate_next_run_for(task)
    }
}

/// Free function that computes the next run time for a task.
/// Extracted to avoid borrow-checker conflicts with `&mut self`.
pub fn calculate_next_run_for(task: &ScheduledTask) -> Option<DateTime<Utc>> {
    if !task.enabled {
        return None;
    }

    let now = Utc::now();
    match &task.schedule {
        TaskSchedule::Once { at } => {
            if *at > now {
                Some(*at)
            } else {
                None
            }
        }
        TaskSchedule::Cron { expression } => {
            let parsed = cron::parse(expression).ok()?;
            let after = task.last_run_at.unwrap_or(now);
            cron::next_occurrence(&parsed, &after)
        }
        TaskSchedule::Interval { every_seconds } => {
            let base = task.last_run_at.unwrap_or(now);
            let seconds = i64::try_from(*every_seconds).ok()?;
            base.checked_add_signed(Duration::seconds(seconds))
        }
        TaskSchedule::Daily { time, timezone: _ } => {
            // Parse HH:MM
            let parts: Vec<&str> = time.split(':').collect();
            if parts.len() != 2 {
                return None;
            }
            let hour: u32 = parts[0].parse().ok()?;
            let minute: u32 = parts[1].parse().ok()?;
            let today = now
                .date_naive()
                .and_time(NaiveTime::from_hms_opt(hour, minute, 0)?)
                .and_utc();
            if today > now {
                Some(today)
            } else {
                today.checked_add_signed(Duration::days(1))
            }
        }
        TaskSchedule::Weekly { day, time } => {
            let parts: Vec<&str> = time.split(':').collect();
            if parts.len() != 2 {
                return None;
            }
            let hour: u32 = parts[0].parse().ok()?;
            let minute: u32 = parts[1].parse().ok()?;

            let target_dow = day.to_chrono();
            let mut candidate = now.date_naive();
            // Walk up to 7 days to find the next matching weekday.
            for _ in 0..7 {
                if candidate.weekday() == target_dow {
                    let dt = candidate
                        .and_time(NaiveTime::from_hms_opt(hour, minute, 0)?)
                        .and_utc();
                    if dt > now {
                        return Some(dt);
                    }
                }
                candidate = candidate.checked_add_signed(Duration::days(1))?;
            }
            // Fallback: one week from matching day
            let dt = candidate
                .and_time(NaiveTime::from_hms_opt(hour, minute, 0)?)
                .and_utc();
            Some(dt)
        }
        TaskSchedule::Monthly { day, time } => {
            let parts: Vec<&str> = time.split(':').collect();
            if parts.len() != 2 {
                return None;
            }
            let hour: u32 = parts[0].parse().ok()?;
            let minute: u32 = parts[1].parse().ok()?;
            let dom = *day as u32;

            let time = NaiveTime::from_hms_opt(hour, minute, 0)?;
            let mut year = now.year();
            let mut month = now.month();
            for _ in 0..=12 {
                if let Some(date) = NaiveDate::from_ymd_opt(year, month, dom) {
                    let candidate = date.and_time(time).and_utc();
                    if candidate > now {
                        return Some(candidate);
                    }
                }
                if month == 12 {
                    year = year.checked_add(1)?;
                    month = 1;
                } else {
                    month += 1;
                }
            }
            None
        }
        TaskSchedule::OnEvent { .. } => {
            // Event-driven tasks don't have a predictable next run.
            None
        }
    }
}

impl Scheduler {
    // ── Tick / due tasks ────────────────────────────────────────

    /// Return all enabled tasks whose `next_run_at` is at or before now.
    pub fn get_due_tasks(&self) -> Vec<&ScheduledTask> {
        if !self.running || !self.config.enabled {
            return Vec::new();
        }
        let now = Utc::now();
        let mut due: Vec<&ScheduledTask> = self
            .tasks
            .values()
            .filter(|t| t.enabled)
            .filter(|t| t.next_run_at.map(|nra| nra <= now).unwrap_or(false))
            .collect();
        // Sort by priority (highest first), then by next_run_at.
        due.sort_by(|a, b| {
            b.priority
                .weight()
                .cmp(&a.priority.weight())
                .then_with(|| a.next_run_at.cmp(&b.next_run_at))
        });
        due
    }

    /// Main tick: find due tasks, check conditions, execute, record history,
    /// and update task metadata.  Returns the execution records produced.
    pub fn tick(&mut self) -> Vec<TaskExecutionRecord> {
        if !self.running || !self.config.enabled {
            return Vec::new();
        }

        let due_ids: Vec<String> = self
            .get_due_tasks()
            .iter()
            .take(self.config.max_concurrent_tasks.min(MAX_EXECUTION_BATCH))
            .map(|t| t.id.clone())
            .collect();

        let mut records = Vec::new();

        for task_id in due_ids {
            let task = match self.tasks.get(&task_id) {
                Some(t) => t.clone(),
                None => continue,
            };

            // Condition check.
            if !self.executor.check_conditions(&task.conditions) {
                info!("scheduler: conditions not met for task {}", task.id);
                let mut record = TaskExecutionRecord::begin(&task, 0);
                record.status = ExecutionStatus::Skipped;
                let completed_at = Utc::now();
                record.completed_at = Some(completed_at);
                record.duration_ms =
                    Some((completed_at - record.started_at).num_milliseconds().max(0) as u64);
                record.error = Some("conditions not met".to_string());
                records.push(record.clone());
                self.record_history(record);
                // Reschedule.
                if let Some(t) = self.tasks.get_mut(&task_id) {
                    t.last_run_at = Some(completed_at);
                    t.next_run_at = calculate_next_run_for(t);
                }
                continue;
            }

            // Execute (with retry if configured).
            let record = if let Some(ref policy) = task.retry_policy {
                self.executor.execute_with_retry(&task, policy)
            } else {
                self.executor.execute_task(&task)
            };

            // Update task metadata.
            if let Some(t) = self.tasks.get_mut(&task_id) {
                t.last_run_at = Some(Utc::now());
                t.run_count = t.run_count.saturating_add(1);
                if matches!(
                    &record.status,
                    ExecutionStatus::Failed | ExecutionStatus::TimedOut
                ) {
                    t.fail_count = t.fail_count.saturating_add(1);
                }
                t.next_run_at = calculate_next_run_for(t);
            }

            self.record_history(record.clone());
            records.push(record);
        }

        records
    }

    // ── History ─────────────────────────────────────────────────

    /// Query execution history.  If `task_id` is given only that task's
    /// records are returned.  Results are ordered newest-first, limited
    /// to `limit`.
    pub fn get_history(&self, task_id: Option<&str>, limit: usize) -> Vec<&TaskExecutionRecord> {
        let limit = limit.min(MAX_HISTORY_QUERY);
        let iter: Box<dyn Iterator<Item = &TaskExecutionRecord>> = match task_id {
            Some(id) => Box::new(self.history.iter().filter(move |r| r.task_id == id)),
            None => Box::new(self.history.iter()),
        };
        let mut items: Vec<&TaskExecutionRecord> = iter.collect();
        items.sort_by_key(|item| std::cmp::Reverse(item.started_at));
        items.truncate(limit);
        items
    }

    /// Get the next N upcoming (enabled, scheduled) tasks sorted by
    /// `next_run_at`.
    pub fn get_upcoming(&self, count: usize) -> Vec<(&ScheduledTask, DateTime<Utc>)> {
        let count = count.min(MAX_UPCOMING_QUERY);
        let mut upcoming: Vec<(&ScheduledTask, DateTime<Utc>)> = self
            .tasks
            .values()
            .filter(|t| t.enabled && t.next_run_at.is_some())
            .map(|t| {
                (
                    t,
                    t.next_run_at.expect("filtered to tasks with next_run_at"),
                )
            })
            .collect();
        upcoming.sort_by_key(|&(_, dt)| dt);
        upcoming.truncate(count);
        upcoming
    }

    /// Remove history records older than `retention_days`.
    pub fn cleanup_history(&mut self, retention_days: u64) {
        let retention_days = retention_days.min(MAX_HISTORY_RETENTION_DAYS);
        let cutoff = Utc::now() - Duration::days(retention_days as i64);
        self.history.retain(|r| r.started_at >= cutoff);
        self.truncate_history();
    }

    /// Append a record while enforcing both age and absolute-size retention.
    pub(crate) fn record_history(&mut self, record: TaskExecutionRecord) {
        self.history.push(record);
        self.cleanup_history(self.config.history_retention_days);
    }

    fn truncate_history(&mut self) {
        if self.history.len() > MAX_HISTORY_RECORDS {
            let excess = self.history.len() - MAX_HISTORY_RECORDS;
            self.history.drain(..excess);
        }
    }

    // ── Statistics ──────────────────────────────────────────────

    /// Compute aggregate scheduler statistics.
    pub fn get_stats(&self) -> SchedulerStats {
        let total_tasks = self.tasks.len();
        let enabled_tasks = self.tasks.values().filter(|t| t.enabled).count();
        let total_executions = self.history.len();
        let successful = self
            .history
            .iter()
            .filter(|r| r.status == ExecutionStatus::Completed)
            .count();
        let failed = self
            .history
            .iter()
            .filter(|r| r.status == ExecutionStatus::Failed)
            .count();

        let (duration_total, duration_count) = self
            .history
            .iter()
            .filter_map(|r| r.duration_ms)
            .fold((0u128, 0u64), |(total, count), duration| {
                (
                    total.saturating_add(duration as u128),
                    count.saturating_add(1),
                )
            });
        let avg_duration_ms = if duration_count == 0 {
            0.0
        } else {
            duration_total as f64 / duration_count as f64
        };

        let next_scheduled_at = self.get_upcoming(1).first().map(|(_, dt)| *dt);

        let mut tasks_by_priority: HashMap<String, usize> = HashMap::new();
        for task in self.tasks.values() {
            let key = format!("{:?}", task.priority);
            *tasks_by_priority.entry(key).or_insert(0) += 1;
        }

        SchedulerStats {
            total_tasks,
            enabled_tasks,
            total_executions,
            successful,
            failed,
            avg_duration_ms,
            next_scheduled_at,
            tasks_by_priority,
        }
    }

    // ── Control ─────────────────────────────────────────────────

    /// Report cancellation truthfully. Executions currently run synchronously
    /// under the service mutex, so no caller can interrupt an in-flight task.
    pub fn cancel_running(&mut self, task_id: &str) -> Result<(), SchedulerError> {
        if !self.tasks.contains_key(task_id) {
            return Err(SchedulerError::TaskNotFound(task_id.to_string()));
        }
        Err(SchedulerError::TaskNotRunning(task_id.to_string()))
    }

    /// Pause the entire scheduler (no ticks will produce work).
    pub fn pause(&mut self) {
        self.running = false;
        self.config.enabled = false;
    }

    /// Resume the scheduler.
    pub fn resume(&mut self) {
        self.running = true;
        self.config.enabled = true;
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_task(schedule: TaskSchedule) -> ScheduledTask {
        ScheduledTask::new("test", schedule, TaskAction::SyncCloud)
    }

    #[test]
    fn add_and_get_task() {
        let mut sched = Scheduler::new();
        let task = make_task(TaskSchedule::Interval { every_seconds: 60 });
        let id = sched.add_task(task).unwrap();
        assert!(sched.get_task(&id).is_ok());
    }

    #[test]
    fn duplicate_task_rejected() {
        let mut sched = Scheduler::new();
        let task = make_task(TaskSchedule::Interval { every_seconds: 60 });
        let id = task.id.clone();
        sched.add_task(task).unwrap();
        let mut dup = make_task(TaskSchedule::Interval { every_seconds: 60 });
        dup.id = id;
        assert!(sched.add_task(dup).is_err());
    }

    #[test]
    fn remove_task() {
        let mut sched = Scheduler::new();
        let task = make_task(TaskSchedule::Interval { every_seconds: 60 });
        let id = sched.add_task(task).unwrap();
        sched.remove_task(&id).unwrap();
        assert!(sched.get_task(&id).is_err());
    }

    #[test]
    fn enable_disable() {
        let mut sched = Scheduler::new();
        let task = make_task(TaskSchedule::Interval { every_seconds: 60 });
        let id = sched.add_task(task).unwrap();
        sched.disable_task(&id).unwrap();
        assert!(!sched.get_task(&id).unwrap().enabled);
        sched.enable_task(&id).unwrap();
        assert!(sched.get_task(&id).unwrap().enabled);
    }

    #[test]
    fn tick_executes_due_task() {
        let mut sched = Scheduler::new();
        let mut task = make_task(TaskSchedule::Once {
            at: Utc::now() - Duration::seconds(10),
        });
        task.next_run_at = Some(Utc::now() - Duration::seconds(5));
        let id = task.id.clone();
        sched.tasks.insert(id.clone(), task);

        let records = sched.tick();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, ExecutionStatus::Failed);
        assert_eq!(sched.get_task(&id).unwrap().run_count, 1);
        assert_eq!(sched.get_task(&id).unwrap().fail_count, 1);
    }

    #[test]
    fn paused_scheduler_produces_no_work() {
        let mut sched = Scheduler::new();
        sched.pause();
        let task = make_task(TaskSchedule::Interval { every_seconds: 1 });
        let _ = sched.add_task(task);
        let records = sched.tick();
        assert!(records.is_empty());
    }

    #[test]
    fn stats_basic() {
        let sched = Scheduler::new();
        let stats = sched.get_stats();
        assert_eq!(stats.total_tasks, 0);
        assert_eq!(stats.total_executions, 0);
    }

    #[test]
    fn cleanup_history_removes_old() {
        let mut sched = Scheduler::new();
        let old = TaskExecutionRecord {
            id: "old".into(),
            task_id: "t".into(),
            task_name: "t".into(),
            started_at: Utc::now() - Duration::days(60),
            completed_at: Some(Utc::now() - Duration::days(60)),
            duration_ms: Some(100),
            status: ExecutionStatus::Completed,
            result: None,
            error: None,
            retry_attempt: 0,
        };
        sched.history.push(old);
        sched.cleanup_history(30);
        assert!(sched.history.is_empty());
    }

    #[test]
    fn get_upcoming_sorted() {
        let mut sched = Scheduler::new();
        let mut t1 = make_task(TaskSchedule::Interval { every_seconds: 60 });
        t1.next_run_at = Some(Utc::now() + Duration::hours(2));
        let mut t2 = make_task(TaskSchedule::Interval { every_seconds: 60 });
        t2.next_run_at = Some(Utc::now() + Duration::hours(1));
        sched.tasks.insert(t1.id.clone(), t1);
        sched.tasks.insert(t2.id.clone(), t2);

        let upcoming = sched.get_upcoming(5);
        assert_eq!(upcoming.len(), 2);
        assert!(upcoming[0].1 < upcoming[1].1);
    }
}
