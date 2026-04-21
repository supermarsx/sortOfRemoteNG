// ── sorng-postfix/src/commands.rs ─────────────────────────────────────────────
// Tauri commands – thin wrappers around `PostfixService`.

use std::collections::HashMap;
use tauri::State;

use super::service::PostfixServiceState;
use super::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_connect(
    state: State<'_, PostfixServiceState>,
    id: String,
    config: PostfixConnectionConfig,
) -> CmdResult<PostfixConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_disconnect(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn postfix_list_connections(
    state: State<'_, PostfixServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn postfix_ping(state: State<'_, PostfixServiceState>, id: String) -> CmdResult<String> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_get_main_cf(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixMainCfParam>> {
    state.lock().await.get_main_cf(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_get_param(
    state: State<'_, PostfixServiceState>,
    id: String,
    name: String,
) -> CmdResult<PostfixMainCfParam> {
    state
        .lock()
        .await
        .get_param(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_set_param(
    state: State<'_, PostfixServiceState>,
    id: String,
    name: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_param(&id, &name, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_delete_param(
    state: State<'_, PostfixServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_param(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_get_master_cf(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixMasterCfEntry>> {
    state.lock().await.get_master_cf(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_update_master_cf(
    state: State<'_, PostfixServiceState>,
    id: String,
    entry: PostfixMasterCfEntry,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_master_cf(&id, &entry)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_check_config(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<ConfigTestResult> {
    state.lock().await.check_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_get_maps(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixMap>> {
    state.lock().await.get_maps(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_get_map_entries(
    state: State<'_, PostfixServiceState>,
    id: String,
    name: String,
) -> CmdResult<Vec<PostfixMapEntry>> {
    state
        .lock()
        .await
        .get_map_entries(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_set_map_entry(
    state: State<'_, PostfixServiceState>,
    id: String,
    name: String,
    key: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_map_entry(&id, &name, &key, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_delete_map_entry(
    state: State<'_, PostfixServiceState>,
    id: String,
    name: String,
    key: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_map_entry(&id, &name, &key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_rebuild_map(
    state: State<'_, PostfixServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .rebuild_map(&id, &name)
        .await
        .map_err(map_err)
}

// ── Domains ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_list_domains(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixDomain>> {
    state.lock().await.list_domains(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_get_domain(
    state: State<'_, PostfixServiceState>,
    id: String,
    domain: String,
) -> CmdResult<PostfixDomain> {
    state
        .lock()
        .await
        .get_domain(&id, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_create_domain(
    state: State<'_, PostfixServiceState>,
    id: String,
    request: CreateDomainRequest,
) -> CmdResult<PostfixDomain> {
    state
        .lock()
        .await
        .create_domain(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_update_domain(
    state: State<'_, PostfixServiceState>,
    id: String,
    domain: String,
    request: UpdateDomainRequest,
) -> CmdResult<PostfixDomain> {
    state
        .lock()
        .await
        .update_domain(&id, &domain, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_delete_domain(
    state: State<'_, PostfixServiceState>,
    id: String,
    domain: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_domain(&id, &domain)
        .await
        .map_err(map_err)
}

// ── Aliases ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_list_aliases(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixAlias>> {
    state.lock().await.list_aliases(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_get_alias(
    state: State<'_, PostfixServiceState>,
    id: String,
    address: String,
) -> CmdResult<PostfixAlias> {
    state
        .lock()
        .await
        .get_alias(&id, &address)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_create_alias(
    state: State<'_, PostfixServiceState>,
    id: String,
    request: CreateAliasRequest,
) -> CmdResult<PostfixAlias> {
    state
        .lock()
        .await
        .create_alias(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_update_alias(
    state: State<'_, PostfixServiceState>,
    id: String,
    address: String,
    request: UpdateAliasRequest,
) -> CmdResult<PostfixAlias> {
    state
        .lock()
        .await
        .update_alias(&id, &address, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_delete_alias(
    state: State<'_, PostfixServiceState>,
    id: String,
    address: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_alias(&id, &address)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_list_virtual_aliases(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixAlias>> {
    state
        .lock()
        .await
        .list_virtual_aliases(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_list_local_aliases(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixAlias>> {
    state
        .lock()
        .await
        .list_local_aliases(&id)
        .await
        .map_err(map_err)
}

// ── Transports ────────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_list_transports(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixTransport>> {
    state
        .lock()
        .await
        .list_transports(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_get_transport(
    state: State<'_, PostfixServiceState>,
    id: String,
    domain: String,
) -> CmdResult<PostfixTransport> {
    state
        .lock()
        .await
        .get_transport(&id, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_create_transport(
    state: State<'_, PostfixServiceState>,
    id: String,
    request: CreateTransportRequest,
) -> CmdResult<PostfixTransport> {
    state
        .lock()
        .await
        .create_transport(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_update_transport(
    state: State<'_, PostfixServiceState>,
    id: String,
    domain: String,
    request: UpdateTransportRequest,
) -> CmdResult<PostfixTransport> {
    state
        .lock()
        .await
        .update_transport(&id, &domain, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_delete_transport(
    state: State<'_, PostfixServiceState>,
    id: String,
    domain: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_transport(&id, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_test_transport(
    state: State<'_, PostfixServiceState>,
    id: String,
    domain: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .test_transport(&id, &domain)
        .await
        .map_err(map_err)
}

// ── Queues ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_list_queues(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixQueue>> {
    state.lock().await.list_queues(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_list_queue_entries(
    state: State<'_, PostfixServiceState>,
    id: String,
    queue_name: String,
) -> CmdResult<Vec<PostfixQueueEntry>> {
    state
        .lock()
        .await
        .list_queue_entries(&id, &queue_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_get_queue_entry(
    state: State<'_, PostfixServiceState>,
    id: String,
    queue_id: String,
) -> CmdResult<PostfixQueueEntry> {
    state
        .lock()
        .await
        .get_queue_entry(&id, &queue_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_flush(state: State<'_, PostfixServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.flush(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_flush_queue(
    state: State<'_, PostfixServiceState>,
    id: String,
    queue_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .flush_queue(&id, &queue_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_delete_queue_entry(
    state: State<'_, PostfixServiceState>,
    id: String,
    queue_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_queue_entry(&id, &queue_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_hold_queue_entry(
    state: State<'_, PostfixServiceState>,
    id: String,
    queue_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .hold_queue_entry(&id, &queue_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_release_queue_entry(
    state: State<'_, PostfixServiceState>,
    id: String,
    queue_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .release_queue_entry(&id, &queue_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_delete_all_queued(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_all_queued(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_requeue_all(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.requeue_all(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_purge_queues(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.purge_queues(&id).await.map_err(map_err)
}

// ── TLS ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_get_tls_config(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<HashMap<String, String>> {
    state
        .lock()
        .await
        .get_tls_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_set_tls_param(
    state: State<'_, PostfixServiceState>,
    id: String,
    name: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_tls_param(&id, &name, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_list_tls_policies(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixTlsPolicy>> {
    state
        .lock()
        .await
        .list_tls_policies(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_set_tls_policy(
    state: State<'_, PostfixServiceState>,
    id: String,
    domain: String,
    policy: PostfixTlsPolicy,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_tls_policy(&id, &domain, &policy)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_delete_tls_policy(
    state: State<'_, PostfixServiceState>,
    id: String,
    domain: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_tls_policy(&id, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_check_certificate(
    state: State<'_, PostfixServiceState>,
    id: String,
    cert_path: String,
) -> CmdResult<CertificateInfo> {
    state
        .lock()
        .await
        .check_certificate(&id, &cert_path)
        .await
        .map_err(map_err)
}

// ── Restrictions ──────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_list_restrictions(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixRestriction>> {
    state
        .lock()
        .await
        .list_restrictions(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_get_restrictions(
    state: State<'_, PostfixServiceState>,
    id: String,
    stage: RestrictionStage,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .get_restrictions(&id, &stage)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_set_restrictions(
    state: State<'_, PostfixServiceState>,
    id: String,
    stage: RestrictionStage,
    restrictions: Vec<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_restrictions(&id, &stage, &restrictions)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_add_restriction(
    state: State<'_, PostfixServiceState>,
    id: String,
    stage: RestrictionStage,
    restriction: String,
    position: Option<u32>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_restriction(&id, &stage, &restriction, position)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_remove_restriction(
    state: State<'_, PostfixServiceState>,
    id: String,
    stage: RestrictionStage,
    restriction: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_restriction(&id, &stage, &restriction)
        .await
        .map_err(map_err)
}

// ── Milters ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_list_milters(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<PostfixMilter>> {
    state.lock().await.list_milters(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_add_milter(
    state: State<'_, PostfixServiceState>,
    id: String,
    milter: PostfixMilter,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_milter(&id, &milter)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_remove_milter(
    state: State<'_, PostfixServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_milter(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_update_milter(
    state: State<'_, PostfixServiceState>,
    id: String,
    name: String,
    milter: PostfixMilter,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_milter(&id, &name, &milter)
        .await
        .map_err(map_err)
}

// ── Process ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_start(state: State<'_, PostfixServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.start(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_stop(state: State<'_, PostfixServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.stop(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_restart(state: State<'_, PostfixServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.restart(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_reload(state: State<'_, PostfixServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reload(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_status(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_version(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn postfix_info(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<PostfixInfo> {
    state.lock().await.info(&id).await.map_err(map_err)
}

// ── Logs ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn postfix_query_mail_log(
    state: State<'_, PostfixServiceState>,
    id: String,
    lines: Option<u32>,
    filter: Option<String>,
) -> CmdResult<Vec<PostfixMailLog>> {
    state
        .lock()
        .await
        .query_mail_log(&id, lines, filter)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_list_log_files(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_log_files(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn postfix_get_statistics(
    state: State<'_, PostfixServiceState>,
    id: String,
) -> CmdResult<MailStatistics> {
    state
        .lock()
        .await
        .get_statistics(&id)
        .await
        .map_err(map_err)
}
