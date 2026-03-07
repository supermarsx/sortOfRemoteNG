// ── sorng-netbox/src/virtualization.rs ───────────────────────────────────────
//! Virtualization management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct VirtualizationManager;

impl VirtualizationManager {
    // ── Virtual Machines ─────────────────────────────────────────────

    pub async fn list_vms(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<VirtualMachine>> {
        client.api_get_paginated("virtualization/virtual-machines", params).await
    }

    pub async fn get_vm(client: &NetboxClient, id: i64) -> NetboxResult<VirtualMachine> {
        client.api_get(&format!("virtualization/virtual-machines/{id}")).await
    }

    pub async fn create_vm(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<VirtualMachine> {
        client.api_post("virtualization/virtual-machines", data).await
    }

    pub async fn update_vm(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<VirtualMachine> {
        client.api_put(&format!("virtualization/virtual-machines/{id}"), data).await
    }

    pub async fn delete_vm(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("virtualization/virtual-machines/{id}")).await
    }

    // ── VM Interfaces ────────────────────────────────────────────────

    pub async fn list_vm_interfaces(
        client: &NetboxClient,
        vm_id: i64,
    ) -> NetboxResult<PaginatedResponse<VmInterface>> {
        let vid = vm_id.to_string();
        client.api_get_paginated("virtualization/interfaces", &[("virtual_machine_id", &vid)]).await
    }

    pub async fn create_vm_interface(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<VmInterface> {
        client.api_post("virtualization/interfaces", data).await
    }

    pub async fn update_vm_interface(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<VmInterface> {
        client.api_put(&format!("virtualization/interfaces/{id}"), data).await
    }

    pub async fn delete_vm_interface(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("virtualization/interfaces/{id}")).await
    }

    // ── Clusters ─────────────────────────────────────────────────────

    pub async fn list_clusters(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<Cluster>> {
        client.api_get_paginated("virtualization/clusters", &[]).await
    }

    pub async fn get_cluster(client: &NetboxClient, id: i64) -> NetboxResult<Cluster> {
        client.api_get(&format!("virtualization/clusters/{id}")).await
    }

    pub async fn create_cluster(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<Cluster> {
        client.api_post("virtualization/clusters", data).await
    }

    pub async fn update_cluster(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Cluster> {
        client.api_put(&format!("virtualization/clusters/{id}"), data).await
    }

    pub async fn delete_cluster(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("virtualization/clusters/{id}")).await
    }

    // ── Cluster Types ────────────────────────────────────────────────

    pub async fn list_cluster_types(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<ClusterType>> {
        client.api_get_paginated("virtualization/cluster-types", &[]).await
    }

    pub async fn get_cluster_type(
        client: &NetboxClient,
        id: i64,
    ) -> NetboxResult<ClusterType> {
        client.api_get(&format!("virtualization/cluster-types/{id}")).await
    }

    pub async fn create_cluster_type(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<ClusterType> {
        client.api_post("virtualization/cluster-types", data).await
    }

    // ── Cluster Groups ───────────────────────────────────────────────

    pub async fn list_cluster_groups(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<ClusterGroup>> {
        client.api_get_paginated("virtualization/cluster-groups", &[]).await
    }
}
