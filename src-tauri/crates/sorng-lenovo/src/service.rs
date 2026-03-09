//! Aggregate service facade for the Lenovo XCC/IMM crate.
//!
//! `LenovoService` owns the `LenovoClient` and exposes every domain operation.
//! The Tauri `State` wrapper holds `LenovoServiceState = Arc<Mutex<LenovoService>>`.

use crate::bios::BiosManager;
use crate::certificates::CertificateManager;
use crate::client::LenovoClient;
use crate::error::{LenovoError, LenovoResult};
use crate::event_log::EventLogManager;
use crate::firmware::FirmwareManager;
use crate::hardware::HardwareManager;
use crate::health::HealthManager;
use crate::network::NetworkManager;
use crate::onecli::OnecliManager;
use crate::power::PowerManager;
use crate::storage::StorageManager;
use crate::system::SystemManager;
use crate::thermal::ThermalManager;
use crate::types::*;
use crate::users::UserManager;
use crate::virtual_console::VirtualConsoleManager;
use crate::virtual_media::VirtualMediaManager;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Thread-safe handle for Tauri state.
pub type LenovoServiceState = Arc<Mutex<LenovoService>>;

/// Top-level service aggregating all Lenovo subsystems.
pub struct LenovoService {
    client: Option<LenovoClient>,
}

impl Default for LenovoService {
    fn default() -> Self {
        Self::new()
    }
}

impl LenovoService {
    pub fn new() -> Self {
        Self { client: None }
    }

    pub fn is_connected(&self) -> bool {
        self.client
            .as_ref()
            .map(|c| c.is_connected())
            .unwrap_or(false)
    }

    fn require_client(&self) -> LenovoResult<&LenovoClient> {
        self.client
            .as_ref()
            .filter(|c| c.is_connected())
            .ok_or_else(|| {
                LenovoError::connection("Not connected to any Lenovo XCC/IMM controller")
            })
    }

    // ── Connection ──────────────────────────────────────────────────

    pub async fn connect(&mut self, config: LenovoConfig) -> LenovoResult<String> {
        if self.is_connected() {
            self.disconnect().await?;
        }
        let mut client = LenovoClient::new(&config)?;
        let msg = client.connect().await?;
        self.client = Some(client);
        Ok(msg)
    }

    pub async fn disconnect(&mut self) -> LenovoResult<()> {
        if let Some(ref mut c) = self.client {
            c.disconnect().await?;
        }
        self.client = None;
        Ok(())
    }

    pub async fn check_session(&self) -> LenovoResult<bool> {
        if let Some(ref c) = self.client {
            c.check_session().await
        } else {
            Ok(false)
        }
    }

    pub fn get_config(&self) -> LenovoResult<LenovoConfigSafe> {
        Ok(self.require_client()?.get_config_safe())
    }

    // ── System ──────────────────────────────────────────────────────

    pub async fn get_system_info(&self) -> LenovoResult<BmcSystemInfo> {
        SystemManager::new(self.require_client()?)
            .get_system_info()
            .await
    }

    pub async fn get_xcc_info(&self) -> LenovoResult<XccInfo> {
        SystemManager::new(self.require_client()?)
            .get_xcc_info()
            .await
    }

    pub async fn set_asset_tag(&self, tag: &str) -> LenovoResult<()> {
        SystemManager::new(self.require_client()?)
            .set_asset_tag(tag)
            .await
    }

    pub async fn set_indicator_led(&self, state: &str) -> LenovoResult<()> {
        SystemManager::new(self.require_client()?)
            .set_indicator_led(state)
            .await
    }

    // ── Power ───────────────────────────────────────────────────────

    pub async fn power_action(&self, action: &PowerAction) -> LenovoResult<()> {
        PowerManager::new(self.require_client()?)
            .power_action(action)
            .await
    }

    pub async fn get_power_state(&self) -> LenovoResult<String> {
        PowerManager::new(self.require_client()?)
            .get_power_state()
            .await
    }

    pub async fn get_power_metrics(&self) -> LenovoResult<BmcPowerMetrics> {
        PowerManager::new(self.require_client()?)
            .get_power_metrics()
            .await
    }

    // ── Thermal ─────────────────────────────────────────────────────

    pub async fn get_thermal_data(&self) -> LenovoResult<BmcThermalData> {
        ThermalManager::new(self.require_client()?)
            .get_thermal_data()
            .await
    }

    pub async fn get_thermal_summary(&self) -> LenovoResult<ThermalSummary> {
        ThermalManager::new(self.require_client()?)
            .get_thermal_summary()
            .await
    }

    // ── Hardware ────────────────────────────────────────────────────

    pub async fn get_processors(&self) -> LenovoResult<Vec<BmcProcessor>> {
        HardwareManager::new(self.require_client()?)
            .get_processors()
            .await
    }

    pub async fn get_memory(&self) -> LenovoResult<Vec<BmcMemoryDimm>> {
        HardwareManager::new(self.require_client()?)
            .get_memory()
            .await
    }

    // ── Storage ─────────────────────────────────────────────────────

    pub async fn get_storage_controllers(&self) -> LenovoResult<Vec<BmcStorageController>> {
        StorageManager::new(self.require_client()?)
            .get_controllers()
            .await
    }

    pub async fn get_virtual_disks(&self) -> LenovoResult<Vec<BmcVirtualDisk>> {
        StorageManager::new(self.require_client()?)
            .get_virtual_disks()
            .await
    }

    pub async fn get_physical_disks(&self) -> LenovoResult<Vec<BmcPhysicalDisk>> {
        StorageManager::new(self.require_client()?)
            .get_physical_disks()
            .await
    }

    // ── Network ─────────────────────────────────────────────────────

    pub async fn get_network_adapters(&self) -> LenovoResult<Vec<BmcNetworkAdapter>> {
        NetworkManager::new(self.require_client()?)
            .get_network_adapters()
            .await
    }

    pub async fn get_xcc_network(&self) -> LenovoResult<serde_json::Value> {
        NetworkManager::new(self.require_client()?)
            .get_xcc_network()
            .await
    }

    // ── Firmware ────────────────────────────────────────────────────

    pub async fn get_firmware_inventory(&self) -> LenovoResult<Vec<BmcFirmwareItem>> {
        FirmwareManager::new(self.require_client()?)
            .get_firmware_inventory()
            .await
    }

    // ── Virtual Media ───────────────────────────────────────────────

    pub async fn get_virtual_media_status(&self) -> LenovoResult<Vec<BmcVirtualMedia>> {
        VirtualMediaManager::new(self.require_client()?)
            .get_status()
            .await
    }

    pub async fn insert_virtual_media(&self, slot: &str, image_url: &str) -> LenovoResult<()> {
        VirtualMediaManager::new(self.require_client()?)
            .insert_media(slot, image_url)
            .await
    }

    pub async fn eject_virtual_media(&self, slot: &str) -> LenovoResult<()> {
        VirtualMediaManager::new(self.require_client()?)
            .eject_media(slot)
            .await
    }

    // ── Virtual Console ─────────────────────────────────────────────

    pub async fn get_console_info(&self) -> LenovoResult<XccConsoleInfo> {
        VirtualConsoleManager::new(self.require_client()?)
            .get_console_info()
            .await
    }

    pub async fn get_html5_launch_url(&self) -> LenovoResult<String> {
        VirtualConsoleManager::new(self.require_client()?)
            .get_html5_launch_url()
            .await
    }

    // ── Event Log ───────────────────────────────────────────────────

    pub async fn get_event_log(&self) -> LenovoResult<Vec<BmcEventLogEntry>> {
        EventLogManager::new(self.require_client()?)
            .get_event_log()
            .await
    }

    pub async fn get_audit_log(&self) -> LenovoResult<Vec<BmcEventLogEntry>> {
        EventLogManager::new(self.require_client()?)
            .get_audit_log()
            .await
    }

    pub async fn clear_event_log(&self) -> LenovoResult<()> {
        EventLogManager::new(self.require_client()?)
            .clear_event_log()
            .await
    }

    // ── Users ───────────────────────────────────────────────────────

    pub async fn get_users(&self) -> LenovoResult<Vec<BmcUser>> {
        UserManager::new(self.require_client()?).get_users().await
    }

    pub async fn create_user(
        &self,
        username: &str,
        password: &str,
        role: &str,
    ) -> LenovoResult<()> {
        UserManager::new(self.require_client()?)
            .create_user(username, password, role)
            .await
    }

    pub async fn update_password(&self, user_id: &str, password: &str) -> LenovoResult<()> {
        UserManager::new(self.require_client()?)
            .update_password(user_id, password)
            .await
    }

    pub async fn delete_user(&self, user_id: &str) -> LenovoResult<()> {
        UserManager::new(self.require_client()?)
            .delete_user(user_id)
            .await
    }

    // ── BIOS ────────────────────────────────────────────────────────

    pub async fn get_bios_attributes(&self) -> LenovoResult<Vec<BiosAttribute>> {
        BiosManager::new(self.require_client()?)
            .get_bios_attributes()
            .await
    }

    pub async fn set_bios_attributes(&self, attrs: &serde_json::Value) -> LenovoResult<()> {
        BiosManager::new(self.require_client()?)
            .set_bios_attributes(attrs)
            .await
    }

    pub async fn get_boot_config(&self) -> LenovoResult<BootConfig> {
        BiosManager::new(self.require_client()?)
            .get_boot_config()
            .await
    }

    pub async fn set_boot_override(&self, target: &str, mode: Option<&str>) -> LenovoResult<()> {
        BiosManager::new(self.require_client()?)
            .set_boot_override(target, mode)
            .await
    }

    // ── Certificates ────────────────────────────────────────────────

    pub async fn get_certificate(&self) -> LenovoResult<XccCertificate> {
        CertificateManager::new(self.require_client()?)
            .get_certificate()
            .await
    }

    pub async fn generate_csr(&self, params: &CsrParams) -> LenovoResult<String> {
        CertificateManager::new(self.require_client()?)
            .generate_csr(params)
            .await
    }

    pub async fn import_certificate(&self, cert_pem: &str) -> LenovoResult<()> {
        CertificateManager::new(self.require_client()?)
            .import_certificate(cert_pem)
            .await
    }

    // ── Health ──────────────────────────────────────────────────────

    pub async fn get_health_rollup(&self) -> LenovoResult<BmcHealthRollup> {
        HealthManager::new(self.require_client()?)
            .get_health_rollup()
            .await
    }

    pub async fn get_dashboard(&self) -> LenovoResult<XccDashboard> {
        HealthManager::new(self.require_client()?)
            .get_dashboard()
            .await
    }

    // ── OneCLI ──────────────────────────────────────────────────────

    pub async fn onecli_execute(&self, command: &str) -> LenovoResult<OnecliResult> {
        OnecliManager::new(self.require_client()?)
            .execute(command)
            .await
    }

    // ── Controller Reset ────────────────────────────────────────────

    pub async fn reset_controller(&self) -> LenovoResult<()> {
        let rf = self.require_client()?.require_redfish()?;
        rf.reset_controller().await
    }
}
