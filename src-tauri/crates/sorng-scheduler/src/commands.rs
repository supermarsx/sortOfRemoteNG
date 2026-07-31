// Tauri command handlers for the scheduler.
//
// Each command follows the `sched_*` naming convention and delegates
// to [`SchedulerService`].

use chrono::{DateTime, Utc};
use std::sync::Arc;
use tauri::State;

use super::service::{SchedulerService, SchedulerServiceState};
use super::types::*;
use super::{
    cron::MAX_CRON_OCCURRENCES,
    scheduler::{MAX_HISTORY_QUERY, MAX_HISTORY_RETENTION_DAYS, MAX_UPCOMING_QUERY},
};

/// Helper to map SchedulerError → String for Tauri command results.
fn err_str(e: super::error::SchedulerError) -> String {
    e.to_string()
}

fn bounded_count(
    value: Option<usize>,
    default: usize,
    maximum: usize,
    label: &str,
) -> Result<usize, String> {
    let value = value.unwrap_or(default);
    if value > maximum {
        return Err(format!("{label} exceeds the maximum of {maximum}"));
    }
    Ok(value)
}

async fn ensure_started(state: &State<'_, SchedulerServiceState>) -> Result<(), String> {
    SchedulerService::ensure_background_started(Arc::clone(state.inner()))
        .await
        .map_err(err_str)
}

// ─── Task CRUD ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn sched_add_task(
    state: State<'_, SchedulerServiceState>,
    task: ScheduledTask,
) -> Result<String, String> {
    ensure_started(&state).await?;
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
    ensure_started(&state).await?;
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
    let managed = Arc::clone(state.inner());
    SchedulerService::ensure_background_started(Arc::clone(&managed))
        .await
        .map_err(err_str)?;
    SchedulerService::execute_now(managed, &task_id)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn sched_cancel_task(
    state: State<'_, SchedulerServiceState>,
    task_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cancel_task(&task_id).map_err(err_str)
}

// ─── History & Upcoming ─────────────────────────────────────────────

#[tauri::command]
pub async fn sched_get_history(
    state: State<'_, SchedulerServiceState>,
    task_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<TaskExecutionRecord>, String> {
    let limit = bounded_count(limit, 100, MAX_HISTORY_QUERY, "history limit")?;
    let svc = state.lock().await;
    Ok(svc.get_history(task_id.as_deref(), limit))
}

#[tauri::command]
pub async fn sched_get_upcoming(
    state: State<'_, SchedulerServiceState>,
    count: Option<usize>,
) -> Result<Vec<(ScheduledTask, DateTime<Utc>)>, String> {
    let count = bounded_count(count, 10, MAX_UPCOMING_QUERY, "upcoming count")?;
    let svc = state.lock().await;
    Ok(svc.get_upcoming(count))
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
    svc.update_config(config).map_err(err_str)
}

// ─── Cleanup ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sched_cleanup_history(
    state: State<'_, SchedulerServiceState>,
    retention_days: Option<u64>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let days = retention_days.unwrap_or(svc.get_config().history_retention_days);
    if days > MAX_HISTORY_RETENTION_DAYS {
        return Err(format!(
            "history retention exceeds the maximum of {MAX_HISTORY_RETENTION_DAYS} days"
        ));
    }
    svc.cleanup_history(days).map_err(err_str)
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
    let count = bounded_count(count, 5, MAX_CRON_OCCURRENCES, "cron occurrence count")?;
    let svc = state.lock().await;
    svc.get_next_occurrences(&expression, count)
        .map_err(err_str)
}

// ─── Global Pause / Resume ──────────────────────────────────────────

#[tauri::command]
pub async fn sched_pause_all(state: State<'_, SchedulerServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.pause_all().map_err(err_str)
}

#[tauri::command]
pub async fn sched_resume_all(state: State<'_, SchedulerServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.resume_all().map_err(err_str)
}
