//! System information manager — model, serial, BIOS, boot order, OS.
//!
//! Supports Redfish (iLO 4+) and RIBCL (iLO 1-5) with IPMI fallback.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// System information operations.
pub struct SystemManager<'a> {
    client: &'a IloClient,
}

impl<'a> SystemManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get system information.
    pub async fn get_system_info(&self) -> IloResult<BmcSystemInfo> {
        // Try Redfish first
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf.get_system().await?;

            return Ok(BmcSystemInfo {
                id: sys.get("Id").and_then(|v| v.as_str()).unwrap_or("1").to_string(),
                manufacturer: sys.get("Manufacturer").and_then(|v| v.as_str())
                    .unwrap_or("Hewlett Packard Enterprise").to_string(),
                model: sys.get("Model").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
                serial_number: sys.get("SerialNumber").and_then(|v| v.as_str()).unwrap_or("").to_string(),
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
                    .unwrap_or("Unknown").to_string(),
            });
        }

        // RIBCL fallback
        if let Ok(ribcl) = self.client.require_ribcl() {
            let data = ribcl.get_host_data().await?;
            return Ok(BmcSystemInfo {
                id: "1".to_string(),
                manufacturer: "Hewlett Packard Enterprise".to_string(),
                model: data.get("PRODUCT_NAME")
                    .and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
                serial_number: data.get("SERIAL_NUMBER")
                    .and_then(|v| v.as_str())
                    .or_else(|| data.get("CSN").and_then(|v| v.as_str()))
                    .unwrap_or("").to_string(),
                sku: data.get("SKU").and_then(|v| v.as_str()).map(|s| s.to_string()),
                bios_version: data.get("ROM_VERSION")
                    .and_then(|v| v.as_str()).unwrap_or("").to_string(),
                hostname: data.get("SERVER_NAME").and_then(|v| v.as_str()).map(|s| s.to_string()),
                power_state: data.get("HOST_POWER")
                    .and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
                indicator_led: data.get("UID_LED").and_then(|v| v.as_str()).map(|s| s.to_string()),
                asset_tag: data.get("ASSET_TAG").and_then(|v| v.as_str()).map(|s| s.to_string()),
                memory_gib: 0.0,
                processor_count: 0,
                processor_model: "Unknown".to_string(),
            });
        }

        Err(IloError::unsupported("No protocol available for system info"))
    }

    /// Get iLO controller info.
    pub async fn get_ilo_info(&self) -> IloResult<IloInfo> {
        if let Ok(rf) = self.client.require_redfish() {
            let mgr: serde_json::Value = rf.get_manager().await?;
            let oem = mgr.get("Oem")
                .and_then(|o| o.get("Hpe").or_else(|| o.get("Hp")));

            return Ok(IloInfo {
                generation: rf.generation,
                firmware_version: mgr.get("FirmwareVersion")
                    .and_then(|v| v.as_str()).unwrap_or("").to_string(),
                firmware_date: oem
                    .and_then(|o| o.get("FirmwareDate"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                ip_address: self.client.config.host.clone(),
                mac_address: None,
                hostname: mgr.get("HostName")
                    .and_then(|v| v.as_str()).map(|s| s.to_string()),
                serial_number: mgr.get("SerialNumber")
                    .and_then(|v| v.as_str()).map(|s| s.to_string()),
                license_type: oem
                    .and_then(|o| o.pointer("/License/LicenseString"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Standard")
                    .to_string(),
                fqdn: oem
                    .and_then(|o| o.get("FQDN"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                uuid: mgr.get("UUID")
                    .and_then(|v| v.as_str()).map(|s| s.to_string()),
            });
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let fw_data = ribcl.get_fw_version().await?;
            return Ok(IloInfo {
                generation: ribcl.generation(),
                firmware_version: fw_data.get("FIRMWARE_VERSION")
                    .and_then(|v| v.as_str()).unwrap_or("").to_string(),
                firmware_date: fw_data.get("FIRMWARE_DATE")
                    .and_then(|v| v.as_str()).map(|s| s.to_string()),
                ip_address: self.client.config.host.clone(),
                mac_address: None,
                hostname: None,
                serial_number: None,
                license_type: "Unknown".to_string(),
                fqdn: None,
                uuid: None,
            });
        }

        Err(IloError::unsupported("No protocol available for iLO info"))
    }

    /// Set asset tag.
    pub async fn set_asset_tag(&self, tag: &str) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let body = serde_json::json!({ "AssetTag": tag });
        rf.inner.patch_json("/redfish/v1/Systems/1", &body).await?;
        Ok(())
    }

    /// Set indicator LED.
    pub async fn set_indicator_led(&self, state: &str) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let body = serde_json::json!({ "IndicatorLED": state });
        rf.inner.patch_json("/redfish/v1/Systems/1", &body).await?;
        Ok(())
    }
}
