//! System information management for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct SystemManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> SystemManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_system_info(&self) -> LenovoResult<BmcSystemInfo> {
        if let Ok(rf) = self.client.require_redfish() {
            return rf.get_system_info().await;
        }
        if let Ok(lr) = self.client.require_legacy_rest() {
            return lr.get_system_info().await;
        }
        Err(crate::error::LenovoError::unsupported(
            "System info requires Redfish or Legacy REST",
        ))
    }

    pub async fn get_xcc_info(&self) -> LenovoResult<XccInfo> {
        if let Ok(rf) = self.client.require_redfish() {
            return rf.get_xcc_info().await;
        }
        if let Ok(lr) = self.client.require_legacy_rest() {
            return lr.get_controller_info().await;
        }
        Err(crate::error::LenovoError::unsupported(
            "Controller info requires Redfish or Legacy REST",
        ))
    }

    pub async fn set_asset_tag(&self, tag: &str) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        rf.set_asset_tag(tag).await
    }

    pub async fn set_indicator_led(&self, state: &str) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        rf.set_indicator_led(state).await
    }
}
