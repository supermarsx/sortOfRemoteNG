//! Tauri command handlers for the Windows Management crate.
//!
//! Each command acquires the `WinMgmtServiceState` lock, retrieves the
//! appropriate transport, and delegates to the domain-specific manager.

use crate::eventlog::EventLogManager;
use crate::perfmon::PerfMonManager;
use crate::processes::ProcessManager;
use crate::registry::RegistryManager;
use crate::scheduled_tasks::ScheduledTaskManager;
use crate::service::{SessionSummary, WinMgmtConfig, WinMgmtServiceState};
use crate::services::ServiceManager;
use crate::system_info::{QuickSystemSummary, SystemInfoManager};
use crate::types::*;
use std::collections::HashMap;
use tauri::State;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn winmgmt_connect(
    state: State<'_, WinMgmtServiceState>,
    config: WmiConnectionConfig,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await
}

#[tauri::command]
pub async fn winmgmt_disconnect(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id)
}

#[tauri::command]
pub async fn winmgmt_disconnect_all(
    state: State<'_, WinMgmtServiceState>,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    Ok(svc.disconnect_all())
}

#[tauri::command]
pub async fn winmgmt_list_sessions(
    state: State<'_, WinMgmtServiceState>,
) -> Result<Vec<SessionSummary>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn winmgmt_get_config(
    state: State<'_, WinMgmtServiceState>,
) -> Result<WinMgmtConfig, String> {
    let svc = state.lock().await;
    Ok(svc.config().clone())
}

#[tauri::command]
pub async fn winmgmt_set_config(
    state: State<'_, WinMgmtServiceState>,
    config: WinMgmtConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_config(config);
    Ok(())
}

#[tauri::command]
pub async fn winmgmt_raw_query(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    query: String,
) -> Result<Vec<HashMap<String, String>>, String> {
    let mut svc = state.lock().await;
    svc.raw_query(&session_id, &query).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Services
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn winmgmt_list_services(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<Vec<WindowsService>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::list_services(transport).await
}

#[tauri::command]
pub async fn winmgmt_get_service(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
) -> Result<WindowsService, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::get_service(transport, &name).await
}

#[tauri::command]
pub async fn winmgmt_search_services(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    pattern: String,
) -> Result<Vec<WindowsService>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::search_services(transport, &pattern).await
}

#[tauri::command]
pub async fn winmgmt_start_service(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::start_service(transport, &name).await
}

#[tauri::command]
pub async fn winmgmt_stop_service(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::stop_service(transport, &name).await
}

#[tauri::command]
pub async fn winmgmt_restart_service(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::restart_service(transport, &name).await
}

#[tauri::command]
pub async fn winmgmt_pause_service(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::pause_service(transport, &name).await
}

#[tauri::command]
pub async fn winmgmt_resume_service(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::resume_service(transport, &name).await
}

#[tauri::command]
pub async fn winmgmt_set_service_start_mode(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
    start_mode: ServiceStartMode,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::set_start_mode(transport, &name, &start_mode).await
}

#[tauri::command]
pub async fn winmgmt_delete_service(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::delete_service(transport, &name).await
}

#[tauri::command]
pub async fn winmgmt_services_by_state(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    svc_state: String,
) -> Result<Vec<WindowsService>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::services_by_state(transport, &svc_state).await
}

#[tauri::command]
pub async fn winmgmt_get_service_dependencies(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ServiceManager::get_dependencies(transport, &name).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Event Log
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn winmgmt_list_event_logs(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<Vec<EventLogInfo>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    EventLogManager::list_logs(transport).await
}

#[tauri::command]
pub async fn winmgmt_query_events(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    filter: EventLogFilter,
) -> Result<Vec<EventLogEntry>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    EventLogManager::query_events(transport, &filter).await
}

#[tauri::command]
pub async fn winmgmt_recent_events(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    log_name: String,
    count: u32,
) -> Result<Vec<EventLogEntry>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    EventLogManager::recent_events(transport, &log_name, count).await
}

#[tauri::command]
pub async fn winmgmt_error_events(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    log_name: String,
    count: u32,
) -> Result<Vec<EventLogEntry>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    EventLogManager::error_events(transport, &log_name, count).await
}

#[tauri::command]
pub async fn winmgmt_events_by_source(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    log_name: String,
    source: String,
    count: u32,
) -> Result<Vec<EventLogEntry>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    EventLogManager::events_by_source(transport, &log_name, &source, count).await
}

#[tauri::command]
pub async fn winmgmt_clear_event_log(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    log_name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    EventLogManager::clear_log(transport, &log_name).await
}

#[tauri::command]
pub async fn winmgmt_backup_event_log(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    log_name: String,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    EventLogManager::backup_log(transport, &log_name, &path).await
}

#[tauri::command]
pub async fn winmgmt_event_statistics(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    log_name: String,
) -> Result<HashMap<String, u64>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    EventLogManager::event_statistics(transport, &log_name).await
}

#[tauri::command]
pub async fn winmgmt_export_events_csv(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    filter: EventLogFilter,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    let events = EventLogManager::query_events(transport, &filter).await?;
    Ok(EventLogManager::export_events_csv(&events))
}

#[tauri::command]
pub async fn winmgmt_export_events_json(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    filter: EventLogFilter,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    let events = EventLogManager::query_events(transport, &filter).await?;
    EventLogManager::export_events_json(&events)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Processes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn winmgmt_list_processes(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<Vec<WindowsProcess>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::list_processes(transport).await
}

#[tauri::command]
pub async fn winmgmt_get_process(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    pid: u32,
) -> Result<WindowsProcess, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::get_process(transport, pid).await
}

#[tauri::command]
pub async fn winmgmt_processes_by_name(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
) -> Result<Vec<WindowsProcess>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::processes_by_name(transport, &name).await
}

#[tauri::command]
pub async fn winmgmt_search_processes(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    pattern: String,
) -> Result<Vec<WindowsProcess>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::search_processes(transport, &pattern).await
}

#[tauri::command]
pub async fn winmgmt_create_process(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    params: CreateProcessParams,
) -> Result<CreateProcessResult, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::create_process(transport, &params).await
}

#[tauri::command]
pub async fn winmgmt_terminate_process(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    pid: u32,
    reason: Option<u32>,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::terminate_process(transport, pid, reason).await
}

#[tauri::command]
pub async fn winmgmt_terminate_by_name(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    name: String,
) -> Result<Vec<(u32, Result<u32, String>)>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::terminate_by_name(transport, &name).await
}

#[tauri::command]
pub async fn winmgmt_set_process_priority(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    pid: u32,
    priority: u32,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::set_priority(transport, pid, priority).await
}

#[tauri::command]
pub async fn winmgmt_get_process_owner(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    pid: u32,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::get_process_owner(transport, pid).await
}

#[tauri::command]
pub async fn winmgmt_process_tree(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<Vec<crate::processes::ProcessTreeNode>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::get_process_tree(transport).await
}

#[tauri::command]
pub async fn winmgmt_process_statistics(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<crate::processes::ProcessStatistics, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ProcessManager::process_statistics(transport).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Performance Monitoring
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn winmgmt_perf_snapshot(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    config: Option<PerfMonitorConfig>,
) -> Result<SystemPerformanceSnapshot, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    let cfg = config.unwrap_or_default();
    PerfMonManager::collect_snapshot(transport, &cfg).await
}

#[tauri::command]
pub async fn winmgmt_perf_cpu(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    include_per_core: Option<bool>,
) -> Result<CpuPerformance, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    PerfMonManager::collect_cpu(transport, include_per_core.unwrap_or(false)).await
}

#[tauri::command]
pub async fn winmgmt_perf_memory(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<MemoryPerformance, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    PerfMonManager::collect_memory(transport).await
}

#[tauri::command]
pub async fn winmgmt_perf_disks(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<Vec<DiskPerformance>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    PerfMonManager::collect_disks(transport).await
}

#[tauri::command]
pub async fn winmgmt_perf_network(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<Vec<NetworkPerformance>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    PerfMonManager::collect_network(transport).await
}

#[tauri::command]
pub async fn winmgmt_perf_quick_health(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<crate::perfmon::QuickHealthSummary, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    PerfMonManager::quick_health(transport).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Registry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn winmgmt_registry_enum_keys(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    hive: RegistryHive,
    path: String,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    RegistryManager::enum_keys(transport, &hive, &path).await
}

#[tauri::command]
pub async fn winmgmt_registry_enum_values(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    hive: RegistryHive,
    path: String,
) -> Result<Vec<(String, RegistryValueType)>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    RegistryManager::enum_values(transport, &hive, &path).await
}

#[tauri::command]
pub async fn winmgmt_registry_get_value(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    hive: RegistryHive,
    path: String,
    name: String,
) -> Result<RegistryValue, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    RegistryManager::get_value(transport, &hive, &path, &name).await
}

#[tauri::command]
pub async fn winmgmt_registry_get_key_info(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    hive: RegistryHive,
    path: String,
) -> Result<RegistryKeyInfo, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    RegistryManager::get_key_info(transport, &hive, &path).await
}

#[tauri::command]
pub async fn winmgmt_registry_set_string(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    hive: RegistryHive,
    path: String,
    name: String,
    value: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    RegistryManager::set_string_value(transport, &hive, &path, &name, &value).await
}

#[tauri::command]
pub async fn winmgmt_registry_set_dword(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    hive: RegistryHive,
    path: String,
    name: String,
    value: u32,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    RegistryManager::set_dword_value(transport, &hive, &path, &name, value).await
}

#[tauri::command]
pub async fn winmgmt_registry_create_key(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    hive: RegistryHive,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    RegistryManager::create_key(transport, &hive, &path).await
}

#[tauri::command]
pub async fn winmgmt_registry_delete_key(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    hive: RegistryHive,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    RegistryManager::delete_key(transport, &hive, &path).await
}

#[tauri::command]
pub async fn winmgmt_registry_delete_value(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    hive: RegistryHive,
    path: String,
    name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    RegistryManager::delete_value(transport, &hive, &path, &name).await
}

#[tauri::command]
pub async fn winmgmt_registry_key_exists(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    hive: RegistryHive,
    path: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    RegistryManager::key_exists(transport, &hive, &path).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Scheduled Tasks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn winmgmt_list_tasks(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<Vec<ScheduledTask>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ScheduledTaskManager::list_tasks(transport).await
}

#[tauri::command]
pub async fn winmgmt_get_task(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    task_path: String,
    task_name: String,
) -> Result<ScheduledTask, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ScheduledTaskManager::get_task(transport, &task_path, &task_name).await
}

#[tauri::command]
pub async fn winmgmt_search_tasks(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    pattern: String,
) -> Result<Vec<ScheduledTask>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ScheduledTaskManager::search_tasks(transport, &pattern).await
}

#[tauri::command]
pub async fn winmgmt_enable_task(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    task_path: String,
    task_name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ScheduledTaskManager::enable_task(transport, &task_path, &task_name).await
}

#[tauri::command]
pub async fn winmgmt_disable_task(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    task_path: String,
    task_name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ScheduledTaskManager::disable_task(transport, &task_path, &task_name).await
}

#[tauri::command]
pub async fn winmgmt_run_task(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    task_path: String,
    task_name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ScheduledTaskManager::run_task(transport, &task_path, &task_name).await
}

#[tauri::command]
pub async fn winmgmt_stop_task(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
    task_path: String,
    task_name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    ScheduledTaskManager::stop_task(transport, &task_path, &task_name).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  System Info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn winmgmt_system_info(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<SystemInfo, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    SystemInfoManager::get_system_info(transport).await
}

#[tauri::command]
pub async fn winmgmt_quick_summary(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<QuickSystemSummary, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    SystemInfoManager::quick_summary(transport).await
}

#[tauri::command]
pub async fn winmgmt_os_info(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<OperatingSystemInfo, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    SystemInfoManager::get_operating_system(transport).await
}

#[tauri::command]
pub async fn winmgmt_processors_info(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<Vec<ProcessorInfo>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    SystemInfoManager::get_processors(transport).await
}

#[tauri::command]
pub async fn winmgmt_logical_disks(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<Vec<LogicalDiskInfo>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    SystemInfoManager::get_logical_disks(transport).await
}

#[tauri::command]
pub async fn winmgmt_network_adapters(
    state: State<'_, WinMgmtServiceState>,
    session_id: String,
) -> Result<Vec<NetworkAdapterInfo>, String> {
    let mut svc = state.lock().await;
    let transport = svc.get_transport(&session_id)?;
    SystemInfoManager::get_network_adapters(transport).await
}
