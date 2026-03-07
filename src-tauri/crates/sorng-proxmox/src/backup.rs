//! Backup management (vzdump) via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct BackupManager<'a> {
    client: &'a PveClient,
}

impl<'a> BackupManager<'a> {
    pub fn new(client: &'a PveClient) -> Self { Self { client } }

    /// List backup jobs.
    pub async fn list_backup_jobs(&self) -> ProxmoxResult<Vec<BackupJobConfig>> {
        self.client.get("/api2/json/cluster/backup").await
    }

    /// Get a specific backup job.
    pub async fn get_backup_job(&self, id: &str) -> ProxmoxResult<BackupJobConfig> {
        let path = format!("/api2/json/cluster/backup/{id}");
        self.client.get(&path).await
    }

    /// Create a backup job.
    pub async fn create_backup_job(&self, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let _: serde_json::Value = self.client.post_form("/api2/json/cluster/backup", params).await?;
        Ok(())
    }

    /// Update a backup job.
    pub async fn update_backup_job(&self, id: &str, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let path = format!("/api2/json/cluster/backup/{id}");
        self.client.put_form(&path, params).await
    }

    /// Delete a backup job.
    pub async fn delete_backup_job(&self, id: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/backup/{id}");
        self.client.delete(&path).await
    }

    /// Run vzdump now (immediate backup).
    pub async fn vzdump(&self, node: &str, params: &VzdumpParams) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/vzdump");
        let json = serde_json::to_value(params)
            .map_err(|e| crate::error::ProxmoxError::parse(format!("Serialization error: {e}")))?;
        let form_params = crate::lxc::json_to_form_params(&json);
        let borrowed: Vec<(&str, &str)> = form_params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        self.client.post_form::<String>(&path, &borrowed).await
    }

    /// Restore a backup.
    pub async fn restore(
        &self,
        node: &str,
        vmid: u64,
        archive: &str,
        storage: Option<&str>,
        force: bool,
        unique: bool,
    ) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/qemu");
        let mut params: Vec<(&str, &str)> = vec![
            ("archive", archive),
            ("vmid", &vmid.to_string()),
        ];
        // We need owned strings for some params
        let vmid_str = vmid.to_string();
        params = vec![
            ("archive", archive),
            ("vmid", &vmid_str),
        ];
        if let Some(s) = storage { params.push(("storage", s)); }
        if force { params.push(("force", "1")); }
        if unique { params.push(("unique", "1")); }
        self.client.post_form::<String>(&path, &params).await
    }

    /// List backups in a storage.
    pub async fn list_backups(
        &self,
        node: &str,
        storage: &str,
        vmid: Option<u64>,
    ) -> ProxmoxResult<Vec<StorageContent>> {
        let mut params: Vec<(&str, String)> = vec![("content", "backup".to_string())];
        if let Some(id) = vmid { params.push(("vmid", id.to_string())); }
        let borrowed: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let path = format!("/api2/json/nodes/{node}/storage/{storage}/content");
        self.client.get_with_params(&path, &borrowed).await
    }
}
