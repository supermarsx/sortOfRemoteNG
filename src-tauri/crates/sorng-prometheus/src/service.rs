// ── sorng-prometheus/src/service.rs ───────────────────────────────────────────
//! Aggregate Prometheus façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

use crate::targets::TargetManager;
use crate::scrape::ScrapeManager;
use crate::alerts::AlertManager;
use crate::recording::RecordingManager;
use crate::query::QueryManager;
use crate::tsdb::TsdbManager;
use crate::federation::FederationManager;
use crate::config::ConfigManager;
use crate::service_mgmt::ServiceMgmtManager;

/// Shared Tauri state handle.
pub type PrometheusServiceState = Arc<Mutex<PrometheusService>>;

/// Main Prometheus service managing connections.
pub struct PrometheusService {
    connections: HashMap<String, PrometheusClient>,
}

impl PrometheusService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: PrometheusConnectionConfig) -> PrometheusResult<PrometheusConnectionSummary> {
        let client = PrometheusClient::new(config)?;
        let version = match ConfigManager::get_build_info(&client).await {
            Ok(info) => Some(info.version),
            Err(_) => None,
        };
        let api_url = client.api_url("");
        let up = ConfigManager::check_health(&client).await.map(|h| h.healthy).unwrap_or(false);
        let summary = PrometheusConnectionSummary {
            host: client.config.host.clone(),
            version,
            api_url,
            up,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> PrometheusResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| PrometheusError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> PrometheusResult<&PrometheusClient> {
        self.connections.get(id)
            .ok_or_else(|| PrometheusError::not_connected(format!("No connection '{id}'")))
    }

    // ── Targets ──────────────────────────────────────────────────

    pub async fn list_targets(&self, id: &str) -> PrometheusResult<Vec<Target>> {
        TargetManager::list_targets(self.client(id)?).await
    }

    pub async fn get_target_metadata(&self, id: &str, match_target: Option<&str>, metric: Option<&str>) -> PrometheusResult<Vec<TargetMetadata>> {
        TargetManager::get_target_metadata(self.client(id)?, match_target, metric).await
    }

    pub async fn get_target_health(&self, id: &str) -> PrometheusResult<Vec<TargetHealth>> {
        TargetManager::get_target_health(self.client(id)?).await
    }

    pub async fn list_service_discovery(&self, id: &str) -> PrometheusResult<Vec<ServiceDiscovery>> {
        TargetManager::list_service_discovery(self.client(id)?).await
    }

    pub async fn add_static_target(&self, id: &str, req: &AddStaticTargetRequest) -> PrometheusResult<()> {
        TargetManager::add_static_target(self.client(id)?, req).await
    }

    pub async fn remove_static_target(&self, id: &str, job: &str, instance: &str) -> PrometheusResult<()> {
        TargetManager::remove_static_target(self.client(id)?, job, instance).await
    }

    pub async fn list_dropped_targets(&self, id: &str) -> PrometheusResult<Vec<DroppedTarget>> {
        TargetManager::list_dropped_targets(self.client(id)?).await
    }

    pub async fn get_target_labels(&self, id: &str, match_target: &str) -> PrometheusResult<Vec<TargetMetadata>> {
        TargetManager::get_target_labels(self.client(id)?, match_target).await
    }

    pub async fn relabel_target(&self, id: &str, req: &RelabelTargetRequest) -> PrometheusResult<()> {
        TargetManager::relabel_target(self.client(id)?, req).await
    }

    // ── Scrape ───────────────────────────────────────────────────

    pub async fn list_scrape_configs(&self, id: &str) -> PrometheusResult<Vec<ScrapeConfig>> {
        ScrapeManager::list_scrape_configs(self.client(id)?).await
    }

    pub async fn get_scrape_config(&self, id: &str, job_name: &str) -> PrometheusResult<ScrapeConfig> {
        ScrapeManager::get_scrape_config(self.client(id)?, job_name).await
    }

    pub async fn add_scrape_config(&self, id: &str, req: &AddScrapeConfigRequest) -> PrometheusResult<()> {
        ScrapeManager::add_scrape_config(self.client(id)?, req).await
    }

    pub async fn update_scrape_config(&self, id: &str, job_name: &str, req: &UpdateScrapeConfigRequest) -> PrometheusResult<()> {
        ScrapeManager::update_scrape_config(self.client(id)?, job_name, req).await
    }

    pub async fn remove_scrape_config(&self, id: &str, job_name: &str) -> PrometheusResult<()> {
        ScrapeManager::remove_scrape_config(self.client(id)?, job_name).await
    }

    pub async fn get_scrape_pools(&self, id: &str) -> PrometheusResult<Vec<ScrapePool>> {
        ScrapeManager::get_scrape_pools(self.client(id)?).await
    }

    pub async fn get_scrape_metrics(&self, id: &str, job_name: &str) -> PrometheusResult<Vec<String>> {
        ScrapeManager::get_scrape_metrics(self.client(id)?, job_name).await
    }

    pub async fn list_scrape_jobs(&self, id: &str) -> PrometheusResult<Vec<ScrapeJob>> {
        ScrapeManager::list_scrape_jobs(self.client(id)?).await
    }

    pub async fn get_job_targets(&self, id: &str, job_name: &str) -> PrometheusResult<Vec<Target>> {
        ScrapeManager::get_job_targets(self.client(id)?, job_name).await
    }

    pub async fn set_scrape_interval(&self, id: &str, req: &SetScrapeIntervalRequest) -> PrometheusResult<()> {
        ScrapeManager::set_scrape_interval(self.client(id)?, req).await
    }

    pub async fn get_scrape_stats(&self, id: &str, job_name: &str) -> PrometheusResult<ScrapeStats> {
        ScrapeManager::get_scrape_stats(self.client(id)?, job_name).await
    }

    // ── Alerts ───────────────────────────────────────────────────

    pub async fn list_alert_rules(&self, id: &str) -> PrometheusResult<Vec<AlertRule>> {
        AlertManager::list_alert_rules(self.client(id)?).await
    }

    pub async fn get_alert_rule(&self, id: &str, group: &str, name: &str) -> PrometheusResult<AlertRule> {
        AlertManager::get_alert_rule(self.client(id)?, group, name).await
    }

    pub async fn create_alert_rule(&self, id: &str, req: &CreateAlertRuleRequest) -> PrometheusResult<AlertRule> {
        AlertManager::create_alert_rule(self.client(id)?, req).await
    }

    pub async fn update_alert_rule(&self, id: &str, req: &UpdateAlertRuleRequest) -> PrometheusResult<AlertRule> {
        AlertManager::update_alert_rule(self.client(id)?, req).await
    }

    pub async fn delete_alert_rule(&self, id: &str, group: &str, name: &str) -> PrometheusResult<()> {
        AlertManager::delete_alert_rule(self.client(id)?, group, name).await
    }

    pub async fn list_active_alerts(&self, id: &str) -> PrometheusResult<Vec<ActiveAlert>> {
        AlertManager::list_active_alerts(self.client(id)?).await
    }

    pub async fn get_alert_status(&self, id: &str, alert_name: &str) -> PrometheusResult<Vec<ActiveAlert>> {
        AlertManager::get_alert_status(self.client(id)?, alert_name).await
    }

    pub async fn list_alert_groups(&self, id: &str) -> PrometheusResult<Vec<AlertGroup>> {
        AlertManager::list_alert_groups(self.client(id)?).await
    }

    pub async fn silences_list(&self, id: &str) -> PrometheusResult<Vec<Silence>> {
        AlertManager::silences_list(self.client(id)?).await
    }

    pub async fn create_silence(&self, id: &str, req: &CreateSilenceRequest) -> PrometheusResult<Silence> {
        AlertManager::create_silence(self.client(id)?, req).await
    }

    pub async fn delete_silence(&self, id: &str, silence_id: &str) -> PrometheusResult<()> {
        AlertManager::delete_silence(self.client(id)?, silence_id).await
    }

    pub async fn get_alertmanager_status(&self, id: &str) -> PrometheusResult<AlertmanagerStatus> {
        AlertManager::get_alertmanager_status(self.client(id)?).await
    }

    pub async fn get_alertmanager_config(&self, id: &str) -> PrometheusResult<String> {
        AlertManager::get_alertmanager_config(self.client(id)?).await
    }

    pub async fn update_alertmanager_config(&self, id: &str, req: &UpdateAlertmanagerConfigRequest) -> PrometheusResult<()> {
        AlertManager::update_alertmanager_config(self.client(id)?, req).await
    }

    pub async fn list_alert_receivers(&self, id: &str) -> PrometheusResult<Vec<AlertReceiver>> {
        AlertManager::list_alert_receivers(self.client(id)?).await
    }

    pub async fn test_alert_receiver(&self, id: &str, req: &TestAlertReceiverRequest) -> PrometheusResult<bool> {
        AlertManager::test_alert_receiver(self.client(id)?, req).await
    }

    pub async fn list_alert_inhibitions(&self, id: &str) -> PrometheusResult<Vec<AlertInhibition>> {
        AlertManager::list_alert_inhibitions(self.client(id)?).await
    }

    // ── Recording Rules ──────────────────────────────────────────

    pub async fn list_recording_rules(&self, id: &str) -> PrometheusResult<Vec<RecordingRule>> {
        RecordingManager::list_recording_rules(self.client(id)?).await
    }

    pub async fn get_recording_rule(&self, id: &str, group: &str, name: &str) -> PrometheusResult<RecordingRule> {
        RecordingManager::get_recording_rule(self.client(id)?, group, name).await
    }

    pub async fn create_recording_rule(&self, id: &str, req: &CreateRecordingRuleRequest) -> PrometheusResult<RecordingRule> {
        RecordingManager::create_recording_rule(self.client(id)?, req).await
    }

    pub async fn update_recording_rule(&self, id: &str, req: &UpdateRecordingRuleRequest) -> PrometheusResult<RecordingRule> {
        RecordingManager::update_recording_rule(self.client(id)?, req).await
    }

    pub async fn delete_recording_rule(&self, id: &str, group: &str, name: &str) -> PrometheusResult<()> {
        RecordingManager::delete_recording_rule(self.client(id)?, group, name).await
    }

    pub async fn list_rule_groups(&self, id: &str) -> PrometheusResult<Vec<RuleGroup>> {
        RecordingManager::list_rule_groups(self.client(id)?).await
    }

    pub async fn get_rule_group(&self, id: &str, name: &str) -> PrometheusResult<RuleGroup> {
        RecordingManager::get_rule_group(self.client(id)?, name).await
    }

    pub async fn create_rule_group(&self, id: &str, req: &CreateRuleGroupRequest) -> PrometheusResult<RuleGroup> {
        RecordingManager::create_rule_group(self.client(id)?, req).await
    }

    pub async fn delete_rule_group(&self, id: &str, name: &str) -> PrometheusResult<()> {
        RecordingManager::delete_rule_group(self.client(id)?, name).await
    }

    pub async fn get_rule_evaluation_stats(&self, id: &str) -> PrometheusResult<Vec<RuleEvalStats>> {
        RecordingManager::get_rule_evaluation_stats(self.client(id)?).await
    }

    pub async fn check_rules_syntax(&self, id: &str, rules_yaml: &str) -> PrometheusResult<bool> {
        RecordingManager::check_rules_syntax(self.client(id)?, rules_yaml).await
    }

    // ── Query ────────────────────────────────────────────────────

    pub async fn instant_query(&self, id: &str, query: &str, time: Option<&str>) -> PrometheusResult<QueryResult> {
        QueryManager::instant_query(self.client(id)?, query, time).await
    }

    pub async fn range_query(&self, id: &str, req: &RangeQueryRequest) -> PrometheusResult<RangeQueryResult> {
        QueryManager::range_query(self.client(id)?, req).await
    }

    pub async fn query_exemplars(&self, id: &str, req: &ExemplarQueryRequest) -> PrometheusResult<Vec<Exemplar>> {
        QueryManager::query_exemplars(self.client(id)?, req).await
    }

    pub async fn get_metric_metadata(&self, id: &str, metric: Option<&str>) -> PrometheusResult<Vec<MetricMetadata>> {
        QueryManager::get_metric_metadata(self.client(id)?, metric).await
    }

    pub async fn list_metric_names(&self, id: &str) -> PrometheusResult<Vec<String>> {
        QueryManager::list_metric_names(self.client(id)?).await
    }

    pub async fn list_label_names(&self, id: &str) -> PrometheusResult<Vec<String>> {
        QueryManager::list_label_names(self.client(id)?).await
    }

    pub async fn list_label_values(&self, id: &str, label_name: &str) -> PrometheusResult<Vec<String>> {
        QueryManager::list_label_values(self.client(id)?, label_name).await
    }

    pub async fn get_series(&self, id: &str, req: &SeriesQueryRequest) -> PrometheusResult<Vec<Series>> {
        QueryManager::get_series(self.client(id)?, req).await
    }

    pub async fn delete_series(&self, id: &str, req: &DeleteSeriesRequest) -> PrometheusResult<()> {
        QueryManager::delete_series(self.client(id)?, req).await
    }

    pub async fn get_query_stats(&self, id: &str, query: &str) -> PrometheusResult<serde_json::Value> {
        QueryManager::get_query_stats(self.client(id)?, query).await
    }

    pub async fn explain_query(&self, id: &str, query: &str) -> PrometheusResult<serde_json::Value> {
        QueryManager::explain_query(self.client(id)?, query).await
    }

    // ── TSDB ─────────────────────────────────────────────────────

    pub async fn get_tsdb_status(&self, id: &str) -> PrometheusResult<TsdbStatus> {
        TsdbManager::get_tsdb_status(self.client(id)?).await
    }

    pub async fn get_tsdb_stats(&self, id: &str) -> PrometheusResult<TsdbStats> {
        TsdbManager::get_tsdb_stats(self.client(id)?).await
    }

    pub async fn get_head_stats(&self, id: &str) -> PrometheusResult<HeadStats> {
        TsdbManager::get_head_stats(self.client(id)?).await
    }

    pub async fn get_block_info(&self, id: &str, ulid: &str) -> PrometheusResult<BlockInfo> {
        TsdbManager::get_block_info(self.client(id)?, ulid).await
    }

    pub async fn list_blocks(&self, id: &str) -> PrometheusResult<Vec<BlockInfo>> {
        TsdbManager::list_blocks(self.client(id)?).await
    }

    pub async fn compact_blocks(&self, id: &str) -> PrometheusResult<()> {
        TsdbManager::compact_blocks(self.client(id)?).await
    }

    pub async fn create_snapshot(&self, id: &str, skip_head: bool) -> PrometheusResult<Snapshot> {
        TsdbManager::create_snapshot(self.client(id)?, skip_head).await
    }

    pub async fn delete_snapshot(&self, id: &str, name: &str) -> PrometheusResult<()> {
        TsdbManager::delete_snapshot(self.client(id)?, name).await
    }

    pub async fn list_snapshots(&self, id: &str) -> PrometheusResult<Vec<Snapshot>> {
        TsdbManager::list_snapshots(self.client(id)?).await
    }

    pub async fn get_wal_status(&self, id: &str) -> PrometheusResult<WalStatus> {
        TsdbManager::get_wal_status(self.client(id)?).await
    }

    pub async fn clean_tombstones(&self, id: &str) -> PrometheusResult<()> {
        TsdbManager::clean_tombstones(self.client(id)?).await
    }

    pub async fn get_storage_stats(&self, id: &str) -> PrometheusResult<StorageStats> {
        TsdbManager::get_storage_stats(self.client(id)?).await
    }

    pub async fn get_retention_config(&self, id: &str) -> PrometheusResult<RetentionConfig> {
        TsdbManager::get_retention_config(self.client(id)?).await
    }

    pub async fn set_retention_config(&self, id: &str, req: &SetRetentionConfigRequest) -> PrometheusResult<RetentionConfig> {
        TsdbManager::set_retention_config(self.client(id)?, req).await
    }

    // ── Federation ───────────────────────────────────────────────

    pub async fn list_federation_targets(&self, id: &str) -> PrometheusResult<Vec<FederationTarget>> {
        FederationManager::list_federation_targets(self.client(id)?).await
    }

    pub async fn add_federation_target(&self, id: &str, req: &AddFederationTargetRequest) -> PrometheusResult<()> {
        FederationManager::add_federation_target(self.client(id)?, req).await
    }

    pub async fn remove_federation_target(&self, id: &str, name: &str) -> PrometheusResult<()> {
        FederationManager::remove_federation_target(self.client(id)?, name).await
    }

    pub async fn get_federation_metrics(&self, id: &str, matchers: &[String]) -> PrometheusResult<String> {
        FederationManager::get_federation_metrics(self.client(id)?, matchers).await
    }

    pub async fn list_remote_read_configs(&self, id: &str) -> PrometheusResult<Vec<RemoteReadConfig>> {
        FederationManager::list_remote_read_configs(self.client(id)?).await
    }

    pub async fn add_remote_read(&self, id: &str, req: &AddRemoteReadRequest) -> PrometheusResult<()> {
        FederationManager::add_remote_read(self.client(id)?, req).await
    }

    pub async fn remove_remote_read(&self, id: &str, url: &str) -> PrometheusResult<()> {
        FederationManager::remove_remote_read(self.client(id)?, url).await
    }

    pub async fn list_remote_write_configs(&self, id: &str) -> PrometheusResult<Vec<RemoteWriteConfig>> {
        FederationManager::list_remote_write_configs(self.client(id)?).await
    }

    pub async fn add_remote_write(&self, id: &str, req: &AddRemoteWriteRequest) -> PrometheusResult<()> {
        FederationManager::add_remote_write(self.client(id)?, req).await
    }

    pub async fn remove_remote_write(&self, id: &str, url: &str) -> PrometheusResult<()> {
        FederationManager::remove_remote_write(self.client(id)?, url).await
    }

    pub async fn get_remote_write_stats(&self, id: &str) -> PrometheusResult<Vec<RemoteWriteStats>> {
        FederationManager::get_remote_write_stats(self.client(id)?).await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_config(&self, id: &str) -> PrometheusResult<PrometheusConfig> {
        ConfigManager::get_config(self.client(id)?).await
    }

    pub async fn reload_config(&self, id: &str) -> PrometheusResult<()> {
        ConfigManager::reload_config(self.client(id)?).await
    }

    pub async fn validate_config(&self, id: &str, req: &ValidateConfigRequest) -> PrometheusResult<bool> {
        ConfigManager::validate_config(self.client(id)?, req).await
    }

    pub async fn get_flags(&self, id: &str) -> PrometheusResult<PrometheusFlags> {
        ConfigManager::get_flags(self.client(id)?).await
    }

    pub async fn get_runtime_info(&self, id: &str) -> PrometheusResult<RuntimeInfo> {
        ConfigManager::get_runtime_info(self.client(id)?).await
    }

    pub async fn get_build_info(&self, id: &str) -> PrometheusResult<BuildInfo> {
        ConfigManager::get_build_info(self.client(id)?).await
    }

    pub async fn check_health(&self, id: &str) -> PrometheusResult<HealthStatus> {
        ConfigManager::check_health(self.client(id)?).await
    }

    pub async fn get_readiness(&self, id: &str) -> PrometheusResult<bool> {
        ConfigManager::get_readiness(self.client(id)?).await
    }

    pub async fn get_startup_status(&self, id: &str) -> PrometheusResult<bool> {
        ConfigManager::get_startup_status(self.client(id)?).await
    }

    pub async fn get_lifecycle_status(&self, id: &str) -> PrometheusResult<HealthStatus> {
        ConfigManager::get_lifecycle_status(self.client(id)?).await
    }

    // ── Service Management ───────────────────────────────────────

    pub async fn get_service_status(&self, id: &str) -> PrometheusResult<ServiceStatus> {
        ServiceMgmtManager::get_service_status(self.client(id)?).await
    }

    pub async fn start_service(&self, id: &str) -> PrometheusResult<()> {
        ServiceMgmtManager::start_service(self.client(id)?).await
    }

    pub async fn stop_service(&self, id: &str) -> PrometheusResult<()> {
        ServiceMgmtManager::stop_service(self.client(id)?).await
    }

    pub async fn restart_service(&self, id: &str) -> PrometheusResult<()> {
        ServiceMgmtManager::restart_service(self.client(id)?).await
    }

    pub async fn enable_service(&self, id: &str) -> PrometheusResult<()> {
        ServiceMgmtManager::enable_service(self.client(id)?).await
    }

    pub async fn disable_service(&self, id: &str) -> PrometheusResult<()> {
        ServiceMgmtManager::disable_service(self.client(id)?).await
    }

    pub async fn get_service_logs(&self, id: &str, query: &ServiceLogQuery) -> PrometheusResult<Vec<ServiceLog>> {
        ServiceMgmtManager::get_service_logs(self.client(id)?, query).await
    }

    pub async fn get_prometheus_version(&self, id: &str) -> PrometheusResult<String> {
        ServiceMgmtManager::get_prometheus_version(self.client(id)?).await
    }

    pub async fn get_config_file_path(&self, id: &str) -> PrometheusResult<String> {
        ServiceMgmtManager::get_config_file_path(self.client(id)?).await
    }

    pub async fn update_config_file(&self, id: &str, req: &UpdateConfigFileRequest) -> PrometheusResult<()> {
        ServiceMgmtManager::update_config_file(self.client(id)?, req).await
    }

    pub async fn backup_config(&self, id: &str) -> PrometheusResult<BackupResult> {
        ServiceMgmtManager::backup_config(self.client(id)?).await
    }

    pub async fn restore_config(&self, id: &str, backup_path: &str) -> PrometheusResult<()> {
        ServiceMgmtManager::restore_config(self.client(id)?, backup_path).await
    }
}
