//! Aggregate service facade for the Dell iDRAC crate.
//!
//! `IdracService` owns the `IdracClient` and exposes every domain operation.
//! The Tauri `State` wrapper holds `IdracServiceState = Arc<Mutex<IdracService>>`.

use crate::bios::BiosManager;
use crate::certificates::CertificateManager;
use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::event_log::EventLogManager;
use crate::firmware::FirmwareManager;
use crate::hardware::HardwareManager;
use crate::health::HealthManager;
use crate::lifecycle::LifecycleManager;
use crate::network::NetworkManager;
use crate::power::PowerManager;
use crate::racadm::RacadmManager;
use crate::storage::StorageManager;
use crate::system::SystemManager;
use crate::telemetry::TelemetryManager;
use crate::thermal::ThermalManager;
use crate::types::*;
use crate::users::UserManager;
use crate::virtual_console::VirtualConsoleManager;
use crate::virtual_media::VirtualMediaManager;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Thread-safe handle for Tauri state.
pub type IdracServiceState = Arc<Mutex<IdracService>>;

/// Top-level service aggregating all iDRAC subsystems.
pub struct IdracService {
    client: Option<IdracClient>,
    config: Option<IdracConfig>,
}

impl IdracService {
    pub fn new() -> Self {
        Self { client: None, config: None }
    }

    pub fn is_connected(&self) -> bool {
        self.client.as_ref().map(|c| c.is_connected()).unwrap_or(false)
    }

    fn require_client(&self) -> IdracResult<&IdracClient> {
        self.client
            .as_ref()
            .filter(|c| c.is_connected())
            .ok_or_else(|| IdracError::connection("Not connected to iDRAC. Call idrac_connect first."))
    }

    pub fn get_config(&self) -> Option<IdracConfigSafe> {
        self.client.as_ref().map(|c| c.get_config_safe())
    }

    // ── Connection ──────────────────────────────────────────────────

    pub async fn connect(&mut self, config: IdracConfig) -> IdracResult<String> {
        let mut client = IdracClient::new(&config)?;
        client.connect().await?;
        let msg = format!("Connected to iDRAC at {}", config.host);
        self.config = Some(config);
        self.client = Some(client);
        Ok(msg)
    }

    pub async fn disconnect(&mut self) -> IdracResult<()> {
        if let Some(ref mut client) = self.client {
            let _ = client.disconnect().await;
        }
        self.client = None;
        self.config = None;
        Ok(())
    }

    pub async fn check_session(&self) -> IdracResult<bool> {
        if let Some(client) = &self.client {
            client.check_session().await
        } else {
            Ok(false)
        }
    }

    // ── System ──────────────────────────────────────────────────────

    pub async fn get_system_info(&self) -> IdracResult<SystemInfo> {
        SystemManager::new(self.require_client()?).get_system_info().await
    }

    pub async fn get_idrac_info(&self) -> IdracResult<IdracInfo> {
        SystemManager::new(self.require_client()?).get_idrac_info().await
    }

    pub async fn set_asset_tag(&self, tag: &str) -> IdracResult<()> {
        SystemManager::new(self.require_client()?).set_asset_tag(tag).await
    }

    pub async fn set_indicator_led(&self, state: &str) -> IdracResult<()> {
        SystemManager::new(self.require_client()?).set_indicator_led(state).await
    }

    // ── Power ───────────────────────────────────────────────────────

    pub async fn power_action(&self, action: PowerAction) -> IdracResult<()> {
        PowerManager::new(self.require_client()?).power_action(action).await
    }

    pub async fn get_power_state(&self) -> IdracResult<String> {
        PowerManager::new(self.require_client()?).get_power_state().await
    }

    pub async fn get_power_metrics(&self) -> IdracResult<PowerMetrics> {
        PowerManager::new(self.require_client()?).get_power_metrics().await
    }

    pub async fn list_power_supplies(&self) -> IdracResult<Vec<PowerSupply>> {
        PowerManager::new(self.require_client()?).list_power_supplies().await
    }

    pub async fn set_power_cap(&self, watts: f64) -> IdracResult<()> {
        PowerManager::new(self.require_client()?).set_power_cap(watts).await
    }

    // ── Thermal ─────────────────────────────────────────────────────

    pub async fn get_thermal_data(&self) -> IdracResult<ThermalData> {
        ThermalManager::new(self.require_client()?).get_thermal_data().await
    }

    pub async fn get_thermal_summary(&self) -> IdracResult<ThermalSummary> {
        ThermalManager::new(self.require_client()?).get_thermal_summary().await
    }

    pub async fn set_fan_offset(&self, offset: i32) -> IdracResult<()> {
        ThermalManager::new(self.require_client()?).set_fan_offset(offset).await
    }

    // ── Hardware ────────────────────────────────────────────────────

    pub async fn list_processors(&self) -> IdracResult<Vec<Processor>> {
        HardwareManager::new(self.require_client()?).list_processors().await
    }

    pub async fn list_memory(&self) -> IdracResult<Vec<MemoryDimm>> {
        HardwareManager::new(self.require_client()?).list_memory().await
    }

    pub async fn list_pcie_devices(&self) -> IdracResult<Vec<PcieDevice>> {
        HardwareManager::new(self.require_client()?).list_pcie_devices().await
    }

    pub async fn get_total_memory_mb(&self) -> IdracResult<u64> {
        HardwareManager::new(self.require_client()?).get_total_memory_mb().await
    }

    pub async fn get_processor_count(&self) -> IdracResult<u32> {
        HardwareManager::new(self.require_client()?).get_processor_count().await
    }

    // ── Storage ─────────────────────────────────────────────────────

    pub async fn list_storage_controllers(&self) -> IdracResult<Vec<StorageController>> {
        StorageManager::new(self.require_client()?).list_controllers().await
    }

    pub async fn list_virtual_disks(&self, controller_id: Option<&str>) -> IdracResult<Vec<VirtualDisk>> {
        StorageManager::new(self.require_client()?).list_virtual_disks(controller_id).await
    }

    pub async fn list_physical_disks(&self, controller_id: Option<&str>) -> IdracResult<Vec<PhysicalDisk>> {
        StorageManager::new(self.require_client()?).list_physical_disks(controller_id).await
    }

    pub async fn list_enclosures(&self) -> IdracResult<Vec<StorageEnclosure>> {
        StorageManager::new(self.require_client()?).list_enclosures().await
    }

    pub async fn create_virtual_disk(&self, params: CreateVirtualDiskParams) -> IdracResult<String> {
        StorageManager::new(self.require_client()?).create_virtual_disk(params).await
    }

    pub async fn delete_virtual_disk(&self, controller_id: &str, volume_id: &str) -> IdracResult<()> {
        StorageManager::new(self.require_client()?).delete_virtual_disk(controller_id, volume_id).await
    }

    pub async fn assign_hotspare(&self, controller_id: &str, disk_id: &str, hotspare_type: &str, target_volume: Option<&str>) -> IdracResult<()> {
        StorageManager::new(self.require_client()?).assign_hotspare(controller_id, disk_id, hotspare_type, target_volume).await
    }

    pub async fn initialize_virtual_disk(&self, controller_id: &str, volume_id: &str, init_type: &str) -> IdracResult<String> {
        StorageManager::new(self.require_client()?).initialize_virtual_disk(controller_id, volume_id, init_type).await
    }

    // ── Network ─────────────────────────────────────────────────────

    pub async fn list_network_adapters(&self) -> IdracResult<Vec<NetworkAdapter>> {
        NetworkManager::new(self.require_client()?).list_adapters().await
    }

    pub async fn list_network_ports(&self) -> IdracResult<Vec<NetworkPort>> {
        NetworkManager::new(self.require_client()?).list_ports().await
    }

    pub async fn get_idrac_network_config(&self) -> IdracResult<IdracNetworkConfig> {
        NetworkManager::new(self.require_client()?).get_idrac_network_config().await
    }

    pub async fn update_idrac_network_config(&self, ipv4: Option<&str>, subnet: Option<&str>, gw: Option<&str>, dhcp: Option<bool>) -> IdracResult<()> {
        NetworkManager::new(self.require_client()?).update_idrac_network_config(ipv4, subnet, gw, dhcp).await
    }

    // ── Firmware ────────────────────────────────────────────────────

    pub async fn list_firmware(&self) -> IdracResult<Vec<FirmwareInventory>> {
        FirmwareManager::new(self.require_client()?).list_firmware().await
    }

    pub async fn update_firmware(&self, params: FirmwareUpdateParams) -> IdracResult<String> {
        FirmwareManager::new(self.require_client()?).update_firmware(params).await
    }

    pub async fn get_component_version(&self, name: &str) -> IdracResult<Option<String>> {
        FirmwareManager::new(self.require_client()?).get_component_version(name).await
    }

    // ── Lifecycle ───────────────────────────────────────────────────

    pub async fn list_jobs(&self) -> IdracResult<Vec<LifecycleJob>> {
        LifecycleManager::new(self.require_client()?).list_jobs().await
    }

    pub async fn get_job(&self, job_id: &str) -> IdracResult<LifecycleJob> {
        LifecycleManager::new(self.require_client()?).get_job(job_id).await
    }

    pub async fn delete_job(&self, job_id: &str) -> IdracResult<()> {
        LifecycleManager::new(self.require_client()?).delete_job(job_id).await
    }

    pub async fn purge_job_queue(&self) -> IdracResult<()> {
        LifecycleManager::new(self.require_client()?).purge_job_queue().await
    }

    pub async fn export_scp(&self, params: ScpExportParams) -> IdracResult<String> {
        LifecycleManager::new(self.require_client()?).export_scp(params).await
    }

    pub async fn import_scp(&self, params: ScpImportParams) -> IdracResult<String> {
        LifecycleManager::new(self.require_client()?).import_scp(params).await
    }

    pub async fn get_lc_status(&self) -> IdracResult<String> {
        LifecycleManager::new(self.require_client()?).get_lc_status().await
    }

    pub async fn wait_for_job(&self, job_id: &str, timeout_secs: u64, poll_secs: u64) -> IdracResult<LifecycleJob> {
        LifecycleManager::new(self.require_client()?).wait_for_job(job_id, timeout_secs, poll_secs).await
    }

    // ── Virtual Media ───────────────────────────────────────────────

    pub async fn list_virtual_media(&self) -> IdracResult<Vec<VirtualMediaStatus>> {
        VirtualMediaManager::new(self.require_client()?).list_virtual_media().await
    }

    pub async fn mount_virtual_media(&self, params: VirtualMediaMountParams) -> IdracResult<()> {
        VirtualMediaManager::new(self.require_client()?).mount_image(params).await
    }

    pub async fn unmount_virtual_media(&self, media_id: &str) -> IdracResult<()> {
        VirtualMediaManager::new(self.require_client()?).unmount_image(media_id).await
    }

    pub async fn boot_from_virtual_cd(&self) -> IdracResult<()> {
        VirtualMediaManager::new(self.require_client()?).boot_from_virtual_cd().await
    }

    // ── Virtual Console ─────────────────────────────────────────────

    pub async fn get_console_info(&self) -> IdracResult<ConsoleInfo> {
        VirtualConsoleManager::new(self.require_client()?).get_console_info().await
    }

    pub async fn set_console_enabled(&self, enabled: bool) -> IdracResult<()> {
        VirtualConsoleManager::new(self.require_client()?).set_console_enabled(enabled).await
    }

    pub async fn set_console_type(&self, plugin_type: &str) -> IdracResult<()> {
        VirtualConsoleManager::new(self.require_client()?).set_console_type(plugin_type).await
    }

    pub async fn set_vnc_enabled(&self, enabled: bool) -> IdracResult<()> {
        VirtualConsoleManager::new(self.require_client()?).set_vnc_enabled(enabled).await
    }

    pub async fn set_vnc_password(&self, password: &str) -> IdracResult<()> {
        VirtualConsoleManager::new(self.require_client()?).set_vnc_password(password).await
    }

    // ── Event Log ───────────────────────────────────────────────────

    pub async fn get_sel_entries(&self, max: Option<u32>) -> IdracResult<Vec<SelEntry>> {
        EventLogManager::new(self.require_client()?).get_sel_entries(max).await
    }

    pub async fn get_lc_log_entries(&self, max: Option<u32>) -> IdracResult<Vec<LcLogEntry>> {
        EventLogManager::new(self.require_client()?).get_lc_log_entries(max).await
    }

    pub async fn clear_sel(&self) -> IdracResult<()> {
        EventLogManager::new(self.require_client()?).clear_sel().await
    }

    pub async fn clear_lc_log(&self) -> IdracResult<()> {
        EventLogManager::new(self.require_client()?).clear_lc_log().await
    }

    // ── Users ───────────────────────────────────────────────────────

    pub async fn list_users(&self) -> IdracResult<Vec<IdracUser>> {
        UserManager::new(self.require_client()?).list_users().await
    }

    pub async fn create_or_update_user(&self, params: IdracUserParams) -> IdracResult<()> {
        UserManager::new(self.require_client()?).create_or_update_user(params).await
    }

    pub async fn delete_user(&self, slot_id: &str) -> IdracResult<()> {
        UserManager::new(self.require_client()?).delete_user(slot_id).await
    }

    pub async fn unlock_user(&self, slot_id: &str) -> IdracResult<()> {
        UserManager::new(self.require_client()?).unlock_user(slot_id).await
    }

    pub async fn change_user_password(&self, slot_id: &str, password: &str) -> IdracResult<()> {
        UserManager::new(self.require_client()?).change_password(slot_id, password).await
    }

    pub async fn get_ldap_config(&self) -> IdracResult<LdapConfig> {
        UserManager::new(self.require_client()?).get_ldap_config().await
    }

    pub async fn update_ldap_config(&self, config: &LdapConfig) -> IdracResult<()> {
        UserManager::new(self.require_client()?).update_ldap_config(config).await
    }

    pub async fn get_ad_config(&self) -> IdracResult<ActiveDirectoryConfig> {
        UserManager::new(self.require_client()?).get_ad_config().await
    }

    pub async fn update_ad_config(&self, config: &ActiveDirectoryConfig) -> IdracResult<()> {
        UserManager::new(self.require_client()?).update_ad_config(config).await
    }

    // ── BIOS ────────────────────────────────────────────────────────

    pub async fn get_bios_attributes(&self) -> IdracResult<Vec<BiosAttribute>> {
        BiosManager::new(self.require_client()?).get_bios_attributes().await
    }

    pub async fn get_bios_attribute(&self, name: &str) -> IdracResult<Option<String>> {
        BiosManager::new(self.require_client()?).get_bios_attribute(name).await
    }

    pub async fn set_bios_attributes(&self, attrs: &std::collections::HashMap<String, String>) -> IdracResult<String> {
        BiosManager::new(self.require_client()?).set_bios_attributes(attrs).await
    }

    pub async fn get_boot_order(&self) -> IdracResult<BootConfig> {
        BiosManager::new(self.require_client()?).get_boot_order().await
    }

    pub async fn set_boot_order(&self, order: &[String]) -> IdracResult<()> {
        BiosManager::new(self.require_client()?).set_boot_order(order).await
    }

    pub async fn set_boot_once(&self, target: &str, mode: Option<&str>) -> IdracResult<()> {
        BiosManager::new(self.require_client()?).set_boot_once(target, mode).await
    }

    pub async fn set_boot_mode(&self, mode: &str) -> IdracResult<String> {
        BiosManager::new(self.require_client()?).set_boot_mode(mode).await
    }

    // ── Certificates ────────────────────────────────────────────────

    pub async fn list_certificates(&self) -> IdracResult<Vec<IdracCertificate>> {
        CertificateManager::new(self.require_client()?).list_certificates().await
    }

    pub async fn generate_csr(&self, params: CsrParams) -> IdracResult<String> {
        CertificateManager::new(self.require_client()?).generate_csr(params).await
    }

    pub async fn import_certificate(&self, cert_pem: &str, cert_type: &str) -> IdracResult<()> {
        CertificateManager::new(self.require_client()?).import_certificate(cert_pem, cert_type).await
    }

    pub async fn delete_certificate(&self, cert_id: &str) -> IdracResult<()> {
        CertificateManager::new(self.require_client()?).delete_certificate(cert_id).await
    }

    pub async fn replace_ssl_certificate(&self, cert_pem: &str, key_pem: &str) -> IdracResult<()> {
        CertificateManager::new(self.require_client()?).replace_ssl_certificate(cert_pem, key_pem).await
    }

    // ── Health ──────────────────────────────────────────────────────

    pub async fn get_health_rollup(&self) -> IdracResult<ServerHealthRollup> {
        HealthManager::new(self.require_client()?).get_health_rollup().await
    }

    pub async fn get_component_health(&self) -> IdracResult<Vec<(String, ComponentHealth)>> {
        HealthManager::new(self.require_client()?).get_component_health().await
    }

    pub async fn is_healthy(&self) -> IdracResult<bool> {
        HealthManager::new(self.require_client()?).is_healthy().await
    }

    // ── Telemetry ───────────────────────────────────────────────────

    pub async fn get_power_telemetry(&self) -> IdracResult<PowerTelemetry> {
        TelemetryManager::new(self.require_client()?).get_power_telemetry().await
    }

    pub async fn get_thermal_telemetry(&self) -> IdracResult<ThermalTelemetry> {
        TelemetryManager::new(self.require_client()?).get_thermal_telemetry().await
    }

    pub async fn list_telemetry_reports(&self) -> IdracResult<Vec<TelemetryReport>> {
        TelemetryManager::new(self.require_client()?).list_telemetry_reports().await
    }

    pub async fn get_telemetry_report(&self, report_id: &str) -> IdracResult<Vec<TelemetryDataPoint>> {
        TelemetryManager::new(self.require_client()?).get_telemetry_report(report_id).await
    }

    // ── RACADM ──────────────────────────────────────────────────────

    pub async fn racadm_execute(&self, command: &str) -> IdracResult<RacadmResult> {
        RacadmManager::new(self.require_client()?).execute(command).await
    }

    pub async fn reset_idrac(&self) -> IdracResult<()> {
        RacadmManager::new(self.require_client()?).reset_idrac().await
    }

    pub async fn get_idrac_attribute(&self, name: &str) -> IdracResult<Option<String>> {
        RacadmManager::new(self.require_client()?).get_attribute(name).await
    }

    pub async fn set_idrac_attribute(&self, name: &str, value: &str) -> IdracResult<()> {
        RacadmManager::new(self.require_client()?).set_attribute(name, value).await
    }

    // ── Dashboard ───────────────────────────────────────────────────

    pub async fn get_dashboard(&self) -> IdracResult<IdracDashboard> {
        let client = self.require_client()?;

        let sys_mgr = SystemManager::new(client);
        let power_mgr = PowerManager::new(client);
        let thermal_mgr = ThermalManager::new(client);
        let health_mgr = HealthManager::new(client);

        let system_info = sys_mgr.get_system_info().await.ok();
        let idrac_info = sys_mgr.get_idrac_info().await.ok();
        let power_state = power_mgr.get_power_state().await.ok();
        let power_metrics = power_mgr.get_power_metrics().await.ok();
        let thermal_summary = thermal_mgr.get_thermal_summary().await.ok();
        let health_rollup = health_mgr.get_health_rollup().await.ok();

        Ok(IdracDashboard {
            system_info,
            idrac_info,
            power_state,
            power_metrics,
            thermal_summary,
            health_rollup,
        })
    }
}
