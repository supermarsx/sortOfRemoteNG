//! Network management for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct NetworkManager;

impl NetworkManager {
    /// Get system NIC adapters (Redfish only).
    pub async fn get_network_adapters(client: &SmcClient) -> SmcResult<Vec<NetworkAdapter>> {
        let rf = client.require_redfish()?;
        rf.get_network_adapters().await
    }

    /// Get BMC network configuration (Redfish only).
    pub async fn get_bmc_network(client: &SmcClient) -> SmcResult<Vec<NetworkAdapter>> {
        let rf = client.require_redfish()?;
        rf.get_bmc_network().await
    }
}
