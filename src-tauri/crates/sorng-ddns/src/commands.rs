//! # DDNS Tauri Commands
//!
//! All `#[tauri::command]` functions exposed to the frontend via IPC.

use crate::types::*;
use tauri::State;

// ── Profile CRUD ────────────────────────────────────────────────────

#[tauri::command]
pub async fn ddns_list_profiles(
    state: State<'_, DdnsServiceState>,
) -> Result<Vec<DdnsProfile>, String> {
    let svc = state.lock().await;
    Ok(svc.list_profiles())
}

#[tauri::command]
pub async fn ddns_get_profile(
    state: State<'_, DdnsServiceState>,
    id: String,
) -> Result<DdnsProfile, String> {
    let svc = state.lock().await;
    svc.get_profile(&id)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ddns_create_profile(
    state: State<'_, DdnsServiceState>,
    name: String,
    provider: DdnsProvider,
    auth: DdnsAuthMethod,
    domain: String,
    hostname: String,
    ip_version: IpVersion,
    update_interval_secs: u64,
    provider_settings: ProviderSettings,
    tags: Vec<String>,
    notes: Option<String>,
) -> Result<DdnsProfile, String> {
    let mut svc = state.lock().await;
    Ok(svc.create_profile(
        name,
        provider,
        auth,
        domain,
        hostname,
        ip_version,
        update_interval_secs,
        provider_settings,
        tags,
        notes,
    ))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ddns_update_profile(
    state: State<'_, DdnsServiceState>,
    id: String,
    name: Option<String>,
    enabled: Option<bool>,
    auth: Option<DdnsAuthMethod>,
    domain: Option<String>,
    hostname: Option<String>,
    ip_version: Option<IpVersion>,
    update_interval_secs: Option<u64>,
    provider_settings: Option<ProviderSettings>,
    tags: Option<Vec<String>>,
    notes: Option<Option<String>>,
) -> Result<DdnsProfile, String> {
    let mut svc = state.lock().await;
    svc.update_profile(
        &id,
        name,
        enabled,
        auth,
        domain,
        hostname,
        ip_version,
        update_interval_secs,
        provider_settings,
        tags,
        notes,
    )
}

#[tauri::command]
pub async fn ddns_delete_profile(
    state: State<'_, DdnsServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_profile(&id)
}

#[tauri::command]
pub async fn ddns_enable_profile(
    state: State<'_, DdnsServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.enable_profile(&id)
}

#[tauri::command]
pub async fn ddns_disable_profile(
    state: State<'_, DdnsServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disable_profile(&id)
}

// ── Updates ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ddns_trigger_update(
    state: State<'_, DdnsServiceState>,
    profile_id: String,
) -> Result<DdnsUpdateResult, String> {
    let mut svc = state.lock().await;
    svc.update_profile_now(&profile_id).await
}

#[tauri::command]
pub async fn ddns_trigger_update_all(
    state: State<'_, DdnsServiceState>,
) -> Result<Vec<DdnsUpdateResult>, String> {
    let mut svc = state.lock().await;
    Ok(svc.update_all().await)
}

// ── IP Detection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn ddns_detect_ip(state: State<'_, DdnsServiceState>) -> Result<IpDetectResult, String> {
    let mut svc = state.lock().await;
    svc.detect_ip().await
}

#[tauri::command]
pub async fn ddns_get_current_ips(
    state: State<'_, DdnsServiceState>,
) -> Result<(Option<String>, Option<String>), String> {
    let svc = state.lock().await;
    Ok(svc.get_current_ips())
}

// ── Scheduler ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn ddns_start_scheduler(state: State<'_, DdnsServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.start_scheduler();
    Ok(())
}

#[tauri::command]
pub async fn ddns_stop_scheduler(state: State<'_, DdnsServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.stop_scheduler();
    Ok(())
}

#[tauri::command]
pub async fn ddns_get_scheduler_status(
    state: State<'_, DdnsServiceState>,
) -> Result<SchedulerStatus, String> {
    let svc = state.lock().await;
    Ok(svc.get_scheduler_status())
}

// ── Health & Status ─────────────────────────────────────────────────

#[tauri::command]
pub async fn ddns_get_profile_health(
    state: State<'_, DdnsServiceState>,
    profile_id: String,
) -> Result<DdnsProfileHealth, String> {
    let svc = state.lock().await;
    svc.get_profile_health(&profile_id)
}

#[tauri::command]
pub async fn ddns_get_all_health(
    state: State<'_, DdnsServiceState>,
) -> Result<Vec<DdnsProfileHealth>, String> {
    let svc = state.lock().await;
    Ok(svc.get_all_health())
}

#[tauri::command]
pub async fn ddns_get_system_status(
    state: State<'_, DdnsServiceState>,
) -> Result<DdnsSystemStatus, String> {
    let svc = state.lock().await;
    Ok(svc.get_system_status())
}

// ── Provider Info ───────────────────────────────────────────────────

#[tauri::command]
pub async fn ddns_list_providers(
    state: State<'_, DdnsServiceState>,
) -> Result<Vec<ProviderCapabilities>, String> {
    let svc = state.lock().await;
    Ok(svc.get_all_provider_capabilities())
}

#[tauri::command]
pub async fn ddns_get_provider_capabilities(
    state: State<'_, DdnsServiceState>,
    provider: DdnsProvider,
) -> Result<ProviderCapabilities, String> {
    let svc = state.lock().await;
    Ok(svc.get_provider_capabilities(&provider))
}

// ── Cloudflare-Specific ─────────────────────────────────────────────

#[tauri::command]
pub async fn ddns_cf_list_zones(
    state: State<'_, DdnsServiceState>,
    profile_id: String,
) -> Result<Vec<CloudflareZone>, String> {
    let svc = state.lock().await;
    svc.cf_list_zones(&profile_id).await
}

#[tauri::command]
pub async fn ddns_cf_list_records(
    state: State<'_, DdnsServiceState>,
    profile_id: String,
    zone_id: String,
    record_type: Option<String>,
    name: Option<String>,
) -> Result<Vec<CloudflareDnsRecord>, String> {
    let svc = state.lock().await;
    svc.cf_list_records(&profile_id, &zone_id, record_type, name)
        .await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ddns_cf_create_record(
    state: State<'_, DdnsServiceState>,
    profile_id: String,
    zone_id: String,
    record_type: String,
    name: String,
    content: String,
    ttl: u32,
    proxied: bool,
    comment: Option<String>,
) -> Result<CloudflareDnsRecord, String> {
    let mut svc = state.lock().await;
    svc.cf_create_record(
        &profile_id,
        &zone_id,
        &record_type,
        &name,
        &content,
        ttl,
        proxied,
        comment,
    )
    .await
}

#[tauri::command]
pub async fn ddns_cf_delete_record(
    state: State<'_, DdnsServiceState>,
    profile_id: String,
    zone_id: String,
    record_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.cf_delete_record(&profile_id, &zone_id, &record_id)
        .await
}

// ── Configuration ───────────────────────────────────────────────────

#[tauri::command]
pub async fn ddns_get_config(state: State<'_, DdnsServiceState>) -> Result<DdnsConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

#[tauri::command]
pub async fn ddns_update_config(
    state: State<'_, DdnsServiceState>,
    config: DdnsConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_config(config);
    Ok(())
}

// ── Audit ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ddns_get_audit_log(
    state: State<'_, DdnsServiceState>,
) -> Result<Vec<DdnsAuditEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.get_audit_log())
}

#[tauri::command]
pub async fn ddns_get_audit_for_profile(
    state: State<'_, DdnsServiceState>,
    profile_id: String,
) -> Result<Vec<DdnsAuditEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.get_audit_for_profile(&profile_id))
}

#[tauri::command]
pub async fn ddns_export_audit(state: State<'_, DdnsServiceState>) -> Result<String, String> {
    let svc = state.lock().await;
    svc.export_audit()
}

#[tauri::command]
pub async fn ddns_clear_audit(state: State<'_, DdnsServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.clear_audit();
    Ok(())
}

// ── Import / Export ─────────────────────────────────────────────────

#[tauri::command]
pub async fn ddns_export_profiles(
    state: State<'_, DdnsServiceState>,
) -> Result<DdnsExportData, String> {
    let mut svc = state.lock().await;
    Ok(svc.export_data())
}

#[tauri::command]
pub async fn ddns_import_profiles(
    state: State<'_, DdnsServiceState>,
    data: DdnsExportData,
) -> Result<DdnsImportResult, String> {
    let mut svc = state.lock().await;
    Ok(svc.import_data(data))
}

// ── Process scheduled (called by timer) ─────────────────────────────

#[tauri::command]
pub async fn ddns_process_scheduled(
    state: State<'_, DdnsServiceState>,
) -> Result<Vec<DdnsUpdateResult>, String> {
    let mut svc = state.lock().await;
    Ok(svc.process_scheduled().await)
}
