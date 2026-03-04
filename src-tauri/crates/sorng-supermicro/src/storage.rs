//! Storage management for Supermicro BMCs (RAID, disks).

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct StorageManager;

impl StorageManager {
    /// Get RAID / storage controllers (Redfish only).
    pub async fn get_controllers(client: &SmcClient) -> SmcResult<Vec<StorageController>> {
        let rf = client.require_redfish()?;
        rf.get_storage_controllers().await
    }

    /// Get virtual disks / volumes (Redfish only).
    pub async fn get_virtual_disks(client: &SmcClient) -> SmcResult<Vec<VirtualDisk>> {
        let rf = client.require_redfish()?;
        rf.get_virtual_disks().await
    }

    /// Get physical drives (Redfish only).
    pub async fn get_physical_disks(client: &SmcClient) -> SmcResult<Vec<PhysicalDisk>> {
        let rf = client.require_redfish()?;
        rf.get_physical_disks().await
    }
}
