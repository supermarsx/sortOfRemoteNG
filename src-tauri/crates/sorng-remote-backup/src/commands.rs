// Tauri commands — thin async handlers that lock service state and delegate.

use super::error::err_str;
use super::progress::AggregateProgress;
use super::retention::{RetentionEntry, RetentionResult};
use super::service::RemoteBackupServiceState;
use super::types::{BackupExecutionRecord, BackupJob, BackupJobStatus, BackupProgress, ToolInfo};
use tauri::State;

// ─── Job Management ─────────────────────────────────────────────────

#[tauri::command]
pub async fn backup_add_job(
    state: State<'_, RemoteBackupServiceState>,
    job: BackupJob,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.add_job(job).map_err(err_str)
}

#[tauri::command]
pub async fn backup_update_job(
    state: State<'_, RemoteBackupServiceState>,
    job: BackupJob,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_job(job).map_err(err_str)
}

#[tauri::command]
pub async fn backup_remove_job(
    state: State<'_, RemoteBackupServiceState>,
    id: String,
) -> Result<BackupJob, String> {
    let mut svc = state.lock().await;
    svc.remove_job(&id).map_err(err_str)
}

#[tauri::command]
pub async fn backup_get_job(
    state: State<'_, RemoteBackupServiceState>,
    id: String,
) -> Result<BackupJob, String> {
    let svc = state.lock().await;
    svc.get_job(&id).cloned().map_err(err_str)
}

#[tauri::command]
pub async fn backup_list_jobs(
    state: State<'_, RemoteBackupServiceState>,
    tag: Option<String>,
    status: Option<BackupJobStatus>,
) -> Result<Vec<BackupJob>, String> {
    let svc = state.lock().await;
    Ok(svc
        .list_jobs(tag.as_deref(), status.as_ref())
        .into_iter()
        .cloned()
        .collect())
}

// ─── Execution ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn backup_run_job(
    state: State<'_, RemoteBackupServiceState>,
    id: String,
) -> Result<String, String> {
    // Mark as running
    {
        let mut svc = state.lock().await;
        svc.mark_running(&id).map_err(err_str)?;
    }

    // In a real implementation you'd spawn the tool-specific execution here
    // and store the JoinHandle. For now, return the job_id to indicate it started.
    Ok(id)
}

#[tauri::command]
pub async fn backup_cancel_job(
    state: State<'_, RemoteBackupServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.cancel_job(&id).map_err(err_str)
}

// ─── History ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn backup_job_history(
    state: State<'_, RemoteBackupServiceState>,
    job_id: String,
) -> Result<Vec<BackupExecutionRecord>, String> {
    let svc = state.lock().await;
    Ok(svc.job_history(&job_id).into_iter().cloned().collect())
}

#[tauri::command]
pub async fn backup_all_history(
    state: State<'_, RemoteBackupServiceState>,
) -> Result<Vec<BackupExecutionRecord>, String> {
    let svc = state.lock().await;
    Ok(svc.all_history().to_vec())
}

// ─── Progress ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn backup_job_progress(
    state: State<'_, RemoteBackupServiceState>,
    job_id: String,
) -> Result<Option<BackupProgress>, String> {
    let svc = state.lock().await;
    Ok(svc.job_progress(&job_id).cloned())
}

#[tauri::command]
pub async fn backup_aggregate_progress(
    state: State<'_, RemoteBackupServiceState>,
) -> Result<AggregateProgress, String> {
    let svc = state.lock().await;
    Ok(svc.progress.aggregate())
}

// ─── Tool Detection ─────────────────────────────────────────────────

#[tauri::command]
pub async fn backup_detect_tools() -> Result<Vec<ToolInfo>, String> {
    Ok(super::service::RemoteBackupService::detect_tools().await)
}

// ─── Retention Evaluation ───────────────────────────────────────────

#[tauri::command]
pub async fn backup_evaluate_retention(
    entries: Vec<RetentionEntry>,
    policy: super::types::RetentionPolicy,
) -> Result<RetentionResult, String> {
    super::retention::evaluate(&entries, &policy).map_err(err_str)
}
