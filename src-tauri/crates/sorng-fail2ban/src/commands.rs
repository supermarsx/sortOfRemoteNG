// Tauri commands — async wrappers for the Fail2ban service.

use super::error::err_str;
use super::filters::FilterTestResult;
use super::logs::LogFileInfo;
use super::service::Fail2banServiceState;
use super::stats::{HourlyBanCount, LogStats};
use super::types::{
    ActionDef, BannedIpSummary, Fail2banHost, Fail2banStats, FilterRule, Jail, LogEntry,
};
use tauri::State;

// ─── Host Management ────────────────────────────────────────────────

#[tauri::command]
pub async fn f2b_add_host(
    state: State<'_, Fail2banServiceState>,
    host: Fail2banHost,
) -> Result<(), String> {
    state.lock().await.add_host(host).map_err(err_str)
}

#[tauri::command]
pub async fn f2b_update_host(
    state: State<'_, Fail2banServiceState>,
    host: Fail2banHost,
) -> Result<(), String> {
    state.lock().await.update_host(host).map_err(err_str)
}

#[tauri::command]
pub async fn f2b_remove_host(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<Fail2banHost, String> {
    state.lock().await.remove_host(&host_id).map_err(err_str)
}

#[tauri::command]
pub async fn f2b_list_hosts(
    state: State<'_, Fail2banServiceState>,
) -> Result<Vec<Fail2banHost>, String> {
    Ok(state.lock().await.list_hosts())
}

#[tauri::command]
pub async fn f2b_get_host(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<Fail2banHost, String> {
    state.lock().await.clone_host(&host_id).map_err(err_str)
}

// ─── Connection / Server ────────────────────────────────────────────

#[tauri::command]
pub async fn f2b_ping(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<bool, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::client::ping(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_version(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<String, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::client::version(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_server_status(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<String, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::client::server_status(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_reload(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::client::reload(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_reload_jail(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::client::reload_jail(&host, &jail_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_restart_server(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::client::restart_server(&host).await.map_err(err_str)
}

// ─── Jails ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn f2b_list_jails(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::jails::list_jails(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_jail_status(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
) -> Result<Jail, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::jails::jail_status(&host, &jail_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_all_jail_statuses(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<Vec<Jail>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::jails::all_jail_statuses(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_start_jail(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::jails::start_jail(&host, &jail_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_stop_jail(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::jails::stop_jail(&host, &jail_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_restart_jail(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::jails::restart_jail(&host, &jail_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_set_jail_bantime(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
    seconds: i64,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::jails::set_bantime(&host, &jail_name, seconds)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_set_jail_maxretry(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
    count: u32,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::jails::set_maxretry(&host, &jail_name, count)
        .await
        .map_err(err_str)
}

// ─── Bans ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn f2b_ban_ip(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
    ip: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::bans::ban_ip(&host, &jail_name, &ip)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_unban_ip(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
    ip: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::bans::unban_ip(&host, &jail_name, &ip)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_unban_ip_all(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    ip: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::bans::unban_ip_all(&host, &ip)
        .await
        .map(|_| ())
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_list_banned(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
) -> Result<Vec<super::types::BanRecord>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::bans::list_banned(&host, &jail_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_list_all_banned(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<Vec<super::types::BanRecord>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::bans::list_all_banned(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_is_banned(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
    ip: String,
) -> Result<bool, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::bans::is_banned(&host, &ip)
        .await
        .map(|jails| jails.iter().any(|j| j == &jail_name))
        .map_err(err_str)
}

// ─── Filters ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn f2b_list_filters(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::filters::list_filters(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_read_filter(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    filter_name: String,
) -> Result<FilterRule, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::filters::read_filter(&host, &filter_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_test_filter(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    log_file: String,
    filter_name: String,
) -> Result<FilterTestResult, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::filters::test_filter(&host, &log_file, &filter_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_test_regex(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    log_file: String,
    regex: String,
) -> Result<FilterTestResult, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::filters::test_regex(&host, &log_file, &regex)
        .await
        .map_err(err_str)
}

// ─── Actions ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn f2b_list_actions(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::actions::list_actions(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_read_action(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    action_name: String,
) -> Result<ActionDef, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::actions::read_action(&host, &action_name)
        .await
        .map_err(err_str)
}

// ─── Whitelist ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn f2b_list_ignored(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
) -> Result<Vec<String>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::whitelist::list_ignored(&host, &jail_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_add_ignored(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
    ip: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::whitelist::add_ignored(&host, &jail_name, &ip)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_remove_ignored(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
    ip: String,
) -> Result<(), String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::whitelist::remove_ignored(&host, &jail_name, &ip)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_add_ignored_all_jails(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    ip: String,
) -> Result<Vec<String>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::whitelist::add_ignored_all_jails(&host, &ip)
        .await
        .map_err(err_str)
}

// ─── Logs ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn f2b_tail_log(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    lines: u32,
) -> Result<Vec<LogEntry>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::logs::tail_log(&host, lines, None)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_search_log_by_ip(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    ip: String,
) -> Result<Vec<LogEntry>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::logs::search_by_ip(&host, &ip, None)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_search_log_by_jail(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    jail_name: String,
) -> Result<Vec<LogEntry>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::logs::search_by_jail(&host, &jail_name, None)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_search_bans(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<Vec<LogEntry>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::logs::search_bans(&host, None).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_log_info(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<LogFileInfo, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::logs::log_info(&host, None).await.map_err(err_str)
}

// ─── Statistics ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn f2b_host_stats(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<Fail2banStats, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::stats::host_stats(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_top_banned_ips(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
    limit: usize,
) -> Result<Vec<BannedIpSummary>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::stats::top_banned_ips(&host, limit)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn f2b_log_stats(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<LogStats, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::stats::log_stats(&host, None).await.map_err(err_str)
}

#[tauri::command]
pub async fn f2b_ban_frequency(
    state: State<'_, Fail2banServiceState>,
    host_id: String,
) -> Result<Vec<HourlyBanCount>, String> {
    let host = state.lock().await.clone_host(&host_id).map_err(err_str)?;
    super::stats::ban_frequency(&host, None)
        .await
        .map_err(err_str)
}
