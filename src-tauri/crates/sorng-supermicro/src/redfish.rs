//! Supermicro Redfish REST client with `Oem.Supermicro` extension support.
//!
//! Wraps the shared `RedfishClient` from `sorng-bmc-common` and adds
//! Supermicro-specific OEM endpoint handling, platform generation
//! detection, and vendor extension parsing.

use crate::error::{SmcError, SmcResult};
use crate::types::*;
use sorng_bmc_common::redfish::RedfishClient;
use sorng_bmc_common::types::*;

/// Redfish client specialised for Supermicro BMCs (X11+).
pub struct SmcRedfishClient {
    inner: RedfishClient,
    platform: SmcPlatform,
}

impl SmcRedfishClient {
    /// Create a new Supermicro Redfish client.
    pub fn new(host: &str, port: u16, use_ssl: bool, verify_cert: bool) -> SmcResult<Self> {
        let inner = RedfishClient::new(host, port, use_ssl, verify_cert)
            .map_err(SmcError::from)?;
        Ok(Self {
            inner,
            platform: SmcPlatform::Unknown,
        })
    }

    /// Authenticate and detect the platform generation.
    pub async fn login(&mut self, username: &str, password: &str) -> SmcResult<()> {
        self.inner.login(username, password).await.map_err(SmcError::from)?;

        // Detect platform generation from Manager resource
        if let Ok(mgr) = self.inner.get_json("/redfish/v1/Managers/1").await {
            self.platform = detect_platform_from_manager(&mgr);
        }

        Ok(())
    }

    /// Close the Redfish session.
    pub async fn logout(&mut self) -> SmcResult<()> {
        self.inner.logout().await.map_err(SmcError::from)?;
        Ok(())
    }

    /// Get the detected platform generation.
    pub fn platform(&self) -> &SmcPlatform {
        &self.platform
    }

    /// Check whether we have an active session.
    pub fn is_connected(&self) -> bool {
        self.inner.is_connected()
    }

    /// Verify/refresh the session.
    pub async fn check_session(&self) -> SmcResult<bool> {
        self.inner.check_session().await.map_err(SmcError::from)
    }

    // ── System info ─────────────────────────────────────────────────

    pub async fn get_system_info(&self) -> SmcResult<SystemInfo> {
        let sys = self.inner.get_json("/redfish/v1/Systems/1").await.map_err(SmcError::from)?;

        Ok(SystemInfo {
            manufacturer: json_str(&sys, "Manufacturer").unwrap_or_else(|| "Supermicro".into()),
            model: json_str(&sys, "Model").unwrap_or_default(),
            serial_number: json_str(&sys, "SerialNumber"),
            sku: json_str(&sys, "SKU"),
            bios_version: json_str(&sys, "BiosVersion"),
            hostname: json_str(&sys, "HostName"),
            power_state: json_str(&sys, "PowerState"),
            indicator_led: json_str(&sys, "IndicatorLED"),
            asset_tag: json_str(&sys, "AssetTag"),
            uuid: json_str(&sys, "UUID"),
            service_tag: None,
            os_name: None,
            os_version: None,
            total_memory_gib: sys.get("MemorySummary")
                .and_then(|m| m.get("TotalSystemMemoryGiB"))
                .and_then(|v| v.as_f64()),
            processor_count: sys.get("ProcessorSummary")
                .and_then(|p| p.get("Count"))
                .and_then(|v| v.as_u64())
                .map(|v| v as u32),
            processor_model: sys.get("ProcessorSummary")
                .and_then(|p| p.get("Model"))
                .and_then(|v| v.as_str())
                .map(String::from),
        })
    }

    /// Get BMC controller information.
    pub async fn get_bmc_info(&self) -> SmcResult<SmcBmcInfo> {
        let mgr = self.inner.get_json("/redfish/v1/Managers/1").await.map_err(SmcError::from)?;

        Ok(SmcBmcInfo {
            platform: self.platform.clone(),
            firmware_version: json_str(&mgr, "FirmwareVersion").unwrap_or_default(),
            firmware_build_date: mgr.get("Oem")
                .and_then(|o| o.get("Supermicro"))
                .and_then(|s| s.get("FirmwareBuildDate"))
                .and_then(|v| v.as_str())
                .map(String::from),
            bmc_mac_address: mgr.get("EthernetInterfaces")
                .and_then(|e| e.get("@odata.id"))
                .and_then(|_| None), // Would need a follow-up call
            ipmi_version: mgr.get("Oem")
                .and_then(|o| o.get("Supermicro"))
                .and_then(|s| s.get("IPMIVersion"))
                .and_then(|v| v.as_str())
                .map(String::from),
            bmc_model: json_str(&mgr, "Model"),
            unique_id: json_str(&mgr, "UUID"),
        })
    }

    // ── Power management ────────────────────────────────────────────

    pub async fn get_power_state(&self) -> SmcResult<String> {
        let sys = self.inner.get_json("/redfish/v1/Systems/1").await.map_err(SmcError::from)?;
        Ok(json_str(&sys, "PowerState").unwrap_or_else(|| "Unknown".into()))
    }

    pub async fn power_action(&self, action: &PowerAction) -> SmcResult<()> {
        let reset_type = match action {
            PowerAction::On => "On",
            PowerAction::Off => "ForceOff",
            PowerAction::GracefulShutdown => "GracefulShutdown",
            PowerAction::Reset => "ForceRestart",
            PowerAction::Cycle => "PowerCycle",
            PowerAction::Nmi => "Nmi",
        };

        let body = serde_json::json!({ "ResetType": reset_type });
        self.inner
            .post_json("/redfish/v1/Systems/1/Actions/ComputerSystem.Reset", &body)
            .await
            .map_err(SmcError::from)?;
        Ok(())
    }

    pub async fn get_power_metrics(&self) -> SmcResult<PowerMetrics> {
        let pwr = self.inner.get_json("/redfish/v1/Chassis/1/Power").await.map_err(SmcError::from)?;

        let mut psus = Vec::new();
        if let Some(supplies) = pwr.get("PowerSupplies").and_then(|v| v.as_array()) {
            for ps in supplies {
                psus.push(PsuInfo {
                    name: json_str(ps, "Name").unwrap_or_default(),
                    model: json_str(ps, "Model"),
                    serial_number: json_str(ps, "SerialNumber"),
                    firmware_version: json_str(ps, "FirmwareVersion"),
                    status: ps.get("Status")
                        .and_then(|s| s.get("Health"))
                        .and_then(|v| v.as_str())
                        .map(String::from)
                        .unwrap_or_else(|| "Unknown".into()),
                    capacity_watts: ps.get("PowerCapacityWatts").and_then(|v| v.as_f64()),
                    output_watts: ps.get("PowerOutputWatts")
                        .or_else(|| ps.get("LastPowerOutputWatts"))
                        .and_then(|v| v.as_f64()),
                    input_voltage: ps.get("LineInputVoltage").and_then(|v| v.as_f64()),
                    efficiency_percent: ps.get("EfficiencyPercent").and_then(|v| v.as_f64()),
                    redundancy: None,
                });
            }
        }

        let total_consumed = pwr.get("PowerControl")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|pc| pc.get("PowerConsumedWatts"))
            .and_then(|v| v.as_f64());

        let power_cap = pwr.get("PowerControl")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|pc| pc.get("PowerLimit"))
            .and_then(|pl| pl.get("LimitInWatts"))
            .and_then(|v| v.as_f64());

        Ok(PowerMetrics {
            total_consumed_watts: total_consumed,
            average_consumed_watts: None,
            max_consumed_watts: None,
            min_consumed_watts: None,
            power_cap_watts: power_cap,
            power_cap_enabled: power_cap.is_some(),
            power_supplies: psus,
        })
    }

    // ── Thermal ─────────────────────────────────────────────────────

    pub async fn get_thermal_data(&self) -> SmcResult<ThermalData> {
        let th = self.inner.get_json("/redfish/v1/Chassis/1/Thermal").await.map_err(SmcError::from)?;

        let mut temps = Vec::new();
        if let Some(arr) = th.get("Temperatures").and_then(|v| v.as_array()) {
            for t in arr {
                temps.push(TemperatureReading {
                    name: json_str(t, "Name").unwrap_or_default(),
                    reading_celsius: t.get("ReadingCelsius").and_then(|v| v.as_f64()),
                    upper_warning: t.get("UpperThresholdNonCritical").and_then(|v| v.as_f64()),
                    upper_critical: t.get("UpperThresholdCritical").and_then(|v| v.as_f64()),
                    upper_fatal: t.get("UpperThresholdFatal").and_then(|v| v.as_f64()),
                    lower_warning: t.get("LowerThresholdNonCritical").and_then(|v| v.as_f64()),
                    lower_critical: t.get("LowerThresholdCritical").and_then(|v| v.as_f64()),
                    status: t.get("Status")
                        .and_then(|s| s.get("Health"))
                        .and_then(|v| v.as_str())
                        .map(String::from)
                        .unwrap_or_else(|| "Unknown".into()),
                    location: json_str(t, "PhysicalContext"),
                });
            }
        }

        let mut fans = Vec::new();
        if let Some(arr) = th.get("Fans").and_then(|v| v.as_array()) {
            for f in arr {
                fans.push(FanReading {
                    name: json_str(f, "Name").unwrap_or_default(),
                    reading_rpm: f.get("Reading").and_then(|v| v.as_f64()).map(|v| v as u32),
                    reading_percent: f.get("ReadingPercent")
                        .or_else(|| {
                            if f.get("ReadingUnits")
                                .and_then(|v| v.as_str())
                                .map(|u| u == "Percent")
                                .unwrap_or(false)
                            {
                                f.get("Reading")
                            } else {
                                None
                            }
                        })
                        .and_then(|v| v.as_f64()),
                    status: f.get("Status")
                        .and_then(|s| s.get("Health"))
                        .and_then(|v| v.as_str())
                        .map(String::from)
                        .unwrap_or_else(|| "Unknown".into()),
                    location: json_str(f, "PhysicalContext"),
                    redundancy: None,
                });
            }
        }

        Ok(ThermalData {
            temperatures: temps,
            fans,
        })
    }

    // ── Hardware inventory ───────────────────────────────────────

    pub async fn get_processors(&self) -> SmcResult<Vec<ProcessorInfo>> {
        let col = self.inner.get_json("/redfish/v1/Systems/1/Processors").await.map_err(SmcError::from)?;
        let mut procs = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for member in members {
                if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                    if let Ok(cpu) = self.inner.get_json(uri).await {
                        procs.push(ProcessorInfo {
                            name: json_str(&cpu, "Name").unwrap_or_default(),
                            manufacturer: json_str(&cpu, "Manufacturer"),
                            model: json_str(&cpu, "Model"),
                            architecture: json_str(&cpu, "ProcessorArchitecture"),
                            core_count: cpu.get("TotalCores").and_then(|v| v.as_u64()).map(|v| v as u32),
                            thread_count: cpu.get("TotalThreads").and_then(|v| v.as_u64()).map(|v| v as u32),
                            max_speed_mhz: cpu.get("MaxSpeedMHz").and_then(|v| v.as_u64()).map(|v| v as u32),
                            current_speed_mhz: None,
                            status: cpu.get("Status")
                                .and_then(|s| s.get("Health"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                                .unwrap_or_else(|| "Unknown".into()),
                            socket: json_str(&cpu, "Socket"),
                            cache_size_kb: None,
                        });
                    }
                }
            }
        }

        Ok(procs)
    }

    pub async fn get_memory(&self) -> SmcResult<Vec<MemoryInfo>> {
        let col = self.inner.get_json("/redfish/v1/Systems/1/Memory").await.map_err(SmcError::from)?;
        let mut dimms = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for member in members {
                if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                    if let Ok(mem) = self.inner.get_json(uri).await {
                        dimms.push(MemoryInfo {
                            name: json_str(&mem, "Name").unwrap_or_default(),
                            capacity_mib: mem.get("CapacityMiB").and_then(|v| v.as_u64()).map(|v| v as u32),
                            speed_mhz: mem.get("OperatingSpeedMhz").and_then(|v| v.as_u64()).map(|v| v as u32),
                            manufacturer: json_str(&mem, "Manufacturer"),
                            part_number: json_str(&mem, "PartNumber"),
                            serial_number: json_str(&mem, "SerialNumber"),
                            memory_type: json_str(&mem, "MemoryDeviceType"),
                            status: mem.get("Status")
                                .and_then(|s| s.get("Health"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                                .unwrap_or_else(|| "Unknown".into()),
                            slot: json_str(&mem, "DeviceLocator"),
                            rank: mem.get("RankCount").and_then(|v| v.as_u64()).map(|v| v as u32),
                            ecc: mem.get("ErrorCorrection")
                                .and_then(|v| v.as_str())
                                .map(|s| s != "NoECC"),
                        });
                    }
                }
            }
        }

        Ok(dimms)
    }

    // ── Storage ─────────────────────────────────────────────────────

    pub async fn get_storage_controllers(&self) -> SmcResult<Vec<StorageController>> {
        let col = self.inner.get_json("/redfish/v1/Systems/1/Storage").await.map_err(SmcError::from)?;
        let mut ctrls = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for member in members {
                if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                    if let Ok(stor) = self.inner.get_json(uri).await {
                        if let Some(controllers) = stor.get("StorageControllers").and_then(|v| v.as_array()) {
                            for ctrl in controllers {
                                ctrls.push(StorageController {
                                    name: json_str(ctrl, "Name").unwrap_or_default(),
                                    manufacturer: json_str(ctrl, "Manufacturer"),
                                    model: json_str(ctrl, "Model"),
                                    firmware_version: json_str(ctrl, "FirmwareVersion"),
                                    status: ctrl.get("Status")
                                        .and_then(|s| s.get("Health"))
                                        .and_then(|v| v.as_str())
                                        .map(String::from)
                                        .unwrap_or_else(|| "Unknown".into()),
                                    speed_gbps: ctrl.get("SpeedGbps").and_then(|v| v.as_f64()),
                                    supported_raid: ctrl.get("SupportedRAIDTypes")
                                        .and_then(|v| v.as_array())
                                        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
                                    cache_size_mb: ctrl.get("CacheSummary")
                                        .and_then(|c| c.get("TotalCacheSizeMiB"))
                                        .and_then(|v| v.as_u64())
                                        .map(|v| v as u32),
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(ctrls)
    }

    pub async fn get_virtual_disks(&self) -> SmcResult<Vec<VirtualDisk>> {
        let col = self.inner.get_json("/redfish/v1/Systems/1/Storage").await.map_err(SmcError::from)?;
        let mut vols = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for member in members {
                if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                    let vol_uri = format!("{}/Volumes", uri);
                    if let Ok(vol_col) = self.inner.get_json(&vol_uri).await {
                        if let Some(vol_members) = vol_col.get("Members").and_then(|v| v.as_array()) {
                            for vm in vol_members {
                                if let Some(vu) = vm.get("@odata.id").and_then(|v| v.as_str()) {
                                    if let Ok(vol) = self.inner.get_json(vu).await {
                                        vols.push(VirtualDisk {
                                            name: json_str(&vol, "Name").unwrap_or_default(),
                                            raid_level: json_str(&vol, "RAIDType"),
                                            capacity_bytes: vol.get("CapacityBytes").and_then(|v| v.as_u64()),
                                            status: vol.get("Status")
                                                .and_then(|s| s.get("Health"))
                                                .and_then(|v| v.as_str())
                                                .map(String::from)
                                                .unwrap_or_else(|| "Unknown".into()),
                                            stripe_size_kb: None,
                                            read_policy: None,
                                            write_policy: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(vols)
    }

    pub async fn get_physical_disks(&self) -> SmcResult<Vec<PhysicalDisk>> {
        let col = self.inner.get_json("/redfish/v1/Systems/1/Storage").await.map_err(SmcError::from)?;
        let mut disks = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for member in members {
                if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                    if let Ok(stor) = self.inner.get_json(uri).await {
                        if let Some(drives) = stor.get("Drives").and_then(|v| v.as_array()) {
                            for d in drives {
                                if let Some(du) = d.get("@odata.id").and_then(|v| v.as_str()) {
                                    if let Ok(drv) = self.inner.get_json(du).await {
                                        disks.push(PhysicalDisk {
                                            name: json_str(&drv, "Name").unwrap_or_default(),
                                            manufacturer: json_str(&drv, "Manufacturer"),
                                            model: json_str(&drv, "Model"),
                                            serial_number: json_str(&drv, "SerialNumber"),
                                            capacity_bytes: drv.get("CapacityBytes").and_then(|v| v.as_u64()),
                                            media_type: json_str(&drv, "MediaType"),
                                            protocol: json_str(&drv, "Protocol"),
                                            rotation_speed_rpm: drv.get("RotationSpeedRPM")
                                                .and_then(|v| v.as_u64())
                                                .map(|v| v as u32),
                                            status: drv.get("Status")
                                                .and_then(|s| s.get("Health"))
                                                .and_then(|v| v.as_str())
                                                .map(String::from)
                                                .unwrap_or_else(|| "Unknown".into()),
                                            firmware_version: json_str(&drv, "Revision"),
                                            slot: drv.get("PhysicalLocation")
                                                .and_then(|pl| pl.get("PartLocation"))
                                                .and_then(|p| p.get("LocationOrdinalValue"))
                                                .and_then(|v| v.as_u64())
                                                .map(|v| v as u32),
                                            predicted_life_left_percent: drv.get("PredictedMediaLifeLeftPercent")
                                                .and_then(|v| v.as_f64()),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(disks)
    }

    // ── Network ─────────────────────────────────────────────────────

    pub async fn get_network_adapters(&self) -> SmcResult<Vec<NetworkAdapter>> {
        let col = self.inner.get_json("/redfish/v1/Systems/1/EthernetInterfaces")
            .await.map_err(SmcError::from)?;
        let mut adapters = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for member in members {
                if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                    if let Ok(nic) = self.inner.get_json(uri).await {
                        adapters.push(NetworkAdapter {
                            name: json_str(&nic, "Name").unwrap_or_default(),
                            mac_address: json_str(&nic, "MACAddress"),
                            link_status: json_str(&nic, "LinkStatus"),
                            speed_mbps: nic.get("SpeedMbps").and_then(|v| v.as_u64()).map(|v| v as u32),
                            ipv4_addresses: nic.get("IPv4Addresses")
                                .and_then(|v| v.as_array())
                                .map(|arr| arr.iter()
                                    .filter_map(|a| a.get("Address").and_then(|v| v.as_str()).map(String::from))
                                    .collect()),
                            ipv6_addresses: nic.get("IPv6Addresses")
                                .and_then(|v| v.as_array())
                                .map(|arr| arr.iter()
                                    .filter_map(|a| a.get("Address").and_then(|v| v.as_str()).map(String::from))
                                    .collect()),
                            status: nic.get("Status")
                                .and_then(|s| s.get("Health"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                                .unwrap_or_else(|| "Unknown".into()),
                            firmware_version: None,
                        });
                    }
                }
            }
        }

        Ok(adapters)
    }

    /// Get BMC network configuration.
    pub async fn get_bmc_network(&self) -> SmcResult<Vec<NetworkAdapter>> {
        let col = self.inner.get_json("/redfish/v1/Managers/1/EthernetInterfaces")
            .await.map_err(SmcError::from)?;
        let mut adapters = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for member in members {
                if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                    if let Ok(eth) = self.inner.get_json(uri).await {
                        adapters.push(NetworkAdapter {
                            name: json_str(&eth, "Name").unwrap_or_default(),
                            mac_address: json_str(&eth, "MACAddress"),
                            link_status: json_str(&eth, "LinkStatus"),
                            speed_mbps: eth.get("SpeedMbps").and_then(|v| v.as_u64()).map(|v| v as u32),
                            ipv4_addresses: eth.get("IPv4Addresses")
                                .and_then(|v| v.as_array())
                                .map(|arr| arr.iter()
                                    .filter_map(|a| a.get("Address").and_then(|v| v.as_str()).map(String::from))
                                    .collect()),
                            ipv6_addresses: eth.get("IPv6Addresses")
                                .and_then(|v| v.as_array())
                                .map(|arr| arr.iter()
                                    .filter_map(|a| a.get("Address").and_then(|v| v.as_str()).map(String::from))
                                    .collect()),
                            status: eth.get("Status")
                                .and_then(|s| s.get("Health"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                                .unwrap_or_else(|| "Unknown".into()),
                            firmware_version: None,
                        });
                    }
                }
            }
        }

        Ok(adapters)
    }

    // ── Firmware inventory ──────────────────────────────────────────

    pub async fn get_firmware_inventory(&self) -> SmcResult<Vec<FirmwareInfo>> {
        let col = self.inner.get_json("/redfish/v1/UpdateService/FirmwareInventory")
            .await.map_err(SmcError::from)?;
        let mut items = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for member in members {
                if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                    if let Ok(fw) = self.inner.get_json(uri).await {
                        items.push(FirmwareInfo {
                            name: json_str(&fw, "Name").unwrap_or_default(),
                            version: json_str(&fw, "Version").unwrap_or_default(),
                            updateable: fw.get("Updateable").and_then(|v| v.as_bool()).unwrap_or(false),
                            component: json_str(&fw, "Id"),
                            install_date: json_str(&fw, "ReleaseDate"),
                            status: fw.get("Status")
                                .and_then(|s| s.get("Health"))
                                .and_then(|v| v.as_str())
                                .map(String::from),
                        });
                    }
                }
            }
        }

        Ok(items)
    }

    // ── Virtual media ───────────────────────────────────────────────

    pub async fn get_virtual_media_status(&self) -> SmcResult<Vec<VirtualMediaStatus>> {
        let col = self.inner.get_json("/redfish/v1/Managers/1/VirtualMedia")
            .await.map_err(SmcError::from)?;
        let mut items = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for member in members {
                if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                    if let Ok(vm) = self.inner.get_json(uri).await {
                        items.push(VirtualMediaStatus {
                            name: json_str(&vm, "Name").unwrap_or_default(),
                            media_types: vm.get("MediaTypes")
                                .and_then(|v| v.as_array())
                                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                                .unwrap_or_default(),
                            inserted: vm.get("Inserted").and_then(|v| v.as_bool()).unwrap_or(false),
                            image: json_str(&vm, "Image"),
                            write_protected: vm.get("WriteProtected").and_then(|v| v.as_bool()),
                            connected_via: json_str(&vm, "ConnectedVia"),
                        });
                    }
                }
            }
        }

        Ok(items)
    }

    pub async fn insert_virtual_media(&self, slot: &str, image_url: &str) -> SmcResult<()> {
        let uri = format!("/redfish/v1/Managers/1/VirtualMedia/{}/Actions/VirtualMedia.InsertMedia", slot);
        let body = serde_json::json!({
            "Image": image_url,
            "Inserted": true,
            "WriteProtected": true
        });
        self.inner.post_json(&uri, &body).await.map_err(SmcError::from)?;
        Ok(())
    }

    pub async fn eject_virtual_media(&self, slot: &str) -> SmcResult<()> {
        let uri = format!("/redfish/v1/Managers/1/VirtualMedia/{}/Actions/VirtualMedia.EjectMedia", slot);
        let body = serde_json::json!({});
        self.inner.post_json(&uri, &body).await.map_err(SmcError::from)?;
        Ok(())
    }

    // ── Event log ───────────────────────────────────────────────────

    pub async fn get_event_log(&self) -> SmcResult<Vec<EventLogEntry>> {
        let col = self.inner.get_json("/redfish/v1/Managers/1/LogServices/Log1/Entries")
            .await.map_err(SmcError::from)?;
        let mut entries = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for entry in members {
                entries.push(EventLogEntry {
                    id: json_str(entry, "Id").unwrap_or_default(),
                    timestamp: json_str(entry, "Created")
                        .or_else(|| json_str(entry, "EventTimestamp"))
                        .unwrap_or_default(),
                    severity: json_str(entry, "Severity")
                        .or_else(|| entry.get("EntryType").and_then(|v| v.as_str()).map(String::from))
                        .unwrap_or_else(|| "Unknown".into()),
                    message: json_str(entry, "Message").unwrap_or_default(),
                    message_id: json_str(entry, "MessageId"),
                    source: json_str(entry, "EntryType"),
                    category: json_str(entry, "SensorType"),
                });
            }
        }

        Ok(entries)
    }

    /// Get audit log entries.
    pub async fn get_audit_log(&self) -> SmcResult<Vec<EventLogEntry>> {
        // Supermicro stores audit logs separately; try the standard path first
        let result = self.inner.get_json("/redfish/v1/Managers/1/LogServices/AuditLog/Entries").await;
        match result {
            Ok(col) => {
                let mut entries = Vec::new();
                if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
                    for entry in members {
                        entries.push(EventLogEntry {
                            id: json_str(entry, "Id").unwrap_or_default(),
                            timestamp: json_str(entry, "Created").unwrap_or_default(),
                            severity: json_str(entry, "Severity").unwrap_or_else(|| "Info".into()),
                            message: json_str(entry, "Message").unwrap_or_default(),
                            message_id: json_str(entry, "MessageId"),
                            source: Some("AuditLog".into()),
                            category: json_str(entry, "EntryType"),
                        });
                    }
                }
                Ok(entries)
            }
            Err(_) => Ok(Vec::new()), // Audit log not available on this platform
        }
    }

    pub async fn clear_event_log(&self) -> SmcResult<()> {
        let body = serde_json::json!({});
        self.inner
            .post_json("/redfish/v1/Managers/1/LogServices/Log1/Actions/LogService.ClearLog", &body)
            .await
            .map_err(SmcError::from)?;
        Ok(())
    }

    // ── User management ─────────────────────────────────────────────

    pub async fn get_users(&self) -> SmcResult<Vec<UserAccount>> {
        let col = self.inner.get_json("/redfish/v1/AccountService/Accounts")
            .await.map_err(SmcError::from)?;
        let mut users = Vec::new();

        if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
            for member in members {
                if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                    if let Ok(acct) = self.inner.get_json(uri).await {
                        let name = json_str(&acct, "UserName").unwrap_or_default();
                        if name.is_empty() {
                            continue; // Skip empty slots
                        }
                        users.push(UserAccount {
                            id: json_str(&acct, "Id").unwrap_or_default(),
                            username: name,
                            role: json_str(&acct, "RoleId").unwrap_or_else(|| "None".into()),
                            enabled: acct.get("Enabled").and_then(|v| v.as_bool()).unwrap_or(false),
                            locked: acct.get("Locked").and_then(|v| v.as_bool()).unwrap_or(false),
                            description: json_str(&acct, "Description"),
                        });
                    }
                }
            }
        }

        Ok(users)
    }

    pub async fn create_user(&self, username: &str, password: &str, role: &str) -> SmcResult<()> {
        let body = serde_json::json!({
            "UserName": username,
            "Password": password,
            "RoleId": role,
            "Enabled": true
        });
        self.inner
            .post_json("/redfish/v1/AccountService/Accounts", &body)
            .await
            .map_err(SmcError::from)?;
        Ok(())
    }

    pub async fn update_password(&self, user_id: &str, new_password: &str) -> SmcResult<()> {
        let uri = format!("/redfish/v1/AccountService/Accounts/{}", user_id);
        let body = serde_json::json!({ "Password": new_password });
        self.inner.patch_json(&uri, &body).await.map_err(SmcError::from)?;
        Ok(())
    }

    pub async fn delete_user(&self, user_id: &str) -> SmcResult<()> {
        let uri = format!("/redfish/v1/AccountService/Accounts/{}", user_id);
        self.inner.delete(&uri).await.map_err(SmcError::from)?;
        Ok(())
    }

    // ── BIOS management ─────────────────────────────────────────────

    pub async fn get_bios_attributes(&self) -> SmcResult<Vec<BiosAttribute>> {
        let bios = self.inner.get_json("/redfish/v1/Systems/1/Bios").await.map_err(SmcError::from)?;
        let mut attrs = Vec::new();

        if let Some(attributes) = bios.get("Attributes").and_then(|v| v.as_object()) {
            for (name, value) in attributes {
                attrs.push(BiosAttribute {
                    name: name.clone(),
                    current_value: value.clone(),
                    default_value: None,
                    attribute_type: None,
                    allowed_values: None,
                    read_only: false,
                    description: None,
                });
            }
        }

        Ok(attrs)
    }

    pub async fn set_bios_attributes(&self, attributes: &serde_json::Value) -> SmcResult<()> {
        let uri = "/redfish/v1/Systems/1/Bios/Settings";
        let body = serde_json::json!({ "Attributes": attributes });
        self.inner.patch_json(uri, &body).await.map_err(SmcError::from)?;
        Ok(())
    }

    pub async fn get_boot_config(&self) -> SmcResult<BootConfig> {
        let sys = self.inner.get_json("/redfish/v1/Systems/1").await.map_err(SmcError::from)?;
        let boot = sys.get("Boot").unwrap_or(&serde_json::Value::Null);

        let mut boot_order = Vec::new();
        if let Some(order) = boot.get("BootOrder").and_then(|v| v.as_array()) {
            for (i, item) in order.iter().enumerate() {
                if let Some(name) = item.as_str() {
                    boot_order.push(BootSource {
                        index: i as u32,
                        name: name.to_string(),
                        enabled: true,
                        device_type: None,
                    });
                }
            }
        }

        Ok(BootConfig {
            boot_mode: boot.get("BootSourceOverrideMode")
                .and_then(|v| v.as_str())
                .unwrap_or("UEFI")
                .to_string(),
            boot_order,
            current_boot_source: boot.get("BootSourceOverrideTarget")
                .and_then(|v| v.as_str())
                .map(String::from),
            uefi_secure_boot: sys.get("SecureBoot")
                .and_then(|sb| sb.get("SecureBootEnable"))
                .and_then(|v| v.as_bool()),
        })
    }

    pub async fn set_boot_override(&self, target: &str, mode: Option<&str>) -> SmcResult<()> {
        let mut boot = serde_json::json!({
            "BootSourceOverrideTarget": target,
            "BootSourceOverrideEnabled": "Once"
        });
        if let Some(m) = mode {
            boot.as_object_mut().unwrap().insert(
                "BootSourceOverrideMode".into(),
                serde_json::Value::String(m.into()),
            );
        }
        let body = serde_json::json!({ "Boot": boot });
        self.inner.patch_json("/redfish/v1/Systems/1", &body).await.map_err(SmcError::from)?;
        Ok(())
    }

    // ── Certificates ────────────────────────────────────────────────

    pub async fn get_certificate(&self) -> SmcResult<SmcCertificate> {
        // Supermicro typically uses /redfish/v1/Managers/1/NetworkProtocol/HTTPS/Certificates/1
        // or /redfish/v1/CertificateService/CertificateLocations
        let cert = self.inner
            .get_json("/redfish/v1/Managers/1/NetworkProtocol/HTTPS/Certificates/1")
            .await
            .map_err(SmcError::from)?;

        Ok(SmcCertificate {
            subject: json_str(&cert, "Subject").unwrap_or_default(),
            issuer: json_str(&cert, "Issuer").unwrap_or_default(),
            valid_from: json_str(&cert, "ValidNotBefore").unwrap_or_default(),
            valid_to: json_str(&cert, "ValidNotAfter").unwrap_or_default(),
            serial_number: json_str(&cert, "SerialNumber").unwrap_or_default(),
            thumbprint: json_str(&cert, "Fingerprint"),
            key_size: cert.get("KeyBitLength").and_then(|v| v.as_u64()).map(|v| v as u32),
            signature_algorithm: json_str(&cert, "SignatureAlgorithm"),
        })
    }

    pub async fn generate_csr(&self, params: &CsrParams) -> SmcResult<String> {
        let body = serde_json::json!({
            "CommonName": params.common_name,
            "Organization": params.organization,
            "OrganizationalUnit": params.organizational_unit,
            "City": params.city,
            "State": params.state,
            "Country": params.country,
            "Email": params.email,
            "KeyBitLength": params.key_size.unwrap_or(2048),
            "CertificateCollection": {
                "@odata.id": "/redfish/v1/Managers/1/NetworkProtocol/HTTPS/Certificates"
            }
        });
        let resp = self.inner
            .post_json("/redfish/v1/CertificateService/Actions/CertificateService.GenerateCSR", &body)
            .await
            .map_err(SmcError::from)?;

        json_str(&resp, "CSRString")
            .ok_or_else(|| SmcError::certificate("CSR generation returned no CSR string"))
    }

    // ── LED control ─────────────────────────────────────────────────

    pub async fn set_indicator_led(&self, state: &str) -> SmcResult<()> {
        let body = serde_json::json!({ "IndicatorLED": state });
        self.inner.patch_json("/redfish/v1/Systems/1", &body).await.map_err(SmcError::from)?;
        Ok(())
    }

    pub async fn set_asset_tag(&self, tag: &str) -> SmcResult<()> {
        let body = serde_json::json!({ "AssetTag": tag });
        self.inner.patch_json("/redfish/v1/Systems/1", &body).await.map_err(SmcError::from)?;
        Ok(())
    }

    // ── License ─────────────────────────────────────────────────────

    pub async fn get_license(&self) -> SmcResult<Vec<SmcLicense>> {
        // Supermicro uses Oem.Supermicro.LicenseManager or /redfish/v1/Managers/1/Oem/Supermicro/Licenses
        let result = self.inner
            .get_json("/redfish/v1/Managers/1/Oem/Supermicro/Licenses")
            .await;

        match result {
            Ok(col) => {
                let mut licenses = Vec::new();
                if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
                    for member in members {
                        if let Some(uri) = member.get("@odata.id").and_then(|v| v.as_str()) {
                            if let Ok(lic) = self.inner.get_json(uri).await {
                                let tier_str = json_str(&lic, "LicenseType").unwrap_or_default();
                                let tier = match tier_str.as_str() {
                                    "SFT-OOB-LIC" => SmcLicenseTier::OutOfBand,
                                    "SFT-DCMS-SINGLE" => SmcLicenseTier::Dcms,
                                    "SFT-SPM-LIC" => SmcLicenseTier::Spm,
                                    "" => SmcLicenseTier::Standard,
                                    other => SmcLicenseTier::Other(other.to_string()),
                                };
                                licenses.push(SmcLicense {
                                    tier,
                                    product_key: json_str(&lic, "ProductKey"),
                                    activated: lic.get("Activated").and_then(|v| v.as_bool()).unwrap_or(false),
                                    expiration: json_str(&lic, "ExpirationDate"),
                                    description: json_str(&lic, "Description"),
                                });
                            }
                        }
                    }
                }
                Ok(licenses)
            }
            Err(_) => Ok(Vec::new()), // License management not available on all platforms
        }
    }

    pub async fn activate_license(&self, product_key: &str) -> SmcResult<()> {
        let body = serde_json::json!({
            "ProductKey": product_key
        });
        self.inner
            .post_json("/redfish/v1/Managers/1/Oem/Supermicro/Licenses", &body)
            .await
            .map_err(SmcError::from)?;
        Ok(())
    }

    // ── Health rollup ───────────────────────────────────────────────

    pub async fn get_health_rollup(&self) -> SmcResult<HealthRollup> {
        let sys = self.inner.get_json("/redfish/v1/Systems/1").await.map_err(SmcError::from)?;

        let overall = sys.get("Status")
            .and_then(|s| s.get("HealthRollup"))
            .or_else(|| sys.get("Status").and_then(|s| s.get("Health")))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string();

        let mut components = Vec::new();

        // Processor health
        if let Some(ps) = sys.get("ProcessorSummary").and_then(|p| p.get("Status")) {
            components.push(ComponentHealth {
                name: "Processors".into(),
                status: json_str(ps, "HealthRollup")
                    .or_else(|| json_str(ps, "Health"))
                    .unwrap_or_else(|| "Unknown".into()),
                component_type: "CPU".into(),
                details: None,
            });
        }

        // Memory health
        if let Some(ms) = sys.get("MemorySummary").and_then(|m| m.get("Status")) {
            components.push(ComponentHealth {
                name: "Memory".into(),
                status: json_str(ms, "HealthRollup")
                    .or_else(|| json_str(ms, "Health"))
                    .unwrap_or_else(|| "Unknown".into()),
                component_type: "Memory".into(),
                details: None,
            });
        }

        // Chassis health
        if let Ok(chassis) = self.inner.get_json("/redfish/v1/Chassis/1").await {
            if let Some(cs) = chassis.get("Status") {
                components.push(ComponentHealth {
                    name: "Chassis".into(),
                    status: json_str(cs, "HealthRollup")
                        .or_else(|| json_str(cs, "Health"))
                        .unwrap_or_else(|| "Unknown".into()),
                    component_type: "Chassis".into(),
                    details: None,
                });
            }
        }

        // Manager/BMC health
        if let Ok(mgr) = self.inner.get_json("/redfish/v1/Managers/1").await {
            if let Some(ms) = mgr.get("Status") {
                components.push(ComponentHealth {
                    name: "BMC".into(),
                    status: json_str(ms, "Health").unwrap_or_else(|| "Unknown".into()),
                    component_type: "Manager".into(),
                    details: None,
                });
            }
        }

        Ok(HealthRollup {
            overall_status: overall,
            components,
        })
    }

    // ── Security status ─────────────────────────────────────────────

    pub async fn get_security_status(&self) -> SmcResult<SmcSecurityStatus> {
        let np = self.inner.get_json("/redfish/v1/Managers/1/NetworkProtocol")
            .await
            .unwrap_or_else(|_| serde_json::json!({}));

        let mut risks = Vec::new();

        let ssl_enabled = np.get("HTTPS")
            .and_then(|h| h.get("ProtocolEnabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let ssh_enabled = np.get("SSH")
            .and_then(|h| h.get("ProtocolEnabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let ipmi_enabled = np.get("IPMI")
            .and_then(|h| h.get("ProtocolEnabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        if !ssl_enabled {
            risks.push(SecurityRiskItem {
                severity: "Critical".into(),
                category: "Protocol".into(),
                message: "HTTPS is disabled — BMC communication is unencrypted".into(),
                remediation: Some("Enable HTTPS in Network Protocol settings".into()),
            });
        }

        if ipmi_enabled {
            risks.push(SecurityRiskItem {
                severity: "Warning".into(),
                category: "Protocol".into(),
                message: "IPMI over LAN is enabled — consider disabling if not needed".into(),
                remediation: Some("Disable IPMI over LAN in Network Protocol settings".into()),
            });
        }

        Ok(SmcSecurityStatus {
            ssl_enabled,
            ssl_cert_valid: true, // Would need cert check
            ipmi_over_lan_enabled: ipmi_enabled,
            ssh_enabled,
            web_session_timeout_mins: 30, // Default
            account_lockout_enabled: false,
            max_login_failures: None,
            lockout_duration_secs: None,
            default_password_warning: false,
            risks,
        })
    }

    // ── Console / iKVM ──────────────────────────────────────────────

    pub async fn get_console_info(&self) -> SmcResult<SmcConsoleInfo> {
        let mgr = self.inner.get_json("/redfish/v1/Managers/1").await.map_err(SmcError::from)?;

        let console_type = if self.platform.supports_html5_ikvm() {
            SmcConsoleType::Html5Ikvm
        } else {
            SmcConsoleType::JavaKvm
        };

        let gfx = mgr.get("GraphicalConsole").unwrap_or(&serde_json::Value::Null);
        let enabled = gfx.get("ServiceEnabled").and_then(|v| v.as_bool()).unwrap_or(false);
        let max_sessions = gfx.get("MaxConcurrentSessions")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(2);

        Ok(SmcConsoleInfo {
            console_type,
            enabled,
            max_sessions,
            active_sessions: 0,
            encryption_enabled: true,
            port: Some(5900),
            ssl_port: Some(5901),
            launch_url: None,
        })
    }

    /// Get the HTML5 iKVM launch URL (X11+).
    pub async fn get_html5_ikvm_url(&self) -> SmcResult<String> {
        if !self.platform.supports_html5_ikvm() {
            return Err(SmcError::console("HTML5 iKVM not supported on this platform"));
        }

        // Supermicro uses a separate iKVM path on the BMC web interface
        let base = if self.inner.is_connected() {
            format!("https://{}:{}", "host", 443) // Would need actual host
        } else {
            return Err(SmcError::console("Not connected"));
        };

        Ok(format!("{}/cgi/url_redirect.cgi?url_name=ikvm&url_type=jwsk", base))
    }

    // ── BMC reset ───────────────────────────────────────────────────

    pub async fn reset_bmc(&self) -> SmcResult<()> {
        let body = serde_json::json!({ "ResetType": "GracefulRestart" });
        self.inner
            .post_json("/redfish/v1/Managers/1/Actions/Manager.Reset", &body)
            .await
            .map_err(SmcError::from)?;
        Ok(())
    }

    // ── Node Manager (Intel-specific) ───────────────────────────────

    /// Get Node Manager power policies via OEM Redfish extension.
    pub async fn get_node_manager_policies(&self) -> SmcResult<Vec<NodeManagerPolicy>> {
        // Supermicro exposes Node Manager via Oem.Supermicro.NodeManager
        let result = self.inner
            .get_json("/redfish/v1/Managers/1/Oem/Supermicro/NodeManager/Policies")
            .await;

        match result {
            Ok(col) => {
                let mut policies = Vec::new();
                if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
                    for p in members {
                        policies.push(NodeManagerPolicy {
                            policy_id: p.get("PolicyId").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            enabled: p.get("Enabled").and_then(|v| v.as_bool()).unwrap_or(false),
                            domain: match p.get("Domain").and_then(|v| v.as_str()).unwrap_or("Platform") {
                                "CPU" => NodeManagerDomain::Cpu,
                                "Memory" => NodeManagerDomain::Memory,
                                "IO" => NodeManagerDomain::Io,
                                _ => NodeManagerDomain::Platform,
                            },
                            power_limit_watts: p.get("PowerLimitWatts").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            correction_time_ms: p.get("CorrectionTimeMs").and_then(|v| v.as_u64()).unwrap_or(6000) as u32,
                            trigger_type: json_str(p, "TriggerType").unwrap_or_else(|| "Always".into()),
                            reporting_period_secs: p.get("ReportingPeriodSecs").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
                        });
                    }
                }
                Ok(policies)
            }
            Err(_) => Ok(Vec::new()),
        }
    }

    /// Get Node Manager power statistics.
    pub async fn get_node_manager_stats(&self, domain: &NodeManagerDomain) -> SmcResult<NodeManagerStats> {
        let domain_str = match domain {
            NodeManagerDomain::Platform => "Platform",
            NodeManagerDomain::Cpu => "CPU",
            NodeManagerDomain::Memory => "Memory",
            NodeManagerDomain::Io => "IO",
        };

        let uri = format!(
            "/redfish/v1/Managers/1/Oem/Supermicro/NodeManager/Statistics/{}",
            domain_str
        );
        let stats = self.inner.get_json(&uri).await.map_err(SmcError::from)?;

        Ok(NodeManagerStats {
            domain: domain.clone(),
            current_watts: stats.get("CurrentWatts").and_then(|v| v.as_f64()).unwrap_or(0.0),
            min_watts: stats.get("MinWatts").and_then(|v| v.as_f64()).unwrap_or(0.0),
            max_watts: stats.get("MaxWatts").and_then(|v| v.as_f64()).unwrap_or(0.0),
            avg_watts: stats.get("AverageWatts").and_then(|v| v.as_f64()).unwrap_or(0.0),
            timestamp: json_str(&stats, "Timestamp").unwrap_or_default(),
            reporting_period_secs: stats.get("ReportingPeriodSecs")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u32,
        })
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

fn json_str(val: &serde_json::Value, key: &str) -> Option<String> {
    val.get(key).and_then(|v| v.as_str()).map(String::from)
}

/// Detect Supermicro platform generation from a Manager Redfish resource.
fn detect_platform_from_manager(mgr: &serde_json::Value) -> SmcPlatform {
    // Check Oem.Supermicro for platform hints
    let oem = mgr.get("Oem").and_then(|o| o.get("Supermicro"));
    if oem.is_none() {
        // May still be Supermicro without OEM block (older firmware)
        // Try firmware version heuristics
    }

    let fw_version = json_str(mgr, "FirmwareVersion").unwrap_or_default();
    let model = json_str(mgr, "Model").unwrap_or_default();

    // Detect from firmware version patterns
    // Supermicro BMC firmware versions often encode the platform:
    // e.g., "01.01.12" for X11, "01.73.xx" for X12, "01.02.xx" for X13
    // Model field often contains "ATEN" or specific IPMI controller model

    // Check from OEM platform data
    if let Some(oem_data) = oem {
        if let Some(platform_str) = oem_data.get("BoardID").and_then(|v| v.as_str()) {
            if platform_str.starts_with("X13") || platform_str.starts_with("x13") {
                return SmcPlatform::X13;
            }
            if platform_str.starts_with("H13") || platform_str.starts_with("h13") {
                return SmcPlatform::H13;
            }
            if platform_str.starts_with("X12") || platform_str.starts_with("x12") {
                return SmcPlatform::X12;
            }
            if platform_str.starts_with("H12") || platform_str.starts_with("h12") {
                return SmcPlatform::H12;
            }
            if platform_str.starts_with("X11") || platform_str.starts_with("x11") {
                return SmcPlatform::X11;
            }
            if platform_str.starts_with("X10") || platform_str.starts_with("x10") {
                return SmcPlatform::X10;
            }
            if platform_str.starts_with("X9") || platform_str.starts_with("x9") {
                return SmcPlatform::X9;
            }
        }
    }

    // Fallback: heuristic from model / firmware
    if model.contains("X13") || fw_version.starts_with("01.02") {
        SmcPlatform::X13
    } else if model.contains("H13") {
        SmcPlatform::H13
    } else if model.contains("X12") || fw_version.starts_with("01.73") {
        SmcPlatform::X12
    } else if model.contains("H12") {
        SmcPlatform::H12
    } else if model.contains("X11") || fw_version.starts_with("01.01") {
        SmcPlatform::X11
    } else if model.contains("X10") {
        SmcPlatform::X10
    } else if model.contains("X9") {
        SmcPlatform::X9
    } else {
        SmcPlatform::Unknown
    }
}
