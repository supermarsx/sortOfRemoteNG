//! Event log management for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct EventLogManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> EventLogManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_event_log(&self) -> LenovoResult<Vec<BmcEventLogEntry>> {
        if let Ok(rf) = self.client.require_redfish() {
            return rf.get_event_log().await;
        }
        if let Ok(lr) = self.client.require_legacy_rest() {
            return lr.get_event_log().await;
        }
        Err(crate::error::LenovoError::unsupported(
            "Event log requires Redfish or Legacy REST",
        ))
    }

    pub async fn get_audit_log(&self) -> LenovoResult<Vec<BmcEventLogEntry>> {
        let rf = self.client.require_redfish()?;
        rf.get_audit_log().await
    }

    pub async fn clear_event_log(&self) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        rf.clear_event_log().await
    }
}
