//! Storage management — RAID controllers, virtual disks, physical disks.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;
use crate::wsman::dcim_classes;

/// Storage management operations.
pub struct StorageManager<'a> {
    client: &'a IdracClient,
}

impl<'a> StorageManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// List storage controllers.
    pub async fn list_controllers(&self) -> IdracResult<Vec<StorageController>> {
        if let Ok(rf) = self.client.require_redfish() {
            let col: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1/Storage?$expand=*($levels=1)")
                .await?;

            let members = col
                .get("Members")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            return Ok(members
                .iter()
                .map(|c| {
                    let sc = c
                        .get("StorageControllers")
                        .and_then(|v| v.as_array())
                        .and_then(|a| a.first());
                    StorageController {
                        id: c
                            .get("Id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        name: c
                            .get("Name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Storage")
                            .to_string(),
                        manufacturer: sc
                            .and_then(|s| s.get("Manufacturer"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        model: sc
                            .and_then(|s| s.get("Model"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        firmware_version: sc
                            .and_then(|s| s.get("FirmwareVersion"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        serial_number: sc
                            .and_then(|s| s.get("SerialNumber"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        speed_gbps: sc.and_then(|s| s.get("SpeedGbps")).and_then(|v| v.as_f64()),
                        supported_device_protocols: sc
                            .and_then(|s| s.get("SupportedDeviceProtocols"))
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        supported_raid_types: sc
                            .and_then(|s| s.get("SupportedRAIDTypes"))
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        status: ComponentHealth {
                            health: sc
                                .and_then(|s| s.pointer("/Status/Health"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            health_rollup: None,
                            state: sc
                                .and_then(|s| s.pointer("/Status/State"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        },
                        cache_size_mb: sc
                            .and_then(|s| s.get("CacheSummary"))
                            .and_then(|c| c.get("TotalCacheSizeMiB"))
                            .and_then(|v| v.as_u64())
                            .map(|n| n as u32),
                        driver_version: None,
                    }
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::CONTROLLER_VIEW).await?;
            return Ok(views
                .iter()
                .map(|v| {
                    let get = |k: &str| {
                        v.properties
                            .get(k)
                            .and_then(|val| val.as_str())
                            .map(|s| s.to_string())
                    };
                    let get_u32 = |k: &str| {
                        v.properties
                            .get(k)
                            .and_then(|val| val.as_u64())
                            .map(|n| n as u32)
                    };
                    StorageController {
                        id: get("FQDD").unwrap_or_default(),
                        name: get("ProductName").unwrap_or_else(|| "Controller".to_string()),
                        manufacturer: get("Manufacturer"),
                        model: get("ProductName"),
                        firmware_version: get("ControllerFirmwareVersion"),
                        serial_number: get("SerialNumber"),
                        speed_gbps: None,
                        supported_device_protocols: Vec::new(),
                        supported_raid_types: Vec::new(),
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: get("RollupStatus"),
                            state: None,
                        },
                        cache_size_mb: get_u32("CacheSizeInMB"),
                        driver_version: get("DriverVersion"),
                    }
                })
                .collect());
        }

        Err(IdracError::unsupported(
            "Storage controller listing requires Redfish or WSMAN",
        ))
    }

    /// List virtual disks (RAID arrays).
    pub async fn list_virtual_disks(
        &self,
        controller_id: Option<&str>,
    ) -> IdracResult<Vec<VirtualDisk>> {
        if let Ok(rf) = self.client.require_redfish() {
            let mut all_vds = Vec::new();

            // If controller specified, list its volumes; otherwise enumerate all
            let controller_ids = if let Some(cid) = controller_id {
                vec![cid.to_string()]
            } else {
                let controllers = self.list_controllers().await?;
                controllers.into_iter().map(|c| c.id).collect()
            };

            for cid in &controller_ids {
                let url = format!(
                    "/redfish/v1/Systems/System.Embedded.1/Storage/{}/Volumes?$expand=*($levels=1)",
                    cid
                );
                if let Ok(col) = rf.get::<serde_json::Value>(&url).await {
                    let members = col
                        .get("Members")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default();
                    for vd in &members {
                        all_vds.push(VirtualDisk {
                            id: vd
                                .get("Id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            name: vd
                                .get("Name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Volume")
                                .to_string(),
                            raid_level: vd
                                .get("RAIDType")
                                .or_else(|| vd.get("VolumeType"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            capacity_bytes: vd.get("CapacityBytes").and_then(|v| v.as_u64()),
                            status: ComponentHealth {
                                health: vd
                                    .pointer("/Status/Health")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                health_rollup: None,
                                state: vd
                                    .pointer("/Status/State")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                            },
                            stripe_size_bytes: vd
                                .get("OptimumIOSizeBytes")
                                .and_then(|v| v.as_u64()),
                            read_policy: vd
                                .pointer("/Oem/Dell/DellVolume/ReadCachePolicy")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            write_policy: vd
                                .pointer("/Oem/Dell/DellVolume/WriteCachePolicy")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            disk_cache_policy: vd
                                .pointer("/Oem/Dell/DellVolume/DiskCachePolicy")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            controller_id: cid.clone(),
                            physical_disk_ids: vd
                                .get("Links")
                                .and_then(|l| l.get("Drives"))
                                .and_then(|v| v.as_array())
                                .map(|a| {
                                    a.iter()
                                        .filter_map(|d| {
                                            d.get("@odata.id").and_then(|v| v.as_str()).map(|s| {
                                                s.rsplit('/').next().unwrap_or(s).to_string()
                                            })
                                        })
                                        .collect()
                                })
                                .unwrap_or_default(),
                            encrypted: vd.get("Encrypted").and_then(|v| v.as_bool()),
                        });
                    }
                }
            }

            return Ok(all_vds);
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::VIRTUAL_DISK_VIEW).await?;
            return Ok(views
                .iter()
                .filter(|v| {
                    controller_id
                        .map(|cid| {
                            v.properties
                                .get("FQDD")
                                .and_then(|val| val.as_str())
                                .map(|s| s.contains(cid))
                                .unwrap_or(false)
                        })
                        .unwrap_or(true)
                })
                .map(|v| {
                    let get = |k: &str| {
                        v.properties
                            .get(k)
                            .and_then(|val| val.as_str())
                            .map(|s| s.to_string())
                    };
                    VirtualDisk {
                        id: get("FQDD").unwrap_or_default(),
                        name: get("Name").unwrap_or_else(|| "VD".to_string()),
                        raid_level: get("RAIDTypes").or_else(|| get("RaidLevel")),
                        capacity_bytes: v
                            .properties
                            .get("SizeInBytes")
                            .and_then(|val| val.as_u64()),
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: get("RollupStatus"),
                            state: get("State"),
                        },
                        stripe_size_bytes: v
                            .properties
                            .get("StripeSize")
                            .and_then(|val| val.as_u64()),
                        read_policy: get("ReadCachePolicy"),
                        write_policy: get("WriteCachePolicy"),
                        disk_cache_policy: get("DiskCachePolicy"),
                        controller_id: get("ParentControllerFQDD").unwrap_or_default(),
                        physical_disk_ids: get("PhysicalDiskIDs")
                            .map(|s| s.split(',').map(|p| p.trim().to_string()).collect())
                            .unwrap_or_default(),
                        encrypted: v
                            .properties
                            .get("LockStatus")
                            .and_then(|val| val.as_str())
                            .map(|s| s == "Locked"),
                    }
                })
                .collect());
        }

        Err(IdracError::unsupported(
            "Virtual disk listing requires Redfish or WSMAN",
        ))
    }

    /// List physical disks.
    pub async fn list_physical_disks(
        &self,
        controller_id: Option<&str>,
    ) -> IdracResult<Vec<PhysicalDisk>> {
        if let Ok(rf) = self.client.require_redfish() {
            let mut all_disks = Vec::new();

            let controller_ids = if let Some(cid) = controller_id {
                vec![cid.to_string()]
            } else {
                let controllers = self.list_controllers().await?;
                controllers.into_iter().map(|c| c.id).collect()
            };

            for cid in &controller_ids {
                let url = format!(
                    "/redfish/v1/Systems/System.Embedded.1/Storage/{}/Drives?$expand=*($levels=1)",
                    cid
                );
                // If Drives collection doesn't exist, try listing from the Storage resource
                let drives_result = rf.get::<serde_json::Value>(&url).await;
                let members = if let Ok(col) = drives_result {
                    col.get("Members")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default()
                } else {
                    // Fallback: get drives from the Storage resource
                    let storage_url =
                        format!("/redfish/v1/Systems/System.Embedded.1/Storage/{}", cid);
                    if let Ok(storage) = rf.get::<serde_json::Value>(&storage_url).await {
                        let drive_links = storage
                            .get("Drives")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();
                        let mut fetched = Vec::new();
                        for link in &drive_links {
                            if let Some(uri) = link.get("@odata.id").and_then(|v| v.as_str()) {
                                if let Ok(drive) = rf.get::<serde_json::Value>(uri).await {
                                    fetched.push(drive);
                                }
                            }
                        }
                        fetched
                    } else {
                        Vec::new()
                    }
                };

                for d in &members {
                    all_disks.push(PhysicalDisk {
                        id: d
                            .get("Id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        name: d
                            .get("Name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Disk")
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
                        firmware_version: d
                            .get("Revision")
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
                        rotation_speed_rpm: d
                            .get("RotationSpeedRPM")
                            .and_then(|v| v.as_u64())
                            .map(|n| n as u32),
                        capable_speed_gbps: d.get("CapableSpeedGbs").and_then(|v| v.as_f64()),
                        negotiated_speed_gbps: d.get("NegotiatedSpeedGbs").and_then(|v| v.as_f64()),
                        predicted_media_life_left_percent: d
                            .get("PredictedMediaLifeLeftPercent")
                            .and_then(|v| v.as_f64()),
                        block_size_bytes: d
                            .get("BlockSizeBytes")
                            .and_then(|v| v.as_u64())
                            .map(|n| n as u32),
                        failure_predicted: d.get("FailurePredicted").and_then(|v| v.as_bool()),
                        hotspare_type: d
                            .get("HotspareType")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        encryption_ability: d
                            .get("EncryptionAbility")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        status: ComponentHealth {
                            health: d
                                .pointer("/Status/Health")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            health_rollup: None,
                            state: d
                                .pointer("/Status/State")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        },
                        controller_id: cid.clone(),
                        slot: d
                            .pointer("/PhysicalLocation/PartLocation/LocationOrdinalValue")
                            .and_then(|v| v.as_u64())
                            .map(|n| n as u32),
                    });
                }
            }

            return Ok(all_disks);
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::PHYSICAL_DISK_VIEW).await?;
            return Ok(views
                .iter()
                .filter(|v| {
                    controller_id
                        .map(|cid| {
                            v.properties
                                .get("FQDD")
                                .and_then(|val| val.as_str())
                                .map(|s| s.contains(cid))
                                .unwrap_or(false)
                        })
                        .unwrap_or(true)
                })
                .map(|v| {
                    let get = |k: &str| {
                        v.properties
                            .get(k)
                            .and_then(|val| val.as_str())
                            .map(|s| s.to_string())
                    };
                    let get_u32 = |k: &str| {
                        v.properties
                            .get(k)
                            .and_then(|val| val.as_u64())
                            .map(|n| n as u32)
                    };
                    PhysicalDisk {
                        id: get("FQDD").unwrap_or_default(),
                        name: get("DeviceDescription").unwrap_or_else(|| "Disk".to_string()),
                        manufacturer: get("Manufacturer"),
                        model: get("Model"),
                        serial_number: get("SerialNumber"),
                        firmware_version: get("Revision"),
                        capacity_bytes: v
                            .properties
                            .get("SizeInBytes")
                            .and_then(|val| val.as_u64()),
                        media_type: get("MediaType"),
                        protocol: get("BusProtocol"),
                        rotation_speed_rpm: get_u32("RotationRate"),
                        capable_speed_gbps: None,
                        negotiated_speed_gbps: None,
                        predicted_media_life_left_percent: None,
                        block_size_bytes: get_u32("BlockSizeInBytes"),
                        failure_predicted: v
                            .properties
                            .get("PredictiveFailureState")
                            .and_then(|val| val.as_str())
                            .map(|s| s != "0"),
                        hotspare_type: get("HotSpareStatus"),
                        encryption_ability: get("SecurityStatus"),
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: get("RollupStatus"),
                            state: get("RaidStatus"),
                        },
                        controller_id: get("ParentControllerFQDD").unwrap_or_default(),
                        slot: get_u32("Slot"),
                    }
                })
                .collect());
        }

        Err(IdracError::unsupported(
            "Physical disk listing requires Redfish or WSMAN",
        ))
    }

    /// List storage enclosures.
    pub async fn list_enclosures(&self) -> IdracResult<Vec<StorageEnclosure>> {
        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::ENCLOSURE_VIEW).await?;
            return Ok(views
                .iter()
                .map(|v| {
                    let get = |k: &str| {
                        v.properties
                            .get(k)
                            .and_then(|val| val.as_str())
                            .map(|s| s.to_string())
                    };
                    let get_u32 = |k: &str| {
                        v.properties
                            .get(k)
                            .and_then(|val| val.as_u64())
                            .map(|n| n as u32)
                    };
                    StorageEnclosure {
                        id: get("FQDD").unwrap_or_default(),
                        name: get("DeviceDescription").unwrap_or_else(|| "Enclosure".to_string()),
                        service_tag: get("ServiceTag"),
                        asset_tag: get("AssetTag"),
                        connector: get_u32("Connector"),
                        wired_order: get_u32("WiredOrder"),
                        slot_count: get_u32("SlotCount"),
                        firmware_version: get("Version"),
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: get("RollupStatus"),
                            state: None,
                        },
                    }
                })
                .collect());
        }

        // Redfish doesn't always have a separate enclosure view
        Ok(Vec::new())
    }

    /// Create a virtual disk (RAID array).
    pub async fn create_virtual_disk(
        &self,
        params: CreateVirtualDiskParams,
    ) -> IdracResult<String> {
        let rf = self.client.require_redfish()?;

        let drives: Vec<serde_json::Value> = params.physical_disk_ids.iter().map(|id| {
            serde_json::json!({
                "@odata.id": format!("/redfish/v1/Systems/System.Embedded.1/Storage/{}/Drives/{}", params.controller_id, id)
            })
        }).collect();

        let mut body = serde_json::json!({
            "RAIDType": params.raid_level,
            "Name": params.name.as_deref().unwrap_or("New Virtual Disk"),
            "Drives": drives,
        });

        if let Some(stripe) = params.stripe_size_bytes {
            body["OptimumIOSizeBytes"] = serde_json::json!(stripe);
        }

        if let Some(capacity) = params.capacity_bytes {
            body["CapacityBytes"] = serde_json::json!(capacity);
        }

        let url = format!(
            "/redfish/v1/Systems/System.Embedded.1/Storage/{}/Volumes",
            params.controller_id
        );

        let job_uri = rf.post_action(&url, &body).await?;
        Ok(job_uri.unwrap_or_else(|| "Pending".to_string()))
    }

    /// Delete a virtual disk.
    pub async fn delete_virtual_disk(
        &self,
        controller_id: &str,
        volume_id: &str,
    ) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;
        let url = format!(
            "/redfish/v1/Systems/System.Embedded.1/Storage/{}/Volumes/{}",
            controller_id, volume_id
        );
        rf.delete(&url).await
    }

    /// Assign a physical disk as a hot spare.
    pub async fn assign_hotspare(
        &self,
        controller_id: &str,
        disk_id: &str,
        hotspare_type: &str,
        target_volume_id: Option<&str>,
    ) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;
        let mut body = serde_json::json!({
            "HotspareType": hotspare_type
        });
        if let Some(vol) = target_volume_id {
            body["Links"] = serde_json::json!({
                "Volumes": [{
                    "@odata.id": format!("/redfish/v1/Systems/System.Embedded.1/Storage/{}/Volumes/{}", controller_id, vol)
                }]
            });
        }
        let url = format!(
            "/redfish/v1/Systems/System.Embedded.1/Storage/{}/Drives/{}",
            controller_id, disk_id
        );
        rf.patch_json(&url, &body).await
    }

    /// Initialize (fast/slow) a virtual disk.
    pub async fn initialize_virtual_disk(
        &self,
        controller_id: &str,
        volume_id: &str,
        init_type: &str,
    ) -> IdracResult<String> {
        let rf = self.client.require_redfish()?;
        let body = serde_json::json!({
            "InitializeType": init_type
        });
        let url = format!(
            "/redfish/v1/Systems/System.Embedded.1/Storage/{}/Volumes/{}/Actions/Volume.Initialize",
            controller_id, volume_id
        );
        let job_uri = rf.post_action(&url, &body).await?;
        Ok(job_uri.unwrap_or_else(|| "Pending".to_string()))
    }
}
