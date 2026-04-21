// ── sorng-clamav/src/service.rs ───────────────────────────────────────────────
//! Aggregate ClamAV façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::ClamavClient;
use crate::error::{ClamavError, ClamavResult};
use crate::types::*;

use crate::clamd_config::ClamdConfigManager;
use crate::database::DatabaseManager;
use crate::freshclam_config::FreshclamConfigManager;
use crate::milter::MilterManager;
use crate::on_access::OnAccessManager;
use crate::process::ClamavProcessManager;
use crate::quarantine::QuarantineManager;
use crate::scanning::ScanManager;
use crate::scheduled::ScheduledScanManager;

/// Shared Tauri state handle.
pub type ClamavServiceState = Arc<Mutex<ClamavService>>;

/// Main ClamAV service managing connections.
pub struct ClamavService {
    connections: HashMap<String, ClamavClient>,
}

impl Default for ClamavService {
    fn default() -> Self {
        Self::new()
    }
}

impl ClamavService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: ClamavConnectionConfig,
    ) -> ClamavResult<ClamavConnectionSummary> {
        if self.connections.contains_key(&id) {
            return Err(ClamavError::already_connected(&id));
        }
        let client = ClamavClient::new(config)?;
        let ver = client.version().await.ok();
        let clamd_ver = client.clamd_version().await.ok();
        let summary = ClamavConnectionSummary {
            host: client.config.host.clone(),
            version: ver,
            database_version: clamd_ver,
            signature_count: None,
            last_update: None,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> ClamavResult<()> {
        self.connections.remove(id).map(|_| ()).ok_or_else(|| {
            ClamavError::new(
                crate::error::ClamavErrorKind::NotConnected,
                format!("No connection '{}'", id),
            )
        })
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> ClamavResult<&ClamavClient> {
        self.connections.get(id).ok_or_else(|| {
            ClamavError::new(
                crate::error::ClamavErrorKind::NotConnected,
                format!("No connection '{}'", id),
            )
        })
    }

    pub async fn ping(&self, id: &str) -> ClamavResult<bool> {
        let client = self.client(id)?;
        let out = client
            .exec_ssh(&format!(
                "echo PING | socat - UNIX-CONNECT:{} 2>&1",
                crate::client::shell_escape(client.clamd_socket())
            ))
            .await?;
        Ok(out.stdout.trim() == "PONG")
    }

    // ── Scanning ─────────────────────────────────────────────────

    pub async fn scan(&self, id: &str, req: ScanRequest) -> ClamavResult<ScanSummary> {
        ScanManager::scan(self.client(id)?, &req).await
    }

    pub async fn quick_scan(&self, id: &str, path: &str) -> ClamavResult<ScanResult> {
        ScanManager::quick_scan(self.client(id)?, path).await
    }

    pub async fn scan_stream(&self, id: &str, data: &str) -> ClamavResult<ScanResult> {
        ScanManager::scan_stream(self.client(id)?, data).await
    }

    pub async fn multiscan(&self, id: &str, path: &str) -> ClamavResult<ScanSummary> {
        ScanManager::multiscan(self.client(id)?, path).await
    }

    pub async fn contscan(&self, id: &str, path: &str) -> ClamavResult<ScanSummary> {
        ScanManager::contscan(self.client(id)?, path).await
    }

    pub async fn allmatchscan(&self, id: &str, path: &str) -> ClamavResult<ScanSummary> {
        ScanManager::allmatchscan(self.client(id)?, path).await
    }

    // ── Database ─────────────────────────────────────────────────

    pub async fn list_databases(&self, id: &str) -> ClamavResult<Vec<DatabaseInfo>> {
        DatabaseManager::list(self.client(id)?).await
    }

    pub async fn update_databases(&self, id: &str) -> ClamavResult<Vec<DatabaseUpdateResult>> {
        DatabaseManager::update(self.client(id)?).await
    }

    pub async fn update_database(
        &self,
        id: &str,
        name: &str,
    ) -> ClamavResult<DatabaseUpdateResult> {
        DatabaseManager::update_database(self.client(id)?, name).await
    }

    pub async fn check_update(&self, id: &str) -> ClamavResult<bool> {
        DatabaseManager::check_update(self.client(id)?).await
    }

    pub async fn get_mirrors(&self, id: &str) -> ClamavResult<Vec<String>> {
        DatabaseManager::get_mirrors(self.client(id)?).await
    }

    pub async fn add_mirror(&self, id: &str, url: &str) -> ClamavResult<()> {
        DatabaseManager::add_mirror(self.client(id)?, url).await
    }

    pub async fn remove_mirror(&self, id: &str, url: &str) -> ClamavResult<()> {
        DatabaseManager::remove_mirror(self.client(id)?, url).await
    }

    pub async fn get_db_version(&self, id: &str) -> ClamavResult<String> {
        DatabaseManager::get_version(self.client(id)?).await
    }

    // ── Quarantine ───────────────────────────────────────────────

    pub async fn list_quarantine(&self, id: &str) -> ClamavResult<Vec<QuarantineEntry>> {
        QuarantineManager::list(self.client(id)?).await
    }

    pub async fn get_quarantine_entry(
        &self,
        id: &str,
        entry_id: &str,
    ) -> ClamavResult<QuarantineEntry> {
        QuarantineManager::get(self.client(id)?, entry_id).await
    }

    pub async fn restore_quarantine(&self, id: &str, entry_id: &str) -> ClamavResult<()> {
        QuarantineManager::restore(self.client(id)?, entry_id).await
    }

    pub async fn delete_quarantine(&self, id: &str, entry_id: &str) -> ClamavResult<()> {
        QuarantineManager::delete(self.client(id)?, entry_id).await
    }

    pub async fn delete_all_quarantine(&self, id: &str) -> ClamavResult<()> {
        QuarantineManager::delete_all(self.client(id)?).await
    }

    pub async fn get_quarantine_stats(&self, id: &str) -> ClamavResult<QuarantineStats> {
        QuarantineManager::get_stats(self.client(id)?).await
    }

    // ── Clamd config ─────────────────────────────────────────────

    pub async fn get_clamd_config(&self, id: &str) -> ClamavResult<Vec<ClamdConfig>> {
        ClamdConfigManager::get_all(self.client(id)?).await
    }

    pub async fn get_clamd_param(&self, id: &str, key: &str) -> ClamavResult<ClamdConfig> {
        ClamdConfigManager::get_param(self.client(id)?, key).await
    }

    pub async fn set_clamd_param(&self, id: &str, key: &str, value: &str) -> ClamavResult<()> {
        ClamdConfigManager::set_param(self.client(id)?, key, value).await
    }

    pub async fn delete_clamd_param(&self, id: &str, key: &str) -> ClamavResult<()> {
        ClamdConfigManager::delete_param(self.client(id)?, key).await
    }

    pub async fn get_socket(&self, id: &str) -> ClamavResult<String> {
        ClamdConfigManager::get_socket(self.client(id)?).await
    }

    pub async fn set_socket(&self, id: &str, socket: &str) -> ClamavResult<()> {
        ClamdConfigManager::set_socket(self.client(id)?, socket).await
    }

    pub async fn test_clamd_config(&self, id: &str) -> ClamavResult<ConfigTestResult> {
        ClamdConfigManager::test_config(self.client(id)?).await
    }

    // ── Freshclam config ─────────────────────────────────────────

    pub async fn get_freshclam_config(&self, id: &str) -> ClamavResult<Vec<FreshclamConfig>> {
        FreshclamConfigManager::get_all(self.client(id)?).await
    }

    pub async fn get_freshclam_param(&self, id: &str, key: &str) -> ClamavResult<FreshclamConfig> {
        FreshclamConfigManager::get_param(self.client(id)?, key).await
    }

    pub async fn set_freshclam_param(&self, id: &str, key: &str, value: &str) -> ClamavResult<()> {
        FreshclamConfigManager::set_param(self.client(id)?, key, value).await
    }

    pub async fn delete_freshclam_param(&self, id: &str, key: &str) -> ClamavResult<()> {
        FreshclamConfigManager::delete_param(self.client(id)?, key).await
    }

    pub async fn get_update_interval(&self, id: &str) -> ClamavResult<u64> {
        FreshclamConfigManager::get_update_interval(self.client(id)?).await
    }

    pub async fn set_update_interval(&self, id: &str, hours: u64) -> ClamavResult<()> {
        FreshclamConfigManager::set_update_interval(self.client(id)?, hours).await
    }

    // ── On-access ────────────────────────────────────────────────

    pub async fn get_on_access_config(&self, id: &str) -> ClamavResult<OnAccessConfig> {
        OnAccessManager::get_config(self.client(id)?).await
    }

    pub async fn set_on_access_config(&self, id: &str, config: OnAccessConfig) -> ClamavResult<()> {
        OnAccessManager::set_config(self.client(id)?, &config).await
    }

    pub async fn enable_on_access(&self, id: &str) -> ClamavResult<()> {
        OnAccessManager::enable(self.client(id)?).await
    }

    pub async fn disable_on_access(&self, id: &str) -> ClamavResult<()> {
        OnAccessManager::disable(self.client(id)?).await
    }

    pub async fn add_on_access_path(&self, id: &str, path: &str) -> ClamavResult<()> {
        OnAccessManager::add_path(self.client(id)?, path).await
    }

    pub async fn remove_on_access_path(&self, id: &str, path: &str) -> ClamavResult<()> {
        OnAccessManager::remove_path(self.client(id)?, path).await
    }

    // ── Milter ───────────────────────────────────────────────────

    pub async fn get_milter_config(&self, id: &str) -> ClamavResult<MilterConfig> {
        MilterManager::get_config(self.client(id)?).await
    }

    pub async fn set_milter_config(&self, id: &str, config: MilterConfig) -> ClamavResult<()> {
        MilterManager::set_config(self.client(id)?, &config).await
    }

    pub async fn enable_milter(&self, id: &str) -> ClamavResult<()> {
        MilterManager::enable(self.client(id)?).await
    }

    pub async fn disable_milter(&self, id: &str) -> ClamavResult<()> {
        MilterManager::disable(self.client(id)?).await
    }

    // ── Scheduled scans ──────────────────────────────────────────

    pub async fn list_scheduled_scans(&self, id: &str) -> ClamavResult<Vec<ScheduledScan>> {
        ScheduledScanManager::list(self.client(id)?).await
    }

    pub async fn get_scheduled_scan(&self, id: &str, scan_id: &str) -> ClamavResult<ScheduledScan> {
        ScheduledScanManager::get(self.client(id)?, scan_id).await
    }

    pub async fn create_scheduled_scan(
        &self,
        id: &str,
        scan: ScheduledScan,
    ) -> ClamavResult<ScheduledScan> {
        ScheduledScanManager::create(self.client(id)?, &scan).await
    }

    pub async fn update_scheduled_scan(
        &self,
        id: &str,
        scan_id: &str,
        scan: ScheduledScan,
    ) -> ClamavResult<ScheduledScan> {
        ScheduledScanManager::update(self.client(id)?, scan_id, &scan).await
    }

    pub async fn delete_scheduled_scan(&self, id: &str, scan_id: &str) -> ClamavResult<()> {
        ScheduledScanManager::delete(self.client(id)?, scan_id).await
    }

    pub async fn enable_scheduled_scan(&self, id: &str, scan_id: &str) -> ClamavResult<()> {
        ScheduledScanManager::enable(self.client(id)?, scan_id).await
    }

    pub async fn disable_scheduled_scan(&self, id: &str, scan_id: &str) -> ClamavResult<()> {
        ScheduledScanManager::disable(self.client(id)?, scan_id).await
    }

    pub async fn run_scheduled_scan(&self, id: &str, scan_id: &str) -> ClamavResult<ScanSummary> {
        ScheduledScanManager::run_now(self.client(id)?, scan_id).await
    }

    // ── Process management ───────────────────────────────────────

    pub async fn start_clamd(&self, id: &str) -> ClamavResult<()> {
        ClamavProcessManager::start_clamd(self.client(id)?).await
    }

    pub async fn stop_clamd(&self, id: &str) -> ClamavResult<()> {
        ClamavProcessManager::stop_clamd(self.client(id)?).await
    }

    pub async fn restart_clamd(&self, id: &str) -> ClamavResult<()> {
        ClamavProcessManager::restart_clamd(self.client(id)?).await
    }

    pub async fn reload_clamd(&self, id: &str) -> ClamavResult<()> {
        ClamavProcessManager::reload_clamd(self.client(id)?).await
    }

    pub async fn clamd_status(&self, id: &str) -> ClamavResult<ClamdStats> {
        ClamavProcessManager::clamd_status(self.client(id)?).await
    }

    pub async fn start_freshclam(&self, id: &str) -> ClamavResult<()> {
        ClamavProcessManager::start_freshclam(self.client(id)?).await
    }

    pub async fn stop_freshclam(&self, id: &str) -> ClamavResult<()> {
        ClamavProcessManager::stop_freshclam(self.client(id)?).await
    }

    pub async fn restart_freshclam(&self, id: &str) -> ClamavResult<()> {
        ClamavProcessManager::restart_freshclam(self.client(id)?).await
    }

    pub async fn version(&self, id: &str) -> ClamavResult<String> {
        ClamavProcessManager::version(self.client(id)?).await
    }

    pub async fn info(&self, id: &str) -> ClamavResult<ClamavInfo> {
        ClamavProcessManager::info(self.client(id)?).await
    }
}
