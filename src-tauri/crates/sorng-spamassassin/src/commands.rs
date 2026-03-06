// ── sorng-spamassassin/src/commands.rs ───────────────────────────────────────
//! Tauri commands – thin wrappers around `SpamAssassinService`.

use std::collections::HashMap;
use tauri::State;

use crate::service::SpamAssassinServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn spam_connect(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    config: SpamAssassinConnectionConfig,
) -> CmdResult<SpamAssassinConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_disconnect(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn spam_list_connections(
    state: State<'_, SpamAssassinServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn spam_ping(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<bool> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Rules ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn spam_list_rules(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<Vec<SpamRule>> {
    state.lock().await.list_rules(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn spam_get_rule(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
) -> CmdResult<SpamRule> {
    state
        .lock()
        .await
        .get_rule(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_list_scores(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<Vec<SpamRuleScore>> {
    state.lock().await.list_scores(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn spam_set_score(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
    score: f64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_score(&id, &name, score)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_create_custom_rule(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    req: CreateCustomRuleRequest,
) -> CmdResult<SpamRule> {
    state
        .lock()
        .await
        .create_custom_rule(&id, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_delete_custom_rule(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_custom_rule(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_enable_rule(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_rule(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_disable_rule(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_rule(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_list_custom_rules(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<Vec<SpamRule>> {
    state
        .lock()
        .await
        .list_custom_rules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_get_rule_description(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_rule_description(&id, &name)
        .await
        .map_err(map_err)
}

// ── Bayes ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn spam_bayes_status(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<BayesStatus> {
    state
        .lock()
        .await
        .bayes_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_learn_spam(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    message: String,
) -> CmdResult<BayesLearnResult> {
    state
        .lock()
        .await
        .learn_spam(&id, &message)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_learn_ham(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    message: String,
) -> CmdResult<BayesLearnResult> {
    state
        .lock()
        .await
        .learn_ham(&id, &message)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_learn_spam_folder(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    user: String,
    folder: String,
) -> CmdResult<BayesLearnResult> {
    state
        .lock()
        .await
        .learn_spam_folder(&id, &user, &folder)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_learn_ham_folder(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    user: String,
    folder: String,
) -> CmdResult<BayesLearnResult> {
    state
        .lock()
        .await
        .learn_ham_folder(&id, &user, &folder)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_bayes_forget(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    message: String,
) -> CmdResult<BayesLearnResult> {
    state
        .lock()
        .await
        .bayes_forget(&id, &message)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_bayes_clear(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .bayes_clear(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_bayes_sync(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .bayes_sync(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_bayes_backup(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .bayes_backup(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_bayes_restore(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    data: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .bayes_restore(&id, &data)
        .await
        .map_err(map_err)
}

// ── Channels ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn spam_list_channels(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<Vec<SpamChannel>> {
    state
        .lock()
        .await
        .list_channels(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_update_all_channels(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<Vec<ChannelUpdateResult>> {
    state
        .lock()
        .await
        .update_all_channels(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_update_channel(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    channel_name: String,
) -> CmdResult<ChannelUpdateResult> {
    state
        .lock()
        .await
        .update_channel(&id, &channel_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_add_channel(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
    url: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_channel(&id, &name, &url)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_remove_channel(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_channel(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_list_channel_keys(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_channel_keys(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_import_channel_key(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    key: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .import_channel_key(&id, &key)
        .await
        .map_err(map_err)
}

// ── Whitelist ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn spam_list_whitelist(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<Vec<SpamWhitelistEntry>> {
    state
        .lock()
        .await
        .list_whitelist(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_add_whitelist(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    entry: SpamWhitelistEntry,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_whitelist(&id, entry)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_remove_whitelist(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    entry_type: String,
    pattern: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_whitelist(&id, &entry_type, &pattern)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_list_trusted_networks(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<Vec<SpamTrustedNetwork>> {
    state
        .lock()
        .await
        .list_trusted_networks(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_add_trusted_network(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    network: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_trusted_network(&id, &network)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_remove_trusted_network(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    network: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_trusted_network(&id, &network)
        .await
        .map_err(map_err)
}

// ── Plugins ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn spam_list_plugins(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<Vec<SpamPlugin>> {
    state
        .lock()
        .await
        .list_plugins(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_get_plugin(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
) -> CmdResult<SpamPlugin> {
    state
        .lock()
        .await
        .get_plugin(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_enable_plugin(
    state: State<'_, SpamAssassinServiceState>,
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
pub async fn spam_disable_plugin(
    state: State<'_, SpamAssassinServiceState>,
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
pub async fn spam_configure_plugin(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
    key: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .configure_plugin(&id, &name, &key, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_get_plugin_config(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    name: String,
) -> CmdResult<HashMap<String, String>> {
    state
        .lock()
        .await
        .get_plugin_config(&id, &name)
        .await
        .map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn spam_get_local_cf(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_local_cf(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_set_local_cf(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    content: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_local_cf(&id, &content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_get_param(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    key: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_param(&id, &key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_set_param(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    key: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_param(&id, &key, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_delete_param(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    key: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_param(&id, &key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_get_spamd_config(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<SpamdConfig> {
    state
        .lock()
        .await
        .get_spamd_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_set_spamd_config(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    config: SpamdConfig,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_spamd_config(&id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_test_config(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<ConfigTestResult> {
    state
        .lock()
        .await
        .test_config(&id)
        .await
        .map_err(map_err)
}

// ── Scanning ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn spam_check_message(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    message: String,
) -> CmdResult<SpamCheckResult> {
    state
        .lock()
        .await
        .check_message(&id, &message)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_check_file(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    path: String,
) -> CmdResult<SpamCheckResult> {
    state
        .lock()
        .await
        .check_file(&id, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_report_message(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    message: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .report_message(&id, &message)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_revoke_message(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    message: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .revoke_message(&id, &message)
        .await
        .map_err(map_err)
}

// ── Process ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn spam_start(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.start(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn spam_stop(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.stop(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn spam_restart(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.restart(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn spam_reload(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.reload(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn spam_status(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<SpamdStatus> {
    state.lock().await.status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn spam_version(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn spam_info(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<SpamAssassinInfo> {
    state.lock().await.info(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn spam_lint(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<ConfigTestResult> {
    state.lock().await.lint(&id).await.map_err(map_err)
}

// ── Logs ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn spam_query_log(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
    lines: Option<u32>,
    filter: Option<String>,
) -> CmdResult<Vec<SpamLog>> {
    state
        .lock()
        .await
        .query_log(&id, lines, filter)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn spam_list_log_files(
    state: State<'_, SpamAssassinServiceState>,
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
pub async fn spam_get_statistics(
    state: State<'_, SpamAssassinServiceState>,
    id: String,
) -> CmdResult<SpamStatistics> {
    state
        .lock()
        .await
        .get_statistics(&id)
        .await
        .map_err(map_err)
}
