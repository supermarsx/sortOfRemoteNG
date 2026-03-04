//! Hardware inventory for Lenovo servers (CPUs, memory).

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct HardwareManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> HardwareManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_processors(&self) -> LenovoResult<Vec<BmcProcessor>> {
        let rf = self.client.require_redfish()?;
        rf.get_processors().await
    }

    pub async fn get_memory(&self) -> LenovoResult<Vec<BmcMemoryDimm>> {
        let rf = self.client.require_redfish()?;
        rf.get_memory().await
    }
}
