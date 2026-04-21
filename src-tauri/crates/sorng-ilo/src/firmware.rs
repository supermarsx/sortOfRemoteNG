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
            let items: Vec<serde_json::Value> = rf.get_firmware_inventory().await?;
            let mut firmware = Vec::new();

            for fw in &items {
                firmware.push(BmcFirmwareItem {
                    id: fw
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: fw
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Firmware")
                        .to_string(),
                    version: fw
                        .get("Version")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    updateable: fw
                        .get("Updateable")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                    component_type: fw
                        .get("Description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    status: component_health(
                        fw.get("Status")
                            .and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("OK"),
                    ),
                });
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
                    updateable: true,
                    component_type: Some("BMC".to_string()),
                    status: component_health("OK"),
                });
            }

            // Get system ROM from host_data
            let host = ribcl.get_host_data().await?;
            if let Some(rom) = host.get("ROM_VERSION").and_then(|v| v.as_str()) {
                firmware.push(BmcFirmwareItem {
                    id: "system-rom".to_string(),
                    name: "System ROM".to_string(),
                    version: rom.to_string(),
                    updateable: true,
                    component_type: Some("BIOS".to_string()),
                    status: component_health("OK"),
                });
            }

            if let Some(backup) = host.get("BACKUP_ROM_VERSION").and_then(|v| v.as_str()) {
                firmware.push(BmcFirmwareItem {
                    id: "backup-rom".to_string(),
                    name: "Backup System ROM".to_string(),
                    version: backup.to_string(),
                    updateable: false,
                    component_type: Some("BIOS".to_string()),
                    status: component_health("OK"),
                });
            }

            return Ok(firmware);
        }

        Err(IloError::unsupported(
            "No protocol available for firmware inventory",
        ))
    }
}
