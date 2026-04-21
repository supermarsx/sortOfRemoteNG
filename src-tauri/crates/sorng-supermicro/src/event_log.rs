//! Event log management for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct EventLogManager;

impl EventLogManager {
    /// Get System Event Log entries (Redfish → legacy web).
    pub async fn get_event_log(client: &SmcClient) -> SmcResult<Vec<EventLogEntry>> {
        if let Some(ref rf) = client.redfish {
            return rf.get_event_log().await;
        }
        if let Some(ref web) = client.legacy_web {
            return web.get_event_log().await;
        }
        Err(crate::error::SmcError::event_log(
            "No protocol available for event log",
        ))
    }

    /// Get audit log entries (Redfish only).
    pub async fn get_audit_log(client: &SmcClient) -> SmcResult<Vec<EventLogEntry>> {
        let rf = client.require_redfish()?;
        rf.get_audit_log().await
    }

    /// Clear the System Event Log (Redfish → legacy web).
    pub async fn clear_event_log(client: &SmcClient) -> SmcResult<()> {
        if let Some(ref rf) = client.redfish {
            return rf.clear_event_log().await;
        }
        if let Some(ref web) = client.legacy_web {
            return web.clear_event_log().await;
        }
        Err(crate::error::SmcError::event_log(
            "No protocol available to clear event log",
        ))
    }
}
