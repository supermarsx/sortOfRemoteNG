// ── sorng-amavis/src/service.rs ────────────────────────────────────────────────
//! Aggregate Amavis façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::AmavisClient;
use crate::error::{AmavisError, AmavisErrorKind, AmavisResult};
use crate::types::*;

use crate::config::AmavisConfigManager;
use crate::policy_banks::PolicyBankManager;
use crate::banned::BannedManager;
use crate::lists::ListManager;
use crate::quarantine::QuarantineManager;
use crate::stats::StatsManager;
use crate::process::AmavisProcessManager;

/// Shared Tauri state handle.
pub type AmavisServiceState = Arc<Mutex<AmavisService>>;

/// Main Amavis service managing connections.
pub struct AmavisService {
    connections: HashMap<String, AmavisClient>,
}

impl AmavisService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: AmavisConnectionConfig,
    ) -> AmavisResult<AmavisConnectionSummary> {
        let client = AmavisClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> AmavisResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| AmavisError::new(
                AmavisErrorKind::NotConnected,
                format!("No connection '{}'", id),
            ))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> AmavisResult<&AmavisClient> {
        self.connections.get(id).ok_or_else(|| {
            AmavisError::new(
                AmavisErrorKind::NotConnected,
                format!("No connection '{}'", id),
            )
        })
    }

    // ── Ping ─────────────────────────────────────────────────────

    pub async fn ping(&self, id: &str) -> AmavisResult<AmavisConnectionSummary> {
        let client = self.client(id)?;
        client.ping().await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_main_config(&self, id: &str) -> AmavisResult<AmavisMainConfig> {
        AmavisConfigManager::get_main_config(self.client(id)?).await
    }

    pub async fn update_main_config(
        &self,
        id: &str,
        config: &AmavisMainConfig,
    ) -> AmavisResult<()> {
        AmavisConfigManager::update_main_config(self.client(id)?, config).await
    }

    pub async fn list_snippets(&self, id: &str) -> AmavisResult<Vec<AmavisConfigSnippet>> {
        AmavisConfigManager::list_snippets(self.client(id)?).await
    }

    pub async fn get_snippet(&self, id: &str, name: &str) -> AmavisResult<AmavisConfigSnippet> {
        AmavisConfigManager::get_snippet(self.client(id)?, name).await
    }

    pub async fn create_snippet(
        &self,
        id: &str,
        name: &str,
        content: &str,
    ) -> AmavisResult<()> {
        AmavisConfigManager::create_snippet(self.client(id)?, name, content).await.map(|_| ())
    }

    pub async fn update_snippet(
        &self,
        id: &str,
        name: &str,
        content: &str,
    ) -> AmavisResult<()> {
        AmavisConfigManager::update_snippet(self.client(id)?, name, content).await.map(|_| ())
    }

    pub async fn delete_snippet(&self, id: &str, name: &str) -> AmavisResult<()> {
        AmavisConfigManager::delete_snippet(self.client(id)?, name).await
    }

    pub async fn enable_snippet(&self, id: &str, name: &str) -> AmavisResult<()> {
        AmavisConfigManager::enable_snippet(self.client(id)?, name).await
    }

    pub async fn disable_snippet(&self, id: &str, name: &str) -> AmavisResult<()> {
        AmavisConfigManager::disable_snippet(self.client(id)?, name).await
    }

    pub async fn test_config(&self, id: &str) -> AmavisResult<String> {
        AmavisConfigManager::test_config(self.client(id)?).await
    }

    // ── Policy Banks ─────────────────────────────────────────────

    pub async fn list_policy_banks(&self, id: &str) -> AmavisResult<Vec<AmavisPolicyBank>> {
        PolicyBankManager::list(self.client(id)?).await
    }

    pub async fn get_policy_bank(
        &self,
        id: &str,
        name: &str,
    ) -> AmavisResult<AmavisPolicyBank> {
        PolicyBankManager::get(self.client(id)?, name).await
    }

    pub async fn create_policy_bank(
        &self,
        id: &str,
        req: &CreatePolicyBankRequest,
    ) -> AmavisResult<AmavisPolicyBank> {
        PolicyBankManager::create(self.client(id)?, req).await
    }

    pub async fn update_policy_bank(
        &self,
        id: &str,
        name: &str,
        req: &UpdatePolicyBankRequest,
    ) -> AmavisResult<AmavisPolicyBank> {
        PolicyBankManager::update(self.client(id)?, name, req).await
    }

    pub async fn delete_policy_bank(&self, id: &str, name: &str) -> AmavisResult<()> {
        PolicyBankManager::delete(self.client(id)?, name).await
    }

    pub async fn activate_policy_bank(&self, id: &str, name: &str) -> AmavisResult<()> {
        PolicyBankManager::activate(self.client(id)?, name).await
    }

    pub async fn deactivate_policy_bank(&self, id: &str, name: &str) -> AmavisResult<()> {
        PolicyBankManager::deactivate(self.client(id)?, name).await
    }

    // ── Banned ───────────────────────────────────────────────────

    pub async fn list_banned_rules(&self, id: &str) -> AmavisResult<Vec<AmavisBannedRule>> {
        BannedManager::list_rules(self.client(id)?).await
    }

    pub async fn get_banned_rule(
        &self,
        id: &str,
        ban_id: &str,
    ) -> AmavisResult<AmavisBannedRule> {
        BannedManager::get_rule(self.client(id)?, ban_id).await
    }

    pub async fn create_banned_rule(
        &self,
        id: &str,
        req: &CreateBannedRuleRequest,
    ) -> AmavisResult<AmavisBannedRule> {
        BannedManager::create_rule(self.client(id)?, req).await
    }

    pub async fn update_banned_rule(
        &self,
        id: &str,
        ban_id: &str,
        req: &UpdateBannedRuleRequest,
    ) -> AmavisResult<AmavisBannedRule> {
        BannedManager::update_rule(self.client(id)?, ban_id, req).await
    }

    pub async fn delete_banned_rule(&self, id: &str, ban_id: &str) -> AmavisResult<()> {
        BannedManager::delete_rule(self.client(id)?, ban_id).await
    }

    pub async fn test_filename(&self, id: &str, filename: &str) -> AmavisResult<bool> {
        BannedManager::test_filename(self.client(id)?, filename).await
    }

    // ── Lists (Whitelist / Blacklist) ────────────────────────────

    pub async fn list_entries(
        &self,
        id: &str,
        list_type: &AmavisListType,
    ) -> AmavisResult<Vec<AmavisListEntry>> {
        ListManager::list_entries(self.client(id)?, list_type).await
    }

    pub async fn get_list_entry(
        &self,
        id: &str,
        entry_id: &str,
    ) -> AmavisResult<AmavisListEntry> {
        ListManager::get_entry(self.client(id)?, entry_id).await
    }

    pub async fn add_list_entry(
        &self,
        id: &str,
        req: &CreateListEntryRequest,
    ) -> AmavisResult<AmavisListEntry> {
        ListManager::add_entry(self.client(id)?, req).await
    }

    pub async fn update_list_entry(
        &self,
        id: &str,
        entry_id: &str,
        req: &UpdateListEntryRequest,
    ) -> AmavisResult<AmavisListEntry> {
        ListManager::update_entry(self.client(id)?, entry_id, req).await
    }

    pub async fn remove_list_entry(&self, id: &str, entry_id: &str) -> AmavisResult<()> {
        ListManager::remove_entry(self.client(id)?, entry_id).await
    }

    pub async fn check_sender(
        &self,
        id: &str,
        sender_address: &str,
    ) -> AmavisResult<AmavisListCheckResult> {
        ListManager::check_sender(self.client(id)?, sender_address).await
    }

    // ── Quarantine ───────────────────────────────────────────────

    pub async fn list_quarantine(
        &self,
        id: &str,
        request: &QuarantineListRequest,
    ) -> AmavisResult<Vec<AmavisQuarantineItem>> {
        QuarantineManager::list(self.client(id)?, request).await
    }

    pub async fn get_quarantine(
        &self,
        id: &str,
        mail_id: &str,
    ) -> AmavisResult<AmavisQuarantineItem> {
        QuarantineManager::get(self.client(id)?, mail_id).await
    }

    pub async fn release_quarantine(&self, id: &str, mail_id: &str) -> AmavisResult<()> {
        QuarantineManager::release(self.client(id)?, mail_id).await
    }

    pub async fn delete_quarantine(&self, id: &str, mail_id: &str) -> AmavisResult<()> {
        QuarantineManager::delete(self.client(id)?, mail_id).await
    }

    pub async fn release_all_quarantine(
        &self,
        id: &str,
        quarantine_type: &str,
    ) -> AmavisResult<()> {
        QuarantineManager::release_all(self.client(id)?, quarantine_type).await
    }

    pub async fn delete_all_quarantine(
        &self,
        id: &str,
        quarantine_type: &str,
    ) -> AmavisResult<()> {
        QuarantineManager::delete_all(self.client(id)?, quarantine_type).await
    }

    pub async fn get_quarantine_stats(
        &self,
        id: &str,
    ) -> AmavisResult<AmavisQuarantineStats> {
        QuarantineManager::get_stats(self.client(id)?).await
    }

    // ── Stats ────────────────────────────────────────────────────

    pub async fn get_stats(&self, id: &str) -> AmavisResult<AmavisStats> {
        StatsManager::get_stats(self.client(id)?).await
    }

    pub async fn get_child_processes(
        &self,
        id: &str,
    ) -> AmavisResult<Vec<AmavisChildProcess>> {
        StatsManager::get_child_processes(self.client(id)?).await
    }

    pub async fn get_throughput(&self, id: &str) -> AmavisResult<AmavisThroughput> {
        StatsManager::get_throughput(self.client(id)?).await
    }

    pub async fn reset_stats(&self, id: &str) -> AmavisResult<()> {
        StatsManager::reset_stats(self.client(id)?).await
    }

    // ── Process ──────────────────────────────────────────────────

    pub async fn start(&self, id: &str) -> AmavisResult<()> {
        AmavisProcessManager::start(self.client(id)?).await
    }

    pub async fn stop(&self, id: &str) -> AmavisResult<()> {
        AmavisProcessManager::stop(self.client(id)?).await
    }

    pub async fn restart(&self, id: &str) -> AmavisResult<()> {
        AmavisProcessManager::restart(self.client(id)?).await
    }

    pub async fn reload(&self, id: &str) -> AmavisResult<()> {
        AmavisProcessManager::reload(self.client(id)?).await
    }

    pub async fn process_status(&self, id: &str) -> AmavisResult<AmavisProcessInfo> {
        AmavisProcessManager::status(self.client(id)?).await
    }

    pub async fn version(&self, id: &str) -> AmavisResult<String> {
        AmavisProcessManager::version(self.client(id)?).await
    }

    pub async fn debug_sa(&self, id: &str, message: &str) -> AmavisResult<String> {
        AmavisProcessManager::debug_sa(self.client(id)?, message).await
    }

    pub async fn show_config(&self, id: &str) -> AmavisResult<String> {
        AmavisProcessManager::show_config(self.client(id)?).await
    }
}
