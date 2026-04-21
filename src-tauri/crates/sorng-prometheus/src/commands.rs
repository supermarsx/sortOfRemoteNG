// ── sorng-prometheus/src/commands.rs ─────────────────────────────────────────
// Tauri commands – thin wrappers around `PrometheusService`.

use std::collections::HashMap;
use tauri::State;

use super::service::PrometheusServiceState;
use super::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_connect(
    state: State<'_, PrometheusServiceState>,
    id: String,
    config: PrometheusConnectionConfig,
) -> CmdResult<PrometheusConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_disconnect(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_connections(
    state: State<'_, PrometheusServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn prometheus_ping(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<PrometheusConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Queries ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_instant_query(
    state: State<'_, PrometheusServiceState>,
    id: String,
    query: String,
    time: Option<String>,
    timeout: Option<String>,
) -> CmdResult<QueryResult> {
    state
        .lock()
        .await
        .instant_query(&id, &query, time.as_deref(), timeout.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_range_query(
    state: State<'_, PrometheusServiceState>,
    id: String,
    query: String,
    start: String,
    end: String,
    step: String,
    timeout: Option<String>,
) -> CmdResult<RangeQueryResult> {
    state
        .lock()
        .await
        .range_query(&id, &query, &start, &end, &step, timeout.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_series(
    state: State<'_, PrometheusServiceState>,
    id: String,
    match_selectors: Vec<String>,
    start: Option<String>,
    end: Option<String>,
) -> CmdResult<Vec<HashMap<String, String>>> {
    let refs: Vec<&str> = match_selectors.iter().map(|s| s.as_str()).collect();
    state
        .lock()
        .await
        .series(&id, &refs, start.as_deref(), end.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_label_names(
    state: State<'_, PrometheusServiceState>,
    id: String,
    match_selectors: Vec<String>,
    start: Option<String>,
    end: Option<String>,
) -> CmdResult<Vec<String>> {
    let refs: Vec<&str> = match_selectors.iter().map(|s| s.as_str()).collect();
    state
        .lock()
        .await
        .label_names(&id, &refs, start.as_deref(), end.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_label_values(
    state: State<'_, PrometheusServiceState>,
    id: String,
    label_name: String,
    match_selectors: Vec<String>,
    start: Option<String>,
    end: Option<String>,
) -> CmdResult<Vec<String>> {
    let refs: Vec<&str> = match_selectors.iter().map(|s| s.as_str()).collect();
    state
        .lock()
        .await
        .label_values(&id, &label_name, &refs, start.as_deref(), end.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_exemplars(
    state: State<'_, PrometheusServiceState>,
    id: String,
    query: String,
    start: String,
    end: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .exemplars(&id, &query, &start, &end)
        .await
        .map_err(map_err)
}

// ── Targets ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_targets(
    state: State<'_, PrometheusServiceState>,
    id: String,
    state_filter: Option<String>,
) -> CmdResult<Vec<PromTarget>> {
    state
        .lock()
        .await
        .list_targets(&id, state_filter.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_active_targets(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<PromTarget>> {
    state
        .lock()
        .await
        .list_active_targets(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_dropped_targets(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<PromTarget>> {
    state
        .lock()
        .await
        .list_dropped_targets(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_target_metadata(
    state: State<'_, PrometheusServiceState>,
    id: String,
    metric: Option<String>,
    match_target: Option<String>,
    limit: Option<u32>,
) -> CmdResult<Vec<TargetMetadata>> {
    state
        .lock()
        .await
        .get_target_metadata(&id, metric.as_deref(), match_target.as_deref(), limit)
        .await
        .map_err(map_err)
}

// ── Rules ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_rules(
    state: State<'_, PrometheusServiceState>,
    id: String,
    rule_type: Option<String>,
) -> CmdResult<Vec<RuleGroup>> {
    state
        .lock()
        .await
        .list_rules(&id, rule_type.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_alerting_rules(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<RuleGroup>> {
    state
        .lock()
        .await
        .list_alerting_rules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_recording_rules(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<RuleGroup>> {
    state
        .lock()
        .await
        .list_recording_rules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_rule_group(
    state: State<'_, PrometheusServiceState>,
    id: String,
    name: String,
) -> CmdResult<RuleGroup> {
    state
        .lock()
        .await
        .get_rule_group(&id, &name)
        .await
        .map_err(map_err)
}

// ── Alerts ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_alerts(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<Alert>> {
    state.lock().await.list_alerts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_alertmanagers(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<AlertManagerInfo> {
    state
        .lock()
        .await
        .get_alertmanagers(&id)
        .await
        .map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_get_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<PrometheusConfig> {
    state.lock().await.get_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_reload_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<ConfigReloadResult> {
    state.lock().await.reload_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_flags(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<HashMap<String, String>> {
    state.lock().await.get_flags(&id).await.map_err(map_err)
}

// ── TSDB ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_get_tsdb_status(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<TsdbStatus> {
    state
        .lock()
        .await
        .get_tsdb_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_tsdb_snapshot(
    state: State<'_, PrometheusServiceState>,
    id: String,
    skip_head: bool,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .tsdb_snapshot(&id, skip_head)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_tsdb_delete_series(
    state: State<'_, PrometheusServiceState>,
    id: String,
    match_selectors: Vec<String>,
    start: Option<String>,
    end: Option<String>,
) -> CmdResult<()> {
    let refs: Vec<&str> = match_selectors.iter().map(|s| s.as_str()).collect();
    state
        .lock()
        .await
        .tsdb_delete_series(&id, &refs, start.as_deref(), end.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_tsdb_clean_tombstones(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .tsdb_clean_tombstones(&id)
        .await
        .map_err(map_err)
}

// ── Metadata ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_metadata(
    state: State<'_, PrometheusServiceState>,
    id: String,
    metric: Option<String>,
    limit: Option<u32>,
) -> CmdResult<HashMap<String, Vec<MetricMetadata>>> {
    state
        .lock()
        .await
        .list_metadata(&id, metric.as_deref(), limit)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_metadata(
    state: State<'_, PrometheusServiceState>,
    id: String,
    metric: String,
) -> CmdResult<Vec<MetricMetadata>> {
    state
        .lock()
        .await
        .get_metadata(&id, &metric)
        .await
        .map_err(map_err)
}

// ── Federation ────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_federate(
    state: State<'_, PrometheusServiceState>,
    id: String,
    match_selectors: Vec<String>,
) -> CmdResult<FederationResult> {
    let refs: Vec<&str> = match_selectors.iter().map(|s| s.as_str()).collect();
    state
        .lock()
        .await
        .federate(&id, &refs)
        .await
        .map_err(map_err)
}

// ── Recording rules ───────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_recording_rule_entries(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<RecordingRule>> {
    state
        .lock()
        .await
        .list_recording_rule_entries(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_recording_group_rules(
    state: State<'_, PrometheusServiceState>,
    id: String,
    group_name: String,
) -> CmdResult<Vec<RecordingRule>> {
    state
        .lock()
        .await
        .get_recording_group_rules(&id, &group_name)
        .await
        .map_err(map_err)
}

// ── Silences ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_silences(
    state: State<'_, PrometheusServiceState>,
    id: String,
    filter: Option<String>,
) -> CmdResult<Vec<Silence>> {
    state
        .lock()
        .await
        .list_silences(&id, filter.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_silence(
    state: State<'_, PrometheusServiceState>,
    id: String,
    silence_id: String,
) -> CmdResult<Silence> {
    state
        .lock()
        .await
        .get_silence(&id, &silence_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_create_silence(
    state: State<'_, PrometheusServiceState>,
    id: String,
    matchers: Vec<SilenceMatcher>,
    starts_at: String,
    ends_at: String,
    created_by: String,
    comment: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .create_silence(&id, matchers, &starts_at, &ends_at, &created_by, &comment)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_update_silence(
    state: State<'_, PrometheusServiceState>,
    id: String,
    silence_id: String,
    matchers: Vec<SilenceMatcher>,
    starts_at: String,
    ends_at: String,
    created_by: String,
    comment: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .update_silence(
            &id,
            &silence_id,
            matchers,
            &starts_at,
            &ends_at,
            &created_by,
            &comment,
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_expire_silence(
    state: State<'_, PrometheusServiceState>,
    id: String,
    silence_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .expire_silence(&id, &silence_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_delete_silence(
    state: State<'_, PrometheusServiceState>,
    id: String,
    silence_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_silence(&id, &silence_id)
        .await
        .map_err(map_err)
}
