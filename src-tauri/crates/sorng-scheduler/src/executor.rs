//! Task execution, retry logic, and pipeline runner.

use chrono::{Datelike, NaiveTime, Utc};
use std::future::Future;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::pin::Pin;
use std::sync::{
    atomic::{AtomicU8, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::sync::Notify;

use crate::error::SchedulerError;
use crate::types::*;

const MAX_PIPELINE_STEPS: usize = 256;
const MAX_PIPELINE_DEPTH: usize = 16;
const PHASE_INTERRUPTIBLE: u8 = 0;
const PHASE_SIDE_EFFECT: u8 = 1;
const PHASE_CANCELLED: u8 = 2;
const PHASE_FINISHED: u8 = 3;

struct ExecutionControlInner {
    phase: AtomicU8,
    cancelled: Notify,
}

/// Cooperative cancellation which never claims to interrupt an already
/// dispatched side effect.
#[derive(Clone)]
pub struct ExecutionControl {
    inner: Arc<ExecutionControlInner>,
}

impl ExecutionControl {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ExecutionControlInner {
                phase: AtomicU8::new(PHASE_INTERRUPTIBLE),
                cancelled: Notify::new(),
            }),
        }
    }

    pub fn request_cancel(&self) -> Result<(), SchedulerError> {
        match self.inner.phase.compare_exchange(
            PHASE_INTERRUPTIBLE,
            PHASE_CANCELLED,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => {
                self.inner.cancelled.notify_waiters();
                Ok(())
            }
            Err(PHASE_CANCELLED) => Ok(()),
            Err(PHASE_SIDE_EFFECT) => Err(SchedulerError::ExecutionError(
                "task side effect has already started and cannot be interrupted".to_string(),
            )),
            Err(_) => Err(SchedulerError::TaskNotRunning(
                "execution already finished".to_string(),
            )),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.phase.load(Ordering::Acquire) == PHASE_CANCELLED
    }

    fn begin_side_effect(&self) -> bool {
        self.inner
            .phase
            .compare_exchange(
                PHASE_INTERRUPTIBLE,
                PHASE_SIDE_EFFECT,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    fn end_side_effect(&self) {
        let _ = self.inner.phase.compare_exchange(
            PHASE_SIDE_EFFECT,
            PHASE_INTERRUPTIBLE,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }

    fn finish(&self) -> bool {
        match self.inner.phase.compare_exchange(
            PHASE_INTERRUPTIBLE,
            PHASE_FINISHED,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) | Err(PHASE_FINISHED) => true,
            Err(PHASE_CANCELLED) => false,
            Err(PHASE_SIDE_EFFECT) => {
                self.inner.phase.store(PHASE_FINISHED, Ordering::Release);
                true
            }
            Err(_) => false,
        }
    }

    async fn wait_cancelled(&self) {
        loop {
            if self.is_cancelled() {
                return;
            }
            let notified = self.inner.cancelled.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }

    async fn sleep(&self, duration: Duration) -> bool {
        tokio::select! {
            _ = tokio::time::sleep(duration) => !self.is_cancelled(),
            _ = self.wait_cancelled() => false,
        }
    }
}

impl Default for ExecutionControl {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy)]
pub struct TaskExecutor;

impl TaskExecutor {
    pub fn new() -> Self {
        Self
    }

    /// Legacy synchronous execution remains fail-closed for delay/retry
    /// semantics. The managed service uses `execute_controlled`.
    pub fn execute_task(&self, task: &ScheduledTask) -> TaskExecutionRecord {
        self.execute_task_at_depth(task, 0)
    }

    fn execute_task_at_depth(
        &self,
        task: &ScheduledTask,
        pipeline_depth: usize,
    ) -> TaskExecutionRecord {
        let mut record = TaskExecutionRecord::begin(task, 0);
        match self.try_execute_action(&task.action, pipeline_depth) {
            Ok(result) => record.complete(result),
            Err(error) => record.fail(error.to_string()),
        }
        record
    }

    pub fn execute_with_retry(
        &self,
        task: &ScheduledTask,
        policy: &RetryPolicy,
    ) -> TaskExecutionRecord {
        let mut record = self.execute_task(task);
        if record.status != ExecutionStatus::Completed && policy.max_retries > 0 {
            let original = record
                .error
                .take()
                .unwrap_or_else(|| "task failed".to_string());
            record.error = Some(format!(
                "{original}; retries require the managed asynchronous dispatcher"
            ));
        }
        record
    }

    /// Execute with bounded retry delays and cooperative cancellation.
    pub async fn execute_controlled(
        &self,
        task: &ScheduledTask,
        control: &ExecutionControl,
    ) -> TaskExecutionRecord {
        let default_policy = RetryPolicy {
            max_retries: 0,
            ..RetryPolicy::default()
        };
        let policy = task.retry_policy.as_ref().unwrap_or(&default_policy);
        let mut delay_ms = policy.retry_delay_ms;

        for attempt in 0..=policy.max_retries {
            let mut record = TaskExecutionRecord::begin(task, attempt);
            if control.is_cancelled() {
                record.cancel();
                return record;
            }
            match self
                .try_execute_action_controlled(&task.action, 0, control)
                .await
            {
                Ok(result) => {
                    if control.finish() {
                        record.complete(result);
                    } else {
                        record.cancel();
                    }
                    return record;
                }
                Err(_) if control.is_cancelled() => {
                    record.cancel();
                    return record;
                }
                Err(error) if attempt == policy.max_retries => {
                    control.finish();
                    record.fail(error.to_string());
                    return record;
                }
                Err(_) => {
                    let bounded_delay = delay_ms.min(policy.max_delay_ms);
                    if !control.sleep(Duration::from_millis(bounded_delay)).await {
                        record.cancel();
                        return record;
                    }
                    delay_ms = ((bounded_delay as f64) * policy.backoff_multiplier)
                        .min(policy.max_delay_ms as f64) as u64;
                }
            }
        }

        let mut record = TaskExecutionRecord::begin(task, policy.max_retries);
        control.finish();
        record.fail("retry execution ended without a result");
        record
    }

    pub fn execute_pipeline(&self, steps: &[PipelineStep]) -> Vec<TaskExecutionRecord> {
        self.execute_pipeline_at_depth(steps, 0)
    }

    fn execute_pipeline_at_depth(
        &self,
        steps: &[PipelineStep],
        pipeline_depth: usize,
    ) -> Vec<TaskExecutionRecord> {
        if steps.len() > MAX_PIPELINE_STEPS || pipeline_depth > MAX_PIPELINE_DEPTH {
            let task = pipeline_task(0, TaskAction::Pipeline { steps: Vec::new() }, false);
            let mut record = TaskExecutionRecord::begin(&task, 0);
            record.fail("pipeline exceeds the configured size or nesting limit");
            return vec![record];
        }
        let mut records = Vec::with_capacity(steps.len());
        for (index, step) in steps.iter().enumerate() {
            let pseudo_task = pipeline_task(index, step.action.clone(), false);
            let record = if step.delay_ms.unwrap_or(0) > 0 {
                let mut delayed = TaskExecutionRecord::begin(&pseudo_task, 0);
                delayed.fail("pipeline delays require the managed asynchronous dispatcher");
                delayed
            } else {
                self.execute_task_at_depth(&pseudo_task, pipeline_depth)
            };
            let failed = record.status == ExecutionStatus::Failed;
            records.push(record);
            if failed && !step.continue_on_error {
                for (offset, remaining) in steps[index + 1..].iter().enumerate() {
                    let skipped_task =
                        pipeline_task(index + 1 + offset, remaining.action.clone(), true);
                    let mut skipped = TaskExecutionRecord::begin(&skipped_task, 0);
                    skipped.status = ExecutionStatus::Skipped;
                    skipped.completed_at = Some(Utc::now());
                    records.push(skipped);
                }
                break;
            }
        }
        records
    }

    pub fn check_conditions(&self, conditions: &[TaskCondition]) -> bool {
        conditions
            .iter()
            .all(|condition| self.evaluate_condition(condition))
    }

    pub fn evaluate_condition(&self, condition: &TaskCondition) -> bool {
        match condition {
            TaskCondition::ConnectionOnline { .. } | TaskCondition::ConnectionOffline { .. } => {
                false
            }
            TaskCondition::TimeWindow { start, end } => {
                let Ok(start) = NaiveTime::parse_from_str(start, "%H:%M") else {
                    return false;
                };
                let Ok(end) = NaiveTime::parse_from_str(end, "%H:%M") else {
                    return false;
                };
                let now = Utc::now().time();
                if start <= end {
                    now >= start && now <= end
                } else {
                    now >= start || now <= end
                }
            }
            TaskCondition::DayOfWeek { days } => {
                let today = Weekday::from_chrono(Utc::now().weekday());
                days.contains(&today)
            }
            TaskCondition::Custom { .. } => false,
        }
    }

    fn try_execute_action(
        &self,
        action: &TaskAction,
        pipeline_depth: usize,
    ) -> Result<Option<serde_json::Value>, SchedulerError> {
        match action {
            TaskAction::SendWakeOnLan { mac_address, port } => {
                send_wake_on_lan(mac_address, port.unwrap_or(9))?;
                Ok(Some(serde_json::json!({
                    "action": "wake_on_lan",
                    "delivered": true,
                })))
            }
            TaskAction::Pipeline { steps } => {
                if pipeline_depth >= MAX_PIPELINE_DEPTH || steps.len() > MAX_PIPELINE_STEPS {
                    return Err(SchedulerError::ExecutionError(
                        "pipeline exceeds its size or nesting limit".to_string(),
                    ));
                }
                let records = self.execute_pipeline_at_depth(steps, pipeline_depth + 1);
                if records
                    .iter()
                    .all(|record| record.status == ExecutionStatus::Completed)
                {
                    Ok(Some(serde_json::json!({
                        "action": "pipeline",
                        "steps_completed": records.len(),
                    })))
                } else {
                    Err(SchedulerError::ExecutionError(
                        "pipeline step failed or was skipped".to_string(),
                    ))
                }
            }
            _ => Err(SchedulerError::ExecutionError(format!(
                "scheduled {} action is not wired to a runtime dispatcher",
                action_name(action)
            ))),
        }
    }

    fn try_execute_action_controlled<'a>(
        &'a self,
        action: &'a TaskAction,
        pipeline_depth: usize,
        control: &'a ExecutionControl,
    ) -> Pin<Box<dyn Future<Output = Result<Option<serde_json::Value>, SchedulerError>> + Send + 'a>>
    {
        Box::pin(async move {
            if control.is_cancelled() {
                return Err(SchedulerError::ExecutionError(
                    "task was cancelled".to_string(),
                ));
            }
            match action {
                TaskAction::SendWakeOnLan { mac_address, port } => {
                    if !control.begin_side_effect() {
                        return Err(SchedulerError::ExecutionError(
                            "task was cancelled".to_string(),
                        ));
                    }
                    let result = send_wake_on_lan(mac_address, port.unwrap_or(9));
                    control.end_side_effect();
                    result?;
                    Ok(Some(serde_json::json!({
                        "action": "wake_on_lan",
                        "delivered": true,
                    })))
                }
                TaskAction::Pipeline { steps } => {
                    if pipeline_depth >= MAX_PIPELINE_DEPTH || steps.len() > MAX_PIPELINE_STEPS {
                        return Err(SchedulerError::ExecutionError(
                            "pipeline exceeds its size or nesting limit".to_string(),
                        ));
                    }
                    let mut completed = 0usize;
                    let mut failed = 0usize;
                    for step in steps {
                        if let Some(delay_ms) = step.delay_ms.filter(|delay| *delay > 0) {
                            if !control.sleep(Duration::from_millis(delay_ms)).await {
                                return Err(SchedulerError::ExecutionError(
                                    "task was cancelled".to_string(),
                                ));
                            }
                        }
                        match self
                            .try_execute_action_controlled(
                                &step.action,
                                pipeline_depth + 1,
                                control,
                            )
                            .await
                        {
                            Ok(_) => completed = completed.saturating_add(1),
                            Err(error) if control.is_cancelled() => return Err(error),
                            Err(error) if !step.continue_on_error => return Err(error),
                            Err(_) => failed = failed.saturating_add(1),
                        }
                    }
                    if failed > 0 {
                        Err(SchedulerError::PipelineError(format!(
                            "pipeline completed with {failed} failed step(s)"
                        )))
                    } else {
                        Ok(Some(serde_json::json!({
                            "action": "pipeline",
                            "steps_completed": completed,
                        })))
                    }
                }
                _ => Err(SchedulerError::ExecutionError(format!(
                    "scheduled {} action is not wired to a runtime dispatcher",
                    action_name(action)
                ))),
            }
        })
    }
}

fn pipeline_task(index: usize, action: TaskAction, skipped: bool) -> ScheduledTask {
    let now = Utc::now();
    ScheduledTask {
        id: format!("pipeline-step-{index}"),
        name: if skipped {
            format!("Pipeline step {index} (skipped)")
        } else {
            format!("Pipeline step {index}")
        },
        description: String::new(),
        enabled: true,
        schedule: TaskSchedule::Once { at: now },
        action,
        conditions: Vec::new(),
        retry_policy: None,
        timeout_ms: None,
        tags: Vec::new(),
        priority: TaskPriority::Normal,
        created_at: now,
        updated_at: now,
        last_run_at: None,
        next_run_at: None,
        run_count: 0,
        fail_count: 0,
    }
}

fn action_name(action: &TaskAction) -> &'static str {
    match action {
        TaskAction::ConnectConnection { .. } => "connect",
        TaskAction::DisconnectConnection { .. } => "disconnect",
        TaskAction::ExecuteScript { .. } => "script",
        TaskAction::RunDiagnostics { .. } => "diagnostics",
        TaskAction::SendWakeOnLan { .. } => "wake-on-LAN",
        TaskAction::BackupCollection { .. } => "backup",
        TaskAction::SyncCloud => "cloud-sync",
        TaskAction::RunHealthCheck { .. } => "health-check",
        TaskAction::HttpRequest { .. } => "HTTP-request",
        TaskAction::ExecuteCommand { .. } => "command",
        TaskAction::GenerateReport { .. } => "report",
        TaskAction::Pipeline { .. } => "pipeline",
        TaskAction::Notify { .. } => "notification",
    }
}

fn send_wake_on_lan(mac_address: &str, port: u16) -> Result<(), SchedulerError> {
    if port == 0 {
        return Err(SchedulerError::ExecutionError(
            "wake-on-LAN port must be nonzero".to_string(),
        ));
    }
    let compact: String = mac_address
        .chars()
        .filter(|character| !matches!(character, ':' | '-'))
        .collect();
    if compact.len() != 12 || !compact.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(SchedulerError::ExecutionError(
            "wake-on-LAN MAC address is invalid".to_string(),
        ));
    }
    let mut mac = [0_u8; 6];
    for (index, slot) in mac.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&compact[index * 2..index * 2 + 2], 16).map_err(|_| {
            SchedulerError::ExecutionError("wake-on-LAN MAC address is invalid".to_string())
        })?;
    }
    let mut packet = [0_u8; 102];
    packet[..6].fill(0xff);
    for chunk in packet[6..].chunks_exact_mut(6) {
        chunk.copy_from_slice(&mac);
    }
    let socket = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|_| SchedulerError::ExecutionError("wake-on-LAN socket failed".to_string()))?;
    socket
        .set_broadcast(true)
        .map_err(|_| SchedulerError::ExecutionError("wake-on-LAN broadcast failed".to_string()))?;
    let sent = socket
        .send_to(&packet, SocketAddrV4::new(Ipv4Addr::BROADCAST, port))
        .map_err(|_| SchedulerError::ExecutionError("wake-on-LAN send failed".to_string()))?;
    if sent != packet.len() {
        return Err(SchedulerError::ExecutionError(
            "wake-on-LAN packet was only partially sent".to_string(),
        ));
    }
    Ok(())
}

impl Default for TaskExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_task(action: TaskAction) -> ScheduledTask {
        ScheduledTask::new("test-task", TaskSchedule::Once { at: Utc::now() }, action)
    }

    #[test]
    fn execute_connect_fails_closed() {
        let executor = TaskExecutor::new();
        let task = sample_task(TaskAction::ConnectConnection {
            connection_id: "c1".into(),
        });
        let record = executor.execute_task(&task);
        assert_eq!(record.status, ExecutionStatus::Failed);
        assert!(record.result.is_none());
    }

    #[test]
    fn execute_pipeline_stops_on_unsupported_action() {
        let executor = TaskExecutor::new();
        let steps = vec![
            PipelineStep {
                action: TaskAction::SyncCloud,
                continue_on_error: false,
                delay_ms: None,
            },
            PipelineStep {
                action: TaskAction::Notify {
                    channel: "email".into(),
                    message: "done".into(),
                },
                continue_on_error: false,
                delay_ms: None,
            },
        ];
        let records = executor.execute_pipeline(&steps);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].status, ExecutionStatus::Failed);
        assert_eq!(records[1].status, ExecutionStatus::Skipped);
    }

    #[test]
    fn conditions_day_of_week() {
        let executor = TaskExecutor::new();
        let today = Weekday::from_chrono(Utc::now().weekday());
        let condition = TaskCondition::DayOfWeek { days: vec![today] };
        assert!(executor.evaluate_condition(&condition));
    }

    #[test]
    fn retry_does_not_fabricate_success() {
        let executor = TaskExecutor::new();
        let task = sample_task(TaskAction::SyncCloud);
        let policy = RetryPolicy::default();
        let record = executor.execute_with_retry(&task, &policy);
        assert_eq!(record.status, ExecutionStatus::Failed);
        assert_eq!(record.retry_attempt, 0);
        assert!(record
            .error
            .unwrap()
            .contains("managed asynchronous dispatcher"));
    }
}
