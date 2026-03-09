//! Resource pool management via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct PoolManager<'a> {
    client: &'a PveClient,
}

impl<'a> PoolManager<'a> {
    pub fn new(client: &'a PveClient) -> Self {
        Self { client }
    }

    /// List all pools.
    pub async fn list_pools(&self) -> ProxmoxResult<Vec<PoolSummary>> {
        self.client.get("/api2/json/pools").await
    }

    /// Get pool details with members.
    pub async fn get_pool(&self, poolid: &str) -> ProxmoxResult<PoolInfo> {
        let path = format!("/api2/json/pools/{poolid}");
        self.client.get(&path).await
    }

    /// Create a pool.
    pub async fn create_pool(&self, poolid: &str, comment: Option<&str>) -> ProxmoxResult<()> {
        let mut params = vec![("poolid", poolid)];
        if let Some(c) = comment {
            params.push(("comment", c));
        }
        let _: serde_json::Value = self.client.post_form("/api2/json/pools", &params).await?;
        Ok(())
    }

    /// Update a pool (comment).
    pub async fn update_pool(&self, poolid: &str, comment: Option<&str>) -> ProxmoxResult<()> {
        let path = format!("/api2/json/pools/{poolid}");
        let mut params: Vec<(&str, &str)> = Vec::new();
        if let Some(c) = comment {
            params.push(("comment", c));
        }
        self.client.put_form(&path, &params).await
    }

    /// Delete a pool.
    pub async fn delete_pool(&self, poolid: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/pools/{poolid}");
        self.client.delete(&path).await
    }

    /// Add member (VM/CT/storage) to a pool.
    pub async fn add_pool_member(
        &self,
        poolid: &str,
        vms: Option<&str>,
        storage: Option<&str>,
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/pools/{poolid}");
        let mut params: Vec<(&str, &str)> = Vec::new();
        if let Some(v) = vms {
            params.push(("vms", v));
        }
        if let Some(s) = storage {
            params.push(("storage", s));
        }
        self.client.put_form(&path, &params).await
    }

    /// Remove member from a pool.
    pub async fn remove_pool_member(
        &self,
        poolid: &str,
        vms: Option<&str>,
        storage: Option<&str>,
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/pools/{poolid}");
        let mut params: Vec<(&str, &str)> = vec![("delete", "1")];
        if let Some(v) = vms {
            params.push(("vms", v));
        }
        if let Some(s) = storage {
            params.push(("storage", s));
        }
        self.client.put_form(&path, &params).await
    }
}
