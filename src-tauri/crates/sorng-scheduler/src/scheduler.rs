//! Core scheduler: task storage, due-task detection, tick loop,
//! history management, and statistics.

use chrono::{DateTime, Datelike, Duration, NaiveTime, Utc};
use log::info;
use std::collections::HashMap;

use crate::cron;
use crate::error::SchedulerError;
use crate::executor::TaskExecutor;
use crate::types::*;

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
    /// Set of task IDs whose current execution should be treated as cancelled.
    cancelled: std::collections::HashSet<String>,
}

impl Scheduler {
    /// Create a scheduler with the default configuration.
    pub fn new() -> Self {
        Self {
            tasks: HashMap::new(),
            history: Vec::new(),
            config: SchedulerConfig::default(),
            running: true,
            executor: TaskExecutor::new(),
            cancelled: std::collections::HashSet::new(),
        }
    }

    /// Create a scheduler with a custom configuration.
    pub fn with_config(config: SchedulerConfig) -> Self {
        Self {
            tasks: HashMap::new(),
            history: Vec::new(),
            running: config.enabled,
            config,
            executor: TaskExecutor::new(),
            cancelled: std::collections::HashSet::new(),
        }
    }

    // ── Task CRUD ───────────────────────────────────────────────

    /// Register a new task.  Its `next_run_at` will be computed automatically.
    pub fn add_task(&mut self, mut task: ScheduledTask) -> Result<String, SchedulerError> {
        if self.tasks.contains_key(&task.id) {
            return Err(SchedulerError::DuplicateTask(task.id.clone()));
        }
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
        if !self.tasks.contains_key(&task.id) {
            return Err(SchedulerError::TaskNotFound(task.id.clone()));
        }
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
            Some(base + Duration::seconds(*every_seconds as i64))
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
                Some(today + Duration::days(1))
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
                candidate += Duration::days(1);
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

            // Try this month first.
            if let Some(date) = now.date_naive().with_day(dom) {
                let dt = date
                    .and_time(NaiveTime::from_hms_opt(hour, minute, 0)?)
                    .and_utc();
                if dt > now {
                    return Some(dt);
                }
            }
            // Otherwise next month.
            let next_month = if now.month() == 12 {
                now.date_naive()
                    .with_year(now.year() + 1)?
                    .with_month(1)?
                    .with_day(dom)?
            } else {
                now.date_naive()
                    .with_month(now.month() + 1)?
                    .with_day(dom)?
            };
            Some(
                next_month
                    .and_time(NaiveTime::from_hms_opt(hour, minute, 0)?)
                    .and_utc(),
            )
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
            .take(self.config.max_concurrent_tasks)
            .map(|t| t.id.clone())
            .collect();

        let mut records = Vec::new();

        for task_id in due_ids {
            // Skip if cancelled.
            if self.cancelled.remove(&task_id) {
                continue;
            }

            let task = match self.tasks.get(&task_id) {
                Some(t) => t.clone(),
                None => continue,
            };

            // Condition check.
            if !self.executor.check_conditions(&task.conditions) {
                info!("scheduler: conditions not met for task {}", task.id);
                let mut record = TaskExecutionRecord::begin(&task, 0);
                record.status = ExecutionStatus::Skipped;
                record.completed_at = Some(Utc::now());
                record.error = Some("conditions not met".to_string());
                records.push(record.clone());
                self.history.push(record);
                // Reschedule.
                if let Some(t) = self.tasks.get_mut(&task_id) {
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
                t.run_count += 1;
                if record.status == ExecutionStatus::Failed {
                    t.fail_count += 1;
                }
                t.next_run_at = calculate_next_run_for(t);
            }

            self.history.push(record.clone());
            records.push(record);
        }

        records
    }

    // ── History ─────────────────────────────────────────────────

    /// Query execution history.  If `task_id` is given only that task's
    /// records are returned.  Results are ordered newest-first, limited
    /// to `limit`.
    pub fn get_history(&self, task_id: Option<&str>, limit: usize) -> Vec<&TaskExecutionRecord> {
        let iter: Box<dyn Iterator<Item = &TaskExecutionRecord>> = match task_id {
            Some(id) => Box::new(self.history.iter().filter(move |r| r.task_id == id)),
            None => Box::new(self.history.iter()),
        };
        let mut items: Vec<&TaskExecutionRecord> = iter.collect();
        items.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        items.truncate(limit);
        items
    }

    /// Get the next N upcoming (enabled, scheduled) tasks sorted by
    /// `next_run_at`.
    pub fn get_upcoming(&self, count: usize) -> Vec<(&ScheduledTask, DateTime<Utc>)> {
        let mut upcoming: Vec<(&ScheduledTask, DateTime<Utc>)> = self
            .tasks
            .values()
            .filter(|t| t.enabled && t.next_run_at.is_some())
            .map(|t| (t, t.next_run_at.expect("filtered to tasks with next_run_at")))
            .collect();
        upcoming.sort_by_key(|&(_, dt)| dt);
        upcoming.truncate(count);
        upcoming
    }

    /// Remove history records older than `retention_days`.
    pub fn cleanup_history(&mut self, retention_days: u64) {
        let cutoff = Utc::now() - Duration::days(retention_days as i64);
        self.history.retain(|r| r.started_at >= cutoff);
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

        let durations: Vec<u64> = self.history.iter().filter_map(|r| r.duration_ms).collect();
        let avg_duration_ms = if durations.is_empty() {
            0.0
        } else {
            durations.iter().sum::<u64>() as f64 / durations.len() as f64
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

    /// Request cancellation of a currently-queued or running task.
    pub fn cancel_running(&mut self, task_id: &str) -> Result<(), SchedulerError> {
        if !self.tasks.contains_key(task_id) {
            return Err(SchedulerError::TaskNotFound(task_id.to_string()));
        }
        self.cancelled.insert(task_id.to_string());
        Ok(())
    }

    /// Pause the entire scheduler (no ticks will produce work).
    pub fn pause(&mut self) {
        self.running = false;
    }

    /// Resume the scheduler.
    pub fn resume(&mut self) {
        self.running = true;
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
        assert_eq!(records[0].status, ExecutionStatus::Completed);
        assert_eq!(sched.get_task(&id).unwrap().run_count, 1);
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
