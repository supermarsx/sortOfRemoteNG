//! Storage management for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct StorageManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> StorageManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_controllers(&self) -> LenovoResult<Vec<BmcStorageController>> {
        let rf = self.client.require_redfish()?;
        rf.get_storage_controllers().await
    }

    pub async fn get_virtual_disks(&self) -> LenovoResult<Vec<BmcVirtualDisk>> {
        let rf = self.client.require_redfish()?;
        rf.get_virtual_disks().await
    }

    pub async fn get_physical_disks(&self) -> LenovoResult<Vec<BmcPhysicalDisk>> {
        let rf = self.client.require_redfish()?;
        rf.get_physical_disks().await
    }
}
