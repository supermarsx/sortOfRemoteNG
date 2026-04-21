//! Virtual media management for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct VirtualMediaManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> VirtualMediaManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_status(&self) -> LenovoResult<Vec<BmcVirtualMedia>> {
        let rf = self.client.require_redfish()?;
        rf.get_virtual_media_status().await
    }

    pub async fn insert_media(&self, slot: &str, image_url: &str) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        rf.insert_virtual_media(slot, image_url).await
    }

    pub async fn eject_media(&self, slot: &str) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        rf.eject_virtual_media(slot).await
    }
}
