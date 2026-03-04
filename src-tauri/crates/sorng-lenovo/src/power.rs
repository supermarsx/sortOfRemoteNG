//! Power management for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::{LenovoError, LenovoResult};
use crate::types::*;

pub struct PowerManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> PowerManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_power_state(&self) -> LenovoResult<String> {
        if let Ok(rf) = self.client.require_redfish() {
            return rf.get_power_state().await;
        }
        if let Ok(ipmi) = self.client.require_ipmi() {
            let status = ipmi.get_chassis_status().await.map_err(LenovoError::from)?;
            return Ok(if status.power_on { "On" } else { "Off" }.to_string());
        }
        Err(LenovoError::unsupported("Power state requires Redfish or IPMI"))
    }

    pub async fn power_action(&self, action: &PowerAction) -> LenovoResult<()> {
        if let Ok(rf) = self.client.require_redfish() {
            return rf.power_action(action).await;
        }
        if let Ok(ipmi) = self.client.require_ipmi() {
            let cmd = action.to_ipmi();
            ipmi.chassis_control(cmd).await.map_err(LenovoError::from)?;
            return Ok(());
        }
        if let Ok(lr) = self.client.require_legacy_rest() {
            let action_str = match action {
                PowerAction::On => "on",
                PowerAction::ForceOff => "off",
                PowerAction::GracefulShutdown => "softoff",
                PowerAction::GracefulRestart => "restart",
                PowerAction::ForceRestart => "restart",
                _ => "restart",
            };
            return lr.power_action(action_str).await;
        }
        Err(LenovoError::unsupported("Power action requires Redfish, IPMI, or Legacy REST"))
    }

    pub async fn get_power_metrics(&self) -> LenovoResult<BmcPowerMetrics> {
        let rf = self.client.require_redfish()?;
        rf.get_power_metrics().await
    }
}
