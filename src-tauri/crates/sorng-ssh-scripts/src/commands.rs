// ── sorng-ssh-scripts/src/commands.rs ────────────────────────────────────────
// Tauri IPC commands for SSH event script management.

use std::collections::HashMap;
use tauri::{command, State};

use super::engine::SshScriptEngineState;
use super::error::SshScriptError;
use super::types::*;

type Res<T> = Result<T, String>;
fn e(err: SshScriptError) -> String {
    err.to_string()
}

// ── Script CRUD ──────────────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_create_script(
    state: State<'_, SshScriptEngineState>,
    request: CreateScriptRequest,
) -> Res<SshEventScript> {
    let mut eng = state.lock().await;
    eng.store.create_script(request).map_err(e)
}

#[command]
pub async fn ssh_scripts_get_script(
    state: State<'_, SshScriptEngineState>,
    script_id: String,
) -> Res<SshEventScript> {
    let eng = state.lock().await;
    eng.store.get_script(&script_id).map_err(e)
}

#[command]
pub async fn ssh_scripts_list_scripts(
    state: State<'_, SshScriptEngineState>,
) -> Res<Vec<SshEventScript>> {
    let eng = state.lock().await;
    Ok(eng.store.list_scripts())
}

#[command]
pub async fn ssh_scripts_update_script(
    state: State<'_, SshScriptEngineState>,
    script_id: String,
    request: UpdateScriptRequest,
) -> Res<SshEventScript> {
    let mut eng = state.lock().await;
    let mut req = request;
    req.id = script_id;
    eng.store.update_script(req).map_err(e)
}

#[command]
pub async fn ssh_scripts_delete_script(
    state: State<'_, SshScriptEngineState>,
    script_id: String,
) -> Res<()> {
    let mut eng = state.lock().await;
    eng.store.delete_script(&script_id).map_err(e)
}

#[command]
pub async fn ssh_scripts_duplicate_script(
    state: State<'_, SshScriptEngineState>,
    script_id: String,
) -> Res<SshEventScript> {
    let mut eng = state.lock().await;
    eng.store.duplicate_script(&script_id).map_err(e)
}

#[command]
pub async fn ssh_scripts_toggle_script(
    state: State<'_, SshScriptEngineState>,
    script_id: String,
    enabled: bool,
) -> Res<()> {
    let mut eng = state.lock().await;
    let script = eng.store.get_script(&script_id).map_err(e)?;
    if script.enabled != enabled {
        eng.store.toggle_script(&script_id).map_err(e)?;
    }
    Ok(())
}

// ── Chain CRUD ───────────────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_create_chain(
    state: State<'_, SshScriptEngineState>,
    request: CreateChainRequest,
) -> Res<ScriptChain> {
    let mut eng = state.lock().await;
    eng.store.create_chain(request).map_err(e)
}

#[command]
pub async fn ssh_scripts_get_chain(
    state: State<'_, SshScriptEngineState>,
    chain_id: String,
) -> Res<ScriptChain> {
    let eng = state.lock().await;
    eng.store.get_chain(&chain_id).map_err(e)
}

#[command]
pub async fn ssh_scripts_list_chains(
    state: State<'_, SshScriptEngineState>,
) -> Res<Vec<ScriptChain>> {
    let eng = state.lock().await;
    Ok(eng.store.list_chains())
}

#[command]
pub async fn ssh_scripts_update_chain(
    state: State<'_, SshScriptEngineState>,
    chain_id: String,
    request: UpdateChainRequest,
) -> Res<ScriptChain> {
    let mut eng = state.lock().await;
    let mut req = request;
    req.id = chain_id;
    eng.store.update_chain(req).map_err(e)
}

#[command]
pub async fn ssh_scripts_delete_chain(
    state: State<'_, SshScriptEngineState>,
    chain_id: String,
) -> Res<()> {
    let mut eng = state.lock().await;
    eng.store.delete_chain(&chain_id).map_err(e)
}

#[command]
pub async fn ssh_scripts_toggle_chain(
    state: State<'_, SshScriptEngineState>,
    chain_id: String,
    enabled: bool,
) -> Res<()> {
    let mut eng = state.lock().await;
    let chain = eng.store.get_chain(&chain_id).map_err(e)?;
    if chain.enabled != enabled {
        eng.store.toggle_chain(&chain_id).map_err(e)?;
    }
    Ok(())
}

// ── Execution ────────────────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_run_script(
    state: State<'_, SshScriptEngineState>,
    request: RunScriptRequest,
) -> Res<super::engine::PendingExecution> {
    let mut eng = state.lock().await;
    eng.run_script(&request).map_err(e)
}

#[command]
pub async fn ssh_scripts_run_chain(
    state: State<'_, SshScriptEngineState>,
    request: RunChainRequest,
) -> Res<Vec<super::engine::PendingExecution>> {
    let mut eng = state.lock().await;
    eng.run_chain(&request).map_err(e)
}

#[command]
pub async fn ssh_scripts_record_execution(
    state: State<'_, SshScriptEngineState>,
    record: ExecutionRecord,
) -> Res<()> {
    let mut eng = state.lock().await;
    eng.record_execution(record);
    Ok(())
}

// ── Event Handling ───────────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_notify_event(
    state: State<'_, SshScriptEngineState>,
    event: SshLifecycleEvent,
) -> Res<Vec<super::engine::PendingExecution>> {
    let mut eng = state.lock().await;
    Ok(eng.process_event(&event))
}

#[command]
pub async fn ssh_scripts_notify_output(
    state: State<'_, SshScriptEngineState>,
    session_id: String,
    data: String,
) -> Res<Vec<super::engine::PendingExecution>> {
    let mut eng = state.lock().await;
    Ok(eng.process_output(&session_id, &data))
}

#[command]
pub async fn ssh_scripts_scheduler_tick(
    state: State<'_, SshScriptEngineState>,
) -> Res<Vec<super::engine::PendingExecution>> {
    let mut eng = state.lock().await;
    let mut execs = eng.tick();
    execs.extend(eng.check_idle());
    execs.extend(eng.drain_pending());
    Ok(execs)
}

// ── Session Management ───────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_register_session(
    state: State<'_, SshScriptEngineState>,
    session_id: String,
    connection_id: Option<String>,
    host: Option<String>,
    username: Option<String>,
) -> Res<()> {
    let mut eng = state.lock().await;
    eng.register_session(
        &session_id,
        connection_id.as_deref(),
        host.as_deref(),
        username.as_deref(),
    );
    Ok(())
}

#[command]
pub async fn ssh_scripts_unregister_session(
    state: State<'_, SshScriptEngineState>,
    session_id: String,
) -> Res<()> {
    let mut eng = state.lock().await;
    eng.unregister_session(&session_id);
    Ok(())
}

// ── History & Stats ──────────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_query_history(
    state: State<'_, SshScriptEngineState>,
    query: HistoryQuery,
) -> Res<HistoryResponse> {
    let eng = state.lock().await;
    Ok(eng.history.query(&query))
}

#[command]
pub async fn ssh_scripts_get_execution(
    state: State<'_, SshScriptEngineState>,
    execution_id: String,
) -> Res<ExecutionRecord> {
    let eng = state.lock().await;
    eng.history
        .get_record(&execution_id)
        .ok_or_else(|| "Execution record not found".to_string())
}

#[command]
pub async fn ssh_scripts_get_chain_execution(
    state: State<'_, SshScriptEngineState>,
    chain_execution_id: String,
) -> Res<ChainExecutionRecord> {
    let eng = state.lock().await;
    eng.history
        .get_chain_record(&chain_execution_id)
        .ok_or_else(|| "Chain execution record not found".to_string())
}

#[command]
pub async fn ssh_scripts_get_script_stats(
    state: State<'_, SshScriptEngineState>,
    script_id: String,
) -> Res<ScriptStats> {
    let eng = state.lock().await;
    Ok(eng.history.get_script_stats(&script_id))
}

#[command]
pub async fn ssh_scripts_get_all_stats(
    state: State<'_, SshScriptEngineState>,
) -> Res<Vec<super::types::ScriptStats>> {
    let eng = state.lock().await;
    Ok(eng.history.get_all_stats())
}

#[command]
pub async fn ssh_scripts_clear_history(state: State<'_, SshScriptEngineState>) -> Res<()> {
    let mut eng = state.lock().await;
    eng.history.clear_history();
    Ok(())
}

#[command]
pub async fn ssh_scripts_clear_script_history(
    state: State<'_, SshScriptEngineState>,
    script_id: String,
) -> Res<()> {
    let mut eng = state.lock().await;
    eng.history.clear_script_history(&script_id);
    Ok(())
}

// ── Scheduler Info ───────────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_list_timers(
    state: State<'_, SshScriptEngineState>,
) -> Res<Vec<super::types::SchedulerEntry>> {
    let eng = state.lock().await;
    Ok(eng.scheduler.get_entries())
}

#[command]
pub async fn ssh_scripts_list_session_timers(
    state: State<'_, SshScriptEngineState>,
    session_id: String,
) -> Res<Vec<super::types::SchedulerEntry>> {
    let eng = state.lock().await;
    Ok(eng.scheduler.get_session_entries(&session_id))
}

#[command]
pub async fn ssh_scripts_pause_timer(
    state: State<'_, SshScriptEngineState>,
    script_id: String,
    session_id: String,
) -> Res<()> {
    let mut eng = state.lock().await;
    let timer_id = format!("{}:{}", session_id, script_id);
    eng.scheduler.pause(&timer_id);
    Ok(())
}

#[command]
pub async fn ssh_scripts_resume_timer(
    state: State<'_, SshScriptEngineState>,
    script_id: String,
    session_id: String,
) -> Res<()> {
    let mut eng = state.lock().await;
    let timer_id = format!("{}:{}", session_id, script_id);
    eng.scheduler.resume(&timer_id);
    Ok(())
}

// ── Filtering ────────────────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_list_by_tag(
    state: State<'_, SshScriptEngineState>,
    tag: String,
) -> Res<Vec<SshEventScript>> {
    let eng = state.lock().await;
    Ok(eng.store.list_scripts_by_tag(&tag))
}

#[command]
pub async fn ssh_scripts_list_by_category(
    state: State<'_, SshScriptEngineState>,
    category: String,
) -> Res<Vec<SshEventScript>> {
    let eng = state.lock().await;
    Ok(eng.store.list_scripts_by_category(&category))
}

#[command]
pub async fn ssh_scripts_list_by_trigger(
    state: State<'_, SshScriptEngineState>,
    trigger_type: String,
) -> Res<Vec<SshEventScript>> {
    let eng = state.lock().await;
    Ok(eng.store.list_scripts_by_trigger(&trigger_type))
}

#[command]
pub async fn ssh_scripts_get_tags(state: State<'_, SshScriptEngineState>) -> Res<Vec<String>> {
    let eng = state.lock().await;
    Ok(eng.store.get_all_tags())
}

#[command]
pub async fn ssh_scripts_get_categories(
    state: State<'_, SshScriptEngineState>,
) -> Res<Vec<String>> {
    let eng = state.lock().await;
    Ok(eng.store.get_all_categories())
}

// ── Import/Export ────────────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_export(state: State<'_, SshScriptEngineState>) -> Res<ScriptBundle> {
    let eng = state.lock().await;
    Ok(eng.store.export_bundle())
}

#[command]
pub async fn ssh_scripts_import(
    state: State<'_, SshScriptEngineState>,
    bundle: ScriptBundle,
) -> Res<serde_json::Value> {
    let mut eng = state.lock().await;
    let (scripts_imported, chains_imported) = eng
        .store
        .import_bundle(bundle, false)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "scriptsImported": scripts_imported,
        "chainsImported": chains_imported
    }))
}

// ── Bulk ─────────────────────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_bulk_enable(
    state: State<'_, SshScriptEngineState>,
    script_ids: Vec<String>,
    _enabled: bool,
) -> Res<u32> {
    let mut eng = state.lock().await;
    let mut count = 0u32;
    for id in &script_ids {
        if eng.store.toggle_script(id).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

#[command]
pub async fn ssh_scripts_bulk_delete(
    state: State<'_, SshScriptEngineState>,
    script_ids: Vec<String>,
) -> Res<u32> {
    let mut eng = state.lock().await;
    let mut count = 0u32;
    for id in &script_ids {
        if eng.store.delete_script(id).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

// ── Summary Stats ────────────────────────────────────────────────────────────

#[command]
pub async fn ssh_scripts_get_summary(
    state: State<'_, SshScriptEngineState>,
) -> Res<SshScriptsSummary> {
    let eng = state.lock().await;
    let scripts = eng.store.list_scripts();
    let enabled = scripts.iter().filter(|s| s.enabled).count() as u32;
    let disabled = scripts.iter().filter(|s| !s.enabled).count() as u32;
    let categories = eng.store.get_all_categories();
    let tags = eng.store.get_all_tags();
    let chains = eng.store.list_chains();

    let mut trigger_counts: HashMap<String, u32> = HashMap::new();
    for s in &scripts {
        let key = super::store::trigger_type_name(&s.trigger).to_string();
        *trigger_counts.entry(key).or_insert(0) += 1;
    }

    Ok(SshScriptsSummary {
        total_scripts: scripts.len() as u32,
        enabled_scripts: enabled,
        disabled_scripts: disabled,
        total_chains: chains.len() as u32,
        categories: categories.len() as u32,
        tags: tags.len() as u32,
        trigger_counts,
        active_sessions: eng.active_session_count() as u32,
    })
}

/// Summary return type for the dashboard.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshScriptsSummary {
    pub total_scripts: u32,
    pub enabled_scripts: u32,
    pub disabled_scripts: u32,
    pub total_chains: u32,
    pub categories: u32,
    pub tags: u32,
    pub trigger_counts: HashMap<String, u32>,
    pub active_sessions: u32,
}
