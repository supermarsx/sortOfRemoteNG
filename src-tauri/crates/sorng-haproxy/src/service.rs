// ── sorng-haproxy/src/service.rs ─────────────────────────────────────────────
//! Aggregate HAProxy façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::HaproxyClient;
use crate::error::{HaproxyError, HaproxyResult};
use crate::types::*;

use crate::acls::AclManager;
use crate::backends::BackendManager;
use crate::config::HaproxyConfigManager;
use crate::frontends::FrontendManager;
use crate::maps::MapManager;
use crate::runtime::RuntimeManager;
use crate::servers::ServerManager;
use crate::stats::StatsManager;
use crate::stick_tables::StickTableManager;

/// Shared Tauri state handle.
pub type HaproxyServiceState = Arc<Mutex<HaproxyService>>;

/// Main HAProxy service managing connections.
pub struct HaproxyService {
    connections: HashMap<String, HaproxyClient>,
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use crate::error::HaproxyErrorKind;

    fn config() -> HaproxyConnectionConfig {
        HaproxyConnectionConfig {
            host: "haproxy.example.test".into(),
            port: Some(22),
            ssh_user: Some("admin".into()),
            ssh_password: None,
            ssh_key: None,
            stats_socket: Some("/run/haproxy/admin.sock".into()),
            stats_url: None,
            stats_user: None,
            stats_password: None,
            dataplane_url: None,
            dataplane_user: None,
            dataplane_password: None,
            config_path: None,
            timeout_secs: Some(5),
            proxy_url: None,
        }
    }

    #[tokio::test]
    async fn duplicate_connection_id_is_rejected_before_remote_probe() {
        let mut service = HaproxyService::new();
        service
            .connections
            .insert("duplicate".into(), HaproxyClient::new(config()).unwrap());

        let error = service
            .connect("duplicate".into(), config())
            .await
            .unwrap_err();

        assert!(matches!(error.kind, HaproxyErrorKind::AlreadyConnected));
    }
}

impl Default for HaproxyService {
    fn default() -> Self {
        Self::new()
    }
}

impl HaproxyService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: HaproxyConnectionConfig,
    ) -> HaproxyResult<HaproxyConnectionSummary> {
        if self.connections.contains_key(&id) {
            return Err(HaproxyError::already_connected(&id));
        }
        let client = HaproxyClient::new(config)?;
        client.exec_ssh("true").await?;
        let mut summary = client.ping().await?;
        let ssh_version = client.version().await?;
        if summary.version.is_none() {
            summary.version = Some(ssh_version);
        }
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub async fn disconnect(&mut self, id: &str) -> HaproxyResult<()> {
        let client = self
            .connections
            .get(id)
            .ok_or_else(|| HaproxyError::not_connected(format!("No connection '{}'", id)))?;
        client.disconnect().await?;
        self.connections.remove(id);
        Ok(())
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> HaproxyResult<&HaproxyClient> {
        self.connections
            .get(id)
            .ok_or_else(|| HaproxyError::not_connected(format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> HaproxyResult<HaproxyConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Stats ────────────────────────────────────────────────────

    pub async fn get_info(&self, id: &str) -> HaproxyResult<HaproxyInfo> {
        StatsManager::get_info(self.client(id)?).await
    }

    pub async fn get_csv(&self, id: &str) -> HaproxyResult<String> {
        StatsManager::get_csv(self.client(id)?).await
    }

    // ── Frontends ────────────────────────────────────────────────

    pub async fn list_frontends(&self, id: &str) -> HaproxyResult<Vec<HaproxyFrontend>> {
        FrontendManager::list(self.client(id)?).await
    }

    pub async fn get_frontend(&self, id: &str, name: &str) -> HaproxyResult<HaproxyFrontend> {
        FrontendManager::get(self.client(id)?, name).await
    }

    // ── Backends ─────────────────────────────────────────────────

    pub async fn list_backends(&self, id: &str) -> HaproxyResult<Vec<HaproxyBackend>> {
        BackendManager::list(self.client(id)?).await
    }

    pub async fn get_backend(&self, id: &str, name: &str) -> HaproxyResult<HaproxyBackend> {
        BackendManager::get(self.client(id)?, name).await
    }

    // ── Servers ──────────────────────────────────────────────────

    pub async fn list_servers(&self, id: &str, backend: &str) -> HaproxyResult<Vec<HaproxyServer>> {
        ServerManager::list(self.client(id)?, backend).await
    }

    pub async fn get_server(
        &self,
        id: &str,
        backend: &str,
        server: &str,
    ) -> HaproxyResult<HaproxyServer> {
        ServerManager::get(self.client(id)?, backend, server).await
    }

    pub async fn set_server_state(
        &self,
        id: &str,
        backend: &str,
        server: &str,
        action: ServerAction,
    ) -> HaproxyResult<String> {
        ServerManager::set_state(self.client(id)?, backend, server, &action).await
    }

    // ── ACLs ─────────────────────────────────────────────────────

    pub async fn list_acls(&self, id: &str) -> HaproxyResult<Vec<HaproxyAcl>> {
        AclManager::list(self.client(id)?).await
    }

    pub async fn get_acl(&self, id: &str, acl_id: &str) -> HaproxyResult<Vec<AclEntry>> {
        AclManager::get(self.client(id)?, acl_id).await
    }

    pub async fn add_acl_entry(
        &self,
        id: &str,
        acl_id: &str,
        value: &str,
    ) -> HaproxyResult<String> {
        AclManager::add_entry(self.client(id)?, acl_id, value).await
    }

    pub async fn del_acl_entry(
        &self,
        id: &str,
        acl_id: &str,
        value: &str,
    ) -> HaproxyResult<String> {
        AclManager::del_entry(self.client(id)?, acl_id, value).await
    }

    pub async fn clear_acl(&self, id: &str, acl_id: &str) -> HaproxyResult<String> {
        AclManager::clear(self.client(id)?, acl_id).await
    }

    // ── Maps ─────────────────────────────────────────────────────

    pub async fn list_maps(&self, id: &str) -> HaproxyResult<Vec<HaproxyMap>> {
        MapManager::list(self.client(id)?).await
    }

    pub async fn get_map(&self, id: &str, map_id: &str) -> HaproxyResult<Vec<MapEntry>> {
        MapManager::get(self.client(id)?, map_id).await
    }

    pub async fn add_map_entry(
        &self,
        id: &str,
        map_id: &str,
        key: &str,
        value: &str,
    ) -> HaproxyResult<String> {
        MapManager::add_entry(self.client(id)?, map_id, key, value).await
    }

    pub async fn del_map_entry(&self, id: &str, map_id: &str, key: &str) -> HaproxyResult<String> {
        MapManager::del_entry(self.client(id)?, map_id, key).await
    }

    pub async fn set_map_entry(
        &self,
        id: &str,
        map_id: &str,
        key: &str,
        value: &str,
    ) -> HaproxyResult<String> {
        MapManager::set_entry(self.client(id)?, map_id, key, value).await
    }

    pub async fn clear_map(&self, id: &str, map_id: &str) -> HaproxyResult<String> {
        MapManager::clear(self.client(id)?, map_id).await
    }

    // ── Stick Tables ─────────────────────────────────────────────

    pub async fn list_stick_tables(&self, id: &str) -> HaproxyResult<Vec<StickTable>> {
        StickTableManager::list(self.client(id)?).await
    }

    pub async fn get_stick_table(
        &self,
        id: &str,
        name: &str,
    ) -> HaproxyResult<Vec<StickTableEntry>> {
        StickTableManager::get(self.client(id)?, name).await
    }

    pub async fn clear_stick_table(&self, id: &str, name: &str) -> HaproxyResult<String> {
        StickTableManager::clear(self.client(id)?, name).await
    }

    pub async fn set_stick_table_entry(
        &self,
        id: &str,
        name: &str,
        key: &str,
        data: &str,
    ) -> HaproxyResult<String> {
        StickTableManager::set_entry(self.client(id)?, name, key, data).await
    }

    // ── Runtime ──────────────────────────────────────────────────

    pub async fn runtime_execute(&self, id: &str, command: &str) -> HaproxyResult<String> {
        RuntimeManager::execute(self.client(id)?, command).await
    }

    pub async fn show_servers_state(&self, id: &str) -> HaproxyResult<String> {
        RuntimeManager::show_servers_state(self.client(id)?).await
    }

    pub async fn show_sessions(&self, id: &str) -> HaproxyResult<Vec<SessionEntry>> {
        RuntimeManager::show_sessions(self.client(id)?).await
    }

    pub async fn show_backend_list(&self, id: &str) -> HaproxyResult<Vec<String>> {
        RuntimeManager::show_backend_list(self.client(id)?).await
    }

    // ── Config ───────────────────────────────────────────────────

    pub async fn get_raw_config(&self, id: &str) -> HaproxyResult<String> {
        HaproxyConfigManager::get_raw(self.client(id)?).await
    }

    pub async fn update_raw_config(&self, id: &str, content: String) -> HaproxyResult<()> {
        HaproxyConfigManager::update_raw(self.client(id)?, &content).await
    }

    pub async fn validate_config(&self, id: &str) -> HaproxyResult<ConfigValidationResult> {
        HaproxyConfigManager::validate(self.client(id)?).await
    }

    pub async fn reload_config(&self, id: &str) -> HaproxyResult<()> {
        HaproxyConfigManager::reload(self.client(id)?).await
    }

    pub async fn start(&self, id: &str) -> HaproxyResult<()> {
        HaproxyConfigManager::start(self.client(id)?).await
    }

    pub async fn stop(&self, id: &str) -> HaproxyResult<()> {
        HaproxyConfigManager::stop(self.client(id)?).await
    }

    pub async fn restart(&self, id: &str) -> HaproxyResult<()> {
        HaproxyConfigManager::restart(self.client(id)?).await
    }

    pub async fn version(&self, id: &str) -> HaproxyResult<String> {
        HaproxyConfigManager::version(self.client(id)?).await
    }
}
