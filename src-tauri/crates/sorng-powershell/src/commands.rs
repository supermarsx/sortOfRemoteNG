//! Tauri command handlers for the PowerShell Remoting crate.
//!
//! Every public function here is a `#[tauri::command]` that delegates
//! to `PsRemotingService` behind the `PsRemotingServiceState` mutex.

use crate::configuration::{NewSessionConfigurationParams, SetSessionConfigurationParams};
use crate::diagnostics::{FirewallRuleInfo, LatencyResult, WinRmServiceStatus};
use crate::direct::HyperVVmInfo;
use crate::service::{PsRemotingServiceState, PsRemotingStats};
use crate::types::*;
use tauri::State;

// ─── Session Commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn ps_new_session(
    state: State<'_, PsRemotingServiceState>,
    config: PsRemotingConfig,
    name: Option<String>,
) -> Result<PsSession, String> {
    let mut svc = state.lock().await;
    svc.new_session(config, name).await
}

#[tauri::command]
pub async fn ps_get_session(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<PsSession, String> {
    let svc = state.lock().await;
    svc.get_session(&session_id)
}

#[tauri::command]
pub async fn ps_list_sessions(
    state: State<'_, PsRemotingServiceState>,
) -> Result<Vec<PsSession>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn ps_disconnect_session(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_session(&session_id).await
}

#[tauri::command]
pub async fn ps_reconnect_session(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reconnect_session(&session_id).await
}

#[tauri::command]
pub async fn ps_remove_session(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_session(&session_id).await
}

#[tauri::command]
pub async fn ps_remove_all_sessions(
    state: State<'_, PsRemotingServiceState>,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    svc.remove_all_sessions().await
}

// ─── Command Execution ──────────────────────────────────────────────

#[tauri::command]
pub async fn ps_invoke_command(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    params: PsInvokeCommandParams,
) -> Result<PsCommandOutput, String> {
    let mut svc = state.lock().await;
    svc.invoke_command(&session_id, params).await
}

#[tauri::command]
pub async fn ps_invoke_command_fanout(
    state: State<'_, PsRemotingServiceState>,
    session_ids: Vec<String>,
    params: PsInvokeCommandParams,
) -> Result<Vec<Result<PsCommandOutput, String>>, String> {
    let mut svc = state.lock().await;
    Ok(svc.invoke_command_fanout(&session_ids, params).await)
}

#[tauri::command]
pub async fn ps_stop_command(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    command_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.stop_command(&session_id, &command_id).await
}

// ─── Interactive Sessions ───────────────────────────────────────────

#[tauri::command]
pub async fn ps_enter_session(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.enter_session(&session_id).await
}

#[tauri::command]
pub async fn ps_execute_interactive_line(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    line: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.execute_interactive_line(&session_id, &line).await
}

#[tauri::command]
pub async fn ps_tab_complete(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    partial: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.tab_complete(&session_id, &partial).await
}

#[tauri::command]
pub async fn ps_exit_session(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.exit_session(&session_id).await
}

// ─── File Transfer ──────────────────────────────────────────────────

#[tauri::command]
pub async fn ps_copy_to_session(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    params: PsFileCopyParams,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.copy_to_session(&session_id, params).await
}

#[tauri::command]
pub async fn ps_copy_from_session(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    params: PsFileCopyParams,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.copy_from_session(&session_id, params).await
}

#[tauri::command]
pub async fn ps_get_transfer_progress(
    state: State<'_, PsRemotingServiceState>,
    transfer_id: String,
) -> Result<PsFileTransferProgress, String> {
    let svc = state.lock().await;
    svc.get_transfer_progress(&transfer_id)
}

#[tauri::command]
pub async fn ps_cancel_transfer(
    state: State<'_, PsRemotingServiceState>,
    transfer_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.cancel_transfer(&transfer_id)
}

#[tauri::command]
pub async fn ps_list_transfers(
    state: State<'_, PsRemotingServiceState>,
) -> Result<Vec<PsFileTransferProgress>, String> {
    let svc = state.lock().await;
    Ok(svc.list_transfers())
}

// ─── CIM Commands ───────────────────────────────────────────────────

#[tauri::command]
pub async fn ps_new_cim_session(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    config: CimSessionConfig,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.new_cim_session(&session_id, config).await
}

#[tauri::command]
pub async fn ps_get_cim_instances(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    cim_session_id: String,
    params: CimQueryParams,
) -> Result<Vec<CimInstance>, String> {
    let svc = state.lock().await;
    svc.get_cim_instances(&session_id, &cim_session_id, params)
        .await
}

#[tauri::command]
pub async fn ps_invoke_cim_method(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    cim_session_id: String,
    params: CimMethodParams,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.invoke_cim_method(&session_id, &cim_session_id, params)
        .await
}

#[tauri::command]
pub async fn ps_remove_cim_session(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    cim_session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_cim_session(&session_id, &cim_session_id).await
}

// ─── DSC Commands ───────────────────────────────────────────────────

#[tauri::command]
pub async fn ps_test_dsc_configuration(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<DscResult, String> {
    let svc = state.lock().await;
    svc.test_dsc_configuration(&session_id).await
}

#[tauri::command]
pub async fn ps_get_dsc_configuration(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<Vec<DscResourceState>, String> {
    let svc = state.lock().await;
    svc.get_dsc_configuration(&session_id).await
}

#[tauri::command]
pub async fn ps_start_dsc_configuration(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    configuration: DscConfiguration,
) -> Result<DscResult, String> {
    let svc = state.lock().await;
    svc.start_dsc_configuration(&session_id, &configuration)
        .await
}

#[tauri::command]
pub async fn ps_get_dsc_resources(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let svc = state.lock().await;
    svc.get_dsc_resources(&session_id).await
}

// ─── JEA Commands ───────────────────────────────────────────────────

#[tauri::command]
pub async fn ps_register_jea_endpoint(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    endpoint: JeaEndpoint,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.register_jea_endpoint(&session_id, &endpoint).await
}

#[tauri::command]
pub async fn ps_unregister_jea_endpoint(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    endpoint_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unregister_jea_endpoint(&session_id, &endpoint_name)
        .await
}

#[tauri::command]
pub async fn ps_list_jea_endpoints(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<Vec<PsSessionConfiguration>, String> {
    let svc = state.lock().await;
    svc.list_jea_endpoints(&session_id).await
}

#[tauri::command]
pub async fn ps_create_jea_role_capability(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    role_name: String,
    capability: JeaRoleCapability,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.create_jea_role_capability(&session_id, &role_name, &capability)
        .await
}

// ─── PowerShell Direct Commands ─────────────────────────────────────

#[tauri::command]
pub async fn ps_list_vms(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<Vec<HyperVVmInfo>, String> {
    let svc = state.lock().await;
    svc.list_vms(&session_id).await
}

#[tauri::command]
pub async fn ps_invoke_command_vm(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    config: PsDirectConfig,
    script: String,
) -> Result<PsCommandOutput, String> {
    let svc = state.lock().await;
    svc.invoke_command_vm(&session_id, &config, &script).await
}

#[tauri::command]
pub async fn ps_copy_to_vm(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    config: PsDirectConfig,
    source: String,
    destination: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.copy_to_vm(&session_id, &config, &source, &destination)
        .await
}

// ─── Configuration Commands ─────────────────────────────────────────

#[tauri::command]
pub async fn ps_get_session_configurations(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<Vec<PsSessionConfiguration>, String> {
    let svc = state.lock().await;
    svc.get_session_configurations(&session_id).await
}

#[tauri::command]
pub async fn ps_register_session_configuration(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    config: NewSessionConfigurationParams,
) -> Result<(), String> {
    let svc = state.lock().await;
    crate::configuration::PsConfigurationManager::register_configuration(
        &svc.sessions,
        &session_id,
        &config,
    )
    .await
}

#[tauri::command]
pub async fn ps_unregister_session_configuration(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    config_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    crate::configuration::PsConfigurationManager::unregister_configuration(
        &svc.sessions,
        &session_id,
        &config_name,
    )
    .await
}

#[tauri::command]
pub async fn ps_enable_session_configuration(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    config_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    crate::configuration::PsConfigurationManager::enable_configuration(
        &svc.sessions,
        &session_id,
        &config_name,
    )
    .await
}

#[tauri::command]
pub async fn ps_disable_session_configuration(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    config_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    crate::configuration::PsConfigurationManager::disable_configuration(
        &svc.sessions,
        &session_id,
        &config_name,
    )
    .await
}

#[tauri::command]
pub async fn ps_set_session_configuration(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    config_name: String,
    params: SetSessionConfigurationParams,
) -> Result<(), String> {
    let svc = state.lock().await;
    crate::configuration::PsConfigurationManager::set_configuration(
        &svc.sessions,
        &session_id,
        &config_name,
        &params,
    )
    .await
}

#[tauri::command]
pub async fn ps_get_winrm_config(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_winrm_config(&session_id).await
}

#[tauri::command]
pub async fn ps_get_trusted_hosts(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.get_trusted_hosts(&session_id).await
}

#[tauri::command]
pub async fn ps_set_trusted_hosts(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    hosts: Vec<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_trusted_hosts(&session_id, &hosts).await
}

// ─── Diagnostics Commands ───────────────────────────────────────────

#[tauri::command]
pub async fn ps_test_wsman(
    state: State<'_, PsRemotingServiceState>,
    config: PsRemotingConfig,
) -> Result<PsDiagnosticResult, String> {
    let svc = state.lock().await;
    svc.test_wsman(&config).await
}

#[tauri::command]
pub async fn ps_diagnose_connection(
    state: State<'_, PsRemotingServiceState>,
    config: PsRemotingConfig,
) -> Result<PsDiagnosticResult, String> {
    let svc = state.lock().await;
    svc.diagnose_connection(&config).await
}

#[tauri::command]
pub async fn ps_check_winrm_service(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<WinRmServiceStatus, String> {
    let svc = state.lock().await;
    svc.check_winrm_service(&session_id).await
}

#[tauri::command]
pub async fn ps_check_firewall_rules(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<Vec<FirewallRuleInfo>, String> {
    let svc = state.lock().await;
    svc.check_firewall_rules(&session_id).await
}

#[tauri::command]
pub async fn ps_measure_latency(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
    iterations: Option<u32>,
) -> Result<LatencyResult, String> {
    let svc = state.lock().await;
    svc.measure_latency(&session_id, iterations.unwrap_or(10))
        .await
}

#[tauri::command]
pub async fn ps_get_certificate_info(
    state: State<'_, PsRemotingServiceState>,
    session_id: String,
) -> Result<Vec<PsCertificateInfo>, String> {
    let svc = state.lock().await;
    svc.get_certificate_info(&session_id).await
}

// ─── Service Stats & Events ─────────────────────────────────────────

#[tauri::command]
pub async fn ps_get_stats(
    state: State<'_, PsRemotingServiceState>,
) -> Result<PsRemotingStats, String> {
    let svc = state.lock().await;
    Ok(svc.get_stats())
}

#[tauri::command]
pub async fn ps_get_events(
    state: State<'_, PsRemotingServiceState>,
    limit: Option<usize>,
) -> Result<Vec<PsRemotingEvent>, String> {
    let svc = state.lock().await;
    Ok(svc.get_events(limit))
}

#[tauri::command]
pub async fn ps_clear_events(
    state: State<'_, PsRemotingServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.clear_events();
    Ok(())
}

#[tauri::command]
pub async fn ps_cleanup(
    state: State<'_, PsRemotingServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.cleanup().await
}
