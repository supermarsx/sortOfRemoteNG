// ── sorng-netbox – Virtualization module ─────────────────────────────────────
//! Clusters, VMs, VM interfaces.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct VirtualizationManager;

impl VirtualizationManager {
    // ── Clusters ─────────────────────────────────────────────────────

    pub async fn list_clusters(client: &NetboxClient) -> NetboxResult<Vec<Cluster>> {
        client.api_get_list("/virtualization/clusters/").await
    }

    pub async fn get_cluster(client: &NetboxClient, id: i64) -> NetboxResult<Cluster> {
        let body = client.api_get(&format!("/virtualization/clusters/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_cluster: {e}")))
    }

    pub async fn create_cluster(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Cluster> {
        let body = client.api_post("/virtualization/clusters/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_cluster: {e}")))
    }

    pub async fn delete_cluster(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/virtualization/clusters/{id}/")).await?;
        Ok(())
    }

    // ── Cluster types ────────────────────────────────────────────────

    pub async fn list_cluster_types(client: &NetboxClient) -> NetboxResult<Vec<ClusterType>> {
        client.api_get_list("/virtualization/cluster-types/").await
    }

    // ── Cluster groups ───────────────────────────────────────────────

    pub async fn list_cluster_groups(client: &NetboxClient) -> NetboxResult<Vec<ClusterGroup>> {
        client.api_get_list("/virtualization/cluster-groups/").await
    }

    // ── Virtual machines ─────────────────────────────────────────────

    pub async fn list_vms(client: &NetboxClient) -> NetboxResult<Vec<VirtualMachine>> {
        client.api_get_list("/virtualization/virtual-machines/").await
    }

    pub async fn get_vm(client: &NetboxClient, id: i64) -> NetboxResult<VirtualMachine> {
        let body = client.api_get(&format!("/virtualization/virtual-machines/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_vm: {e}")))
    }

    pub async fn create_vm(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<VirtualMachine> {
        let body = client.api_post("/virtualization/virtual-machines/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_vm: {e}")))
    }

    pub async fn update_vm(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<VirtualMachine> {
        let body = client.api_patch(&format!("/virtualization/virtual-machines/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_vm: {e}")))
    }

    pub async fn delete_vm(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/virtualization/virtual-machines/{id}/")).await?;
        Ok(())
    }

    // ── VM interfaces ────────────────────────────────────────────────

    pub async fn list_vm_interfaces(client: &NetboxClient) -> NetboxResult<Vec<VMInterface>> {
        client.api_get_list("/virtualization/interfaces/").await
    }

    pub async fn create_vm_interface(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<VMInterface> {
        let body = client.api_post("/virtualization/interfaces/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_vm_interface: {e}")))
    }

    pub async fn delete_vm_interface(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/virtualization/interfaces/{id}/")).await?;
        Ok(())
    }
}
