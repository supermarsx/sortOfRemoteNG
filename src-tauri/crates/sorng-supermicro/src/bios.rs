//! BIOS/UEFI settings management for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct BiosManager;

impl BiosManager {
    /// Get all BIOS/UEFI attributes (Redfish only).
    pub async fn get_bios_attributes(client: &SmcClient) -> SmcResult<Vec<BiosAttribute>> {
        let rf = client.require_redfish()?;
        rf.get_bios_attributes().await
    }

    /// Set BIOS/UEFI attributes (pending next reboot, Redfish only).
    pub async fn set_bios_attributes(
        client: &SmcClient,
        attributes: &serde_json::Value,
    ) -> SmcResult<()> {
        let rf = client.require_redfish()?;
        rf.set_bios_attributes(attributes).await
    }

    /// Get boot configuration (Redfish only).
    pub async fn get_boot_config(client: &SmcClient) -> SmcResult<BootConfig> {
        let rf = client.require_redfish()?;
        rf.get_boot_config().await
    }

    /// Set one-time boot override (Redfish only).
    pub async fn set_boot_override(
        client: &SmcClient,
        target: &str,
        mode: Option<&str>,
    ) -> SmcResult<()> {
        let rf = client.require_redfish()?;
        rf.set_boot_override(target, mode).await
    }
}
