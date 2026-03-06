// ── sorng-spamassassin/src/service.rs ────────────────────────────────────────
//! Aggregate SpamAssassin façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::SpamAssassinClient;
use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;

use crate::bayes::BayesManager;
use crate::channels::ChannelManager;
use crate::config::SpamAssassinConfigManager;
use crate::logs::SpamAssassinLogManager;
use crate::plugins::PluginManager;
use crate::process::SpamAssassinProcessManager;
use crate::rules::RuleManager;
use crate::scanning::ScanManager;
use crate::whitelist::WhitelistManager;

/// Shared Tauri state handle.
pub type SpamAssassinServiceState = Arc<Mutex<SpamAssassinService>>;

/// Main SpamAssassin service managing connections.
pub struct SpamAssassinService {
    connections: HashMap<String, SpamAssassinClient>,
}

impl SpamAssassinService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: SpamAssassinConnectionConfig,
    ) -> SpamAssassinResult<SpamAssassinConnectionSummary> {
        if self.connections.contains_key(&id) {
            return Err(SpamAssassinError::already_connected(&id));
        }

        let client = SpamAssassinClient::new(config)?;
        let ver = client.version().await.ok();

        // Try to get rules count
        let rules = RuleManager::list(&client).await.ok();
        let rules_count = rules.as_ref().map(|r| r.len() as u32);

        // Try to get bayes status
        let bayes = BayesManager::status(&client).await.ok();
        let bayes_status = bayes.map(|b| {
            format!(
                "spam={}, ham={}, tokens={}",
                b.nspam, b.nham, b.ntokens
            )
        });

        let summary = SpamAssassinConnectionSummary {
            host: client.config.host.clone(),
            version: ver,
            rules_count,
            bayes_status,
        };

        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> SpamAssassinResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| SpamAssassinError::not_connected())
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> SpamAssassinResult<&SpamAssassinClient> {
        self.connections
            .get(id)
            .ok_or_else(|| SpamAssassinError::not_connected())
    }

    pub async fn ping(&self, id: &str) -> SpamAssassinResult<bool> {
        let client = self.client(id)?;
        let out = client.version().await;
        Ok(out.is_ok())
    }

    // ── Rules ────────────────────────────────────────────────────

    pub async fn list_rules(&self, id: &str) -> SpamAssassinResult<Vec<SpamRule>> {
        RuleManager::list(self.client(id)?).await
    }

    pub async fn get_rule(&self, id: &str, name: &str) -> SpamAssassinResult<SpamRule> {
        RuleManager::get(self.client(id)?, name).await
    }

    pub async fn list_scores(&self, id: &str) -> SpamAssassinResult<Vec<SpamRuleScore>> {
        RuleManager::list_scores(self.client(id)?).await
    }

    pub async fn set_score(
        &self,
        id: &str,
        name: &str,
        score: f64,
    ) -> SpamAssassinResult<()> {
        RuleManager::set_score(self.client(id)?, name, score).await
    }

    pub async fn create_custom_rule(
        &self,
        id: &str,
        req: CreateCustomRuleRequest,
    ) -> SpamAssassinResult<SpamRule> {
        RuleManager::create_custom(self.client(id)?, &req).await
    }

    pub async fn delete_custom_rule(
        &self,
        id: &str,
        name: &str,
    ) -> SpamAssassinResult<()> {
        RuleManager::delete_custom(self.client(id)?, name).await
    }

    pub async fn enable_rule(&self, id: &str, name: &str) -> SpamAssassinResult<()> {
        RuleManager::enable(self.client(id)?, name).await
    }

    pub async fn disable_rule(&self, id: &str, name: &str) -> SpamAssassinResult<()> {
        RuleManager::disable(self.client(id)?, name).await
    }

    pub async fn list_custom_rules(&self, id: &str) -> SpamAssassinResult<Vec<SpamRule>> {
        RuleManager::list_custom(self.client(id)?).await
    }

    pub async fn get_rule_description(
        &self,
        id: &str,
        name: &str,
    ) -> SpamAssassinResult<String> {
        RuleManager::get_rule_description(self.client(id)?, name).await
    }

    // ── Bayes ────────────────────────────────────────────────────

    pub async fn bayes_status(&self, id: &str) -> SpamAssassinResult<BayesStatus> {
        BayesManager::status(self.client(id)?).await
    }

    pub async fn learn_spam(
        &self,
        id: &str,
        message: &str,
    ) -> SpamAssassinResult<BayesLearnResult> {
        BayesManager::learn_spam(self.client(id)?, message).await
    }

    pub async fn learn_ham(
        &self,
        id: &str,
        message: &str,
    ) -> SpamAssassinResult<BayesLearnResult> {
        BayesManager::learn_ham(self.client(id)?, message).await
    }

    pub async fn learn_spam_folder(
        &self,
        id: &str,
        user: &str,
        folder: &str,
    ) -> SpamAssassinResult<BayesLearnResult> {
        BayesManager::learn_spam_folder(self.client(id)?, user, folder).await
    }

    pub async fn learn_ham_folder(
        &self,
        id: &str,
        user: &str,
        folder: &str,
    ) -> SpamAssassinResult<BayesLearnResult> {
        BayesManager::learn_ham_folder(self.client(id)?, user, folder).await
    }

    pub async fn bayes_forget(
        &self,
        id: &str,
        message: &str,
    ) -> SpamAssassinResult<BayesLearnResult> {
        BayesManager::forget(self.client(id)?, message).await
    }

    pub async fn bayes_clear(&self, id: &str) -> SpamAssassinResult<()> {
        BayesManager::clear(self.client(id)?).await
    }

    pub async fn bayes_sync(&self, id: &str) -> SpamAssassinResult<()> {
        BayesManager::sync(self.client(id)?).await
    }

    pub async fn bayes_backup(&self, id: &str) -> SpamAssassinResult<String> {
        BayesManager::backup(self.client(id)?).await
    }

    pub async fn bayes_restore(&self, id: &str, data: &str) -> SpamAssassinResult<()> {
        BayesManager::restore(self.client(id)?, data).await
    }

    // ── Channels ─────────────────────────────────────────────────

    pub async fn list_channels(&self, id: &str) -> SpamAssassinResult<Vec<SpamChannel>> {
        ChannelManager::list(self.client(id)?).await
    }

    pub async fn update_all_channels(
        &self,
        id: &str,
    ) -> SpamAssassinResult<Vec<ChannelUpdateResult>> {
        ChannelManager::update_all(self.client(id)?).await
    }

    pub async fn update_channel(
        &self,
        id: &str,
        channel_name: &str,
    ) -> SpamAssassinResult<ChannelUpdateResult> {
        ChannelManager::update(self.client(id)?, channel_name).await
    }

    pub async fn add_channel(
        &self,
        id: &str,
        name: &str,
        url: &str,
    ) -> SpamAssassinResult<()> {
        ChannelManager::add(self.client(id)?, name, url).await
    }

    pub async fn remove_channel(&self, id: &str, name: &str) -> SpamAssassinResult<()> {
        ChannelManager::remove(self.client(id)?, name).await
    }

    pub async fn list_channel_keys(&self, id: &str) -> SpamAssassinResult<Vec<String>> {
        ChannelManager::list_keys(self.client(id)?).await
    }

    pub async fn import_channel_key(&self, id: &str, key: &str) -> SpamAssassinResult<()> {
        ChannelManager::import_key(self.client(id)?, key).await
    }

    // ── Whitelist ────────────────────────────────────────────────

    pub async fn list_whitelist(
        &self,
        id: &str,
    ) -> SpamAssassinResult<Vec<SpamWhitelistEntry>> {
        WhitelistManager::list(self.client(id)?).await
    }

    pub async fn add_whitelist(
        &self,
        id: &str,
        entry: SpamWhitelistEntry,
    ) -> SpamAssassinResult<()> {
        WhitelistManager::add(self.client(id)?, &entry).await
    }

    pub async fn remove_whitelist(
        &self,
        id: &str,
        entry_type: &str,
        pattern: &str,
    ) -> SpamAssassinResult<()> {
        WhitelistManager::remove(self.client(id)?, entry_type, pattern).await
    }

    pub async fn list_trusted_networks(
        &self,
        id: &str,
    ) -> SpamAssassinResult<Vec<SpamTrustedNetwork>> {
        WhitelistManager::list_trusted_networks(self.client(id)?).await
    }

    pub async fn add_trusted_network(
        &self,
        id: &str,
        network: &str,
    ) -> SpamAssassinResult<()> {
        WhitelistManager::add_trusted_network(self.client(id)?, network).await
    }

    pub async fn remove_trusted_network(
        &self,
        id: &str,
        network: &str,
    ) -> SpamAssassinResult<()> {
        WhitelistManager::remove_trusted_network(self.client(id)?, network).await
    }

    // ── Plugins ──────────────────────────────────────────────────

    pub async fn list_plugins(&self, id: &str) -> SpamAssassinResult<Vec<SpamPlugin>> {
        PluginManager::list(self.client(id)?).await
    }

    pub async fn get_plugin(&self, id: &str, name: &str) -> SpamAssassinResult<SpamPlugin> {
        PluginManager::get(self.client(id)?, name).await
    }

    pub async fn enable_plugin(&self, id: &str, name: &str) -> SpamAssassinResult<()> {
        PluginManager::enable(self.client(id)?, name).await
    }

    pub async fn disable_plugin(&self, id: &str, name: &str) -> SpamAssassinResult<()> {
        PluginManager::disable(self.client(id)?, name).await
    }

    pub async fn configure_plugin(
        &self,
        id: &str,
        name: &str,
        key: &str,
        value: &str,
    ) -> SpamAssassinResult<()> {
        PluginManager::configure(self.client(id)?, name, key, value).await
    }

    pub async fn get_plugin_config(
        &self,
        id: &str,
        name: &str,
    ) -> SpamAssassinResult<HashMap<String, String>> {
        PluginManager::get_config(self.client(id)?, name).await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_local_cf(&self, id: &str) -> SpamAssassinResult<String> {
        SpamAssassinConfigManager::get_local_cf(self.client(id)?).await
    }

    pub async fn set_local_cf(&self, id: &str, content: &str) -> SpamAssassinResult<()> {
        SpamAssassinConfigManager::set_local_cf(self.client(id)?, content).await
    }

    pub async fn get_param(&self, id: &str, key: &str) -> SpamAssassinResult<String> {
        SpamAssassinConfigManager::get_param(self.client(id)?, key).await
    }

    pub async fn set_param(
        &self,
        id: &str,
        key: &str,
        value: &str,
    ) -> SpamAssassinResult<()> {
        SpamAssassinConfigManager::set_param(self.client(id)?, key, value).await
    }

    pub async fn delete_param(&self, id: &str, key: &str) -> SpamAssassinResult<()> {
        SpamAssassinConfigManager::delete_param(self.client(id)?, key).await
    }

    pub async fn get_spamd_config(&self, id: &str) -> SpamAssassinResult<SpamdConfig> {
        SpamAssassinConfigManager::get_spamd_config(self.client(id)?).await
    }

    pub async fn set_spamd_config(
        &self,
        id: &str,
        config: SpamdConfig,
    ) -> SpamAssassinResult<()> {
        SpamAssassinConfigManager::set_spamd_config(self.client(id)?, &config).await
    }

    pub async fn test_config(&self, id: &str) -> SpamAssassinResult<ConfigTestResult> {
        SpamAssassinConfigManager::test_config(self.client(id)?).await
    }

    // ── Scanning ─────────────────────────────────────────────────

    pub async fn check_message(
        &self,
        id: &str,
        message: &str,
    ) -> SpamAssassinResult<SpamCheckResult> {
        ScanManager::check_message(self.client(id)?, message).await
    }

    pub async fn check_file(
        &self,
        id: &str,
        path: &str,
    ) -> SpamAssassinResult<SpamCheckResult> {
        ScanManager::check_file(self.client(id)?, path).await
    }

    pub async fn report_message(&self, id: &str, message: &str) -> SpamAssassinResult<String> {
        ScanManager::report(self.client(id)?, message).await
    }

    pub async fn revoke_message(&self, id: &str, message: &str) -> SpamAssassinResult<String> {
        ScanManager::revoke(self.client(id)?, message).await
    }

    // ── Process ──────────────────────────────────────────────────

    pub async fn start(&self, id: &str) -> SpamAssassinResult<()> {
        SpamAssassinProcessManager::start(self.client(id)?).await
    }

    pub async fn stop(&self, id: &str) -> SpamAssassinResult<()> {
        SpamAssassinProcessManager::stop(self.client(id)?).await
    }

    pub async fn restart(&self, id: &str) -> SpamAssassinResult<()> {
        SpamAssassinProcessManager::restart(self.client(id)?).await
    }

    pub async fn reload(&self, id: &str) -> SpamAssassinResult<()> {
        SpamAssassinProcessManager::reload(self.client(id)?).await
    }

    pub async fn status(&self, id: &str) -> SpamAssassinResult<SpamdStatus> {
        SpamAssassinProcessManager::status(self.client(id)?).await
    }

    pub async fn version(&self, id: &str) -> SpamAssassinResult<String> {
        SpamAssassinProcessManager::version(self.client(id)?).await
    }

    pub async fn info(&self, id: &str) -> SpamAssassinResult<SpamAssassinInfo> {
        SpamAssassinProcessManager::info(self.client(id)?).await
    }

    pub async fn lint(&self, id: &str) -> SpamAssassinResult<ConfigTestResult> {
        SpamAssassinProcessManager::lint(self.client(id)?).await
    }

    // ── Logs ─────────────────────────────────────────────────────

    pub async fn query_log(
        &self,
        id: &str,
        lines: Option<u32>,
        filter: Option<String>,
    ) -> SpamAssassinResult<Vec<SpamLog>> {
        SpamAssassinLogManager::query(self.client(id)?, lines, filter.as_deref()).await
    }

    pub async fn list_log_files(&self, id: &str) -> SpamAssassinResult<Vec<String>> {
        SpamAssassinLogManager::list_log_files(self.client(id)?).await
    }

    pub async fn get_statistics(&self, id: &str) -> SpamAssassinResult<SpamStatistics> {
        SpamAssassinLogManager::get_statistics(self.client(id)?).await
    }
}
