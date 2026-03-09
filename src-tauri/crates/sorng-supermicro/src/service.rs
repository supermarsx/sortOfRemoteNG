//! Aggregate service facade for Supermicro BMC management.
//!
//! Wraps the multi-protocol `SmcClient` and exposes all operations
//! through a single `SmcService`. Tauri state alias is provided.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;
use sorng_bmc_common::power::PowerAction;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Tauri-compatible state alias.
pub type SmcServiceState = Arc<Mutex<SmcService>>;

/// Aggregate service for all Supermicro BMC operations.
pub struct SmcService {
    client: SmcClient,
}

impl Default for SmcService {
    fn default() -> Self {
        Self::new()
    }
}

impl SmcService {
    pub fn new() -> Self {
        Self {
            client: SmcClient::new(SmcConfig::default()),
        }
    }

    // ── Connection lifecycle ────────────────────────────────────────

    pub async fn connect(&mut self, config: SmcConfig) -> SmcResult<()> {
        self.client = SmcClient::new(config);
        self.client.connect().await
    }

    pub async fn disconnect(&mut self) -> SmcResult<()> {
        self.client.disconnect().await
    }

    pub fn is_connected(&self) -> bool {
        self.client.is_connected()
    }

    pub async fn check_session(&self) -> SmcResult<bool> {
        self.client.check_session().await
    }

    pub fn get_config(&self) -> SmcConfigSafe {
        self.client.get_config_safe()
    }

    // ── System ──────────────────────────────────────────────────────

    pub async fn get_system_info(&self) -> SmcResult<SystemInfo> {
        crate::system::SystemManager::get_system_info(&self.client).await
    }

    pub async fn get_bmc_info(&self) -> SmcResult<SmcBmcInfo> {
        crate::system::SystemManager::get_bmc_info(&self.client).await
    }

    pub async fn set_indicator_led(&self, state: &str) -> SmcResult<()> {
        crate::system::SystemManager::set_indicator_led(&self.client, state).await
    }

    pub async fn set_asset_tag(&self, tag: &str) -> SmcResult<()> {
        crate::system::SystemManager::set_asset_tag(&self.client, tag).await
    }

    // ── Power ───────────────────────────────────────────────────────

    pub async fn get_power_state(&self) -> SmcResult<String> {
        crate::power::PowerManager::get_power_state(&self.client).await
    }

    pub async fn power_action(&self, action: &PowerAction) -> SmcResult<()> {
        crate::power::PowerManager::power_action(&self.client, action).await
    }

    pub async fn get_power_metrics(&self) -> SmcResult<PowerMetrics> {
        crate::power::PowerManager::get_power_metrics(&self.client).await
    }

    // ── Thermal ─────────────────────────────────────────────────────

    pub async fn get_thermal_data(&self) -> SmcResult<ThermalData> {
        crate::thermal::ThermalManager::get_thermal_data(&self.client).await
    }

    pub async fn get_thermal_summary(&self) -> SmcResult<ThermalSummary> {
        crate::thermal::ThermalManager::get_thermal_summary(&self.client).await
    }

    // ── Hardware ────────────────────────────────────────────────────

    pub async fn get_processors(&self) -> SmcResult<Vec<ProcessorInfo>> {
        crate::hardware::HardwareManager::get_processors(&self.client).await
    }

    pub async fn get_memory(&self) -> SmcResult<Vec<MemoryInfo>> {
        crate::hardware::HardwareManager::get_memory(&self.client).await
    }

    // ── Storage ─────────────────────────────────────────────────────

    pub async fn get_storage_controllers(&self) -> SmcResult<Vec<StorageController>> {
        crate::storage::StorageManager::get_controllers(&self.client).await
    }

    pub async fn get_virtual_disks(&self) -> SmcResult<Vec<VirtualDisk>> {
        crate::storage::StorageManager::get_virtual_disks(&self.client).await
    }

    pub async fn get_physical_disks(&self) -> SmcResult<Vec<PhysicalDisk>> {
        crate::storage::StorageManager::get_physical_disks(&self.client).await
    }

    // ── Network ─────────────────────────────────────────────────────

    pub async fn get_network_adapters(&self) -> SmcResult<Vec<NetworkAdapter>> {
        crate::network::NetworkManager::get_network_adapters(&self.client).await
    }

    pub async fn get_bmc_network(&self) -> SmcResult<Vec<NetworkAdapter>> {
        crate::network::NetworkManager::get_bmc_network(&self.client).await
    }

    // ── Firmware ────────────────────────────────────────────────────

    pub async fn get_firmware_inventory(&self) -> SmcResult<Vec<FirmwareInfo>> {
        crate::firmware::FirmwareManager::get_firmware_inventory(&self.client).await
    }

    // ── Virtual media ───────────────────────────────────────────────

    pub async fn get_virtual_media_status(&self) -> SmcResult<Vec<VirtualMediaStatus>> {
        crate::virtual_media::VirtualMediaManager::get_status(&self.client).await
    }

    pub async fn insert_virtual_media(&self, slot: &str, image_url: &str) -> SmcResult<()> {
        crate::virtual_media::VirtualMediaManager::insert_media(&self.client, slot, image_url).await
    }

    pub async fn eject_virtual_media(&self, slot: &str) -> SmcResult<()> {
        crate::virtual_media::VirtualMediaManager::eject_media(&self.client, slot).await
    }

    // ── Console ─────────────────────────────────────────────────────

    pub async fn get_console_info(&self) -> SmcResult<SmcConsoleInfo> {
        crate::virtual_console::VirtualConsoleManager::get_console_info(&self.client).await
    }

    pub async fn get_html5_ikvm_url(&self) -> SmcResult<String> {
        crate::virtual_console::VirtualConsoleManager::get_html5_ikvm_url(&self.client).await
    }

    // ── Event log ───────────────────────────────────────────────────

    pub async fn get_event_log(&self) -> SmcResult<Vec<EventLogEntry>> {
        crate::event_log::EventLogManager::get_event_log(&self.client).await
    }

    pub async fn get_audit_log(&self) -> SmcResult<Vec<EventLogEntry>> {
        crate::event_log::EventLogManager::get_audit_log(&self.client).await
    }

    pub async fn clear_event_log(&self) -> SmcResult<()> {
        crate::event_log::EventLogManager::clear_event_log(&self.client).await
    }

    // ── Users ───────────────────────────────────────────────────────

    pub async fn get_users(&self) -> SmcResult<Vec<UserAccount>> {
        crate::users::UserManager::get_users(&self.client).await
    }

    pub async fn create_user(&self, username: &str, password: &str, role: &str) -> SmcResult<()> {
        crate::users::UserManager::create_user(&self.client, username, password, role).await
    }

    pub async fn update_password(&self, user_id: &str, new_password: &str) -> SmcResult<()> {
        crate::users::UserManager::update_password(&self.client, user_id, new_password).await
    }

    pub async fn delete_user(&self, user_id: &str) -> SmcResult<()> {
        crate::users::UserManager::delete_user(&self.client, user_id).await
    }

    // ── BIOS ────────────────────────────────────────────────────────

    pub async fn get_bios_attributes(&self) -> SmcResult<Vec<BiosAttribute>> {
        crate::bios::BiosManager::get_bios_attributes(&self.client).await
    }

    pub async fn set_bios_attributes(&self, attributes: &serde_json::Value) -> SmcResult<()> {
        crate::bios::BiosManager::set_bios_attributes(&self.client, attributes).await
    }

    pub async fn get_boot_config(&self) -> SmcResult<BootConfig> {
        crate::bios::BiosManager::get_boot_config(&self.client).await
    }

    pub async fn set_boot_override(&self, target: &str, mode: Option<&str>) -> SmcResult<()> {
        crate::bios::BiosManager::set_boot_override(&self.client, target, mode).await
    }

    // ── Certificates ────────────────────────────────────────────────

    pub async fn get_certificate(&self) -> SmcResult<SmcCertificate> {
        crate::certificates::CertificateManager::get_certificate(&self.client).await
    }

    pub async fn generate_csr(&self, params: &CsrParams) -> SmcResult<String> {
        crate::certificates::CertificateManager::generate_csr(&self.client, params).await
    }

    pub async fn import_certificate(&self, cert_pem: &str) -> SmcResult<()> {
        crate::certificates::CertificateManager::import_certificate(&self.client, cert_pem).await
    }

    // ── Health ──────────────────────────────────────────────────────

    pub async fn get_health_rollup(&self) -> SmcResult<HealthRollup> {
        crate::health::HealthManager::get_health_rollup(&self.client).await
    }

    pub async fn get_dashboard(&self) -> SmcResult<SmcDashboard> {
        crate::health::HealthManager::get_dashboard(&self.client).await
    }

    // ── Node Manager ────────────────────────────────────────────────

    pub async fn get_node_manager_policies(&self) -> SmcResult<Vec<NodeManagerPolicy>> {
        crate::node_manager::NodeManagerModule::get_policies(&self.client).await
    }

    pub async fn get_node_manager_stats(
        &self,
        domain: &NodeManagerDomain,
    ) -> SmcResult<NodeManagerStats> {
        crate::node_manager::NodeManagerModule::get_stats(&self.client, domain).await
    }

    // ── Security ────────────────────────────────────────────────────

    pub async fn get_security_status(&self) -> SmcResult<SmcSecurityStatus> {
        let rf = self.client.require_redfish()?;
        rf.get_security_status().await
    }

    // ── BMC reset ───────────────────────────────────────────────────

    pub async fn reset_bmc(&self) -> SmcResult<()> {
        let rf = self.client.require_redfish()?;
        rf.reset_bmc().await
    }

    // ── License ─────────────────────────────────────────────────────

    pub async fn get_licenses(&self) -> SmcResult<Vec<SmcLicense>> {
        let rf = self.client.require_redfish()?;
        rf.get_license().await
    }

    pub async fn activate_license(&self, product_key: &str) -> SmcResult<()> {
        let rf = self.client.require_redfish()?;
        rf.activate_license(product_key).await
    }
}
