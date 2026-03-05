//! # Tauri Commands
//!
//! IPC command handlers exposed to the SortOfRemote NG front-end via Tauri's
//! `#[tauri::command]` system. All commands are prefixed with `cred_`.

use crate::service::CredentialServiceState;
use crate::tracker::CredentialTracker;
use crate::types::*;
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

// ── Credential CRUD ─────────────────────────────────────────────────

/// Register a new credential record.
#[tauri::command]
pub async fn cred_add(
    state: State<'_, CredentialServiceState>,
    record: CredentialRecord,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.tracker.add_credential(record.clone()).map_err(|e| e.to_string())?;
    svc.audit.log_action(CredentialAuditEntry {
        id: Uuid::new_v4().to_string(),
        credential_id: record.id.clone(),
        action: AuditAction::Created,
        timestamp: Utc::now(),
        details: format!("Credential '{}' added", record.label),
        user: "system".to_string(),
    });
    Ok(())
}

/// Remove a credential record by ID.
#[tauri::command]
pub async fn cred_remove(
    state: State<'_, CredentialServiceState>,
    id: String,
) -> Result<CredentialRecord, String> {
    let mut svc = state.lock().await;
    let removed = svc.tracker.remove_credential(&id).map_err(|e| e.to_string())?;
    svc.audit.log_action(CredentialAuditEntry {
        id: Uuid::new_v4().to_string(),
        credential_id: id.clone(),
        action: AuditAction::Deleted,
        timestamp: Utc::now(),
        details: format!("Credential '{}' removed", removed.label),
        user: "system".to_string(),
    });
    Ok(removed)
}

/// Replace an existing credential record.
#[tauri::command]
pub async fn cred_update(
    state: State<'_, CredentialServiceState>,
    record: CredentialRecord,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.tracker.update_credential(record).map_err(|e| e.to_string())
}

/// Get a credential record by ID.
#[tauri::command]
pub async fn cred_get(
    state: State<'_, CredentialServiceState>,
    id: String,
) -> Result<CredentialRecord, String> {
    let svc = state.lock().await;
    svc.tracker
        .get_credential(&id)
        .cloned()
        .map_err(|e| e.to_string())
}

/// List all tracked credential records.
#[tauri::command]
pub async fn cred_list(
    state: State<'_, CredentialServiceState>,
) -> Result<Vec<CredentialRecord>, String> {
    let svc = state.lock().await;
    Ok(svc.tracker.list_credentials().into_iter().cloned().collect())
}

// ── Rotation ────────────────────────────────────────────────────────

/// Record a rotation event for a credential.
#[tauri::command]
pub async fn cred_record_rotation(
    state: State<'_, CredentialServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.tracker.record_rotation(&id).map_err(|e| e.to_string())?;
    svc.audit.log_action(CredentialAuditEntry {
        id: Uuid::new_v4().to_string(),
        credential_id: id.clone(),
        action: AuditAction::Rotated,
        timestamp: Utc::now(),
        details: "Credential rotated".to_string(),
        user: "system".to_string(),
    });
    Ok(())
}

// ── Expiry Analysis ─────────────────────────────────────────────────

/// Check the expiry status of a single credential.
#[tauri::command]
pub async fn cred_check_expiry(
    state: State<'_, CredentialServiceState>,
    id: String,
) -> Result<ExpiryStatus, String> {
    let svc = state.lock().await;
    svc.tracker.check_expiry(&id).map_err(|e| e.to_string())
}

/// Check expiry status for all tracked credentials.
#[tauri::command]
pub async fn cred_check_all_expiries(
    state: State<'_, CredentialServiceState>,
) -> Result<Vec<(String, ExpiryStatus)>, String> {
    let svc = state.lock().await;
    Ok(svc.tracker.check_all_expiries())
}

/// Get all credentials older than `policy_age_days`.
#[tauri::command]
pub async fn cred_get_stale(
    state: State<'_, CredentialServiceState>,
    policy_age_days: u64,
) -> Result<Vec<CredentialRecord>, String> {
    let svc = state.lock().await;
    Ok(svc
        .tracker
        .get_stale_credentials(policy_age_days)
        .into_iter()
        .cloned()
        .collect())
}

/// Get all credentials expiring within `days`.
#[tauri::command]
pub async fn cred_get_expiring_soon(
    state: State<'_, CredentialServiceState>,
    days: u64,
) -> Result<Vec<CredentialRecord>, String> {
    let svc = state.lock().await;
    Ok(svc
        .tracker
        .get_expiring_soon(days)
        .into_iter()
        .cloned()
        .collect())
}

/// Get all credentials that have already expired.
#[tauri::command]
pub async fn cred_get_expired(
    state: State<'_, CredentialServiceState>,
) -> Result<Vec<CredentialRecord>, String> {
    let svc = state.lock().await;
    Ok(svc.tracker.get_expired().into_iter().cloned().collect())
}

// ── Policies ────────────────────────────────────────────────────────

/// Add a rotation policy.
#[tauri::command]
pub async fn cred_add_policy(
    state: State<'_, CredentialServiceState>,
    policy: RotationPolicy,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let policy_clone = policy.clone();
    svc.tracker.add_policy(policy).map_err(|e| e.to_string())?;
    svc.policy_engine
        .policies
        .insert(policy_clone.id.clone(), policy_clone);
    Ok(())
}

/// Remove a rotation policy by ID.
#[tauri::command]
pub async fn cred_remove_policy(
    state: State<'_, CredentialServiceState>,
    id: String,
) -> Result<RotationPolicy, String> {
    let mut svc = state.lock().await;
    svc.policy_engine.policies.remove(&id);
    svc.tracker.remove_policy(&id).map_err(|e| e.to_string())
}

/// List all rotation policies.
#[tauri::command]
pub async fn cred_list_policies(
    state: State<'_, CredentialServiceState>,
) -> Result<Vec<RotationPolicy>, String> {
    let svc = state.lock().await;
    Ok(svc.tracker.list_policies().into_iter().cloned().collect())
}

/// Check a credential against its assigned rotation policy.
#[tauri::command]
pub async fn cred_check_compliance(
    state: State<'_, CredentialServiceState>,
    credential_id: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.tracker
        .check_policy_compliance(&credential_id)
        .map_err(|e| e.to_string())
}

// ── Strength ────────────────────────────────────────────────────────

/// Estimate password strength.
#[tauri::command]
pub async fn cred_check_strength(
    password: String,
) -> Result<PasswordStrength, String> {
    Ok(CredentialTracker::calculate_password_strength(&password))
}

// ── Duplicates ──────────────────────────────────────────────────────

/// Detect credentials sharing the same fingerprint.
#[tauri::command]
pub async fn cred_detect_duplicates(
    state: State<'_, CredentialServiceState>,
) -> Result<Vec<Vec<String>>, String> {
    let svc = state.lock().await;
    Ok(svc.tracker.detect_duplicates())
}

// ── Groups ──────────────────────────────────────────────────────────

/// Create a new credential group.
#[tauri::command]
pub async fn cred_create_group(
    state: State<'_, CredentialServiceState>,
    group: CredentialGroup,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.groups.create_group(group).map_err(|e| e.to_string())
}

/// Delete a credential group by ID.
#[tauri::command]
pub async fn cred_delete_group(
    state: State<'_, CredentialServiceState>,
    id: String,
) -> Result<CredentialGroup, String> {
    let mut svc = state.lock().await;
    svc.groups.delete_group(&id).map_err(|e| e.to_string())
}

/// List all credential groups.
#[tauri::command]
pub async fn cred_list_groups(
    state: State<'_, CredentialServiceState>,
) -> Result<Vec<CredentialGroup>, String> {
    let svc = state.lock().await;
    Ok(svc.groups.list_groups().into_iter().cloned().collect())
}

/// Add a credential to a group.
#[tauri::command]
pub async fn cred_add_to_group(
    state: State<'_, CredentialServiceState>,
    group_id: String,
    credential_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.groups
        .add_to_group(&group_id, credential_id)
        .map_err(|e| e.to_string())
}

/// Remove a credential from a group.
#[tauri::command]
pub async fn cred_remove_from_group(
    state: State<'_, CredentialServiceState>,
    group_id: String,
    credential_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.groups
        .remove_from_group(&group_id, &credential_id)
        .map_err(|e| e.to_string())
}

// ── Alerts ──────────────────────────────────────────────────────────

/// Get all active (unacknowledged) alerts.
#[tauri::command]
pub async fn cred_get_alerts(
    state: State<'_, CredentialServiceState>,
) -> Result<Vec<CredentialAlert>, String> {
    let svc = state.lock().await;
    Ok(svc.alerts.get_active_alerts().into_iter().cloned().collect())
}

/// Acknowledge an alert by ID.
#[tauri::command]
pub async fn cred_acknowledge_alert(
    state: State<'_, CredentialServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.alerts.acknowledge_alert(&id)?;
    svc.audit.log_action(CredentialAuditEntry {
        id: Uuid::new_v4().to_string(),
        credential_id: id.clone(),
        action: AuditAction::AlertAcknowledged,
        timestamp: Utc::now(),
        details: format!("Alert {id} acknowledged"),
        user: "system".to_string(),
    });
    Ok(())
}

/// Scan all credentials and generate new alerts.
#[tauri::command]
pub async fn cred_generate_alerts(
    state: State<'_, CredentialServiceState>,
) -> Result<Vec<CredentialAlert>, String> {
    let mut svc = state.lock().await;
    let credentials = svc.tracker.credentials.clone();
    let policies = svc.tracker.policies.clone();
    let config = svc.config.clone();
    Ok(svc.alerts.generate_alerts(&credentials, &policies, &config))
}

// ── Audit ───────────────────────────────────────────────────────────

/// Get recent audit log entries.
#[tauri::command]
pub async fn cred_get_audit_log(
    state: State<'_, CredentialServiceState>,
    count: usize,
) -> Result<Vec<CredentialAuditEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.audit.get_recent(count).into_iter().cloned().collect())
}

// ── Statistics ──────────────────────────────────────────────────────

/// Compute aggregate credential statistics.
#[tauri::command]
pub async fn cred_get_stats(
    state: State<'_, CredentialServiceState>,
) -> Result<CredentialStats, String> {
    let svc = state.lock().await;
    Ok(svc.get_stats())
}

// ── Configuration ───────────────────────────────────────────────────

/// Get the current credentials configuration.
#[tauri::command]
pub async fn cred_get_config(
    state: State<'_, CredentialServiceState>,
) -> Result<CredentialsConfig, String> {
    let svc = state.lock().await;
    Ok(svc.config.clone())
}

/// Update the credentials configuration.
#[tauri::command]
pub async fn cred_update_config(
    state: State<'_, CredentialServiceState>,
    config: CredentialsConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.config = config;
    Ok(())
}
