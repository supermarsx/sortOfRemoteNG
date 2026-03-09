//! Firmware management — inventory, DUP updates, repository.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;
use crate::wsman::dcim_classes;

/// Firmware management operations.
pub struct FirmwareManager<'a> {
    client: &'a IdracClient,
}

impl<'a> FirmwareManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// List all firmware/software inventory.
    pub async fn list_firmware(&self) -> IdracResult<Vec<FirmwareInventory>> {
        if let Ok(rf) = self.client.require_redfish() {
            let col: serde_json::Value = rf
                .get("/redfish/v1/UpdateService/FirmwareInventory?$expand=*($levels=1)")
                .await?;

            let members = col
                .get("Members")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            return Ok(members
                .iter()
                .map(|f| FirmwareInventory {
                    id: f
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: f
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Firmware")
                        .to_string(),
                    version: f
                        .get("Version")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    updateable: f
                        .get("Updateable")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                    status: ComponentHealth {
                        health: f
                            .pointer("/Status/Health")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        health_rollup: None,
                        state: f
                            .pointer("/Status/State")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    },
                    component_id: f
                        .pointer("/Oem/Dell/DellSoftwareInventory/ComponentID")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    device_id: f
                        .pointer("/Oem/Dell/DellSoftwareInventory/DeviceID")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    vendor_id: f
                        .pointer("/Oem/Dell/DellSoftwareInventory/VendorID")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    sub_device_id: f
                        .pointer("/Oem/Dell/DellSoftwareInventory/SubDeviceID")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    sub_vendor_id: f
                        .pointer("/Oem/Dell/DellSoftwareInventory/SubVendorID")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    install_date: f
                        .pointer("/Oem/Dell/DellSoftwareInventory/InstallationDate")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    release_date: f
                        .get("ReleaseDate")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    size_bytes: f.get("SizeBytes").and_then(|v| v.as_u64()),
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::SOFTWARE_IDENTITY).await?;
            return Ok(views
                .iter()
                .map(|v| {
                    let get = |k: &str| {
                        v.properties
                            .get(k)
                            .and_then(|val| val.as_str())
                            .map(|s| s.to_string())
                    };
                    FirmwareInventory {
                        id: get("InstanceID").unwrap_or_default(),
                        name: get("ElementName").unwrap_or_else(|| "Firmware".to_string()),
                        version: get("VersionString"),
                        updateable: v
                            .properties
                            .get("IsEntity")
                            .and_then(|val| val.as_str())
                            .map(|s| s == "true")
                            .unwrap_or(false),
                        status: ComponentHealth {
                            health: get("Status"),
                            health_rollup: None,
                            state: None,
                        },
                        component_id: get("ComponentID"),
                        device_id: get("DeviceID"),
                        vendor_id: get("VendorID"),
                        sub_device_id: get("SubDeviceID"),
                        sub_vendor_id: get("SubVendorID"),
                        install_date: get("InstallationDate"),
                        release_date: None,
                        size_bytes: None,
                    }
                })
                .collect());
        }

        Err(IdracError::unsupported(
            "Firmware listing requires Redfish or WSMAN",
        ))
    }

    /// Start a firmware update using SimpleUpdate (URL-based).
    pub async fn update_firmware(&self, params: FirmwareUpdateParams) -> IdracResult<String> {
        let rf = self.client.require_redfish()?;

        let mut body = serde_json::json!({
            "ImageURI": params.image_uri,
        });

        if let Some(targets) = &params.targets {
            body["Targets"] = serde_json::json!(targets);
        }

        if let Some(protocol) = &params.transfer_protocol {
            body["TransferProtocol"] = serde_json::json!(protocol);
        }

        let job_uri = rf
            .post_action(
                "/redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate",
                &body,
            )
            .await?;

        Ok(job_uri.unwrap_or_else(|| "Pending".to_string()))
    }

    /// Upload a firmware DUP file for update (multipart push).
    pub async fn upload_firmware_dup(&self, _dup_path: &str) -> IdracResult<String> {
        let _rf = self.client.require_redfish()?;

        // Dell iDRAC supports multipart upload to:
        // POST /redfish/v1/UpdateService/MultipartUpload
        // For now, return guidance—actual multipart upload requires
        // reqwest multipart form which is more complex
        Err(IdracError::firmware(
            "DUP upload requires local file multipart—use SimpleUpdate with HTTP/CIFS/NFS URI instead"
        ))
    }

    /// Get firmware update service status.
    pub async fn get_update_service(&self) -> IdracResult<serde_json::Value> {
        let rf = self.client.require_redfish()?;
        rf.get("/redfish/v1/UpdateService").await
    }

    /// Check if a firmware component is updateable.
    pub async fn is_component_updateable(&self, component_id: &str) -> IdracResult<bool> {
        let inventory = self.list_firmware().await?;
        Ok(inventory
            .iter()
            .any(|f| f.id == component_id && f.updateable))
    }

    /// Get firmware version for a specific component.
    pub async fn get_component_version(&self, component_name: &str) -> IdracResult<Option<String>> {
        let inventory = self.list_firmware().await?;
        Ok(inventory
            .iter()
            .find(|f| {
                f.name
                    .to_lowercase()
                    .contains(&component_name.to_lowercase())
            })
            .and_then(|f| f.version.clone()))
    }
}
