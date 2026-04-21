//! Hardware inventory — processors, memory DIMMs.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Hardware inventory operations.
pub struct HardwareManager<'a> {
    client: &'a IloClient,
}

impl<'a> HardwareManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get processor inventory.
    pub async fn get_processors(&self) -> IloResult<Vec<BmcProcessor>> {
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf.get_system().await?;
            let procs_link = sys
                .pointer("/Processors/@odata.id")
                .and_then(|v| v.as_str())
                .unwrap_or("/redfish/v1/Systems/1/Processors");

            let collection: Vec<serde_json::Value> =
                rf.inner.get_collection_expanded(procs_link).await?;
            let mut processors = Vec::new();

            for member in &collection {
                processors.push(BmcProcessor {
                    id: member
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    socket: member
                        .get("Socket")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    manufacturer: member
                        .get("Manufacturer")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    model: member
                        .get("Model")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown")
                        .to_string(),
                    max_speed_mhz: member
                        .get("MaxSpeedMHz")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32),
                    total_cores: member
                        .get("TotalCores")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32,
                    total_threads: member
                        .get("TotalThreads")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32,
                    status: component_health(
                        member
                            .get("Status")
                            .and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown"),
                    ),
                });
            }
            return Ok(processors);
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let health = ribcl.get_embedded_health().await?;
            let mut processors = Vec::new();

            if let Some(proc_arr) = health.get("PROCESSOR").and_then(|v| v.as_array()) {
                for (i, p) in proc_arr.iter().enumerate() {
                    let name = p.get("LABEL").and_then(|v| v.as_str()).unwrap_or("Unknown");
                    let speed = p
                        .get("SPEED")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.replace("MHz", "").trim().parse::<u32>().ok());
                    let cores = p
                        .get("CORES")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<u32>().ok());
                    let threads = p
                        .get("THREADS")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<u32>().ok());

                    processors.push(BmcProcessor {
                        id: format!("{}", i + 1),
                        socket: format!("CPU {}", i + 1),
                        manufacturer: "".to_string(),
                        model: name.to_string(),
                        max_speed_mhz: speed,
                        total_cores: cores.unwrap_or(0),
                        total_threads: threads.unwrap_or(0),
                        status: component_health(
                            p.get("STATUS")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Unknown"),
                        ),
                    });
                }
            }
            return Ok(processors);
        }

        Err(IloError::unsupported(
            "No protocol available for processor info",
        ))
    }

    /// Get memory DIMM inventory.
    pub async fn get_memory(&self) -> IloResult<Vec<BmcMemoryDimm>> {
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf.get_system().await?;
            let mem_link = sys
                .pointer("/Memory/@odata.id")
                .and_then(|v| v.as_str())
                .unwrap_or("/redfish/v1/Systems/1/Memory");

            let collection: Vec<serde_json::Value> =
                rf.inner.get_collection_expanded(mem_link).await?;
            let mut dimms = Vec::new();

            for member in &collection {
                if member
                    .get("Status")
                    .and_then(|s| s.get("State"))
                    .and_then(|v| v.as_str())
                    == Some("Absent")
                {
                    continue;
                }
                dimms.push(BmcMemoryDimm {
                    id: member
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: member
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("DIMM")
                        .to_string(),
                    manufacturer: member
                        .get("Manufacturer")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    capacity_mib: member
                        .get("CapacityMiB")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                    speed_mhz: member
                        .get("OperatingSpeedMhz")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32),
                    memory_type: member
                        .get("MemoryDeviceType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    device_locator: member
                        .get("DeviceLocator")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    status: component_health(
                        member
                            .get("Status")
                            .and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown"),
                    ),
                });
            }
            return Ok(dimms);
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let health = ribcl.get_embedded_health().await?;
            let mut dimms = Vec::new();

            if let Some(mem_arr) = health.get("MEMORY").and_then(|v| v.as_array()) {
                for (i, m) in mem_arr.iter().enumerate() {
                    let size = m.get("SIZE").and_then(|v| v.as_str()).and_then(|s| {
                        let s = s.replace("MB", "").replace("GB", "").trim().to_string();
                        s.parse::<u32>().ok()
                    });
                    let status = m
                        .get("STATUS")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown");
                    if status == "Not Present" || status == "N/A" {
                        continue;
                    }

                    dimms.push(BmcMemoryDimm {
                        id: format!("{}", i + 1),
                        name: m
                            .get("LABEL")
                            .and_then(|v| v.as_str())
                            .unwrap_or("DIMM")
                            .to_string(),
                        manufacturer: "".to_string(),
                        capacity_mib: size.map(|s| s as u64).unwrap_or(0),
                        speed_mhz: m
                            .get("SPEED")
                            .and_then(|v| v.as_str())
                            .and_then(|s| s.replace("MHz", "").trim().parse::<u32>().ok()),
                        memory_type: m
                            .get("TYPE")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        device_locator: m
                            .get("LABEL")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        status: component_health(status),
                    });
                }
            }
            return Ok(dimms);
        }

        Err(IloError::unsupported(
            "No protocol available for memory info",
        ))
    }
}
