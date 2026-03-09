//! Storage management via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct StorageManager<'a> {
    client: &'a PveClient,
}

impl<'a> StorageManager<'a> {
    pub fn new(client: &'a PveClient) -> Self {
        Self { client }
    }

    /// List all storage on a node.
    pub async fn list_storage(&self, node: &str) -> ProxmoxResult<Vec<StorageSummary>> {
        let path = format!("/api2/json/nodes/{node}/storage");
        self.client.get(&path).await
    }

    /// Get storage config (cluster-level).
    pub async fn get_storage_config(&self, storage: &str) -> ProxmoxResult<StorageConfig> {
        let path = format!("/api2/json/storage/{storage}");
        self.client.get(&path).await
    }

    /// List all storage definitions.
    pub async fn list_storage_definitions(&self) -> ProxmoxResult<Vec<StorageConfig>> {
        self.client.get("/api2/json/storage").await
    }

    /// List content of a storage on a node.
    pub async fn list_content(
        &self,
        node: &str,
        storage: &str,
        content_type: Option<&str>,
        vmid: Option<u64>,
    ) -> ProxmoxResult<Vec<StorageContent>> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(ct) = content_type {
            params.push(("content", ct.to_string()));
        }
        if let Some(id) = vmid {
            params.push(("vmid", id.to_string()));
        }
        let borrowed: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let path = format!("/api2/json/nodes/{node}/storage/{storage}/content");
        if borrowed.is_empty() {
            self.client.get(&path).await
        } else {
            self.client.get_with_params(&path, &borrowed).await
        }
    }

    /// Delete a volume.
    pub async fn delete_volume(
        &self,
        node: &str,
        storage: &str,
        volume: &str,
    ) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/storage/{storage}/content/{volume}");
        self.client.delete(&path).await
    }

    /// Download a URL to storage (ISO, container template, etc.).
    pub async fn download_url(
        &self,
        node: &str,
        storage: &str,
        url: &str,
        content: &str,
        filename: &str,
    ) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/storage/{storage}/download-url");
        self.client
            .post_form::<String>(
                &path,
                &[("url", url), ("content", content), ("filename", filename)],
            )
            .await
    }

    /// Get storage RRD stats.
    pub async fn get_rrd_data(
        &self,
        node: &str,
        storage: &str,
        timeframe: &str,
    ) -> ProxmoxResult<Vec<RrdDataPoint>> {
        let path = format!("/api2/json/nodes/{node}/storage/{storage}/rrddata");
        self.client
            .get_with_params(&path, &[("timeframe", timeframe)])
            .await
    }
}
