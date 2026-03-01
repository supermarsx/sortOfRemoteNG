//! ESXi host management via the vSphere REST API.

use crate::error::VmwareResult;
use crate::types::*;
use crate::vsphere::VsphereClient;

/// ESXi host operations.
pub struct HostManager<'a> {
    client: &'a VsphereClient,
}

impl<'a> HostManager<'a> {
    pub fn new(client: &'a VsphereClient) -> Self {
        Self { client }
    }

    // ── List / Get ──────────────────────────────────────────────────

    /// List all ESXi hosts.
    pub async fn list_hosts(&self) -> VmwareResult<Vec<HostSummary>> {
        self.client
            .get::<Vec<HostSummary>>("/api/vcenter/host")
            .await
    }

    /// List hosts in a specific cluster.
    pub async fn list_hosts_in_cluster(
        &self,
        cluster_id: &str,
    ) -> VmwareResult<Vec<HostSummary>> {
        self.client
            .get_with_params::<Vec<HostSummary>>(
                "/api/vcenter/host",
                &[("clusters".into(), cluster_id.to_string())],
            )
            .await
    }

    /// List hosts in a datacenter.
    pub async fn list_hosts_in_datacenter(
        &self,
        datacenter: &str,
    ) -> VmwareResult<Vec<HostSummary>> {
        self.client
            .get_with_params::<Vec<HostSummary>>(
                "/api/vcenter/host",
                &[("datacenters".into(), datacenter.to_string())],
            )
            .await
    }

    /// List connected hosts only.
    pub async fn list_connected_hosts(&self) -> VmwareResult<Vec<HostSummary>> {
        self.client
            .get_with_params::<Vec<HostSummary>>(
                "/api/vcenter/host",
                &[("connection_states".into(), "CONNECTED".to_string())],
            )
            .await
    }

    /// Get full details of a host.
    pub async fn get_host(&self, host_id: &str) -> VmwareResult<HostInfo> {
        let path = format!("/api/vcenter/host/{host_id}");
        self.client.get::<HostInfo>(&path).await
    }

    // ── Connection lifecycle ────────────────────────────────────────

    /// Disconnect a host from vCenter.
    pub async fn disconnect_host(&self, host_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/host/{host_id}?action=disconnect");
        self.client.post_empty(&path).await
    }

    /// Reconnect a host to vCenter.
    pub async fn reconnect_host(&self, host_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/host/{host_id}?action=connect");
        self.client.post_empty(&path).await
    }

    /// Remove a host from inventory.
    pub async fn remove_host(&self, host_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/host/{host_id}");
        self.client.delete(&path).await
    }

    // ── Maintenance mode ────────────────────────────────────────────

    /// Enter maintenance mode.
    ///
    /// Note: The vSphere REST API does not have a dedicated maintenance-mode
    /// toggle. This is provided as a placeholder that maps to the
    /// host-specific action when available in newer API versions. For now
    /// it returns an error indicating the operation must be done via the
    /// SOAP/MOB API or PowerCLI.
    pub async fn enter_maintenance_mode(&self, _host_id: &str) -> VmwareResult<()> {
        // vSphere REST API v7 does not have /host/{id}?action=enter_maintenance
        // This would need the SOAP API or PowerCLI. Providing a stub.
        Err(crate::error::VmwareError::new(
            crate::error::VmwareErrorKind::Other,
            "Enter maintenance mode is not available via the vSphere REST API. \
             Use PowerCLI: Set-VMHost -VMHost <host> -State Maintenance",
        ))
    }

    /// Exit maintenance mode.
    pub async fn exit_maintenance_mode(&self, _host_id: &str) -> VmwareResult<()> {
        Err(crate::error::VmwareError::new(
            crate::error::VmwareErrorKind::Other,
            "Exit maintenance mode is not available via the vSphere REST API. \
             Use PowerCLI: Set-VMHost -VMHost <host> -State Connected",
        ))
    }

    // ── Convenience ─────────────────────────────────────────────────

    /// Find a host by name (case-insensitive).
    pub async fn find_host_by_name(&self, name: &str) -> VmwareResult<Option<HostSummary>> {
        let hosts = self
            .client
            .get_with_params::<Vec<HostSummary>>(
                "/api/vcenter/host",
                &[("names".into(), name.to_string())],
            )
            .await?;
        Ok(hosts.into_iter().next())
    }

    /// Get VMs running on a specific host.
    pub async fn get_vms_on_host(&self, host_id: &str) -> VmwareResult<Vec<VmSummary>> {
        self.client
            .get_with_params::<Vec<VmSummary>>(
                "/api/vcenter/vm",
                &[("hosts".into(), host_id.to_string())],
            )
            .await
    }

    // ── Cluster / Datacenter / Folder helpers ───────────────────────

    /// List all clusters.
    pub async fn list_clusters(&self) -> VmwareResult<Vec<ClusterSummary>> {
        self.client
            .get::<Vec<ClusterSummary>>("/api/vcenter/cluster")
            .await
    }

    /// List all datacenters.
    pub async fn list_datacenters(&self) -> VmwareResult<Vec<DatacenterSummary>> {
        self.client
            .get::<Vec<DatacenterSummary>>("/api/vcenter/datacenter")
            .await
    }

    /// List all folders.
    pub async fn list_folders(&self) -> VmwareResult<Vec<FolderSummary>> {
        self.client
            .get::<Vec<FolderSummary>>("/api/vcenter/folder")
            .await
    }

    /// List resource pools.
    pub async fn list_resource_pools(&self) -> VmwareResult<Vec<ResourcePoolSummary>> {
        self.client
            .get::<Vec<ResourcePoolSummary>>("/api/vcenter/resource-pool")
            .await
    }
}
