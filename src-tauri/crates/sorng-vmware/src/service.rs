//! Aggregate service façade for the VMware crate.
//!
//! `VmwareService` owns the `VsphereClient` and `VmrcManager` and
//! exposes every domain operation. The Tauri `State` wrapper holds
//! `VmwareServiceState = Arc<Mutex<VmwareService>>`.

use crate::error::{VmwareError, VmwareResult};
use crate::host::HostManager;
use crate::metrics::MetricsManager;
use crate::network::NetworkManager;
use crate::snapshot::SnapshotManager;
use crate::storage::StorageManager;
use crate::types::*;
use crate::vm::VmManager;
use crate::vmrc::VmrcManager;
use crate::vsphere::VsphereClient;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Thread-safe handle managed by Tauri.
pub type VmwareServiceState = Arc<Mutex<VmwareService>>;

/// Top-level service that aggregates all VMware subsystems.
pub struct VmwareService {
    client: Option<VsphereClient>,
    vmrc: VmrcManager,
    config: Option<VsphereConfig>,
}

impl VmwareService {
    /// Create a new (disconnected) service.
    pub fn new() -> Self {
        Self {
            client: None,
            vmrc: VmrcManager::new(),
            config: None,
        }
    }

    /// Whether we have an active vSphere session.
    pub fn is_connected(&self) -> bool {
        self.client
            .as_ref()
            .map(|c| c.is_connected())
            .unwrap_or(false)
    }

    fn require_client(&self) -> VmwareResult<&VsphereClient> {
        self.client
            .as_ref()
            .filter(|c| c.is_connected())
            .ok_or_else(|| {
                VmwareError::connection("Not connected to vSphere. Call vmware_connect first.")
            })
    }

    // ── Connection ──────────────────────────────────────────────────

    /// Connect to a vCenter / ESXi host.
    pub async fn connect(&mut self, config: VsphereConfig) -> VmwareResult<String> {
        let mut client = VsphereClient::new(&config)?;
        client.login().await?;
        let session = client
            .session_id()
            .unwrap_or_default()
            .to_string();
        self.config = Some(config);
        self.client = Some(client);
        Ok(session)
    }

    /// Disconnect from vSphere.
    pub async fn disconnect(&mut self) -> VmwareResult<()> {
        if let Some(ref mut client) = self.client {
            let _ = client.logout().await;
        }
        self.client = None;
        self.config = None;
        Ok(())
    }

    /// Check if the session is still valid.
    pub async fn check_session(&self) -> VmwareResult<bool> {
        if let Some(ref client) = self.client {
            client.check_session().await
        } else {
            Ok(false)
        }
    }

    /// Get current config (without password).
    pub fn get_config(&self) -> Option<VsphereConfigSafe> {
        self.config.as_ref().map(|c| VsphereConfigSafe {
            host: c.host.clone(),
            port: c.port,
            username: c.username.clone(),
            insecure: c.insecure,
        })
    }

    // ── VM operations ───────────────────────────────────────────────

    pub async fn list_vms(&self) -> VmwareResult<Vec<VmSummary>> {
        let c = self.require_client()?;
        VmManager::new(c).list_all_vms().await
    }

    pub async fn list_running_vms(&self) -> VmwareResult<Vec<VmSummary>> {
        let c = self.require_client()?;
        VmManager::new(c).list_running_vms().await
    }

    pub async fn get_vm(&self, vm_id: &str) -> VmwareResult<VmInfo> {
        let c = self.require_client()?;
        VmManager::new(c).get_vm(vm_id).await
    }

    pub async fn create_vm(&self, spec: &VmCreateSpec) -> VmwareResult<String> {
        let c = self.require_client()?;
        VmManager::new(c).create_vm(spec).await
    }

    pub async fn delete_vm(&self, vm_id: &str) -> VmwareResult<()> {
        let c = self.require_client()?;
        VmManager::new(c).delete_vm(vm_id).await
    }

    pub async fn power_on_vm(&self, vm_id: &str) -> VmwareResult<()> {
        let c = self.require_client()?;
        VmManager::new(c).power_on(vm_id).await
    }

    pub async fn power_off_vm(&self, vm_id: &str) -> VmwareResult<()> {
        let c = self.require_client()?;
        VmManager::new(c).power_off(vm_id).await
    }

    pub async fn suspend_vm(&self, vm_id: &str) -> VmwareResult<()> {
        let c = self.require_client()?;
        VmManager::new(c).suspend(vm_id).await
    }

    pub async fn reset_vm(&self, vm_id: &str) -> VmwareResult<()> {
        let c = self.require_client()?;
        VmManager::new(c).reset(vm_id).await
    }

    pub async fn shutdown_guest(&self, vm_id: &str) -> VmwareResult<()> {
        let c = self.require_client()?;
        VmManager::new(c).shutdown_guest(vm_id).await
    }

    pub async fn reboot_guest(&self, vm_id: &str) -> VmwareResult<()> {
        let c = self.require_client()?;
        VmManager::new(c).reboot_guest(vm_id).await
    }

    pub async fn get_guest_identity(&self, vm_id: &str) -> VmwareResult<GuestIdentity> {
        let c = self.require_client()?;
        VmManager::new(c).get_guest_identity(vm_id).await
    }

    pub async fn update_vm_cpu(&self, vm_id: &str, spec: &VmCpuUpdate) -> VmwareResult<()> {
        let c = self.require_client()?;
        VmManager::new(c).update_cpu(vm_id, spec).await
    }

    pub async fn update_vm_memory(
        &self,
        vm_id: &str,
        spec: &VmMemoryUpdate,
    ) -> VmwareResult<()> {
        let c = self.require_client()?;
        VmManager::new(c).update_memory(vm_id, spec).await
    }

    pub async fn clone_vm(&self, spec: &VmCloneSpec) -> VmwareResult<String> {
        let c = self.require_client()?;
        VmManager::new(c).clone_vm(spec).await
    }

    pub async fn relocate_vm(
        &self,
        vm_id: &str,
        spec: &VmRelocateSpec,
    ) -> VmwareResult<()> {
        let c = self.require_client()?;
        VmManager::new(c).relocate_vm(vm_id, spec).await
    }

    pub async fn find_vm_by_name(&self, name: &str) -> VmwareResult<Option<VmSummary>> {
        let c = self.require_client()?;
        VmManager::new(c).find_vm_by_name(name).await
    }

    pub async fn get_vm_power_state(&self, vm_id: &str) -> VmwareResult<VmPowerState> {
        let c = self.require_client()?;
        VmManager::new(c).get_power_state(vm_id).await
    }

    // ── Snapshot operations ─────────────────────────────────────────

    pub async fn list_snapshots(&self, vm_id: &str) -> VmwareResult<Vec<SnapshotSummary>> {
        let c = self.require_client()?;
        SnapshotManager::new(c).list_snapshots(vm_id).await
    }

    pub async fn create_snapshot(
        &self,
        vm_id: &str,
        spec: &CreateSnapshotSpec,
    ) -> VmwareResult<String> {
        let c = self.require_client()?;
        SnapshotManager::new(c).create_snapshot(vm_id, spec).await
    }

    pub async fn revert_to_snapshot(
        &self,
        vm_id: &str,
        snapshot_id: &str,
    ) -> VmwareResult<()> {
        let c = self.require_client()?;
        SnapshotManager::new(c)
            .revert_to_snapshot(vm_id, snapshot_id)
            .await
    }

    pub async fn delete_snapshot(
        &self,
        vm_id: &str,
        snapshot_id: &str,
        children: bool,
    ) -> VmwareResult<()> {
        let c = self.require_client()?;
        SnapshotManager::new(c)
            .delete_snapshot(vm_id, snapshot_id, children)
            .await
    }

    pub async fn delete_all_snapshots(&self, vm_id: &str) -> VmwareResult<()> {
        let c = self.require_client()?;
        SnapshotManager::new(c)
            .delete_all_snapshots(vm_id)
            .await
    }

    // ── Network operations ──────────────────────────────────────────

    pub async fn list_networks(&self) -> VmwareResult<Vec<NetworkSummary>> {
        let c = self.require_client()?;
        NetworkManager::new(c).list_networks().await
    }

    pub async fn get_network(&self, network_id: &str) -> VmwareResult<NetworkInfo> {
        let c = self.require_client()?;
        NetworkManager::new(c).get_network(network_id).await
    }

    // ── Storage operations ──────────────────────────────────────────

    pub async fn list_datastores(&self) -> VmwareResult<Vec<DatastoreSummary>> {
        let c = self.require_client()?;
        StorageManager::new(c).list_datastores().await
    }

    pub async fn get_datastore(&self, datastore_id: &str) -> VmwareResult<DatastoreInfo> {
        let c = self.require_client()?;
        StorageManager::new(c).get_datastore(datastore_id).await
    }

    // ── Host operations ─────────────────────────────────────────────

    pub async fn list_hosts(&self) -> VmwareResult<Vec<HostSummary>> {
        let c = self.require_client()?;
        HostManager::new(c).list_hosts().await
    }

    pub async fn get_host(&self, host_id: &str) -> VmwareResult<HostInfo> {
        let c = self.require_client()?;
        HostManager::new(c).get_host(host_id).await
    }

    pub async fn disconnect_host(&self, host_id: &str) -> VmwareResult<()> {
        let c = self.require_client()?;
        HostManager::new(c).disconnect_host(host_id).await
    }

    pub async fn reconnect_host(&self, host_id: &str) -> VmwareResult<()> {
        let c = self.require_client()?;
        HostManager::new(c).reconnect_host(host_id).await
    }

    pub async fn list_clusters(&self) -> VmwareResult<Vec<ClusterSummary>> {
        let c = self.require_client()?;
        HostManager::new(c).list_clusters().await
    }

    pub async fn list_datacenters(&self) -> VmwareResult<Vec<DatacenterSummary>> {
        let c = self.require_client()?;
        HostManager::new(c).list_datacenters().await
    }

    pub async fn list_folders(&self) -> VmwareResult<Vec<FolderSummary>> {
        let c = self.require_client()?;
        HostManager::new(c).list_folders().await
    }

    pub async fn list_resource_pools(&self) -> VmwareResult<Vec<ResourcePoolSummary>> {
        let c = self.require_client()?;
        HostManager::new(c).list_resource_pools().await
    }

    // ── Metrics ─────────────────────────────────────────────────────

    pub async fn get_vm_quick_stats(&self, vm_id: &str) -> VmwareResult<VmQuickStats> {
        let c = self.require_client()?;
        MetricsManager::new(c).get_vm_quick_stats(vm_id).await
    }

    pub async fn get_all_vm_stats(&self) -> VmwareResult<Vec<VmQuickStats>> {
        let c = self.require_client()?;
        MetricsManager::new(c).get_all_vm_stats().await
    }

    pub async fn get_inventory_summary(
        &self,
    ) -> VmwareResult<crate::metrics::InventorySummary> {
        let c = self.require_client()?;
        MetricsManager::new(c).get_inventory_summary().await
    }

    // ── Console (cross-platform, WebSocket) ────────────────────────

    /// Acquire a console ticket from the vSphere REST API.
    ///
    /// Returns a [`ConsoleTicket`] with the one-time-use ticket string,
    /// the ESXi host, port, and TLS thumbprint.
    pub async fn acquire_console_ticket(
        &self,
        vm_id: &str,
        ticket_type: ConsoleTicketType,
    ) -> VmwareResult<ConsoleTicket> {
        let client = self.require_client()?;
        self.vmrc.acquire_console_ticket(client, vm_id, ticket_type).await
    }

    /// Open a cross-platform console for a VM.
    ///
    /// Acquires a console ticket and starts a local TCP proxy that
    /// bridges the Tauri webview (plain WS) to the ESXi host (TLS).
    pub async fn open_console(
        &self,
        req: &OpenConsoleRequest,
    ) -> VmwareResult<ConsoleSession> {
        let client = self.require_client()?;
        self.vmrc.open_console(client, req).await
    }

    /// Close a console proxy session.
    pub async fn close_console(&self, session_id: &str) -> VmwareResult<()> {
        self.vmrc.close_console(session_id).await
    }

    /// Close all console proxy sessions.
    pub async fn close_all_consoles(&self) -> u32 {
        self.vmrc.close_all_consoles().await
    }

    /// List active console proxy sessions.
    pub async fn list_console_sessions(&self) -> Vec<ConsoleSession> {
        self.vmrc.list_console_sessions().await
    }

    /// Get a specific console session.
    pub async fn get_console_session(
        &self,
        session_id: &str,
    ) -> VmwareResult<ConsoleSession> {
        self.vmrc.get_console_session(session_id).await
    }

    // ── VMRC / Horizon (binary fallback) ────────────────────────────

    pub async fn launch_vmrc(
        &self,
        config: &VmrcConnectionConfig,
    ) -> VmwareResult<VmrcSession> {
        self.vmrc.launch(config).await
    }

    pub async fn list_vmrc_sessions(&self) -> Vec<VmrcSession> {
        self.vmrc.list_sessions().await
    }

    pub async fn close_vmrc_session(&self, session_id: &str) -> VmwareResult<()> {
        self.vmrc.close_session(session_id).await
    }

    pub async fn close_all_vmrc_sessions(&self) -> u32 {
        self.vmrc.close_all_sessions().await
    }

    pub fn is_vmrc_available(&self) -> bool {
        VmrcManager::is_vmrc_available()
    }

    pub fn is_horizon_available(&self) -> bool {
        VmrcManager::is_horizon_available()
    }
}

/// Config without the password, safe to send to the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VsphereConfigSafe {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub insecure: bool,
}
