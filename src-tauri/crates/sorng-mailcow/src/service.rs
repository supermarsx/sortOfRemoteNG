// ── sorng-mailcow/src/service.rs ─────────────────────────────────────────────
//! Aggregate Mailcow façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::MailcowClient;
use crate::error::{MailcowError, MailcowResult};
use crate::types::*;

use crate::domains::DomainManager;
use crate::mailboxes::MailboxManager;
use crate::aliases::AliasManager;
use crate::dkim::DkimManager;
use crate::domain_aliases::DomainAliasManager;
use crate::transport::TransportManager;
use crate::queue::QueueManager;
use crate::quarantine::QuarantineManager;
use crate::logs::LogManager;
use crate::status::StatusManager;

/// Shared Tauri state handle.
pub type MailcowServiceState = Arc<Mutex<MailcowService>>;

/// Main Mailcow service managing connections.
pub struct MailcowService {
    connections: HashMap<String, MailcowClient>,
}

impl MailcowService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: MailcowConnectionConfig) -> MailcowResult<MailcowConnectionSummary> {
        let client = MailcowClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> MailcowResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| MailcowError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> MailcowResult<&MailcowClient> {
        self.connections.get(id)
            .ok_or_else(|| MailcowError::not_connected(format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> MailcowResult<MailcowConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Domains ──────────────────────────────────────────────────

    pub async fn list_domains(&self, id: &str) -> MailcowResult<Vec<MailcowDomain>> {
        DomainManager::list(self.client(id)?).await
    }

    pub async fn get_domain(&self, id: &str, domain: &str) -> MailcowResult<MailcowDomain> {
        DomainManager::get(self.client(id)?, domain).await
    }

    pub async fn create_domain(&self, id: &str, req: &CreateDomainRequest) -> MailcowResult<serde_json::Value> {
        DomainManager::create(self.client(id)?, req).await
    }

    pub async fn update_domain(&self, id: &str, domain: &str, req: &UpdateDomainRequest) -> MailcowResult<serde_json::Value> {
        DomainManager::update(self.client(id)?, domain, req).await
    }

    pub async fn delete_domain(&self, id: &str, domain: &str) -> MailcowResult<serde_json::Value> {
        DomainManager::delete(self.client(id)?, domain).await
    }

    // ── Mailboxes ────────────────────────────────────────────────

    pub async fn list_mailboxes(&self, id: &str) -> MailcowResult<Vec<MailcowMailbox>> {
        MailboxManager::list(self.client(id)?).await
    }

    pub async fn list_mailboxes_by_domain(&self, id: &str, domain: &str) -> MailcowResult<Vec<MailcowMailbox>> {
        MailboxManager::list_by_domain(self.client(id)?, domain).await
    }

    pub async fn get_mailbox(&self, id: &str, username: &str) -> MailcowResult<MailcowMailbox> {
        MailboxManager::get(self.client(id)?, username).await
    }

    pub async fn create_mailbox(&self, id: &str, req: &CreateMailboxRequest) -> MailcowResult<serde_json::Value> {
        MailboxManager::create(self.client(id)?, req).await
    }

    pub async fn update_mailbox(&self, id: &str, username: &str, req: &UpdateMailboxRequest) -> MailcowResult<serde_json::Value> {
        MailboxManager::update(self.client(id)?, username, req).await
    }

    pub async fn delete_mailbox(&self, id: &str, username: &str) -> MailcowResult<serde_json::Value> {
        MailboxManager::delete(self.client(id)?, username).await
    }

    pub async fn quarantine_notifications(&self, id: &str, username: &str, enable: bool) -> MailcowResult<serde_json::Value> {
        MailboxManager::quarantine_notifications(self.client(id)?, username, enable).await
    }

    pub async fn pushover_setup(&self, id: &str, username: &str, config: &serde_json::Value) -> MailcowResult<serde_json::Value> {
        MailboxManager::pushover_setup(self.client(id)?, username, config).await
    }

    // ── Aliases ──────────────────────────────────────────────────

    pub async fn list_aliases(&self, id: &str) -> MailcowResult<Vec<MailcowAlias>> {
        AliasManager::list(self.client(id)?).await
    }

    pub async fn get_alias(&self, id: &str, alias_id: i64) -> MailcowResult<MailcowAlias> {
        AliasManager::get(self.client(id)?, alias_id).await
    }

    pub async fn create_alias(&self, id: &str, req: &CreateAliasRequest) -> MailcowResult<serde_json::Value> {
        AliasManager::create(self.client(id)?, req).await
    }

    pub async fn update_alias(&self, id: &str, alias_id: i64, req: &UpdateAliasRequest) -> MailcowResult<serde_json::Value> {
        AliasManager::update(self.client(id)?, alias_id, req).await
    }

    pub async fn delete_alias(&self, id: &str, alias_id: i64) -> MailcowResult<serde_json::Value> {
        AliasManager::delete(self.client(id)?, alias_id).await
    }

    // ── DKIM ─────────────────────────────────────────────────────

    pub async fn get_dkim(&self, id: &str, domain: &str) -> MailcowResult<MailcowDkimKey> {
        DkimManager::get(self.client(id)?, domain).await
    }

    pub async fn generate_dkim(&self, id: &str, req: &GenerateDkimRequest) -> MailcowResult<serde_json::Value> {
        DkimManager::generate(self.client(id)?, req).await
    }

    pub async fn delete_dkim(&self, id: &str, domain: &str) -> MailcowResult<serde_json::Value> {
        DkimManager::delete(self.client(id)?, domain).await
    }

    pub async fn duplicate_dkim(&self, id: &str, src_domain: &str, dst_domain: &str) -> MailcowResult<serde_json::Value> {
        DkimManager::duplicate(self.client(id)?, src_domain, dst_domain).await
    }

    // ── Domain Aliases ───────────────────────────────────────────

    pub async fn list_domain_aliases(&self, id: &str) -> MailcowResult<Vec<MailcowDomainAlias>> {
        DomainAliasManager::list(self.client(id)?).await
    }

    pub async fn get_domain_alias(&self, id: &str, alias_domain: &str) -> MailcowResult<MailcowDomainAlias> {
        DomainAliasManager::get(self.client(id)?, alias_domain).await
    }

    pub async fn create_domain_alias(&self, id: &str, req: &CreateDomainAliasRequest) -> MailcowResult<serde_json::Value> {
        DomainAliasManager::create(self.client(id)?, req).await
    }

    pub async fn update_domain_alias(&self, id: &str, alias_domain: &str, active: bool) -> MailcowResult<serde_json::Value> {
        DomainAliasManager::update(self.client(id)?, alias_domain, active).await
    }

    pub async fn delete_domain_alias(&self, id: &str, alias_domain: &str) -> MailcowResult<serde_json::Value> {
        DomainAliasManager::delete(self.client(id)?, alias_domain).await
    }

    // ── Transport ────────────────────────────────────────────────

    pub async fn list_transport_maps(&self, id: &str) -> MailcowResult<Vec<MailcowTransportMap>> {
        TransportManager::list(self.client(id)?).await
    }

    pub async fn get_transport_map(&self, id: &str, transport_id: i64) -> MailcowResult<MailcowTransportMap> {
        TransportManager::get(self.client(id)?, transport_id).await
    }

    pub async fn create_transport_map(&self, id: &str, req: &CreateTransportMapRequest) -> MailcowResult<serde_json::Value> {
        TransportManager::create(self.client(id)?, req).await
    }

    pub async fn update_transport_map(&self, id: &str, transport_id: i64, req: &CreateTransportMapRequest) -> MailcowResult<serde_json::Value> {
        TransportManager::update(self.client(id)?, transport_id, req).await
    }

    pub async fn delete_transport_map(&self, id: &str, transport_id: i64) -> MailcowResult<serde_json::Value> {
        TransportManager::delete(self.client(id)?, transport_id).await
    }

    // ── Queue ────────────────────────────────────────────────────

    pub async fn get_queue_summary(&self, id: &str) -> MailcowResult<MailcowQueueSummary> {
        QueueManager::get_summary(self.client(id)?).await
    }

    pub async fn list_queue(&self, id: &str, queue_name: &str) -> MailcowResult<Vec<MailcowQueueItem>> {
        QueueManager::list_queue(self.client(id)?, queue_name).await
    }

    pub async fn flush_queue(&self, id: &str, queue_name: &str) -> MailcowResult<serde_json::Value> {
        QueueManager::flush(self.client(id)?, queue_name).await
    }

    pub async fn delete_queue_item(&self, id: &str, queue_id: &str) -> MailcowResult<serde_json::Value> {
        QueueManager::delete_item(self.client(id)?, queue_id).await
    }

    pub async fn super_delete_queue(&self, id: &str, queue_name: &str) -> MailcowResult<serde_json::Value> {
        QueueManager::super_delete(self.client(id)?, queue_name).await
    }

    // ── Quarantine ───────────────────────────────────────────────

    pub async fn list_quarantine(&self, id: &str) -> MailcowResult<Vec<MailcowQuarantineItem>> {
        QuarantineManager::list(self.client(id)?).await
    }

    pub async fn get_quarantine(&self, id: &str, quarantine_id: i64) -> MailcowResult<MailcowQuarantineItem> {
        QuarantineManager::get(self.client(id)?, quarantine_id).await
    }

    pub async fn release_quarantine(&self, id: &str, quarantine_id: i64) -> MailcowResult<serde_json::Value> {
        QuarantineManager::release(self.client(id)?, quarantine_id).await
    }

    pub async fn delete_quarantine(&self, id: &str, quarantine_id: i64) -> MailcowResult<serde_json::Value> {
        QuarantineManager::delete(self.client(id)?, quarantine_id).await
    }

    pub async fn whitelist_sender(&self, id: &str, quarantine_id: i64) -> MailcowResult<serde_json::Value> {
        QuarantineManager::whitelist_sender(self.client(id)?, quarantine_id).await
    }

    pub async fn get_quarantine_settings(&self, id: &str) -> MailcowResult<serde_json::Value> {
        QuarantineManager::get_settings(self.client(id)?).await
    }

    pub async fn update_quarantine_settings(&self, id: &str, settings: &serde_json::Value) -> MailcowResult<serde_json::Value> {
        QuarantineManager::update_settings(self.client(id)?, settings).await
    }

    // ── Logs ─────────────────────────────────────────────────────

    pub async fn get_logs(&self, id: &str, log_type: &MailcowLogType, count: u64) -> MailcowResult<Vec<MailcowLogEntry>> {
        LogManager::get_logs(self.client(id)?, log_type, count).await
    }

    pub async fn get_api_logs(&self, id: &str, count: u64) -> MailcowResult<Vec<MailcowLogEntry>> {
        LogManager::get_api_logs(self.client(id)?, count).await
    }

    // ── Status ───────────────────────────────────────────────────

    pub async fn get_container_status(&self, id: &str) -> MailcowResult<Vec<MailcowContainerStatus>> {
        StatusManager::get_container_status(self.client(id)?).await
    }

    pub async fn get_solr_status(&self, id: &str) -> MailcowResult<serde_json::Value> {
        StatusManager::get_solr_status(self.client(id)?).await
    }

    pub async fn get_system_status(&self, id: &str) -> MailcowResult<MailcowSystemStatus> {
        StatusManager::get_system_status(self.client(id)?).await
    }

    pub async fn get_rspamd_stats(&self, id: &str) -> MailcowResult<serde_json::Value> {
        StatusManager::get_rspamd_stats(self.client(id)?).await
    }

    pub async fn get_fail2ban_config(&self, id: &str) -> MailcowResult<MailcowFail2BanConfig> {
        StatusManager::get_fail2ban_config(self.client(id)?).await
    }

    pub async fn update_fail2ban_config(&self, id: &str, config: &MailcowFail2BanConfig) -> MailcowResult<serde_json::Value> {
        StatusManager::update_fail2ban_config(self.client(id)?, config).await
    }

    pub async fn get_rate_limits(&self, id: &str, mailbox: &str) -> MailcowResult<MailcowRateLimit> {
        StatusManager::get_rate_limits(self.client(id)?, mailbox).await
    }

    pub async fn set_rate_limit(&self, id: &str, req: &SetRateLimitRequest) -> MailcowResult<serde_json::Value> {
        StatusManager::set_rate_limit(self.client(id)?, req).await
    }

    pub async fn delete_rate_limit(&self, id: &str, mailbox: &str) -> MailcowResult<serde_json::Value> {
        StatusManager::delete_rate_limit(self.client(id)?, mailbox).await
    }

    pub async fn list_app_passwords(&self, id: &str, username: &str) -> MailcowResult<Vec<MailcowAppPassword>> {
        StatusManager::list_app_passwords(self.client(id)?, username).await
    }

    pub async fn create_app_password(&self, id: &str, req: &CreateAppPasswordRequest) -> MailcowResult<serde_json::Value> {
        StatusManager::create_app_password(self.client(id)?, req).await
    }

    pub async fn delete_app_password(&self, id: &str, app_password_id: i64) -> MailcowResult<serde_json::Value> {
        StatusManager::delete_app_password(self.client(id)?, app_password_id).await
    }

    pub async fn list_resources(&self, id: &str) -> MailcowResult<Vec<MailcowResource>> {
        StatusManager::list_resources(self.client(id)?).await
    }

    pub async fn get_resource(&self, id: &str, name: &str) -> MailcowResult<MailcowResource> {
        StatusManager::get_resource(self.client(id)?, name).await
    }

    pub async fn create_resource(&self, id: &str, req: &CreateResourceRequest) -> MailcowResult<serde_json::Value> {
        StatusManager::create_resource(self.client(id)?, req).await
    }

    pub async fn update_resource(&self, id: &str, name: &str, req: &CreateResourceRequest) -> MailcowResult<serde_json::Value> {
        StatusManager::update_resource(self.client(id)?, name, req).await
    }

    pub async fn delete_resource(&self, id: &str, name: &str) -> MailcowResult<serde_json::Value> {
        StatusManager::delete_resource(self.client(id)?, name).await
    }
}
