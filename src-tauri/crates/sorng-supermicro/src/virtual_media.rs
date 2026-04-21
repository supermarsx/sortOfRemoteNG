//! Virtual media management for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct VirtualMediaManager;

impl VirtualMediaManager {
    /// Get virtual media status (Redfish only).
    pub async fn get_status(client: &SmcClient) -> SmcResult<Vec<VirtualMediaStatus>> {
        let rf = client.require_redfish()?;
        rf.get_virtual_media_status().await
    }

    /// Insert virtual media ISO/image (Redfish only).
    pub async fn insert_media(client: &SmcClient, slot: &str, image_url: &str) -> SmcResult<()> {
        let rf = client.require_redfish()?;
        rf.insert_virtual_media(slot, image_url).await
    }

    /// Eject virtual media (Redfish only).
    pub async fn eject_media(client: &SmcClient, slot: &str) -> SmcResult<()> {
        let rf = client.require_redfish()?;
        rf.eject_virtual_media(slot).await
    }
}
