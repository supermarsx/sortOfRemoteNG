//! Virtual media — mount/unmount ISO, floppy, USB images.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;

/// Virtual media management (ISO/floppy/USB mount).
pub struct VirtualMediaManager<'a> {
    client: &'a IdracClient,
}

impl<'a> VirtualMediaManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// List virtual media slots and their status.
    pub async fn list_virtual_media(&self) -> IdracResult<Vec<VirtualMediaStatus>> {
        let rf = self.client.require_redfish()?;

        let col: serde_json::Value = rf
            .get("/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia?$expand=*($levels=1)")
            .await?;

        let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

        Ok(members
            .iter()
            .map(|m| VirtualMediaStatus {
                id: m.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: m.get("Name").and_then(|v| v.as_str()).unwrap_or("VMedia").to_string(),
                media_types: m.get("MediaTypes").and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default(),
                image: m.get("Image").and_then(|v| v.as_str()).map(|s| s.to_string()),
                image_name: m.get("ImageName").and_then(|v| v.as_str()).map(|s| s.to_string()),
                inserted: m.get("Inserted").and_then(|v| v.as_bool()).unwrap_or(false),
                connected: m.get("ConnectedVia").and_then(|v| v.as_str()).map(|s| s != "NotConnected").unwrap_or(false),
                write_protected: m.get("WriteProtected").and_then(|v| v.as_bool()).unwrap_or(true),
                transfer_method: m.get("TransferMethod").and_then(|v| v.as_str()).map(|s| s.to_string()),
                transfer_protocol_type: m.get("TransferProtocolType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                connected_via: m.get("ConnectedVia").and_then(|v| v.as_str()).map(|s| s.to_string()),
            })
            .collect())
    }

    /// Mount a virtual media image (ISO, floppy, USB).
    pub async fn mount_image(&self, params: VirtualMediaMountParams) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let media_id = params.media_id.as_deref().unwrap_or("CD");

        let mut body = serde_json::json!({
            "Image": params.image_uri,
        });

        if let Some(user) = &params.username {
            body["UserName"] = serde_json::Value::String(user.clone());
        }
        if let Some(pass) = &params.password {
            body["Password"] = serde_json::Value::String(pass.clone());
        }
        if let Some(tp) = &params.transfer_protocol {
            body["TransferProtocolType"] = serde_json::Value::String(tp.clone());
        }

        // Try InsertMedia action first (iDRAC 9)
        let action_url = format!(
            "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{}/Actions/VirtualMedia.InsertMedia",
            media_id
        );

        match rf.post_action(&action_url, &body).await {
            Ok(_) => Ok(()),
            Err(_) => {
                // Fallback: PATCH the VirtualMedia resource directly (iDRAC 8)
                let patch_body = serde_json::json!({
                    "Image": params.image_uri,
                    "Inserted": true,
                });
                rf.patch_json(
                    &format!("/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{}", media_id),
                    &patch_body,
                )
                .await
            }
        }
    }

    /// Unmount (eject) a virtual media image.
    pub async fn unmount_image(&self, media_id: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let action_url = format!(
            "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{}/Actions/VirtualMedia.EjectMedia",
            media_id
        );

        match rf.post_action(&action_url, &serde_json::json!({})).await {
            Ok(_) => Ok(()),
            Err(_) => {
                // Fallback: PATCH with empty Image
                let body = serde_json::json!({
                    "Image": null,
                    "Inserted": false,
                });
                rf.patch_json(
                    &format!("/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{}", media_id),
                    &body,
                )
                .await
            }
        }
    }

    /// Set boot-once from virtual CD.
    pub async fn boot_from_virtual_cd(&self) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "Boot": {
                "BootSourceOverrideTarget": "Cd",
                "BootSourceOverrideEnabled": "Once"
            }
        });

        rf.patch_json("/redfish/v1/Systems/System.Embedded.1", &body).await
    }

    /// Get the status of a specific virtual media slot.
    pub async fn get_virtual_media_status(&self, media_id: &str) -> IdracResult<VirtualMediaStatus> {
        let rf = self.client.require_redfish()?;

        let m: serde_json::Value = rf
            .get(&format!(
                "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{}",
                media_id
            ))
            .await?;

        Ok(VirtualMediaStatus {
            id: m.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            name: m.get("Name").and_then(|v| v.as_str()).unwrap_or("VMedia").to_string(),
            media_types: m.get("MediaTypes").and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default(),
            image: m.get("Image").and_then(|v| v.as_str()).map(|s| s.to_string()),
            image_name: m.get("ImageName").and_then(|v| v.as_str()).map(|s| s.to_string()),
            inserted: m.get("Inserted").and_then(|v| v.as_bool()).unwrap_or(false),
            connected: m.get("ConnectedVia").and_then(|v| v.as_str()).map(|s| s != "NotConnected").unwrap_or(false),
            write_protected: m.get("WriteProtected").and_then(|v| v.as_bool()).unwrap_or(true),
            transfer_method: m.get("TransferMethod").and_then(|v| v.as_str()).map(|s| s.to_string()),
            transfer_protocol_type: m.get("TransferProtocolType").and_then(|v| v.as_str()).map(|s| s.to_string()),
            connected_via: m.get("ConnectedVia").and_then(|v| v.as_str()).map(|s| s.to_string()),
        })
    }
}
