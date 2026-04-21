//! Virtual media — mount/unmount ISO/floppy images.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Virtual media operations.
pub struct VirtualMediaManager<'a> {
    client: &'a IloClient,
}

impl<'a> VirtualMediaManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get virtual media status.
    pub async fn get_status(&self) -> IloResult<Vec<BmcVirtualMedia>> {
        if let Ok(rf) = self.client.require_redfish() {
            let items: Vec<serde_json::Value> = rf.get_virtual_media().await?;
            let mut result = Vec::new();

            for vm in &items {
                result.push(BmcVirtualMedia {
                    id: vm
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    media_types: vm
                        .get("MediaTypes")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default(),
                    image: vm
                        .get("Image")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    inserted: vm
                        .get("Inserted")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                    write_protected: vm
                        .get("WriteProtected")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true),
                    connected_via: vm
                        .get("ConnectedVia")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                });
            }
            return Ok(result);
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let status = ribcl.get_vm_status().await?;
            let mut result = Vec::new();

            // RIBCL returns VM_APPLET info
            let image = status
                .get("IMAGE_URL")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let device = status
                .get("DEVICE")
                .and_then(|v| v.as_str())
                .unwrap_or("CDROM");
            let inserted = status
                .get("VM_APPLET")
                .and_then(|v| v.as_str())
                .map(|s| s == "CONNECTED")
                .unwrap_or(false);

            result.push(BmcVirtualMedia {
                id: device.to_string(),
                media_types: vec![if device.contains("FLOPPY") {
                    "Floppy".to_string()
                } else {
                    "CD".to_string()
                }],
                image,
                inserted,
                write_protected: true,
                connected_via: Some("URI".to_string()),
            });

            return Ok(result);
        }

        Err(IloError::unsupported(
            "No protocol available for virtual media",
        ))
    }

    /// Mount virtual media image.
    pub async fn insert_media(&self, image_url: &str, media_id: Option<&str>) -> IloResult<()> {
        if let Ok(rf) = self.client.require_redfish() {
            let id = media_id.unwrap_or("2"); // CD/DVD is usually slot 2
            rf.insert_virtual_media(id, image_url).await?;
            return Ok(());
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            ribcl.insert_virtual_media(image_url).await?;
            return Ok(());
        }

        Err(IloError::unsupported(
            "No protocol available for mounting virtual media",
        ))
    }

    /// Eject virtual media.
    pub async fn eject_media(&self, media_id: Option<&str>) -> IloResult<()> {
        if let Ok(rf) = self.client.require_redfish() {
            let id = media_id.unwrap_or("2");
            rf.eject_virtual_media(id).await?;
            return Ok(());
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            ribcl.eject_virtual_media().await?;
            return Ok(());
        }

        Err(IloError::unsupported(
            "No protocol available for ejecting virtual media",
        ))
    }

    /// Set one-time boot from virtual media.
    pub async fn set_boot_once(&self) -> IloResult<()> {
        if let Ok(ribcl) = self.client.require_ribcl() {
            ribcl.set_vm_boot_once().await?;
            return Ok(());
        }

        // Redfish: set boot override
        if let Ok(rf) = self.client.require_redfish() {
            let body = serde_json::json!({
                "Boot": {
                    "BootSourceOverrideEnabled": "Once",
                    "BootSourceOverrideTarget": "Cd"
                }
            });
            rf.inner.patch_json("/redfish/v1/Systems/1", &body).await?;
            return Ok(());
        }

        Err(IloError::unsupported(
            "No protocol available for boot override",
        ))
    }
}
