//! VM and infrastructure performance metrics via the vSphere REST API.
//!
//! The vSphere REST API does not expose a rich performance-metrics endpoint
//! comparable to the SOAP `PerformanceManager`. We derive quick-stats from
//! the VM summary objects and collect what the REST API offers.

use crate::error::VmwareResult;
use crate::types::*;
use crate::vsphere::VsphereClient;

/// Performance / metrics helper.
pub struct MetricsManager<'a> {
    client: &'a VsphereClient,
}

impl<'a> MetricsManager<'a> {
    pub fn new(client: &'a VsphereClient) -> Self {
        Self { client }
    }

    /// Get quick stats for a single VM.
    ///
    /// This is synthesized from the VM detail endpoint (power state,
    /// CPU count, memory, etc.) since the REST API does not have a
    /// dedicated real-time metrics endpoint like the SOAP API does.
    pub async fn get_vm_quick_stats(&self, vm_id: &str) -> VmwareResult<VmQuickStats> {
        let path = format!("/api/vcenter/vm/{vm_id}");
        let info: VmInfo = self.client.get(&path).await?;

        let cpu_count = info.cpu.as_ref().and_then(|c| c.count);
        let memory_mib = info.memory.as_ref().and_then(|m| m.size_mib);

        Ok(VmQuickStats {
            vm: vm_id.to_string(),
            name: info.name,
            power_state: info.power_state,
            cpu_count,
            memory_size_mib: memory_mib,
            cpu_usage_mhz: None,
            memory_usage_mib: None,
            storage_used_bytes: None,
            uptime_seconds: None,
            guest_os: None,
            ip_address: None,
            host_name: None,
            tools_status: None,
            tools_version: None,
        })
    }

    /// Get quick stats for all VMs.
    pub async fn get_all_vm_stats(&self) -> VmwareResult<Vec<VmQuickStats>> {
        let vms: Vec<VmSummary> = self
            .client
            .get("/api/vcenter/vm")
            .await?;

        let mut stats = Vec::with_capacity(vms.len());
        for vm in &vms {
            let qs = VmQuickStats {
                vm: vm.vm.clone(),
                name: vm.name.clone(),
                power_state: vm.power_state.clone(),
                cpu_count: vm.cpu_count,
                memory_size_mib: vm.memory_size_mib,
                cpu_usage_mhz: None,
                memory_usage_mib: None,
                storage_used_bytes: None,
                uptime_seconds: None,
                guest_os: None,
                ip_address: None,
                host_name: None,
                tools_status: None,
                tools_version: None,
            };
            stats.push(qs);
        }

        Ok(stats)
    }

    /// Summarise cluster-level resource usage by host.
    pub async fn get_cluster_host_stats(
        &self,
        cluster_id: &str,
    ) -> VmwareResult<Vec<HostResourceStats>> {
        let hosts: Vec<HostSummary> = self
            .client
            .get_with_params(
                "/api/vcenter/host",
                &[("clusters".into(), cluster_id.to_string())],
            )
            .await?;

        let mut results = Vec::new();
        for host in hosts {
            let _detail: HostInfo = self
                .client
                .get(&format!("/api/vcenter/host/{}", host.host))
                .await?;

            results.push(HostResourceStats {
                host: host.host,
                name: host.name,
                connection_state: host.connection_state,
                power_state: host.power_state.unwrap_or_default(),
            });
        }

        Ok(results)
    }

    /// Get a datacenter / folder inventory as a flat structure for dashboard.
    pub async fn get_inventory_summary(&self) -> VmwareResult<InventorySummary> {
        let dcs: Vec<DatacenterSummary> = self
            .client
            .get("/api/vcenter/datacenter")
            .await
            .unwrap_or_default();
        let clusters: Vec<ClusterSummary> = self
            .client
            .get("/api/vcenter/cluster")
            .await
            .unwrap_or_default();
        let hosts: Vec<HostSummary> = self
            .client
            .get("/api/vcenter/host")
            .await
            .unwrap_or_default();
        let vms: Vec<VmSummary> = self
            .client
            .get("/api/vcenter/vm")
            .await
            .unwrap_or_default();
        let datastores: Vec<DatastoreSummary> = self
            .client
            .get("/api/vcenter/datastore")
            .await
            .unwrap_or_default();
        let networks: Vec<NetworkSummary> = self
            .client
            .get("/api/vcenter/network")
            .await
            .unwrap_or_default();

        let powered_on = vms
            .iter()
            .filter(|v| matches!(v.power_state, VmPowerState::PoweredOn))
            .count();

        Ok(InventorySummary {
            datacenter_count: dcs.len() as u32,
            cluster_count: clusters.len() as u32,
            host_count: hosts.len() as u32,
            vm_count: vms.len() as u32,
            vm_powered_on: powered_on as u32,
            datastore_count: datastores.len() as u32,
            network_count: networks.len() as u32,
        })
    }
}

// ── Extra types ─────────────────────────────────────────────────────

/// Per-host resource summary.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HostResourceStats {
    pub host: String,
    pub name: String,
    pub connection_state: HostConnectionState,
    pub power_state: HostPowerState,
}

/// Top-level vCenter inventory counts for a dashboard.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InventorySummary {
    pub datacenter_count: u32,
    pub cluster_count: u32,
    pub host_count: u32,
    pub vm_count: u32,
    pub vm_powered_on: u32,
    pub datastore_count: u32,
    pub network_count: u32,
}
