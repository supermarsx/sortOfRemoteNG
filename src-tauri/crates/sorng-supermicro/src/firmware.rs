//! Firmware inventory for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct FirmwareManager;

impl FirmwareManager {
    /// Get firmware inventory (Redfish only).
    pub async fn get_firmware_inventory(client: &SmcClient) -> SmcResult<Vec<FirmwareInfo>> {
        let rf = client.require_redfish()?;
        rf.get_firmware_inventory().await
    }
}
