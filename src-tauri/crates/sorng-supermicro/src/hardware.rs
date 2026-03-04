//! Hardware inventory for Supermicro BMCs (CPUs, memory, PCIe).

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct HardwareManager;

impl HardwareManager {
    /// Get processor inventory (Redfish only).
    pub async fn get_processors(client: &SmcClient) -> SmcResult<Vec<ProcessorInfo>> {
        let rf = client.require_redfish()?;
        rf.get_processors().await
    }

    /// Get memory DIMM inventory (Redfish only).
    pub async fn get_memory(client: &SmcClient) -> SmcResult<Vec<MemoryInfo>> {
        let rf = client.require_redfish()?;
        rf.get_memory().await
    }
}
