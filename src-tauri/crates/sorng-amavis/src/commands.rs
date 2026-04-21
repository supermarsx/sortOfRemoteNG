// ── sorng-amavis/src/commands.rs ───────────────────────────────────────────────
// Tauri commands – thin wrappers around `AmavisService`.

use tauri::State;

use super::service::AmavisServiceState;
use super::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn amavis_connect(
    state: State<'_, AmavisServiceState>,
    id: String,
    config: AmavisConnectionConfig,
) -> CmdResult<AmavisConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_disconnect(state: State<'_, AmavisServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn amavis_list_connections(
    state: State<'_, AmavisServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn amavis_ping(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<AmavisConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn amavis_get_main_config(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<AmavisMainConfig> {
    state
        .lock()
        .await
        .get_main_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_update_main_config(
    state: State<'_, AmavisServiceState>,
    id: String,
    config: AmavisMainConfig,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_main_config(&id, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_list_snippets(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<Vec<AmavisConfigSnippet>> {
    state.lock().await.list_snippets(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn amavis_get_snippet(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
) -> CmdResult<AmavisConfigSnippet> {
    state
        .lock()
        .await
        .get_snippet(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_create_snippet(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
    content: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_snippet(&id, &name, &content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_update_snippet(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
    content: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_snippet(&id, &name, &content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_delete_snippet(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_snippet(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_enable_snippet(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_snippet(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_disable_snippet(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_snippet(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_test_config(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.test_config(&id).await.map_err(map_err)
}

// ── Policy Banks ──────────────────────────────────────────────────

#[tauri::command]
pub async fn amavis_list_policy_banks(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<Vec<AmavisPolicyBank>> {
    state
        .lock()
        .await
        .list_policy_banks(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_get_policy_bank(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
) -> CmdResult<AmavisPolicyBank> {
    state
        .lock()
        .await
        .get_policy_bank(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_create_policy_bank(
    state: State<'_, AmavisServiceState>,
    id: String,
    req: CreatePolicyBankRequest,
) -> CmdResult<AmavisPolicyBank> {
    state
        .lock()
        .await
        .create_policy_bank(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_update_policy_bank(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
    req: UpdatePolicyBankRequest,
) -> CmdResult<AmavisPolicyBank> {
    state
        .lock()
        .await
        .update_policy_bank(&id, &name, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_delete_policy_bank(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_policy_bank(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_activate_policy_bank(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .activate_policy_bank(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_deactivate_policy_bank(
    state: State<'_, AmavisServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .deactivate_policy_bank(&id, &name)
        .await
        .map_err(map_err)
}

// ── Banned ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn amavis_list_banned_rules(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<Vec<AmavisBannedRule>> {
    state
        .lock()
        .await
        .list_banned_rules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_get_banned_rule(
    state: State<'_, AmavisServiceState>,
    id: String,
    ban_id: String,
) -> CmdResult<AmavisBannedRule> {
    state
        .lock()
        .await
        .get_banned_rule(&id, &ban_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_create_banned_rule(
    state: State<'_, AmavisServiceState>,
    id: String,
    req: CreateBannedRuleRequest,
) -> CmdResult<AmavisBannedRule> {
    state
        .lock()
        .await
        .create_banned_rule(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_update_banned_rule(
    state: State<'_, AmavisServiceState>,
    id: String,
    ban_id: String,
    req: UpdateBannedRuleRequest,
) -> CmdResult<AmavisBannedRule> {
    state
        .lock()
        .await
        .update_banned_rule(&id, &ban_id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_delete_banned_rule(
    state: State<'_, AmavisServiceState>,
    id: String,
    ban_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_banned_rule(&id, &ban_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_test_filename(
    state: State<'_, AmavisServiceState>,
    id: String,
    filename: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .test_filename(&id, &filename)
        .await
        .map_err(map_err)
}

// ── Lists (Whitelist / Blacklist) ─────────────────────────────────

#[tauri::command]
pub async fn amavis_list_entries(
    state: State<'_, AmavisServiceState>,
    id: String,
    list_type: AmavisListType,
) -> CmdResult<Vec<AmavisListEntry>> {
    state
        .lock()
        .await
        .list_entries(&id, &list_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_get_list_entry(
    state: State<'_, AmavisServiceState>,
    id: String,
    entry_id: String,
) -> CmdResult<AmavisListEntry> {
    state
        .lock()
        .await
        .get_list_entry(&id, &entry_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_add_list_entry(
    state: State<'_, AmavisServiceState>,
    id: String,
    req: CreateListEntryRequest,
) -> CmdResult<AmavisListEntry> {
    state
        .lock()
        .await
        .add_list_entry(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_update_list_entry(
    state: State<'_, AmavisServiceState>,
    id: String,
    entry_id: String,
    req: UpdateListEntryRequest,
) -> CmdResult<AmavisListEntry> {
    state
        .lock()
        .await
        .update_list_entry(&id, &entry_id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_remove_list_entry(
    state: State<'_, AmavisServiceState>,
    id: String,
    entry_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_list_entry(&id, &entry_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_check_sender(
    state: State<'_, AmavisServiceState>,
    id: String,
    sender_address: String,
) -> CmdResult<AmavisListCheckResult> {
    state
        .lock()
        .await
        .check_sender(&id, &sender_address)
        .await
        .map_err(map_err)
}

// ── Quarantine ────────────────────────────────────────────────────

#[tauri::command]
pub async fn amavis_list_quarantine(
    state: State<'_, AmavisServiceState>,
    id: String,
    request: QuarantineListRequest,
) -> CmdResult<Vec<AmavisQuarantineItem>> {
    state
        .lock()
        .await
        .list_quarantine(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_get_quarantine(
    state: State<'_, AmavisServiceState>,
    id: String,
    mail_id: String,
) -> CmdResult<AmavisQuarantineItem> {
    state
        .lock()
        .await
        .get_quarantine(&id, &mail_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_release_quarantine(
    state: State<'_, AmavisServiceState>,
    id: String,
    mail_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .release_quarantine(&id, &mail_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_delete_quarantine(
    state: State<'_, AmavisServiceState>,
    id: String,
    mail_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_quarantine(&id, &mail_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_release_all_quarantine(
    state: State<'_, AmavisServiceState>,
    id: String,
    quarantine_type: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .release_all_quarantine(&id, &quarantine_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_delete_all_quarantine(
    state: State<'_, AmavisServiceState>,
    id: String,
    quarantine_type: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_all_quarantine(&id, &quarantine_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_get_quarantine_stats(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<AmavisQuarantineStats> {
    state
        .lock()
        .await
        .get_quarantine_stats(&id)
        .await
        .map_err(map_err)
}

// ── Stats ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn amavis_get_stats(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<AmavisStats> {
    state.lock().await.get_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn amavis_get_child_processes(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<Vec<AmavisChildProcess>> {
    state
        .lock()
        .await
        .get_child_processes(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_get_throughput(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<AmavisThroughput> {
    state
        .lock()
        .await
        .get_throughput(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_reset_stats(state: State<'_, AmavisServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reset_stats(&id).await.map_err(map_err)
}

// ── Process ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn amavis_start(state: State<'_, AmavisServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.start(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn amavis_stop(state: State<'_, AmavisServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.stop(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn amavis_restart(state: State<'_, AmavisServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.restart(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn amavis_reload(state: State<'_, AmavisServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reload(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn amavis_process_status(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<AmavisProcessInfo> {
    state
        .lock()
        .await
        .process_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_version(state: State<'_, AmavisServiceState>, id: String) -> CmdResult<String> {
    state.lock().await.version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn amavis_debug_sa(
    state: State<'_, AmavisServiceState>,
    id: String,
    message: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .debug_sa(&id, &message)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn amavis_show_config(
    state: State<'_, AmavisServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.show_config(&id).await.map_err(map_err)
}
