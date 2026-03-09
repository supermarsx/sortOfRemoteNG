// ── sorng-rspamd/src/service.rs ───────────────────────────────────────────────
//! Aggregate Rspamd façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdResult};
use crate::types::*;

use crate::actions::ActionManager;
use crate::config::RspamdConfigManager;
use crate::fuzzy::FuzzyManager;
use crate::history::HistoryManager;
use crate::maps::MapManager;
use crate::scanning::ScanManager;
use crate::stats::StatsManager;
use crate::symbols::SymbolManager;
use crate::workers::WorkerManager;

/// Shared Tauri state handle.
pub type RspamdServiceState = Arc<Mutex<RspamdService>>;

/// Main Rspamd service managing connections.
pub struct RspamdService {
    connections: HashMap<String, RspamdClient>,
}

impl Default for RspamdService {
    fn default() -> Self {
        Self::new()
    }
}

impl RspamdService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: RspamdConnectionConfig,
    ) -> RspamdResult<RspamdConnectionSummary> {
        let client = RspamdClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> RspamdResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| RspamdError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> RspamdResult<&RspamdClient> {
        self.connections
            .get(id)
            .ok_or_else(|| RspamdError::not_connected(format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> RspamdResult<RspamdConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Scanning ─────────────────────────────────────────────────

    pub async fn check_message(&self, id: &str, message: &str) -> RspamdResult<RspamdScanResult> {
        ScanManager::check_message(self.client(id)?, message).await
    }

    pub async fn check_file(&self, id: &str, path: &str) -> RspamdResult<RspamdScanResult> {
        ScanManager::check_file(self.client(id)?, path).await
    }

    pub async fn learn_spam(
        &self,
        id: &str,
        message: &str,
    ) -> RspamdResult<RspamdBayesLearnResult> {
        ScanManager::learn_spam(self.client(id)?, message).await
    }

    pub async fn learn_ham(&self, id: &str, message: &str) -> RspamdResult<RspamdBayesLearnResult> {
        ScanManager::learn_ham(self.client(id)?, message).await
    }

    pub async fn fuzzy_add(
        &self,
        id: &str,
        message: &str,
        flag: u32,
        weight: f64,
    ) -> RspamdResult<()> {
        ScanManager::fuzzy_add(self.client(id)?, message, flag, weight).await
    }

    pub async fn fuzzy_delete(&self, id: &str, message: &str, flag: u32) -> RspamdResult<()> {
        ScanManager::fuzzy_delete(self.client(id)?, message, flag).await
    }

    // ── Statistics ───────────────────────────────────────────────

    pub async fn get_stats(&self, id: &str) -> RspamdResult<RspamdStat> {
        StatsManager::get_stats(self.client(id)?).await
    }

    pub async fn get_graph(
        &self,
        id: &str,
        graph_type: &str,
    ) -> RspamdResult<Vec<RspamdGraphData>> {
        StatsManager::get_graph(self.client(id)?, graph_type).await
    }

    pub async fn get_throughput(&self, id: &str) -> RspamdResult<Vec<RspamdGraphData>> {
        StatsManager::get_throughput(self.client(id)?).await
    }

    pub async fn reset_stats(&self, id: &str) -> RspamdResult<()> {
        StatsManager::reset_stats(self.client(id)?).await
    }

    pub async fn get_errors(&self, id: &str) -> RspamdResult<Vec<String>> {
        StatsManager::get_errors(self.client(id)?).await
    }

    // ── Symbols ──────────────────────────────────────────────────

    pub async fn list_symbols(&self, id: &str) -> RspamdResult<Vec<RspamdSymbol>> {
        SymbolManager::list(self.client(id)?).await
    }

    pub async fn get_symbol(&self, id: &str, name: &str) -> RspamdResult<RspamdSymbol> {
        SymbolManager::get(self.client(id)?, name).await
    }

    pub async fn list_symbol_groups(&self, id: &str) -> RspamdResult<Vec<RspamdSymbolGroup>> {
        SymbolManager::list_groups(self.client(id)?).await
    }

    pub async fn get_symbol_group(&self, id: &str, name: &str) -> RspamdResult<RspamdSymbolGroup> {
        SymbolManager::get_group(self.client(id)?, name).await
    }

    // ── Actions ──────────────────────────────────────────────────

    pub async fn list_actions(&self, id: &str) -> RspamdResult<Vec<RspamdAction>> {
        ActionManager::list(self.client(id)?).await
    }

    pub async fn get_action(&self, id: &str, name: &str) -> RspamdResult<RspamdAction> {
        ActionManager::get(self.client(id)?, name).await
    }

    pub async fn set_action(&self, id: &str, name: &str, threshold: f64) -> RspamdResult<()> {
        ActionManager::set(self.client(id)?, name, threshold).await
    }

    pub async fn enable_action(&self, id: &str, name: &str) -> RspamdResult<()> {
        ActionManager::enable(self.client(id)?, name).await
    }

    pub async fn disable_action(&self, id: &str, name: &str) -> RspamdResult<()> {
        ActionManager::disable(self.client(id)?, name).await
    }

    // ── Maps ─────────────────────────────────────────────────────

    pub async fn list_maps(&self, id: &str) -> RspamdResult<Vec<RspamdMap>> {
        MapManager::list(self.client(id)?).await
    }

    pub async fn get_map(&self, id: &str, map_id: u64) -> RspamdResult<RspamdMap> {
        MapManager::get(self.client(id)?, map_id).await
    }

    pub async fn get_map_entries(
        &self,
        id: &str,
        map_id: u64,
    ) -> RspamdResult<Vec<RspamdMapEntry>> {
        MapManager::get_entries(self.client(id)?, map_id).await
    }

    pub async fn save_map_entries(&self, id: &str, map_id: u64, content: &str) -> RspamdResult<()> {
        MapManager::save_entries(self.client(id)?, map_id, content).await
    }

    pub async fn add_map_entry(
        &self,
        id: &str,
        map_id: u64,
        key: &str,
        value: Option<&str>,
    ) -> RspamdResult<()> {
        MapManager::add_entry(self.client(id)?, map_id, key, value).await
    }

    pub async fn remove_map_entry(&self, id: &str, map_id: u64, key: &str) -> RspamdResult<()> {
        MapManager::remove_entry(self.client(id)?, map_id, key).await
    }

    // ── History ──────────────────────────────────────────────────

    pub async fn get_history(
        &self,
        id: &str,
        limit: Option<u64>,
        offset: Option<u64>,
    ) -> RspamdResult<RspamdHistory> {
        HistoryManager::get(self.client(id)?, limit, offset).await
    }

    pub async fn get_history_entry(
        &self,
        id: &str,
        entry_id: &str,
    ) -> RspamdResult<RspamdHistoryEntry> {
        HistoryManager::get_by_id(self.client(id)?, entry_id).await
    }

    pub async fn reset_history(&self, id: &str) -> RspamdResult<()> {
        HistoryManager::reset(self.client(id)?).await
    }

    // ── Workers ──────────────────────────────────────────────────

    pub async fn list_workers(&self, id: &str) -> RspamdResult<Vec<RspamdWorker>> {
        WorkerManager::list(self.client(id)?).await
    }

    pub async fn get_worker(&self, id: &str, worker_id: &str) -> RspamdResult<RspamdWorker> {
        WorkerManager::get(self.client(id)?, worker_id).await
    }

    pub async fn list_neighbours(&self, id: &str) -> RspamdResult<Vec<RspamdNeighbour>> {
        WorkerManager::list_neighbours(self.client(id)?).await
    }

    // ── Fuzzy ────────────────────────────────────────────────────

    pub async fn fuzzy_status(&self, id: &str) -> RspamdResult<Vec<RspamdFuzzyStatus>> {
        FuzzyManager::status(self.client(id)?).await
    }

    pub async fn fuzzy_check(
        &self,
        id: &str,
        message: &str,
    ) -> RspamdResult<Vec<RspamdSymbolResult>> {
        FuzzyManager::check(self.client(id)?, message).await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_actions_config(&self, id: &str) -> RspamdResult<Vec<RspamdAction>> {
        RspamdConfigManager::get_actions(self.client(id)?).await
    }

    pub async fn get_plugins(&self, id: &str) -> RspamdResult<Vec<RspamdPlugin>> {
        RspamdConfigManager::get_plugins(self.client(id)?).await
    }

    pub async fn enable_plugin(&self, id: &str, name: &str) -> RspamdResult<()> {
        RspamdConfigManager::enable_plugin(self.client(id)?, name).await
    }

    pub async fn disable_plugin(&self, id: &str, name: &str) -> RspamdResult<()> {
        RspamdConfigManager::disable_plugin(self.client(id)?, name).await
    }

    pub async fn reload_config(&self, id: &str) -> RspamdResult<()> {
        RspamdConfigManager::reload(self.client(id)?).await
    }

    pub async fn save_actions_config(
        &self,
        id: &str,
        actions: Vec<RspamdAction>,
    ) -> RspamdResult<()> {
        RspamdConfigManager::save_actions(self.client(id)?, &actions).await
    }
}
