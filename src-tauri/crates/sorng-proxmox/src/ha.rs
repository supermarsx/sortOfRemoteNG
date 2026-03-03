//! High Availability (HA) management via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct HaManager<'a> {
    client: &'a PveClient,
}

impl<'a> HaManager<'a> {
    pub fn new(client: &'a PveClient) -> Self { Self { client } }

    /// Get HA status.
    pub async fn get_status(&self) -> ProxmoxResult<Vec<serde_json::Value>> {
        self.client.get("/api2/json/cluster/ha/status/current").await
    }

    /// Get HA manager status.
    pub async fn get_manager_status(&self) -> ProxmoxResult<serde_json::Value> {
        self.client.get("/api2/json/cluster/ha/status/manager_status").await
    }

    /// List HA resources.
    pub async fn list_resources(&self) -> ProxmoxResult<Vec<HaResource>> {
        self.client.get("/api2/json/cluster/ha/resources").await
    }

    /// Get a specific HA resource.
    pub async fn get_resource(&self, sid: &str) -> ProxmoxResult<HaResource> {
        let path = format!("/api2/json/cluster/ha/resources/{sid}");
        self.client.get(&path).await
    }

    /// Create an HA resource.
    pub async fn create_resource(&self, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let _: serde_json::Value = self.client.post_form("/api2/json/cluster/ha/resources", params).await?;
        Ok(())
    }

    /// Update an HA resource.
    pub async fn update_resource(&self, sid: &str, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let path = format!("/api2/json/cluster/ha/resources/{sid}");
        self.client.put_form(&path, params).await
    }

    /// Delete an HA resource.
    pub async fn delete_resource(&self, sid: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/ha/resources/{sid}");
        self.client.delete(&path).await
    }

    /// Migrate an HA resource.
    pub async fn migrate_resource(&self, sid: &str, node: &str) -> ProxmoxResult<()> {
        let path = format!("/api2/json/cluster/ha/resources/{sid}/migrate");
        let _: serde_json::Value = self.client.post_form(&path, &[("node", node)]).await?;
        Ok(())
    }

    /// Relocate an HA resource.
    pub async fn relocate_resource(&self, sid: &str, node: &str) -> ProxmoxResult<()> {
        let path = format!("/api2/json/cluster/ha/resources/{sid}/relocate");
        let _: serde_json::Value = self.client.post_form(&path, &[("node", node)]).await?;
        Ok(())
    }

    /// List HA groups.
    pub async fn list_groups(&self) -> ProxmoxResult<Vec<HaGroup>> {
        self.client.get("/api2/json/cluster/ha/groups").await
    }

    /// Get a specific HA group.
    pub async fn get_group(&self, group: &str) -> ProxmoxResult<HaGroup> {
        let path = format!("/api2/json/cluster/ha/groups/{group}");
        self.client.get(&path).await
    }

    /// Create an HA group.
    pub async fn create_group(&self, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let _: serde_json::Value = self.client.post_form("/api2/json/cluster/ha/groups", params).await?;
        Ok(())
    }

    /// Update an HA group.
    pub async fn update_group(&self, group: &str, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let path = format!("/api2/json/cluster/ha/groups/{group}");
        self.client.put_form(&path, params).await
    }

    /// Delete an HA group.
    pub async fn delete_group(&self, group: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/ha/groups/{group}");
        self.client.delete(&path).await
    }
}
