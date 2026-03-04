//! System information manager — model, serial, BIOS, boot order, OS.
//!
//! Supports Redfish (primary) and WSMAN (legacy fallback).

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;
use crate::wsman::dcim_classes;

/// System information operations.
pub struct SystemManager<'a> {
    client: &'a IdracClient,
}

impl<'a> SystemManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// Get system information.
    pub async fn get_system_info(&self) -> IdracResult<SystemInfo> {
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1")
                .await?;

            return Ok(SystemInfo {
                id: sys.get("Id").and_then(|v| v.as_str()).unwrap_or("System.Embedded.1").to_string(),
                manufacturer: sys.get("Manufacturer").and_then(|v| v.as_str()).unwrap_or("Dell Inc.").to_string(),
                model: sys.get("Model").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
                serial_number: sys.get("SerialNumber").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                service_tag: sys.pointer("/Oem/Dell/DellSystem/SystemID")
                    .or_else(|| sys.get("SKU"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                sku: sys.get("SKU").and_then(|v| v.as_str()).map(|s| s.to_string()),
                bios_version: sys.get("BiosVersion").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                hostname: sys.get("HostName").and_then(|v| v.as_str()).map(|s| s.to_string()),
                power_state: sys.get("PowerState").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
                indicator_led: sys.get("IndicatorLED").and_then(|v| v.as_str()).map(|s| s.to_string()),
                asset_tag: sys.get("AssetTag").and_then(|v| v.as_str()).map(|s| s.to_string()),
                memory_gib: sys.get("MemorySummary")
                    .and_then(|m| m.get("TotalSystemMemoryGiB"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0),
                processor_count: sys.get("ProcessorSummary")
                    .and_then(|p| p.get("Count"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32,
                processor_model: sys.get("ProcessorSummary")
                    .and_then(|p| p.get("Model"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string(),
            });
        }

        // WSMAN legacy fallback
        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::SYSTEM_VIEW).await?;
            if let Some(v) = views.first() {
                let get_str = |key: &str| -> String {
                    v.properties
                        .get(key)
                        .and_then(|val| val.as_str())
                        .unwrap_or("")
                        .to_string()
                };

                return Ok(SystemInfo {
                    id: get_str("FQDD"),
                    manufacturer: "Dell Inc.".to_string(),
                    model: get_str("Model"),
                    serial_number: get_str("ChassisServiceTag"),
                    service_tag: get_str("ServiceTag"),
                    sku: Some(get_str("ServiceTag")),
                    bios_version: get_str("BIOSVersionString"),
                    hostname: Some(get_str("HostName")),
                    power_state: get_str("PowerState"),
                    indicator_led: None,
                    asset_tag: Some(get_str("AssetTag")),
                    memory_gib: v.properties.get("SysMemTotalSize")
                        .and_then(|val| val.as_f64())
                        .map(|mb| mb / 1024.0)
                        .unwrap_or(0.0),
                    processor_count: v.properties.get("PopulatedCPUSockets")
                        .and_then(|val| val.as_u64())
                        .unwrap_or(0) as u32,
                    processor_model: get_str("CPUModel"),
                });
            }
        }

        Err(IdracError::unsupported("No protocol available for system info"))
    }

    /// Get iDRAC controller info.
    pub async fn get_idrac_info(&self) -> IdracResult<IdracInfo> {
        if let Ok(rf) = self.client.require_redfish() {
            let mgr: serde_json::Value = rf
                .get("/redfish/v1/Managers/iDRAC.Embedded.1")
                .await?;

            return Ok(IdracInfo {
                firmware_version: mgr.get("FirmwareVersion").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                idrac_type: mgr.get("Model").and_then(|v| v.as_str()).unwrap_or("iDRAC").to_string(),
                ip_address: self.client.config.host.clone(),
                mac_address: mgr.pointer("/EthernetInterfaces/@odata.id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                model: mgr.get("Model").and_then(|v| v.as_str()).map(|s| s.to_string()),
                generation: mgr.pointer("/Oem/Dell/DellAttributes/iDRACGeneration")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                license_type: mgr.pointer("/Oem/Dell/DellAttributes/LicenseType")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            });
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::IDRAC_CARD_VIEW).await?;
            if let Some(v) = views.first() {
                let get_str = |key: &str| -> String {
                    v.properties.get(key).and_then(|val| val.as_str()).unwrap_or("").to_string()
                };
                return Ok(IdracInfo {
                    firmware_version: get_str("FirmwareVersion"),
                    idrac_type: get_str("ProductInfo"),
                    ip_address: self.client.config.host.clone(),
                    mac_address: Some(get_str("PermanentMACAddress")),
                    model: Some(get_str("Model")),
                    generation: Some(get_str("Generation")),
                    license_type: None,
                });
            }
        }

        Err(IdracError::unsupported("No protocol available for iDRAC info"))
    }

    /// Set the asset tag.
    pub async fn set_asset_tag(&self, tag: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;
        rf.patch_json(
            "/redfish/v1/Systems/System.Embedded.1",
            &serde_json::json!({ "AssetTag": tag }),
        )
        .await
    }

    /// Set the indicator LED (Lit, Blinking, Off).
    pub async fn set_indicator_led(&self, state: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;
        rf.patch_json(
            "/redfish/v1/Systems/System.Embedded.1",
            &serde_json::json!({ "IndicatorLED": state }),
        )
        .await
    }
}
