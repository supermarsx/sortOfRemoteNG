//! Intel Node Manager power capping support (Supermicro Intel platforms).
//!
//! Intel Node Manager allows granular power capping and monitoring at the
//! platform, CPU, memory, and I/O domains. Available on Supermicro X10/X11/X12/X13
//! with the SFT-DCMS-SINGLE license key.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct NodeManagerModule;

impl NodeManagerModule {
    /// Get active Node Manager power policies (Redfish OEM extension).
    pub async fn get_policies(client: &SmcClient) -> SmcResult<Vec<NodeManagerPolicy>> {
        let rf = client.require_redfish()?;
        rf.get_node_manager_policies().await
    }

    /// Get Node Manager power statistics for a given domain.
    pub async fn get_stats(
        client: &SmcClient,
        domain: &NodeManagerDomain,
    ) -> SmcResult<NodeManagerStats> {
        let rf = client.require_redfish()?;
        rf.get_node_manager_stats(domain).await
    }
}
