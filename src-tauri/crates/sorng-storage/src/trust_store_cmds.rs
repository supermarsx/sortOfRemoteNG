use super::trust_store::*;

#[tauri::command]
pub async fn trust_verify_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    identity: Identity,
) -> Result<TrustVerifyResult, String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.verify_identity(&host, &record_type, identity).await
}

#[tauri::command]
pub async fn trust_store_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    identity: Identity,
    user_approved: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.trust_identity(host, record_type, identity, user_approved)
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn trust_store_identity_with_reason(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    identity: Identity,
    user_approved: bool,
    reason: IdentityChangeReason,
    approved_by: Option<String>,
    note: Option<String>,
    migration_history: Option<Vec<Identity>>,
    nickname: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    if reason == IdentityChangeReason::Migrated {
        return svc
            .migrate_legacy_identity(
                host,
                record_type,
                identity,
                user_approved,
                migration_history.unwrap_or_default(),
                nickname,
                approved_by,
                note,
            )
            .await;
    }
    if migration_history.is_some() || nickname.is_some() {
        return Err("migration fields require the migrated reason".to_string());
    }
    svc.trust_identity_with_reason(
        host,
        record_type,
        identity,
        user_approved,
        reason,
        approved_by,
        note,
    )
    .await
}

#[tauri::command]
pub async fn trust_remove_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.remove_identity(&host, &record_type).await
}

#[tauri::command]
pub async fn trust_get_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<Option<TrustRecord>, String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    Ok(svc.get_stored_identity(&host, &record_type).await)
}

#[tauri::command]
pub async fn trust_get_all_records(
    state: tauri::State<'_, TrustStoreServiceState>,
) -> Result<Vec<TrustRecord>, String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    Ok(svc.get_all_trust_records().await)
}

#[tauri::command]
pub async fn trust_clear_all(
    state: tauri::State<'_, TrustStoreServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.clear_all_trust_records().await
}

#[tauri::command]
pub async fn trust_update_nickname(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    nickname: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.update_trust_record_nickname(&host, &record_type, nickname)
        .await
}

#[tauri::command]
pub async fn trust_get_policy(
    state: tauri::State<'_, TrustStoreServiceState>,
) -> Result<TrustPolicy, String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    Ok(svc.get_trust_policy().await)
}

#[tauri::command]
pub async fn trust_set_policy(
    state: tauri::State<'_, TrustStoreServiceState>,
    policy: TrustPolicy,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.set_trust_policy(policy).await
}

#[tauri::command]
pub async fn trust_get_policy_config(
    state: tauri::State<'_, TrustStoreServiceState>,
) -> Result<TrustPolicyConfig, String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    Ok(svc.get_trust_policy_config().await)
}

#[tauri::command]
pub async fn trust_set_policy_config(
    state: tauri::State<'_, TrustStoreServiceState>,
    config: TrustPolicyConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.set_trust_policy_config(config).await
}

#[tauri::command]
pub async fn trust_set_host_policy(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    policy: Option<TrustPolicy>,
    config: Option<TrustPolicyConfig>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.set_host_policy(&host, &record_type, policy, config)
        .await
}

#[tauri::command]
pub async fn trust_revoke_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.revoke_identity(&host, &record_type).await
}

#[tauri::command]
pub async fn trust_reinstate_identity(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.reinstate_identity(&host, &record_type).await
}

#[tauri::command]
pub async fn trust_set_record_tags(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.set_record_tags(&host, &record_type, tags).await
}

#[tauri::command]
pub async fn trust_get_identity_history(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<Vec<IdentityHistoryEntry>, String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.get_identity_history(&host, &record_type).await
}

#[tauri::command]
pub async fn trust_get_verification_stats(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
) -> Result<VerificationStats, String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    svc.get_verification_stats(&host, &record_type).await
}

#[tauri::command]
pub async fn trust_get_summary(
    state: tauri::State<'_, TrustStoreServiceState>,
) -> Result<TrustSummary, String> {
    let mut svc = state.lock().await;
    svc.reload_from_disk()?;
    Ok(svc.get_trust_summary().await)
}
