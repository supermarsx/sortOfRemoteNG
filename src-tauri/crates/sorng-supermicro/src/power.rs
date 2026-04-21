//! Power management for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;
use sorng_bmc_common::power::PowerAction;

pub struct PowerManager;

impl PowerManager {
    /// Get current power state (Redfish → IPMI).
    pub async fn get_power_state(client: &SmcClient) -> SmcResult<String> {
        if let Some(ref rf) = client.redfish {
            return rf.get_power_state().await;
        }
        if let Some(ref ipmi) = client.ipmi {
            let status = ipmi
                .get_chassis_status()
                .await
                .map_err(crate::error::SmcError::from)?;
            return Ok(if status.power_on {
                "On".into()
            } else {
                "Off".into()
            });
        }
        Err(crate::error::SmcError::power(
            "No protocol available for power state",
        ))
    }

    /// Execute a power action (Redfish → legacy web → IPMI).
    pub async fn power_action(client: &SmcClient, action: &PowerAction) -> SmcResult<()> {
        if let Some(ref rf) = client.redfish {
            return rf.power_action(action).await;
        }
        if let Some(ref web) = client.legacy_web {
            return web.power_action(action).await;
        }
        if let Some(ref ipmi) = client.ipmi {
            ipmi.chassis_control(action.to_ipmi())
                .await
                .map_err(crate::error::SmcError::from)?;
            return Ok(());
        }
        Err(crate::error::SmcError::power(
            "No protocol available for power action",
        ))
    }

    /// Get detailed power metrics (Redfish only).
    pub async fn get_power_metrics(client: &SmcClient) -> SmcResult<PowerMetrics> {
        let rf = client.require_redfish()?;
        rf.get_power_metrics().await
    }
}
