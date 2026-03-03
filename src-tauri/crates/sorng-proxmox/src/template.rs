//! Appliance template management via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct TemplateManager<'a> {
    client: &'a PveClient,
}

impl<'a> TemplateManager<'a> {
    pub fn new(client: &'a PveClient) -> Self { Self { client } }

    /// List available appliance templates (TurnKey Linux, etc.).
    pub async fn list_appliance_templates(&self, node: &str) -> ProxmoxResult<Vec<ApplianceTemplate>> {
        let path = format!("/api2/json/nodes/{node}/aplinfo");
        self.client.get(&path).await
    }

    /// Download an appliance template to a storage.
    pub async fn download_appliance(
        &self,
        node: &str,
        storage: &str,
        template: &str,
    ) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/aplinfo");
        self.client.post_form::<String>(&path, &[
            ("storage", storage),
            ("template", template),
        ]).await
    }

    /// List available ISO images on a storage.
    pub async fn list_isos(&self, node: &str, storage: &str) -> ProxmoxResult<Vec<StorageContent>> {
        let path = format!("/api2/json/nodes/{node}/storage/{storage}/content");
        self.client.get_with_params(&path, &[("content", "iso")]).await
    }

    /// List container templates on a storage.
    pub async fn list_container_templates(&self, node: &str, storage: &str) -> ProxmoxResult<Vec<StorageContent>> {
        let path = format!("/api2/json/nodes/{node}/storage/{storage}/content");
        self.client.get_with_params(&path, &[("content", "vztmpl")]).await
    }
}
