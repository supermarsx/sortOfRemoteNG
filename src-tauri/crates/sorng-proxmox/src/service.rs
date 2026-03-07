//! Aggregate service façade for the Proxmox VE crate.
//!
//! `ProxmoxService` owns the `PveClient` and exposes every domain operation.
//! The Tauri `State` wrapper holds
//! `ProxmoxServiceState = Arc<Mutex<ProxmoxService>>`.

use crate::backup::BackupManager;
use crate::ceph::CephManager;
use crate::client::PveClient;
use crate::cluster::ClusterManager;
use crate::console::ConsoleManager;
use crate::error::{ProxmoxError, ProxmoxResult};
use crate::firewall::FirewallManager;
use crate::ha::HaManager;
use crate::lxc::LxcManager;
use crate::metrics::MetricsManager;
use crate::network::NetworkManager;
use crate::nodes::NodeManager;
use crate::pools::PoolManager;
use crate::qemu::QemuManager;
use crate::sdn::SdnManager;
use crate::snapshot::SnapshotManager;
use crate::storage::StorageManager;
use crate::tasks::TaskManager;
use crate::template::TemplateManager;
use crate::types::*;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Thread-safe handle managed by Tauri.
pub type ProxmoxServiceState = Arc<Mutex<ProxmoxService>>;

/// Top-level service that aggregates all Proxmox VE subsystems.
pub struct ProxmoxService {
    client: Option<PveClient>,
    config: Option<ProxmoxConfig>,
}

impl ProxmoxService {
    /// Create a new (disconnected) service.
    pub fn new() -> Self {
        Self {
            client: None,
            config: None,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.client.as_ref().map(|c| c.is_connected()).unwrap_or(false)
    }

    fn require_client(&self) -> ProxmoxResult<&PveClient> {
        self.client
            .as_ref()
            .filter(|c| c.is_connected())
            .ok_or_else(|| ProxmoxError::connection("Not connected to Proxmox VE. Call proxmox_connect first."))
    }

    // ── Connection ──────────────────────────────────────────────────

    pub async fn connect(&mut self, config: ProxmoxConfig) -> ProxmoxResult<String> {
        let mut client = PveClient::new(&config)?;
        client.login().await?;
        let msg = format!("Connected to {}", config.host);
        self.config = Some(config);
        self.client = Some(client);
        Ok(msg)
    }

    pub async fn disconnect(&mut self) -> ProxmoxResult<()> {
        if let Some(ref mut client) = self.client {
            let _ = client.logout().await;
        }
        self.client = None;
        self.config = None;
        Ok(())
    }

    pub async fn check_session(&self) -> ProxmoxResult<bool> {
        if let Some(ref client) = self.client {
            client.check_session().await
        } else {
            Ok(false)
        }
    }

    pub fn get_config(&self) -> Option<ProxmoxConfigSafe> {
        self.config.as_ref().map(|c| {
            let (auth_method, username, token_id) = match &c.auth {
                ProxmoxAuthMethod::Password { username, .. } => (
                    "password".to_string(),
                    Some(username.clone()),
                    None,
                ),
                ProxmoxAuthMethod::ApiToken { token_id, .. } => (
                    "apitoken".to_string(),
                    None,
                    Some(token_id.clone()),
                ),
            };
            ProxmoxConfigSafe {
                host: c.host.clone(),
                port: c.port,
                auth_method,
                username,
                token_id,
                insecure: c.insecure,
            }
        })
    }

    pub async fn get_version(&self) -> ProxmoxResult<PveVersion> {
        let c = self.require_client()?;
        ClusterManager::new(c).get_version().await
    }

    // ── Node operations ─────────────────────────────────────────────

    pub async fn list_nodes(&self) -> ProxmoxResult<Vec<NodeSummary>> {
        let c = self.require_client()?;
        NodeManager::new(c).list_nodes().await
    }

    pub async fn get_node_status(&self, node: &str) -> ProxmoxResult<NodeStatus> {
        let c = self.require_client()?;
        NodeManager::new(c).get_node_status(node).await
    }

    pub async fn list_node_services(&self, node: &str) -> ProxmoxResult<Vec<NodeService>> {
        let c = self.require_client()?;
        NodeManager::new(c).list_services(node).await
    }

    pub async fn start_node_service(&self, node: &str, service: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        NodeManager::new(c).start_service(node, service).await
    }

    pub async fn stop_node_service(&self, node: &str, service: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        NodeManager::new(c).stop_service(node, service).await
    }

    pub async fn restart_node_service(&self, node: &str, service: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        NodeManager::new(c).restart_service(node, service).await
    }

    pub async fn get_node_dns(&self, node: &str) -> ProxmoxResult<NodeDns> {
        let c = self.require_client()?;
        NodeManager::new(c).get_dns(node).await
    }

    pub async fn get_node_syslog(
        &self, node: &str, start: Option<u64>, limit: Option<u64>,
        since: Option<&str>, until: Option<&str>, service: Option<&str>,
    ) -> ProxmoxResult<Vec<SyslogEntry>> {
        let c = self.require_client()?;
        NodeManager::new(c).get_syslog(node, start, limit, since, until, service).await
    }

    pub async fn list_apt_updates(&self, node: &str) -> ProxmoxResult<Vec<AptUpdate>> {
        let c = self.require_client()?;
        NodeManager::new(c).list_apt_updates(node).await
    }

    pub async fn reboot_node(&self, node: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        NodeManager::new(c).reboot_node(node).await
    }

    pub async fn shutdown_node(&self, node: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        NodeManager::new(c).shutdown_node(node).await
    }

    // ── QEMU VM operations ──────────────────────────────────────────

    pub async fn list_qemu_vms(&self, node: &str) -> ProxmoxResult<Vec<QemuVmSummary>> {
        let c = self.require_client()?;
        QemuManager::new(c).list_vms(node).await
    }

    pub async fn get_qemu_status(&self, node: &str, vmid: u64) -> ProxmoxResult<QemuStatusCurrent> {
        let c = self.require_client()?;
        QemuManager::new(c).get_status(node, vmid).await
    }

    pub async fn get_qemu_config(&self, node: &str, vmid: u64) -> ProxmoxResult<QemuConfig> {
        let c = self.require_client()?;
        QemuManager::new(c).get_config(node, vmid).await
    }

    pub async fn create_qemu_vm(&self, node: &str, params: &QemuCreateParams) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).create_vm(node, params).await.map(Some)
    }

    pub async fn delete_qemu_vm(&self, node: &str, vmid: u64, purge: bool, destroy_unreferenced: bool) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).delete_vm(node, vmid, purge, destroy_unreferenced).await
    }

    pub async fn start_qemu_vm(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).start_vm(node, vmid).await
    }

    pub async fn stop_qemu_vm(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).stop_vm(node, vmid).await
    }

    pub async fn shutdown_qemu_vm(&self, node: &str, vmid: u64, force: bool, timeout: Option<u64>) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).shutdown_vm(node, vmid, force, timeout).await
    }

    pub async fn reboot_qemu_vm(&self, node: &str, vmid: u64, timeout: Option<u64>) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).reboot_vm(node, vmid, timeout).await
    }

    pub async fn suspend_qemu_vm(&self, node: &str, vmid: u64, to_disk: bool) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).suspend_vm(node, vmid, to_disk).await
    }

    pub async fn resume_qemu_vm(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).resume_vm(node, vmid).await
    }

    pub async fn reset_qemu_vm(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).reset_vm(node, vmid).await
    }

    pub async fn update_qemu_config(&self, node: &str, vmid: u64, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let c = self.require_client()?;
        QemuManager::new(c).update_config(node, vmid, params).await
    }

    pub async fn resize_qemu_disk(&self, node: &str, vmid: u64, params: &DiskResizeParams) -> ProxmoxResult<()> {
        let c = self.require_client()?;
        QemuManager::new(c).resize_disk_params(node, vmid, params).await
    }

    pub async fn clone_qemu_vm(&self, node: &str, vmid: u64, params: &QemuCloneParams) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).clone_vm(node, vmid, params).await.map(Some)
    }

    pub async fn migrate_qemu_vm(&self, node: &str, vmid: u64, params: &QemuMigrateParams) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        QemuManager::new(c).migrate_vm(node, vmid, params).await.map(Some)
    }

    pub async fn convert_qemu_to_template(&self, node: &str, vmid: u64) -> ProxmoxResult<()> {
        let c = self.require_client()?;
        QemuManager::new(c).convert_to_template(node, vmid).await
    }

    pub async fn qemu_agent_exec(&self, node: &str, vmid: u64, command: &str) -> ProxmoxResult<serde_json::Value> {
        let c = self.require_client()?;
        QemuManager::new(c).agent_exec(node, vmid, command).await
    }

    pub async fn qemu_agent_network(&self, node: &str, vmid: u64) -> ProxmoxResult<QemuAgentInfo> {
        let c = self.require_client()?;
        QemuManager::new(c).agent_network_interfaces(node, vmid).await
    }

    pub async fn qemu_agent_osinfo(&self, node: &str, vmid: u64) -> ProxmoxResult<QemuAgentInfo> {
        let c = self.require_client()?;
        QemuManager::new(c).agent_os_info(node, vmid).await
    }

    pub async fn get_next_vmid(&self) -> ProxmoxResult<u64> {
        let c = self.require_client()?;
        QemuManager::new(c).get_next_vmid().await
    }

    // ── LXC container operations ────────────────────────────────────

    pub async fn list_lxc_containers(&self, node: &str) -> ProxmoxResult<Vec<LxcSummary>> {
        let c = self.require_client()?;
        LxcManager::new(c).list_containers(node).await
    }

    pub async fn get_lxc_status(&self, node: &str, vmid: u64) -> ProxmoxResult<LxcStatusCurrent> {
        let c = self.require_client()?;
        LxcManager::new(c).get_status(node, vmid).await
    }

    pub async fn get_lxc_config(&self, node: &str, vmid: u64) -> ProxmoxResult<LxcConfig> {
        let c = self.require_client()?;
        LxcManager::new(c).get_config(node, vmid).await
    }

    pub async fn create_lxc_container(&self, node: &str, params: &LxcCreateParams) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        LxcManager::new(c).create_container(node, params).await.map(Some)
    }

    pub async fn delete_lxc_container(&self, node: &str, vmid: u64, purge: bool, force: bool) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        LxcManager::new(c).delete_container(node, vmid, purge, force).await
    }

    pub async fn start_lxc_container(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        LxcManager::new(c).start_container(node, vmid).await
    }

    pub async fn stop_lxc_container(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        LxcManager::new(c).stop_container(node, vmid).await
    }

    pub async fn shutdown_lxc_container(&self, node: &str, vmid: u64, force: bool, timeout: Option<u64>) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        LxcManager::new(c).shutdown_container(node, vmid, force, timeout).await
    }

    pub async fn reboot_lxc_container(&self, node: &str, vmid: u64, timeout: Option<u64>) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        LxcManager::new(c).reboot_container(node, vmid, timeout).await
    }

    pub async fn clone_lxc_container(&self, node: &str, vmid: u64, params: &LxcCloneParams) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        LxcManager::new(c).clone_container(node, vmid, params).await.map(Some)
    }

    pub async fn migrate_lxc_container(&self, node: &str, vmid: u64, params: &LxcMigrateParams) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        LxcManager::new(c).migrate_container(node, vmid, params).await.map(Some)
    }

    // ── Storage ─────────────────────────────────────────────────────

    pub async fn list_storage(&self, node: &str) -> ProxmoxResult<Vec<StorageSummary>> {
        let c = self.require_client()?;
        StorageManager::new(c).list_storage(node).await
    }

    pub async fn list_storage_content(
        &self, node: &str, storage: &str, content_type: Option<&str>, vmid: Option<u64>,
    ) -> ProxmoxResult<Vec<StorageContent>> {
        let c = self.require_client()?;
        StorageManager::new(c).list_content(node, storage, content_type, vmid).await
    }

    pub async fn delete_storage_volume(&self, node: &str, storage: &str, volume: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        StorageManager::new(c).delete_volume(node, storage, volume).await
    }

    pub async fn download_to_storage(
        &self, node: &str, storage: &str, url: &str, content: &str, filename: &str,
    ) -> ProxmoxResult<String> {
        let c = self.require_client()?;
        StorageManager::new(c).download_url(node, storage, url, content, filename).await
    }

    // ── Network ─────────────────────────────────────────────────────

    pub async fn list_network_interfaces(&self, node: &str) -> ProxmoxResult<Vec<NetworkInterface>> {
        let c = self.require_client()?;
        NetworkManager::new(c).list_interfaces(node, None).await
    }

    pub async fn get_network_interface(&self, node: &str, iface: &str) -> ProxmoxResult<NetworkInterface> {
        let c = self.require_client()?;
        NetworkManager::new(c).get_interface(node, iface).await
    }

    pub async fn create_network_interface(&self, node: &str, params: &CreateNetworkParams) -> ProxmoxResult<()> {
        let c = self.require_client()?;
        NetworkManager::new(c).create_interface(node, params).await
    }

    pub async fn delete_network_interface(&self, node: &str, iface: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        NetworkManager::new(c).delete_interface(node, iface).await
    }

    pub async fn apply_network_changes(&self, node: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        NetworkManager::new(c).apply_network_changes(node).await
    }

    pub async fn revert_network_changes(&self, node: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        NetworkManager::new(c).revert_network_changes(node).await
    }

    // ── Cluster ─────────────────────────────────────────────────────

    pub async fn get_cluster_status(&self) -> ProxmoxResult<Vec<ClusterStatus>> {
        let c = self.require_client()?;
        ClusterManager::new(c).get_status().await
    }

    pub async fn list_cluster_resources(&self, resource_type: Option<&str>) -> ProxmoxResult<Vec<ClusterResource>> {
        let c = self.require_client()?;
        ClusterManager::new(c).list_resources(resource_type).await
    }

    pub async fn get_cluster_next_id(&self) -> ProxmoxResult<u64> {
        let c = self.require_client()?;
        ClusterManager::new(c).next_id().await
    }

    pub async fn list_users(&self) -> ProxmoxResult<Vec<PveUser>> {
        let c = self.require_client()?;
        ClusterManager::new(c).list_users().await
    }

    pub async fn list_roles(&self) -> ProxmoxResult<Vec<PveRole>> {
        let c = self.require_client()?;
        ClusterManager::new(c).list_roles().await
    }

    pub async fn list_groups(&self) -> ProxmoxResult<Vec<PveGroup>> {
        let c = self.require_client()?;
        ClusterManager::new(c).list_groups().await
    }

    // ── Tasks ───────────────────────────────────────────────────────

    pub async fn list_tasks(
        &self, node: &str, start: Option<u64>, limit: Option<u64>,
        vmid: Option<u64>, type_filter: Option<&str>, status_filter: Option<&str>,
    ) -> ProxmoxResult<Vec<TaskSummary>> {
        let c = self.require_client()?;
        TaskManager::new(c).list_tasks(node, start, limit, vmid, type_filter, status_filter).await
    }

    pub async fn get_task_status(&self, node: &str, upid: &str) -> ProxmoxResult<TaskStatus> {
        let c = self.require_client()?;
        TaskManager::new(c).get_task_status(node, upid).await
    }

    pub async fn get_task_log(&self, node: &str, upid: &str, start: Option<u64>, limit: Option<u64>) -> ProxmoxResult<Vec<TaskLogLine>> {
        let c = self.require_client()?;
        TaskManager::new(c).get_task_log(node, upid, start, limit).await
    }

    pub async fn stop_task(&self, node: &str, upid: &str) -> ProxmoxResult<()> {
        let c = self.require_client()?;
        TaskManager::new(c).stop_task(node, upid).await
    }

    // ── Backups ─────────────────────────────────────────────────────

    pub async fn list_backup_jobs(&self) -> ProxmoxResult<Vec<BackupJobConfig>> {
        let c = self.require_client()?;
        BackupManager::new(c).list_backup_jobs().await
    }

    pub async fn vzdump(&self, node: &str, params: &VzdumpParams) -> ProxmoxResult<String> {
        let c = self.require_client()?;
        BackupManager::new(c).vzdump(node, params).await
    }

    pub async fn restore_backup(
        &self, node: &str, vmid: u64, archive: &str, storage: Option<&str>, force: bool, unique: bool,
    ) -> ProxmoxResult<String> {
        let c = self.require_client()?;
        BackupManager::new(c).restore(node, vmid, archive, storage, force, unique).await
    }

    pub async fn list_backups(&self, node: &str, storage: &str, vmid: Option<u64>) -> ProxmoxResult<Vec<StorageContent>> {
        let c = self.require_client()?;
        BackupManager::new(c).list_backups(node, storage, vmid).await
    }

    // ── Firewall ────────────────────────────────────────────────────

    pub async fn get_cluster_firewall_options(&self) -> ProxmoxResult<FirewallOptions> {
        let c = self.require_client()?;
        FirewallManager::new(c).get_cluster_options().await
    }

    pub async fn list_cluster_firewall_rules(&self) -> ProxmoxResult<Vec<FirewallRule>> {
        let c = self.require_client()?;
        FirewallManager::new(c).list_cluster_rules().await
    }

    pub async fn list_security_groups(&self) -> ProxmoxResult<Vec<FirewallSecurityGroup>> {
        let c = self.require_client()?;
        FirewallManager::new(c).list_security_groups().await
    }

    pub async fn list_firewall_aliases(&self) -> ProxmoxResult<Vec<FirewallAlias>> {
        let c = self.require_client()?;
        FirewallManager::new(c).list_cluster_aliases().await
    }

    pub async fn list_firewall_ipsets(&self) -> ProxmoxResult<Vec<FirewallIpSet>> {
        let c = self.require_client()?;
        FirewallManager::new(c).list_cluster_ipsets().await
    }

    pub async fn list_guest_firewall_rules(
        &self, node: &str, guest_type: &str, vmid: u64,
    ) -> ProxmoxResult<Vec<FirewallRule>> {
        let c = self.require_client()?;
        FirewallManager::new(c).list_guest_rules(node, guest_type, vmid).await
    }

    // ── Pools ───────────────────────────────────────────────────────

    pub async fn list_pools(&self) -> ProxmoxResult<Vec<PoolSummary>> {
        let c = self.require_client()?;
        PoolManager::new(c).list_pools().await
    }

    pub async fn get_pool(&self, poolid: &str) -> ProxmoxResult<PoolInfo> {
        let c = self.require_client()?;
        PoolManager::new(c).get_pool(poolid).await
    }

    pub async fn create_pool(&self, poolid: &str, comment: Option<&str>) -> ProxmoxResult<()> {
        let c = self.require_client()?;
        PoolManager::new(c).create_pool(poolid, comment).await
    }

    pub async fn delete_pool(&self, poolid: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        PoolManager::new(c).delete_pool(poolid).await
    }

    // ── HA ──────────────────────────────────────────────────────────

    pub async fn list_ha_resources(&self) -> ProxmoxResult<Vec<HaResource>> {
        let c = self.require_client()?;
        HaManager::new(c).list_resources().await
    }

    pub async fn list_ha_groups(&self) -> ProxmoxResult<Vec<HaGroup>> {
        let c = self.require_client()?;
        HaManager::new(c).list_groups().await
    }

    // ── Ceph ────────────────────────────────────────────────────────

    pub async fn get_ceph_status(&self, node: &str) -> ProxmoxResult<CephStatus> {
        let c = self.require_client()?;
        CephManager::new(c).get_status(node).await
    }

    pub async fn list_ceph_pools(&self, node: &str) -> ProxmoxResult<Vec<CephPool>> {
        let c = self.require_client()?;
        CephManager::new(c).list_pools(node).await
    }

    pub async fn list_ceph_monitors(&self, node: &str) -> ProxmoxResult<Vec<CephMonitor>> {
        let c = self.require_client()?;
        CephManager::new(c).list_monitors(node).await
    }

    pub async fn list_ceph_osds(&self, node: &str) -> ProxmoxResult<serde_json::Value> {
        let c = self.require_client()?;
        CephManager::new(c).list_osds(node).await
    }

    // ── SDN ─────────────────────────────────────────────────────────

    pub async fn list_sdn_zones(&self) -> ProxmoxResult<Vec<SdnZone>> {
        let c = self.require_client()?;
        SdnManager::new(c).list_zones().await
    }

    pub async fn list_sdn_vnets(&self) -> ProxmoxResult<Vec<SdnVnet>> {
        let c = self.require_client()?;
        SdnManager::new(c).list_vnets().await
    }

    // ── Console ─────────────────────────────────────────────────────

    pub async fn qemu_vnc_proxy(&self, node: &str, vmid: u64) -> ProxmoxResult<VncTicket> {
        let c = self.require_client()?;
        ConsoleManager::new(c).qemu_vnc_proxy(node, vmid, true).await
    }

    pub async fn qemu_spice_proxy(&self, node: &str, vmid: u64) -> ProxmoxResult<SpiceTicket> {
        let c = self.require_client()?;
        ConsoleManager::new(c).qemu_spice_proxy(node, vmid).await
    }

    pub async fn qemu_termproxy(&self, node: &str, vmid: u64) -> ProxmoxResult<TermProxyTicket> {
        let c = self.require_client()?;
        ConsoleManager::new(c).qemu_termproxy(node, vmid).await
    }

    pub async fn lxc_vnc_proxy(&self, node: &str, vmid: u64) -> ProxmoxResult<VncTicket> {
        let c = self.require_client()?;
        ConsoleManager::new(c).lxc_vnc_proxy(node, vmid, true).await
    }

    pub async fn lxc_spice_proxy(&self, node: &str, vmid: u64) -> ProxmoxResult<SpiceTicket> {
        let c = self.require_client()?;
        ConsoleManager::new(c).lxc_spice_proxy(node, vmid).await
    }

    pub async fn lxc_termproxy(&self, node: &str, vmid: u64) -> ProxmoxResult<TermProxyTicket> {
        let c = self.require_client()?;
        ConsoleManager::new(c).lxc_termproxy(node, vmid).await
    }

    pub async fn node_termproxy(&self, node: &str) -> ProxmoxResult<TermProxyTicket> {
        let c = self.require_client()?;
        ConsoleManager::new(c).node_termproxy(node).await
    }

    // ── Snapshots ───────────────────────────────────────────────────

    pub async fn list_qemu_snapshots(&self, node: &str, vmid: u64) -> ProxmoxResult<Vec<SnapshotSummary>> {
        let c = self.require_client()?;
        SnapshotManager::new(c).list_qemu_snapshots(node, vmid).await
    }

    pub async fn create_qemu_snapshot(&self, node: &str, vmid: u64, params: &CreateSnapshotParams) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        SnapshotManager::new(c).create_qemu_snapshot(node, vmid, params).await
    }

    pub async fn rollback_qemu_snapshot(&self, node: &str, vmid: u64, snapname: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        SnapshotManager::new(c).rollback_qemu_snapshot(node, vmid, snapname).await
    }

    pub async fn delete_qemu_snapshot(&self, node: &str, vmid: u64, snapname: &str, force: bool) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        SnapshotManager::new(c).delete_qemu_snapshot(node, vmid, snapname, force).await
    }

    pub async fn list_lxc_snapshots(&self, node: &str, vmid: u64) -> ProxmoxResult<Vec<SnapshotSummary>> {
        let c = self.require_client()?;
        SnapshotManager::new(c).list_lxc_snapshots(node, vmid).await
    }

    pub async fn create_lxc_snapshot(&self, node: &str, vmid: u64, params: &CreateSnapshotParams) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        SnapshotManager::new(c).create_lxc_snapshot(node, vmid, params).await
    }

    pub async fn rollback_lxc_snapshot(&self, node: &str, vmid: u64, snapname: &str) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        SnapshotManager::new(c).rollback_lxc_snapshot(node, vmid, snapname).await
    }

    pub async fn delete_lxc_snapshot(&self, node: &str, vmid: u64, snapname: &str, force: bool) -> ProxmoxResult<Option<String>> {
        let c = self.require_client()?;
        SnapshotManager::new(c).delete_lxc_snapshot(node, vmid, snapname, force).await
    }

    // ── Metrics / RRD ───────────────────────────────────────────────

    pub async fn node_rrd(&self, node: &str, timeframe: &str, cf: Option<&str>) -> ProxmoxResult<Vec<RrdDataPoint>> {
        let c = self.require_client()?;
        MetricsManager::new(c).node_rrd(node, timeframe, cf).await
    }

    pub async fn qemu_rrd(&self, node: &str, vmid: u64, timeframe: &str, cf: Option<&str>) -> ProxmoxResult<Vec<RrdDataPoint>> {
        let c = self.require_client()?;
        MetricsManager::new(c).qemu_rrd(node, vmid, timeframe, cf).await
    }

    pub async fn lxc_rrd(&self, node: &str, vmid: u64, timeframe: &str, cf: Option<&str>) -> ProxmoxResult<Vec<RrdDataPoint>> {
        let c = self.require_client()?;
        MetricsManager::new(c).lxc_rrd(node, vmid, timeframe, cf).await
    }

    // ── Templates ───────────────────────────────────────────────────

    pub async fn list_appliance_templates(&self, node: &str) -> ProxmoxResult<Vec<ApplianceTemplate>> {
        let c = self.require_client()?;
        TemplateManager::new(c).list_appliance_templates(node).await
    }

    pub async fn download_appliance(&self, node: &str, storage: &str, template: &str) -> ProxmoxResult<String> {
        let c = self.require_client()?;
        TemplateManager::new(c).download_appliance(node, storage, template).await
    }

    pub async fn list_isos(&self, node: &str, storage: &str) -> ProxmoxResult<Vec<StorageContent>> {
        let c = self.require_client()?;
        TemplateManager::new(c).list_isos(node, storage).await
    }

    pub async fn list_container_templates(&self, node: &str, storage: &str) -> ProxmoxResult<Vec<StorageContent>> {
        let c = self.require_client()?;
        TemplateManager::new(c).list_container_templates(node, storage).await
    }
}
