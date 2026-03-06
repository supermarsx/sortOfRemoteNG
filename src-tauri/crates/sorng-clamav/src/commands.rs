// ── sorng-clamav/src/commands.rs ──────────────────────────────────────────────
//! Tauri commands – thin wrappers around `ClamavService`.

use tauri::State;
use crate::service::ClamavServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn clamav_connect(
    state: State<'_, ClamavServiceState>,
    id: String,
    config: ClamavConnectionConfig,
) -> CmdResult<ClamavConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_disconnect(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn clamav_list_connections(
    state: State<'_, ClamavServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn clamav_ping(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<bool> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Scanning ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn clamav_scan(
    state: State<'_, ClamavServiceState>,
    id: String,
    request: ScanRequest,
) -> CmdResult<ScanSummary> {
    state.lock().await.scan(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_quick_scan(
    state: State<'_, ClamavServiceState>,
    id: String,
    path: String,
) -> CmdResult<ScanResult> {
    state.lock().await.quick_scan(&id, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_scan_stream(
    state: State<'_, ClamavServiceState>,
    id: String,
    data: String,
) -> CmdResult<ScanResult> {
    state.lock().await.scan_stream(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_multiscan(
    state: State<'_, ClamavServiceState>,
    id: String,
    path: String,
) -> CmdResult<ScanSummary> {
    state.lock().await.multiscan(&id, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_contscan(
    state: State<'_, ClamavServiceState>,
    id: String,
    path: String,
) -> CmdResult<ScanSummary> {
    state.lock().await.contscan(&id, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_allmatchscan(
    state: State<'_, ClamavServiceState>,
    id: String,
    path: String,
) -> CmdResult<ScanSummary> {
    state.lock().await.allmatchscan(&id, &path).await.map_err(map_err)
}

// ── Database ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn clamav_list_databases(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<Vec<DatabaseInfo>> {
    state.lock().await.list_databases(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_update_databases(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<Vec<DatabaseUpdateResult>> {
    state.lock().await.update_databases(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_update_database(
    state: State<'_, ClamavServiceState>,
    id: String,
    name: String,
) -> CmdResult<DatabaseUpdateResult> {
    state.lock().await.update_database(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_check_update(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<bool> {
    state.lock().await.check_update(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_get_mirrors(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.get_mirrors(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_add_mirror(
    state: State<'_, ClamavServiceState>,
    id: String,
    url: String,
) -> CmdResult<()> {
    state.lock().await.add_mirror(&id, &url).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_remove_mirror(
    state: State<'_, ClamavServiceState>,
    id: String,
    url: String,
) -> CmdResult<()> {
    state.lock().await.remove_mirror(&id, &url).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_get_db_version(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.get_db_version(&id).await.map_err(map_err)
}

// ── Quarantine ────────────────────────────────────────────────────

#[tauri::command]
pub async fn clamav_list_quarantine(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<Vec<QuarantineEntry>> {
    state.lock().await.list_quarantine(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_get_quarantine_entry(
    state: State<'_, ClamavServiceState>,
    id: String,
    entry_id: String,
) -> CmdResult<QuarantineEntry> {
    state.lock().await.get_quarantine_entry(&id, &entry_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_restore_quarantine(
    state: State<'_, ClamavServiceState>,
    id: String,
    entry_id: String,
) -> CmdResult<()> {
    state.lock().await.restore_quarantine(&id, &entry_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_delete_quarantine(
    state: State<'_, ClamavServiceState>,
    id: String,
    entry_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_quarantine(&id, &entry_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_delete_all_quarantine(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.delete_all_quarantine(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_get_quarantine_stats(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<QuarantineStats> {
    state.lock().await.get_quarantine_stats(&id).await.map_err(map_err)
}

// ── Clamd config ──────────────────────────────────────────────────

#[tauri::command]
pub async fn clamav_get_clamd_config(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<Vec<ClamdConfig>> {
    state.lock().await.get_clamd_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_get_clamd_param(
    state: State<'_, ClamavServiceState>,
    id: String,
    key: String,
) -> CmdResult<ClamdConfig> {
    state.lock().await.get_clamd_param(&id, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_set_clamd_param(
    state: State<'_, ClamavServiceState>,
    id: String,
    key: String,
    value: String,
) -> CmdResult<()> {
    state.lock().await.set_clamd_param(&id, &key, &value).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_delete_clamd_param(
    state: State<'_, ClamavServiceState>,
    id: String,
    key: String,
) -> CmdResult<()> {
    state.lock().await.delete_clamd_param(&id, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_get_socket(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.get_socket(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_set_socket(
    state: State<'_, ClamavServiceState>,
    id: String,
    socket: String,
) -> CmdResult<()> {
    state.lock().await.set_socket(&id, &socket).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_test_clamd_config(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<ConfigTestResult> {
    state.lock().await.test_clamd_config(&id).await.map_err(map_err)
}

// ── Freshclam config ──────────────────────────────────────────────

#[tauri::command]
pub async fn clamav_get_freshclam_config(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<Vec<FreshclamConfig>> {
    state.lock().await.get_freshclam_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_get_freshclam_param(
    state: State<'_, ClamavServiceState>,
    id: String,
    key: String,
) -> CmdResult<FreshclamConfig> {
    state.lock().await.get_freshclam_param(&id, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_set_freshclam_param(
    state: State<'_, ClamavServiceState>,
    id: String,
    key: String,
    value: String,
) -> CmdResult<()> {
    state.lock().await.set_freshclam_param(&id, &key, &value).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_delete_freshclam_param(
    state: State<'_, ClamavServiceState>,
    id: String,
    key: String,
) -> CmdResult<()> {
    state.lock().await.delete_freshclam_param(&id, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_get_update_interval(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<u64> {
    state.lock().await.get_update_interval(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_set_update_interval(
    state: State<'_, ClamavServiceState>,
    id: String,
    hours: u64,
) -> CmdResult<()> {
    state.lock().await.set_update_interval(&id, hours).await.map_err(map_err)
}

// ── On-access ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn clamav_get_on_access_config(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<OnAccessConfig> {
    state.lock().await.get_on_access_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_set_on_access_config(
    state: State<'_, ClamavServiceState>,
    id: String,
    config: OnAccessConfig,
) -> CmdResult<()> {
    state.lock().await.set_on_access_config(&id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_enable_on_access(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.enable_on_access(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_disable_on_access(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disable_on_access(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_add_on_access_path(
    state: State<'_, ClamavServiceState>,
    id: String,
    path: String,
) -> CmdResult<()> {
    state.lock().await.add_on_access_path(&id, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_remove_on_access_path(
    state: State<'_, ClamavServiceState>,
    id: String,
    path: String,
) -> CmdResult<()> {
    state.lock().await.remove_on_access_path(&id, &path).await.map_err(map_err)
}

// ── Milter ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn clamav_get_milter_config(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<MilterConfig> {
    state.lock().await.get_milter_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_set_milter_config(
    state: State<'_, ClamavServiceState>,
    id: String,
    config: MilterConfig,
) -> CmdResult<()> {
    state.lock().await.set_milter_config(&id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_enable_milter(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.enable_milter(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_disable_milter(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disable_milter(&id).await.map_err(map_err)
}

// ── Scheduled scans ───────────────────────────────────────────────

#[tauri::command]
pub async fn clamav_list_scheduled_scans(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<Vec<ScheduledScan>> {
    state.lock().await.list_scheduled_scans(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_get_scheduled_scan(
    state: State<'_, ClamavServiceState>,
    id: String,
    scan_id: String,
) -> CmdResult<ScheduledScan> {
    state.lock().await.get_scheduled_scan(&id, &scan_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_create_scheduled_scan(
    state: State<'_, ClamavServiceState>,
    id: String,
    scan: ScheduledScan,
) -> CmdResult<ScheduledScan> {
    state.lock().await.create_scheduled_scan(&id, scan).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_update_scheduled_scan(
    state: State<'_, ClamavServiceState>,
    id: String,
    scan_id: String,
    scan: ScheduledScan,
) -> CmdResult<ScheduledScan> {
    state.lock().await.update_scheduled_scan(&id, &scan_id, scan).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_delete_scheduled_scan(
    state: State<'_, ClamavServiceState>,
    id: String,
    scan_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_scheduled_scan(&id, &scan_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_enable_scheduled_scan(
    state: State<'_, ClamavServiceState>,
    id: String,
    scan_id: String,
) -> CmdResult<()> {
    state.lock().await.enable_scheduled_scan(&id, &scan_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_disable_scheduled_scan(
    state: State<'_, ClamavServiceState>,
    id: String,
    scan_id: String,
) -> CmdResult<()> {
    state.lock().await.disable_scheduled_scan(&id, &scan_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_run_scheduled_scan(
    state: State<'_, ClamavServiceState>,
    id: String,
    scan_id: String,
) -> CmdResult<ScanSummary> {
    state.lock().await.run_scheduled_scan(&id, &scan_id).await.map_err(map_err)
}

// ── Process management ────────────────────────────────────────────

#[tauri::command]
pub async fn clamav_start_clamd(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.start_clamd(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_stop_clamd(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.stop_clamd(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_restart_clamd(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.restart_clamd(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_reload_clamd(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.reload_clamd(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_clamd_status(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<ClamdStats> {
    state.lock().await.clamd_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_start_freshclam(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.start_freshclam(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_stop_freshclam(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.stop_freshclam(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_restart_freshclam(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.restart_freshclam(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_version(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn clamav_info(
    state: State<'_, ClamavServiceState>,
    id: String,
) -> CmdResult<ClamavInfo> {
    state.lock().await.info(&id).await.map_err(map_err)
}
