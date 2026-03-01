//! Network and port-group operations via the vSphere REST API.

use crate::error::VmwareResult;
use crate::types::*;
use crate::vsphere::VsphereClient;

/// Network / port-group operations.
pub struct NetworkManager<'a> {
    client: &'a VsphereClient,
}

impl<'a> NetworkManager<'a> {
    pub fn new(client: &'a VsphereClient) -> Self {
        Self { client }
    }

    // ── Global network inventory ────────────────────────────────────

    /// List all networks visible to the connected vCenter.
    pub async fn list_networks(&self) -> VmwareResult<Vec<NetworkSummary>> {
        self.client
            .get::<Vec<NetworkSummary>>("/api/vcenter/network")
            .await
    }

    /// List networks by type.
    pub async fn list_networks_by_type(&self, net_type: &str) -> VmwareResult<Vec<NetworkSummary>> {
        self.client
            .get_with_params::<Vec<NetworkSummary>>(
                "/api/vcenter/network",
                &[("types".into(), net_type.to_string())],
            )
            .await
    }

    /// List networks for a datacenter.
    pub async fn list_networks_in_datacenter(
        &self,
        datacenter: &str,
    ) -> VmwareResult<Vec<NetworkSummary>> {
        self.client
            .get_with_params::<Vec<NetworkSummary>>(
                "/api/vcenter/network",
                &[("datacenters".into(), datacenter.to_string())],
            )
            .await
    }

    /// Get details of a specific network.
    pub async fn get_network(&self, network_id: &str) -> VmwareResult<NetworkInfo> {
        let path = format!("/api/vcenter/network/{network_id}");
        self.client.get::<NetworkInfo>(&path).await
    }

    // ── VM NIC helpers ──────────────────────────────────────────────

    /// List NICs on a VM.
    pub async fn list_vm_nics(&self, vm_id: &str) -> VmwareResult<Vec<VmNicInfo>> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/ethernet");
        self.client.get::<Vec<VmNicInfo>>(&path).await
    }

    /// Get a specific NIC on a VM.
    pub async fn get_vm_nic(&self, vm_id: &str, nic_id: &str) -> VmwareResult<VmNicInfo> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/ethernet/{nic_id}");
        self.client.get::<VmNicInfo>(&path).await
    }

    /// Add a NIC to a VM.
    pub async fn add_vm_nic(&self, vm_id: &str, spec: &VmNicCreateSpec) -> VmwareResult<String> {
        #[derive(serde::Deserialize)]
        struct Created {
            value: String,
        }
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/ethernet");
        let resp: Created = self.client.post(&path, spec).await?;
        Ok(resp.value)
    }

    /// Update a NIC on a VM.
    pub async fn update_vm_nic(
        &self,
        vm_id: &str,
        nic_id: &str,
        spec: &VmNicUpdateSpec,
    ) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/ethernet/{nic_id}");
        self.client.patch(&path, spec).await
    }

    /// Remove a NIC from a VM.
    pub async fn remove_vm_nic(&self, vm_id: &str, nic_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/ethernet/{nic_id}");
        self.client.delete(&path).await
    }

    /// Connect a NIC.
    pub async fn connect_vm_nic(&self, vm_id: &str, nic_id: &str) -> VmwareResult<()> {
        let path = format!(
            "/api/vcenter/vm/{vm_id}/hardware/ethernet/{nic_id}?action=connect"
        );
        self.client.post_empty(&path).await
    }

    /// Disconnect a NIC.
    pub async fn disconnect_vm_nic(&self, vm_id: &str, nic_id: &str) -> VmwareResult<()> {
        let path = format!(
            "/api/vcenter/vm/{vm_id}/hardware/ethernet/{nic_id}?action=disconnect"
        );
        self.client.post_empty(&path).await
    }

    // ── Convenience ─────────────────────────────────────────────────

    /// Find a network by name (case-insensitive).
    pub async fn find_network_by_name(&self, name: &str) -> VmwareResult<Option<NetworkSummary>> {
        let nets = self
            .client
            .get_with_params::<Vec<NetworkSummary>>(
                "/api/vcenter/network",
                &[("names".into(), name.to_string())],
            )
            .await?;
        Ok(nets.into_iter().next())
    }
}

// ── Extra types for NIC CRUD ────────────────────────────────────────

/// NIC info returned from vSphere API.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmNicInfo {
    #[serde(default)]
    pub nic: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub mac_type: String,
    #[serde(default)]
    pub mac_address: String,
    #[serde(default)]
    pub backing: Option<VmNicBacking>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub start_connected: bool,
    #[serde(default)]
    pub allow_guest_control: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmNicBacking {
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub network: String,
    #[serde(default)]
    pub network_name: String,
}

/// Spec to create a NIC on a VM.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmNicCreateSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_connected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_guest_control: Option<bool>,
}

/// Spec to update a NIC on a VM.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmNicUpdateSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_connected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_guest_control: Option<bool>,
}
