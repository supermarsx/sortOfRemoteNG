// ── sorng-postfix/src/service.rs ──────────────────────────────────────────────
//! Aggregate Postfix façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::PostfixClient;
use crate::error::{PostfixError, PostfixResult};
use crate::types::*;

use crate::aliases::AliasManager;
use crate::config::PostfixConfigManager;
use crate::domains::DomainManager;
use crate::logs::PostfixLogManager;
use crate::milters::MilterManager;
use crate::process::PostfixProcessManager;
use crate::queue::QueueManager;
use crate::restrictions::RestrictionManager;
use crate::tls::PostfixTlsManager;
use crate::transport::TransportManager;

/// Shared Tauri state handle.
pub type PostfixServiceState = Arc<Mutex<PostfixService>>;

/// Main Postfix service managing connections.
pub struct PostfixService {
    connections: HashMap<String, PostfixClient>,
}

impl PostfixService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: PostfixConnectionConfig,
    ) -> PostfixResult<PostfixConnectionSummary> {
        let client = PostfixClient::new(config)?;
        let ver = client.version().await.ok();
        let mail_name = client.postconf("mail_name").await.ok();
        let mydomain = client.postconf("mydomain").await.ok();
        let myorigin = client.postconf("myorigin").await.ok();
        let summary = PostfixConnectionSummary {
            host: client.config.host.clone(),
            version: ver,
            mail_name,
            mydomain,
            myorigin,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> PostfixResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| PostfixError::new(
                crate::error::PostfixErrorKind::NotConnected,
                format!("No connection '{}'", id),
            ))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> PostfixResult<&PostfixClient> {
        self.connections.get(id).ok_or_else(|| {
            PostfixError::new(
                crate::error::PostfixErrorKind::NotConnected,
                format!("No connection '{}'", id),
            )
        })
    }

    // ── Ping ─────────────────────────────────────────────────────

    pub async fn ping(&self, id: &str) -> PostfixResult<String> {
        let client = self.client(id)?;
        client.version().await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_main_cf(&self, id: &str) -> PostfixResult<Vec<PostfixMainCfParam>> {
        PostfixConfigManager::get_main_cf(self.client(id)?).await
    }

    pub async fn get_param(&self, id: &str, name: &str) -> PostfixResult<PostfixMainCfParam> {
        PostfixConfigManager::get_param(self.client(id)?, name).await
    }

    pub async fn set_param(&self, id: &str, name: &str, value: &str) -> PostfixResult<()> {
        PostfixConfigManager::set_param(self.client(id)?, name, value).await
    }

    pub async fn delete_param(&self, id: &str, name: &str) -> PostfixResult<()> {
        PostfixConfigManager::delete_param(self.client(id)?, name).await
    }

    pub async fn get_master_cf(&self, id: &str) -> PostfixResult<Vec<PostfixMasterCfEntry>> {
        PostfixConfigManager::get_master_cf(self.client(id)?).await
    }

    pub async fn update_master_cf(
        &self,
        id: &str,
        entry: &PostfixMasterCfEntry,
    ) -> PostfixResult<()> {
        PostfixConfigManager::update_master_cf(self.client(id)?, entry).await
    }

    pub async fn check_config(&self, id: &str) -> PostfixResult<ConfigTestResult> {
        PostfixConfigManager::check_config(self.client(id)?).await
    }

    pub async fn get_maps(&self, id: &str) -> PostfixResult<Vec<PostfixMap>> {
        PostfixConfigManager::get_maps(self.client(id)?).await
    }

    pub async fn get_map_entries(
        &self,
        id: &str,
        name: &str,
    ) -> PostfixResult<Vec<PostfixMapEntry>> {
        PostfixConfigManager::get_map_entries(self.client(id)?, name).await
    }

    pub async fn set_map_entry(
        &self,
        id: &str,
        name: &str,
        key: &str,
        value: &str,
    ) -> PostfixResult<()> {
        PostfixConfigManager::set_map_entry(self.client(id)?, name, key, value).await
    }

    pub async fn delete_map_entry(&self, id: &str, name: &str, key: &str) -> PostfixResult<()> {
        PostfixConfigManager::delete_map_entry(self.client(id)?, name, key).await
    }

    pub async fn rebuild_map(&self, id: &str, name: &str) -> PostfixResult<()> {
        PostfixConfigManager::rebuild_map(self.client(id)?, name).await
    }

    // ── Domains ──────────────────────────────────────────────────

    pub async fn list_domains(&self, id: &str) -> PostfixResult<Vec<PostfixDomain>> {
        DomainManager::list(self.client(id)?).await
    }

    pub async fn get_domain(&self, id: &str, domain: &str) -> PostfixResult<PostfixDomain> {
        DomainManager::get(self.client(id)?, domain).await
    }

    pub async fn create_domain(
        &self,
        id: &str,
        req: &CreateDomainRequest,
    ) -> PostfixResult<PostfixDomain> {
        DomainManager::create(self.client(id)?, req).await
    }

    pub async fn update_domain(
        &self,
        id: &str,
        domain: &str,
        req: &UpdateDomainRequest,
    ) -> PostfixResult<PostfixDomain> {
        DomainManager::update(self.client(id)?, domain, req).await
    }

    pub async fn delete_domain(&self, id: &str, domain: &str) -> PostfixResult<()> {
        DomainManager::delete(self.client(id)?, domain).await
    }

    // ── Aliases ──────────────────────────────────────────────────

    pub async fn list_aliases(&self, id: &str) -> PostfixResult<Vec<PostfixAlias>> {
        AliasManager::list(self.client(id)?).await
    }

    pub async fn get_alias(&self, id: &str, address: &str) -> PostfixResult<PostfixAlias> {
        AliasManager::get(self.client(id)?, address).await
    }

    pub async fn create_alias(
        &self,
        id: &str,
        req: &CreateAliasRequest,
    ) -> PostfixResult<PostfixAlias> {
        AliasManager::create(self.client(id)?, req).await
    }

    pub async fn update_alias(
        &self,
        id: &str,
        address: &str,
        req: &UpdateAliasRequest,
    ) -> PostfixResult<PostfixAlias> {
        AliasManager::update(self.client(id)?, address, req).await
    }

    pub async fn delete_alias(&self, id: &str, address: &str) -> PostfixResult<()> {
        AliasManager::delete(self.client(id)?, address).await
    }

    pub async fn list_virtual_aliases(&self, id: &str) -> PostfixResult<Vec<PostfixAlias>> {
        AliasManager::list_virtual(self.client(id)?).await
    }

    pub async fn list_local_aliases(&self, id: &str) -> PostfixResult<Vec<PostfixAlias>> {
        AliasManager::list_local(self.client(id)?).await
    }

    // ── Transports ───────────────────────────────────────────────

    pub async fn list_transports(&self, id: &str) -> PostfixResult<Vec<PostfixTransport>> {
        TransportManager::list(self.client(id)?).await
    }

    pub async fn get_transport(&self, id: &str, domain: &str) -> PostfixResult<PostfixTransport> {
        TransportManager::get(self.client(id)?, domain).await
    }

    pub async fn create_transport(
        &self,
        id: &str,
        req: &CreateTransportRequest,
    ) -> PostfixResult<PostfixTransport> {
        TransportManager::create(self.client(id)?, req).await
    }

    pub async fn update_transport(
        &self,
        id: &str,
        domain: &str,
        req: &UpdateTransportRequest,
    ) -> PostfixResult<PostfixTransport> {
        TransportManager::update(self.client(id)?, domain, req).await
    }

    pub async fn delete_transport(&self, id: &str, domain: &str) -> PostfixResult<()> {
        TransportManager::delete(self.client(id)?, domain).await
    }

    pub async fn test_transport(&self, id: &str, domain: &str) -> PostfixResult<String> {
        TransportManager::test_transport(self.client(id)?, domain).await
    }

    // ── Queues ───────────────────────────────────────────────────

    pub async fn list_queues(&self, id: &str) -> PostfixResult<Vec<PostfixQueue>> {
        QueueManager::list_queues(self.client(id)?).await
    }

    pub async fn list_queue_entries(
        &self,
        id: &str,
        queue_name: &str,
    ) -> PostfixResult<Vec<PostfixQueueEntry>> {
        QueueManager::list_entries(self.client(id)?, queue_name).await
    }

    pub async fn get_queue_entry(
        &self,
        id: &str,
        queue_id: &str,
    ) -> PostfixResult<PostfixQueueEntry> {
        QueueManager::get_entry(self.client(id)?, queue_id).await
    }

    pub async fn flush(&self, id: &str) -> PostfixResult<()> {
        QueueManager::flush(self.client(id)?).await
    }

    pub async fn flush_queue(&self, id: &str, queue_name: &str) -> PostfixResult<()> {
        QueueManager::flush_queue(self.client(id)?, queue_name).await
    }

    pub async fn delete_queue_entry(&self, id: &str, queue_id: &str) -> PostfixResult<()> {
        QueueManager::delete_entry(self.client(id)?, queue_id).await
    }

    pub async fn hold_queue_entry(&self, id: &str, queue_id: &str) -> PostfixResult<()> {
        QueueManager::hold_entry(self.client(id)?, queue_id).await
    }

    pub async fn release_queue_entry(&self, id: &str, queue_id: &str) -> PostfixResult<()> {
        QueueManager::release_entry(self.client(id)?, queue_id).await
    }

    pub async fn delete_all_queued(&self, id: &str) -> PostfixResult<()> {
        QueueManager::delete_all(self.client(id)?).await
    }

    pub async fn requeue_all(&self, id: &str) -> PostfixResult<()> {
        QueueManager::requeue_all(self.client(id)?).await
    }

    pub async fn purge_queues(&self, id: &str) -> PostfixResult<()> {
        QueueManager::purge(self.client(id)?).await
    }

    // ── TLS ──────────────────────────────────────────────────────

    pub async fn get_tls_config(
        &self,
        id: &str,
    ) -> PostfixResult<std::collections::HashMap<String, String>> {
        PostfixTlsManager::get_tls_config(self.client(id)?).await
    }

    pub async fn set_tls_param(
        &self,
        id: &str,
        name: &str,
        value: &str,
    ) -> PostfixResult<()> {
        PostfixTlsManager::set_tls_param(self.client(id)?, name, value).await
    }

    pub async fn list_tls_policies(&self, id: &str) -> PostfixResult<Vec<PostfixTlsPolicy>> {
        PostfixTlsManager::list_policies(self.client(id)?).await
    }

    pub async fn set_tls_policy(
        &self,
        id: &str,
        domain: &str,
        policy: &PostfixTlsPolicy,
    ) -> PostfixResult<()> {
        PostfixTlsManager::set_policy(self.client(id)?, domain, policy).await
    }

    pub async fn delete_tls_policy(&self, id: &str, domain: &str) -> PostfixResult<()> {
        PostfixTlsManager::delete_policy(self.client(id)?, domain).await
    }

    pub async fn check_certificate(
        &self,
        id: &str,
        cert_path: &str,
    ) -> PostfixResult<CertificateInfo> {
        PostfixTlsManager::check_certificate(self.client(id)?, cert_path).await
    }

    // ── Restrictions ─────────────────────────────────────────────

    pub async fn list_restrictions(&self, id: &str) -> PostfixResult<Vec<PostfixRestriction>> {
        RestrictionManager::list(self.client(id)?).await
    }

    pub async fn get_restrictions(
        &self,
        id: &str,
        stage: &RestrictionStage,
    ) -> PostfixResult<Vec<String>> {
        RestrictionManager::get(self.client(id)?, stage).await
    }

    pub async fn set_restrictions(
        &self,
        id: &str,
        stage: &RestrictionStage,
        restrictions: &[String],
    ) -> PostfixResult<()> {
        RestrictionManager::set(self.client(id)?, stage, restrictions).await
    }

    pub async fn add_restriction(
        &self,
        id: &str,
        stage: &RestrictionStage,
        restriction: &str,
        position: Option<u32>,
    ) -> PostfixResult<()> {
        RestrictionManager::add(self.client(id)?, stage, restriction, position).await
    }

    pub async fn remove_restriction(
        &self,
        id: &str,
        stage: &RestrictionStage,
        restriction: &str,
    ) -> PostfixResult<()> {
        RestrictionManager::remove(self.client(id)?, stage, restriction).await
    }

    // ── Milters ──────────────────────────────────────────────────

    pub async fn list_milters(&self, id: &str) -> PostfixResult<Vec<PostfixMilter>> {
        MilterManager::list(self.client(id)?).await
    }

    pub async fn add_milter(&self, id: &str, milter: &PostfixMilter) -> PostfixResult<()> {
        MilterManager::add(self.client(id)?, milter).await
    }

    pub async fn remove_milter(&self, id: &str, name: &str) -> PostfixResult<()> {
        MilterManager::remove(self.client(id)?, name).await
    }

    pub async fn update_milter(
        &self,
        id: &str,
        name: &str,
        milter: &PostfixMilter,
    ) -> PostfixResult<()> {
        MilterManager::update(self.client(id)?, name, milter).await
    }

    // ── Process ──────────────────────────────────────────────────

    pub async fn start(&self, id: &str) -> PostfixResult<()> {
        PostfixProcessManager::start(self.client(id)?).await
    }

    pub async fn stop(&self, id: &str) -> PostfixResult<()> {
        PostfixProcessManager::stop(self.client(id)?).await
    }

    pub async fn restart(&self, id: &str) -> PostfixResult<()> {
        PostfixProcessManager::restart(self.client(id)?).await
    }

    pub async fn reload(&self, id: &str) -> PostfixResult<()> {
        PostfixProcessManager::reload(self.client(id)?).await
    }

    pub async fn status(&self, id: &str) -> PostfixResult<String> {
        PostfixProcessManager::status(self.client(id)?).await
    }

    pub async fn version(&self, id: &str) -> PostfixResult<String> {
        PostfixProcessManager::version(self.client(id)?).await
    }

    pub async fn info(&self, id: &str) -> PostfixResult<PostfixInfo> {
        PostfixProcessManager::info(self.client(id)?).await
    }

    // ── Logs ─────────────────────────────────────────────────────

    pub async fn query_mail_log(
        &self,
        id: &str,
        lines: Option<u32>,
        filter: Option<String>,
    ) -> PostfixResult<Vec<PostfixMailLog>> {
        PostfixLogManager::query_mail_log(self.client(id)?, lines, filter.as_deref()).await
    }

    pub async fn list_log_files(&self, id: &str) -> PostfixResult<Vec<String>> {
        PostfixLogManager::list_log_files(self.client(id)?).await
    }

    pub async fn get_statistics(&self, id: &str) -> PostfixResult<MailStatistics> {
        PostfixLogManager::get_statistics(self.client(id)?).await
    }
}
