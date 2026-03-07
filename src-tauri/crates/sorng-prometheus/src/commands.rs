// ── sorng-prometheus/src/commands.rs ──────────────────────────────────────────
//! Tauri commands – thin wrappers around `PrometheusService`.

use tauri::State;
use crate::service::PrometheusServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_connect(
    state: State<'_, PrometheusServiceState>,
    id: String,
    config: PrometheusConnectionConfig,
) -> CmdResult<PrometheusConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
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

// ── Targets ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_targets(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<Target>> {
    state.lock().await.list_targets(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_target_metadata(
    state: State<'_, PrometheusServiceState>,
    id: String,
    match_target: Option<String>,
    metric: Option<String>,
) -> CmdResult<Vec<TargetMetadata>> {
    state.lock().await.get_target_metadata(&id, match_target.as_deref(), metric.as_deref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_target_health(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<TargetHealth>> {
    state.lock().await.get_target_health(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_service_discovery(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<ServiceDiscovery>> {
    state.lock().await.list_service_discovery(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_add_static_target(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: AddStaticTargetRequest,
) -> CmdResult<()> {
    state.lock().await.add_static_target(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_remove_static_target(
    state: State<'_, PrometheusServiceState>,
    id: String,
    job: String,
    instance: String,
) -> CmdResult<()> {
    state.lock().await.remove_static_target(&id, &job, &instance).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_dropped_targets(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<DroppedTarget>> {
    state.lock().await.list_dropped_targets(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_target_labels(
    state: State<'_, PrometheusServiceState>,
    id: String,
    match_target: String,
) -> CmdResult<Vec<TargetMetadata>> {
    state.lock().await.get_target_labels(&id, &match_target).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_relabel_target(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: RelabelTargetRequest,
) -> CmdResult<()> {
    state.lock().await.relabel_target(&id, &request).await.map_err(map_err)
}

// ── Scrape ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_scrape_configs(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<ScrapeConfig>> {
    state.lock().await.list_scrape_configs(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_scrape_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
    job_name: String,
) -> CmdResult<ScrapeConfig> {
    state.lock().await.get_scrape_config(&id, &job_name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_add_scrape_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: AddScrapeConfigRequest,
) -> CmdResult<()> {
    state.lock().await.add_scrape_config(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_update_scrape_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
    job_name: String,
    request: UpdateScrapeConfigRequest,
) -> CmdResult<()> {
    state.lock().await.update_scrape_config(&id, &job_name, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_remove_scrape_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
    job_name: String,
) -> CmdResult<()> {
    state.lock().await.remove_scrape_config(&id, &job_name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_scrape_pools(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<ScrapePool>> {
    state.lock().await.get_scrape_pools(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_scrape_metrics(
    state: State<'_, PrometheusServiceState>,
    id: String,
    job_name: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.get_scrape_metrics(&id, &job_name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_scrape_jobs(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<ScrapeJob>> {
    state.lock().await.list_scrape_jobs(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_job_targets(
    state: State<'_, PrometheusServiceState>,
    id: String,
    job_name: String,
) -> CmdResult<Vec<Target>> {
    state.lock().await.get_job_targets(&id, &job_name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_set_scrape_interval(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: SetScrapeIntervalRequest,
) -> CmdResult<()> {
    state.lock().await.set_scrape_interval(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_scrape_stats(
    state: State<'_, PrometheusServiceState>,
    id: String,
    job_name: String,
) -> CmdResult<ScrapeStats> {
    state.lock().await.get_scrape_stats(&id, &job_name).await.map_err(map_err)
}

// ── Alerts ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_alert_rules(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<AlertRule>> {
    state.lock().await.list_alert_rules(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_alert_rule(
    state: State<'_, PrometheusServiceState>,
    id: String,
    group: String,
    name: String,
) -> CmdResult<AlertRule> {
    state.lock().await.get_alert_rule(&id, &group, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_create_alert_rule(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: CreateAlertRuleRequest,
) -> CmdResult<AlertRule> {
    state.lock().await.create_alert_rule(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_update_alert_rule(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: UpdateAlertRuleRequest,
) -> CmdResult<AlertRule> {
    state.lock().await.update_alert_rule(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_delete_alert_rule(
    state: State<'_, PrometheusServiceState>,
    id: String,
    group: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_alert_rule(&id, &group, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_active_alerts(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<ActiveAlert>> {
    state.lock().await.list_active_alerts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_alert_status(
    state: State<'_, PrometheusServiceState>,
    id: String,
    alert_name: String,
) -> CmdResult<Vec<ActiveAlert>> {
    state.lock().await.get_alert_status(&id, &alert_name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_alert_groups(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<AlertGroup>> {
    state.lock().await.list_alert_groups(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_silences_list(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<Silence>> {
    state.lock().await.silences_list(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_create_silence(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: CreateSilenceRequest,
) -> CmdResult<Silence> {
    state.lock().await.create_silence(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_delete_silence(
    state: State<'_, PrometheusServiceState>,
    id: String,
    silence_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_silence(&id, &silence_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_alertmanager_status(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<AlertmanagerStatus> {
    state.lock().await.get_alertmanager_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_alertmanager_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.get_alertmanager_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_update_alertmanager_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: UpdateAlertmanagerConfigRequest,
) -> CmdResult<()> {
    state.lock().await.update_alertmanager_config(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_alert_receivers(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<AlertReceiver>> {
    state.lock().await.list_alert_receivers(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_test_alert_receiver(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: TestAlertReceiverRequest,
) -> CmdResult<bool> {
    state.lock().await.test_alert_receiver(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_alert_inhibitions(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<AlertInhibition>> {
    state.lock().await.list_alert_inhibitions(&id).await.map_err(map_err)
}

// ── Recording Rules ───────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_recording_rules(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<RecordingRule>> {
    state.lock().await.list_recording_rules(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_recording_rule(
    state: State<'_, PrometheusServiceState>,
    id: String,
    group: String,
    name: String,
) -> CmdResult<RecordingRule> {
    state.lock().await.get_recording_rule(&id, &group, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_create_recording_rule(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: CreateRecordingRuleRequest,
) -> CmdResult<RecordingRule> {
    state.lock().await.create_recording_rule(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_update_recording_rule(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: UpdateRecordingRuleRequest,
) -> CmdResult<RecordingRule> {
    state.lock().await.update_recording_rule(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_delete_recording_rule(
    state: State<'_, PrometheusServiceState>,
    id: String,
    group: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_recording_rule(&id, &group, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_rule_groups(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<RuleGroup>> {
    state.lock().await.list_rule_groups(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_rule_group(
    state: State<'_, PrometheusServiceState>,
    id: String,
    name: String,
) -> CmdResult<RuleGroup> {
    state.lock().await.get_rule_group(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_create_rule_group(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: CreateRuleGroupRequest,
) -> CmdResult<RuleGroup> {
    state.lock().await.create_rule_group(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_delete_rule_group(
    state: State<'_, PrometheusServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_rule_group(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_rule_evaluation_stats(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<RuleEvalStats>> {
    state.lock().await.get_rule_evaluation_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_check_rules_syntax(
    state: State<'_, PrometheusServiceState>,
    id: String,
    rules_yaml: String,
) -> CmdResult<bool> {
    state.lock().await.check_rules_syntax(&id, &rules_yaml).await.map_err(map_err)
}

// ── Query ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_instant_query(
    state: State<'_, PrometheusServiceState>,
    id: String,
    query: String,
    time: Option<String>,
) -> CmdResult<QueryResult> {
    state.lock().await.instant_query(&id, &query, time.as_deref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_range_query(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: RangeQueryRequest,
) -> CmdResult<RangeQueryResult> {
    state.lock().await.range_query(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_query_exemplars(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: ExemplarQueryRequest,
) -> CmdResult<Vec<Exemplar>> {
    state.lock().await.query_exemplars(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_metric_metadata(
    state: State<'_, PrometheusServiceState>,
    id: String,
    metric: Option<String>,
) -> CmdResult<Vec<MetricMetadata>> {
    state.lock().await.get_metric_metadata(&id, metric.as_deref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_metric_names(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_metric_names(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_label_names(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_label_names(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_label_values(
    state: State<'_, PrometheusServiceState>,
    id: String,
    label_name: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_label_values(&id, &label_name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_series(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: SeriesQueryRequest,
) -> CmdResult<Vec<Series>> {
    state.lock().await.get_series(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_delete_series(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: DeleteSeriesRequest,
) -> CmdResult<()> {
    state.lock().await.delete_series(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_query_stats(
    state: State<'_, PrometheusServiceState>,
    id: String,
    query: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.get_query_stats(&id, &query).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_explain_query(
    state: State<'_, PrometheusServiceState>,
    id: String,
    query: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.explain_query(&id, &query).await.map_err(map_err)
}

// ── TSDB ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_get_tsdb_status(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<TsdbStatus> {
    state.lock().await.get_tsdb_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_tsdb_stats(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<TsdbStats> {
    state.lock().await.get_tsdb_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_head_stats(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<HeadStats> {
    state.lock().await.get_head_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_block_info(
    state: State<'_, PrometheusServiceState>,
    id: String,
    ulid: String,
) -> CmdResult<BlockInfo> {
    state.lock().await.get_block_info(&id, &ulid).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_blocks(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<BlockInfo>> {
    state.lock().await.list_blocks(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_compact_blocks(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.compact_blocks(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_create_snapshot(
    state: State<'_, PrometheusServiceState>,
    id: String,
    skip_head: Option<bool>,
) -> CmdResult<Snapshot> {
    state.lock().await.create_snapshot(&id, skip_head.unwrap_or(false)).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_delete_snapshot(
    state: State<'_, PrometheusServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_snapshot(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_snapshots(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<Snapshot>> {
    state.lock().await.list_snapshots(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_wal_status(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<WalStatus> {
    state.lock().await.get_wal_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_clean_tombstones(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.clean_tombstones(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_storage_stats(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<StorageStats> {
    state.lock().await.get_storage_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_retention_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<RetentionConfig> {
    state.lock().await.get_retention_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_set_retention_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: SetRetentionConfigRequest,
) -> CmdResult<RetentionConfig> {
    state.lock().await.set_retention_config(&id, &request).await.map_err(map_err)
}

// ── Federation ────────────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_list_federation_targets(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<FederationTarget>> {
    state.lock().await.list_federation_targets(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_add_federation_target(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: AddFederationTargetRequest,
) -> CmdResult<()> {
    state.lock().await.add_federation_target(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_remove_federation_target(
    state: State<'_, PrometheusServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.remove_federation_target(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_federation_metrics(
    state: State<'_, PrometheusServiceState>,
    id: String,
    matchers: Vec<String>,
) -> CmdResult<String> {
    state.lock().await.get_federation_metrics(&id, &matchers).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_remote_read_configs(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<RemoteReadConfig>> {
    state.lock().await.list_remote_read_configs(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_add_remote_read(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: AddRemoteReadRequest,
) -> CmdResult<()> {
    state.lock().await.add_remote_read(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_remove_remote_read(
    state: State<'_, PrometheusServiceState>,
    id: String,
    url: String,
) -> CmdResult<()> {
    state.lock().await.remove_remote_read(&id, &url).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_list_remote_write_configs(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<RemoteWriteConfig>> {
    state.lock().await.list_remote_write_configs(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_add_remote_write(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: AddRemoteWriteRequest,
) -> CmdResult<()> {
    state.lock().await.add_remote_write(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_remove_remote_write(
    state: State<'_, PrometheusServiceState>,
    id: String,
    url: String,
) -> CmdResult<()> {
    state.lock().await.remove_remote_write(&id, &url).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_remote_write_stats(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<Vec<RemoteWriteStats>> {
    state.lock().await.get_remote_write_stats(&id).await.map_err(map_err)
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
) -> CmdResult<()> {
    state.lock().await.reload_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_validate_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: ValidateConfigRequest,
) -> CmdResult<bool> {
    state.lock().await.validate_config(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_flags(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<PrometheusFlags> {
    state.lock().await.get_flags(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_runtime_info(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<RuntimeInfo> {
    state.lock().await.get_runtime_info(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_build_info(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<BuildInfo> {
    state.lock().await.get_build_info(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_check_health(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<HealthStatus> {
    state.lock().await.check_health(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_readiness(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<bool> {
    state.lock().await.get_readiness(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_startup_status(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<bool> {
    state.lock().await.get_startup_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_lifecycle_status(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<HealthStatus> {
    state.lock().await.get_lifecycle_status(&id).await.map_err(map_err)
}

// ── Service Management ────────────────────────────────────────────

#[tauri::command]
pub async fn prometheus_get_service_status(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<ServiceStatus> {
    state.lock().await.get_service_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_start_service(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.start_service(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_stop_service(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.stop_service(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_restart_service(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.restart_service(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_enable_service(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.enable_service(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_disable_service(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disable_service(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_service_logs(
    state: State<'_, PrometheusServiceState>,
    id: String,
    query: ServiceLogQuery,
) -> CmdResult<Vec<ServiceLog>> {
    state.lock().await.get_service_logs(&id, &query).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_prometheus_version(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.get_prometheus_version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_get_config_file_path(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.get_config_file_path(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_update_config_file(
    state: State<'_, PrometheusServiceState>,
    id: String,
    request: UpdateConfigFileRequest,
) -> CmdResult<()> {
    state.lock().await.update_config_file(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_backup_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
) -> CmdResult<BackupResult> {
    state.lock().await.backup_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn prometheus_restore_config(
    state: State<'_, PrometheusServiceState>,
    id: String,
    backup_path: String,
) -> CmdResult<()> {
    state.lock().await.restore_config(&id, &backup_path).await.map_err(map_err)
}
