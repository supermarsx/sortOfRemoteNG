//! Lenovo-specific Redfish client with OEM extension support.
//!
//! Wraps `sorng_bmc_common::redfish::RedfishClient` and adds Lenovo XCC/XCC2
//! OEM discovery (detecting `Oem.Lenovo` in the Manager resource).

use crate::error::{LenovoError, LenovoResult};
use crate::types::*;
use sorng_bmc_common::redfish::{RedfishClient, RedfishConfig};

/// Lenovo Redfish client wrapping the vendor-neutral Redfish client.
pub struct LenovoRedfishClient {
    pub inner: RedfishClient,
    generation: XccGeneration,
}

impl LenovoRedfishClient {
    /// Create a new Lenovo Redfish client from config.
    pub fn new(config: &LenovoConfig) -> LenovoResult<Self> {
        let rf_config = RedfishConfig {
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            password: config.password.clone(),
            insecure: config.insecure,
            timeout_secs: config.timeout_secs,
        };
        let inner = RedfishClient::new(&rf_config).map_err(LenovoError::from)?;
        Ok(Self {
            inner,
            generation: config.generation.clone().unwrap_or(XccGeneration::Unknown),
        })
    }

    /// Authenticate with the XCC/IMM2 Redfish service and detect generation.
    pub async fn login(&mut self) -> LenovoResult<String> {
        self.inner.login(false).await.map_err(LenovoError::from)?;

        // Detect generation from the Manager resource
        if self.generation == XccGeneration::Unknown {
            if let Ok(gen) = self.detect_generation().await {
                self.generation = gen;
            }
        }

        Ok(format!(
            "Connected to {} via Redfish ({})",
            self.inner.config().host,
            self.generation.display_name()
        ))
    }

    /// Detect XCC generation from Manager OEM data.
    async fn detect_generation(&self) -> LenovoResult<XccGeneration> {
        // Try /redfish/v1/Managers/1 — Lenovo uses "1" as the manager ID
        let manager: serde_json::Value = self
            .inner
            .get("/redfish/v1/Managers/1")
            .await
            .map_err(LenovoError::from)?;

        // Check OEM.Lenovo presence for XCC/XCC2
        if let Some(oem) = manager.get("Oem") {
            if oem.get("Lenovo").is_some() {
                // Check firmware version to distinguish XCC vs XCC2
                if let Some(fw) = manager.get("FirmwareVersion").and_then(|v| v.as_str()) {
                    if fw.starts_with("2.") || fw.starts_with("3.") || fw.starts_with("4.") {
                        // XCC2 typically has FW version 2.x+ with V3 hardware
                        // Check model field to confirm
                        if let Some(model) = manager.get("Model").and_then(|v| v.as_str()) {
                            if model.contains("XCC2") || model.contains("XClarity Controller 2") {
                                return Ok(XccGeneration::Xcc2);
                            }
                        }
                        // Also check Oem.Lenovo for XCC2 marker
                        if let Some(lenovo) = oem.get("Lenovo") {
                            if let Some(xcc_type) =
                                lenovo.get("@odata.type").and_then(|v| v.as_str())
                            {
                                if xcc_type.contains("XCC2")
                                    || xcc_type.contains("XClarityController2")
                                {
                                    return Ok(XccGeneration::Xcc2);
                                }
                            }
                        }
                    }
                }
                return Ok(XccGeneration::Xcc);
            }
        }

        // Fallback: check if Redfish works at all (could be IMM2 with Redfish)
        Ok(XccGeneration::Xcc)
    }

    /// Logout / close the Redfish session.
    pub async fn logout(&mut self) -> LenovoResult<()> {
        self.inner.logout().await.map_err(LenovoError::from)
    }

    pub fn is_connected(&self) -> bool {
        self.inner.is_connected()
    }

    pub async fn check_session(&self) -> LenovoResult<bool> {
        self.inner.check_session().await.map_err(LenovoError::from)
    }

    pub fn generation(&self) -> &XccGeneration {
        &self.generation
    }

    // ── Typed API helpers ───────────────────────────────────────────

    /// Get system information from Redfish.
    pub async fn get_system_info(&self) -> LenovoResult<BmcSystemInfo> {
        let sys: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1")
            .await
            .map_err(LenovoError::from)?;

        Ok(BmcSystemInfo {
            id: sys
                .get("Id")
                .and_then(|v| v.as_str())
                .unwrap_or("1")
                .to_string(),
            manufacturer: sys
                .get("Manufacturer")
                .and_then(|v| v.as_str())
                .unwrap_or("Lenovo")
                .to_string(),
            model: sys
                .get("Model")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            serial_number: sys
                .get("SerialNumber")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            sku: sys.get("SKU").and_then(|v| v.as_str()).map(String::from),
            bios_version: sys
                .get("BiosVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            hostname: sys
                .get("HostName")
                .and_then(|v| v.as_str())
                .map(String::from),
            power_state: sys
                .get("PowerState")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string(),
            indicator_led: sys
                .get("IndicatorLED")
                .and_then(|v| v.as_str())
                .map(String::from),
            asset_tag: sys
                .get("AssetTag")
                .and_then(|v| v.as_str())
                .map(String::from),
            memory_gib: sys
                .get("MemorySummary")
                .and_then(|m| m.get("TotalSystemMemoryGiB"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            processor_count: sys
                .get("ProcessorSummary")
                .and_then(|p| p.get("Count"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            processor_model: sys
                .get("ProcessorSummary")
                .and_then(|p| p.get("Model"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
    }

    /// Get XCC controller info.
    pub async fn get_xcc_info(&self) -> LenovoResult<XccInfo> {
        let mgr: serde_json::Value = self
            .inner
            .get("/redfish/v1/Managers/1")
            .await
            .map_err(LenovoError::from)?;

        let net = self
            .inner
            .get_raw("/redfish/v1/Managers/1/EthernetInterfaces/1")
            .await;
        let (ip, mac) = if let Ok(resp) = net {
            let text = resp.text().await.unwrap_or_default();
            let val: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
            let ip = val
                .get("IPv4Addresses")
                .and_then(|arr| arr.as_array())
                .and_then(|arr| arr.first())
                .and_then(|addr| addr.get("Address"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let mac = val
                .get("MACAddress")
                .and_then(|v| v.as_str())
                .map(String::from);
            (ip, mac)
        } else {
            (String::new(), None)
        };

        Ok(XccInfo {
            generation: self.generation.clone(),
            firmware_version: mgr
                .get("FirmwareVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            firmware_date: mgr
                .get("DateTime")
                .and_then(|v| v.as_str())
                .map(String::from),
            ip_address: ip,
            mac_address: mac,
            hostname: mgr
                .get("HostName")
                .and_then(|v| v.as_str())
                .map(String::from),
            serial_number: mgr
                .get("SerialNumber")
                .and_then(|v| v.as_str())
                .map(String::from),
            model: mgr.get("Model").and_then(|v| v.as_str()).map(String::from),
            uuid: mgr.get("UUID").and_then(|v| v.as_str()).map(String::from),
            fqdn: mgr.get("FQDN").and_then(|v| v.as_str()).map(String::from),
        })
    }

    /// Set the IndicatorLED state.
    pub async fn set_indicator_led(&self, state: &str) -> LenovoResult<()> {
        let body = serde_json::json!({ "IndicatorLED": state });
        self.inner
            .patch_json("/redfish/v1/Systems/1", &body)
            .await
            .map_err(LenovoError::from)
    }

    /// Set system asset tag.
    pub async fn set_asset_tag(&self, tag: &str) -> LenovoResult<()> {
        let body = serde_json::json!({ "AssetTag": tag });
        self.inner
            .patch_json("/redfish/v1/Systems/1", &body)
            .await
            .map_err(LenovoError::from)
    }

    /// Get power state.
    pub async fn get_power_state(&self) -> LenovoResult<String> {
        let sys: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1")
            .await
            .map_err(LenovoError::from)?;
        Ok(sys
            .get("PowerState")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string())
    }

    /// Perform a power action via Redfish ComputerSystem.Reset.
    pub async fn power_action(&self, action: &PowerAction) -> LenovoResult<()> {
        let reset_type = action.to_redfish();
        let body = serde_json::json!({ "ResetType": reset_type });
        self.inner
            .post_action("/redfish/v1/Systems/1/Actions/ComputerSystem.Reset", &body)
            .await
            .map(|_| ())
            .map_err(LenovoError::from)
    }

    /// Get power metrics from the Power resource.
    pub async fn get_power_metrics(&self) -> LenovoResult<BmcPowerMetrics> {
        let pwr: serde_json::Value = self
            .inner
            .get("/redfish/v1/Chassis/1/Power")
            .await
            .map_err(LenovoError::from)?;

        let current_watts = pwr
            .get("PowerControl")
            .and_then(|arr| arr.as_array())
            .and_then(|arr| arr.first())
            .and_then(|pc| pc.get("PowerConsumedWatts"))
            .and_then(|v| v.as_f64());

        let cap = pwr
            .get("PowerControl")
            .and_then(|arr| arr.as_array())
            .and_then(|arr| arr.first())
            .and_then(|pc| pc.get("PowerLimit"))
            .and_then(|pl| pl.get("LimitInWatts"))
            .and_then(|v| v.as_f64());

        let cap_enabled = cap.is_some() && cap.unwrap_or(0.0) > 0.0;

        Ok(BmcPowerMetrics {
            current_watts,
            min_watts: pwr
                .get("PowerControl")
                .and_then(|arr| arr.as_array())
                .and_then(|arr| arr.first())
                .and_then(|pc| pc.get("PowerMetrics"))
                .and_then(|pm| pm.get("MinConsumedWatts"))
                .and_then(|v| v.as_f64()),
            max_watts: pwr
                .get("PowerControl")
                .and_then(|arr| arr.as_array())
                .and_then(|arr| arr.first())
                .and_then(|pc| pc.get("PowerMetrics"))
                .and_then(|pm| pm.get("MaxConsumedWatts"))
                .and_then(|v| v.as_f64()),
            average_watts: pwr
                .get("PowerControl")
                .and_then(|arr| arr.as_array())
                .and_then(|arr| arr.first())
                .and_then(|pc| pc.get("PowerMetrics"))
                .and_then(|pm| pm.get("AverageConsumedWatts"))
                .and_then(|v| v.as_f64()),
            power_cap_watts: cap,
            power_cap_enabled: cap_enabled,
        })
    }

    /// Get thermal data (temperatures + fans).
    pub async fn get_thermal_data(&self) -> LenovoResult<BmcThermalData> {
        let th: serde_json::Value = self
            .inner
            .get("/redfish/v1/Chassis/1/Thermal")
            .await
            .map_err(LenovoError::from)?;

        let temperatures = th
            .get("Temperatures")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|t| BmcTemperatureSensor {
                        id: t
                            .get("MemberId")
                            .or(t.get("@odata.id"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        name: t
                            .get("Name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        reading_celsius: t.get("ReadingCelsius").and_then(|v| v.as_f64()),
                        upper_threshold_critical: t
                            .get("UpperThresholdCritical")
                            .and_then(|v| v.as_f64()),
                        upper_threshold_fatal: t
                            .get("UpperThresholdFatal")
                            .and_then(|v| v.as_f64()),
                        lower_threshold_critical: t
                            .get("LowerThresholdCritical")
                            .and_then(|v| v.as_f64()),
                        status: ComponentHealth {
                            health: t
                                .get("Status")
                                .and_then(|s| s.get("Health"))
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            state: t
                                .get("Status")
                                .and_then(|s| s.get("State"))
                                .and_then(|v| v.as_str())
                                .map(String::from),
                        },
                        physical_context: t
                            .get("PhysicalContext")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let fans = th
            .get("Fans")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|f| BmcFan {
                        id: f
                            .get("MemberId")
                            .or(f.get("@odata.id"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        name: f
                            .get("Name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        reading_rpm: f.get("Reading").and_then(|v| v.as_f64()).map(|v| v as u32),
                        reading_percent: f
                            .get("ReadingPercent")
                            .or(f.get("Reading"))
                            .and_then(|v| v.as_f64())
                            .map(|v| v as u32),
                        status: ComponentHealth {
                            health: f
                                .get("Status")
                                .and_then(|s| s.get("Health"))
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            state: f
                                .get("Status")
                                .and_then(|s| s.get("State"))
                                .and_then(|v| v.as_str())
                                .map(String::from),
                        },
                        physical_context: f
                            .get("PhysicalContext")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(BmcThermalData { temperatures, fans })
    }

    /// Get processor inventory.
    pub async fn get_processors(&self) -> LenovoResult<Vec<BmcProcessor>> {
        let coll: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1/Processors?$expand=*($levels=1)")
            .await
            .map_err(LenovoError::from)?;

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut procs = Vec::new();
        if let Some(members) = members {
            for p in members {
                procs.push(BmcProcessor {
                    id: p
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    socket: p
                        .get("Socket")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    manufacturer: p
                        .get("Manufacturer")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    model: p
                        .get("Model")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    total_cores: p.get("TotalCores").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    total_threads: p.get("TotalThreads").and_then(|v| v.as_u64()).unwrap_or(0)
                        as u32,
                    max_speed_mhz: p
                        .get("MaxSpeedMHz")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32),
                    status: ComponentHealth {
                        health: p
                            .get("Status")
                            .and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        state: p
                            .get("Status")
                            .and_then(|s| s.get("State"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    },
                });
            }
        }
        Ok(procs)
    }

    /// Get memory DIMM inventory.
    pub async fn get_memory(&self) -> LenovoResult<Vec<BmcMemoryDimm>> {
        let coll: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1/Memory?$expand=*($levels=1)")
            .await
            .map_err(LenovoError::from)?;

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut dimms = Vec::new();
        if let Some(members) = members {
            for d in members {
                // Skip absent DIMMs
                let state = d
                    .get("Status")
                    .and_then(|s| s.get("State"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if state == "Absent" {
                    continue;
                }

                dimms.push(BmcMemoryDimm {
                    id: d
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: d
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    manufacturer: d
                        .get("Manufacturer")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    capacity_mib: d.get("CapacityMiB").and_then(|v| v.as_u64()).unwrap_or(0),
                    speed_mhz: d
                        .get("OperatingSpeedMhz")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32),
                    memory_type: d
                        .get("MemoryDeviceType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    device_locator: d
                        .get("DeviceLocator")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    status: ComponentHealth {
                        health: d
                            .get("Status")
                            .and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        state: d
                            .get("Status")
                            .and_then(|s| s.get("State"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    },
                });
            }
        }
        Ok(dimms)
    }

    /// Get storage controllers.
    pub async fn get_storage_controllers(&self) -> LenovoResult<Vec<BmcStorageController>> {
        let coll: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1/Storage?$expand=*($levels=1)")
            .await
            .map_err(LenovoError::from)?;

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut controllers = Vec::new();
        if let Some(members) = members {
            for s in members {
                let sc_arr = s.get("StorageControllers").and_then(|v| v.as_array());
                if let Some(sc_arr) = sc_arr {
                    for sc in sc_arr {
                        controllers.push(BmcStorageController {
                            id: sc
                                .get("MemberId")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            name: sc
                                .get("Name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            manufacturer: sc
                                .get("Manufacturer")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            model: sc.get("Model").and_then(|v| v.as_str()).map(String::from),
                            firmware_version: sc
                                .get("FirmwareVersion")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            status: ComponentHealth {
                                health: sc
                                    .get("Status")
                                    .and_then(|s| s.get("Health"))
                                    .and_then(|v| v.as_str())
                                    .map(String::from),
                                state: sc
                                    .get("Status")
                                    .and_then(|s| s.get("State"))
                                    .and_then(|v| v.as_str())
                                    .map(String::from),
                            },
                        });
                    }
                }
            }
        }
        Ok(controllers)
    }

    /// Get virtual disks.
    pub async fn get_virtual_disks(&self) -> LenovoResult<Vec<BmcVirtualDisk>> {
        let coll: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1/Storage?$expand=*($levels=1)")
            .await
            .map_err(LenovoError::from)?;

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut vols = Vec::new();
        if let Some(members) = members {
            for s in members {
                if let Some(vol_link) = s
                    .get("Volumes")
                    .and_then(|v| v.get("@odata.id"))
                    .and_then(|v| v.as_str())
                {
                    if let Ok(vol_coll) = self.inner.get::<serde_json::Value>(vol_link).await {
                        if let Some(vol_members) =
                            vol_coll.get("Members").and_then(|v| v.as_array())
                        {
                            for vm in vol_members {
                                let uri =
                                    vm.get("@odata.id").and_then(|v| v.as_str()).unwrap_or("");
                                if uri.is_empty() {
                                    continue;
                                }
                                if let Ok(vol) = self.inner.get::<serde_json::Value>(uri).await {
                                    vols.push(BmcVirtualDisk {
                                        id: vol
                                            .get("Id")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .to_string(),
                                        name: vol
                                            .get("Name")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .to_string(),
                                        raid_level: vol
                                            .get("RAIDType")
                                            .and_then(|v| v.as_str())
                                            .map(String::from),
                                        capacity_bytes: vol
                                            .get("CapacityBytes")
                                            .and_then(|v| v.as_u64()),
                                        status: ComponentHealth {
                                            health: vol
                                                .get("Status")
                                                .and_then(|s| s.get("Health"))
                                                .and_then(|v| v.as_str())
                                                .map(String::from),
                                            state: vol
                                                .get("Status")
                                                .and_then(|s| s.get("State"))
                                                .and_then(|v| v.as_str())
                                                .map(String::from),
                                        },
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(vols)
    }

    /// Get physical disks.
    pub async fn get_physical_disks(&self) -> LenovoResult<Vec<BmcPhysicalDisk>> {
        let coll: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1/Storage?$expand=*($levels=1)")
            .await
            .map_err(LenovoError::from)?;

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut disks = Vec::new();
        if let Some(members) = members {
            for s in members {
                if let Some(drives) = s.get("Drives").and_then(|v| v.as_array()) {
                    for drive_ref in drives {
                        let uri = drive_ref
                            .get("@odata.id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if uri.is_empty() {
                            continue;
                        }
                        if let Ok(d) = self.inner.get::<serde_json::Value>(uri).await {
                            disks.push(BmcPhysicalDisk {
                                id: d
                                    .get("Id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                name: d
                                    .get("Name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                manufacturer: d
                                    .get("Manufacturer")
                                    .and_then(|v| v.as_str())
                                    .map(String::from),
                                model: d.get("Model").and_then(|v| v.as_str()).map(String::from),
                                serial_number: d
                                    .get("SerialNumber")
                                    .and_then(|v| v.as_str())
                                    .map(String::from),
                                capacity_bytes: d.get("CapacityBytes").and_then(|v| v.as_u64()),
                                media_type: d
                                    .get("MediaType")
                                    .and_then(|v| v.as_str())
                                    .map(String::from),
                                protocol: d
                                    .get("Protocol")
                                    .and_then(|v| v.as_str())
                                    .map(String::from),
                                status: ComponentHealth {
                                    health: d
                                        .get("Status")
                                        .and_then(|s| s.get("Health"))
                                        .and_then(|v| v.as_str())
                                        .map(String::from),
                                    state: d
                                        .get("Status")
                                        .and_then(|s| s.get("State"))
                                        .and_then(|v| v.as_str())
                                        .map(String::from),
                                },
                            });
                        }
                    }
                }
            }
        }
        Ok(disks)
    }

    /// Get network adapters.
    pub async fn get_network_adapters(&self) -> LenovoResult<Vec<BmcNetworkAdapter>> {
        let coll: serde_json::Value = match self
            .inner
            .get("/redfish/v1/Systems/1/NetworkInterfaces?$expand=*($levels=1)")
            .await
        {
            Ok(v) => v,
            Err(_) => self
                .inner
                .get("/redfish/v1/Systems/1/EthernetInterfaces?$expand=*($levels=1)")
                .await
                .map_err(LenovoError::from)?,
        };

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut adapters = Vec::new();
        if let Some(members) = members {
            for n in members {
                adapters.push(BmcNetworkAdapter {
                    id: n
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: n
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    manufacturer: n
                        .get("Manufacturer")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    model: n.get("Model").and_then(|v| v.as_str()).map(String::from),
                    mac_address: n
                        .get("MACAddress")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    status: ComponentHealth {
                        health: n
                            .get("Status")
                            .and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        state: n
                            .get("Status")
                            .and_then(|s| s.get("State"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    },
                });
            }
        }
        Ok(adapters)
    }

    /// Get XCC network info.
    pub async fn get_xcc_network(&self) -> LenovoResult<serde_json::Value> {
        self.inner
            .get("/redfish/v1/Managers/1/EthernetInterfaces/1")
            .await
            .map_err(LenovoError::from)
    }

    /// Get firmware inventory.
    pub async fn get_firmware_inventory(&self) -> LenovoResult<Vec<BmcFirmwareItem>> {
        let coll: serde_json::Value = self
            .inner
            .get("/redfish/v1/UpdateService/FirmwareInventory?$expand=*($levels=1)")
            .await
            .map_err(LenovoError::from)?;

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut items = Vec::new();
        if let Some(members) = members {
            for fw in members {
                items.push(BmcFirmwareItem {
                    id: fw
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: fw
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
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
                        .get("SoftwareId")
                        .or(fw.get("@odata.type"))
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    status: ComponentHealth {
                        health: fw
                            .get("Status")
                            .and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        state: fw
                            .get("Status")
                            .and_then(|s| s.get("State"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    },
                });
            }
        }
        Ok(items)
    }

    /// Get virtual media status.
    pub async fn get_virtual_media_status(&self) -> LenovoResult<Vec<BmcVirtualMedia>> {
        let coll: serde_json::Value = self
            .inner
            .get("/redfish/v1/Managers/1/VirtualMedia?$expand=*($levels=1)")
            .await
            .map_err(LenovoError::from)?;

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut media = Vec::new();
        if let Some(members) = members {
            for vm in members {
                media.push(BmcVirtualMedia {
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
                                .filter_map(|t| t.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default(),
                    image: vm.get("Image").and_then(|v| v.as_str()).map(String::from),
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
                        .map(String::from),
                });
            }
        }
        Ok(media)
    }

    /// Insert virtual media.
    pub async fn insert_virtual_media(&self, slot: &str, image_url: &str) -> LenovoResult<()> {
        let body = serde_json::json!({
            "Image": image_url,
            "Inserted": true,
            "WriteProtected": true,
        });
        self.inner
            .post_action(
                &format!(
                    "/redfish/v1/Managers/1/VirtualMedia/{}/Actions/VirtualMedia.InsertMedia",
                    slot
                ),
                &body,
            )
            .await
            .map(|_| ())
            .map_err(LenovoError::from)
    }

    /// Eject virtual media.
    pub async fn eject_virtual_media(&self, slot: &str) -> LenovoResult<()> {
        let body = serde_json::json!({});
        self.inner
            .post_action(
                &format!(
                    "/redfish/v1/Managers/1/VirtualMedia/{}/Actions/VirtualMedia.EjectMedia",
                    slot
                ),
                &body,
            )
            .await
            .map(|_| ())
            .map_err(LenovoError::from)
    }

    /// Get event log entries (System Event Log).
    pub async fn get_event_log(&self) -> LenovoResult<Vec<BmcEventLogEntry>> {
        let coll: serde_json::Value = match self
            .inner
            .get("/redfish/v1/Systems/1/LogServices/StandardLog/Entries?$expand=*($levels=1)")
            .await
        {
            Ok(v) => v,
            Err(_) => self
                .inner
                .get("/redfish/v1/Managers/1/LogServices/ActiveLog/Entries?$expand=*($levels=1)")
                .await
                .map_err(LenovoError::from)?,
        };

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut entries = Vec::new();
        if let Some(members) = members {
            for e in members.iter().take(500) {
                entries.push(BmcEventLogEntry {
                    id: e
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    created: e
                        .get("Created")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    severity: e
                        .get("Severity")
                        .and_then(|v| v.as_str())
                        .unwrap_or("OK")
                        .to_string(),
                    message: e
                        .get("Message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    message_id: e
                        .get("MessageId")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    entry_type: e
                        .get("EntryType")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                });
            }
        }
        Ok(entries)
    }

    /// Get audit log entries (XCC audit log).
    pub async fn get_audit_log(&self) -> LenovoResult<Vec<BmcEventLogEntry>> {
        let coll: serde_json::Value = self
            .inner
            .get("/redfish/v1/Managers/1/LogServices/AuditLog/Entries?$expand=*($levels=1)")
            .await
            .map_err(LenovoError::from)?;

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut entries = Vec::new();
        if let Some(members) = members {
            for e in members.iter().take(500) {
                entries.push(BmcEventLogEntry {
                    id: e
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    created: e
                        .get("Created")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    severity: e
                        .get("Severity")
                        .and_then(|v| v.as_str())
                        .unwrap_or("OK")
                        .to_string(),
                    message: e
                        .get("Message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    message_id: e
                        .get("MessageId")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    entry_type: Some("Audit".to_string()),
                });
            }
        }
        Ok(entries)
    }

    /// Clear event log.
    pub async fn clear_event_log(&self) -> LenovoResult<()> {
        let body = serde_json::json!({});
        let result = self
            .inner
            .post_action(
                "/redfish/v1/Systems/1/LogServices/StandardLog/Actions/LogService.ClearLog",
                &body,
            )
            .await;
        match result {
            Ok(_) => Ok(()),
            Err(_) => self
                .inner
                .post_action(
                    "/redfish/v1/Managers/1/LogServices/ActiveLog/Actions/LogService.ClearLog",
                    &body,
                )
                .await
                .map(|_| ())
                .map_err(LenovoError::from),
        }
    }

    /// Get local users.
    pub async fn get_users(&self) -> LenovoResult<Vec<BmcUser>> {
        let coll: serde_json::Value = self
            .inner
            .get("/redfish/v1/AccountService/Accounts?$expand=*($levels=1)")
            .await
            .map_err(LenovoError::from)?;

        let members = coll.get("Members").and_then(|v| v.as_array());
        let mut users = Vec::new();
        if let Some(members) = members {
            for u in members {
                let username = u.get("UserName").and_then(|v| v.as_str()).unwrap_or("");
                if username.is_empty() {
                    continue;
                }
                users.push(BmcUser {
                    id: u
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    username: username.to_string(),
                    role: u
                        .get("RoleId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    enabled: u.get("Enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                    locked: u.get("Locked").and_then(|v| v.as_bool()).unwrap_or(false),
                });
            }
        }
        Ok(users)
    }

    /// Create a new local user.
    pub async fn create_user(
        &self,
        username: &str,
        password: &str,
        role: &str,
    ) -> LenovoResult<()> {
        let body = serde_json::json!({
            "UserName": username,
            "Password": password,
            "RoleId": role,
            "Enabled": true,
        });
        self.inner
            .post_json::<_, serde_json::Value>("/redfish/v1/AccountService/Accounts", &body)
            .await
            .map_err(LenovoError::from)?;
        Ok(())
    }

    /// Update user password.
    pub async fn update_password(&self, user_id: &str, password: &str) -> LenovoResult<()> {
        let body = serde_json::json!({ "Password": password });
        self.inner
            .patch_json(
                &format!("/redfish/v1/AccountService/Accounts/{}", user_id),
                &body,
            )
            .await
            .map_err(LenovoError::from)
    }

    /// Delete a user.
    pub async fn delete_user(&self, user_id: &str) -> LenovoResult<()> {
        self.inner
            .delete(&format!("/redfish/v1/AccountService/Accounts/{}", user_id))
            .await
            .map_err(LenovoError::from)
    }

    /// Get BIOS attributes.
    pub async fn get_bios_attributes(&self) -> LenovoResult<Vec<BiosAttribute>> {
        let bios: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1/Bios")
            .await
            .map_err(LenovoError::from)?;

        let pending: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1/Bios/Settings")
            .await
            .unwrap_or(serde_json::json!({}));

        let attrs = bios.get("Attributes").and_then(|v| v.as_object());
        let pending_attrs = pending.get("Attributes").and_then(|v| v.as_object());

        let mut result = Vec::new();
        if let Some(attrs) = attrs {
            for (name, value) in attrs {
                let pending_value = pending_attrs
                    .and_then(|p| p.get(name))
                    .filter(|pv| *pv != value)
                    .cloned();

                result.push(BiosAttribute {
                    name: name.clone(),
                    current_value: value.clone(),
                    pending_value,
                    read_only: false,
                    attribute_type: None,
                    allowed_values: None,
                });
            }
        }
        Ok(result)
    }

    /// Set BIOS attributes (applied on next reboot).
    pub async fn set_bios_attributes(&self, attrs: &serde_json::Value) -> LenovoResult<()> {
        let body = serde_json::json!({ "Attributes": attrs });
        self.inner
            .patch_json("/redfish/v1/Systems/1/Bios/Settings", &body)
            .await
            .map_err(LenovoError::from)
    }

    /// Get boot configuration.
    pub async fn get_boot_config(&self) -> LenovoResult<BootConfig> {
        let sys: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1")
            .await
            .map_err(LenovoError::from)?;

        let default_boot = serde_json::json!({});
        let boot = sys.get("Boot").unwrap_or(&default_boot);
        Ok(BootConfig {
            boot_mode: boot
                .get("BootSourceOverrideMode")
                .and_then(|v| v.as_str())
                .unwrap_or("UEFI")
                .to_string(),
            boot_order: boot
                .get("BootOrder")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| s.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            next_boot_override: boot
                .get("BootSourceOverrideTarget")
                .and_then(|v| v.as_str())
                .map(String::from),
            uefi_target: boot
                .get("UefiTargetBootSourceOverride")
                .and_then(|v| v.as_str())
                .map(String::from),
        })
    }

    /// Set one-time boot override.
    pub async fn set_boot_override(&self, target: &str, mode: Option<&str>) -> LenovoResult<()> {
        let mut boot = serde_json::json!({
            "BootSourceOverrideTarget": target,
            "BootSourceOverrideEnabled": "Once",
        });
        if let Some(m) = mode {
            boot.as_object_mut()
                .unwrap()
                .insert("BootSourceOverrideMode".into(), serde_json::json!(m));
        }
        let body = serde_json::json!({ "Boot": boot });
        self.inner
            .patch_json("/redfish/v1/Systems/1", &body)
            .await
            .map_err(LenovoError::from)
    }

    /// Get HTTPS certificate.
    pub async fn get_certificate(&self) -> LenovoResult<XccCertificate> {
        // XCC stores HTTPS cert at the Redfish CertificateService or NetworkProtocol
        let cert: serde_json::Value = match self
            .inner
            .get("/redfish/v1/Managers/1/NetworkProtocol/HTTPS/Certificates/1")
            .await
        {
            Ok(v) => v,
            Err(_) => self
                .inner
                .get("/redfish/v1/CertificateService/CertificateLocations")
                .await
                .map_err(LenovoError::from)?,
        };

        Ok(XccCertificate {
            subject: cert
                .get("Subject")
                .and_then(|s| s.get("CommonName"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            issuer: cert
                .get("Issuer")
                .and_then(|s| s.get("CommonName"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            valid_from: cert
                .get("ValidNotBefore")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            valid_to: cert
                .get("ValidNotAfter")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            serial_number: cert
                .get("SerialNumber")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            fingerprint: cert
                .get("Fingerprint")
                .and_then(|v| v.as_str())
                .map(String::from),
            key_usage: cert.get("KeyUsage").and_then(|v| v.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            }),
            self_signed: cert.get("Issuer") == cert.get("Subject"),
        })
    }

    /// Generate a Certificate Signing Request.
    pub async fn generate_csr(&self, params: &CsrParams) -> LenovoResult<String> {
        let body = serde_json::json!({
            "CommonName": params.common_name,
            "Organization": params.organization,
            "OrganizationalUnit": params.organizational_unit,
            "City": params.city,
            "State": params.state,
            "Country": params.country,
            "AlternativeNames": params.alt_names,
        });
        let resp: serde_json::Value = self
            .inner
            .post_json(
                "/redfish/v1/CertificateService/Actions/CertificateService.GenerateCSR",
                &body,
            )
            .await
            .map_err(LenovoError::from)?;
        Ok(resp
            .get("CSRString")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    }

    /// Get license information.
    pub async fn get_license(&self) -> LenovoResult<XccLicense> {
        // XCC uses Lenovo OEM license endpoint
        let lic: serde_json::Value = match self
            .inner
            .get("/redfish/v1/LicenseService/Licenses/1")
            .await
        {
            Ok(v) => v,
            Err(_) => self
                .inner
                .get("/redfish/v1/Managers/1")
                .await
                .map_err(LenovoError::from)?,
        };

        let tier = if let Some(lic_type) = lic.get("LicenseType").and_then(|v| v.as_str()) {
            match lic_type {
                "Standard" | "Base" => XccLicenseTier::Standard,
                "Advanced" => XccLicenseTier::Advanced,
                "Enterprise" | "XClarity" => XccLicenseTier::Enterprise,
                "FoD" | "Features On Demand" => XccLicenseTier::Fod,
                other => XccLicenseTier::Other(other.to_string()),
            }
        } else {
            XccLicenseTier::Standard
        };

        Ok(XccLicense {
            tier,
            description: lic
                .get("Description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            expiration: lic
                .get("ExpirationDate")
                .and_then(|v| v.as_str())
                .map(String::from),
            key_id: lic.get("Id").and_then(|v| v.as_str()).map(String::from),
            features: lic
                .get("Oem")
                .and_then(|o| o.get("Lenovo"))
                .and_then(|l| l.get("Features"))
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|f| f.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            status: lic
                .get("Status")
                .and_then(|s| s.get("State"))
                .and_then(|v| v.as_str())
                .unwrap_or("Enabled")
                .to_string(),
        })
    }

    /// Activate a license key.
    pub async fn activate_license(&self, key: &str) -> LenovoResult<()> {
        let body = serde_json::json!({ "LicenseString": key });
        self.inner
            .post_json::<_, serde_json::Value>("/redfish/v1/LicenseService/Licenses", &body)
            .await
            .map_err(LenovoError::from)?;
        Ok(())
    }

    /// Get health rollup.
    pub async fn get_health_rollup(&self) -> LenovoResult<BmcHealthRollup> {
        let sys: serde_json::Value = self
            .inner
            .get("/redfish/v1/Systems/1")
            .await
            .map_err(LenovoError::from)?;

        let overall = sys
            .get("Status")
            .and_then(|s| s.get("HealthRollup"))
            .and_then(|v| v.as_str())
            .unwrap_or("OK")
            .to_string();
        let proc_health = sys
            .get("ProcessorSummary")
            .and_then(|p| p.get("Status"))
            .and_then(|s| s.get("HealthRollup"))
            .and_then(|v| v.as_str())
            .unwrap_or("OK")
            .to_string();
        let mem_health = sys
            .get("MemorySummary")
            .and_then(|m| m.get("Status"))
            .and_then(|s| s.get("HealthRollup"))
            .and_then(|v| v.as_str())
            .unwrap_or("OK")
            .to_string();

        Ok(BmcHealthRollup {
            overall,
            processors: proc_health,
            memory: mem_health,
            storage: "OK".to_string(),
            fans: "OK".to_string(),
            temperatures: "OK".to_string(),
            power_supplies: "OK".to_string(),
            network: "OK".to_string(),
        })
    }

    /// Get security status.
    pub async fn get_security_status(&self) -> LenovoResult<XccSecurityStatus> {
        let np: serde_json::Value = self
            .inner
            .get("/redfish/v1/Managers/1/NetworkProtocol")
            .await
            .map_err(LenovoError::from)?;

        let tls = np
            .get("HTTPS")
            .and_then(|h| h.get("Certificates"))
            .map(|_| "TLS 1.2+".to_string())
            .unwrap_or("Unknown".to_string());

        let ipmi = np
            .get("IPMI")
            .and_then(|i| i.get("ProtocolEnabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let ssh = np
            .get("SSH")
            .and_then(|s| s.get("ProtocolEnabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let snmp = np
            .get("SNMP")
            .and_then(|s| s.get("ProtocolEnabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let mut risks = Vec::new();
        if ipmi {
            risks.push(SecurityRiskItem {
                id: "IPMI_ENABLED".to_string(),
                severity: "Warning".to_string(),
                description: "IPMI over LAN is enabled — consider disabling for improved security"
                    .to_string(),
                remediation: Some("Disable IPMI over LAN in XCC network settings".to_string()),
            });
        }

        Ok(XccSecurityStatus {
            overall_status: if risks.is_empty() {
                "Secure".to_string()
            } else {
                "Warning".to_string()
            },
            tls_version: tls,
            ipmi_over_lan: ipmi,
            ssh_enabled: ssh,
            snmp_enabled: snmp,
            cim_over_https: np
                .get("CIM")
                .and_then(|c| c.get("ProtocolEnabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            security_risks: risks,
        })
    }

    /// Get HTML5 console launch URL.
    pub async fn get_html5_console_url(&self) -> LenovoResult<String> {
        // XCC HTML5 console is typically at /ui/kvm
        let base = format!(
            "https://{}:{}",
            self.inner.config().host,
            self.inner.config().port
        );
        Ok(format!("{}/ui/kvm", base))
    }

    /// Get console info.
    pub async fn get_console_info(&self) -> LenovoResult<XccConsoleInfo> {
        let gen = &self.generation;
        let mut console_types = Vec::new();
        if gen.supports_html5_console() {
            console_types.push(ConsoleType::Html5);
        }
        if gen.supports_java_console() {
            console_types.push(ConsoleType::JavaApplet);
        }

        let html5_url = if gen.supports_html5_console() {
            Some(self.get_html5_console_url().await?)
        } else {
            None
        };

        Ok(XccConsoleInfo {
            console_types,
            max_sessions: 4,
            active_sessions: 0,
            html5_url,
            requires_license: true,
        })
    }

    /// Reset the XCC/IMM controller.
    pub async fn reset_controller(&self) -> LenovoResult<()> {
        let body = serde_json::json!({ "ResetType": "GracefulRestart" });
        self.inner
            .post_action("/redfish/v1/Managers/1/Actions/Manager.Reset", &body)
            .await
            .map(|_| ())
            .map_err(LenovoError::from)
    }
}
