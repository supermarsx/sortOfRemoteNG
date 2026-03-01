use super::service::RustDeskServiceState;
use super::types::*;

// ═══════════════════════════════════════════════════════════════════════
//  Binary / Client
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_is_available(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_available())
}

#[tauri::command]
pub async fn rustdesk_get_binary_info(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<RustDeskBinaryInfo, String> {
    let svc = state.lock().await;
    Ok(svc.get_binary_info().clone())
}

#[tauri::command]
pub async fn rustdesk_detect_version(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.detect_version().await
}

#[tauri::command]
pub async fn rustdesk_get_local_id(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_local_id().await
}

#[tauri::command]
pub async fn rustdesk_check_service_running(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.check_service_running().await)
}

#[tauri::command]
pub async fn rustdesk_install_service(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.install_service().await
}

#[tauri::command]
pub async fn rustdesk_silent_install(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.silent_install().await
}

#[tauri::command]
pub async fn rustdesk_set_permanent_password(
    state: tauri::State<'_, RustDeskServiceState>,
    password: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_permanent_password(&password).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Server Configuration
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_configure_server(
    state: tauri::State<'_, RustDeskServiceState>,
    config: RustDeskServerConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.configure_server(config);
    Ok(())
}

#[tauri::command]
pub async fn rustdesk_get_server_config(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<Option<RustDeskServerConfig>, String> {
    let svc = state.lock().await;
    Ok(svc.get_server_config().cloned())
}

#[tauri::command]
pub async fn rustdesk_set_client_config(
    state: tauri::State<'_, RustDeskServiceState>,
    config: RustDeskClientConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_client_config(config);
    Ok(())
}

#[tauri::command]
pub async fn rustdesk_get_client_config(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<Option<RustDeskClientConfig>, String> {
    let svc = state.lock().await;
    Ok(svc.get_client_config().cloned())
}

// ═══════════════════════════════════════════════════════════════════════
//  Connection Lifecycle
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_connect(
    state: tauri::State<'_, RustDeskServiceState>,
    request: RustDeskConnectRequest,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect(request).await
}

#[tauri::command]
pub async fn rustdesk_connect_direct_ip(
    state: tauri::State<'_, RustDeskServiceState>,
    ip: String,
    port: Option<u16>,
    password: Option<String>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect_direct_ip(&ip, port, password).await
}

#[tauri::command]
pub async fn rustdesk_disconnect(
    state: tauri::State<'_, RustDeskServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await
}

#[tauri::command]
pub async fn rustdesk_shutdown(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.shutdown().await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Sessions
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_get_session(
    state: tauri::State<'_, RustDeskServiceState>,
    session_id: String,
) -> Result<Option<RustDeskSession>, String> {
    let svc = state.lock().await;
    Ok(svc.get_session(&session_id))
}

#[tauri::command]
pub async fn rustdesk_list_sessions(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<Vec<RustDeskSession>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn rustdesk_update_session_settings(
    state: tauri::State<'_, RustDeskServiceState>,
    session_id: String,
    update: RustDeskSessionUpdate,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_session_settings(&session_id, update)
}

#[tauri::command]
pub async fn rustdesk_send_input(
    state: tauri::State<'_, RustDeskServiceState>,
    session_id: String,
    event: RustDeskInputEvent,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.send_input(&session_id, event).await
}

#[tauri::command]
pub async fn rustdesk_active_session_count(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    Ok(svc.active_session_count())
}

// ═══════════════════════════════════════════════════════════════════════
//  TCP Tunnels / Port Forwarding
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_create_tunnel(
    state: tauri::State<'_, RustDeskServiceState>,
    request: CreateTunnelRequest,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.create_tunnel(request).await
}

#[tauri::command]
pub async fn rustdesk_close_tunnel(
    state: tauri::State<'_, RustDeskServiceState>,
    tunnel_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.close_tunnel(&tunnel_id).await
}

#[tauri::command]
pub async fn rustdesk_list_tunnels(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<Vec<RustDeskTunnel>, String> {
    let svc = state.lock().await;
    Ok(svc.list_tunnels())
}

#[tauri::command]
pub async fn rustdesk_get_tunnel(
    state: tauri::State<'_, RustDeskServiceState>,
    tunnel_id: String,
) -> Result<Option<RustDeskTunnel>, String> {
    let svc = state.lock().await;
    Ok(svc.get_tunnel(&tunnel_id))
}

// ═══════════════════════════════════════════════════════════════════════
//  File Transfers
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_start_file_transfer(
    state: tauri::State<'_, RustDeskServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String,
    file_name: String,
    total_bytes: u64,
    direction: FileTransferDirection,
    password: Option<String>,
    use_relay: bool,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.start_file_transfer(
        &session_id,
        &local_path,
        &remote_path,
        &file_name,
        total_bytes,
        direction,
        password.as_deref(),
        use_relay,
    )
    .await
}

#[tauri::command]
pub async fn rustdesk_upload_file(
    state: tauri::State<'_, RustDeskServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String,
    file_name: String,
    total_bytes: u64,
    password: Option<String>,
    use_relay: bool,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.upload_file(
        &session_id,
        &local_path,
        &remote_path,
        &file_name,
        total_bytes,
        password.as_deref(),
        use_relay,
    )
    .await
}

#[tauri::command]
pub async fn rustdesk_download_file(
    state: tauri::State<'_, RustDeskServiceState>,
    session_id: String,
    remote_path: String,
    local_path: String,
    file_name: String,
    total_bytes: u64,
    password: Option<String>,
    use_relay: bool,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.download_file(
        &session_id,
        &remote_path,
        &local_path,
        &file_name,
        total_bytes,
        password.as_deref(),
        use_relay,
    )
    .await
}

#[tauri::command]
pub async fn rustdesk_list_file_transfers(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<Vec<RustDeskFileTransfer>, String> {
    let svc = state.lock().await;
    Ok(svc.list_file_transfers())
}

#[tauri::command]
pub async fn rustdesk_get_file_transfer(
    state: tauri::State<'_, RustDeskServiceState>,
    transfer_id: String,
) -> Result<Option<RustDeskFileTransfer>, String> {
    let svc = state.lock().await;
    Ok(svc.get_file_transfer(&transfer_id))
}

#[tauri::command]
pub async fn rustdesk_active_file_transfers(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<Vec<RustDeskFileTransfer>, String> {
    let svc = state.lock().await;
    Ok(svc.active_file_transfers())
}

#[tauri::command]
pub async fn rustdesk_transfer_progress(
    state: tauri::State<'_, RustDeskServiceState>,
    transfer_id: String,
) -> Result<Option<f64>, String> {
    let svc = state.lock().await;
    Ok(svc.transfer_progress(&transfer_id))
}

#[tauri::command]
pub async fn rustdesk_record_file_transfer(
    state: tauri::State<'_, RustDeskServiceState>,
    session_id: String,
    direction: FileTransferDirection,
    local_path: String,
    remote_path: String,
    file_name: String,
    total_bytes: u64,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    Ok(svc.record_file_transfer(
        &session_id,
        direction,
        &local_path,
        &remote_path,
        &file_name,
        total_bytes,
    ))
}

#[tauri::command]
pub async fn rustdesk_update_transfer_progress(
    state: tauri::State<'_, RustDeskServiceState>,
    transfer_id: String,
    bytes: u64,
    status: FileTransferStatus,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_transfer_progress(&transfer_id, bytes, status)
}

#[tauri::command]
pub async fn rustdesk_cancel_file_transfer(
    state: tauri::State<'_, RustDeskServiceState>,
    transfer_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.cancel_file_transfer(&transfer_id)
}

#[tauri::command]
pub async fn rustdesk_list_remote_files(
    state: tauri::State<'_, RustDeskServiceState>,
    session_id: String,
    remote_path: String,
) -> Result<Vec<RemoteFileEntry>, String> {
    let svc = state.lock().await;
    svc.list_remote_files(&session_id, &remote_path).await
}

#[tauri::command]
pub async fn rustdesk_file_transfer_stats(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    let (total, active, completed, failed, cancelled) = svc.file_transfer_stats();
    Ok(serde_json::json!({
        "total": total,
        "active": active,
        "completed": completed,
        "failed": failed,
        "cancelled": cancelled,
    }))
}

// ═══════════════════════════════════════════════════════════════════════
//  CLI Assignment
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_assign_via_cli(
    state: tauri::State<'_, RustDeskServiceState>,
    token: String,
    user_name: Option<String>,
    strategy_name: Option<String>,
    address_book_name: Option<String>,
    device_group_name: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.assign_via_cli(
        &token,
        user_name.as_deref(),
        strategy_name.as_deref(),
        address_book_name.as_deref(),
        device_group_name.as_deref(),
    )
    .await
}

// ═══════════════════════════════════════════════════════════════════════
//  Server Admin: Devices
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_api_list_devices(
    state: tauri::State<'_, RustDeskServiceState>,
    filter: DeviceFilter,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_list_devices(filter).await
}

#[tauri::command]
pub async fn rustdesk_api_get_device(
    state: tauri::State<'_, RustDeskServiceState>,
    device_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_get_device(&device_id).await
}

#[tauri::command]
pub async fn rustdesk_api_device_action(
    state: tauri::State<'_, RustDeskServiceState>,
    device_guid: String,
    action: DeviceAction,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_device_action(&device_guid, action).await
}

#[tauri::command]
pub async fn rustdesk_api_assign_device(
    state: tauri::State<'_, RustDeskServiceState>,
    assignment: DeviceAssignment,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_assign_device(assignment).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Server Admin: Users
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_api_list_users(
    state: tauri::State<'_, RustDeskServiceState>,
    filter: UserFilter,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_list_users(filter).await
}

#[tauri::command]
pub async fn rustdesk_api_create_user(
    state: tauri::State<'_, RustDeskServiceState>,
    request: CreateUserRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_create_user(request).await
}

#[tauri::command]
pub async fn rustdesk_api_user_action(
    state: tauri::State<'_, RustDeskServiceState>,
    user_guid: String,
    action: UserAction,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_user_action(&user_guid, action).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Server Admin: User Groups
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_api_list_user_groups(
    state: tauri::State<'_, RustDeskServiceState>,
    name: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_list_user_groups(name).await
}

#[tauri::command]
pub async fn rustdesk_api_create_user_group(
    state: tauri::State<'_, RustDeskServiceState>,
    request: CreateGroupRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_create_user_group(request).await
}

#[tauri::command]
pub async fn rustdesk_api_update_user_group(
    state: tauri::State<'_, RustDeskServiceState>,
    guid: String,
    new_name: Option<String>,
    note: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_update_user_group(&guid, new_name, note).await
}

#[tauri::command]
pub async fn rustdesk_api_delete_user_group(
    state: tauri::State<'_, RustDeskServiceState>,
    guid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_delete_user_group(&guid).await
}

#[tauri::command]
pub async fn rustdesk_api_add_users_to_group(
    state: tauri::State<'_, RustDeskServiceState>,
    group_guid: String,
    user_guids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_add_users_to_group(&group_guid, user_guids).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Server Admin: Device Groups
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_api_list_device_groups(
    state: tauri::State<'_, RustDeskServiceState>,
    name: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_list_device_groups(name).await
}

#[tauri::command]
pub async fn rustdesk_api_create_device_group(
    state: tauri::State<'_, RustDeskServiceState>,
    request: CreateGroupRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_create_device_group(request).await
}

#[tauri::command]
pub async fn rustdesk_api_update_device_group(
    state: tauri::State<'_, RustDeskServiceState>,
    guid: String,
    new_name: Option<String>,
    note: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_update_device_group(&guid, new_name, note).await
}

#[tauri::command]
pub async fn rustdesk_api_delete_device_group(
    state: tauri::State<'_, RustDeskServiceState>,
    guid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_delete_device_group(&guid).await
}

#[tauri::command]
pub async fn rustdesk_api_add_devices_to_group(
    state: tauri::State<'_, RustDeskServiceState>,
    group_guid: String,
    device_guids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_add_devices_to_group(&group_guid, device_guids).await
}

#[tauri::command]
pub async fn rustdesk_api_remove_devices_from_group(
    state: tauri::State<'_, RustDeskServiceState>,
    group_guid: String,
    device_guids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_remove_devices_from_group(&group_guid, device_guids)
        .await
}

// ═══════════════════════════════════════════════════════════════════════
//  Server Admin: Strategies
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_api_list_strategies(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_list_strategies().await
}

#[tauri::command]
pub async fn rustdesk_api_get_strategy(
    state: tauri::State<'_, RustDeskServiceState>,
    name: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_get_strategy(&name).await
}

#[tauri::command]
pub async fn rustdesk_api_enable_strategy(
    state: tauri::State<'_, RustDeskServiceState>,
    guid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_enable_strategy(&guid).await
}

#[tauri::command]
pub async fn rustdesk_api_disable_strategy(
    state: tauri::State<'_, RustDeskServiceState>,
    guid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_disable_strategy(&guid).await
}

#[tauri::command]
pub async fn rustdesk_api_assign_strategy(
    state: tauri::State<'_, RustDeskServiceState>,
    assignment: StrategyAssignment,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_assign_strategy(assignment).await
}

#[tauri::command]
pub async fn rustdesk_api_unassign_strategy(
    state: tauri::State<'_, RustDeskServiceState>,
    peers: Option<Vec<String>>,
    users: Option<Vec<String>>,
    device_groups: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_unassign_strategy(peers, users, device_groups).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Address Books
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_api_list_address_books(
    state: tauri::State<'_, RustDeskServiceState>,
    name: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_list_address_books(name).await
}

#[tauri::command]
pub async fn rustdesk_api_get_personal_address_book(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_get_personal_address_book().await
}

#[tauri::command]
pub async fn rustdesk_api_create_address_book(
    state: tauri::State<'_, RustDeskServiceState>,
    name: String,
    note: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_create_address_book(&name, note).await
}

#[tauri::command]
pub async fn rustdesk_api_update_address_book(
    state: tauri::State<'_, RustDeskServiceState>,
    guid: String,
    name: Option<String>,
    note: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_update_address_book(&guid, name, note).await
}

#[tauri::command]
pub async fn rustdesk_api_delete_address_book(
    state: tauri::State<'_, RustDeskServiceState>,
    guid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_delete_address_book(&guid).await
}

// ─── Address Book Peers ─────────────────────────────────────────────

#[tauri::command]
pub async fn rustdesk_api_list_ab_peers(
    state: tauri::State<'_, RustDeskServiceState>,
    ab_guid: String,
    peer_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_list_address_book_peers(&ab_guid, peer_id).await
}

#[tauri::command]
pub async fn rustdesk_api_add_ab_peer(
    state: tauri::State<'_, RustDeskServiceState>,
    ab_guid: String,
    peer: AddressBookPeer,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_add_peer_to_address_book(&ab_guid, peer).await
}

#[tauri::command]
pub async fn rustdesk_api_update_ab_peer(
    state: tauri::State<'_, RustDeskServiceState>,
    ab_guid: String,
    peer_id: String,
    alias: Option<String>,
    note: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_update_address_book_peer(&ab_guid, &peer_id, alias, note, tags)
        .await
}

#[tauri::command]
pub async fn rustdesk_api_remove_ab_peer(
    state: tauri::State<'_, RustDeskServiceState>,
    ab_guid: String,
    peer_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_remove_peer_from_address_book(&ab_guid, &peer_id)
        .await
}

#[tauri::command]
pub async fn rustdesk_api_import_ab_peers(
    state: tauri::State<'_, RustDeskServiceState>,
    ab_guid: String,
    peers: Vec<AddressBookPeer>,
) -> Result<Vec<Result<serde_json::Value, String>>, String> {
    let svc = state.lock().await;
    svc.api_import_peers(&ab_guid, peers).await
}

// ─── Address Book Tags ──────────────────────────────────────────────

#[tauri::command]
pub async fn rustdesk_api_list_ab_tags(
    state: tauri::State<'_, RustDeskServiceState>,
    ab_guid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_list_address_book_tags(&ab_guid).await
}

#[tauri::command]
pub async fn rustdesk_api_add_ab_tag(
    state: tauri::State<'_, RustDeskServiceState>,
    ab_guid: String,
    name: String,
    color: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_add_address_book_tag(&ab_guid, &name, color).await
}

#[tauri::command]
pub async fn rustdesk_api_delete_ab_tag(
    state: tauri::State<'_, RustDeskServiceState>,
    ab_guid: String,
    tag_name: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_delete_address_book_tag(&ab_guid, &tag_name).await
}

// ─── Address Book Rules ─────────────────────────────────────────────

#[tauri::command]
pub async fn rustdesk_api_list_ab_rules(
    state: tauri::State<'_, RustDeskServiceState>,
    ab_guid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_list_address_book_rules(&ab_guid).await
}

#[tauri::command]
pub async fn rustdesk_api_add_ab_rule(
    state: tauri::State<'_, RustDeskServiceState>,
    ab_guid: String,
    rule: AddressBookRule,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_add_address_book_rule(&ab_guid, rule).await
}

#[tauri::command]
pub async fn rustdesk_api_delete_ab_rule(
    state: tauri::State<'_, RustDeskServiceState>,
    rule_guid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_delete_address_book_rule(&rule_guid).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Audit Logs
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_api_connection_audits(
    state: tauri::State<'_, RustDeskServiceState>,
    filter: AuditFilter,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_connection_audits(filter).await
}

#[tauri::command]
pub async fn rustdesk_api_file_audits(
    state: tauri::State<'_, RustDeskServiceState>,
    filter: AuditFilter,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_file_audits(filter).await
}

#[tauri::command]
pub async fn rustdesk_api_alarm_audits(
    state: tauri::State<'_, RustDeskServiceState>,
    filter: AuditFilter,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_alarm_audits(filter).await
}

#[tauri::command]
pub async fn rustdesk_api_console_audits(
    state: tauri::State<'_, RustDeskServiceState>,
    filter: AuditFilter,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_console_audits(filter).await
}

#[tauri::command]
pub async fn rustdesk_api_peer_audit_summary(
    state: tauri::State<'_, RustDeskServiceState>,
    remote: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_peer_audit_summary(&remote).await
}

#[tauri::command]
pub async fn rustdesk_api_operator_audit_summary(
    state: tauri::State<'_, RustDeskServiceState>,
    operator: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_operator_audit_summary(&operator).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Server Admin: Login
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_api_login(
    state: tauri::State<'_, RustDeskServiceState>,
    username: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.api_login(&username, &password).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Diagnostics
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rustdesk_diagnostics_report(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<DiagnosticsReport, String> {
    let mut svc = state.lock().await;
    Ok(svc.build_diagnostics_report().await)
}

#[tauri::command]
pub async fn rustdesk_quick_health_check(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.quick_health_check().await)
}

#[tauri::command]
pub async fn rustdesk_server_health(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.check_server_health().await
}

#[tauri::command]
pub async fn rustdesk_server_latency(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<u64, String> {
    let svc = state.lock().await;
    svc.measure_server_latency().await
}

#[tauri::command]
pub async fn rustdesk_server_config_summary(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<Option<serde_json::Value>, String> {
    let svc = state.lock().await;
    Ok(svc.server_config_summary())
}

#[tauri::command]
pub async fn rustdesk_client_config_summary(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<Option<serde_json::Value>, String> {
    let svc = state.lock().await;
    Ok(svc.client_config_summary())
}

#[tauri::command]
pub async fn rustdesk_session_summary(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    Ok(svc.session_summary())
}
