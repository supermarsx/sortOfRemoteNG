// ── sorng-roundcube/src/service.rs ─────────────────────────────────────────────
//! Aggregate Roundcube façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::RoundcubeClient;
use crate::error::{RoundcubeError, RoundcubeResult};
use crate::types::*;

use crate::address_books::AddressBookManager;
use crate::filters::FilterManager;
use crate::folders::FolderManager;
use crate::identities::IdentityManager;
use crate::maintenance::MaintenanceManager;
use crate::plugins::PluginManager;
use crate::settings::SettingsManager;
use crate::users::UserManager;

/// Shared Tauri state handle.
pub type RoundcubeServiceState = Arc<Mutex<RoundcubeService>>;

/// Main Roundcube service managing connections.
pub struct RoundcubeService {
    connections: HashMap<String, RoundcubeClient>,
}

impl Default for RoundcubeService {
    fn default() -> Self {
        Self::new()
    }
}

impl RoundcubeService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: RoundcubeConnectionConfig,
    ) -> RoundcubeResult<RoundcubeConnectionSummary> {
        let client = RoundcubeClient::new(config)?;
        client.login().await?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> RoundcubeResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| RoundcubeError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> RoundcubeResult<&RoundcubeClient> {
        self.connections
            .get(id)
            .ok_or_else(|| RoundcubeError::not_connected(format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> RoundcubeResult<RoundcubeConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> RoundcubeResult<Vec<RoundcubeUser>> {
        UserManager::list(self.client(id)?).await
    }

    pub async fn get_user(&self, id: &str, user_id: &str) -> RoundcubeResult<RoundcubeUser> {
        UserManager::get(self.client(id)?, user_id).await
    }

    pub async fn create_user(
        &self,
        id: &str,
        req: &CreateUserRequest,
    ) -> RoundcubeResult<RoundcubeUser> {
        UserManager::create(self.client(id)?, req).await
    }

    pub async fn update_user(
        &self,
        id: &str,
        user_id: &str,
        req: &UpdateUserRequest,
    ) -> RoundcubeResult<RoundcubeUser> {
        UserManager::update(self.client(id)?, user_id, req).await
    }

    pub async fn delete_user(&self, id: &str, user_id: &str) -> RoundcubeResult<()> {
        UserManager::delete(self.client(id)?, user_id).await
    }

    pub async fn get_user_preferences(
        &self,
        id: &str,
        user_id: &str,
    ) -> RoundcubeResult<RoundcubeUserPreferences> {
        UserManager::get_preferences(self.client(id)?, user_id).await
    }

    pub async fn update_user_preferences(
        &self,
        id: &str,
        user_id: &str,
        prefs: &RoundcubeUserPreferences,
    ) -> RoundcubeResult<RoundcubeUserPreferences> {
        UserManager::update_preferences(self.client(id)?, user_id, prefs).await
    }

    // ── Identities ───────────────────────────────────────────────

    pub async fn list_identities(
        &self,
        id: &str,
        user_id: &str,
    ) -> RoundcubeResult<Vec<RoundcubeIdentity>> {
        IdentityManager::list(self.client(id)?, user_id).await
    }

    pub async fn get_identity(
        &self,
        id: &str,
        user_id: &str,
        identity_id: &str,
    ) -> RoundcubeResult<RoundcubeIdentity> {
        IdentityManager::get(self.client(id)?, user_id, identity_id).await
    }

    pub async fn create_identity(
        &self,
        id: &str,
        user_id: &str,
        req: &CreateIdentityRequest,
    ) -> RoundcubeResult<RoundcubeIdentity> {
        IdentityManager::create(self.client(id)?, user_id, req).await
    }

    pub async fn update_identity(
        &self,
        id: &str,
        user_id: &str,
        identity_id: &str,
        req: &UpdateIdentityRequest,
    ) -> RoundcubeResult<RoundcubeIdentity> {
        IdentityManager::update(self.client(id)?, user_id, identity_id, req).await
    }

    pub async fn delete_identity(
        &self,
        id: &str,
        user_id: &str,
        identity_id: &str,
    ) -> RoundcubeResult<()> {
        IdentityManager::delete(self.client(id)?, user_id, identity_id).await
    }

    pub async fn set_default_identity(
        &self,
        id: &str,
        user_id: &str,
        identity_id: &str,
    ) -> RoundcubeResult<()> {
        IdentityManager::set_default(self.client(id)?, user_id, identity_id).await
    }

    // ── Address Books ────────────────────────────────────────────

    pub async fn list_address_books(&self, id: &str) -> RoundcubeResult<Vec<RoundcubeAddressBook>> {
        AddressBookManager::list(self.client(id)?).await
    }

    pub async fn get_address_book(
        &self,
        id: &str,
        book_id: &str,
    ) -> RoundcubeResult<RoundcubeAddressBook> {
        AddressBookManager::get(self.client(id)?, book_id).await
    }

    pub async fn list_contacts(
        &self,
        id: &str,
        book_id: &str,
    ) -> RoundcubeResult<Vec<RoundcubeContact>> {
        AddressBookManager::list_contacts(self.client(id)?, book_id).await
    }

    pub async fn get_contact(
        &self,
        id: &str,
        book_id: &str,
        contact_id: &str,
    ) -> RoundcubeResult<RoundcubeContact> {
        AddressBookManager::get_contact(self.client(id)?, book_id, contact_id).await
    }

    pub async fn create_contact(
        &self,
        id: &str,
        book_id: &str,
        req: &CreateContactRequest,
    ) -> RoundcubeResult<RoundcubeContact> {
        AddressBookManager::create_contact(self.client(id)?, book_id, req).await
    }

    pub async fn update_contact(
        &self,
        id: &str,
        book_id: &str,
        contact_id: &str,
        req: &UpdateContactRequest,
    ) -> RoundcubeResult<RoundcubeContact> {
        AddressBookManager::update_contact(self.client(id)?, book_id, contact_id, req).await
    }

    pub async fn delete_contact(
        &self,
        id: &str,
        book_id: &str,
        contact_id: &str,
    ) -> RoundcubeResult<()> {
        AddressBookManager::delete_contact(self.client(id)?, book_id, contact_id).await
    }

    pub async fn search_contacts(
        &self,
        id: &str,
        book_id: &str,
        query: &str,
    ) -> RoundcubeResult<Vec<RoundcubeContact>> {
        AddressBookManager::search_contacts(self.client(id)?, book_id, query).await
    }

    pub async fn export_vcard(
        &self,
        id: &str,
        book_id: &str,
        contact_id: &str,
    ) -> RoundcubeResult<String> {
        AddressBookManager::export_vcard(self.client(id)?, book_id, contact_id).await
    }

    // ── Folders ──────────────────────────────────────────────────

    pub async fn list_folders(&self, id: &str) -> RoundcubeResult<Vec<RoundcubeFolder>> {
        FolderManager::list(self.client(id)?).await
    }

    pub async fn get_folder(&self, id: &str, name: &str) -> RoundcubeResult<RoundcubeFolder> {
        FolderManager::get(self.client(id)?, name).await
    }

    pub async fn create_folder(&self, id: &str, req: &CreateFolderRequest) -> RoundcubeResult<()> {
        FolderManager::create(self.client(id)?, req).await
    }

    pub async fn rename_folder(&self, id: &str, req: &RenameFolderRequest) -> RoundcubeResult<()> {
        FolderManager::rename(self.client(id)?, req).await
    }

    pub async fn delete_folder(&self, id: &str, name: &str) -> RoundcubeResult<()> {
        FolderManager::delete(self.client(id)?, name).await
    }

    pub async fn subscribe_folder(&self, id: &str, name: &str) -> RoundcubeResult<()> {
        FolderManager::subscribe(self.client(id)?, name).await
    }

    pub async fn unsubscribe_folder(&self, id: &str, name: &str) -> RoundcubeResult<()> {
        FolderManager::unsubscribe(self.client(id)?, name).await
    }

    pub async fn purge_folder(&self, id: &str, name: &str) -> RoundcubeResult<()> {
        FolderManager::purge(self.client(id)?, name).await
    }

    pub async fn get_quota(&self, id: &str) -> RoundcubeResult<RoundcubeQuota> {
        FolderManager::get_quota(self.client(id)?).await
    }

    // ── Filters ──────────────────────────────────────────────────

    pub async fn list_filters(&self, id: &str) -> RoundcubeResult<Vec<RoundcubeFilter>> {
        FilterManager::list(self.client(id)?).await
    }

    pub async fn get_filter(&self, id: &str, filter_id: &str) -> RoundcubeResult<RoundcubeFilter> {
        FilterManager::get(self.client(id)?, filter_id).await
    }

    pub async fn create_filter(
        &self,
        id: &str,
        req: &CreateFilterRequest,
    ) -> RoundcubeResult<RoundcubeFilter> {
        FilterManager::create(self.client(id)?, req).await
    }

    pub async fn update_filter(
        &self,
        id: &str,
        filter_id: &str,
        req: &UpdateFilterRequest,
    ) -> RoundcubeResult<RoundcubeFilter> {
        FilterManager::update(self.client(id)?, filter_id, req).await
    }

    pub async fn delete_filter(&self, id: &str, filter_id: &str) -> RoundcubeResult<()> {
        FilterManager::delete(self.client(id)?, filter_id).await
    }

    pub async fn enable_filter(&self, id: &str, filter_id: &str) -> RoundcubeResult<()> {
        FilterManager::enable(self.client(id)?, filter_id).await
    }

    pub async fn disable_filter(&self, id: &str, filter_id: &str) -> RoundcubeResult<()> {
        FilterManager::disable(self.client(id)?, filter_id).await
    }

    pub async fn reorder_filters(&self, id: &str, ids: &[String]) -> RoundcubeResult<()> {
        FilterManager::reorder(self.client(id)?, ids).await
    }

    // ── Plugins ──────────────────────────────────────────────────

    pub async fn list_plugins(&self, id: &str) -> RoundcubeResult<Vec<RoundcubePlugin>> {
        PluginManager::list(self.client(id)?).await
    }

    pub async fn get_plugin(&self, id: &str, name: &str) -> RoundcubeResult<RoundcubePlugin> {
        PluginManager::get(self.client(id)?, name).await
    }

    pub async fn enable_plugin(&self, id: &str, name: &str) -> RoundcubeResult<()> {
        PluginManager::enable(self.client(id)?, name).await
    }

    pub async fn disable_plugin(&self, id: &str, name: &str) -> RoundcubeResult<()> {
        PluginManager::disable(self.client(id)?, name).await
    }

    pub async fn get_plugin_config(
        &self,
        id: &str,
        name: &str,
    ) -> RoundcubeResult<RoundcubePluginConfig> {
        PluginManager::get_config(self.client(id)?, name).await
    }

    pub async fn update_plugin_config(
        &self,
        id: &str,
        name: &str,
        settings: &std::collections::HashMap<String, serde_json::Value>,
    ) -> RoundcubeResult<()> {
        PluginManager::update_config(self.client(id)?, name, settings).await
    }

    // ── Settings ─────────────────────────────────────────────────

    pub async fn get_system_config(&self, id: &str) -> RoundcubeResult<RoundcubeSystemConfig> {
        SettingsManager::get_system_config(self.client(id)?).await
    }

    pub async fn update_system_config(
        &self,
        id: &str,
        config: &RoundcubeSystemConfig,
    ) -> RoundcubeResult<RoundcubeSystemConfig> {
        SettingsManager::update_system_config(self.client(id)?, config).await
    }

    pub async fn get_smtp_config(&self, id: &str) -> RoundcubeResult<RoundcubeSmtpConfig> {
        SettingsManager::get_smtp_config(self.client(id)?).await
    }

    pub async fn update_smtp_config(
        &self,
        id: &str,
        config: &RoundcubeSmtpConfig,
    ) -> RoundcubeResult<RoundcubeSmtpConfig> {
        SettingsManager::update_smtp_config(self.client(id)?, config).await
    }

    pub async fn get_cache_stats(&self, id: &str) -> RoundcubeResult<RoundcubeCacheStats> {
        SettingsManager::get_cache_stats(self.client(id)?).await
    }

    pub async fn clear_cache(&self, id: &str) -> RoundcubeResult<()> {
        SettingsManager::clear_cache(self.client(id)?).await
    }

    pub async fn get_logs(
        &self,
        id: &str,
        limit: Option<u64>,
        level: Option<&str>,
    ) -> RoundcubeResult<Vec<RoundcubeLogEntry>> {
        SettingsManager::get_logs(self.client(id)?, limit, level).await
    }

    // ── Maintenance ──────────────────────────────────────────────

    pub async fn vacuum_db(&self, id: &str) -> RoundcubeResult<()> {
        MaintenanceManager::vacuum_db(self.client(id)?).await
    }

    pub async fn optimize_db(&self, id: &str) -> RoundcubeResult<()> {
        MaintenanceManager::optimize_db(self.client(id)?).await
    }

    pub async fn clear_temp_files(&self, id: &str) -> RoundcubeResult<()> {
        MaintenanceManager::clear_temp_files(self.client(id)?).await
    }

    pub async fn clear_expired_sessions(&self, id: &str) -> RoundcubeResult<()> {
        MaintenanceManager::clear_expired_sessions(self.client(id)?).await
    }

    pub async fn get_db_stats(&self, id: &str) -> RoundcubeResult<RoundcubeDbStats> {
        MaintenanceManager::get_db_stats(self.client(id)?).await
    }

    pub async fn test_smtp(&self, id: &str, to: &str) -> RoundcubeResult<bool> {
        MaintenanceManager::test_smtp(self.client(id)?, to).await
    }

    pub async fn test_imap(
        &self,
        id: &str,
        host: &str,
        user: &str,
        pass: &str,
    ) -> RoundcubeResult<bool> {
        MaintenanceManager::test_imap(self.client(id)?, host, user, pass).await
    }
}
