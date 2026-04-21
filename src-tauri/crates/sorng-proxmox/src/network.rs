//! Network interface management via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct NetworkManager<'a> {
    client: &'a PveClient,
}

impl<'a> NetworkManager<'a> {
    pub fn new(client: &'a PveClient) -> Self {
        Self { client }
    }

    /// List network interfaces on a node.
    pub async fn list_interfaces(
        &self,
        node: &str,
        iface_type: Option<&str>,
    ) -> ProxmoxResult<Vec<NetworkInterface>> {
        let path = format!("/api2/json/nodes/{node}/network");
        if let Some(t) = iface_type {
            self.client.get_with_params(&path, &[("type", t)]).await
        } else {
            self.client.get(&path).await
        }
    }

    /// Get a specific network interface.
    pub async fn get_interface(&self, node: &str, iface: &str) -> ProxmoxResult<NetworkInterface> {
        let path = format!("/api2/json/nodes/{node}/network/{iface}");
        self.client.get(&path).await
    }

    /// Create a network interface.
    pub async fn create_interface(
        &self,
        node: &str,
        params: &CreateNetworkParams,
    ) -> ProxmoxResult<()> {
        let json = serde_json::to_value(params)
            .map_err(|e| crate::error::ProxmoxError::parse(format!("Serialization error: {e}")))?;
        let form_params = crate::lxc::json_to_form_params(&json);
        let borrowed: Vec<(&str, &str)> = form_params
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let path = format!("/api2/json/nodes/{node}/network");
        let _: serde_json::Value = self.client.post_form(&path, &borrowed).await?;
        Ok(())
    }

    /// Update a network interface.
    pub async fn update_interface(
        &self,
        node: &str,
        iface: &str,
        params: &[(&str, &str)],
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/network/{iface}");
        self.client.put_form(&path, params).await
    }

    /// Delete a network interface.
    pub async fn delete_interface(&self, node: &str, iface: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/network/{iface}");
        self.client.delete(&path).await
    }

    /// Apply / revert pending network changes.
    pub async fn apply_network_changes(&self, node: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/network");
        self.client.put_form(&path, &[]).await?;
        Ok(None)
    }

    /// Revert pending network changes.
    pub async fn revert_network_changes(&self, node: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/network");
        self.client.delete(&path).await
    }
}
