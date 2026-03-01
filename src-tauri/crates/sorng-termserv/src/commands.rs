//! Tauri command handlers for the Terminal Services Management crate.
//!
//! Each command acquires the `TermServServiceState` lock and delegates
//! to the service facade.  All commands are prefixed with `ts_`.

use crate::service::{TermServConfig, TermServServiceState};
use crate::types::*;
use tauri::State;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_get_config(
    state: State<'_, TermServServiceState>,
) -> Result<TermServConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

#[tauri::command]
pub async fn ts_set_config(
    state: State<'_, TermServServiceState>,
    config: TermServConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_config(config);
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Server handle management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_open_server(
    state: State<'_, TermServServiceState>,
    server_name: String,
) -> Result<ServerHandle, String> {
    let mut svc = state.lock().await;
    svc.open_server(&server_name)
}

#[tauri::command]
pub async fn ts_close_server(
    state: State<'_, TermServServiceState>,
    handle_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.close_server(&handle_id)
}

#[tauri::command]
pub async fn ts_close_all_servers(
    state: State<'_, TermServServiceState>,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    Ok(svc.close_all_servers())
}

#[tauri::command]
pub async fn ts_list_open_servers(
    state: State<'_, TermServServiceState>,
) -> Result<Vec<ServerHandle>, String> {
    let svc = state.lock().await;
    Ok(svc.list_open_servers())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Sessions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_list_sessions(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    state_filter: Option<SessionState>,
) -> Result<Vec<SessionEntry>, String> {
    let svc = state.lock().await;
    svc.list_sessions(handle_id, state_filter)
}

#[tauri::command]
pub async fn ts_list_user_sessions(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
) -> Result<Vec<SessionEntry>, String> {
    let svc = state.lock().await;
    svc.list_user_sessions(handle_id)
}

#[tauri::command]
pub async fn ts_get_session_detail(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_id: u32,
) -> Result<SessionDetail, String> {
    let svc = state.lock().await;
    svc.get_session_detail(handle_id, session_id)
}

#[tauri::command]
pub async fn ts_get_all_session_details(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
) -> Result<Vec<SessionDetail>, String> {
    let svc = state.lock().await;
    svc.get_all_session_details(handle_id)
}

#[tauri::command]
pub async fn ts_disconnect_session(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_id: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.disconnect_session(handle_id, session_id)
}

#[tauri::command]
pub async fn ts_logoff_session(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_id: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.logoff_session(handle_id, session_id)
}

#[tauri::command]
pub async fn ts_connect_session(
    state: State<'_, TermServServiceState>,
    logon_id: u32,
    target_logon_id: u32,
    password: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.connect_session(logon_id, target_logon_id, password)
}

#[tauri::command]
pub async fn ts_logoff_disconnected(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.logoff_disconnected(handle_id)
}

#[tauri::command]
pub async fn ts_find_sessions_by_user(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    user_pattern: String,
) -> Result<Vec<SessionDetail>, String> {
    let svc = state.lock().await;
    svc.find_sessions_by_user(handle_id, user_pattern)
}

#[tauri::command]
pub async fn ts_server_summary(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
) -> Result<TsServerSummary, String> {
    let svc = state.lock().await;
    svc.server_summary(handle_id)
}

#[tauri::command]
pub async fn ts_get_console_session_id(
    state: State<'_, TermServServiceState>,
) -> Result<u32, String> {
    let svc = state.lock().await;
    Ok(svc.get_console_session_id())
}

#[tauri::command]
pub async fn ts_get_current_session_id(
    state: State<'_, TermServServiceState>,
) -> Result<u32, String> {
    let svc = state.lock().await;
    Ok(svc.get_current_session_id())
}

#[tauri::command]
pub async fn ts_is_remote_session(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_id: u32,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.is_remote_session(handle_id, session_id)
}

#[tauri::command]
pub async fn ts_get_idle_seconds(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_id: u32,
) -> Result<Option<i64>, String> {
    let svc = state.lock().await;
    svc.get_idle_seconds(handle_id, session_id)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Processes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_list_processes(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
) -> Result<Vec<TsProcessInfo>, String> {
    let svc = state.lock().await;
    svc.list_processes(handle_id)
}

#[tauri::command]
pub async fn ts_list_session_processes(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_id: u32,
) -> Result<Vec<TsProcessInfo>, String> {
    let svc = state.lock().await;
    svc.list_session_processes(handle_id, session_id)
}

#[tauri::command]
pub async fn ts_find_processes_by_name(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    name_pattern: String,
) -> Result<Vec<TsProcessInfo>, String> {
    let svc = state.lock().await;
    svc.find_processes_by_name(handle_id, name_pattern)
}

#[tauri::command]
pub async fn ts_terminate_process(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    process_id: u32,
    exit_code: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.terminate_process(handle_id, process_id, exit_code)
}

#[tauri::command]
pub async fn ts_terminate_processes_by_name(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_id: u32,
    name_pattern: String,
    exit_code: u32,
) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.terminate_processes_by_name(handle_id, session_id, name_pattern, exit_code)
}

#[tauri::command]
pub async fn ts_process_count_per_session(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
) -> Result<Vec<(u32, usize)>, String> {
    let svc = state.lock().await;
    svc.process_count_per_session(handle_id)
}

#[tauri::command]
pub async fn ts_top_process_names(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    n: usize,
) -> Result<Vec<(String, usize)>, String> {
    let svc = state.lock().await;
    svc.top_process_names(handle_id, n)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Messaging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_send_message(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    params: SendMessageParams,
) -> Result<MessageResponse, String> {
    let svc = state.lock().await;
    svc.send_message(handle_id, params)
}

#[tauri::command]
pub async fn ts_send_info(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_id: u32,
    title: String,
    message: String,
) -> Result<MessageResponse, String> {
    let svc = state.lock().await;
    svc.send_info(handle_id, session_id, title, message)
}

#[tauri::command]
pub async fn ts_broadcast_message(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    title: String,
    message: String,
    timeout_seconds: u32,
) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.broadcast_message(handle_id, title, message, timeout_seconds)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Shadow / Remote Control
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_start_shadow(
    state: State<'_, TermServServiceState>,
    opts: ShadowOptions,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.start_shadow(opts)
}

#[tauri::command]
pub async fn ts_stop_shadow(
    state: State<'_, TermServServiceState>,
    session_id: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.stop_shadow(session_id)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Domain server discovery & shutdown
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_enumerate_domain_servers(
    state: State<'_, TermServServiceState>,
    domain: String,
) -> Result<Vec<TsServerInfo>, String> {
    let svc = state.lock().await;
    svc.enumerate_domain_servers(domain)
}

#[tauri::command]
pub async fn ts_shutdown_server(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    flag: ShutdownFlag,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.shutdown_server(handle_id, flag)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Listeners
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_list_listeners(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
) -> Result<Vec<TsListenerInfo>, String> {
    let svc = state.lock().await;
    svc.list_listeners(handle_id)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  User configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_query_user_config(
    state: State<'_, TermServServiceState>,
    server_name: String,
    user_name: String,
) -> Result<TsUserConfig, String> {
    let svc = state.lock().await;
    svc.query_user_config(&server_name, &user_name)
}

#[tauri::command]
pub async fn ts_set_user_config(
    state: State<'_, TermServServiceState>,
    config: TsUserConfig,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_user_config(&config)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Encryption & address
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_get_encryption_level(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_id: u32,
) -> Result<EncryptionLevel, String> {
    let svc = state.lock().await;
    svc.get_encryption_level(handle_id, session_id)
}

#[tauri::command]
pub async fn ts_get_session_address(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_id: u32,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.get_session_address(handle_id, session_id)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Filtered sessions & batch operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_list_sessions_filtered(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    filter: SessionFilter,
) -> Result<Vec<SessionDetail>, String> {
    let svc = state.lock().await;
    svc.list_sessions_filtered(handle_id, filter)
}

#[tauri::command]
pub async fn ts_batch_disconnect(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_ids: Vec<u32>,
) -> Result<BatchResult, String> {
    let svc = state.lock().await;
    svc.batch_disconnect(handle_id, session_ids)
}

#[tauri::command]
pub async fn ts_batch_logoff(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_ids: Vec<u32>,
) -> Result<BatchResult, String> {
    let svc = state.lock().await;
    svc.batch_logoff(handle_id, session_ids)
}

#[tauri::command]
pub async fn ts_batch_send_message(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    session_ids: Vec<u32>,
    title: String,
    message: String,
    timeout_seconds: u32,
) -> Result<BatchResult, String> {
    let svc = state.lock().await;
    svc.batch_send_message(handle_id, session_ids, title, message, timeout_seconds)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Event monitoring
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn ts_wait_system_event(
    state: State<'_, TermServServiceState>,
    handle_id: Option<String>,
    event_mask: u32,
) -> Result<TsEventRecord, String> {
    let svc = state.lock().await;
    svc.wait_system_event(handle_id, event_mask)
}
