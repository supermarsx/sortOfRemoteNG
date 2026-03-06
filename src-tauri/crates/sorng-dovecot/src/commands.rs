// ── sorng-dovecot/src/commands.rs ────────────────────────────────────────────
//! Tauri commands – thin wrappers around `DovecotServiceFacade`.

use std::collections::HashMap;
use tauri::State;

use crate::service::DovecotServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn dovecot_connect(
    state: State<'_, DovecotServiceState>,
    id: String,
    config: DovecotConnectionConfig,
) -> CmdResult<DovecotConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_disconnect(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_list_connections(
    state: State<'_, DovecotServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn dovecot_ping(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<bool> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Mailboxes ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn dovecot_list_mailboxes(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<DovecotMailbox>> {
    state
        .lock()
        .await
        .list_mailboxes(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_mailbox_status(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    mailbox: String,
) -> CmdResult<DovecotMailboxStatus> {
    state
        .lock()
        .await
        .mailbox_status(&id, &user, &mailbox)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_create_mailbox(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_mailbox(&id, &user, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_delete_mailbox(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_mailbox(&id, &user, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_rename_mailbox(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    old_name: String,
    new_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .rename_mailbox(&id, &user, &old_name, &new_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_subscribe_mailbox(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .subscribe_mailbox(&id, &user, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_unsubscribe_mailbox(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .unsubscribe_mailbox(&id, &user, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_list_subscriptions(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_subscriptions(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_sync_mailbox(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .sync_mailbox(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_force_resync(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    mailbox: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .force_resync(&id, &user, &mailbox)
        .await
        .map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dovecot_list_users(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<Vec<DovecotUser>> {
    state.lock().await.list_users(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_get_user(
    state: State<'_, DovecotServiceState>,
    id: String,
    username: String,
) -> CmdResult<DovecotUser> {
    state
        .lock()
        .await
        .get_user(&id, &username)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_create_user(
    state: State<'_, DovecotServiceState>,
    id: String,
    request: CreateUserRequest,
) -> CmdResult<DovecotUser> {
    state
        .lock()
        .await
        .create_user(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_update_user(
    state: State<'_, DovecotServiceState>,
    id: String,
    username: String,
    request: UpdateUserRequest,
) -> CmdResult<DovecotUser> {
    state
        .lock()
        .await
        .update_user(&id, &username, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_delete_user(
    state: State<'_, DovecotServiceState>,
    id: String,
    username: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_user(&id, &username)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_auth_test(
    state: State<'_, DovecotServiceState>,
    id: String,
    username: String,
    password: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .auth_test(&id, &username, &password)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_kick_user(
    state: State<'_, DovecotServiceState>,
    id: String,
    username: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .kick_user(&id, &username)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_who(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<Vec<DovecotProcess>> {
    state.lock().await.who(&id).await.map_err(map_err)
}

// ── Sieve ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dovecot_list_sieve(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<DovecotSieveScript>> {
    state
        .lock()
        .await
        .list_sieve(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_get_sieve(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<DovecotSieveScript> {
    state
        .lock()
        .await
        .get_sieve(&id, &user, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_create_sieve(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    request: CreateSieveRequest,
) -> CmdResult<DovecotSieveScript> {
    state
        .lock()
        .await
        .create_sieve(&id, &user, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_update_sieve(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    name: String,
    request: UpdateSieveRequest,
) -> CmdResult<DovecotSieveScript> {
    state
        .lock()
        .await
        .update_sieve(&id, &user, &name, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_delete_sieve(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_sieve(&id, &user, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_activate_sieve(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .activate_sieve(&id, &user, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_deactivate_sieve(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .deactivate_sieve(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_compile_sieve(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<ConfigTestResult> {
    state
        .lock()
        .await
        .compile_sieve(&id, &user, &name)
        .await
        .map_err(map_err)
}

// ── Quota ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dovecot_get_quota(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
) -> CmdResult<DovecotQuota> {
    state
        .lock()
        .await
        .get_quota(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_set_quota(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    rule: DovecotQuotaRule,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_quota(&id, &user, rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_recalculate_quota(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .recalculate_quota(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_list_quota_rules(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<Vec<DovecotQuotaRule>> {
    state
        .lock()
        .await
        .list_quota_rules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_set_quota_rule(
    state: State<'_, DovecotServiceState>,
    id: String,
    rule: DovecotQuotaRule,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_quota_rule(&id, rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_delete_quota_rule(
    state: State<'_, DovecotServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_quota_rule(&id, &name)
        .await
        .map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dovecot_get_config(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<Vec<DovecotConfigParam>> {
    state
        .lock()
        .await
        .get_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_get_config_param(
    state: State<'_, DovecotServiceState>,
    id: String,
    name: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_config_param(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_set_config_param(
    state: State<'_, DovecotServiceState>,
    id: String,
    name: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_config_param(&id, &name, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_list_namespaces(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<Vec<DovecotNamespace>> {
    state
        .lock()
        .await
        .list_namespaces(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_get_namespace(
    state: State<'_, DovecotServiceState>,
    id: String,
    name: String,
) -> CmdResult<DovecotNamespace> {
    state
        .lock()
        .await
        .get_namespace(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_list_plugins(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<Vec<DovecotPlugin>> {
    state
        .lock()
        .await
        .list_plugins(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_enable_plugin(
    state: State<'_, DovecotServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_plugin(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_disable_plugin(
    state: State<'_, DovecotServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_plugin(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_configure_plugin(
    state: State<'_, DovecotServiceState>,
    id: String,
    name: String,
    settings: HashMap<String, String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .configure_plugin(&id, &name, settings)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_get_auth_config(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<DovecotAuthConfig> {
    state
        .lock()
        .await
        .get_auth_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_list_services(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<Vec<DovecotService>> {
    state
        .lock()
        .await
        .list_services(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_test_config(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<ConfigTestResult> {
    state
        .lock()
        .await
        .test_config(&id)
        .await
        .map_err(map_err)
}

// ── ACL ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dovecot_list_acls(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    mailbox: String,
) -> CmdResult<Vec<DovecotAcl>> {
    state
        .lock()
        .await
        .list_acls(&id, &user, &mailbox)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_get_acl(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    mailbox: String,
    identifier: String,
) -> CmdResult<DovecotAcl> {
    state
        .lock()
        .await
        .get_acl(&id, &user, &mailbox, &identifier)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_set_acl(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    mailbox: String,
    identifier: String,
    rights: Vec<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_acl(&id, &user, &mailbox, &identifier, rights)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_delete_acl(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    mailbox: String,
    identifier: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_acl(&id, &user, &mailbox, &identifier)
        .await
        .map_err(map_err)
}

// ── Replication ───────────────────────────────────────────────────

#[tauri::command]
pub async fn dovecot_replication_status(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<Vec<DovecotReplication>> {
    state
        .lock()
        .await
        .replication_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_replicate_user(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    priority: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .replicate_user(&id, &user, &priority)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_dsync_backup(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    remote: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .dsync_backup(&id, &user, &remote)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_dsync_mirror(
    state: State<'_, DovecotServiceState>,
    id: String,
    user: String,
    remote: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .dsync_mirror(&id, &user, &remote)
        .await
        .map_err(map_err)
}

// ── Process ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn dovecot_start(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.start(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_stop(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.stop(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_restart(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.restart(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_reload(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.reload(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_status(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_version(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_info(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<DovecotInfo> {
    state.lock().await.info(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_process_who(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<Vec<DovecotProcess>> {
    state.lock().await.process_who(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_process_stats(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<Vec<DovecotStats>> {
    state
        .lock()
        .await
        .process_stats(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_process_test_config(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<ConfigTestResult> {
    state
        .lock()
        .await
        .process_test_config(&id)
        .await
        .map_err(map_err)
}

// ── Logs ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dovecot_query_log(
    state: State<'_, DovecotServiceState>,
    id: String,
    lines: Option<u32>,
    filter: Option<String>,
) -> CmdResult<Vec<DovecotLog>> {
    state
        .lock()
        .await
        .query_log(&id, lines, filter)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_list_log_files(
    state: State<'_, DovecotServiceState>,
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
pub async fn dovecot_set_log_level(
    state: State<'_, DovecotServiceState>,
    id: String,
    level: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_log_level(&id, &level)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dovecot_get_log_level(
    state: State<'_, DovecotServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_log_level(&id)
        .await
        .map_err(map_err)
}
