//! Bounded asynchronous service facade for the scheduler.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{watch, Mutex};

use crate::cron;
use crate::error::SchedulerError;
use crate::executor::{ExecutionControl, TaskExecutor};
use crate::scheduler::{
    calculate_next_run_for, validate_scheduler_config, validate_task, Scheduler, MAX_HISTORY_QUERY,
    MAX_HISTORY_RECORDS, MAX_HISTORY_RETENTION_DAYS, MAX_SCHEDULED_TASKS,
    MAX_SCHEDULER_PAYLOAD_BYTES, MAX_UPCOMING_QUERY,
};
use crate::types::*;

const PERSISTENCE_VERSION: u32 = 1;
const MAX_PERSISTED_STATE_BYTES: u64 = 32 * 1_048_576;
const MAX_PERSISTED_RESULT_BYTES: usize = 1_048_576;

pub type SchedulerServiceState = Arc<Mutex<SchedulerService>>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum BackgroundSignal {
    Wake(u64),
    Stop,
}

#[derive(Serialize, Deserialize)]
struct PersistedScheduler {
    version: u32,
    config: SchedulerConfig,
    tasks: Vec<ScheduledTask>,
    history: Vec<TaskExecutionRecord>,
}

pub struct SchedulerService {
    pub scheduler: Scheduler,
    persistence_path: Option<PathBuf>,
    running_tasks: HashMap<String, ExecutionControl>,
    background_signal: Option<watch::Sender<BackgroundSignal>>,
}

impl SchedulerService {
    fn managed(scheduler: Scheduler, persistence_path: Option<PathBuf>) -> SchedulerServiceState {
        let state = Arc::new(Mutex::new(Self {
            scheduler,
            persistence_path,
            running_tasks: HashMap::new(),
            background_signal: None,
        }));
        if tokio::runtime::Handle::try_current().is_ok() {
            let background_state = Arc::clone(&state);
            tokio::spawn(async move {
                let _ = Self::ensure_background_started(background_state).await;
            });
        }
        state
    }

    pub fn new() -> SchedulerServiceState {
        Self::managed(Scheduler::new(), None)
    }

    pub fn with_config(config: SchedulerConfig) -> SchedulerServiceState {
        Self::managed(Scheduler::with_config(config), None)
    }

    /// Load bounded scheduler state from a user-private application-data path.
    ///
    /// Plaintext persistence accepts only the executable Wake-on-LAN action
    /// family. Legacy actions which may contain secrets require a host-provided
    /// encrypted store and are rejected instead of being written here.
    pub fn with_storage_path(
        path: impl Into<PathBuf>,
    ) -> Result<SchedulerServiceState, SchedulerError> {
        let path = path.into();
        let scheduler = load_scheduler(&path)?;
        Ok(Self::managed(scheduler, Some(path)))
    }

    fn mutate_and_persist<T>(
        &mut self,
        operation: impl FnOnce(&mut Scheduler) -> Result<T, SchedulerError>,
    ) -> Result<T, SchedulerError> {
        if self.persistence_path.is_none() {
            let value = operation(&mut self.scheduler)?;
            ensure_scheduler_payload_budget(&self.scheduler)?;
            self.wake_background();
            return Ok(value);
        }
        ensure_scheduler_payload_budget(&self.scheduler)?;
        let previous_tasks = self.scheduler.tasks.clone();
        let previous_history = self.scheduler.history.clone();
        let previous_config = self.scheduler.config.clone();
        let previous_running = self.scheduler.running;
        let value = operation(&mut self.scheduler)?;
        if let Err(error) =
            ensure_scheduler_payload_budget(&self.scheduler).and_then(|_| self.persist())
        {
            self.scheduler.tasks = previous_tasks;
            self.scheduler.history = previous_history;
            self.scheduler.config = previous_config;
            self.scheduler.running = previous_running;
            return Err(error);
        }
        self.wake_background();
        Ok(value)
    }

    fn ensure_not_running(&self, task_id: &str) -> Result<(), SchedulerError> {
        if self.running_tasks.contains_key(task_id) {
            return Err(SchedulerError::ExecutionError(
                "task definition cannot change while it is running".to_string(),
            ));
        }
        Ok(())
    }

    pub fn add_task(&mut self, task: ScheduledTask) -> Result<String, SchedulerError> {
        ensure_task_mutation_budget(&self.scheduler, &task, None)?;
        self.mutate_and_persist(move |scheduler| scheduler.add_task(task))
    }

    pub fn remove_task(&mut self, task_id: &str) -> Result<ScheduledTask, SchedulerError> {
        self.ensure_not_running(task_id)?;
        self.mutate_and_persist(|scheduler| scheduler.remove_task(task_id))
    }

    pub fn update_task(&mut self, task: ScheduledTask) -> Result<(), SchedulerError> {
        self.ensure_not_running(&task.id)?;
        ensure_task_mutation_budget(&self.scheduler, &task, Some(&task.id))?;
        self.mutate_and_persist(move |scheduler| scheduler.update_task(task))
    }

    pub fn get_task(&self, task_id: &str) -> Result<ScheduledTask, SchedulerError> {
        self.scheduler.get_task(task_id).cloned()
    }

    pub fn list_tasks(&self) -> Vec<ScheduledTask> {
        self.scheduler.list_tasks().into_iter().cloned().collect()
    }

    pub fn enable_task(&mut self, task_id: &str) -> Result<(), SchedulerError> {
        self.ensure_not_running(task_id)?;
        self.mutate_and_persist(|scheduler| scheduler.enable_task(task_id))
    }

    pub fn disable_task(&mut self, task_id: &str) -> Result<(), SchedulerError> {
        self.ensure_not_running(task_id)?;
        self.mutate_and_persist(|scheduler| scheduler.disable_task(task_id))
    }

    pub async fn ensure_background_started(
        state: SchedulerServiceState,
    ) -> Result<(), SchedulerError> {
        let mut receiver = {
            let mut service = state.lock().await;
            if service.background_signal.is_some() {
                return Ok(());
            }
            let (sender, receiver) = watch::channel(BackgroundSignal::Wake(0));
            service.background_signal = Some(sender);
            receiver
        };
        tokio::spawn(async move {
            loop {
                if let Err(error) = Self::run_due_tasks(Arc::clone(&state)).await {
                    log::error!("scheduler background tick failed: {error}");
                }
                let interval = state.lock().await.scheduler.config.check_interval_seconds;
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(interval)) => {}
                    changed = receiver.changed() => {
                        if changed.is_err()
                            || matches!(*receiver.borrow(), BackgroundSignal::Stop)
                        {
                            break;
                        }
                    }
                }
            }
        });
        Ok(())
    }

    pub async fn stop_background(state: &SchedulerServiceState) {
        let sender = state.lock().await.background_signal.take();
        if let Some(sender) = sender {
            sender.send_replace(BackgroundSignal::Stop);
        }
    }

    fn wake_background(&self) {
        if let Some(sender) = &self.background_signal {
            let next = match *sender.borrow() {
                BackgroundSignal::Wake(generation) => {
                    BackgroundSignal::Wake(generation.wrapping_add(1))
                }
                BackgroundSignal::Stop => BackgroundSignal::Stop,
            };
            sender.send_replace(next);
        }
    }

    pub async fn execute_now(
        state: SchedulerServiceState,
        task_id: &str,
    ) -> Result<TaskExecutionRecord, SchedulerError> {
        let (task, control, timeout_ms) = {
            let mut service = state.lock().await;
            if service.running_tasks.contains_key(task_id) {
                return Err(SchedulerError::ExecutionError(
                    "task is already running".to_string(),
                ));
            }
            if service.running_tasks.len() >= service.scheduler.config.max_concurrent_tasks {
                return Err(SchedulerError::CapacityExceeded(
                    "scheduler concurrency limit reached".to_string(),
                ));
            }
            let task = service
                .scheduler
                .tasks
                .get(task_id)
                .cloned()
                .ok_or_else(|| SchedulerError::TaskNotFound(task_id.to_string()))?;
            let timeout_ms = task
                .timeout_ms
                .unwrap_or(service.scheduler.config.default_timeout_ms);
            let control = ExecutionControl::new();
            service
                .running_tasks
                .insert(task_id.to_string(), control.clone());
            (task, control, timeout_ms)
        };

        let executor = TaskExecutor::new();
        let mut record = if !executor.check_conditions(&task.conditions) {
            let mut skipped = TaskExecutionRecord::begin(&task, 0);
            skipped.status = ExecutionStatus::Skipped;
            skipped.completed_at = Some(Utc::now());
            skipped.duration_ms = Some(0);
            skipped.error = Some("conditions not met".to_string());
            skipped
        } else {
            match tokio::time::timeout(
                Duration::from_millis(timeout_ms),
                executor.execute_controlled(&task, &control),
            )
            .await
            {
                Ok(record) => record,
                Err(_) => {
                    let _ = control.request_cancel();
                    let mut timed_out = TaskExecutionRecord::begin(&task, 0);
                    timed_out.timeout();
                    timed_out
                }
            }
        };

        let persisted = {
            let mut service = state.lock().await;
            service.running_tasks.remove(task_id);
            if let Some(stored) = service.scheduler.tasks.get_mut(task_id) {
                stored.last_run_at = Some(record.completed_at.unwrap_or_else(Utc::now));
                if !matches!(&record.status, ExecutionStatus::Skipped) {
                    stored.run_count = stored.run_count.saturating_add(1);
                }
                if matches!(
                    &record.status,
                    ExecutionStatus::Failed | ExecutionStatus::TimedOut
                ) {
                    stored.fail_count = stored.fail_count.saturating_add(1);
                }
                stored.next_run_at = calculate_next_run_for(stored);
            }
            service.scheduler.record_history(record.clone());
            service.persist().is_ok()
        };
        if !persisted {
            record.error = Some(match record.error.take() {
                Some(error) => format!(
                    "{error}; execution completed but scheduler state was not durably persisted"
                ),
                None => {
                    "execution completed but scheduler state was not durably persisted".to_string()
                }
            });
        }
        Ok(record)
    }

    pub async fn run_due_tasks(
        state: SchedulerServiceState,
    ) -> Result<Vec<TaskExecutionRecord>, SchedulerError> {
        let (task_ids, mut records) = {
            let mut service = state.lock().await;
            let skipped = service.skip_missed_runs();
            if !skipped.is_empty() {
                service.persist()?;
            }
            if !service.scheduler.running || !service.scheduler.config.enabled {
                return Ok(skipped);
            }
            let available = service
                .scheduler
                .config
                .max_concurrent_tasks
                .saturating_sub(service.running_tasks.len());
            let ids: Vec<String> = service
                .scheduler
                .get_due_tasks()
                .into_iter()
                .filter(|task| !service.running_tasks.contains_key(&task.id))
                .take(available)
                .map(|task| task.id.clone())
                .collect();
            (ids, skipped)
        };

        let mut handles = Vec::with_capacity(task_ids.len());
        for task_id in task_ids {
            let execution_state = Arc::clone(&state);
            let execution_id = task_id.clone();
            handles.push((
                task_id,
                tokio::spawn(
                    async move { Self::execute_now(execution_state, &execution_id).await },
                ),
            ));
        }
        for (task_id, handle) in handles {
            match handle.await {
                Ok(Ok(record)) => records.push(record),
                Ok(Err(error)) => log::error!("scheduled task {task_id} failed: {error}"),
                Err(error) => {
                    state.lock().await.running_tasks.remove(&task_id);
                    log::error!("scheduled task {task_id} worker failed: {error}");
                }
            }
        }
        Ok(records)
    }

    fn skip_missed_runs(&mut self) -> Vec<TaskExecutionRecord> {
        if self.scheduler.config.catch_up_missed
            || !self.scheduler.running
            || !self.scheduler.config.enabled
        {
            return Vec::new();
        }
        let now = Utc::now();
        let cutoff =
            now - chrono::Duration::seconds(self.scheduler.config.check_interval_seconds as i64);
        let stale_ids: Vec<String> = self
            .scheduler
            .tasks
            .values()
            .filter(|task| {
                task.enabled
                    && task
                        .next_run_at
                        .map(|next_run| next_run < cutoff)
                        .unwrap_or(false)
            })
            .map(|task| task.id.clone())
            .collect();
        let mut records = Vec::with_capacity(stale_ids.len());
        for task_id in stale_ids {
            if let Some(task) = self.scheduler.tasks.get_mut(&task_id) {
                let mut record = TaskExecutionRecord::begin(task, 0);
                record.status = ExecutionStatus::Skipped;
                record.completed_at = Some(now);
                record.duration_ms = Some(0);
                record.error = Some("missed execution skipped by catch-up policy".to_string());
                task.last_run_at = Some(now);
                task.next_run_at = calculate_next_run_for(task);
                records.push(record);
            }
        }
        for record in records.iter().cloned() {
            self.scheduler.record_history(record);
        }
        records
    }

    pub fn cancel_task(&self, task_id: &str) -> Result<(), SchedulerError> {
        self.running_tasks
            .get(task_id)
            .ok_or_else(|| SchedulerError::TaskNotRunning(task_id.to_string()))?
            .request_cancel()
    }

    pub fn get_history(&self, task_id: Option<&str>, limit: usize) -> Vec<TaskExecutionRecord> {
        self.scheduler
            .get_history(task_id, limit.min(MAX_HISTORY_QUERY))
            .into_iter()
            .cloned()
            .collect()
    }

    pub fn get_upcoming(&self, count: usize) -> Vec<(ScheduledTask, DateTime<Utc>)> {
        self.scheduler
            .get_upcoming(count.min(MAX_UPCOMING_QUERY))
            .into_iter()
            .map(|(task, at)| (task.clone(), at))
            .collect()
    }

    pub fn get_config(&self) -> SchedulerConfig {
        self.scheduler.config.clone()
    }

    pub fn update_config(&mut self, config: SchedulerConfig) -> Result<(), SchedulerError> {
        validate_scheduler_config(&config)?;
        self.mutate_and_persist(move |scheduler| {
            scheduler.running = config.enabled;
            scheduler.config = config;
            scheduler.cleanup_history(scheduler.config.history_retention_days);
            Ok(())
        })
    }

    pub fn get_stats(&self) -> SchedulerStats {
        self.scheduler.get_stats()
    }

    pub fn cleanup_history(&mut self, retention_days: u64) -> Result<(), SchedulerError> {
        if retention_days > MAX_HISTORY_RETENTION_DAYS {
            return Err(SchedulerError::InvalidInput(format!(
                "history retention exceeds {MAX_HISTORY_RETENTION_DAYS} days"
            )));
        }
        self.mutate_and_persist(|scheduler| {
            scheduler.cleanup_history(retention_days);
            Ok(())
        })
    }

    pub fn validate_cron(&self, expression: &str) -> Result<(), SchedulerError> {
        cron::validate(expression)
    }

    pub fn get_next_occurrences(
        &self,
        expression: &str,
        count: usize,
    ) -> Result<Vec<DateTime<Utc>>, SchedulerError> {
        let parsed = cron::parse(expression)?;
        Ok(cron::next_occurrences(
            &parsed,
            &Utc::now(),
            count.min(cron::MAX_CRON_OCCURRENCES),
        ))
    }

    pub fn pause_all(&mut self) -> Result<(), SchedulerError> {
        self.mutate_and_persist(|scheduler| {
            scheduler.pause();
            Ok(())
        })
    }

    pub fn resume_all(&mut self) -> Result<(), SchedulerError> {
        self.mutate_and_persist(|scheduler| {
            scheduler.resume();
            Ok(())
        })
    }

    fn persist(&self) -> Result<(), SchedulerError> {
        let Some(path) = &self.persistence_path else {
            return Ok(());
        };
        if self
            .scheduler
            .tasks
            .values()
            .any(|task| !persistable_action(&task.action, 0))
        {
            return Err(SchedulerError::InvalidInput(
                "unsupported scheduler actions require encrypted host persistence".to_string(),
            ));
        }
        let snapshot = PersistedScheduler {
            version: PERSISTENCE_VERSION,
            config: self.scheduler.config.clone(),
            tasks: self.scheduler.tasks.values().cloned().collect(),
            history: self.scheduler.history.clone(),
        };
        let encoded = serde_json::to_vec(&snapshot)?;
        if encoded.len() as u64 > MAX_PERSISTED_STATE_BYTES {
            return Err(SchedulerError::CapacityExceeded(format!(
                "scheduler state exceeds {MAX_PERSISTED_STATE_BYTES} bytes"
            )));
        }
        write_snapshot(path, &encoded)
    }
}

fn persistable_action(action: &TaskAction, depth: usize) -> bool {
    if depth > 16 {
        return false;
    }
    match action {
        TaskAction::SendWakeOnLan { .. } => true,
        TaskAction::Pipeline { steps } if steps.len() <= 256 => steps
            .iter()
            .all(|step| persistable_action(&step.action, depth + 1)),
        _ => false,
    }
}

fn ensure_scheduler_payload_budget(scheduler: &Scheduler) -> Result<(), SchedulerError> {
    let mut total = 0usize;
    for task in scheduler.tasks.values() {
        total = total.checked_add(validate_task(task)?).ok_or_else(|| {
            SchedulerError::CapacityExceeded(
                "aggregate scheduler payload size overflow".to_string(),
            )
        })?;
        if total > MAX_SCHEDULER_PAYLOAD_BYTES {
            return Err(SchedulerError::CapacityExceeded(format!(
                "scheduler payload exceeds {MAX_SCHEDULER_PAYLOAD_BYTES} bytes"
            )));
        }
    }
    for record in &scheduler.history {
        let mut record_bytes = record
            .id
            .len()
            .checked_add(record.task_id.len())
            .and_then(|value| value.checked_add(record.task_name.len()))
            .and_then(|value| value.checked_add(record.error.as_ref().map_or(0, String::len)))
            .ok_or_else(|| {
                SchedulerError::CapacityExceeded(
                    "aggregate scheduler history size overflow".to_string(),
                )
            })?;
        if let Some(result) = &record.result {
            record_bytes = record_bytes
                .checked_add(serde_json::to_vec(result)?.len())
                .ok_or_else(|| {
                    SchedulerError::CapacityExceeded(
                        "aggregate scheduler history size overflow".to_string(),
                    )
                })?;
        }
        total = total.checked_add(record_bytes).ok_or_else(|| {
            SchedulerError::CapacityExceeded(
                "aggregate scheduler payload size overflow".to_string(),
            )
        })?;
        if total > MAX_SCHEDULER_PAYLOAD_BYTES {
            return Err(SchedulerError::CapacityExceeded(format!(
                "scheduler payload exceeds {MAX_SCHEDULER_PAYLOAD_BYTES} bytes"
            )));
        }
    }
    Ok(())
}

fn ensure_task_mutation_budget(
    scheduler: &Scheduler,
    incoming: &ScheduledTask,
    replaced_id: Option<&str>,
) -> Result<(), SchedulerError> {
    let mut total = 0usize;
    for task in scheduler.tasks.values() {
        if replaced_id == Some(task.id.as_str()) {
            continue;
        }
        total = total.checked_add(validate_task(task)?).ok_or_else(|| {
            SchedulerError::CapacityExceeded("aggregate scheduler task size overflow".to_string())
        })?;
    }
    for record in &scheduler.history {
        let mut record_bytes = record
            .id
            .len()
            .checked_add(record.task_id.len())
            .and_then(|value| value.checked_add(record.task_name.len()))
            .and_then(|value| value.checked_add(record.error.as_ref().map_or(0, String::len)))
            .ok_or_else(|| {
                SchedulerError::CapacityExceeded(
                    "aggregate scheduler history size overflow".to_string(),
                )
            })?;
        if let Some(result) = &record.result {
            record_bytes = record_bytes
                .checked_add(serde_json::to_vec(result)?.len())
                .ok_or_else(|| {
                    SchedulerError::CapacityExceeded(
                        "aggregate scheduler history size overflow".to_string(),
                    )
                })?;
        }
        total = total.checked_add(record_bytes).ok_or_else(|| {
            SchedulerError::CapacityExceeded(
                "aggregate scheduler payload size overflow".to_string(),
            )
        })?;
    }
    total = total.checked_add(validate_task(incoming)?).ok_or_else(|| {
        SchedulerError::CapacityExceeded("aggregate scheduler payload size overflow".to_string())
    })?;
    if total > MAX_SCHEDULER_PAYLOAD_BYTES {
        return Err(SchedulerError::CapacityExceeded(format!(
            "scheduler payload exceeds {MAX_SCHEDULER_PAYLOAD_BYTES} bytes"
        )));
    }
    Ok(())
}

fn load_scheduler(path: &Path) -> Result<Scheduler, SchedulerError> {
    let backup = sibling_path(path, "bak")?;
    let mut saw_candidate = false;
    for candidate in [path, backup.as_path()] {
        if !candidate.exists() {
            continue;
        }
        saw_candidate = true;
        let Ok(snapshot) = read_snapshot(candidate) else {
            continue;
        };
        if snapshot.version != PERSISTENCE_VERSION
            || snapshot.tasks.len() > MAX_SCHEDULED_TASKS
            || snapshot.history.len() > MAX_HISTORY_RECORDS
            || snapshot
                .tasks
                .iter()
                .any(|task| !persistable_action(&task.action, 0))
        {
            continue;
        }
        if validate_scheduler_config(&snapshot.config).is_err() {
            continue;
        }
        let mut scheduler = Scheduler::with_config(snapshot.config);
        let now = Utc::now();
        let mut valid = true;
        for mut task in snapshot.tasks {
            let persisted = task.clone();
            if scheduler.add_task(task.clone()).is_err() {
                valid = false;
                break;
            }
            task = persisted;
            if !task.enabled {
                task.next_run_at = None;
            } else if !scheduler.config.catch_up_missed {
                let last_run = task.last_run_at;
                task.last_run_at = Some(now);
                task.next_run_at = calculate_next_run_for(&task);
                task.last_run_at = last_run;
            }
            scheduler.tasks.insert(task.id.clone(), task);
        }
        if !valid {
            continue;
        }
        let mut history = snapshot.history;
        for record in &mut history {
            if record.id.len() > 128
                || record.task_id.len() > 128
                || record.task_name.len() > 256
                || record
                    .error
                    .as_ref()
                    .map_or(false, |error| error.len() > 65_536)
                || record.result.as_ref().map_or(false, |result| {
                    serde_json::to_vec(result)
                        .map(|encoded| encoded.len() > MAX_PERSISTED_RESULT_BYTES)
                        .unwrap_or(true)
                })
            {
                valid = false;
                break;
            }
            if matches!(&record.status, ExecutionStatus::Running) {
                record.cancel();
                record.error = Some("task interrupted by scheduler restart".to_string());
            }
        }
        if !valid {
            continue;
        }
        scheduler.history = history;
        scheduler.cleanup_history(scheduler.config.history_retention_days);
        return Ok(scheduler);
    }
    if saw_candidate {
        Err(SchedulerError::SerializationError(
            "scheduler state and recovery backup are invalid".to_string(),
        ))
    } else {
        Ok(Scheduler::new())
    }
}

fn sibling_path(path: &Path, suffix: &str) -> Result<PathBuf, SchedulerError> {
    let parent = path.parent().ok_or_else(|| {
        SchedulerError::InvalidInput("scheduler persistence path has no parent".to_string())
    })?;
    let name = path.file_name().ok_or_else(|| {
        SchedulerError::InvalidInput("scheduler persistence path has no file name".to_string())
    })?;
    Ok(parent.join(format!("{}.{}", name.to_string_lossy(), suffix)))
}

fn read_snapshot(path: &Path) -> Result<PersistedScheduler, SchedulerError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| {
        SchedulerError::SerializationError("scheduler state metadata failed".into())
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(SchedulerError::SerializationError(
            "scheduler state must be a regular file".to_string(),
        ));
    }
    if metadata.len() > MAX_PERSISTED_STATE_BYTES {
        return Err(SchedulerError::CapacityExceeded(
            "scheduler state exceeds its read limit".to_string(),
        ));
    }
    let file = File::open(path)
        .map_err(|_| SchedulerError::SerializationError("scheduler state open failed".into()))?;
    let mut limited = file.take(MAX_PERSISTED_STATE_BYTES + 1);
    let mut encoded = Vec::with_capacity(metadata.len() as usize);
    limited
        .read_to_end(&mut encoded)
        .map_err(|_| SchedulerError::SerializationError("scheduler state read failed".into()))?;
    if encoded.len() as u64 > MAX_PERSISTED_STATE_BYTES {
        return Err(SchedulerError::CapacityExceeded(
            "scheduler state exceeds its read limit".to_string(),
        ));
    }
    serde_json::from_slice(&encoded).map_err(Into::into)
}

fn write_snapshot(path: &Path, encoded: &[u8]) -> Result<(), SchedulerError> {
    let parent = path.parent().ok_or_else(|| {
        SchedulerError::InvalidInput("scheduler persistence path has no parent".to_string())
    })?;
    fs::create_dir_all(parent).map_err(|_| {
        SchedulerError::SerializationError("scheduler state directory creation failed".into())
    })?;
    if path.exists() {
        let metadata = fs::symlink_metadata(path).map_err(|_| {
            SchedulerError::SerializationError("scheduler state metadata failed".into())
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(SchedulerError::SerializationError(
                "scheduler state must be a regular file".to_string(),
            ));
        }
    }
    let temporary = sibling_path(path, &format!("{}.tmp", uuid::Uuid::new_v4()))?;
    let backup = sibling_path(path, "bak")?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| SchedulerError::SerializationError("temporary state create failed".into()))?;
    file.write_all(encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| SchedulerError::SerializationError("temporary state write failed".into()))?;
    drop(file);
    if path.exists() {
        if backup.exists() {
            let metadata = fs::symlink_metadata(&backup).map_err(|_| {
                SchedulerError::SerializationError("state backup metadata failed".into())
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                let _ = fs::remove_file(&temporary);
                return Err(SchedulerError::SerializationError(
                    "scheduler backup must be a regular file".to_string(),
                ));
            }
            fs::remove_file(&backup).map_err(|_| {
                SchedulerError::SerializationError("old state backup removal failed".into())
            })?;
        }
        fs::rename(path, &backup).map_err(|_| {
            SchedulerError::SerializationError("scheduler state backup failed".into())
        })?;
    }
    if fs::rename(&temporary, path).is_err() {
        if backup.exists() && !path.exists() {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(SchedulerError::SerializationError(
            "scheduler state replacement failed".to_string(),
        ));
    }
    Ok(())
}
