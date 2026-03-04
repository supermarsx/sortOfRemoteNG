//! System information management for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct SystemManager;

impl SystemManager {
    /// Get server system information (Redfish → legacy web).
    pub async fn get_system_info(client: &SmcClient) -> SmcResult<SystemInfo> {
        if let Some(ref rf) = client.redfish {
            return rf.get_system_info().await;
        }
        if let Some(ref web) = client.legacy_web {
            return web.get_system_info().await;
        }
        Err(crate::error::SmcError::new(
            crate::error::SmcErrorKind::Bmc(sorng_bmc_common::error::BmcErrorKind::ProtocolNotSupported),
            "No protocol available for system info",
        ))
    }

    /// Get BMC controller information.
    pub async fn get_bmc_info(client: &SmcClient) -> SmcResult<SmcBmcInfo> {
        if let Some(ref rf) = client.redfish {
            return rf.get_bmc_info().await;
        }
        if let Some(ref web) = client.legacy_web {
            return web.get_bmc_info().await;
        }
        Err(crate::error::SmcError::new(
            crate::error::SmcErrorKind::Bmc(sorng_bmc_common::error::BmcErrorKind::ProtocolNotSupported),
            "No protocol available for BMC info",
        ))
    }

    /// Set chassis indicator LED (Redfish only).
    pub async fn set_indicator_led(client: &SmcClient, state: &str) -> SmcResult<()> {
        let rf = client.require_redfish()?;
        rf.set_indicator_led(state).await
    }

    /// Set the asset tag (Redfish only).
    pub async fn set_asset_tag(client: &SmcClient, tag: &str) -> SmcResult<()> {
        let rf = client.require_redfish()?;
        rf.set_asset_tag(tag).await
    }
}
