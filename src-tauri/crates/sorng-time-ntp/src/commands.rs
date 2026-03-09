//! Tauri commands — async wrappers for time, timezone & NTP management.

use crate::service::TimeNtpServiceState;
use crate::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Host CRUD ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn time_add_host(state: State<'_, TimeNtpServiceState>, host: TimeHost) -> CmdResult<()> {
    state.lock().await.add_host(host).map_err(map_err)
}

#[tauri::command]
pub async fn time_remove_host(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<TimeHost> {
    state.lock().await.remove_host(&host_id).map_err(map_err)
}

#[tauri::command]
pub async fn time_update_host(
    state: State<'_, TimeNtpServiceState>,
    host: TimeHost,
) -> CmdResult<()> {
    state.lock().await.update_host(host).map_err(map_err)
}

#[tauri::command]
pub async fn time_get_host(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<TimeHost> {
    state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_list_hosts(state: State<'_, TimeNtpServiceState>) -> CmdResult<Vec<TimeHost>> {
    Ok(state
        .lock()
        .await
        .list_hosts()
        .into_iter()
        .cloned()
        .collect())
}

// ── Timedatectl ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn time_get_status(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<SystemTime> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::timedatectl::get_time_status(&host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_set_timezone(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
    tz: String,
) -> CmdResult<()> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::timedatectl::set_timezone(&host, &tz)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_list_timezones(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<Vec<TimezoneInfo>> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::timedatectl::list_timezones(&host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_set_time(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
    time_str: String,
) -> CmdResult<()> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    let dt = time_str
        .parse::<chrono::DateTime<chrono::Utc>>()
        .map_err(|e| format!("Invalid datetime: {e}"))?;
    crate::timedatectl::set_time(&host, dt)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_set_ntp(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
    enabled: bool,
) -> CmdResult<()> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::timedatectl::set_ntp(&host, enabled)
        .await
        .map_err(map_err)
}

// ── Chrony ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn time_get_chrony_config(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<ChronyConfig> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::chrony::get_chrony_config(&host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_chrony_add_server(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
    address: String,
    server_type: NtpServerType,
    iburst: bool,
    prefer: bool,
) -> CmdResult<()> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    let cfg = NtpServerConfig {
        address,
        server_type,
        iburst,
        prefer,
        minpoll: None,
        maxpoll: None,
        key: None,
    };
    crate::chrony::add_server(&host, &cfg)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_chrony_remove_server(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
    address: String,
) -> CmdResult<()> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::chrony::remove_server(&host, &address)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_chrony_get_sources(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<Vec<NtpSource>> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::chrony::get_sources(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn time_chrony_get_tracking(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<NtpStatus> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::chrony::get_tracking(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn time_chrony_makestep(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<()> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::chrony::makestep(&host).await.map_err(map_err)
}

// ── ntpd ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn time_get_ntpd_config(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<NtpdConfig> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::ntpd::get_ntpd_config(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn time_ntpd_add_server(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
    address: String,
    server_type: NtpServerType,
    iburst: bool,
    prefer: bool,
) -> CmdResult<()> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    let cfg = NtpServerConfig {
        address,
        server_type,
        iburst,
        prefer,
        minpoll: None,
        maxpoll: None,
        key: None,
    };
    crate::ntpd::add_server(&host, &cfg).await.map_err(map_err)
}

#[tauri::command]
pub async fn time_ntpd_remove_server(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
    address: String,
) -> CmdResult<()> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::ntpd::remove_server(&host, &address)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_ntpd_get_peers(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<Vec<NtpPeer>> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::ntpd::get_peers(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn time_ntpd_get_status(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<NtpStatus> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::ntpd::get_status(&host).await.map_err(map_err)
}

// ── Hardware Clock ───────────────────────────────────────────────────

#[tauri::command]
pub async fn time_get_hwclock(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    let dt = crate::hwclock::get_hwclock(&host).await.map_err(map_err)?;
    Ok(dt.to_rfc3339())
}

#[tauri::command]
pub async fn time_sync_hwclock_from_system(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<()> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::hwclock::set_hwclock_from_system(&host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_sync_system_from_hwclock(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<()> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::hwclock::set_system_from_hwclock(&host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_get_hwclock_drift(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<f64> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::hwclock::get_hwclock_drift(&host)
        .await
        .map_err(map_err)
}

// ── Detection ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn time_detect_ntp(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<NtpImplementation> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::detect::detect_ntp_implementation(&host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn time_is_synced(
    state: State<'_, TimeNtpServiceState>,
    host_id: String,
) -> CmdResult<bool> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)?;
    crate::detect::is_ntp_synced(&host).await.map_err(map_err)
}
