//! Tauri commands for the backup-verify integration.
//!
//! Each command follows the pattern: acquire the `BackupVerifyServiceState` lock,
//! delegate to the service method, and map errors to `String`.

use chrono::{DateTime, Utc};

use crate::service::BackupVerifyServiceState;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
// Overview
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_get_overview(
    state: tauri::State<'_, BackupVerifyServiceState>,
) -> Result<BackupOverview, String> {
    let svc = state.lock().await;
    Ok(svc.get_overview())
}

// ═══════════════════════════════════════════════════════════════════════
// Policies
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_list_policies(
    state: tauri::State<'_, BackupVerifyServiceState>,
) -> Result<Vec<BackupPolicy>, String> {
    let svc = state.lock().await;
    Ok(svc.list_policies().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn backup_verify_get_policy(
    state: tauri::State<'_, BackupVerifyServiceState>,
    policy_id: String,
) -> Result<BackupPolicy, String> {
    let svc = state.lock().await;
    svc.get_policy(&policy_id)
        .cloned()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_create_policy(
    state: tauri::State<'_, BackupVerifyServiceState>,
    policy: BackupPolicy,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.create_policy(policy).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_update_policy(
    state: tauri::State<'_, BackupVerifyServiceState>,
    policy: BackupPolicy,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_policy(policy).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_delete_policy(
    state: tauri::State<'_, BackupVerifyServiceState>,
    policy_id: String,
) -> Result<BackupPolicy, String> {
    let mut svc = state.lock().await;
    svc.delete_policy(&policy_id).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Catalog
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_list_catalog(
    state: tauri::State<'_, BackupVerifyServiceState>,
    policy_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<CatalogEntry>, String> {
    let svc = state.lock().await;
    let from_dt = from.and_then(|s| s.parse::<DateTime<Utc>>().ok());
    let to_dt = to.and_then(|s| s.parse::<DateTime<Utc>>().ok());
    Ok(svc
        .list_catalog_entries(policy_id.as_deref(), from_dt, to_dt)
        .into_iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn backup_verify_get_catalog_entry(
    state: tauri::State<'_, BackupVerifyServiceState>,
    entry_id: String,
) -> Result<CatalogEntry, String> {
    let svc = state.lock().await;
    svc.get_catalog_entry(&entry_id)
        .cloned()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_add_catalog_entry(
    state: tauri::State<'_, BackupVerifyServiceState>,
    entry: CatalogEntry,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.add_catalog_entry(entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_delete_catalog_entry(
    state: tauri::State<'_, BackupVerifyServiceState>,
    entry_id: String,
) -> Result<CatalogEntry, String> {
    let mut svc = state.lock().await;
    svc.delete_catalog_entry(&entry_id)
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Verification
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_verify_backup(
    state: tauri::State<'_, BackupVerifyServiceState>,
    entry_id: String,
    method: VerificationMethod,
) -> Result<VerificationResult, String> {
    let mut svc = state.lock().await;
    svc.verify_backup(&entry_id, method)
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Scheduler / Jobs
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_trigger_backup(
    state: tauri::State<'_, BackupVerifyServiceState>,
    policy_id: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.trigger_backup(&policy_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_cancel_job(
    state: tauri::State<'_, BackupVerifyServiceState>,
    job_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.cancel_job(&job_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_list_running_jobs(
    state: tauri::State<'_, BackupVerifyServiceState>,
) -> Result<Vec<BackupJob>, String> {
    let svc = state.lock().await;
    Ok(svc.list_running_jobs().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn backup_verify_list_queued_jobs(
    state: tauri::State<'_, BackupVerifyServiceState>,
) -> Result<Vec<BackupJob>, String> {
    let svc = state.lock().await;
    Ok(svc.list_queued_jobs().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn backup_verify_get_job_history(
    state: tauri::State<'_, BackupVerifyServiceState>,
    policy_id: String,
    limit: Option<usize>,
) -> Result<Vec<BackupJob>, String> {
    let svc = state.lock().await;
    Ok(svc
        .get_job_history(&policy_id, limit.unwrap_or(50))
        .into_iter()
        .cloned()
        .collect())
}

// ═══════════════════════════════════════════════════════════════════════
// Integrity
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_compute_sha256(
    state: tauri::State<'_, BackupVerifyServiceState>,
    path: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compute_sha256(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_generate_manifest(
    state: tauri::State<'_, BackupVerifyServiceState>,
    path: String,
) -> Result<FileManifest, String> {
    let svc = state.lock().await;
    svc.generate_manifest(&path).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// DR Testing
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_run_dr_drill(
    state: tauri::State<'_, BackupVerifyServiceState>,
    policy_id: String,
    entry_id: String,
) -> Result<crate::dr_testing::DrDrillResult, String> {
    let mut svc = state.lock().await;
    svc.run_dr_drill(&policy_id, &entry_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_get_drill_history(
    state: tauri::State<'_, BackupVerifyServiceState>,
) -> Result<Vec<crate::dr_testing::DrDrillResult>, String> {
    let svc = state.lock().await;
    Ok(svc.dr_testing.get_drill_history().to_vec())
}

// ═══════════════════════════════════════════════════════════════════════
// Compliance
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_generate_compliance_report(
    state: tauri::State<'_, BackupVerifyServiceState>,
    framework: ComplianceFramework,
    period_start: String,
    period_end: String,
) -> Result<ComplianceReport, String> {
    let start = period_start
        .parse::<DateTime<Utc>>()
        .map_err(|e| format!("Invalid period_start: {}", e))?;
    let end = period_end
        .parse::<DateTime<Utc>>()
        .map_err(|e| format!("Invalid period_end: {}", e))?;
    let mut svc = state.lock().await;
    svc.generate_compliance_report(framework, start, end)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_get_compliance_history(
    state: tauri::State<'_, BackupVerifyServiceState>,
) -> Result<Vec<ComplianceReport>, String> {
    let svc = state.lock().await;
    Ok(svc.compliance.get_report_history().to_vec())
}

// ═══════════════════════════════════════════════════════════════════════
// Replication
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_list_replicas(
    state: tauri::State<'_, BackupVerifyServiceState>,
) -> Result<Vec<ReplicationTarget>, String> {
    let svc = state.lock().await;
    Ok(svc
        .list_replication_targets()
        .into_iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn backup_verify_add_replica(
    state: tauri::State<'_, BackupVerifyServiceState>,
    target: ReplicationTarget,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.add_replication_target(target)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_remove_replica(
    state: tauri::State<'_, BackupVerifyServiceState>,
    target_id: String,
) -> Result<ReplicationTarget, String> {
    let mut svc = state.lock().await;
    svc.remove_replication_target(&target_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_start_replication(
    state: tauri::State<'_, BackupVerifyServiceState>,
    entry_id: String,
    target_id: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.start_replication(&entry_id, &target_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_get_replication_status(
    state: tauri::State<'_, BackupVerifyServiceState>,
    target_id: String,
) -> Result<ReplicationStatus, String> {
    let svc = state.lock().await;
    svc.get_replication_status(&target_id)
        .cloned()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_get_replication_overview(
    state: tauri::State<'_, BackupVerifyServiceState>,
) -> Result<Vec<crate::replication::ReplicationOverview>, String> {
    let svc = state.lock().await;
    Ok(svc.replication.get_replication_overview())
}

// ═══════════════════════════════════════════════════════════════════════
// Retention
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_enforce_retention(
    state: tauri::State<'_, BackupVerifyServiceState>,
    policy_id: String,
) -> Result<crate::retention::PurgeResult, String> {
    let mut svc = state.lock().await;
    svc.enforce_retention(&policy_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_verify_get_retention_forecast(
    state: tauri::State<'_, BackupVerifyServiceState>,
) -> Result<Vec<crate::retention::RetentionForecastEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.get_retention_forecast())
}

#[tauri::command]
pub async fn backup_verify_set_immutability_lock(
    state: tauri::State<'_, BackupVerifyServiceState>,
    entry_id: String,
    duration_days: u32,
    reason: String,
) -> Result<crate::retention::ImmutabilityLock, String> {
    let mut svc = state.lock().await;
    Ok(svc
        .retention
        .set_immutability_lock(&entry_id, duration_days, &reason))
}

#[tauri::command]
pub async fn backup_verify_check_immutability(
    state: tauri::State<'_, BackupVerifyServiceState>,
) -> Result<Vec<crate::retention::ImmutabilityLock>, String> {
    let svc = state.lock().await;
    Ok(svc
        .retention
        .check_immutability_locks()
        .into_iter()
        .cloned()
        .collect())
}

// ═══════════════════════════════════════════════════════════════════════
// Notifications
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn backup_verify_configure_notifications(
    state: tauri::State<'_, BackupVerifyServiceState>,
    config: ChannelConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.configure_notification_channels(config);
    Ok(())
}

#[tauri::command]
pub async fn backup_verify_send_test_notification(
    state: tauri::State<'_, BackupVerifyServiceState>,
    _policy_id: String,
) -> Result<Vec<crate::notifications::DispatchResult>, String> {
    let mut svc = state.lock().await;
    let notification = BackupNotification::new(
        NotifyEvent::JobStarted,
        FindingSeverity::Info,
        "Test notification from backup-verify".into(),
    );
    Ok(svc.send_notification(&notification))
}

#[tauri::command]
pub async fn backup_verify_test_channel(
    state: tauri::State<'_, BackupVerifyServiceState>,
    channel: NotifyChannel,
    policy_id: String,
) -> Result<crate::notifications::ChannelTestResult, String> {
    let svc = state.lock().await;
    Ok(svc.notifications.test_channel(&channel, &policy_id))
}
