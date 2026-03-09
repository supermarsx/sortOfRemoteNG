//! Service façade for the scheduler.
//!
//! Wraps [`Scheduler`] behind a single `Arc<Mutex<..>>` state
//! compatible with Tauri's managed-state model.

use std::sync::Arc;
use tokio::sync::Mutex;

use chrono::{DateTime, Utc};

use crate::cron;
use crate::error::SchedulerError;
use crate::scheduler::Scheduler;
use crate::types::*;

/// Type alias for the Tauri managed state.
pub type SchedulerServiceState = Arc<Mutex<SchedulerService>>;

/// Top-level façade wrapping the [`Scheduler`].
pub struct SchedulerService {
    pub scheduler: Scheduler,
}

impl SchedulerService {
    /// Create a new `SchedulerService` wrapped in `Arc<Mutex<..>>`.
    pub fn new() -> SchedulerServiceState {
        let service = Self {
            scheduler: Scheduler::new(),
        };
        Arc::new(Mutex::new(service))
    }

    /// Create with custom configuration.
    pub fn with_config(config: SchedulerConfig) -> SchedulerServiceState {
        let service = Self {
            scheduler: Scheduler::with_config(config),
        };
        Arc::new(Mutex::new(service))
    }

    // ── Task CRUD delegation ────────────────────────────────────

    pub fn add_task(&mut self, task: ScheduledTask) -> Result<String, SchedulerError> {
        self.scheduler.add_task(task)
    }

    pub fn remove_task(&mut self, task_id: &str) -> Result<ScheduledTask, SchedulerError> {
        self.scheduler.remove_task(task_id)
    }

    pub fn update_task(&mut self, task: ScheduledTask) -> Result<(), SchedulerError> {
        self.scheduler.update_task(task)
    }

    pub fn get_task(&self, task_id: &str) -> Result<ScheduledTask, SchedulerError> {
        self.scheduler.get_task(task_id).cloned()
    }

    pub fn list_tasks(&self) -> Vec<ScheduledTask> {
        self.scheduler.list_tasks().into_iter().cloned().collect()
    }

    pub fn enable_task(&mut self, task_id: &str) -> Result<(), SchedulerError> {
        self.scheduler.enable_task(task_id)
    }

    pub fn disable_task(&mut self, task_id: &str) -> Result<(), SchedulerError> {
        self.scheduler.disable_task(task_id)
    }

    // ── Execution ───────────────────────────────────────────────

    /// Manually trigger a task right now, regardless of its schedule.
    pub fn execute_now(&mut self, task_id: &str) -> Result<TaskExecutionRecord, SchedulerError> {
        let task = self
            .scheduler
            .tasks
            .get(task_id)
            .ok_or_else(|| SchedulerError::TaskNotFound(task_id.to_string()))?
            .clone();

        let executor = crate::executor::TaskExecutor::new();
        let record = if let Some(ref policy) = task.retry_policy {
            executor.execute_with_retry(&task, policy)
        } else {
            executor.execute_task(&task)
        };

        // Update metadata.
        if let Some(t) = self.scheduler.tasks.get_mut(task_id) {
            t.last_run_at = Some(Utc::now());
            t.run_count += 1;
            if record.status == ExecutionStatus::Failed {
                t.fail_count += 1;
            }
            t.next_run_at = crate::scheduler::calculate_next_run_for(t);
        }

        self.scheduler.history.push(record.clone());
        Ok(record)
    }

    /// Perform a scheduler tick (same as `scheduler.tick()`).
    pub fn tick(&mut self) -> Vec<TaskExecutionRecord> {
        self.scheduler.tick()
    }

    pub fn cancel_task(&mut self, task_id: &str) -> Result<(), SchedulerError> {
        self.scheduler.cancel_running(task_id)
    }

    // ── History & upcoming ──────────────────────────────────────

    pub fn get_history(&self, task_id: Option<&str>, limit: usize) -> Vec<TaskExecutionRecord> {
        self.scheduler
            .get_history(task_id, limit)
            .into_iter()
            .cloned()
            .collect()
    }

    pub fn get_upcoming(&self, count: usize) -> Vec<(ScheduledTask, DateTime<Utc>)> {
        self.scheduler
            .get_upcoming(count)
            .into_iter()
            .map(|(t, dt)| (t.clone(), dt))
            .collect()
    }

    // ── Config ──────────────────────────────────────────────────

    pub fn get_config(&self) -> SchedulerConfig {
        self.scheduler.config.clone()
    }

    pub fn update_config(&mut self, config: SchedulerConfig) {
        self.scheduler.running = config.enabled;
        self.scheduler.config = config;
    }

    // ── Stats & cleanup ─────────────────────────────────────────

    pub fn get_stats(&self) -> SchedulerStats {
        self.scheduler.get_stats()
    }

    pub fn cleanup_history(&mut self, retention_days: u64) {
        self.scheduler.cleanup_history(retention_days);
    }

    // ── Cron helpers ────────────────────────────────────────────

    pub fn validate_cron(&self, expression: &str) -> Result<(), SchedulerError> {
        cron::validate(expression)
    }

    pub fn get_next_occurrences(
        &self,
        expression: &str,
        count: usize,
    ) -> Result<Vec<DateTime<Utc>>, SchedulerError> {
        let parsed = cron::parse(expression)?;
        Ok(cron::next_occurrences(&parsed, &Utc::now(), count))
    }

    // ── Global pause / resume ───────────────────────────────────

    pub fn pause_all(&mut self) {
        self.scheduler.pause();
    }

    pub fn resume_all(&mut self) {
        self.scheduler.resume();
    }
}
