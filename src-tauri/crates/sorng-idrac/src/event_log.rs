//! Event logs — System Event Log (SEL), Lifecycle Controller Log.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;
use crate::wsman::dcim_classes;

/// Event log management (SEL + LC Log).
pub struct EventLogManager<'a> {
    client: &'a IdracClient,
}

impl<'a> EventLogManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// Get System Event Log entries.
    pub async fn get_sel_entries(&self, max_entries: Option<u32>) -> IdracResult<Vec<SelEntry>> {
        if let Ok(rf) = self.client.require_redfish() {
            let mut url = "/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Sel/Entries?$expand=*($levels=1)".to_string();
            if let Some(max) = max_entries {
                url.push_str(&format!("&$top={}", max));
            }

            let col: serde_json::Value = rf.get(&url).await?;
            let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            return Ok(members
                .iter()
                .map(|e| SelEntry {
                    id: e.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    name: e.get("Name").and_then(|v| v.as_str()).unwrap_or("SEL Entry").to_string(),
                    created: e.get("Created").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    entry_type: e.get("EntryType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    severity: e.get("Severity").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    message: e.get("Message").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    message_id: e.get("MessageId").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    sensor_type: e.get("SensorType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    sensor_number: e.get("SensorNumber").and_then(|v| v.as_u64()).map(|n| n as u32),
                    message_args: e.get("MessageArgs").and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                        .unwrap_or_default(),
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::SEL_LOG_ENTRY).await?;
            let mut entries: Vec<SelEntry> = views
                .iter()
                .map(|v| {
                    let get = |k: &str| v.properties.get(k).and_then(|val| val.as_str()).map(|s| s.to_string());
                    SelEntry {
                        id: get("RecordID").unwrap_or_default(),
                        name: "SEL Entry".to_string(),
                        created: get("MessageTimeStamp"),
                        entry_type: get("RecordType"),
                        severity: get("PerceivedSeverity"),
                        message: get("Message"),
                        message_id: get("MessageID"),
                        sensor_type: get("SensorType"),
                        sensor_number: v.properties.get("SensorNumber").and_then(|val| val.as_u64()).map(|n| n as u32),
                        message_args: Vec::new(),
                    }
                })
                .collect();

            if let Some(max) = max_entries {
                entries.truncate(max as usize);
            }
            return Ok(entries);
        }

        // IPMI fallback — basic SEL info only
        if let Ok(ipmi) = self.client.require_ipmi() {
            let info = ipmi.get_sel_info().await?;
            return Ok(vec![SelEntry {
                id: "ipmi-sel-info".to_string(),
                name: "IPMI SEL Info".to_string(),
                created: None,
                entry_type: Some("SEL Info".to_string()),
                severity: None,
                message: Some(format!(
                    "SEL entries: {}, free space: {} bytes",
                    info.0, info.1
                )),
                message_id: None,
                sensor_type: None,
                sensor_number: None,
                message_args: Vec::new(),
            }]);
        }

        Err(IdracError::unsupported("SEL access requires Redfish, WSMAN, or IPMI"))
    }

    /// Get Lifecycle Controller Log entries.
    pub async fn get_lc_log_entries(&self, max_entries: Option<u32>) -> IdracResult<Vec<LcLogEntry>> {
        if let Ok(rf) = self.client.require_redfish() {
            let mut url = "/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Entries?$expand=*($levels=1)".to_string();
            if let Some(max) = max_entries {
                url.push_str(&format!("&$top={}", max));
            }

            let col: serde_json::Value = rf.get(&url).await?;
            let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            return Ok(members
                .iter()
                .map(|e| LcLogEntry {
                    id: e.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    name: e.get("Name").and_then(|v| v.as_str()).unwrap_or("LC Entry").to_string(),
                    created: e.get("Created").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    severity: e.get("Severity").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    message: e.get("Message").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    message_id: e.get("MessageId").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    category: e.pointer("/Oem/Dell/Category").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    component: e.pointer("/Oem/Dell/FQDD").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    message_args: e.get("MessageArgs").and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                        .unwrap_or_default(),
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::LC_LOG_ENTRY).await?;
            let mut entries: Vec<LcLogEntry> = views
                .iter()
                .map(|v| {
                    let get = |k: &str| v.properties.get(k).and_then(|val| val.as_str()).map(|s| s.to_string());
                    LcLogEntry {
                        id: get("RecordID").unwrap_or_default(),
                        name: "LC Entry".to_string(),
                        created: get("MessageTimeStamp"),
                        severity: get("PerceivedSeverity"),
                        message: get("Message"),
                        message_id: get("MessageID"),
                        category: get("Category"),
                        component: get("FQDD"),
                        message_args: Vec::new(),
                    }
                })
                .collect();

            if let Some(max) = max_entries {
                entries.truncate(max as usize);
            }
            return Ok(entries);
        }

        Err(IdracError::unsupported("LC log requires Redfish or WSMAN"))
    }

    /// Clear the System Event Log.
    pub async fn clear_sel(&self) -> IdracResult<()> {
        if let Ok(rf) = self.client.require_redfish() {
            rf.post_action(
                "/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Sel/Actions/LogService.ClearLog",
                &serde_json::json!({}),
            )
            .await?;
            return Ok(());
        }

        if let Ok(ipmi) = self.client.require_ipmi() {
            ipmi.clear_sel().await?;
            return Ok(());
        }

        Err(IdracError::unsupported("SEL clear requires Redfish or IPMI"))
    }

    /// Clear the Lifecycle Controller Log.
    pub async fn clear_lc_log(&self) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;
        rf.post_action(
            "/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Actions/LogService.ClearLog",
            &serde_json::json!({}),
        )
        .await?;
        Ok(())
    }

    /// Get log service status/info (SEL capacity, etc.).
    pub async fn get_sel_info(&self) -> IdracResult<serde_json::Value> {
        if let Ok(rf) = self.client.require_redfish() {
            return rf.get("/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Sel").await;
        }

        if let Ok(ipmi) = self.client.require_ipmi() {
            let (entries, free_bytes) = ipmi.get_sel_info().await?;
            return Ok(serde_json::json!({
                "entries": entries,
                "freeBytes": free_bytes,
            }));
        }

        Err(IdracError::unsupported("SEL info requires Redfish or IPMI"))
    }
}
