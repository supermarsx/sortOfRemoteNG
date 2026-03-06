// ── sorng-dovecot/src/service.rs ─────────────────────────────────────────────
//! Aggregate Dovecot façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::DovecotClient;
use crate::error::{DovecotError, DovecotResult};
use crate::types::*;

use crate::acl::AclManager;
use crate::config::DovecotConfigManager;
use crate::logs::DovecotLogManager;
use crate::mailboxes::MailboxManager;
use crate::process::DovecotProcessManager;
use crate::quota::QuotaManager;
use crate::replication::ReplicationManager;
use crate::sieve::SieveManager;
use crate::users::UserManager;

/// Shared Tauri state handle.
pub type DovecotServiceState = Arc<Mutex<DovecotServiceFacade>>;

/// Main Dovecot service managing connections.
pub struct DovecotServiceFacade {
    connections: HashMap<String, DovecotClient>,
}

impl DovecotServiceFacade {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: DovecotConnectionConfig,
    ) -> DovecotResult<DovecotConnectionSummary> {
        let client = DovecotClient::new(config)?;
        let ver = client.version().await.ok();

        // Try to get protocols and auth mechanisms
        let info = DovecotProcessManager::info(&client).await.ok();
        let summary = DovecotConnectionSummary {
            host: client.config.host.clone(),
            version: ver,
            protocols: info.as_ref().map(|i| i.protocols.clone()).unwrap_or_default(),
            auth_mechanisms: info
                .as_ref()
                .map(|i| i.auth_mechanisms.clone())
                .unwrap_or_default(),
            mail_location: None,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> DovecotResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| DovecotError::not_connected())
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> DovecotResult<&DovecotClient> {
        self.connections
            .get(id)
            .ok_or_else(|| DovecotError::not_connected())
    }

    pub async fn ping(&self, id: &str) -> DovecotResult<bool> {
        let client = self.client(id)?;
        let out = client.version().await;
        Ok(out.is_ok())
    }

    // ── Mailboxes ────────────────────────────────────────────────

    pub async fn list_mailboxes(
        &self,
        id: &str,
        user: &str,
    ) -> DovecotResult<Vec<DovecotMailbox>> {
        MailboxManager::list(self.client(id)?, user).await
    }

    pub async fn mailbox_status(
        &self,
        id: &str,
        user: &str,
        mailbox: &str,
    ) -> DovecotResult<DovecotMailboxStatus> {
        MailboxManager::status(self.client(id)?, user, mailbox).await
    }

    pub async fn create_mailbox(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> DovecotResult<()> {
        MailboxManager::create(self.client(id)?, user, name).await
    }

    pub async fn delete_mailbox(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> DovecotResult<()> {
        MailboxManager::delete(self.client(id)?, user, name).await
    }

    pub async fn rename_mailbox(
        &self,
        id: &str,
        user: &str,
        old_name: &str,
        new_name: &str,
    ) -> DovecotResult<()> {
        MailboxManager::rename(self.client(id)?, user, old_name, new_name).await
    }

    pub async fn subscribe_mailbox(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> DovecotResult<()> {
        MailboxManager::subscribe(self.client(id)?, user, name).await
    }

    pub async fn unsubscribe_mailbox(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> DovecotResult<()> {
        MailboxManager::unsubscribe(self.client(id)?, user, name).await
    }

    pub async fn list_subscriptions(
        &self,
        id: &str,
        user: &str,
    ) -> DovecotResult<Vec<String>> {
        MailboxManager::list_subscriptions(self.client(id)?, user).await
    }

    pub async fn sync_mailbox(&self, id: &str, user: &str) -> DovecotResult<()> {
        MailboxManager::sync(self.client(id)?, user).await
    }

    pub async fn force_resync(
        &self,
        id: &str,
        user: &str,
        mailbox: &str,
    ) -> DovecotResult<()> {
        MailboxManager::force_resync(self.client(id)?, user, mailbox).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> DovecotResult<Vec<DovecotUser>> {
        UserManager::list(self.client(id)?).await
    }

    pub async fn get_user(&self, id: &str, username: &str) -> DovecotResult<DovecotUser> {
        UserManager::get(self.client(id)?, username).await
    }

    pub async fn create_user(
        &self,
        id: &str,
        req: CreateUserRequest,
    ) -> DovecotResult<DovecotUser> {
        UserManager::create(self.client(id)?, &req).await
    }

    pub async fn update_user(
        &self,
        id: &str,
        username: &str,
        req: UpdateUserRequest,
    ) -> DovecotResult<DovecotUser> {
        UserManager::update(self.client(id)?, username, &req).await
    }

    pub async fn delete_user(&self, id: &str, username: &str) -> DovecotResult<()> {
        UserManager::delete(self.client(id)?, username).await
    }

    pub async fn auth_test(
        &self,
        id: &str,
        username: &str,
        password: &str,
    ) -> DovecotResult<bool> {
        UserManager::auth_test(self.client(id)?, username, password).await
    }

    pub async fn kick_user(&self, id: &str, username: &str) -> DovecotResult<()> {
        UserManager::kick(self.client(id)?, username).await
    }

    pub async fn who(&self, id: &str) -> DovecotResult<Vec<DovecotProcess>> {
        UserManager::who(self.client(id)?).await
    }

    // ── Sieve ────────────────────────────────────────────────────

    pub async fn list_sieve(
        &self,
        id: &str,
        user: &str,
    ) -> DovecotResult<Vec<DovecotSieveScript>> {
        SieveManager::list(self.client(id)?, user).await
    }

    pub async fn get_sieve(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> DovecotResult<DovecotSieveScript> {
        SieveManager::get(self.client(id)?, user, name).await
    }

    pub async fn create_sieve(
        &self,
        id: &str,
        user: &str,
        req: CreateSieveRequest,
    ) -> DovecotResult<DovecotSieveScript> {
        SieveManager::create(self.client(id)?, user, &req).await
    }

    pub async fn update_sieve(
        &self,
        id: &str,
        user: &str,
        name: &str,
        req: UpdateSieveRequest,
    ) -> DovecotResult<DovecotSieveScript> {
        SieveManager::update(self.client(id)?, user, name, &req).await
    }

    pub async fn delete_sieve(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> DovecotResult<()> {
        SieveManager::delete(self.client(id)?, user, name).await
    }

    pub async fn activate_sieve(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> DovecotResult<()> {
        SieveManager::activate(self.client(id)?, user, name).await
    }

    pub async fn deactivate_sieve(&self, id: &str, user: &str) -> DovecotResult<()> {
        SieveManager::deactivate(self.client(id)?, user).await
    }

    pub async fn compile_sieve(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> DovecotResult<ConfigTestResult> {
        SieveManager::compile(self.client(id)?, user, name).await
    }

    // ── Quota ────────────────────────────────────────────────────

    pub async fn get_quota(&self, id: &str, user: &str) -> DovecotResult<DovecotQuota> {
        QuotaManager::get(self.client(id)?, user).await
    }

    pub async fn set_quota(
        &self,
        id: &str,
        user: &str,
        rule: DovecotQuotaRule,
    ) -> DovecotResult<()> {
        QuotaManager::set(self.client(id)?, user, &rule).await
    }

    pub async fn recalculate_quota(&self, id: &str, user: &str) -> DovecotResult<()> {
        QuotaManager::recalculate(self.client(id)?, user).await
    }

    pub async fn list_quota_rules(
        &self,
        id: &str,
    ) -> DovecotResult<Vec<DovecotQuotaRule>> {
        QuotaManager::list_rules(self.client(id)?).await
    }

    pub async fn set_quota_rule(
        &self,
        id: &str,
        rule: DovecotQuotaRule,
    ) -> DovecotResult<()> {
        QuotaManager::set_rule(self.client(id)?, &rule).await
    }

    pub async fn delete_quota_rule(&self, id: &str, name: &str) -> DovecotResult<()> {
        QuotaManager::delete_rule(self.client(id)?, name).await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_config(
        &self,
        id: &str,
    ) -> DovecotResult<Vec<DovecotConfigParam>> {
        DovecotConfigManager::get_all(self.client(id)?).await
    }

    pub async fn get_config_param(&self, id: &str, name: &str) -> DovecotResult<String> {
        DovecotConfigManager::get_param(self.client(id)?, name).await
    }

    pub async fn set_config_param(
        &self,
        id: &str,
        name: &str,
        value: &str,
    ) -> DovecotResult<()> {
        DovecotConfigManager::set_param(self.client(id)?, name, value).await
    }

    pub async fn list_namespaces(
        &self,
        id: &str,
    ) -> DovecotResult<Vec<DovecotNamespace>> {
        DovecotConfigManager::list_namespaces(self.client(id)?).await
    }

    pub async fn get_namespace(
        &self,
        id: &str,
        name: &str,
    ) -> DovecotResult<DovecotNamespace> {
        DovecotConfigManager::get_namespace(self.client(id)?, name).await
    }

    pub async fn list_plugins(&self, id: &str) -> DovecotResult<Vec<DovecotPlugin>> {
        DovecotConfigManager::list_plugins(self.client(id)?).await
    }

    pub async fn enable_plugin(&self, id: &str, name: &str) -> DovecotResult<()> {
        DovecotConfigManager::enable_plugin(self.client(id)?, name).await
    }

    pub async fn disable_plugin(&self, id: &str, name: &str) -> DovecotResult<()> {
        DovecotConfigManager::disable_plugin(self.client(id)?, name).await
    }

    pub async fn configure_plugin(
        &self,
        id: &str,
        name: &str,
        settings: HashMap<String, String>,
    ) -> DovecotResult<()> {
        DovecotConfigManager::configure_plugin(self.client(id)?, name, &settings).await
    }

    pub async fn get_auth_config(&self, id: &str) -> DovecotResult<DovecotAuthConfig> {
        DovecotConfigManager::list_auth_config(self.client(id)?).await
    }

    pub async fn list_services(&self, id: &str) -> DovecotResult<Vec<DovecotService>> {
        DovecotConfigManager::list_services(self.client(id)?).await
    }

    pub async fn test_config(&self, id: &str) -> DovecotResult<ConfigTestResult> {
        DovecotConfigManager::test_config(self.client(id)?).await
    }

    // ── ACL ──────────────────────────────────────────────────────

    pub async fn list_acls(
        &self,
        id: &str,
        user: &str,
        mailbox: &str,
    ) -> DovecotResult<Vec<DovecotAcl>> {
        AclManager::list(self.client(id)?, user, mailbox).await
    }

    pub async fn get_acl(
        &self,
        id: &str,
        user: &str,
        mailbox: &str,
        identifier: &str,
    ) -> DovecotResult<DovecotAcl> {
        AclManager::get(self.client(id)?, user, mailbox, identifier).await
    }

    pub async fn set_acl(
        &self,
        id: &str,
        user: &str,
        mailbox: &str,
        identifier: &str,
        rights: Vec<String>,
    ) -> DovecotResult<()> {
        AclManager::set(self.client(id)?, user, mailbox, identifier, &rights).await
    }

    pub async fn delete_acl(
        &self,
        id: &str,
        user: &str,
        mailbox: &str,
        identifier: &str,
    ) -> DovecotResult<()> {
        AclManager::delete(self.client(id)?, user, mailbox, identifier).await
    }

    // ── Replication ──────────────────────────────────────────────

    pub async fn replication_status(
        &self,
        id: &str,
    ) -> DovecotResult<Vec<DovecotReplication>> {
        ReplicationManager::status(self.client(id)?).await
    }

    pub async fn replicate_user(
        &self,
        id: &str,
        user: &str,
        priority: &str,
    ) -> DovecotResult<()> {
        ReplicationManager::replicate_user(self.client(id)?, user, priority).await
    }

    pub async fn dsync_backup(
        &self,
        id: &str,
        user: &str,
        remote: &str,
    ) -> DovecotResult<()> {
        ReplicationManager::dsync_backup(self.client(id)?, user, remote).await
    }

    pub async fn dsync_mirror(
        &self,
        id: &str,
        user: &str,
        remote: &str,
    ) -> DovecotResult<()> {
        ReplicationManager::dsync_mirror(self.client(id)?, user, remote).await
    }

    // ── Process ──────────────────────────────────────────────────

    pub async fn start(&self, id: &str) -> DovecotResult<()> {
        DovecotProcessManager::start(self.client(id)?).await
    }

    pub async fn stop(&self, id: &str) -> DovecotResult<()> {
        DovecotProcessManager::stop(self.client(id)?).await
    }

    pub async fn restart(&self, id: &str) -> DovecotResult<()> {
        DovecotProcessManager::restart(self.client(id)?).await
    }

    pub async fn reload(&self, id: &str) -> DovecotResult<()> {
        DovecotProcessManager::reload(self.client(id)?).await
    }

    pub async fn status(&self, id: &str) -> DovecotResult<String> {
        DovecotProcessManager::status(self.client(id)?).await
    }

    pub async fn version(&self, id: &str) -> DovecotResult<String> {
        DovecotProcessManager::version(self.client(id)?).await
    }

    pub async fn info(&self, id: &str) -> DovecotResult<DovecotInfo> {
        DovecotProcessManager::info(self.client(id)?).await
    }

    pub async fn process_who(&self, id: &str) -> DovecotResult<Vec<DovecotProcess>> {
        DovecotProcessManager::who(self.client(id)?).await
    }

    pub async fn process_stats(&self, id: &str) -> DovecotResult<Vec<DovecotStats>> {
        DovecotProcessManager::stats(self.client(id)?).await
    }

    pub async fn process_test_config(
        &self,
        id: &str,
    ) -> DovecotResult<ConfigTestResult> {
        DovecotProcessManager::test_config(self.client(id)?).await
    }

    // ── Logs ─────────────────────────────────────────────────────

    pub async fn query_log(
        &self,
        id: &str,
        lines: Option<u32>,
        filter: Option<String>,
    ) -> DovecotResult<Vec<DovecotLog>> {
        DovecotLogManager::query_log(self.client(id)?, lines, filter.as_deref()).await
    }

    pub async fn list_log_files(&self, id: &str) -> DovecotResult<Vec<String>> {
        DovecotLogManager::list_log_files(self.client(id)?).await
    }

    pub async fn set_log_level(&self, id: &str, level: &str) -> DovecotResult<()> {
        DovecotLogManager::set_log_level(self.client(id)?, level).await
    }

    pub async fn get_log_level(&self, id: &str) -> DovecotResult<String> {
        DovecotLogManager::get_log_level(self.client(id)?).await
    }
}
