// ─── Exchange Integration – Tauri commands ───────────────────────────────────
use crate::service::ExchangeServiceState;
use crate::types::*;
use tauri::State;

fn err_str(e: ExchangeError) -> String {
    e.to_string()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_set_config(
    state: State<'_, ExchangeServiceState>,
    config: ExchangeConnectionConfig,
) -> Result<(), String> {
    state.lock().await.set_config(config);
    Ok(())
}

#[tauri::command]
pub async fn exchange_connect(
    state: State<'_, ExchangeServiceState>,
) -> Result<ExchangeConnectionSummary, String> {
    state.lock().await.connect().await.map_err(err_str)
}

#[tauri::command]
pub async fn exchange_disconnect(state: State<'_, ExchangeServiceState>) -> Result<(), String> {
    state.lock().await.disconnect().await.map_err(err_str)
}

#[tauri::command]
pub async fn exchange_is_connected(state: State<'_, ExchangeServiceState>) -> Result<bool, String> {
    Ok(state.lock().await.is_connected())
}

#[tauri::command]
pub async fn exchange_connection_summary(
    state: State<'_, ExchangeServiceState>,
) -> Result<ExchangeConnectionSummary, String> {
    Ok(state.lock().await.connection_summary())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mailboxes
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_mailboxes(
    state: State<'_, ExchangeServiceState>,
    result_size: Option<i32>,
    filter: Option<String>,
) -> Result<Vec<Mailbox>, String> {
    state
        .lock()
        .await
        .list_mailboxes(result_size, filter)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_mailbox(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<Mailbox, String> {
    state
        .lock()
        .await
        .get_mailbox(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_create_mailbox(
    state: State<'_, ExchangeServiceState>,
    request: CreateMailboxRequest,
) -> Result<Mailbox, String> {
    state
        .lock()
        .await
        .create_mailbox(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_mailbox(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_mailbox(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_enable_mailbox(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    database: Option<String>,
) -> Result<Mailbox, String> {
    state
        .lock()
        .await
        .enable_mailbox(&identity, database)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_disable_mailbox(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .disable_mailbox(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_update_mailbox(
    state: State<'_, ExchangeServiceState>,
    request: UpdateMailboxRequest,
) -> Result<String, String> {
    state
        .lock()
        .await
        .update_mailbox(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_mailbox_statistics(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MailboxStatistics, String> {
    state
        .lock()
        .await
        .get_mailbox_statistics(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_mailbox_permissions(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<Vec<MailboxPermission>, String> {
    state
        .lock()
        .await
        .get_mailbox_permissions(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_add_mailbox_permission(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    user: String,
    access_rights: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .add_mailbox_permission(&identity, &user, &access_rights)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_mailbox_permission(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    user: String,
    access_rights: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_mailbox_permission(&identity, &user, &access_rights)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_forwarding(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MailboxForwarding, String> {
    state
        .lock()
        .await
        .get_forwarding(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_ooo(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<OutOfOfficeSettings, String> {
    state.lock().await.get_ooo(&identity).await.map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_ooo(
    state: State<'_, ExchangeServiceState>,
    settings: OutOfOfficeSettings,
) -> Result<String, String> {
    state.lock().await.set_ooo(settings).await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Distribution / M365 Groups
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_groups(
    state: State<'_, ExchangeServiceState>,
    result_size: Option<i32>,
) -> Result<Vec<DistributionGroup>, String> {
    state
        .lock()
        .await
        .list_groups(result_size)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_group(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<DistributionGroup, String> {
    state
        .lock()
        .await
        .get_group(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_create_group(
    state: State<'_, ExchangeServiceState>,
    request: CreateGroupRequest,
) -> Result<DistributionGroup, String> {
    state
        .lock()
        .await
        .create_group(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_update_group(
    state: State<'_, ExchangeServiceState>,
    request: UpdateGroupRequest,
) -> Result<String, String> {
    state
        .lock()
        .await
        .update_group(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_group(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_group(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_group_members(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<Vec<GroupMember>, String> {
    state
        .lock()
        .await
        .list_group_members(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_add_group_member(
    state: State<'_, ExchangeServiceState>,
    group: String,
    member: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .add_group_member(&group, &member)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_group_member(
    state: State<'_, ExchangeServiceState>,
    group: String,
    member: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_group_member(&group, &member)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_dynamic_groups(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<DistributionGroup>, String> {
    state
        .lock()
        .await
        .list_dynamic_groups()
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transport Rules
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_transport_rules(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<TransportRule>, String> {
    state
        .lock()
        .await
        .list_transport_rules()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_transport_rule(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<TransportRule, String> {
    state
        .lock()
        .await
        .get_transport_rule(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_create_transport_rule(
    state: State<'_, ExchangeServiceState>,
    request: CreateTransportRuleRequest,
) -> Result<TransportRule, String> {
    state
        .lock()
        .await
        .create_transport_rule(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_update_transport_rule(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .update_transport_rule(&identity, params)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_transport_rule(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_transport_rule(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_enable_transport_rule(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .enable_transport_rule(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_disable_transport_rule(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .disable_transport_rule(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connectors
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_send_connectors(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<Connector>, String> {
    state
        .lock()
        .await
        .list_send_connectors()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_send_connector(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<Connector, String> {
    state
        .lock()
        .await
        .get_send_connector(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_receive_connectors(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<Connector>, String> {
    state
        .lock()
        .await
        .list_receive_connectors(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_receive_connector(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<Connector, String> {
    state
        .lock()
        .await
        .get_receive_connector(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_inbound_connectors(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<Connector>, String> {
    state
        .lock()
        .await
        .list_inbound_connectors()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_outbound_connectors(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<Connector>, String> {
    state
        .lock()
        .await
        .list_outbound_connectors()
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mail Flow
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_message_trace(
    state: State<'_, ExchangeServiceState>,
    request: MessageTraceRequest,
) -> Result<Vec<MessageTraceResult>, String> {
    state
        .lock()
        .await
        .message_trace(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_message_tracking_log(
    state: State<'_, ExchangeServiceState>,
    sender: Option<String>,
    recipient: Option<String>,
    start: Option<String>,
    end: Option<String>,
    server: Option<String>,
    result_size: Option<i32>,
) -> Result<Vec<MessageTraceResult>, String> {
    state
        .lock()
        .await
        .message_tracking_log(sender, recipient, start, end, server, result_size)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_queues(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<MailQueue>, String> {
    state
        .lock()
        .await
        .list_queues(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_queue(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MailQueue, String> {
    state
        .lock()
        .await
        .get_queue(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_retry_queue(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .retry_queue(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_suspend_queue(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .suspend_queue(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_resume_queue(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .resume_queue(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_queue_summary(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<MailQueue>, String> {
    state.lock().await.queue_summary().await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Calendars & Resources
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_calendar_permissions(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<Vec<CalendarPermission>, String> {
    state
        .lock()
        .await
        .list_calendar_permissions(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_calendar_permission(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    user: String,
    access_rights: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_calendar_permission(&identity, &user, &access_rights)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_calendar_permission(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    user: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_calendar_permission(&identity, &user)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_booking_config(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<ResourceBookingConfig, String> {
    state
        .lock()
        .await
        .get_booking_config(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_booking_config(
    state: State<'_, ExchangeServiceState>,
    config: ResourceBookingConfig,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_booking_config(config)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public Folders
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_public_folders(
    state: State<'_, ExchangeServiceState>,
    root: Option<String>,
    recurse: Option<bool>,
) -> Result<Vec<PublicFolder>, String> {
    state
        .lock()
        .await
        .list_public_folders(root, recurse.unwrap_or(false))
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_public_folder(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<PublicFolder, String> {
    state
        .lock()
        .await
        .get_public_folder(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_create_public_folder(
    state: State<'_, ExchangeServiceState>,
    name: String,
    path: Option<String>,
) -> Result<PublicFolder, String> {
    state
        .lock()
        .await
        .create_public_folder(&name, path)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_public_folder(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_public_folder(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_mail_enable_public_folder(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .mail_enable_public_folder(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_mail_disable_public_folder(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .mail_disable_public_folder(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_public_folder_statistics(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<PublicFolderStatistics, String> {
    state
        .lock()
        .await
        .get_public_folder_statistics(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Address Policies / Domains
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_address_policies(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<EmailAddressPolicy>, String> {
    state
        .lock()
        .await
        .list_address_policies()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_address_policy(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<EmailAddressPolicy, String> {
    state
        .lock()
        .await
        .get_address_policy(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_apply_address_policy(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .apply_address_policy(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_accepted_domains(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<AcceptedDomain>, String> {
    state
        .lock()
        .await
        .list_accepted_domains()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_address_lists(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<AddressList>, String> {
    state
        .lock()
        .await
        .list_address_lists()
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Migration
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_migration_batches(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<MigrationBatch>, String> {
    state
        .lock()
        .await
        .list_migration_batches()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_migration_batch(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MigrationBatch, String> {
    state
        .lock()
        .await
        .get_migration_batch(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_start_migration_batch(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .start_migration_batch(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_stop_migration_batch(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .stop_migration_batch(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_complete_migration_batch(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .complete_migration_batch(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_migration_batch(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_migration_batch(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_migration_users(
    state: State<'_, ExchangeServiceState>,
    batch_id: Option<String>,
) -> Result<Vec<MigrationUser>, String> {
    state
        .lock()
        .await
        .list_migration_users(batch_id)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_move_requests(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<MoveRequest>, String> {
    state
        .lock()
        .await
        .list_move_requests()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_move_request_statistics(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MoveRequest, String> {
    state
        .lock()
        .await
        .get_move_request_statistics(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_new_move_request(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    target_database: String,
    batch_name: Option<String>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .new_move_request(&identity, &target_database, batch_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_move_request(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_move_request(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compliance & Retention
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_retention_policies(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<RetentionPolicy>, String> {
    state
        .lock()
        .await
        .list_retention_policies()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_retention_policy(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<RetentionPolicy, String> {
    state
        .lock()
        .await
        .get_retention_policy(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_retention_tags(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<RetentionTag>, String> {
    state
        .lock()
        .await
        .list_retention_tags()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_retention_tag(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<RetentionTag, String> {
    state
        .lock()
        .await
        .get_retention_tag(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_mailbox_hold(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MailboxHold, String> {
    state
        .lock()
        .await
        .get_mailbox_hold(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_enable_litigation_hold(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    duration: Option<String>,
    owner: Option<String>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .enable_litigation_hold(&identity, duration, owner)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_disable_litigation_hold(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .disable_litigation_hold(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_dlp_policies(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<DlpPolicy>, String> {
    state
        .lock()
        .await
        .list_dlp_policies()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_dlp_policy(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<DlpPolicy, String> {
    state
        .lock()
        .await
        .get_dlp_policy(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Health & Monitoring
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_servers(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<ExchangeServer>, String> {
    state.lock().await.list_servers().await.map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_server(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<ExchangeServer, String> {
    state
        .lock()
        .await
        .get_server(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_databases(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<MailboxDatabase>, String> {
    state
        .lock()
        .await
        .list_databases(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_database(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MailboxDatabase, String> {
    state
        .lock()
        .await
        .get_database(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_mount_database(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .mount_database(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_dismount_database(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .dismount_database(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_dags(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<DatabaseAvailabilityGroup>, String> {
    state.lock().await.list_dags().await.map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_dag(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<DatabaseAvailabilityGroup, String> {
    state.lock().await.get_dag(&identity).await.map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_dag_copy_status(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
    database: Option<String>,
) -> Result<Vec<DagReplicationStatus>, String> {
    state
        .lock()
        .await
        .get_dag_copy_status(server, database)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_test_replication_health(
    state: State<'_, ExchangeServiceState>,
    server: String,
) -> Result<Vec<serde_json::Value>, String> {
    state
        .lock()
        .await
        .test_replication_health(&server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_service_health(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<ServiceHealthStatus>, String> {
    state.lock().await.service_health().await.map_err(err_str)
}

#[tauri::command]
pub async fn exchange_service_issues(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<serde_json::Value>, String> {
    state.lock().await.service_issues().await.map_err(err_str)
}

#[tauri::command]
pub async fn exchange_test_mailflow(
    state: State<'_, ExchangeServiceState>,
    target: Option<String>,
) -> Result<serde_json::Value, String> {
    state
        .lock()
        .await
        .test_mailflow(target)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_test_service_health(
    state: State<'_, ExchangeServiceState>,
    server: String,
) -> Result<Vec<serde_json::Value>, String> {
    state
        .lock()
        .await
        .test_service_health(&server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_server_component_state(
    state: State<'_, ExchangeServiceState>,
    server: String,
) -> Result<Vec<ServerComponentState>, String> {
    state
        .lock()
        .await
        .get_server_component_state(&server)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mail Contacts & Mail Users
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_mail_contacts(
    state: State<'_, ExchangeServiceState>,
    result_size: Option<i32>,
) -> Result<Vec<MailContact>, String> {
    state
        .lock()
        .await
        .list_mail_contacts(result_size)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_mail_contact(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MailContact, String> {
    state
        .lock()
        .await
        .get_mail_contact(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_create_mail_contact(
    state: State<'_, ExchangeServiceState>,
    request: CreateMailContactRequest,
) -> Result<MailContact, String> {
    state
        .lock()
        .await
        .create_mail_contact(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_update_mail_contact(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .update_mail_contact(&identity, params)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_mail_contact(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_mail_contact(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_mail_users(
    state: State<'_, ExchangeServiceState>,
    result_size: Option<i32>,
) -> Result<Vec<MailUser>, String> {
    state
        .lock()
        .await
        .list_mail_users(result_size)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_mail_user(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MailUser, String> {
    state
        .lock()
        .await
        .get_mail_user(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_create_mail_user(
    state: State<'_, ExchangeServiceState>,
    request: CreateMailUserRequest,
) -> Result<MailUser, String> {
    state
        .lock()
        .await
        .create_mail_user(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_mail_user(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_mail_user(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Mailboxes & Resource Mailboxes
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_convert_mailbox(
    state: State<'_, ExchangeServiceState>,
    req: ConvertMailboxRequest,
) -> Result<Mailbox, String> {
    state
        .lock()
        .await
        .convert_mailbox(&req)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_shared_mailboxes(
    state: State<'_, ExchangeServiceState>,
    result_size: Option<i32>,
) -> Result<Vec<Mailbox>, String> {
    state
        .lock()
        .await
        .list_shared_mailboxes(result_size)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_room_mailboxes(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<Mailbox>, String> {
    state
        .lock()
        .await
        .list_room_mailboxes()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_equipment_mailboxes(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<Mailbox>, String> {
    state
        .lock()
        .await
        .list_equipment_mailboxes()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_add_automapping(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    user: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .add_automapping(&mailbox, &user)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_automapping(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    user: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_automapping(&mailbox, &user)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_add_send_as(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    trustee: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .add_send_as(&mailbox, &trustee)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_send_as(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    trustee: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_send_as(&mailbox, &trustee)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_add_send_on_behalf(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    trustee: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .add_send_on_behalf(&mailbox, &trustee)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_send_on_behalf(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    trustee: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_send_on_behalf(&mailbox, &trustee)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_room_lists(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<DistributionGroup>, String> {
    state.lock().await.list_room_lists().await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Archive Mailboxes
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_get_archive_info(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<ArchiveMailboxInfo, String> {
    state
        .lock()
        .await
        .get_archive_info(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_enable_archive(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    database: Option<String>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .enable_archive(&identity, database.as_deref())
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_disable_archive(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .disable_archive(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_enable_auto_expanding_archive(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .enable_auto_expanding_archive(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_archive_quota(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    quota: String,
    warning_quota: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_archive_quota(&identity, &quota, &warning_quota)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_archive_statistics(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<ArchiveStatistics, String> {
    state
        .lock()
        .await
        .get_archive_statistics(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile Devices
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_mobile_devices(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
) -> Result<Vec<MobileDevice>, String> {
    state
        .lock()
        .await
        .list_mobile_devices(&mailbox)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_mobile_device_statistics(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MobileDeviceStatistics, String> {
    state
        .lock()
        .await
        .get_mobile_device_statistics(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_wipe_mobile_device(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .wipe_mobile_device(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_block_mobile_device(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .block_mobile_device(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_allow_mobile_device(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .allow_mobile_device(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_mobile_device(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_mobile_device(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_all_mobile_devices(
    state: State<'_, ExchangeServiceState>,
    result_size: Option<i32>,
) -> Result<Vec<MobileDevice>, String> {
    state
        .lock()
        .await
        .list_all_mobile_devices(result_size)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inbox Rules
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_inbox_rules(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
) -> Result<Vec<InboxRule>, String> {
    state
        .lock()
        .await
        .list_inbox_rules(&mailbox)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_inbox_rule(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    rule_id: String,
) -> Result<InboxRule, String> {
    state
        .lock()
        .await
        .get_inbox_rule(&mailbox, &rule_id)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_create_inbox_rule(
    state: State<'_, ExchangeServiceState>,
    request: CreateInboxRuleRequest,
) -> Result<InboxRule, String> {
    state
        .lock()
        .await
        .create_inbox_rule(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_update_inbox_rule(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    rule_id: String,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .update_inbox_rule(&mailbox, &rule_id, params)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_inbox_rule(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    rule_id: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_inbox_rule(&mailbox, &rule_id)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_enable_inbox_rule(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    rule_id: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .enable_inbox_rule(&mailbox, &rule_id)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_disable_inbox_rule(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    rule_id: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .disable_inbox_rule(&mailbox, &rule_id)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Policies (OWA, Mobile Device, Throttling)
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_owa_policies(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<OwaMailboxPolicy>, String> {
    state
        .lock()
        .await
        .list_owa_policies()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_owa_policy(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<OwaMailboxPolicy, String> {
    state
        .lock()
        .await
        .get_owa_policy(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_owa_policy(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_owa_policy(&identity, params)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_mobile_device_policies(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<MobileDeviceMailboxPolicy>, String> {
    state
        .lock()
        .await
        .list_mobile_device_policies()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_mobile_device_policy(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<MobileDeviceMailboxPolicy, String> {
    state
        .lock()
        .await
        .get_mobile_device_policy(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_mobile_device_policy(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_mobile_device_policy(&identity, params)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_throttling_policies(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<ThrottlingPolicy>, String> {
    state
        .lock()
        .await
        .list_throttling_policies()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_throttling_policy(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<ThrottlingPolicy, String> {
    state
        .lock()
        .await
        .get_throttling_policy(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Journal Rules
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_journal_rules(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<JournalRule>, String> {
    state
        .lock()
        .await
        .list_journal_rules()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_journal_rule(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<JournalRule, String> {
    state
        .lock()
        .await
        .get_journal_rule(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_create_journal_rule(
    state: State<'_, ExchangeServiceState>,
    request: CreateJournalRuleRequest,
) -> Result<JournalRule, String> {
    state
        .lock()
        .await
        .create_journal_rule(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_journal_rule(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_journal_rule(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_enable_journal_rule(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .enable_journal_rule(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_disable_journal_rule(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .disable_journal_rule(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// RBAC & Audit
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_role_groups(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<RoleGroup>, String> {
    state.lock().await.list_role_groups().await.map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_role_group(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<RoleGroup, String> {
    state
        .lock()
        .await
        .get_role_group(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_add_role_group_member(
    state: State<'_, ExchangeServiceState>,
    group: String,
    member: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .add_role_group_member(&group, &member)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_role_group_member(
    state: State<'_, ExchangeServiceState>,
    group: String,
    member: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_role_group_member(&group, &member)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_management_roles(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<ManagementRole>, String> {
    state
        .lock()
        .await
        .list_management_roles()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_management_role(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<ManagementRole, String> {
    state
        .lock()
        .await
        .get_management_role(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_role_assignments(
    state: State<'_, ExchangeServiceState>,
    role: Option<String>,
    role_assignee: Option<String>,
) -> Result<Vec<ManagementRoleAssignment>, String> {
    state
        .lock()
        .await
        .list_role_assignments(role, role_assignee)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_search_admin_audit_log(
    state: State<'_, ExchangeServiceState>,
    request: AdminAuditLogSearchRequest,
) -> Result<Vec<AdminAuditLogEntry>, String> {
    state
        .lock()
        .await
        .search_admin_audit_log(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_admin_audit_log_config(
    state: State<'_, ExchangeServiceState>,
) -> Result<serde_json::Value, String> {
    state
        .lock()
        .await
        .get_admin_audit_log_config()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_search_mailbox_audit_log(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    start_date: Option<String>,
    end_date: Option<String>,
    log_on_types: Option<String>,
    result_size: Option<i32>,
) -> Result<Vec<MailboxAuditLogEntry>, String> {
    state
        .lock()
        .await
        .search_mailbox_audit_log(&mailbox, start_date, end_date, log_on_types, result_size)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_enable_mailbox_audit(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .enable_mailbox_audit(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_disable_mailbox_audit(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .disable_mailbox_audit(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Remote Domains
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_remote_domains(
    state: State<'_, ExchangeServiceState>,
) -> Result<Vec<RemoteDomain>, String> {
    state
        .lock()
        .await
        .list_remote_domains()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_remote_domain(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<RemoteDomain, String> {
    state
        .lock()
        .await
        .get_remote_domain(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_create_remote_domain(
    state: State<'_, ExchangeServiceState>,
    request: CreateRemoteDomainRequest,
) -> Result<RemoteDomain, String> {
    state
        .lock()
        .await
        .create_remote_domain(request)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_update_remote_domain(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .update_remote_domain(&identity, params)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_remote_domain(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_remote_domain(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Certificates
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_certificates(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<ExchangeCertificate>, String> {
    state
        .lock()
        .await
        .list_certificates(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_certificate(
    state: State<'_, ExchangeServiceState>,
    thumbprint: String,
    server: Option<String>,
) -> Result<ExchangeCertificate, String> {
    state
        .lock()
        .await
        .get_certificate(&thumbprint, server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_enable_certificate(
    state: State<'_, ExchangeServiceState>,
    thumbprint: String,
    services: String,
    server: Option<String>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .enable_certificate(&thumbprint, &services, server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_import_certificate(
    state: State<'_, ExchangeServiceState>,
    file_path: String,
    password: Option<String>,
    server: Option<String>,
) -> Result<ExchangeCertificate, String> {
    state
        .lock()
        .await
        .import_certificate(&file_path, password, server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_certificate(
    state: State<'_, ExchangeServiceState>,
    thumbprint: String,
    server: Option<String>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_certificate(&thumbprint, server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_new_certificate_request(
    state: State<'_, ExchangeServiceState>,
    subject_name: String,
    domain_names: Vec<String>,
    server: Option<String>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .new_certificate_request(&subject_name, &domain_names, server)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Virtual Directories & Organization Config
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_list_owa_virtual_directories(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<VirtualDirectory>, String> {
    state
        .lock()
        .await
        .list_owa_virtual_directories(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_ecp_virtual_directories(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<VirtualDirectory>, String> {
    state
        .lock()
        .await
        .list_ecp_virtual_directories(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_activesync_virtual_directories(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<VirtualDirectory>, String> {
    state
        .lock()
        .await
        .list_activesync_virtual_directories(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_ews_virtual_directories(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<VirtualDirectory>, String> {
    state
        .lock()
        .await
        .list_ews_virtual_directories(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_mapi_virtual_directories(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<VirtualDirectory>, String> {
    state
        .lock()
        .await
        .list_mapi_virtual_directories(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_autodiscover_virtual_directories(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<VirtualDirectory>, String> {
    state
        .lock()
        .await
        .list_autodiscover_virtual_directories(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_powershell_virtual_directories(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<VirtualDirectory>, String> {
    state
        .lock()
        .await
        .list_powershell_virtual_directories(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_oab_virtual_directories(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<VirtualDirectory>, String> {
    state
        .lock()
        .await
        .list_oab_virtual_directories(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_virtual_directory_urls(
    state: State<'_, ExchangeServiceState>,
    vdir_type: VirtualDirectoryType,
    identity: String,
    internal_url: Option<String>,
    external_url: Option<String>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_virtual_directory_urls(vdir_type, &identity, internal_url, external_url)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_outlook_anywhere(
    state: State<'_, ExchangeServiceState>,
    server: Option<String>,
) -> Result<Vec<VirtualDirectory>, String> {
    state
        .lock()
        .await
        .list_outlook_anywhere(server)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_organization_config(
    state: State<'_, ExchangeServiceState>,
) -> Result<OrganizationConfig, String> {
    state
        .lock()
        .await
        .get_organization_config()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_organization_config(
    state: State<'_, ExchangeServiceState>,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_organization_config(params)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_transport_config(
    state: State<'_, ExchangeServiceState>,
) -> Result<TransportConfig, String> {
    state
        .lock()
        .await
        .get_transport_config()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_transport_config(
    state: State<'_, ExchangeServiceState>,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_transport_config(params)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Anti-Spam & Hygiene
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_get_content_filter_config(
    state: State<'_, ExchangeServiceState>,
) -> Result<ContentFilterConfig, String> {
    state
        .lock()
        .await
        .get_content_filter_config()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_content_filter_config(
    state: State<'_, ExchangeServiceState>,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_content_filter_config(params)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_connection_filter_config(
    state: State<'_, ExchangeServiceState>,
) -> Result<ConnectionFilterConfig, String> {
    state
        .lock()
        .await
        .get_connection_filter_config()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_connection_filter_config(
    state: State<'_, ExchangeServiceState>,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_connection_filter_config(params)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_sender_filter_config(
    state: State<'_, ExchangeServiceState>,
) -> Result<SenderFilterConfig, String> {
    state
        .lock()
        .await
        .get_sender_filter_config()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_set_sender_filter_config(
    state: State<'_, ExchangeServiceState>,
    params: serde_json::Value,
) -> Result<String, String> {
    state
        .lock()
        .await
        .set_sender_filter_config(params)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_quarantine_messages(
    state: State<'_, ExchangeServiceState>,
    page_size: Option<i32>,
    quarantine_type: Option<String>,
) -> Result<Vec<QuarantineMessage>, String> {
    state
        .lock()
        .await
        .list_quarantine_messages(page_size, quarantine_type)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_get_quarantine_message(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<QuarantineMessage, String> {
    state
        .lock()
        .await
        .get_quarantine_message(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_release_quarantine_message(
    state: State<'_, ExchangeServiceState>,
    identity: String,
    release_to_all: bool,
) -> Result<String, String> {
    state
        .lock()
        .await
        .release_quarantine_message(&identity, release_to_all)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_delete_quarantine_message(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .delete_quarantine_message(&identity)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mailbox Import / Export (PST)
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn exchange_new_mailbox_import_request(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    file_path: String,
    target_root_folder: Option<String>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .new_mailbox_import_request(&mailbox, &file_path, target_root_folder)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_new_mailbox_export_request(
    state: State<'_, ExchangeServiceState>,
    mailbox: String,
    file_path: String,
    include_folders: Option<Vec<String>>,
    exclude_folders: Option<Vec<String>>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .new_mailbox_export_request(&mailbox, &file_path, include_folders, exclude_folders)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_mailbox_import_requests(
    state: State<'_, ExchangeServiceState>,
    mailbox: Option<String>,
) -> Result<Vec<MailboxImportExportRequest>, String> {
    state
        .lock()
        .await
        .list_mailbox_import_requests(mailbox)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_list_mailbox_export_requests(
    state: State<'_, ExchangeServiceState>,
    mailbox: Option<String>,
) -> Result<Vec<MailboxImportExportRequest>, String> {
    state
        .lock()
        .await
        .list_mailbox_export_requests(mailbox)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_mailbox_import_request(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_mailbox_import_request(&identity)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn exchange_remove_mailbox_export_request(
    state: State<'_, ExchangeServiceState>,
    identity: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .remove_mailbox_export_request(&identity)
        .await
        .map_err(err_str)
}
