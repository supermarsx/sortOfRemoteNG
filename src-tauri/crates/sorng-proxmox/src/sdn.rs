//! SDN (Software Defined Networking) via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct SdnManager<'a> {
    client: &'a PveClient,
}

impl<'a> SdnManager<'a> {
    pub fn new(client: &'a PveClient) -> Self {
        Self { client }
    }

    // ── Zones ───────────────────────────────────────────────────────

    pub async fn list_zones(&self) -> ProxmoxResult<Vec<SdnZone>> {
        self.client.get("/api2/json/cluster/sdn/zones").await
    }

    pub async fn get_zone(&self, zone: &str) -> ProxmoxResult<SdnZone> {
        let path = format!("/api2/json/cluster/sdn/zones/{zone}");
        self.client.get(&path).await
    }

    pub async fn create_zone(&self, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let _: serde_json::Value = self
            .client
            .post_form("/api2/json/cluster/sdn/zones", params)
            .await?;
        Ok(())
    }

    pub async fn update_zone(&self, zone: &str, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let path = format!("/api2/json/cluster/sdn/zones/{zone}");
        self.client.put_form(&path, params).await
    }

    pub async fn delete_zone(&self, zone: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/sdn/zones/{zone}");
        self.client.delete(&path).await
    }

    // ── VNets ───────────────────────────────────────────────────────

    pub async fn list_vnets(&self) -> ProxmoxResult<Vec<SdnVnet>> {
        self.client.get("/api2/json/cluster/sdn/vnets").await
    }

    pub async fn get_vnet(&self, vnet: &str) -> ProxmoxResult<SdnVnet> {
        let path = format!("/api2/json/cluster/sdn/vnets/{vnet}");
        self.client.get(&path).await
    }

    pub async fn create_vnet(&self, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let _: serde_json::Value = self
            .client
            .post_form("/api2/json/cluster/sdn/vnets", params)
            .await?;
        Ok(())
    }

    pub async fn update_vnet(&self, vnet: &str, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let path = format!("/api2/json/cluster/sdn/vnets/{vnet}");
        self.client.put_form(&path, params).await
    }

    pub async fn delete_vnet(&self, vnet: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/sdn/vnets/{vnet}");
        self.client.delete(&path).await
    }

    // ── Subnets ─────────────────────────────────────────────────────

    pub async fn list_subnets(&self, vnet: &str) -> ProxmoxResult<Vec<SdnSubnet>> {
        let path = format!("/api2/json/cluster/sdn/vnets/{vnet}/subnets");
        self.client.get(&path).await
    }

    pub async fn create_subnet(&self, vnet: &str, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let path = format!("/api2/json/cluster/sdn/vnets/{vnet}/subnets");
        let _: serde_json::Value = self.client.post_form(&path, params).await?;
        Ok(())
    }

    pub async fn delete_subnet(&self, vnet: &str, subnet: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/sdn/vnets/{vnet}/subnets/{subnet}");
        self.client.delete(&path).await
    }

    // ── Apply changes ───────────────────────────────────────────────

    pub async fn apply_sdn(&self) -> ProxmoxResult<Option<String>> {
        self.client.put_form("/api2/json/cluster/sdn", &[]).await?;
        Ok(None)
    }
}
