//! Firmware inventory — iLO FW, BIOS/ROM, NIC, storage controller FW.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Firmware inventory operations.
pub struct FirmwareManager<'a> {
    client: &'a IloClient,
}

impl<'a> FirmwareManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get firmware inventory.
    pub async fn get_firmware_inventory(&self) -> IloResult<Vec<BmcFirmwareItem>> {
        if let Ok(rf) = self.client.require_redfish() {
            let items: serde_json::Value = rf.get_firmware_inventory().await?;
            let mut firmware = Vec::new();

            if let Some(members) = items.as_array() {
                for fw in members {
                    firmware.push(BmcFirmwareItem {
                        id: fw.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        name: fw.get("Name").and_then(|v| v.as_str()).unwrap_or("Firmware").to_string(),
                        version: fw.get("Version").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        updateable: fw.get("Updateable").and_then(|v| v.as_bool()),
                        status: fw.get("Status").and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str()).map(|s| s.to_string()),
                    });
                }
            }
            return Ok(firmware);
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let fw_data = ribcl.get_fw_version().await?;
            let mut firmware = Vec::new();

            // iLO firmware
            if let Some(ver) = fw_data.get("FIRMWARE_VERSION").and_then(|v| v.as_str()) {
                firmware.push(BmcFirmwareItem {
                    id: "ilo-fw".to_string(),
                    name: "iLO Firmware".to_string(),
                    version: ver.to_string(),
                    updateable: Some(true),
                    status: Some("OK".to_string()),
                });
            }

            // Get system ROM from host_data
            let host = ribcl.get_host_data().await?;
            if let Some(rom) = host.get("ROM_VERSION").and_then(|v| v.as_str()) {
                firmware.push(BmcFirmwareItem {
                    id: "system-rom".to_string(),
                    name: "System ROM".to_string(),
                    version: rom.to_string(),
                    updateable: Some(true),
                    status: Some("OK".to_string()),
                });
            }

            if let Some(backup) = host.get("BACKUP_ROM_VERSION").and_then(|v| v.as_str()) {
                firmware.push(BmcFirmwareItem {
                    id: "backup-rom".to_string(),
                    name: "Backup System ROM".to_string(),
                    version: backup.to_string(),
                    updateable: Some(false),
                    status: Some("OK".to_string()),
                });
            }

            return Ok(firmware);
        }

        Err(IloError::unsupported("No protocol available for firmware inventory"))
    }
}
