//! BIOS/UEFI settings management for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct BiosManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> BiosManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_bios_attributes(&self) -> LenovoResult<Vec<BiosAttribute>> {
        let rf = self.client.require_redfish()?;
        rf.get_bios_attributes().await
    }

    pub async fn set_bios_attributes(&self, attrs: &serde_json::Value) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        rf.set_bios_attributes(attrs).await
    }

    pub async fn get_boot_config(&self) -> LenovoResult<BootConfig> {
        let rf = self.client.require_redfish()?;
        rf.get_boot_config().await
    }

    pub async fn set_boot_override(&self, target: &str, mode: Option<&str>) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        rf.set_boot_override(target, mode).await
    }
}
