// ── sorng-opendkim/src/service.rs ─────────────────────────────────────────────
//! Aggregate OpenDKIM façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::OpendkimClient;
use crate::config::OpendkimConfigManager;
use crate::error::{OpendkimError, OpendkimResult};
use crate::key_table::KeyTableManager;
use crate::keys::KeyManager;
use crate::process::OpendkimProcessManager;
use crate::signing_table::SigningTableManager;
use crate::stats::StatsManager;
use crate::trusted_hosts::TrustedHostManager;
use crate::types::*;

/// Shared Tauri state handle.
pub type OpendkimServiceState = Arc<Mutex<OpendkimService>>;

/// Main OpenDKIM service managing connections.
pub struct OpendkimService {
    connections: HashMap<String, OpendkimClient>,
}

impl Default for OpendkimService {
    fn default() -> Self {
        Self::new()
    }
}

impl OpendkimService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: OpendkimConnectionConfig,
    ) -> OpendkimResult<OpendkimConnectionSummary> {
        if self.connections.contains_key(&id) {
            return Err(OpendkimError::already_connected(&id));
        }
        let client = OpendkimClient::new(config)?;
        let ver = client.version().await.ok();
        let mode = crate::config::OpendkimConfigManager::get_mode(&client)
            .await
            .ok();
        let domain = crate::config::OpendkimConfigManager::get_param(&client, "Domain")
            .await
            .ok()
            .map(|p| p.value);
        let summary = OpendkimConnectionSummary {
            host: client.config.host.clone(),
            version: ver,
            mode,
            domain,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> OpendkimResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(OpendkimError::not_connected)
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> OpendkimResult<&OpendkimClient> {
        self.connections
            .get(id)
            .ok_or_else(OpendkimError::not_connected)
    }

    pub async fn ping(&self, id: &str) -> OpendkimResult<bool> {
        let client = self.client(id)?;
        let status = client.status().await?;
        Ok(status == "active")
    }

    // ── Keys ─────────────────────────────────────────────────────

    pub async fn list_keys(&self, id: &str) -> OpendkimResult<Vec<DkimKey>> {
        KeyManager::list(self.client(id)?).await
    }

    pub async fn get_key(&self, id: &str, selector: &str, domain: &str) -> OpendkimResult<DkimKey> {
        KeyManager::get(self.client(id)?, selector, domain).await
    }

    pub async fn generate_key(&self, id: &str, req: CreateKeyRequest) -> OpendkimResult<DkimKey> {
        KeyManager::generate(self.client(id)?, &req).await
    }

    pub async fn rotate_key(&self, id: &str, req: RotateKeyRequest) -> OpendkimResult<DkimKey> {
        KeyManager::rotate(self.client(id)?, &req).await
    }

    pub async fn delete_key(&self, id: &str, selector: &str, domain: &str) -> OpendkimResult<()> {
        KeyManager::delete(self.client(id)?, selector, domain).await
    }

    pub async fn get_dns_record(
        &self,
        id: &str,
        selector: &str,
        domain: &str,
    ) -> OpendkimResult<DnsRecord> {
        KeyManager::get_dns_record(self.client(id)?, selector, domain).await
    }

    pub async fn verify_dns(&self, id: &str, selector: &str, domain: &str) -> OpendkimResult<bool> {
        KeyManager::verify_dns(self.client(id)?, selector, domain).await
    }

    pub async fn export_public_key(
        &self,
        id: &str,
        selector: &str,
        domain: &str,
    ) -> OpendkimResult<String> {
        KeyManager::export_public_key(self.client(id)?, selector, domain).await
    }

    // ── Signing Table ────────────────────────────────────────────

    pub async fn list_signing_table(&self, id: &str) -> OpendkimResult<Vec<SigningTableEntry>> {
        SigningTableManager::list(self.client(id)?).await
    }

    pub async fn get_signing_entry(
        &self,
        id: &str,
        pattern: &str,
    ) -> OpendkimResult<SigningTableEntry> {
        SigningTableManager::get(self.client(id)?, pattern).await
    }

    pub async fn add_signing_entry(
        &self,
        id: &str,
        entry: SigningTableEntry,
    ) -> OpendkimResult<()> {
        SigningTableManager::add(self.client(id)?, &entry).await
    }

    pub async fn update_signing_entry(
        &self,
        id: &str,
        pattern: &str,
        entry: SigningTableEntry,
    ) -> OpendkimResult<()> {
        SigningTableManager::update(self.client(id)?, pattern, &entry).await
    }

    pub async fn remove_signing_entry(&self, id: &str, pattern: &str) -> OpendkimResult<()> {
        SigningTableManager::remove(self.client(id)?, pattern).await
    }

    pub async fn rebuild_signing_table(&self, id: &str) -> OpendkimResult<()> {
        SigningTableManager::rebuild(self.client(id)?).await
    }

    // ── Key Table ────────────────────────────────────────────────

    pub async fn list_key_table(&self, id: &str) -> OpendkimResult<Vec<KeyTableEntry>> {
        KeyTableManager::list(self.client(id)?).await
    }

    pub async fn get_key_entry(&self, id: &str, key_name: &str) -> OpendkimResult<KeyTableEntry> {
        KeyTableManager::get(self.client(id)?, key_name).await
    }

    pub async fn add_key_entry(&self, id: &str, entry: KeyTableEntry) -> OpendkimResult<()> {
        KeyTableManager::add(self.client(id)?, &entry).await
    }

    pub async fn update_key_entry(
        &self,
        id: &str,
        key_name: &str,
        entry: KeyTableEntry,
    ) -> OpendkimResult<()> {
        KeyTableManager::update(self.client(id)?, key_name, &entry).await
    }

    pub async fn remove_key_entry(&self, id: &str, key_name: &str) -> OpendkimResult<()> {
        KeyTableManager::remove(self.client(id)?, key_name).await
    }

    pub async fn rebuild_key_table(&self, id: &str) -> OpendkimResult<()> {
        KeyTableManager::rebuild(self.client(id)?).await
    }

    // ── Trusted Hosts ────────────────────────────────────────────

    pub async fn list_trusted_hosts(&self, id: &str) -> OpendkimResult<Vec<TrustedHost>> {
        TrustedHostManager::list(self.client(id)?).await
    }

    pub async fn add_trusted_host(&self, id: &str, host: TrustedHost) -> OpendkimResult<()> {
        TrustedHostManager::add(self.client(id)?, &host).await
    }

    pub async fn remove_trusted_host(&self, id: &str, host: &str) -> OpendkimResult<()> {
        TrustedHostManager::remove(self.client(id)?, host).await
    }

    pub async fn list_internal_hosts(&self, id: &str) -> OpendkimResult<Vec<InternalHost>> {
        TrustedHostManager::list_internal(self.client(id)?).await
    }

    pub async fn add_internal_host(&self, id: &str, host: InternalHost) -> OpendkimResult<()> {
        TrustedHostManager::add_internal(self.client(id)?, &host).await
    }

    pub async fn remove_internal_host(&self, id: &str, host: &str) -> OpendkimResult<()> {
        TrustedHostManager::remove_internal(self.client(id)?, host).await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_config(&self, id: &str) -> OpendkimResult<Vec<OpendkimConfig>> {
        OpendkimConfigManager::get_all(self.client(id)?).await
    }

    pub async fn get_config_param(&self, id: &str, key: &str) -> OpendkimResult<OpendkimConfig> {
        OpendkimConfigManager::get_param(self.client(id)?, key).await
    }

    pub async fn set_config_param(&self, id: &str, key: &str, value: &str) -> OpendkimResult<()> {
        OpendkimConfigManager::set_param(self.client(id)?, key, value).await
    }

    pub async fn delete_config_param(&self, id: &str, key: &str) -> OpendkimResult<()> {
        OpendkimConfigManager::delete_param(self.client(id)?, key).await
    }

    pub async fn test_config(&self, id: &str) -> OpendkimResult<ConfigTestResult> {
        OpendkimConfigManager::test_config(self.client(id)?).await
    }

    pub async fn get_mode(&self, id: &str) -> OpendkimResult<String> {
        OpendkimConfigManager::get_mode(self.client(id)?).await
    }

    pub async fn set_mode(&self, id: &str, mode: &str) -> OpendkimResult<()> {
        OpendkimConfigManager::set_mode(self.client(id)?, mode).await
    }

    pub async fn get_socket(&self, id: &str) -> OpendkimResult<String> {
        OpendkimConfigManager::get_socket(self.client(id)?).await
    }

    pub async fn set_socket(&self, id: &str, socket: &str) -> OpendkimResult<()> {
        OpendkimConfigManager::set_socket(self.client(id)?, socket).await
    }

    // ── Stats ────────────────────────────────────────────────────

    pub async fn get_stats(&self, id: &str) -> OpendkimResult<OpendkimStats> {
        StatsManager::get_stats(self.client(id)?).await
    }

    pub async fn reset_stats(&self, id: &str) -> OpendkimResult<()> {
        StatsManager::reset_stats(self.client(id)?).await
    }

    pub async fn get_last_messages(&self, id: &str, count: u32) -> OpendkimResult<Vec<String>> {
        StatsManager::get_last_messages(self.client(id)?, count).await
    }

    // ── Process ──────────────────────────────────────────────────

    pub async fn start(&self, id: &str) -> OpendkimResult<()> {
        OpendkimProcessManager::start(self.client(id)?).await
    }

    pub async fn stop(&self, id: &str) -> OpendkimResult<()> {
        OpendkimProcessManager::stop(self.client(id)?).await
    }

    pub async fn restart(&self, id: &str) -> OpendkimResult<()> {
        OpendkimProcessManager::restart(self.client(id)?).await
    }

    pub async fn reload(&self, id: &str) -> OpendkimResult<()> {
        OpendkimProcessManager::reload(self.client(id)?).await
    }

    pub async fn status(&self, id: &str) -> OpendkimResult<String> {
        OpendkimProcessManager::status(self.client(id)?).await
    }

    pub async fn version(&self, id: &str) -> OpendkimResult<String> {
        OpendkimProcessManager::version(self.client(id)?).await
    }

    pub async fn info(&self, id: &str) -> OpendkimResult<OpendkimInfo> {
        OpendkimProcessManager::info(self.client(id)?).await
    }
}
