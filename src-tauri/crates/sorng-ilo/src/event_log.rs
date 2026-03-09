//! Event log management — IML (Integrated Management Log) and iLO Event Log.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Event log operations.
pub struct EventLogManager<'a> {
    client: &'a IloClient,
}

impl<'a> EventLogManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get IML (Integrated Management Log) entries.
    pub async fn get_iml(&self) -> IloResult<Vec<BmcEventLogEntry>> {
        if let Ok(rf) = self.client.require_redfish() {
            let entries: Vec<serde_json::Value> = rf.get_iml_entries().await?;
            return self.parse_redfish_log(&serde_json::Value::Array(entries));
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let entries = ribcl.get_iml().await?;
            return self.parse_ribcl_log(&entries, "IML");
        }

        Err(IloError::unsupported("No protocol available for IML"))
    }

    /// Get iLO Event Log entries.
    pub async fn get_ilo_event_log(&self) -> IloResult<Vec<BmcEventLogEntry>> {
        if let Ok(rf) = self.client.require_redfish() {
            let entries: Vec<serde_json::Value> = rf.get_ilo_event_log().await?;
            return self.parse_redfish_log(&serde_json::Value::Array(entries));
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let entries = ribcl.get_ilo_event_log().await?;
            return self.parse_ribcl_log(&entries, "iLO");
        }

        Err(IloError::unsupported(
            "No protocol available for iLO event log",
        ))
    }

    fn parse_redfish_log(&self, data: &serde_json::Value) -> IloResult<Vec<BmcEventLogEntry>> {
        let mut entries = Vec::new();

        if let Some(members) = data.get("Members").and_then(|v| v.as_array()) {
            for entry in members {
                entries.push(BmcEventLogEntry {
                    id: entry
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    created: entry
                        .get("Created")
                        .or_else(|| entry.get("EventTimestamp"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    severity: entry
                        .get("Severity")
                        .or_else(|| entry.pointer("/Oem/Hpe/Severity"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown")
                        .to_string(),
                    message: entry
                        .get("Message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    message_id: entry
                        .get("MessageId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    entry_type: entry
                        .pointer("/Oem/Hpe/Class")
                        .or_else(|| entry.pointer("/Oem/Hp/Class"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                });
            }
        }

        Ok(entries)
    }

    fn parse_ribcl_log(
        &self,
        data: &serde_json::Value,
        _log_type: &str,
    ) -> IloResult<Vec<BmcEventLogEntry>> {
        let mut entries = Vec::new();

        if let Some(arr) = data.as_array() {
            for (i, entry) in arr.iter().enumerate() {
                let timestamp = entry
                    .get("DATE")
                    .and_then(|v| v.as_str())
                    .map(|d| {
                        let time = entry
                            .get("TIME")
                            .and_then(|v| v.as_str())
                            .unwrap_or("00:00");
                        format!("{} {}", d, time)
                    })
                    .unwrap_or_default();

                let severity = entry
                    .get("SEVERITY")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Informational");

                let message = entry
                    .get("DESCRIPTION")
                    .or_else(|| entry.get("MESSAGE"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                entries.push(BmcEventLogEntry {
                    id: format!("{}", i + 1),
                    created: timestamp,
                    severity: severity.to_string(),
                    message,
                    message_id: None,
                    entry_type: entry
                        .get("CLASS")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                });
            }
        }

        Ok(entries)
    }

    /// Clear the IML log.
    pub async fn clear_iml(&self) -> IloResult<()> {
        if let Ok(rf) = self.client.require_redfish() {
            rf.clear_iml().await?;
            return Ok(());
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            ribcl.clear_iml().await?;
            return Ok(());
        }

        Err(IloError::unsupported(
            "No protocol available for clearing IML",
        ))
    }

    /// Clear the iLO Event Log.
    pub async fn clear_ilo_event_log(&self) -> IloResult<()> {
        if let Ok(rf) = self.client.require_redfish() {
            rf.clear_ilo_event_log().await?;
            return Ok(());
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            ribcl.clear_ilo_event_log().await?;
            return Ok(());
        }

        Err(IloError::unsupported(
            "No protocol available for clearing iLO event log",
        ))
    }
}
