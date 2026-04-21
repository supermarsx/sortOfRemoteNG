//! Remote console (iKVM) management for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct VirtualConsoleManager;

impl VirtualConsoleManager {
    /// Get console/iKVM session information (Redfish only).
    pub async fn get_console_info(client: &SmcClient) -> SmcResult<SmcConsoleInfo> {
        let rf = client.require_redfish()?;
        rf.get_console_info().await
    }

    /// Get HTML5 iKVM launch URL (X11+ only).
    pub async fn get_html5_ikvm_url(client: &SmcClient) -> SmcResult<String> {
        let rf = client.require_redfish()?;
        rf.get_html5_ikvm_url().await
    }
}
