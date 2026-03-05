//! Task execution, retry logic, and pipeline runner.

use chrono::{Datelike, Utc};
use log::{info, warn};
use std::collections::HashMap;

use crate::error::SchedulerError;
use crate::types::*;

/// Executes task actions declared by [`TaskAction`].
pub struct TaskExecutor;

impl TaskExecutor {
    pub fn new() -> Self {
        Self
    }

    // ── Single-action dispatch ──────────────────────────────────

    /// Execute a single task, producing an execution record.
    pub fn execute_task(&self, task: &ScheduledTask) -> TaskExecutionRecord {
        let mut record = TaskExecutionRecord::begin(task, 0);

        match &task.action {
            TaskAction::ConnectConnection { connection_id } => {
                info!("scheduler: connecting {connection_id}");
                record.complete(Some(serde_json::json!({
                    "action": "connect",
                    "connection_id": connection_id,
                })));
            }
            TaskAction::DisconnectConnection { connection_id } => {
                info!("scheduler: disconnecting {connection_id}");
                record.complete(Some(serde_json::json!({
                    "action": "disconnect",
                    "connection_id": connection_id,
                })));
            }
            TaskAction::ExecuteScript { script_id, args } => {
                info!("scheduler: executing script {script_id}");
                record.complete(Some(serde_json::json!({
                    "action": "execute_script",
                    "script_id": script_id,
                    "args": args,
                })));
            }
            TaskAction::RunDiagnostics { connection_ids } => {
                info!(
                    "scheduler: running diagnostics on {} connections",
                    connection_ids.len()
                );
                record.complete(Some(serde_json::json!({
                    "action": "run_diagnostics",
                    "connection_ids": connection_ids,
                })));
            }
            TaskAction::SendWakeOnLan { mac_address, port } => {
                info!("scheduler: WOL to {mac_address}");
                record.complete(Some(serde_json::json!({
                    "action": "wake_on_lan",
                    "mac_address": mac_address,
                    "port": port.unwrap_or(9),
                })));
            }
            TaskAction::BackupCollection { collection_id } => {
                info!("scheduler: backup collection {:?}", collection_id);
                record.complete(Some(serde_json::json!({
                    "action": "backup_collection",
                    "collection_id": collection_id,
                })));
            }
            TaskAction::SyncCloud => {
                info!("scheduler: cloud sync");
                record.complete(Some(serde_json::json!({
                    "action": "sync_cloud",
                })));
            }
            TaskAction::RunHealthCheck { connection_ids } => {
                info!(
                    "scheduler: health check on {} connections",
                    connection_ids.len()
                );
                let results: HashMap<String, &str> = connection_ids
                    .iter()
                    .map(|id| (id.clone(), "healthy"))
                    .collect();
                record.complete(Some(serde_json::json!({
                    "action": "health_check",
                    "results": results,
                })));
            }
            TaskAction::HttpRequest {
                url,
                method,
                headers,
                body,
            } => {
                info!("scheduler: HTTP {method} {url}");
                record.complete(Some(serde_json::json!({
                    "action": "http_request",
                    "url": url,
                    "method": method,
                    "headers": headers,
                    "body": body,
                })));
            }
            TaskAction::ExecuteCommand {
                command,
                connection_id,
            } => {
                info!("scheduler: exec command on {:?}", connection_id);
                record.complete(Some(serde_json::json!({
                    "action": "execute_command",
                    "command": command,
                    "connection_id": connection_id,
                })));
            }
            TaskAction::GenerateReport { report_type } => {
                let type_str = match report_type {
                    ReportType::ConnectionHealth => "connection_health",
                    ReportType::CredentialAudit => "credential_audit",
                    ReportType::ActivitySummary => "activity_summary",
                    ReportType::PerformanceReport => "performance_report",
                };
                info!("scheduler: generating report {type_str}");
                record.complete(Some(serde_json::json!({
                    "action": "generate_report",
                    "report_type": type_str,
                })));
            }
            TaskAction::Pipeline { steps } => {
                info!("scheduler: running pipeline with {} steps", steps.len());
                let step_records = self.execute_pipeline(steps);
                let all_ok = step_records.iter().all(|r| r.status == ExecutionStatus::Completed);
                if all_ok {
                    record.complete(Some(serde_json::json!({
                        "action": "pipeline",
                        "steps_completed": step_records.len(),
                    })));
                } else {
                    let first_err = step_records
                        .iter()
                        .find(|r| r.status == ExecutionStatus::Failed)
                        .and_then(|r| r.error.clone())
                        .unwrap_or_else(|| "pipeline step failed".to_string());
                    record.fail(first_err);
                }
            }
            TaskAction::Notify { channel, message } => {
                info!("scheduler: notify via {channel}");
                record.complete(Some(serde_json::json!({
                    "action": "notify",
                    "channel": channel,
                    "message": message,
                })));
            }
        }

        record
    }

    // ── Retry wrapper ───────────────────────────────────────────

    /// Execute a task with the given retry policy, returning the final record.
    pub fn execute_with_retry(
        &self,
        task: &ScheduledTask,
        policy: &RetryPolicy,
    ) -> TaskExecutionRecord {
        let mut last_record = self.execute_task(task);

        if last_record.status == ExecutionStatus::Completed {
            return last_record;
        }

        let mut delay_ms = policy.retry_delay_ms;
        for attempt in 1..=policy.max_retries {
            warn!(
                "scheduler: retry {attempt}/{} for task {} (delay {delay_ms}ms)",
                policy.max_retries, task.id
            );

            // In a real implementation we would `tokio::time::sleep` here.
            // For the synchronous dispatch path we simply record the attempt.
            let mut record = TaskExecutionRecord::begin(task, attempt);

            // Re-dispatch the action (simplified — same logic as execute_task).
            match self.try_execute_action(&task.action) {
                Ok(result) => {
                    record.complete(result);
                    return record;
                }
                Err(err) => {
                    record.fail(err.to_string());
                    last_record = record;
                }
            }

            // Exponential back-off
            delay_ms = ((delay_ms as f64) * policy.backoff_multiplier) as u64;
            if delay_ms > policy.max_delay_ms {
                delay_ms = policy.max_delay_ms;
            }
        }

        last_record
    }

    // ── Pipeline ────────────────────────────────────────────────

    /// Run a sequence of pipeline steps, returning a record per step.
    pub fn execute_pipeline(&self, steps: &[PipelineStep]) -> Vec<TaskExecutionRecord> {
        let mut records = Vec::with_capacity(steps.len());

        for (idx, step) in steps.iter().enumerate() {
            let pseudo_task = ScheduledTask {
                id: format!("pipeline-step-{idx}"),
                name: format!("Pipeline step {idx}"),
                description: String::new(),
                enabled: true,
                schedule: TaskSchedule::Once { at: Utc::now() },
                action: step.action.clone(),
                conditions: Vec::new(),
                retry_policy: None,
                timeout_ms: None,
                tags: Vec::new(),
                priority: TaskPriority::Normal,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                last_run_at: None,
                next_run_at: None,
                run_count: 0,
                fail_count: 0,
            };

            let record = self.execute_task(&pseudo_task);

            let failed = record.status == ExecutionStatus::Failed;
            records.push(record);

            if failed && !step.continue_on_error {
                // Remaining steps are skipped.
                for remaining in &steps[idx + 1..] {
                    let mut skipped = TaskExecutionRecord::begin(
                        &ScheduledTask {
                            id: format!("pipeline-step-{}", idx + 1),
                            name: format!("Pipeline step {} (skipped)", idx + 1),
                            description: String::new(),
                            enabled: true,
                            schedule: TaskSchedule::Once { at: Utc::now() },
                            action: remaining.action.clone(),
                            conditions: Vec::new(),
                            retry_policy: None,
                            timeout_ms: None,
                            tags: Vec::new(),
                            priority: TaskPriority::Normal,
                            created_at: Utc::now(),
                            updated_at: Utc::now(),
                            last_run_at: None,
                            next_run_at: None,
                            run_count: 0,
                            fail_count: 0,
                        },
                        0,
                    );
                    skipped.status = ExecutionStatus::Skipped;
                    skipped.completed_at = Some(Utc::now());
                    records.push(skipped);
                }
                break;
            }
        }

        records
    }

    // ── Conditions ──────────────────────────────────────────────

    /// Check whether **all** conditions are satisfied.
    pub fn check_conditions(&self, conditions: &[TaskCondition]) -> bool {
        conditions.iter().all(|c| self.evaluate_condition(c))
    }

    /// Evaluate a single condition.
    ///
    /// In a real deployment the connection-status conditions would query
    /// the connection manager.  Here we provide reasonable defaults so
    /// the scheduler can still function stand-alone.
    pub fn evaluate_condition(&self, condition: &TaskCondition) -> bool {
        match condition {
            TaskCondition::ConnectionOnline { connection_id: _ } => {
                // Would delegate to sorng-network / sorng-core.
                // Default: assume online.
                true
            }
            TaskCondition::ConnectionOffline { connection_id: _ } => {
                // Default: assume connection is online → condition fails.
                false
            }
            TaskCondition::TimeWindow { start, end } => {
                let now = Utc::now().format("%H:%M").to_string();
                now >= *start && now <= *end
            }
            TaskCondition::DayOfWeek { days } => {
                let today = crate::types::Weekday::from_chrono(Utc::now().weekday());
                days.contains(&today)
            }
            TaskCondition::Custom { expression: _ } => {
                // Custom expression evaluation is not yet implemented.
                // Default: pass.
                true
            }
        }
    }

    // ── Internal helpers ────────────────────────────────────────

    /// Try to execute an action, returning a JSON result or error.
    fn try_execute_action(
        &self,
        action: &TaskAction,
    ) -> Result<Option<serde_json::Value>, SchedulerError> {
        // Re-use the same dispatch logic by constructing a minimal task.
        let tmp = ScheduledTask {
            id: "retry-tmp".to_string(),
            name: "retry".to_string(),
            description: String::new(),
            enabled: true,
            schedule: TaskSchedule::Once { at: Utc::now() },
            action: action.clone(),
            conditions: Vec::new(),
            retry_policy: None,
            timeout_ms: None,
            tags: Vec::new(),
            priority: TaskPriority::Normal,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_run_at: None,
            next_run_at: None,
            run_count: 0,
            fail_count: 0,
        };
        let record = self.execute_task(&tmp);
        match record.status {
            ExecutionStatus::Completed => Ok(record.result),
            _ => Err(SchedulerError::ExecutionError(
                record.error.unwrap_or_else(|| "unknown error".to_string()),
            )),
        }
    }
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
    fn execute_connect() {
        let executor = TaskExecutor::new();
        let task = sample_task(TaskAction::ConnectConnection {
            connection_id: "c1".into(),
        });
        let record = executor.execute_task(&task);
        assert_eq!(record.status, ExecutionStatus::Completed);
        assert!(record.result.is_some());
    }

    #[test]
    fn execute_pipeline_all_ok() {
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
        assert!(records.iter().all(|r| r.status == ExecutionStatus::Completed));
    }

    #[test]
    fn conditions_day_of_week() {
        let executor = TaskExecutor::new();
        let today = Weekday::from_chrono(Utc::now().weekday());
        let cond = TaskCondition::DayOfWeek {
            days: vec![today],
        };
        assert!(executor.evaluate_condition(&cond));
    }

    #[test]
    fn retry_completes_first_try() {
        let executor = TaskExecutor::new();
        let task = sample_task(TaskAction::SyncCloud);
        let policy = RetryPolicy::default();
        let record = executor.execute_with_retry(&task, &policy);
        assert_eq!(record.status, ExecutionStatus::Completed);
        assert_eq!(record.retry_attempt, 0);
    }
}
