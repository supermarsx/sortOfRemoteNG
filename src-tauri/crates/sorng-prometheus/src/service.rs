// ── sorng-prometheus/src/service.rs ──────────────────────────────────────────
//! Aggregate Prometheus service – holds connections and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

use crate::alerts::AlertManager;
use crate::config::ConfigManager;
use crate::federation::FederationManager;
use crate::metadata::MetadataManager;
use crate::queries::QueryManager;
use crate::recording::RecordingManager;
use crate::rules::RuleManager;
use crate::silences::SilenceManager;
use crate::targets::TargetManager;
use crate::tsdb::TsdbManager;

/// Shared Tauri state handle.
pub type PrometheusServiceState = Arc<Mutex<PrometheusService>>;

/// Main Prometheus service managing connections.
pub struct PrometheusService {
    connections: HashMap<String, PrometheusClient>,
}

impl PrometheusService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: PrometheusConnectionConfig,
    ) -> PrometheusResult<PrometheusConnectionSummary> {
        let client = PrometheusClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> PrometheusResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| PrometheusError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> PrometheusResult<&PrometheusClient> {
        self.connections
            .get(id)
            .ok_or_else(|| PrometheusError::not_connected(format!("No connection '{id}'")))
    }

    pub async fn ping(&self, id: &str) -> PrometheusResult<PrometheusConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Queries ──────────────────────────────────────────────────

    pub async fn instant_query(
        &self,
        id: &str,
        query: &str,
        time: Option<&str>,
        timeout: Option<&str>,
    ) -> PrometheusResult<QueryResult> {
        QueryManager::instant_query(self.client(id)?, query, time, timeout).await
    }

    pub async fn range_query(
        &self,
        id: &str,
        query: &str,
        start: &str,
        end: &str,
        step: &str,
        timeout: Option<&str>,
    ) -> PrometheusResult<RangeQueryResult> {
        QueryManager::range_query(self.client(id)?, query, start, end, step, timeout).await
    }

    pub async fn series(
        &self,
        id: &str,
        match_selectors: &[&str],
        start: Option<&str>,
        end: Option<&str>,
    ) -> PrometheusResult<Vec<HashMap<String, String>>> {
        QueryManager::series(self.client(id)?, match_selectors, start, end).await
    }

    pub async fn label_names(
        &self,
        id: &str,
        match_selectors: &[&str],
        start: Option<&str>,
        end: Option<&str>,
    ) -> PrometheusResult<Vec<String>> {
        QueryManager::label_names(self.client(id)?, match_selectors, start, end).await
    }

    pub async fn label_values(
        &self,
        id: &str,
        label_name: &str,
        match_selectors: &[&str],
        start: Option<&str>,
        end: Option<&str>,
    ) -> PrometheusResult<Vec<String>> {
        QueryManager::label_values(self.client(id)?, label_name, match_selectors, start, end).await
    }

    pub async fn exemplars(
        &self,
        id: &str,
        query: &str,
        start: &str,
        end: &str,
    ) -> PrometheusResult<serde_json::Value> {
        QueryManager::exemplars(self.client(id)?, query, start, end).await
    }

    // ── Targets ──────────────────────────────────────────────────

    pub async fn list_targets(
        &self,
        id: &str,
        state_filter: Option<&str>,
    ) -> PrometheusResult<Vec<PromTarget>> {
        TargetManager::list(self.client(id)?, state_filter).await
    }

    pub async fn list_active_targets(&self, id: &str) -> PrometheusResult<Vec<PromTarget>> {
        TargetManager::list_active(self.client(id)?).await
    }

    pub async fn list_dropped_targets(&self, id: &str) -> PrometheusResult<Vec<PromTarget>> {
        TargetManager::list_dropped(self.client(id)?).await
    }

    pub async fn get_target_metadata(
        &self,
        id: &str,
        metric: Option<&str>,
        match_target: Option<&str>,
        limit: Option<u32>,
    ) -> PrometheusResult<Vec<TargetMetadata>> {
        TargetManager::get_metadata(self.client(id)?, metric, match_target, limit).await
    }

    // ── Rules ────────────────────────────────────────────────────

    pub async fn list_rules(
        &self,
        id: &str,
        rule_type: Option<&str>,
    ) -> PrometheusResult<Vec<RuleGroup>> {
        RuleManager::list(self.client(id)?, rule_type).await
    }

    pub async fn list_alerting_rules(&self, id: &str) -> PrometheusResult<Vec<RuleGroup>> {
        RuleManager::list_alerting(self.client(id)?).await
    }

    pub async fn list_recording_rules(&self, id: &str) -> PrometheusResult<Vec<RuleGroup>> {
        RuleManager::list_recording(self.client(id)?).await
    }

    pub async fn get_rule_group(&self, id: &str, name: &str) -> PrometheusResult<RuleGroup> {
        RuleManager::get_group(self.client(id)?, name).await
    }

    // ── Alerts ───────────────────────────────────────────────────

    pub async fn list_alerts(&self, id: &str) -> PrometheusResult<Vec<Alert>> {
        AlertManager::list(self.client(id)?).await
    }

    pub async fn get_alertmanagers(&self, id: &str) -> PrometheusResult<AlertManagerInfo> {
        AlertManager::get_alertmanagers(self.client(id)?).await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_config(&self, id: &str) -> PrometheusResult<PrometheusConfig> {
        ConfigManager::get(self.client(id)?).await
    }

    pub async fn reload_config(&self, id: &str) -> PrometheusResult<ConfigReloadResult> {
        ConfigManager::reload(self.client(id)?).await
    }

    pub async fn get_flags(&self, id: &str) -> PrometheusResult<HashMap<String, String>> {
        ConfigManager::get_flags(self.client(id)?).await
    }

    // ── TSDB ─────────────────────────────────────────────────────

    pub async fn get_tsdb_status(&self, id: &str) -> PrometheusResult<TsdbStatus> {
        TsdbManager::get_status(self.client(id)?).await
    }

    pub async fn tsdb_snapshot(
        &self,
        id: &str,
        skip_head: bool,
    ) -> PrometheusResult<String> {
        TsdbManager::snapshot(self.client(id)?, skip_head).await
    }

    pub async fn tsdb_delete_series(
        &self,
        id: &str,
        match_selectors: &[&str],
        start: Option<&str>,
        end: Option<&str>,
    ) -> PrometheusResult<()> {
        TsdbManager::delete_series(self.client(id)?, match_selectors, start, end).await
    }

    pub async fn tsdb_clean_tombstones(&self, id: &str) -> PrometheusResult<()> {
        TsdbManager::clean_tombstones(self.client(id)?).await
    }

    // ── Metadata ─────────────────────────────────────────────────

    pub async fn list_metadata(
        &self,
        id: &str,
        metric: Option<&str>,
        limit: Option<u32>,
    ) -> PrometheusResult<HashMap<String, Vec<MetricMetadata>>> {
        MetadataManager::list(self.client(id)?, metric, limit).await
    }

    pub async fn get_metadata(
        &self,
        id: &str,
        metric: &str,
    ) -> PrometheusResult<Vec<MetricMetadata>> {
        MetadataManager::get(self.client(id)?, metric).await
    }

    // ── Federation ───────────────────────────────────────────────

    pub async fn federate(
        &self,
        id: &str,
        match_selectors: &[&str],
    ) -> PrometheusResult<FederationResult> {
        FederationManager::get(self.client(id)?, match_selectors).await
    }

    // ── Recording rules ──────────────────────────────────────────

    pub async fn list_recording_rule_entries(
        &self,
        id: &str,
    ) -> PrometheusResult<Vec<RecordingRule>> {
        RecordingManager::list(self.client(id)?).await
    }

    pub async fn get_recording_group_rules(
        &self,
        id: &str,
        group_name: &str,
    ) -> PrometheusResult<Vec<RecordingRule>> {
        RecordingManager::get_group_rules(self.client(id)?, group_name).await
    }

    // ── Silences ─────────────────────────────────────────────────

    pub async fn list_silences(
        &self,
        id: &str,
        filter: Option<&str>,
    ) -> PrometheusResult<Vec<Silence>> {
        SilenceManager::list(self.client(id)?, filter).await
    }

    pub async fn get_silence(&self, id: &str, silence_id: &str) -> PrometheusResult<Silence> {
        SilenceManager::get(self.client(id)?, silence_id).await
    }

    pub async fn create_silence(
        &self,
        id: &str,
        matchers: Vec<SilenceMatcher>,
        starts_at: &str,
        ends_at: &str,
        created_by: &str,
        comment: &str,
    ) -> PrometheusResult<String> {
        SilenceManager::create(self.client(id)?, matchers, starts_at, ends_at, created_by, comment)
            .await
    }

    pub async fn update_silence(
        &self,
        id: &str,
        silence_id: &str,
        matchers: Vec<SilenceMatcher>,
        starts_at: &str,
        ends_at: &str,
        created_by: &str,
        comment: &str,
    ) -> PrometheusResult<String> {
        SilenceManager::update(
            self.client(id)?,
            silence_id,
            matchers,
            starts_at,
            ends_at,
            created_by,
            comment,
        )
        .await
    }

    pub async fn expire_silence(&self, id: &str, silence_id: &str) -> PrometheusResult<()> {
        SilenceManager::expire(self.client(id)?, silence_id).await
    }

    pub async fn delete_silence(&self, id: &str, silence_id: &str) -> PrometheusResult<()> {
        SilenceManager::delete(self.client(id)?, silence_id).await
    }
}
