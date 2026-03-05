//! Tauri command handlers for the scheduler.
//!
//! Each command follows the `sched_*` naming convention and delegates
//! to [`SchedulerService`].

use chrono::{DateTime, Utc};
use tauri::State;

use crate::service::SchedulerServiceState;
use crate::types::*;

/// Helper to map SchedulerError → String for Tauri command results.
fn err_str(e: crate::error::SchedulerError) -> String {
    e.to_string()
}

// ─── Task CRUD ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn sched_add_task(
    state: State<'_, SchedulerServiceState>,
    task: ScheduledTask,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.add_task(task).map_err(err_str)
}

#[tauri::command]
pub async fn sched_remove_task(
    state: State<'_, SchedulerServiceState>,
    task_id: String,
) -> Result<ScheduledTask, String> {
    let mut svc = state.lock().await;
    svc.remove_task(&task_id).map_err(err_str)
}

#[tauri::command]
pub async fn sched_update_task(
    state: State<'_, SchedulerServiceState>,
    task: ScheduledTask,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_task(task).map_err(err_str)
}

#[tauri::command]
pub async fn sched_get_task(
    state: State<'_, SchedulerServiceState>,
    task_id: String,
) -> Result<ScheduledTask, String> {
    let svc = state.lock().await;
    svc.get_task(&task_id).map_err(err_str)
}

#[tauri::command]
pub async fn sched_list_tasks(
    state: State<'_, SchedulerServiceState>,
) -> Result<Vec<ScheduledTask>, String> {
    let svc = state.lock().await;
    Ok(svc.list_tasks())
}

#[tauri::command]
pub async fn sched_enable_task(
    state: State<'_, SchedulerServiceState>,
    task_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.enable_task(&task_id).map_err(err_str)
}

#[tauri::command]
pub async fn sched_disable_task(
    state: State<'_, SchedulerServiceState>,
    task_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disable_task(&task_id).map_err(err_str)
}

// ─── Execution ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn sched_execute_now(
    state: State<'_, SchedulerServiceState>,
    task_id: String,
) -> Result<TaskExecutionRecord, String> {
    let mut svc = state.lock().await;
    svc.execute_now(&task_id).map_err(err_str)
}

#[tauri::command]
pub async fn sched_cancel_task(
    state: State<'_, SchedulerServiceState>,
    task_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.cancel_task(&task_id).map_err(err_str)
}

// ─── History & Upcoming ─────────────────────────────────────────────

#[tauri::command]
pub async fn sched_get_history(
    state: State<'_, SchedulerServiceState>,
    task_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<TaskExecutionRecord>, String> {
    let svc = state.lock().await;
    Ok(svc.get_history(task_id.as_deref(), limit.unwrap_or(100)))
}

#[tauri::command]
pub async fn sched_get_upcoming(
    state: State<'_, SchedulerServiceState>,
    count: Option<usize>,
) -> Result<Vec<(ScheduledTask, DateTime<Utc>)>, String> {
    let svc = state.lock().await;
    Ok(svc.get_upcoming(count.unwrap_or(10)))
}

// ─── Stats ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sched_get_stats(
    state: State<'_, SchedulerServiceState>,
) -> Result<SchedulerStats, String> {
    let svc = state.lock().await;
    Ok(svc.get_stats())
}

// ─── Config ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sched_get_config(
    state: State<'_, SchedulerServiceState>,
) -> Result<SchedulerConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

#[tauri::command]
pub async fn sched_update_config(
    state: State<'_, SchedulerServiceState>,
    config: SchedulerConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_config(config);
    Ok(())
}

// ─── Cleanup ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sched_cleanup_history(
    state: State<'_, SchedulerServiceState>,
    retention_days: Option<u64>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let days = retention_days.unwrap_or(svc.get_config().history_retention_days);
    svc.cleanup_history(days);
    Ok(())
}

// ─── Cron Helpers ───────────────────────────────────────────────────

#[tauri::command]
pub async fn sched_validate_cron(
    state: State<'_, SchedulerServiceState>,
    expression: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.validate_cron(&expression).map_err(err_str)
}

#[tauri::command]
pub async fn sched_get_next_occurrences(
    state: State<'_, SchedulerServiceState>,
    expression: String,
    count: Option<usize>,
) -> Result<Vec<DateTime<Utc>>, String> {
    let svc = state.lock().await;
    svc.get_next_occurrences(&expression, count.unwrap_or(5))
        .map_err(err_str)
}

// ─── Global Pause / Resume ──────────────────────────────────────────

#[tauri::command]
pub async fn sched_pause_all(
    state: State<'_, SchedulerServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.pause_all();
    Ok(())
}

#[tauri::command]
pub async fn sched_resume_all(
    state: State<'_, SchedulerServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.resume_all();
    Ok(())
}
