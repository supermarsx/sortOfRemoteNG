//! Aggregate service facade for the Hyper-V management crate.
//!
//! Owns the `PsExecutor` and delegates to domain-specific managers.
//! Exposed to Tauri via `HyperVServiceState`.

use crate::error::HyperVResult;
use crate::metrics::MetricsManager;
use crate::network::NetworkManager;
use crate::powershell::PsExecutor;
use crate::replication::ReplicationManager;
use crate::snapshot::SnapshotManager;
use crate::storage::StorageManager;
use crate::types::*;
use crate::vm::VmManager;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Alias for Tauri managed state.
pub type HyperVServiceState = Arc<Mutex<HyperVService>>;

/// Central Hyper-V management service.
pub struct HyperVService {
    ps: PsExecutor,
    config: HyperVConfig,
}

impl HyperVService {
    /// Create a new service with default config (local host).
    pub fn new() -> Self {
        let config = HyperVConfig::default();
        Self {
            ps: PsExecutor::new(&config),
            config,
        }
    }

    /// Create a new service with custom config.
    pub fn with_config(config: HyperVConfig) -> Self {
        Self {
            ps: PsExecutor::new(&config),
            config,
        }
    }

    /// Get the current config.
    pub fn config(&self) -> &HyperVConfig {
        &self.config
    }

    /// Update the config at runtime.
    pub fn set_config(&mut self, config: HyperVConfig) {
        self.ps.set_config(config.clone());
        self.config = config;
    }

    /// Check whether the Hyper-V module is available.
    pub async fn check_module(&self) -> HyperVResult<bool> {
        self.ps.check_module().await
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  VM Lifecycle
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    pub async fn list_vms(&self) -> HyperVResult<Vec<VmInfo>> {
        VmManager::list_vms(&self.ps).await
    }

    pub async fn list_vms_summary(&self) -> HyperVResult<Vec<VmSummary>> {
        VmManager::list_vms_summary(&self.ps).await
    }

    pub async fn get_vm(&self, name: &str) -> HyperVResult<VmInfo> {
        VmManager::get_vm(&self.ps, name).await
    }

    pub async fn get_vm_by_id(&self, id: &str) -> HyperVResult<VmInfo> {
        VmManager::get_vm_by_id(&self.ps, id).await
    }

    pub async fn create_vm(&self, config: &VmCreateConfig) -> HyperVResult<VmInfo> {
        VmManager::create_vm(&self.ps, config).await
    }

    pub async fn start_vm(&self, name: &str) -> HyperVResult<()> {
        VmManager::start_vm(&self.ps, name).await
    }

    pub async fn stop_vm(&self, name: &str, force: bool) -> HyperVResult<()> {
        VmManager::stop_vm(&self.ps, name, force).await
    }

    pub async fn restart_vm(&self, name: &str, force: bool) -> HyperVResult<()> {
        VmManager::restart_vm(&self.ps, name, force).await
    }

    pub async fn pause_vm(&self, name: &str) -> HyperVResult<()> {
        VmManager::pause_vm(&self.ps, name).await
    }

    pub async fn resume_vm(&self, name: &str) -> HyperVResult<()> {
        VmManager::resume_vm(&self.ps, name).await
    }

    pub async fn save_vm(&self, name: &str) -> HyperVResult<()> {
        VmManager::save_vm(&self.ps, name).await
    }

    pub async fn remove_vm(&self, name: &str, delete_files: bool) -> HyperVResult<()> {
        VmManager::remove_vm(&self.ps, name, delete_files).await
    }

    pub async fn update_vm(
        &self,
        name: &str,
        config: &VmUpdateConfig,
    ) -> HyperVResult<VmInfo> {
        VmManager::update_vm(&self.ps, name, config).await
    }

    pub async fn rename_vm(&self, name: &str, new_name: &str) -> HyperVResult<()> {
        VmManager::rename_vm(&self.ps, name, new_name).await
    }

    pub async fn export_vm(&self, name: &str, config: &VmExportConfig) -> HyperVResult<()> {
        VmManager::export_vm(&self.ps, name, config).await
    }

    pub async fn import_vm(&self, config: &VmImportConfig) -> HyperVResult<VmInfo> {
        VmManager::import_vm(&self.ps, config).await
    }

    pub async fn live_migrate(
        &self,
        name: &str,
        config: &LiveMigrationConfig,
    ) -> HyperVResult<()> {
        VmManager::live_migrate(&self.ps, name, config).await
    }

    pub async fn get_integration_services(
        &self,
        name: &str,
    ) -> HyperVResult<Vec<IntegrationServiceInfo>> {
        VmManager::get_integration_services(&self.ps, name).await
    }

    pub async fn set_integration_service(
        &self,
        name: &str,
        service_name: &str,
        enabled: bool,
    ) -> HyperVResult<()> {
        VmManager::set_integration_service(&self.ps, name, service_name, enabled).await
    }

    pub async fn add_dvd_drive(
        &self,
        name: &str,
        iso_path: Option<&str>,
    ) -> HyperVResult<()> {
        VmManager::add_dvd_drive(&self.ps, name, iso_path).await
    }

    pub async fn set_dvd_drive(
        &self,
        name: &str,
        controller_number: u32,
        controller_location: u32,
        iso_path: Option<&str>,
    ) -> HyperVResult<()> {
        VmManager::set_dvd_drive(&self.ps, name, controller_number, controller_location, iso_path)
            .await
    }

    pub async fn remove_dvd_drive(
        &self,
        name: &str,
        controller_number: u32,
        controller_location: u32,
    ) -> HyperVResult<()> {
        VmManager::remove_dvd_drive(&self.ps, name, controller_number, controller_location).await
    }

    pub async fn add_hard_drive(
        &self,
        name: &str,
        vhd_path: &str,
        controller_type: &str,
        controller_number: u32,
        controller_location: u32,
    ) -> HyperVResult<()> {
        VmManager::add_hard_drive(
            &self.ps,
            name,
            vhd_path,
            controller_type,
            controller_number,
            controller_location,
        )
        .await
    }

    pub async fn remove_hard_drive(
        &self,
        name: &str,
        controller_type: &str,
        controller_number: u32,
        controller_location: u32,
    ) -> HyperVResult<()> {
        VmManager::remove_hard_drive(
            &self.ps,
            name,
            controller_type,
            controller_number,
            controller_location,
        )
        .await
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Snapshots / Checkpoints
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    pub async fn list_checkpoints(
        &self,
        vm_name: &str,
    ) -> HyperVResult<Vec<CheckpointInfo>> {
        SnapshotManager::list_checkpoints(&self.ps, vm_name).await
    }

    pub async fn get_checkpoint(
        &self,
        vm_name: &str,
        checkpoint_name: &str,
    ) -> HyperVResult<CheckpointInfo> {
        SnapshotManager::get_checkpoint(&self.ps, vm_name, checkpoint_name).await
    }

    pub async fn create_checkpoint(
        &self,
        vm_name: &str,
        config: &CreateCheckpointConfig,
    ) -> HyperVResult<CheckpointInfo> {
        SnapshotManager::create_checkpoint(&self.ps, vm_name, config).await
    }

    pub async fn restore_checkpoint(
        &self,
        vm_name: &str,
        checkpoint_name: &str,
    ) -> HyperVResult<()> {
        SnapshotManager::restore_checkpoint(&self.ps, vm_name, checkpoint_name).await
    }

    pub async fn restore_checkpoint_by_id(
        &self,
        vm_name: &str,
        checkpoint_id: &str,
    ) -> HyperVResult<()> {
        SnapshotManager::restore_checkpoint_by_id(&self.ps, vm_name, checkpoint_id).await
    }

    pub async fn remove_checkpoint(
        &self,
        vm_name: &str,
        checkpoint_name: &str,
    ) -> HyperVResult<()> {
        SnapshotManager::remove_checkpoint(&self.ps, vm_name, checkpoint_name).await
    }

    pub async fn remove_checkpoint_tree(
        &self,
        vm_name: &str,
        checkpoint_name: &str,
    ) -> HyperVResult<()> {
        SnapshotManager::remove_checkpoint_tree(&self.ps, vm_name, checkpoint_name).await
    }

    pub async fn remove_all_checkpoints(&self, vm_name: &str) -> HyperVResult<u32> {
        SnapshotManager::remove_all_checkpoints(&self.ps, vm_name).await
    }

    pub async fn rename_checkpoint(
        &self,
        vm_name: &str,
        old_name: &str,
        new_name: &str,
    ) -> HyperVResult<()> {
        SnapshotManager::rename_checkpoint(&self.ps, vm_name, old_name, new_name).await
    }

    pub async fn export_checkpoint(
        &self,
        vm_name: &str,
        checkpoint_name: &str,
        destination_path: &str,
    ) -> HyperVResult<()> {
        SnapshotManager::export_checkpoint(&self.ps, vm_name, checkpoint_name, destination_path)
            .await
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Networking
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    pub async fn list_switches(&self) -> HyperVResult<Vec<VirtualSwitchInfo>> {
        NetworkManager::list_switches(&self.ps).await
    }

    pub async fn get_switch(&self, name: &str) -> HyperVResult<VirtualSwitchInfo> {
        NetworkManager::get_switch(&self.ps, name).await
    }

    pub async fn create_switch(
        &self,
        config: &CreateSwitchConfig,
    ) -> HyperVResult<VirtualSwitchInfo> {
        NetworkManager::create_switch(&self.ps, config).await
    }

    pub async fn remove_switch(&self, name: &str) -> HyperVResult<()> {
        NetworkManager::remove_switch(&self.ps, name).await
    }

    pub async fn rename_switch(&self, name: &str, new_name: &str) -> HyperVResult<()> {
        NetworkManager::rename_switch(&self.ps, name, new_name).await
    }

    pub async fn list_physical_adapters(&self) -> HyperVResult<Vec<PhysicalAdapterInfo>> {
        NetworkManager::list_physical_adapters(&self.ps).await
    }

    pub async fn list_vm_adapters(
        &self,
        vm_name: &str,
    ) -> HyperVResult<Vec<VmNetworkAdapterInfo>> {
        NetworkManager::list_vm_adapters(&self.ps, vm_name).await
    }

    pub async fn add_vm_adapter(
        &self,
        vm_name: &str,
        config: &AddNetworkAdapterConfig,
    ) -> HyperVResult<()> {
        NetworkManager::add_vm_adapter(&self.ps, vm_name, config).await
    }

    pub async fn remove_vm_adapter(
        &self,
        vm_name: &str,
        adapter_name: &str,
    ) -> HyperVResult<()> {
        NetworkManager::remove_vm_adapter(&self.ps, vm_name, adapter_name).await
    }

    pub async fn connect_adapter(
        &self,
        vm_name: &str,
        adapter_name: &str,
        switch_name: &str,
    ) -> HyperVResult<()> {
        NetworkManager::connect_adapter(&self.ps, vm_name, adapter_name, switch_name).await
    }

    pub async fn disconnect_adapter(
        &self,
        vm_name: &str,
        adapter_name: &str,
    ) -> HyperVResult<()> {
        NetworkManager::disconnect_adapter(&self.ps, vm_name, adapter_name).await
    }

    pub async fn set_adapter_vlan(
        &self,
        vm_name: &str,
        adapter_name: &str,
        vlan_id: u32,
    ) -> HyperVResult<()> {
        NetworkManager::set_adapter_vlan(&self.ps, vm_name, adapter_name, vlan_id).await
    }

    pub async fn set_adapter_vlan_trunk(
        &self,
        vm_name: &str,
        adapter_name: &str,
        native_vlan_id: u32,
        allowed_vlan_list: &str,
    ) -> HyperVResult<()> {
        NetworkManager::set_adapter_vlan_trunk(
            &self.ps,
            vm_name,
            adapter_name,
            native_vlan_id,
            allowed_vlan_list,
        )
        .await
    }

    pub async fn remove_adapter_vlan(
        &self,
        vm_name: &str,
        adapter_name: &str,
    ) -> HyperVResult<()> {
        NetworkManager::remove_adapter_vlan(&self.ps, vm_name, adapter_name).await
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Storage (VHD/VHDX)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    pub async fn get_vhd(&self, path: &str) -> HyperVResult<VhdInfo> {
        StorageManager::get_vhd(&self.ps, path).await
    }

    pub async fn test_vhd(&self, path: &str) -> HyperVResult<bool> {
        StorageManager::test_vhd(&self.ps, path).await
    }

    pub async fn create_vhd(&self, config: &VhdCreateConfig) -> HyperVResult<VhdInfo> {
        StorageManager::create_vhd(&self.ps, config).await
    }

    pub async fn resize_vhd(&self, config: &VhdResizeConfig) -> HyperVResult<VhdInfo> {
        StorageManager::resize_vhd(&self.ps, config).await
    }

    pub async fn convert_vhd(&self, config: &VhdConvertConfig) -> HyperVResult<VhdInfo> {
        StorageManager::convert_vhd(&self.ps, config).await
    }

    pub async fn compact_vhd(&self, path: &str) -> HyperVResult<VhdInfo> {
        StorageManager::compact_vhd(&self.ps, path).await
    }

    pub async fn optimize_vhd(&self, path: &str) -> HyperVResult<VhdInfo> {
        StorageManager::optimize_vhd(&self.ps, path).await
    }

    pub async fn merge_vhd(&self, path: &str) -> HyperVResult<()> {
        StorageManager::merge_vhd(&self.ps, path).await
    }

    pub async fn mount_vhd(&self, path: &str, read_only: bool) -> HyperVResult<String> {
        StorageManager::mount_vhd(&self.ps, path, read_only).await
    }

    pub async fn dismount_vhd(&self, path: &str) -> HyperVResult<()> {
        StorageManager::dismount_vhd(&self.ps, path).await
    }

    pub async fn delete_vhd(&self, path: &str) -> HyperVResult<()> {
        StorageManager::delete_vhd(&self.ps, path).await
    }

    pub async fn list_vm_hard_drives(
        &self,
        vm_name: &str,
    ) -> HyperVResult<Vec<VmHardDriveInfo>> {
        StorageManager::list_vm_hard_drives(&self.ps, vm_name).await
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Metrics / Monitoring
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    pub async fn get_vm_metrics(&self, vm_name: &str) -> HyperVResult<VmMetrics> {
        MetricsManager::get_vm_metrics(&self.ps, vm_name).await
    }

    pub async fn get_all_vm_metrics(&self) -> HyperVResult<Vec<VmMetrics>> {
        MetricsManager::get_all_vm_metrics(&self.ps).await
    }

    pub async fn enable_metering(&self, vm_name: &str) -> HyperVResult<()> {
        MetricsManager::enable_metering(&self.ps, vm_name).await
    }

    pub async fn disable_metering(&self, vm_name: &str) -> HyperVResult<()> {
        MetricsManager::disable_metering(&self.ps, vm_name).await
    }

    pub async fn reset_metering(&self, vm_name: &str) -> HyperVResult<()> {
        MetricsManager::reset_metering(&self.ps, vm_name).await
    }

    pub async fn get_metering_report(
        &self,
        vm_name: &str,
    ) -> HyperVResult<serde_json::Value> {
        MetricsManager::get_metering_report(&self.ps, vm_name).await
    }

    pub async fn get_host_info(&self) -> HyperVResult<HostInfo> {
        MetricsManager::get_host_info(&self.ps).await
    }

    pub async fn get_hyperv_events(
        &self,
        max_events: u32,
        log_name: Option<&str>,
    ) -> HyperVResult<serde_json::Value> {
        MetricsManager::get_hyperv_events(&self.ps, max_events, log_name).await
    }

    pub async fn set_host_paths(
        &self,
        vm_path: Option<&str>,
        vhd_path: Option<&str>,
    ) -> HyperVResult<()> {
        MetricsManager::set_host_paths(&self.ps, vm_path, vhd_path).await
    }

    pub async fn set_live_migration(
        &self,
        enabled: bool,
        max_migrations: Option<u32>,
        max_storage_migrations: Option<u32>,
    ) -> HyperVResult<()> {
        MetricsManager::set_live_migration(&self.ps, enabled, max_migrations, max_storage_migrations)
            .await
    }

    pub async fn set_numa_spanning(&self, enabled: bool) -> HyperVResult<()> {
        MetricsManager::set_numa_spanning(&self.ps, enabled).await
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Replication
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    pub async fn get_replication(
        &self,
        vm_name: &str,
    ) -> HyperVResult<VmReplicationInfo> {
        ReplicationManager::get_replication(&self.ps, vm_name).await
    }

    pub async fn list_replicated_vms(&self) -> HyperVResult<Vec<VmReplicationInfo>> {
        ReplicationManager::list_replicated_vms(&self.ps).await
    }

    pub async fn enable_replication(
        &self,
        vm_name: &str,
        config: &EnableReplicationConfig,
    ) -> HyperVResult<()> {
        ReplicationManager::enable_replication(&self.ps, vm_name, config).await
    }

    pub async fn disable_replication(&self, vm_name: &str) -> HyperVResult<()> {
        ReplicationManager::disable_replication(&self.ps, vm_name).await
    }

    pub async fn start_initial_replication(&self, vm_name: &str) -> HyperVResult<()> {
        ReplicationManager::start_initial_replication(&self.ps, vm_name).await
    }

    pub async fn suspend_replication(&self, vm_name: &str) -> HyperVResult<()> {
        ReplicationManager::suspend_replication(&self.ps, vm_name).await
    }

    pub async fn resume_replication(&self, vm_name: &str) -> HyperVResult<()> {
        ReplicationManager::resume_replication(&self.ps, vm_name).await
    }

    pub async fn planned_failover(&self, vm_name: &str) -> HyperVResult<()> {
        ReplicationManager::planned_failover(&self.ps, vm_name).await
    }

    pub async fn unplanned_failover(&self, vm_name: &str) -> HyperVResult<()> {
        ReplicationManager::unplanned_failover(&self.ps, vm_name).await
    }

    pub async fn complete_failover(&self, vm_name: &str) -> HyperVResult<()> {
        ReplicationManager::complete_failover(&self.ps, vm_name).await
    }

    pub async fn cancel_failover(&self, vm_name: &str) -> HyperVResult<()> {
        ReplicationManager::cancel_failover(&self.ps, vm_name).await
    }

    pub async fn reverse_replication(&self, vm_name: &str) -> HyperVResult<()> {
        ReplicationManager::reverse_replication(&self.ps, vm_name).await
    }

    pub async fn start_test_failover(
        &self,
        vm_name: &str,
        switch_name: Option<&str>,
    ) -> HyperVResult<String> {
        ReplicationManager::start_test_failover(&self.ps, vm_name, switch_name).await
    }

    pub async fn stop_test_failover(&self, vm_name: &str) -> HyperVResult<()> {
        ReplicationManager::stop_test_failover(&self.ps, vm_name).await
    }
}
