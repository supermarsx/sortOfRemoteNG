// ── cPanel stats & metrics ───────────────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct StatsManager;

impl StatsManager {
    /// Get bandwidth usage for a user.
    pub async fn get_bandwidth(client: &CpanelClient, user: &str) -> CpanelResult<BandwidthUsage> {
        let raw: serde_json::Value = client.whm_uapi(user, "Stats", "get_bandwidth", &[]).await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get resource usage (CPU, memory, IO) for a user.
    pub async fn get_resource_usage(
        client: &CpanelClient,
        user: &str,
    ) -> CpanelResult<ResourceUsage> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "ResourceUsage", "get_usages", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get visitor/access logs.
    pub async fn get_visitor_logs(
        client: &CpanelClient,
        user: &str,
        domain: &str,
        lines: u32,
    ) -> CpanelResult<Vec<VisitorLog>> {
        let lines_str = lines.to_string();
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Stats",
                "get_site_visitor_log",
                &[("domain", domain), ("maxnodes", &lines_str)],
            )
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get error log entries.
    pub async fn get_error_log(
        client: &CpanelClient,
        user: &str,
        lines: u32,
    ) -> CpanelResult<Vec<ErrorLogEntry>> {
        let lines_str = lines.to_string();
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Stats",
                "get_site_errors",
                &[("maxnodes", &lines_str)],
            )
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get AWStats summary for a domain.
    pub async fn get_awstats(
        client: &CpanelClient,
        user: &str,
        domain: &str,
    ) -> CpanelResult<AwestatsSummary> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Stats", "get_awstats_data", &[("domain", domain)])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get server load average (WHM).
    pub async fn get_server_load(client: &CpanelClient) -> CpanelResult<ServerLoadStatus> {
        let raw: serde_json::Value = client.whm_api_raw("systemloadavg", &[]).await?;
        let data = raw.get("data").cloned().unwrap_or_default();
        // Parse the structured load avg
        let one = data.get("one").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let five = data.get("five").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let fifteen = data.get("fifteen").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let cpu_count = data
            .get("cpu_count")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32);
        Ok(ServerLoadStatus {
            one,
            five,
            fifteen,
            cpu_count,
            running_procs: None,
            total_procs: None,
        })
    }

    /// Get server bandwidth usage summary (WHM).
    pub async fn get_server_bandwidth(
        client: &CpanelClient,
        month: Option<&str>,
        year: Option<&str>,
    ) -> CpanelResult<serde_json::Value> {
        let mut params: Vec<(&str, &str)> = vec![];
        if let Some(m) = month {
            params.push(("month", m));
        }
        if let Some(y) = year {
            params.push(("year", y));
        }
        client.whm_api_raw("showbw", &params).await
    }

    /// List processes on the server (WHM).
    pub async fn list_processes(client: &CpanelClient) -> CpanelResult<serde_json::Value> {
        client.whm_api_raw("reboot", &[("force", "0")]).await
    }

    /// Get disk usage for all users (WHM).
    pub async fn get_disk_usage_all(client: &CpanelClient) -> CpanelResult<serde_json::Value> {
        client.whm_api_raw("getdiskusage", &[]).await
    }
}

fn extract_data(raw: &serde_json::Value) -> CpanelResult<serde_json::Value> {
    check_uapi(raw)?;
    Ok(raw
        .get("result")
        .and_then(|r| r.get("data"))
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![])))
}

fn check_uapi(raw: &serde_json::Value) -> CpanelResult<()> {
    let status = raw
        .get("result")
        .and_then(|r| r.get("status"))
        .and_then(|s| s.as_u64())
        .unwrap_or(1);
    if status == 0 {
        let errors = raw
            .get("result")
            .and_then(|r| r.get("errors"))
            .and_then(|e| e.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_else(|| "UAPI call failed".into());
        return Err(CpanelError::api(errors));
    }
    Ok(())
}
