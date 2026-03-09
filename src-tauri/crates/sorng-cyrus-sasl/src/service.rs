// ── sorng-cyrus-sasl/src/service.rs ──────────────────────────────────────────
//! Aggregate Cyrus SASL façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::CyrusSaslClient;
use crate::error::{CyrusSaslError, CyrusSaslResult};
use crate::types::*;

use crate::app_config::AppConfigManager;
use crate::auxprop::AuxpropManager;
use crate::mechanisms::MechanismManager;
use crate::process::CyrusSaslProcessManager;
use crate::saslauthd::SaslauthdManager;
use crate::sasldb::SaslDbManager;
use crate::users::SaslUserManager;

/// Shared Tauri state handle.
pub type CyrusSaslServiceState = Arc<Mutex<CyrusSaslService>>;

/// Main Cyrus SASL service managing connections.
pub struct CyrusSaslService {
    connections: HashMap<String, CyrusSaslClient>,
}

impl Default for CyrusSaslService {
    fn default() -> Self {
        Self::new()
    }
}

impl CyrusSaslService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: CyrusSaslConnectionConfig,
    ) -> CyrusSaslResult<CyrusSaslConnectionSummary> {
        let client = CyrusSaslClient::new(config)?;
        let ver = client.version().await.ok();
        let mechs = client.list_mechanisms().await.unwrap_or_default();
        let status = client.saslauthd_status().await;
        let running = status.as_ref().map(|s| s.running).unwrap_or(false);

        let summary = CyrusSaslConnectionSummary {
            host: client.config.host.clone(),
            version: ver,
            mechanisms: mechs,
            saslauthd_running: running,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> CyrusSaslResult<()> {
        self.connections.remove(id).map(|_| ()).ok_or_else(|| {
            CyrusSaslError::new(
                crate::error::CyrusSaslErrorKind::NotConnected,
                format!("No connection '{}'", id),
            )
        })
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> CyrusSaslResult<&CyrusSaslClient> {
        self.connections.get(id).ok_or_else(|| {
            CyrusSaslError::new(
                crate::error::CyrusSaslErrorKind::NotConnected,
                format!("No connection '{}'", id),
            )
        })
    }

    /// Ping a connection by checking saslauthd status.
    pub async fn ping(&self, id: &str) -> CyrusSaslResult<bool> {
        let client = self.client(id)?;
        let status = client.saslauthd_status().await;
        Ok(status.is_ok())
    }

    // ── Mechanisms ───────────────────────────────────────────────

    pub async fn list_mechanisms(&self, id: &str) -> CyrusSaslResult<Vec<SaslMechanism>> {
        MechanismManager::list(self.client(id)?).await
    }

    pub async fn get_mechanism(&self, id: &str, name: &str) -> CyrusSaslResult<SaslMechanism> {
        MechanismManager::get(self.client(id)?, name).await
    }

    pub async fn list_available_mechanisms(&self, id: &str) -> CyrusSaslResult<Vec<SaslMechanism>> {
        MechanismManager::list_available(self.client(id)?).await
    }

    pub async fn list_enabled_mechanisms(&self, id: &str) -> CyrusSaslResult<Vec<String>> {
        MechanismManager::list_enabled(self.client(id)?).await
    }

    pub async fn enable_mechanism(&self, id: &str, name: &str) -> CyrusSaslResult<()> {
        MechanismManager::enable(self.client(id)?, name).await
    }

    pub async fn disable_mechanism(&self, id: &str, name: &str) -> CyrusSaslResult<()> {
        MechanismManager::disable(self.client(id)?, name).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> CyrusSaslResult<Vec<SaslUser>> {
        SaslUserManager::list(self.client(id)?).await
    }

    pub async fn get_user(
        &self,
        id: &str,
        username: &str,
        realm: &str,
    ) -> CyrusSaslResult<SaslUser> {
        SaslUserManager::get(self.client(id)?, username, realm).await
    }

    pub async fn create_user(&self, id: &str, req: CreateSaslUserRequest) -> CyrusSaslResult<()> {
        SaslUserManager::create(self.client(id)?, &req).await
    }

    pub async fn update_user(
        &self,
        id: &str,
        username: &str,
        realm: &str,
        req: UpdateSaslUserRequest,
    ) -> CyrusSaslResult<()> {
        SaslUserManager::update(self.client(id)?, username, realm, &req).await
    }

    pub async fn delete_user(&self, id: &str, username: &str, realm: &str) -> CyrusSaslResult<()> {
        SaslUserManager::delete(self.client(id)?, username, realm).await
    }

    pub async fn test_auth(
        &self,
        id: &str,
        username: &str,
        realm: &str,
        password: &str,
    ) -> CyrusSaslResult<SaslTestResult> {
        SaslUserManager::test_auth(self.client(id)?, username, realm, password).await
    }

    pub async fn list_realms(&self, id: &str) -> CyrusSaslResult<Vec<String>> {
        SaslUserManager::list_realms(self.client(id)?).await
    }

    // ── Saslauthd ────────────────────────────────────────────────

    pub async fn get_saslauthd_config(&self, id: &str) -> CyrusSaslResult<SaslauthConfig> {
        SaslauthdManager::get_config(self.client(id)?).await
    }

    pub async fn set_saslauthd_config(
        &self,
        id: &str,
        config: SaslauthConfig,
    ) -> CyrusSaslResult<()> {
        SaslauthdManager::set_config(self.client(id)?, &config).await
    }

    pub async fn get_saslauthd_status(&self, id: &str) -> CyrusSaslResult<SaslauthStatus> {
        SaslauthdManager::get_status(self.client(id)?).await
    }

    pub async fn start_saslauthd(&self, id: &str) -> CyrusSaslResult<()> {
        SaslauthdManager::start(self.client(id)?).await
    }

    pub async fn stop_saslauthd(&self, id: &str) -> CyrusSaslResult<()> {
        SaslauthdManager::stop(self.client(id)?).await
    }

    pub async fn restart_saslauthd(&self, id: &str) -> CyrusSaslResult<()> {
        SaslauthdManager::restart(self.client(id)?).await
    }

    pub async fn set_saslauthd_mechanism(&self, id: &str, mech: &str) -> CyrusSaslResult<()> {
        SaslauthdManager::set_mechanism(self.client(id)?, mech).await
    }

    pub async fn set_saslauthd_flags(&self, id: &str, flags: Vec<String>) -> CyrusSaslResult<()> {
        SaslauthdManager::set_flags(self.client(id)?, flags).await
    }

    pub async fn test_saslauthd_auth(
        &self,
        id: &str,
        username: &str,
        password: &str,
        service: &str,
        realm: &str,
    ) -> CyrusSaslResult<SaslTestResult> {
        SaslauthdManager::test_auth(self.client(id)?, username, password, service, realm).await
    }

    // ── App Config ───────────────────────────────────────────────

    pub async fn list_apps(&self, id: &str) -> CyrusSaslResult<Vec<String>> {
        AppConfigManager::list_apps(self.client(id)?).await
    }

    pub async fn get_app_config(&self, id: &str, app_name: &str) -> CyrusSaslResult<SaslAppConfig> {
        AppConfigManager::get_app_config(self.client(id)?, app_name).await
    }

    pub async fn set_app_config(
        &self,
        id: &str,
        app_name: &str,
        config: SaslAppConfig,
    ) -> CyrusSaslResult<()> {
        AppConfigManager::set_app_config(self.client(id)?, app_name, &config).await
    }

    pub async fn delete_app_config(&self, id: &str, app_name: &str) -> CyrusSaslResult<()> {
        AppConfigManager::delete_app_config(self.client(id)?, app_name).await
    }

    pub async fn get_app_param(
        &self,
        id: &str,
        app_name: &str,
        key: &str,
    ) -> CyrusSaslResult<String> {
        AppConfigManager::get_param(self.client(id)?, app_name, key).await
    }

    pub async fn set_app_param(
        &self,
        id: &str,
        app_name: &str,
        key: &str,
        value: &str,
    ) -> CyrusSaslResult<()> {
        AppConfigManager::set_param(self.client(id)?, app_name, key, value).await
    }

    pub async fn delete_app_param(
        &self,
        id: &str,
        app_name: &str,
        key: &str,
    ) -> CyrusSaslResult<()> {
        AppConfigManager::delete_param(self.client(id)?, app_name, key).await
    }

    // ── Auxprop ──────────────────────────────────────────────────

    pub async fn list_auxprop(&self, id: &str) -> CyrusSaslResult<Vec<AuxpropPlugin>> {
        AuxpropManager::list(self.client(id)?).await
    }

    pub async fn get_auxprop(&self, id: &str, name: &str) -> CyrusSaslResult<AuxpropPlugin> {
        AuxpropManager::get(self.client(id)?, name).await
    }

    pub async fn configure_auxprop(
        &self,
        id: &str,
        name: &str,
        settings: HashMap<String, String>,
    ) -> CyrusSaslResult<()> {
        AuxpropManager::configure(self.client(id)?, name, settings).await
    }

    pub async fn test_auxprop(&self, id: &str, name: &str) -> CyrusSaslResult<SaslTestResult> {
        AuxpropManager::test(self.client(id)?, name).await
    }

    // ── SaslDB ───────────────────────────────────────────────────

    pub async fn list_db_entries(&self, id: &str) -> CyrusSaslResult<Vec<SaslDbEntry>> {
        SaslDbManager::list_entries(self.client(id)?).await
    }

    pub async fn get_db_entry(
        &self,
        id: &str,
        username: &str,
        realm: &str,
    ) -> CyrusSaslResult<Vec<SaslDbEntry>> {
        SaslDbManager::get_entry(self.client(id)?, username, realm).await
    }

    pub async fn set_db_password(
        &self,
        id: &str,
        username: &str,
        realm: &str,
        password: &str,
    ) -> CyrusSaslResult<()> {
        SaslDbManager::set_password(self.client(id)?, username, realm, password).await
    }

    pub async fn delete_db_entry(
        &self,
        id: &str,
        username: &str,
        realm: &str,
    ) -> CyrusSaslResult<()> {
        SaslDbManager::delete_entry(self.client(id)?, username, realm).await
    }

    pub async fn dump_db(&self, id: &str) -> CyrusSaslResult<String> {
        SaslDbManager::dump(self.client(id)?).await
    }

    pub async fn import_db(&self, id: &str, data: String) -> CyrusSaslResult<()> {
        SaslDbManager::import(self.client(id)?, &data).await
    }

    // ── Process ──────────────────────────────────────────────────

    pub async fn start(&self, id: &str) -> CyrusSaslResult<()> {
        CyrusSaslProcessManager::start(self.client(id)?).await
    }

    pub async fn stop(&self, id: &str) -> CyrusSaslResult<()> {
        CyrusSaslProcessManager::stop(self.client(id)?).await
    }

    pub async fn restart(&self, id: &str) -> CyrusSaslResult<()> {
        CyrusSaslProcessManager::restart(self.client(id)?).await
    }

    pub async fn reload(&self, id: &str) -> CyrusSaslResult<()> {
        CyrusSaslProcessManager::reload(self.client(id)?).await
    }

    pub async fn status(&self, id: &str) -> CyrusSaslResult<String> {
        CyrusSaslProcessManager::status(self.client(id)?).await
    }

    pub async fn version(&self, id: &str) -> CyrusSaslResult<String> {
        CyrusSaslProcessManager::version(self.client(id)?).await
    }

    pub async fn info(&self, id: &str) -> CyrusSaslResult<SaslInfo> {
        CyrusSaslProcessManager::info(self.client(id)?).await
    }

    pub async fn test_config(&self, id: &str) -> CyrusSaslResult<SaslTestResult> {
        CyrusSaslProcessManager::test_config(self.client(id)?).await
    }
}
