//! Aggregate service facade for the HP iLO crate.
//!
//! `IloService` owns the `IloClient` and exposes every domain operation.
//! The Tauri `State` wrapper holds `IloServiceState = Arc<Mutex<IloService>>`.

use crate::bios::BiosManager;
use crate::certificates::CertificateManager;
use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::event_log::EventLogManager;
use crate::federation::FederationManager;
use crate::firmware::FirmwareManager;
use crate::hardware::HardwareManager;
use crate::health::HealthManager;
use crate::license::LicenseManager;
use crate::network::NetworkManager;
use crate::power::PowerManager;
use crate::security::SecurityManager;
use crate::storage::StorageManager;
use crate::system::SystemManager;
use crate::thermal::ThermalManager;
use crate::users::UserManager;
use crate::virtual_console::VirtualConsoleManager;
use crate::virtual_media::VirtualMediaManager;
use crate::types::*;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Thread-safe handle for Tauri state.
pub type IloServiceState = Arc<Mutex<IloService>>;

/// Top-level service aggregating all iLO subsystems.
pub struct IloService {
    client: Option<IloClient>,
    config: Option<IloConfig>,
}

impl IloService {
    pub fn new() -> Self {
        Self { client: None, config: None }
    }

    pub fn is_connected(&self) -> bool {
        self.client.as_ref().map(|c| c.is_connected()).unwrap_or(false)
    }

    fn require_client(&self) -> IloResult<&IloClient> {
        self.client
            .as_ref()
            .filter(|c| c.is_connected())
            .ok_or_else(|| IloError::connection("Not connected to iLO. Call ilo_connect first."))
    }

    pub fn get_config(&self) -> Option<IloConfigSafe> {
        self.client.as_ref().map(|c| c.get_config_safe())
    }

    // ── Connection ──────────────────────────────────────────────────

    pub async fn connect(&mut self, config: IloConfig) -> IloResult<String> {
        let mut client = IloClient::new(&config)?;
        client.connect().await?;
        let gen = client.generation();
        let msg = format!("Connected to {:?} at {}", gen, config.host);
        self.config = Some(config);
        self.client = Some(client);
        Ok(msg)
    }

    pub async fn disconnect(&mut self) -> IloResult<()> {
        if let Some(ref mut client) = self.client {
            let _ = client.disconnect().await;
        }
        self.client = None;
        self.config = None;
        Ok(())
    }

    pub async fn check_session(&self) -> IloResult<bool> {
        if let Some(client) = &self.client {
            client.check_session().await
        } else {
            Ok(false)
        }
    }

    // ── System ──────────────────────────────────────────────────────

    pub async fn get_system_info(&self) -> IloResult<BmcSystemInfo> {
        SystemManager::new(self.require_client()?).get_system_info().await
    }

    pub async fn get_ilo_info(&self) -> IloResult<IloInfo> {
        SystemManager::new(self.require_client()?).get_ilo_info().await
    }

    pub async fn set_asset_tag(&self, tag: &str) -> IloResult<()> {
        SystemManager::new(self.require_client()?).set_asset_tag(tag).await
    }

    pub async fn set_indicator_led(&self, state: &str) -> IloResult<()> {
        SystemManager::new(self.require_client()?).set_indicator_led(state).await
    }

    // ── Power ───────────────────────────────────────────────────────

    pub async fn power_action(&self, action: PowerAction) -> IloResult<()> {
        PowerManager::new(self.require_client()?).power_action(action).await
    }

    pub async fn get_power_state(&self) -> IloResult<String> {
        PowerManager::new(self.require_client()?).get_power_state().await
    }

    pub async fn get_power_metrics(&self) -> IloResult<BmcPowerMetrics> {
        PowerManager::new(self.require_client()?).get_power_metrics().await
    }

    // ── Thermal ─────────────────────────────────────────────────────

    pub async fn get_thermal_data(&self) -> IloResult<BmcThermalData> {
        ThermalManager::new(self.require_client()?).get_thermal_data().await
    }

    pub async fn get_thermal_summary(&self) -> IloResult<ThermalSummary> {
        ThermalManager::new(self.require_client()?).get_thermal_summary().await
    }

    // ── Hardware ────────────────────────────────────────────────────

    pub async fn get_processors(&self) -> IloResult<Vec<BmcProcessor>> {
        HardwareManager::new(self.require_client()?).get_processors().await
    }

    pub async fn get_memory(&self) -> IloResult<Vec<BmcMemoryDimm>> {
        HardwareManager::new(self.require_client()?).get_memory().await
    }

    // ── Storage ─────────────────────────────────────────────────────

    pub async fn get_storage_controllers(&self) -> IloResult<Vec<BmcStorageController>> {
        StorageManager::new(self.require_client()?).get_controllers().await
    }

    pub async fn get_virtual_disks(&self) -> IloResult<Vec<BmcVirtualDisk>> {
        StorageManager::new(self.require_client()?).get_virtual_disks().await
    }

    pub async fn get_physical_disks(&self) -> IloResult<Vec<BmcPhysicalDisk>> {
        StorageManager::new(self.require_client()?).get_physical_disks().await
    }

    // ── Network ─────────────────────────────────────────────────────

    pub async fn get_network_adapters(&self) -> IloResult<Vec<BmcNetworkAdapter>> {
        NetworkManager::new(self.require_client()?).get_network_adapters().await
    }

    pub async fn get_ilo_network(&self) -> IloResult<serde_json::Value> {
        NetworkManager::new(self.require_client()?).get_ilo_network().await
    }

    // ── Firmware ────────────────────────────────────────────────────

    pub async fn get_firmware_inventory(&self) -> IloResult<Vec<BmcFirmwareItem>> {
        FirmwareManager::new(self.require_client()?).get_firmware_inventory().await
    }

    // ── Virtual Media ───────────────────────────────────────────────

    pub async fn get_virtual_media_status(&self) -> IloResult<Vec<BmcVirtualMedia>> {
        VirtualMediaManager::new(self.require_client()?).get_status().await
    }

    pub async fn insert_virtual_media(&self, url: &str, media_id: Option<&str>) -> IloResult<()> {
        VirtualMediaManager::new(self.require_client()?).insert_media(url, media_id).await
    }

    pub async fn eject_virtual_media(&self, media_id: Option<&str>) -> IloResult<()> {
        VirtualMediaManager::new(self.require_client()?).eject_media(media_id).await
    }

    pub async fn set_vm_boot_once(&self) -> IloResult<()> {
        VirtualMediaManager::new(self.require_client()?).set_boot_once().await
    }

    // ── Virtual Console ─────────────────────────────────────────────

    pub async fn get_console_info(&self) -> IloResult<IloConsoleInfo> {
        VirtualConsoleManager::new(self.require_client()?).get_console_info().await
    }

    pub async fn get_html5_launch_url(&self) -> IloResult<String> {
        VirtualConsoleManager::new(self.require_client()?).get_html5_launch_url().await
    }

    // ── Event Logs ──────────────────────────────────────────────────

    pub async fn get_iml(&self) -> IloResult<Vec<BmcEventLogEntry>> {
        EventLogManager::new(self.require_client()?).get_iml().await
    }

    pub async fn get_ilo_event_log(&self) -> IloResult<Vec<BmcEventLogEntry>> {
        EventLogManager::new(self.require_client()?).get_ilo_event_log().await
    }

    pub async fn clear_iml(&self) -> IloResult<()> {
        EventLogManager::new(self.require_client()?).clear_iml().await
    }

    pub async fn clear_ilo_event_log(&self) -> IloResult<()> {
        EventLogManager::new(self.require_client()?).clear_ilo_event_log().await
    }

    // ── Users ───────────────────────────────────────────────────────

    pub async fn get_users(&self) -> IloResult<Vec<BmcUser>> {
        UserManager::new(self.require_client()?).get_users().await
    }

    pub async fn create_user(&self, username: &str, password: &str, role: &str) -> IloResult<()> {
        UserManager::new(self.require_client()?).create_user(username, password, role).await
    }

    pub async fn update_password(&self, user_id: &str, new_password: &str) -> IloResult<()> {
        UserManager::new(self.require_client()?).update_password(user_id, new_password).await
    }

    pub async fn delete_user(&self, user_id: &str) -> IloResult<()> {
        UserManager::new(self.require_client()?).delete_user(user_id).await
    }

    pub async fn set_user_enabled(&self, user_id: &str, enabled: bool) -> IloResult<()> {
        UserManager::new(self.require_client()?).set_user_enabled(user_id, enabled).await
    }

    // ── BIOS ────────────────────────────────────────────────────────

    pub async fn get_bios_attributes(&self) -> IloResult<Vec<BiosAttribute>> {
        BiosManager::new(self.require_client()?).get_bios_attributes().await
    }

    pub async fn set_bios_attributes(&self, attrs: &serde_json::Value) -> IloResult<()> {
        BiosManager::new(self.require_client()?).set_bios_attributes(attrs).await
    }

    pub async fn get_boot_config(&self) -> IloResult<BootConfig> {
        BiosManager::new(self.require_client()?).get_boot_config().await
    }

    pub async fn set_boot_override(&self, target: &str) -> IloResult<()> {
        BiosManager::new(self.require_client()?).set_boot_override(target).await
    }

    // ── Certificates ────────────────────────────────────────────────

    pub async fn get_certificate(&self) -> IloResult<IloCertificate> {
        CertificateManager::new(self.require_client()?).get_certificate().await
    }

    pub async fn generate_csr(&self, params: &CsrParams) -> IloResult<String> {
        CertificateManager::new(self.require_client()?).generate_csr(params).await
    }

    pub async fn import_certificate(&self, cert_pem: &str) -> IloResult<()> {
        CertificateManager::new(self.require_client()?).import_certificate(cert_pem).await
    }

    // ── Health ──────────────────────────────────────────────────────

    pub async fn get_health_rollup(&self) -> IloResult<BmcHealthRollup> {
        HealthManager::new(self.require_client()?).get_health_rollup().await
    }

    pub async fn get_dashboard(&self) -> IloResult<IloDashboard> {
        HealthManager::new(self.require_client()?).get_dashboard().await
    }

    // ── License ─────────────────────────────────────────────────────

    pub async fn get_license(&self) -> IloResult<IloLicense> {
        LicenseManager::new(self.require_client()?).get_license().await
    }

    pub async fn activate_license(&self, key: &str) -> IloResult<()> {
        LicenseManager::new(self.require_client()?).activate_license(key).await
    }

    pub async fn deactivate_license(&self) -> IloResult<()> {
        LicenseManager::new(self.require_client()?).deactivate_license().await
    }

    // ── Security ────────────────────────────────────────────────────

    pub async fn get_security_status(&self) -> IloResult<IloSecurityStatus> {
        SecurityManager::new(self.require_client()?).get_security_status().await
    }

    pub async fn set_min_tls_version(&self, version: &str) -> IloResult<()> {
        SecurityManager::new(self.require_client()?).set_min_tls_version(version).await
    }

    pub async fn set_ipmi_over_lan(&self, enabled: bool) -> IloResult<()> {
        SecurityManager::new(self.require_client()?).set_ipmi_over_lan(enabled).await
    }

    // ── Federation ──────────────────────────────────────────────────

    pub async fn get_federation_groups(&self) -> IloResult<Vec<IloFederationGroup>> {
        FederationManager::new(self.require_client()?).get_groups().await
    }

    pub async fn get_federation_peers(&self) -> IloResult<Vec<IloFederationPeer>> {
        FederationManager::new(self.require_client()?).get_peers().await
    }

    pub async fn add_federation_group(&self, name: &str, key: &str) -> IloResult<()> {
        FederationManager::new(self.require_client()?).add_group(name, key).await
    }

    pub async fn remove_federation_group(&self, name: &str) -> IloResult<()> {
        FederationManager::new(self.require_client()?).remove_group(name).await
    }

    // ── iLO Reset ───────────────────────────────────────────────────

    pub async fn reset_ilo(&self) -> IloResult<()> {
        let client = self.require_client()?;
        if let Ok(rf) = client.require_redfish() {
            rf.reset_ilo().await?;
            return Ok(());
        }
        if let Ok(ribcl) = client.require_ribcl() {
            ribcl.reset_ilo().await?;
            return Ok(());
        }
        Err(IloError::unsupported("No protocol available for iLO reset"))
    }
}
