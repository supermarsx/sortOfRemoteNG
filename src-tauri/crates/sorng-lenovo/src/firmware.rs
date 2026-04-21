//! Firmware inventory for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct FirmwareManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> FirmwareManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_firmware_inventory(&self) -> LenovoResult<Vec<BmcFirmwareItem>> {
        let rf = self.client.require_redfish()?;
        rf.get_firmware_inventory().await
    }
}
