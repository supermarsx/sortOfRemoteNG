//! Hardware inventory — CPUs, memory DIMMs, PCIe devices.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;
use crate::wsman::dcim_classes;

/// Hardware inventory manager.
pub struct HardwareManager<'a> {
    client: &'a IdracClient,
}

impl<'a> HardwareManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// List processors.
    pub async fn list_processors(&self) -> IdracResult<Vec<Processor>> {
        if let Ok(rf) = self.client.require_redfish() {
            let col: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1/Processors?$expand=*($levels=1)")
                .await?;

            let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            return Ok(members
                .iter()
                .map(|p| Processor {
                    id: p.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    name: p.get("Name").and_then(|v| v.as_str()).unwrap_or("CPU").to_string(),
                    manufacturer: p.get("Manufacturer").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    model: p.get("Model").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    max_speed_mhz: p.get("MaxSpeedMHz").and_then(|v| v.as_u64()).map(|n| n as u32),
                    total_cores: p.get("TotalCores").and_then(|v| v.as_u64()).map(|n| n as u32),
                    total_threads: p.get("TotalThreads").and_then(|v| v.as_u64()).map(|n| n as u32),
                    socket: p.get("Socket").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    instruction_set: p.get("InstructionSet").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    processor_type: p.get("ProcessorType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    processor_architecture: p.get("ProcessorArchitecture").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    status: ComponentHealth {
                        health: p.pointer("/Status/Health").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        health_rollup: p.pointer("/Status/HealthRollup").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        state: p.pointer("/Status/State").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    },
                    microcode: p.get("ProcessorId").and_then(|pi| pi.get("MicrocodeInfo")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    current_speed_mhz: p.get("OperatingSpeedMHz").and_then(|v| v.as_u64()),
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::CPU_VIEW).await?;
            return Ok(views
                .iter()
                .map(|v| {
                    let get = |k: &str| v.properties.get(k).and_then(|val| val.as_str()).map(|s| s.to_string());
                    let get_u32 = |k: &str| v.properties.get(k).and_then(|val| val.as_u64()).map(|n| n as u32);
                    Processor {
                        id: get("FQDD").unwrap_or_default(),
                        name: get("DeviceDescription").unwrap_or_else(|| "CPU".to_string()),
                        manufacturer: get("Manufacturer"),
                        model: get("Model"),
                        max_speed_mhz: get_u32("MaxClockSpeed"),
                        total_cores: get_u32("NumberOfProcessorCores"),
                        total_threads: get_u32("NumberOfEnabledThreads"),
                        socket: get("FQDD"),
                        instruction_set: None,
                        processor_type: get("CPUFamily"),
                        processor_architecture: None,
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: None,
                            state: None,
                        },
                        microcode: get("Microcode"),
                        current_speed_mhz: v.properties.get("CurrentClockSpeed").and_then(|val| val.as_u64()),
                    }
                })
                .collect());
        }

        Err(IdracError::unsupported("Processor listing requires Redfish or WSMAN"))
    }

    /// List memory DIMMs.
    pub async fn list_memory(&self) -> IdracResult<Vec<MemoryDimm>> {
        if let Ok(rf) = self.client.require_redfish() {
            let col: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1/Memory?$expand=*($levels=1)")
                .await?;

            let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            return Ok(members
                .iter()
                .filter(|m| {
                    m.pointer("/Status/State")
                        .and_then(|v| v.as_str())
                        .map(|s| s != "Absent")
                        .unwrap_or(true)
                })
                .map(|m| MemoryDimm {
                    id: m.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    name: m.get("Name").and_then(|v| v.as_str()).unwrap_or("DIMM").to_string(),
                    manufacturer: m.get("Manufacturer").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    memory_type: m.get("MemoryDeviceType").or_else(|| m.get("MemoryType")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    capacity_mb: m.get("CapacityMiB").and_then(|v| v.as_u64()).map(|n| n as u32),
                    speed_mhz: m.get("OperatingSpeedMhz").or_else(|| m.get("AllowedSpeedsMHz").and_then(|v| v.as_array()).and_then(|a| a.first())).and_then(|v| v.as_u64()).map(|n| n as u32),
                    serial_number: m.get("SerialNumber").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    part_number: m.get("PartNumber").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    device_locator: m.get("DeviceLocator").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    bank_locator: m.get("BankLocator").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    rank_count: m.get("RankCount").and_then(|v| v.as_u64()).map(|n| n as u32),
                    data_width_bits: m.get("DataWidthBits").and_then(|v| v.as_u64()).map(|n| n as u32),
                    bus_width_bits: m.get("BusWidthBits").and_then(|v| v.as_u64()).map(|n| n as u32),
                    error_correction: m.get("ErrorCorrection").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    status: ComponentHealth {
                        health: m.pointer("/Status/Health").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        health_rollup: None,
                        state: m.pointer("/Status/State").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    },
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::MEMORY_VIEW).await?;
            return Ok(views
                .iter()
                .map(|v| {
                    let get = |k: &str| v.properties.get(k).and_then(|val| val.as_str()).map(|s| s.to_string());
                    let get_u32 = |k: &str| v.properties.get(k).and_then(|val| val.as_u64()).map(|n| n as u32);
                    MemoryDimm {
                        id: get("FQDD").unwrap_or_default(),
                        name: get("DeviceDescription").unwrap_or_else(|| "DIMM".to_string()),
                        manufacturer: get("Manufacturer"),
                        memory_type: get("MemoryType"),
                        capacity_mb: get_u32("Size"),
                        speed_mhz: get_u32("Speed"),
                        serial_number: get("SerialNumber"),
                        part_number: get("PartNumber"),
                        device_locator: get("BankLabel"),
                        bank_locator: get("BankLabel"),
                        rank_count: get_u32("Rank"),
                        data_width_bits: None,
                        bus_width_bits: None,
                        error_correction: None,
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: None,
                            state: None,
                        },
                    }
                })
                .collect());
        }

        Err(IdracError::unsupported("Memory listing requires Redfish or WSMAN"))
    }

    /// List PCIe devices.
    pub async fn list_pcie_devices(&self) -> IdracResult<Vec<PcieDevice>> {
        if let Ok(rf) = self.client.require_redfish() {
            // Try Systems PCIeDevices endpoint
            let url = "/redfish/v1/Systems/System.Embedded.1/PCIeDevices?$expand=*($levels=1)";
            let col: serde_json::Value = match rf.get(url).await {
                Ok(v) => v,
                Err(_) => {
                    // Fallback: try Chassis PCIeDevices
                    rf.get("/redfish/v1/Chassis/System.Embedded.1/PCIeDevices?$expand=*($levels=1)").await?
                }
            };

            let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            return Ok(members
                .iter()
                .map(|d| PcieDevice {
                    id: d.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    name: d.get("Name").and_then(|v| v.as_str()).unwrap_or("PCIe Device").to_string(),
                    manufacturer: d.get("Manufacturer").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    model: d.get("Model").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    device_type: d.get("DeviceType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    serial_number: d.get("SerialNumber").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    firmware_version: d.get("FirmwareVersion").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    pcie_generation: d.pointer("/PCIeInterface/PCIeType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    lane_width: d.pointer("/PCIeInterface/LanesInUse").and_then(|v| v.as_u64()).map(|n| n as u32),
                    slot: d.get("Slot").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    bus_number: None,
                    device_number: None,
                    function_number: None,
                    status: ComponentHealth {
                        health: d.pointer("/Status/Health").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        health_rollup: None,
                        state: d.pointer("/Status/State").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    },
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::PCIE_DEVICE_VIEW).await?;
            return Ok(views
                .iter()
                .map(|v| {
                    let get = |k: &str| v.properties.get(k).and_then(|val| val.as_str()).map(|s| s.to_string());
                    let get_u32 = |k: &str| v.properties.get(k).and_then(|val| val.as_u64()).map(|n| n as u32);
                    PcieDevice {
                        id: get("FQDD").unwrap_or_default(),
                        name: get("DeviceDescription").unwrap_or_else(|| "PCIe".to_string()),
                        manufacturer: get("Manufacturer"),
                        model: get("Description"),
                        device_type: get("DeviceType"),
                        serial_number: get("SerialNumber"),
                        firmware_version: get("FirmwareVersion"),
                        pcie_generation: get("PCIeGeneration"),
                        lane_width: get_u32("SlotLength"),
                        slot: get("SlotType"),
                        bus_number: get_u32("BusNumber"),
                        device_number: get_u32("DeviceNumber"),
                        function_number: get_u32("FunctionNumber"),
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: None,
                            state: None,
                        },
                    }
                })
                .collect());
        }

        Err(IdracError::unsupported("PCIe listing requires Redfish or WSMAN"))
    }

    /// Get total memory capacity in MB.
    pub async fn get_total_memory_mb(&self) -> IdracResult<u64> {
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1")
                .await?;
            return Ok(sys
                .get("MemorySummary")
                .and_then(|m| m.get("TotalSystemMemoryGiB"))
                .and_then(|v| v.as_f64())
                .map(|gb| (gb * 1024.0) as u64)
                .unwrap_or(0));
        }

        let dimms = self.list_memory().await?;
        Ok(dimms.iter().filter_map(|d| d.capacity_mb.map(|c| c as u64)).sum())
    }

    /// Get processor count.
    pub async fn get_processor_count(&self) -> IdracResult<u32> {
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1")
                .await?;
            return Ok(sys
                .get("ProcessorSummary")
                .and_then(|p| p.get("Count"))
                .and_then(|v| v.as_u64())
                .map(|n| n as u32)
                .unwrap_or(0));
        }

        let cpus = self.list_processors().await?;
        Ok(cpus.len() as u32)
    }
}
