//! Server operations — info, config, reports, web relay.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::MeshCentralResult;
use crate::meshcentral::types::*;
use serde_json::json;
use std::collections::HashMap;

impl McApiClient {
    /// Get full server information.
    pub async fn get_server_info(&self) -> MeshCentralResult<McServerInfo> {
        self.server_info().await
    }

    /// Get server configuration settings (admin only).
    pub async fn get_server_config(&self) -> MeshCentralResult<McServerConfig> {
        let resp = self.get_json("/api/serverconfig").await?;
        let config = serde_json::from_value::<McServerConfig>(resp)?;
        Ok(config)
    }

    /// Get general server statistics (connected users, devices, etc.).
    pub async fn get_server_stats(&self) -> MeshCentralResult<serde_json::Value> {
        let payload = serde_json::Map::new();
        let resp = self.send_action("serverstats", payload).await?;
        Ok(resp)
    }

    /// Generate a report on the MeshCentral server.
    pub async fn generate_report(
        &self,
        report: &McGenerateReport,
    ) -> MeshCentralResult<McReport> {
        let mut payload = serde_json::Map::new();
        payload.insert("type".to_string(), json!(report.report_type as u32));

        if let Some(group_by) = report.group_by {
            payload.insert("groupBy".to_string(), json!(group_by as u32));
        }

        if let Some(ref start) = report.start {
            payload.insert("start".to_string(), json!(start));
        }
        if let Some(ref end) = report.end {
            payload.insert("end".to_string(), json!(end));
        }
        if let Some(ref group_id) = report.device_group {
            payload.insert("meshid".to_string(), json!(group_id));
        }
        if report.show_traffic {
            payload.insert("showTraffic".to_string(), json!(true));
        }

        let resp = self.send_action("report", payload).await?;

        // Parse report response
        let columns = resp
            .get("columns")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value::<McReportColumn>(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();

        let groups: HashMap<String, McReportGroup> = resp
            .get("groups")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        Ok(McReport { columns, groups })
    }

    /// Set up a web relay for accessing a device's web interface.
    pub async fn create_web_relay(
        &self,
        relay: &McWebRelay,
    ) -> MeshCentralResult<McWebRelayResult> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(relay.device_id));

        if let Some(port) = relay.port {
            payload.insert("port".to_string(), json!(port));
        }

        payload.insert("appid".to_string(), json!(relay.protocol));

        let resp = self.send_action("webrelay", payload).await?;

        let url = resp
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let public_id = resp
            .get("publicid")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(McWebRelayResult { url, public_id })
    }

    /// Get the MeshCentral server version.
    pub async fn get_server_version(&self) -> MeshCentralResult<String> {
        let info = self.get_server_info().await?;
        Ok(info.version)
    }

    /// Check if the server has a specific capability by inspecting the extra fields.
    pub async fn check_server_capability(
        &self,
        capability: &str,
    ) -> MeshCentralResult<bool> {
        let info = self.get_server_info().await?;
        let has = info.extra.contains_key(capability);
        Ok(has)
    }

    /// Get the list of domains configured on the server via the extra fields.
    pub async fn get_server_domains(&self) -> MeshCentralResult<Vec<String>> {
        let info = self.get_server_info().await?;
        if let Some(val) = info.extra.get("domains") {
            if let Some(arr) = val.as_array() {
                let domains: Vec<String> = arr
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
                return Ok(domains);
            }
        }
        Ok(vec![info.domain])
    }

    /// Get server certificate hash (useful for agent setup).
    pub async fn get_server_cert_hash(&self) -> MeshCentralResult<Option<String>> {
        let info = self.get_server_info().await?;
        Ok(info
            .extra
            .get("certHash")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()))
    }

    /// Check if the server is healthy / reachable.
    pub async fn health_check(&self) -> MeshCentralResult<bool> {
        match self.ping().await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
}
