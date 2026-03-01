//! Tauri command bindings for the MeshCentral crate.
//!
//! Thin wrappers that take `State<MeshCentralServiceState>`, lock the mutex,
//! and delegate to the service. Every command returns `Result<T, String>`.

use crate::meshcentral::service::MeshCentralServiceState;
use crate::meshcentral::types::*;

// ── Connection / session ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_connect(
    state: tauri::State<'_, MeshCentralServiceState>,
    config: McConnectionConfig,
) -> Result<McSession, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_disconnect(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_disconnect_all(
    state: tauri::State<'_, MeshCentralServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_get_session_info(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<McSession, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_list_sessions(
    state: tauri::State<'_, MeshCentralServiceState>,
) -> Result<Vec<McSession>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn mc_ping(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.ping(&session_id).await.map_err(|e| e.to_string())
}

// ── Server ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_get_server_info(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<McServerInfo, String> {
    let svc = state.lock().await;
    svc.get_server_info(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_get_server_version(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_server_version(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_health_check(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.health_check(&session_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Devices ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_list_devices(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    filter: Option<McDeviceFilter>,
) -> Result<Vec<McDevice>, String> {
    let svc = state.lock().await;
    svc.list_devices(&session_id, filter.as_ref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_get_device_info(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    node_id: String,
) -> Result<McDevice, String> {
    let svc = state.lock().await;
    svc.get_device_info(&session_id, &node_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_add_local_device(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    device: McAddLocalDevice,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.add_local_device(&session_id, &device)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_add_amt_device(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    device: McAddAmtDevice,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.add_amt_device(&session_id, &device)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_edit_device(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    edit: McEditDevice,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.edit_device(&session_id, &edit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_remove_devices(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    node_ids: Vec<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.remove_devices(&session_id, &node_ids)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_move_device_to_group(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    node_id: String,
    mesh_id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.move_device_to_group(&session_id, &node_id, &mesh_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Device Groups ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_list_device_groups(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<Vec<McDeviceGroup>, String> {
    let svc = state.lock().await;
    svc.list_device_groups(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_create_device_group(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    create: McCreateDeviceGroup,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.create_device_group(&session_id, &create)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_edit_device_group(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    edit: McEditDeviceGroup,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.edit_device_group(&session_id, &edit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_remove_device_group(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    mesh_id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.remove_device_group(&session_id, &mesh_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Users ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_list_users(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<Vec<McUser>, String> {
    let svc = state.lock().await;
    svc.list_users(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_add_user(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    user: McAddUser,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.add_user(&session_id, &user)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_edit_user(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    edit: McEditUser,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.edit_user(&session_id, &edit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_remove_user(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    user_id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.remove_user(&session_id, &user_id)
        .await
        .map_err(|e| e.to_string())
}

// ── User Groups ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_list_user_groups(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<Vec<McUserGroup>, String> {
    let svc = state.lock().await;
    svc.list_user_groups(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_create_user_group(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    name: String,
    desc: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.create_user_group(&session_id, &name, desc.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_remove_user_group(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    group_id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.remove_user_group(&session_id, &group_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Power ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_power_action(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    node_ids: Vec<String>,
    action: McPowerAction,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.power_action(&session_id, &node_ids, action)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_wake_devices(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    node_ids: Vec<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.wake_devices(&session_id, &node_ids)
        .await
        .map_err(|e| e.to_string())
}

// ── Remote Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_run_commands(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    cmd: McRunCommand,
) -> Result<McCommandResult, String> {
    let svc = state.lock().await;
    svc.run_commands(&session_id, &cmd)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_run_command_on_device(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    node_id: String,
    command: String,
    powershell: bool,
    run_as_user: bool,
) -> Result<McCommandResult, String> {
    let svc = state.lock().await;
    svc.run_command_on_device(&session_id, &node_id, &command, powershell, run_as_user)
        .await
        .map_err(|e| e.to_string())
}

// ── File Transfer ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_upload_file(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    upload: McFileUpload,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.upload_file(&session_id, &upload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_download_file(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    download: McFileDownload,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.download_file(&session_id, &download)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_get_transfer_progress(
    state: tauri::State<'_, MeshCentralServiceState>,
    transfer_id: String,
) -> Result<Option<McFileTransferProgress>, String> {
    let svc = state.lock().await;
    Ok(svc.get_transfer_progress(&transfer_id))
}

#[tauri::command]
pub async fn mc_get_active_transfers(
    state: tauri::State<'_, MeshCentralServiceState>,
) -> Result<Vec<McFileTransferProgress>, String> {
    let svc = state.lock().await;
    Ok(svc.get_active_transfers())
}

#[tauri::command]
pub async fn mc_cancel_transfer(
    state: tauri::State<'_, MeshCentralServiceState>,
    transfer_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cancel_transfer(&transfer_id);
    Ok(())
}

// ── Events ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_list_events(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    filter: Option<McEventFilter>,
) -> Result<Vec<McEvent>, String> {
    let svc = state.lock().await;
    svc.list_events(&session_id, filter.as_ref())
        .await
        .map_err(|e| e.to_string())
}

// ── Sharing ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_create_device_share(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    share: McCreateShare,
) -> Result<McDeviceShare, String> {
    let svc = state.lock().await;
    svc.create_device_share(&session_id, &share)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_list_device_shares(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    node_id: String,
) -> Result<Vec<McDeviceShare>, String> {
    let svc = state.lock().await;
    svc.list_device_shares(&session_id, &node_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_remove_device_share(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    node_id: String,
    share_id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.remove_device_share(&session_id, &node_id, &share_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Messaging ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_send_toast(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    toast: McDeviceToast,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.send_toast(&session_id, &toast)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_send_message_box(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    msg: McDeviceMessage,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.send_message_box(&session_id, &msg)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_send_open_url(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    open: McDeviceOpenUrl,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.send_open_url(&session_id, &open)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_broadcast_message(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    broadcast: McBroadcast,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.broadcast_message(&session_id, &broadcast)
        .await
        .map_err(|e| e.to_string())
}

// ── Agents ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_download_agent_to_file(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    download: McAgentDownload,
    output_path: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.download_agent_to_file(&session_id, &download, &output_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_send_invite_email(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    invite: McSendInviteEmail,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.send_invite_email(&session_id, &invite)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mc_generate_invite_link(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    invite: McGenerateInviteLink,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.generate_invite_link(&session_id, &invite)
        .await
        .map_err(|e| e.to_string())
}

// ── Reports ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_generate_report(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    report: McGenerateReport,
) -> Result<McReport, String> {
    let svc = state.lock().await;
    svc.generate_report(&session_id, &report)
        .await
        .map_err(|e| e.to_string())
}

// ── Web Relay ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mc_create_web_relay(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    relay: McWebRelay,
) -> Result<McWebRelayResult, String> {
    let svc = state.lock().await;
    svc.create_web_relay(&session_id, &relay)
        .await
        .map_err(|e| e.to_string())
}
