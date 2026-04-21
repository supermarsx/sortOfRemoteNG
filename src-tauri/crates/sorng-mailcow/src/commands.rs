// ── sorng-mailcow/src/commands.rs ────────────────────────────────────────────
// Tauri commands – thin wrappers around `MailcowService`.

use super::service::MailcowServiceState;
use super::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_connect(
    state: State<'_, MailcowServiceState>,
    id: String,
    config: MailcowConnectionConfig,
) -> CmdResult<MailcowConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_disconnect(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_list_connections(
    state: State<'_, MailcowServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn mailcow_ping(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<MailcowConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Domains ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_list_domains(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<Vec<MailcowDomain>> {
    state.lock().await.list_domains(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_domain(
    state: State<'_, MailcowServiceState>,
    id: String,
    domain: String,
) -> CmdResult<MailcowDomain> {
    state
        .lock()
        .await
        .get_domain(&id, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_create_domain(
    state: State<'_, MailcowServiceState>,
    id: String,
    req: CreateDomainRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_domain(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_update_domain(
    state: State<'_, MailcowServiceState>,
    id: String,
    domain: String,
    req: UpdateDomainRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .update_domain(&id, &domain, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_domain(
    state: State<'_, MailcowServiceState>,
    id: String,
    domain: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_domain(&id, &domain)
        .await
        .map_err(map_err)
}

// ── Mailboxes ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_list_mailboxes(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<Vec<MailcowMailbox>> {
    state
        .lock()
        .await
        .list_mailboxes(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_list_mailboxes_by_domain(
    state: State<'_, MailcowServiceState>,
    id: String,
    domain: String,
) -> CmdResult<Vec<MailcowMailbox>> {
    state
        .lock()
        .await
        .list_mailboxes_by_domain(&id, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_mailbox(
    state: State<'_, MailcowServiceState>,
    id: String,
    username: String,
) -> CmdResult<MailcowMailbox> {
    state
        .lock()
        .await
        .get_mailbox(&id, &username)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_create_mailbox(
    state: State<'_, MailcowServiceState>,
    id: String,
    req: CreateMailboxRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_mailbox(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_update_mailbox(
    state: State<'_, MailcowServiceState>,
    id: String,
    username: String,
    req: UpdateMailboxRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .update_mailbox(&id, &username, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_mailbox(
    state: State<'_, MailcowServiceState>,
    id: String,
    username: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_mailbox(&id, &username)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_quarantine_notifications(
    state: State<'_, MailcowServiceState>,
    id: String,
    username: String,
    enable: bool,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .quarantine_notifications(&id, &username, enable)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_pushover_setup(
    state: State<'_, MailcowServiceState>,
    id: String,
    username: String,
    config: serde_json::Value,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .pushover_setup(&id, &username, &config)
        .await
        .map_err(map_err)
}

// ── Aliases ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_list_aliases(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<Vec<MailcowAlias>> {
    state.lock().await.list_aliases(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_alias(
    state: State<'_, MailcowServiceState>,
    id: String,
    alias_id: i64,
) -> CmdResult<MailcowAlias> {
    state
        .lock()
        .await
        .get_alias(&id, alias_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_create_alias(
    state: State<'_, MailcowServiceState>,
    id: String,
    req: CreateAliasRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_alias(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_update_alias(
    state: State<'_, MailcowServiceState>,
    id: String,
    alias_id: i64,
    req: UpdateAliasRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .update_alias(&id, alias_id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_alias(
    state: State<'_, MailcowServiceState>,
    id: String,
    alias_id: i64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_alias(&id, alias_id)
        .await
        .map_err(map_err)
}

// ── DKIM ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_get_dkim(
    state: State<'_, MailcowServiceState>,
    id: String,
    domain: String,
) -> CmdResult<MailcowDkimKey> {
    state
        .lock()
        .await
        .get_dkim(&id, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_generate_dkim(
    state: State<'_, MailcowServiceState>,
    id: String,
    req: GenerateDkimRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .generate_dkim(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_dkim(
    state: State<'_, MailcowServiceState>,
    id: String,
    domain: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_dkim(&id, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_duplicate_dkim(
    state: State<'_, MailcowServiceState>,
    id: String,
    src_domain: String,
    dst_domain: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .duplicate_dkim(&id, &src_domain, &dst_domain)
        .await
        .map_err(map_err)
}

// ── Domain Aliases ────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_list_domain_aliases(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<Vec<MailcowDomainAlias>> {
    state
        .lock()
        .await
        .list_domain_aliases(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_domain_alias(
    state: State<'_, MailcowServiceState>,
    id: String,
    alias_domain: String,
) -> CmdResult<MailcowDomainAlias> {
    state
        .lock()
        .await
        .get_domain_alias(&id, &alias_domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_create_domain_alias(
    state: State<'_, MailcowServiceState>,
    id: String,
    req: CreateDomainAliasRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_domain_alias(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_update_domain_alias(
    state: State<'_, MailcowServiceState>,
    id: String,
    alias_domain: String,
    active: bool,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .update_domain_alias(&id, &alias_domain, active)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_domain_alias(
    state: State<'_, MailcowServiceState>,
    id: String,
    alias_domain: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_domain_alias(&id, &alias_domain)
        .await
        .map_err(map_err)
}

// ── Transport ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_list_transport_maps(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<Vec<MailcowTransportMap>> {
    state
        .lock()
        .await
        .list_transport_maps(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_transport_map(
    state: State<'_, MailcowServiceState>,
    id: String,
    transport_id: i64,
) -> CmdResult<MailcowTransportMap> {
    state
        .lock()
        .await
        .get_transport_map(&id, transport_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_create_transport_map(
    state: State<'_, MailcowServiceState>,
    id: String,
    req: CreateTransportMapRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_transport_map(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_update_transport_map(
    state: State<'_, MailcowServiceState>,
    id: String,
    transport_id: i64,
    req: CreateTransportMapRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .update_transport_map(&id, transport_id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_transport_map(
    state: State<'_, MailcowServiceState>,
    id: String,
    transport_id: i64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_transport_map(&id, transport_id)
        .await
        .map_err(map_err)
}

// ── Queue ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_get_queue_summary(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<MailcowQueueSummary> {
    state
        .lock()
        .await
        .get_queue_summary(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_list_queue(
    state: State<'_, MailcowServiceState>,
    id: String,
    queue_name: String,
) -> CmdResult<Vec<MailcowQueueItem>> {
    state
        .lock()
        .await
        .list_queue(&id, &queue_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_flush_queue(
    state: State<'_, MailcowServiceState>,
    id: String,
    queue_name: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .flush_queue(&id, &queue_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_queue_item(
    state: State<'_, MailcowServiceState>,
    id: String,
    queue_id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_queue_item(&id, &queue_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_super_delete_queue(
    state: State<'_, MailcowServiceState>,
    id: String,
    queue_name: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .super_delete_queue(&id, &queue_name)
        .await
        .map_err(map_err)
}

// ── Quarantine ────────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_list_quarantine(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<Vec<MailcowQuarantineItem>> {
    state
        .lock()
        .await
        .list_quarantine(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_quarantine(
    state: State<'_, MailcowServiceState>,
    id: String,
    quarantine_id: i64,
) -> CmdResult<MailcowQuarantineItem> {
    state
        .lock()
        .await
        .get_quarantine(&id, quarantine_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_release_quarantine(
    state: State<'_, MailcowServiceState>,
    id: String,
    quarantine_id: i64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .release_quarantine(&id, quarantine_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_quarantine(
    state: State<'_, MailcowServiceState>,
    id: String,
    quarantine_id: i64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_quarantine(&id, quarantine_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_whitelist_sender(
    state: State<'_, MailcowServiceState>,
    id: String,
    quarantine_id: i64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .whitelist_sender(&id, quarantine_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_quarantine_settings(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .get_quarantine_settings(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_update_quarantine_settings(
    state: State<'_, MailcowServiceState>,
    id: String,
    settings: serde_json::Value,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .update_quarantine_settings(&id, &settings)
        .await
        .map_err(map_err)
}

// ── Logs ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_get_logs(
    state: State<'_, MailcowServiceState>,
    id: String,
    log_type: MailcowLogType,
    count: u64,
) -> CmdResult<Vec<MailcowLogEntry>> {
    state
        .lock()
        .await
        .get_logs(&id, &log_type, count)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_api_logs(
    state: State<'_, MailcowServiceState>,
    id: String,
    count: u64,
) -> CmdResult<Vec<MailcowLogEntry>> {
    state
        .lock()
        .await
        .get_api_logs(&id, count)
        .await
        .map_err(map_err)
}

// ── Status ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mailcow_get_container_status(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<Vec<MailcowContainerStatus>> {
    state
        .lock()
        .await
        .get_container_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_solr_status(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .get_solr_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_system_status(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<MailcowSystemStatus> {
    state
        .lock()
        .await
        .get_system_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_rspamd_stats(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .get_rspamd_stats(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_fail2ban_config(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<MailcowFail2BanConfig> {
    state
        .lock()
        .await
        .get_fail2ban_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_update_fail2ban_config(
    state: State<'_, MailcowServiceState>,
    id: String,
    config: MailcowFail2BanConfig,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .update_fail2ban_config(&id, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_rate_limits(
    state: State<'_, MailcowServiceState>,
    id: String,
    mailbox: String,
) -> CmdResult<MailcowRateLimit> {
    state
        .lock()
        .await
        .get_rate_limits(&id, &mailbox)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_set_rate_limit(
    state: State<'_, MailcowServiceState>,
    id: String,
    req: SetRateLimitRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .set_rate_limit(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_rate_limit(
    state: State<'_, MailcowServiceState>,
    id: String,
    mailbox: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_rate_limit(&id, &mailbox)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_list_app_passwords(
    state: State<'_, MailcowServiceState>,
    id: String,
    username: String,
) -> CmdResult<Vec<MailcowAppPassword>> {
    state
        .lock()
        .await
        .list_app_passwords(&id, &username)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_create_app_password(
    state: State<'_, MailcowServiceState>,
    id: String,
    req: CreateAppPasswordRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_app_password(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_app_password(
    state: State<'_, MailcowServiceState>,
    id: String,
    app_password_id: i64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_app_password(&id, app_password_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_list_resources(
    state: State<'_, MailcowServiceState>,
    id: String,
) -> CmdResult<Vec<MailcowResource>> {
    state
        .lock()
        .await
        .list_resources(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_get_resource(
    state: State<'_, MailcowServiceState>,
    id: String,
    name: String,
) -> CmdResult<MailcowResource> {
    state
        .lock()
        .await
        .get_resource(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_create_resource(
    state: State<'_, MailcowServiceState>,
    id: String,
    req: CreateResourceRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_resource(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_update_resource(
    state: State<'_, MailcowServiceState>,
    id: String,
    name: String,
    req: CreateResourceRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .update_resource(&id, &name, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mailcow_delete_resource(
    state: State<'_, MailcowServiceState>,
    id: String,
    name: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_resource(&id, &name)
        .await
        .map_err(map_err)
}
