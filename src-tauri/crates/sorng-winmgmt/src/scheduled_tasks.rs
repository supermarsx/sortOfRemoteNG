//! Remote Scheduled Task management via WMI/CIM.
//!
//! Provides operations for listing, inspecting, enabling, disabling,
//! running, and stopping scheduled tasks on remote Windows hosts
//! using CIM MSFT_ScheduledTask and related classes.

use crate::transport::WmiTransport;
use crate::types::*;
use crate::wql::{WqlBuilder, WqlQueries};
use log::{debug, info};
use std::collections::HashMap;

/// Manages remote Windows Scheduled Tasks via WMI/CIM.
pub struct ScheduledTaskManager;

impl ScheduledTaskManager {
    // ─── Query ───────────────────────────────────────────────────────

    /// List all scheduled tasks.
    /// Note: Uses the `root\Microsoft\Windows\TaskScheduler` namespace.
    pub async fn list_tasks(
        transport: &mut WmiTransport,
    ) -> Result<Vec<ScheduledTask>, String> {
        let query = WqlQueries::scheduled_tasks();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_task(r)).collect())
    }

    /// Get a specific task by path and name.
    pub async fn get_task(
        transport: &mut WmiTransport,
        task_path: &str,
        task_name: &str,
    ) -> Result<ScheduledTask, String> {
        let query = WqlQueries::scheduled_task(task_path, task_name);
        let rows = transport.wql_query(&query).await?;
        let row = rows
            .first()
            .ok_or_else(|| format!("Scheduled task '{}{}' not found", task_path, task_name))?;
        Ok(Self::row_to_task(row))
    }

    /// Search tasks by name pattern.
    pub async fn search_tasks(
        transport: &mut WmiTransport,
        pattern: &str,
    ) -> Result<Vec<ScheduledTask>, String> {
        let query = WqlBuilder::select("MSFT_ScheduledTask")
            .where_like("TaskName", &format!("%{}%", pattern))
            .build();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_task(r)).collect())
    }

    /// List tasks in a specific folder/path.
    pub async fn tasks_in_folder(
        transport: &mut WmiTransport,
        folder_path: &str,
    ) -> Result<Vec<ScheduledTask>, String> {
        let query = WqlBuilder::select("MSFT_ScheduledTask")
            .where_eq("TaskPath", folder_path)
            .build();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_task(r)).collect())
    }

    /// List tasks by state.
    pub async fn tasks_by_state(
        transport: &mut WmiTransport,
        state: &ScheduledTaskState,
    ) -> Result<Vec<ScheduledTask>, String> {
        let state_val = match state {
            ScheduledTaskState::Disabled => 1,
            ScheduledTaskState::Queued => 2,
            ScheduledTaskState::Ready => 3,
            ScheduledTaskState::Running => 4,
            ScheduledTaskState::Unknown => return Ok(Vec::new()),
        };

        let query = WqlBuilder::select("MSFT_ScheduledTask")
            .where_eq_num("State", state_val)
            .build();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_task(r)).collect())
    }

    // ─── Control ─────────────────────────────────────────────────────

    /// Enable a scheduled task.
    pub async fn enable_task(
        transport: &mut WmiTransport,
        task_path: &str,
        task_name: &str,
    ) -> Result<(), String> {
        info!("Enabling scheduled task '{}{}' ", task_path, task_name);

        let result = transport
            .invoke_method(
                "MSFT_ScheduledTask",
                "Enable",
                Some(&[("TaskPath", task_path), ("TaskName", task_name)]),
                &HashMap::new(),
            )
            .await?;

        Self::check_return(&result, "Enable")
    }

    /// Disable a scheduled task.
    pub async fn disable_task(
        transport: &mut WmiTransport,
        task_path: &str,
        task_name: &str,
    ) -> Result<(), String> {
        info!("Disabling scheduled task '{}{}'", task_path, task_name);

        let result = transport
            .invoke_method(
                "MSFT_ScheduledTask",
                "Disable",
                Some(&[("TaskPath", task_path), ("TaskName", task_name)]),
                &HashMap::new(),
            )
            .await?;

        Self::check_return(&result, "Disable")
    }

    /// Run a scheduled task immediately.
    pub async fn run_task(
        transport: &mut WmiTransport,
        task_path: &str,
        task_name: &str,
    ) -> Result<(), String> {
        info!("Running scheduled task '{}{}'", task_path, task_name);

        let result = transport
            .invoke_method(
                "MSFT_ScheduledTask",
                "Run",
                Some(&[("TaskPath", task_path), ("TaskName", task_name)]),
                &HashMap::new(),
            )
            .await?;

        Self::check_return(&result, "Run")
    }

    /// Stop a currently running scheduled task.
    pub async fn stop_task(
        transport: &mut WmiTransport,
        task_path: &str,
        task_name: &str,
    ) -> Result<(), String> {
        info!("Stopping scheduled task '{}{}'", task_path, task_name);

        let result = transport
            .invoke_method(
                "MSFT_ScheduledTask",
                "Stop",
                Some(&[("TaskPath", task_path), ("TaskName", task_name)]),
                &HashMap::new(),
            )
            .await?;

        Self::check_return(&result, "Stop")
    }

    /// Unregister (delete) a scheduled task.
    pub async fn unregister_task(
        transport: &mut WmiTransport,
        task_path: &str,
        task_name: &str,
    ) -> Result<(), String> {
        info!("Unregistering scheduled task '{}{}'", task_path, task_name);

        let result = transport
            .invoke_method(
                "MSFT_ScheduledTask",
                "Unregister",
                Some(&[("TaskPath", task_path), ("TaskName", task_name)]),
                &HashMap::new(),
            )
            .await?;

        Self::check_return(&result, "Unregister")
    }

    // ─── Task Details ────────────────────────────────────────────────

    /// Get task actions (via MSFT_TaskAction associated instances).
    pub async fn get_task_actions(
        transport: &mut WmiTransport,
        task_path: &str,
        task_name: &str,
    ) -> Result<Vec<ScheduledTaskAction>, String> {
        // Query associated MSFT_TaskExecAction instances
        let query = format!(
            "SELECT * FROM MSFT_TaskExecAction WHERE TaskPath = '{}' AND TaskName = '{}'",
            task_path.replace('\'', "\\'"),
            task_name.replace('\'', "\\'")
        );

        match transport.wql_query(&query).await {
            Ok(rows) => Ok(rows.iter().map(|r| Self::row_to_action(r)).collect()),
            Err(_) => {
                // Fallback: return empty actions if the class is not available
                debug!("MSFT_TaskExecAction not available, returning empty actions");
                Ok(Vec::new())
            }
        }
    }

    /// Get task triggers (via MSFT_TaskTrigger associated instances).
    pub async fn get_task_triggers(
        transport: &mut WmiTransport,
        task_path: &str,
        task_name: &str,
    ) -> Result<Vec<ScheduledTaskTrigger>, String> {
        let query = format!(
            "SELECT * FROM MSFT_TaskTrigger WHERE TaskPath = '{}' AND TaskName = '{}'",
            task_path.replace('\'', "\\'"),
            task_name.replace('\'', "\\'")
        );

        match transport.wql_query(&query).await {
            Ok(rows) => Ok(rows.iter().map(|r| Self::row_to_trigger(r)).collect()),
            Err(_) => {
                debug!("MSFT_TaskTrigger not available, returning empty triggers");
                Ok(Vec::new())
            }
        }
    }

    /// Get full task details including actions and triggers.
    pub async fn get_task_full(
        transport: &mut WmiTransport,
        task_path: &str,
        task_name: &str,
    ) -> Result<ScheduledTask, String> {
        let mut task = Self::get_task(transport, task_path, task_name).await?;
        task.actions = Self::get_task_actions(transport, task_path, task_name)
            .await
            .unwrap_or_default();
        task.triggers = Self::get_task_triggers(transport, task_path, task_name)
            .await
            .unwrap_or_default();
        Ok(task)
    }

    // ─── Statistics ──────────────────────────────────────────────────

    /// Get task counts by state.
    pub async fn task_statistics(
        transport: &mut WmiTransport,
    ) -> Result<HashMap<String, u32>, String> {
        let tasks = Self::list_tasks(transport).await?;

        let mut stats = HashMap::new();
        stats.insert("total".to_string(), tasks.len() as u32);

        let mut by_state: HashMap<String, u32> = HashMap::new();
        for task in &tasks {
            let state_name = match task.state {
                ScheduledTaskState::Ready => "ready",
                ScheduledTaskState::Running => "running",
                ScheduledTaskState::Disabled => "disabled",
                ScheduledTaskState::Queued => "queued",
                ScheduledTaskState::Unknown => "unknown",
            };
            *by_state.entry(state_name.to_string()).or_insert(0) += 1;
        }

        stats.extend(by_state);

        // Count tasks with failed last result
        let failed = tasks
            .iter()
            .filter(|t| t.last_task_result.map(|r| r != 0).unwrap_or(false))
            .count() as u32;
        stats.insert("failed_last_run".to_string(), failed);

        Ok(stats)
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    /// Convert a WMI result row to a ScheduledTask.
    fn row_to_task(row: &HashMap<String, String>) -> ScheduledTask {
        let get = |key: &str| row.get(key).cloned();
        let get_or = |key: &str, default: &str| {
            row.get(key).cloned().unwrap_or_else(|| default.to_string())
        };

        let state = row
            .get("State")
            .and_then(|v| v.parse::<u32>().ok())
            .map(ScheduledTaskState::from_value)
            .unwrap_or(ScheduledTaskState::Unknown);

        let last_run_time = row
            .get("LastRunTime")
            .and_then(|v| crate::transport::parse_wmi_datetime(v));
        let next_run_time = row
            .get("NextRunTime")
            .and_then(|v| crate::transport::parse_wmi_datetime(v));

        ScheduledTask {
            task_name: get_or("TaskName", ""),
            task_path: get_or("TaskPath", "\\"),
            state,
            description: get("Description"),
            author: get("Author"),
            date: get("Date"),
            uri: get("URI"),
            last_run_time,
            last_task_result: row.get("LastTaskResult").and_then(|v| v.parse().ok()),
            next_run_time,
            number_of_missed_runs: row
                .get("NumberOfMissedRuns")
                .and_then(|v| v.parse().ok()),
            actions: Vec::new(),   // populated separately
            triggers: Vec::new(),  // populated separately
            principal: None,       // populated separately
        }
    }

    /// Convert a WMI row to a ScheduledTaskAction.
    fn row_to_action(row: &HashMap<String, String>) -> ScheduledTaskAction {
        ScheduledTaskAction {
            action_type: row
                .get("ActionType")
                .or_else(|| row.get("Type"))
                .cloned()
                .unwrap_or_else(|| "Execute".to_string()),
            execute: row.get("Execute").or_else(|| row.get("Path")).cloned(),
            arguments: row.get("Arguments").cloned(),
            working_directory: row.get("WorkingDirectory").cloned(),
        }
    }

    /// Convert a WMI row to a ScheduledTaskTrigger.
    fn row_to_trigger(row: &HashMap<String, String>) -> ScheduledTaskTrigger {
        ScheduledTaskTrigger {
            trigger_type: row
                .get("TriggerType")
                .or_else(|| row.get("Type"))
                .cloned()
                .unwrap_or_else(|| "Unknown".to_string()),
            enabled: row
                .get("Enabled")
                .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
                .unwrap_or(true),
            start_boundary: row.get("StartBoundary").cloned(),
            end_boundary: row.get("EndBoundary").cloned(),
            repetition_interval: row.get("RepetitionInterval").cloned(),
            repetition_duration: row.get("RepetitionDuration").cloned(),
        }
    }

    /// Check the ReturnValue from a method call.
    fn check_return(result: &HashMap<String, String>, method: &str) -> Result<(), String> {
        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0); // CIM methods often don't return a value on success

        if return_value == 0 {
            Ok(())
        } else {
            Err(format!(
                "Scheduled task {} failed: error code {}",
                method, return_value
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_row_to_task() {
        let mut row = HashMap::new();
        row.insert("TaskName".to_string(), "MyTask".to_string());
        row.insert("TaskPath".to_string(), "\\MyFolder\\".to_string());
        row.insert("State".to_string(), "3".to_string());
        row.insert("Description".to_string(), "Test task".to_string());
        row.insert("Author".to_string(), "admin".to_string());

        let task = ScheduledTaskManager::row_to_task(&row);
        assert_eq!(task.task_name, "MyTask");
        assert_eq!(task.task_path, "\\MyFolder\\");
        assert_eq!(task.state, ScheduledTaskState::Ready);
        assert_eq!(task.description.as_deref(), Some("Test task"));
    }

    #[test]
    fn test_state_from_value() {
        assert_eq!(ScheduledTaskState::from_value(1), ScheduledTaskState::Disabled);
        assert_eq!(ScheduledTaskState::from_value(3), ScheduledTaskState::Ready);
        assert_eq!(ScheduledTaskState::from_value(4), ScheduledTaskState::Running);
        assert_eq!(ScheduledTaskState::from_value(99), ScheduledTaskState::Unknown);
    }
}
