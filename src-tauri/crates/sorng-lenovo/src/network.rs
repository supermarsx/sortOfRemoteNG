//! Network adapter management for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct NetworkManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> NetworkManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_network_adapters(&self) -> LenovoResult<Vec<BmcNetworkAdapter>> {
        let rf = self.client.require_redfish()?;
        rf.get_network_adapters().await
    }

    pub async fn get_xcc_network(&self) -> LenovoResult<serde_json::Value> {
        let rf = self.client.require_redfish()?;
        rf.get_xcc_network().await
    }
}
