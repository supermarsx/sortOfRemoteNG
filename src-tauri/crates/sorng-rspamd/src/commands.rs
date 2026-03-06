// ── sorng-rspamd/src/commands.rs ──────────────────────────────────────────────
//! Tauri commands – thin wrappers around `RspamdService`.

use tauri::State;
use crate::service::RspamdServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn rspamd_connect(
    state: State<'_, RspamdServiceState>,
    id: String,
    config: RspamdConnectionConfig,
) -> CmdResult<RspamdConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_disconnect(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_list_connections(
    state: State<'_, RspamdServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn rspamd_ping(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<RspamdConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Scanning ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn rspamd_check_message(
    state: State<'_, RspamdServiceState>,
    id: String,
    message: String,
) -> CmdResult<RspamdScanResult> {
    state.lock().await.check_message(&id, &message).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_check_file(
    state: State<'_, RspamdServiceState>,
    id: String,
    path: String,
) -> CmdResult<RspamdScanResult> {
    state.lock().await.check_file(&id, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_learn_spam(
    state: State<'_, RspamdServiceState>,
    id: String,
    message: String,
) -> CmdResult<RspamdBayesLearnResult> {
    state.lock().await.learn_spam(&id, &message).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_learn_ham(
    state: State<'_, RspamdServiceState>,
    id: String,
    message: String,
) -> CmdResult<RspamdBayesLearnResult> {
    state.lock().await.learn_ham(&id, &message).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_fuzzy_add(
    state: State<'_, RspamdServiceState>,
    id: String,
    message: String,
    flag: u32,
    weight: f64,
) -> CmdResult<()> {
    state.lock().await.fuzzy_add(&id, &message, flag, weight).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_fuzzy_delete(
    state: State<'_, RspamdServiceState>,
    id: String,
    message: String,
    flag: u32,
) -> CmdResult<()> {
    state.lock().await.fuzzy_delete(&id, &message, flag).await.map_err(map_err)
}

// ── Statistics ────────────────────────────────────────────────────

#[tauri::command]
pub async fn rspamd_get_stats(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<RspamdStat> {
    state.lock().await.get_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_graph(
    state: State<'_, RspamdServiceState>,
    id: String,
    graph_type: String,
) -> CmdResult<Vec<RspamdGraphData>> {
    state.lock().await.get_graph(&id, &graph_type).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_throughput(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<RspamdGraphData>> {
    state.lock().await.get_throughput(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_reset_stats(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.reset_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_errors(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.get_errors(&id).await.map_err(map_err)
}

// ── Symbols ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn rspamd_list_symbols(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<RspamdSymbol>> {
    state.lock().await.list_symbols(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_symbol(
    state: State<'_, RspamdServiceState>,
    id: String,
    name: String,
) -> CmdResult<RspamdSymbol> {
    state.lock().await.get_symbol(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_list_symbol_groups(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<RspamdSymbolGroup>> {
    state.lock().await.list_symbol_groups(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_symbol_group(
    state: State<'_, RspamdServiceState>,
    id: String,
    name: String,
) -> CmdResult<RspamdSymbolGroup> {
    state.lock().await.get_symbol_group(&id, &name).await.map_err(map_err)
}

// ── Actions ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn rspamd_list_actions(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<RspamdAction>> {
    state.lock().await.list_actions(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_action(
    state: State<'_, RspamdServiceState>,
    id: String,
    name: String,
) -> CmdResult<RspamdAction> {
    state.lock().await.get_action(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_set_action(
    state: State<'_, RspamdServiceState>,
    id: String,
    name: String,
    threshold: f64,
) -> CmdResult<()> {
    state.lock().await.set_action(&id, &name, threshold).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_enable_action(
    state: State<'_, RspamdServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.enable_action(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_disable_action(
    state: State<'_, RspamdServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.disable_action(&id, &name).await.map_err(map_err)
}

// ── Maps ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn rspamd_list_maps(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<RspamdMap>> {
    state.lock().await.list_maps(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_map(
    state: State<'_, RspamdServiceState>,
    id: String,
    map_id: u64,
) -> CmdResult<RspamdMap> {
    state.lock().await.get_map(&id, map_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_map_entries(
    state: State<'_, RspamdServiceState>,
    id: String,
    map_id: u64,
) -> CmdResult<Vec<RspamdMapEntry>> {
    state.lock().await.get_map_entries(&id, map_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_save_map_entries(
    state: State<'_, RspamdServiceState>,
    id: String,
    map_id: u64,
    content: String,
) -> CmdResult<()> {
    state.lock().await.save_map_entries(&id, map_id, &content).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_add_map_entry(
    state: State<'_, RspamdServiceState>,
    id: String,
    map_id: u64,
    key: String,
    value: Option<String>,
) -> CmdResult<()> {
    state.lock().await.add_map_entry(&id, map_id, &key, value.as_deref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_remove_map_entry(
    state: State<'_, RspamdServiceState>,
    id: String,
    map_id: u64,
    key: String,
) -> CmdResult<()> {
    state.lock().await.remove_map_entry(&id, map_id, &key).await.map_err(map_err)
}

// ── History ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn rspamd_get_history(
    state: State<'_, RspamdServiceState>,
    id: String,
    limit: Option<u64>,
    offset: Option<u64>,
) -> CmdResult<RspamdHistory> {
    state.lock().await.get_history(&id, limit, offset).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_history_entry(
    state: State<'_, RspamdServiceState>,
    id: String,
    entry_id: String,
) -> CmdResult<RspamdHistoryEntry> {
    state.lock().await.get_history_entry(&id, &entry_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_reset_history(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.reset_history(&id).await.map_err(map_err)
}

// ── Workers ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn rspamd_list_workers(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<RspamdWorker>> {
    state.lock().await.list_workers(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_worker(
    state: State<'_, RspamdServiceState>,
    id: String,
    worker_id: String,
) -> CmdResult<RspamdWorker> {
    state.lock().await.get_worker(&id, &worker_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_list_neighbours(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<RspamdNeighbour>> {
    state.lock().await.list_neighbours(&id).await.map_err(map_err)
}

// ── Fuzzy ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn rspamd_fuzzy_status(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<RspamdFuzzyStatus>> {
    state.lock().await.fuzzy_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_fuzzy_check(
    state: State<'_, RspamdServiceState>,
    id: String,
    message: String,
) -> CmdResult<Vec<RspamdSymbolResult>> {
    state.lock().await.fuzzy_check(&id, &message).await.map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn rspamd_get_actions_config(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<RspamdAction>> {
    state.lock().await.get_actions_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_get_plugins(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<Vec<RspamdPlugin>> {
    state.lock().await.get_plugins(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_enable_plugin(
    state: State<'_, RspamdServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.enable_plugin(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_disable_plugin(
    state: State<'_, RspamdServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.disable_plugin(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_reload_config(
    state: State<'_, RspamdServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.reload_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn rspamd_save_actions_config(
    state: State<'_, RspamdServiceState>,
    id: String,
    actions: Vec<RspamdAction>,
) -> CmdResult<()> {
    state.lock().await.save_actions_config(&id, actions).await.map_err(map_err)
}
