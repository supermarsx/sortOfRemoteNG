//! Storage management — Smart Array controllers, logical/physical drives, Redfish storage.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Storage management operations.
pub struct StorageManager<'a> {
    client: &'a IloClient,
}

impl<'a> StorageManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get storage controllers (Smart Array or generic Redfish).
    pub async fn get_controllers(&self) -> IloResult<Vec<BmcStorageController>> {
        if let Ok(rf) = self.client.require_redfish() {
            // Try HP Smart Storage first (iLO 4/5 OEM)
            if let Ok(smart) = rf.get_smart_storage().await {
                return self.parse_smart_storage(&smart);
            }
            // Standard Redfish Storage
            let collection = rf.get_storage_collection().await?;
            let mut controllers = Vec::new();
            for m in &collection {
                controllers.push(BmcStorageController {
                    id: m
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: m
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Storage")
                        .to_string(),
                    manufacturer: m
                        .pointer("/StorageControllers/0/Manufacturer")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    model: m
                        .get("Model")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    firmware_version: m
                        .pointer("/StorageControllers/0/FirmwareVersion")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    status: component_health(
                        m.get("Status")
                            .and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown"),
                    ),
                });
            }
            return Ok(controllers);
        }

        Err(IloError::unsupported(
            "No protocol available for storage controllers",
        ))
    }

    fn parse_smart_storage(
        &self,
        data: &serde_json::Value,
    ) -> IloResult<Vec<BmcStorageController>> {
        let mut controllers = Vec::new();
        if let Some(arr) = data.get("Members").and_then(|v| v.as_array()) {
            for c in arr {
                controllers.push(BmcStorageController {
                    id: c
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: c
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Smart Array")
                        .to_string(),
                    manufacturer: Some("HPE".to_string()),
                    model: c
                        .get("Model")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    firmware_version: c
                        .get("FirmwareVersion")
                        .and_then(|v| v.get("Current"))
                        .and_then(|v| v.get("VersionString"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    status: component_health(
                        c.get("Status")
                            .and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown"),
                    ),
                });
            }
        }
        Ok(controllers)
    }

    /// Get virtual disks (logical drives).
    pub async fn get_virtual_disks(&self) -> IloResult<Vec<BmcVirtualDisk>> {
        if let Ok(rf) = self.client.require_redfish() {
            // Try Smart Storage OEM path for logical drives
            if let Ok(smart) = rf.get_smart_storage().await {
                return self.parse_smart_logical_drives(&smart);
            }
            // Standard Redfish Volumes
            let storage = rf.get_storage_collection().await?;
            let mut disks = Vec::new();
            for s in &storage {
                if let Some(volumes) = s.get("Volumes").and_then(|v| v.as_array()) {
                    for vol in volumes {
                        disks.push(BmcVirtualDisk {
                            id: vol
                                .get("Id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            name: vol
                                .get("Name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Volume")
                                .to_string(),
                            raid_level: vol
                                .get("RAIDType")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            capacity_bytes: vol.get("CapacityBytes").and_then(|v| v.as_u64()),
                            status: component_health(
                                vol.get("Status")
                                    .and_then(|s| s.get("Health"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Unknown"),
                            ),
                        });
                    }
                }
            }
            return Ok(disks);
        }

        Err(IloError::unsupported(
            "No protocol available for virtual disks",
        ))
    }

    fn parse_smart_logical_drives(
        &self,
        data: &serde_json::Value,
    ) -> IloResult<Vec<BmcVirtualDisk>> {
        let mut disks = Vec::new();
        if let Some(members) = data.get("Members").and_then(|v| v.as_array()) {
            for ctrl in members {
                if let Some(lds) = ctrl
                    .pointer("/Links/LogicalDrives")
                    .and_then(|v| v.as_array())
                {
                    for ld in lds {
                        disks.push(BmcVirtualDisk {
                            id: ld
                                .get("Id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            name: ld
                                .get("LogicalDriveName")
                                .and_then(|v| v.as_str())
                                .unwrap_or("LogicalDrive")
                                .to_string(),
                            raid_level: ld
                                .get("Raid")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            capacity_bytes: ld
                                .get("CapacityMiB")
                                .and_then(|v| v.as_u64())
                                .map(|v| v * 1024 * 1024),
                            status: component_health(
                                ld.get("Status")
                                    .and_then(|s| s.get("Health"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Unknown"),
                            ),
                        });
                    }
                }
            }
        }
        Ok(disks)
    }

    /// Get physical disks.
    pub async fn get_physical_disks(&self) -> IloResult<Vec<BmcPhysicalDisk>> {
        if let Ok(rf) = self.client.require_redfish() {
            if let Ok(smart) = rf.get_smart_storage().await {
                return self.parse_smart_physical_drives(&smart);
            }
            // Standard Redfish Drives
            let storage = rf.get_storage_collection().await?;
            let mut drives = Vec::new();
            for s in &storage {
                if let Some(drv_arr) = s.get("Drives").and_then(|v| v.as_array()) {
                    for d in drv_arr {
                        drives.push(BmcPhysicalDisk {
                            id: d
                                .get("Id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            name: d
                                .get("Name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Drive")
                                .to_string(),
                            manufacturer: d
                                .get("Manufacturer")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            model: d
                                .get("Model")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            serial_number: d
                                .get("SerialNumber")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            capacity_bytes: d.get("CapacityBytes").and_then(|v| v.as_u64()),
                            media_type: d
                                .get("MediaType")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            protocol: d
                                .get("Protocol")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            status: component_health(
                                d.get("Status")
                                    .and_then(|s| s.get("Health"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Unknown"),
                            ),
                        });
                    }
                }
            }
            return Ok(drives);
        }

        Err(IloError::unsupported(
            "No protocol available for physical disks",
        ))
    }

    fn parse_smart_physical_drives(
        &self,
        data: &serde_json::Value,
    ) -> IloResult<Vec<BmcPhysicalDisk>> {
        let mut drives = Vec::new();
        if let Some(members) = data.get("Members").and_then(|v| v.as_array()) {
            for ctrl in members {
                if let Some(pds) = ctrl
                    .pointer("/Links/PhysicalDrives")
                    .and_then(|v| v.as_array())
                {
                    for pd in pds {
                        drives.push(BmcPhysicalDisk {
                            id: pd
                                .get("Id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            name: pd
                                .get("Name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Drive")
                                .to_string(),
                            manufacturer: pd
                                .get("Manufacturer")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            model: pd
                                .get("Model")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            serial_number: pd
                                .get("SerialNumber")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            capacity_bytes: pd
                                .get("CapacityMiB")
                                .and_then(|v| v.as_u64())
                                .map(|v| v * 1024 * 1024),
                            media_type: pd
                                .get("MediaType")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            protocol: pd
                                .get("InterfaceType")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            status: component_health(
                                pd.get("Status")
                                    .and_then(|s| s.get("Health"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Unknown"),
                            ),
                        });
                    }
                }
            }
        }
        Ok(drives)
    }
}
