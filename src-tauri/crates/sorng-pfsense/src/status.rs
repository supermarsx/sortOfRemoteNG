//! System status and service management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct StatusManager;

impl StatusManager {
    pub async fn get_system_status(client: &PfsenseClient) -> PfsenseResult<SystemStatus> {
        let resp = client.api_get("/status/system").await?;
        let data = resp.get("data").cloned().unwrap_or(resp);
        Ok(SystemStatus {
            version: data.get("system_version").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            platform: data.get("system_platform").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            cpu_type: data.get("cpu_type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            cpu_count: data.get("cpu_count")
                .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_u64().map(|n| n as u32)))
                .unwrap_or(0),
            uptime: data.get("uptime").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            memory_total: data.get("mem_total").and_then(|v| v.as_u64()).unwrap_or(0),
            memory_used: data.get("mem_used").and_then(|v| v.as_u64()).unwrap_or(0),
            swap_total: data.get("swap_total").and_then(|v| v.as_u64()).unwrap_or(0),
            swap_used: data.get("swap_used").and_then(|v| v.as_u64()).unwrap_or(0),
            disk_usage: data.get("disk_usage")
                .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                .unwrap_or(0.0),
            cpu_usage: data.get("cpu_usage")
                .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                .unwrap_or(0.0),
            load_average: data.get("load_average")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_f64()).collect())
                .unwrap_or_default(),
            temperature: data.get("temperature")
                .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                .unwrap_or(0.0),
        })
    }

    pub async fn list_services(client: &PfsenseClient) -> PfsenseResult<Vec<ServiceStatus>> {
        let resp = client.api_get("/status/service").await?;
        let services = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        services.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_service_status(client: &PfsenseClient, name: &str) -> PfsenseResult<ServiceStatus> {
        let services = Self::list_services(client).await?;
        services.into_iter()
            .find(|s| s.name == name)
            .ok_or_else(|| PfsenseError::api(format!("Service not found: {name}")))
    }

    pub async fn start_service(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        let body = serde_json::json!({ "service": name, "action": "start" });
        client.api_post("/status/service", &body).await?;
        Ok(())
    }

    pub async fn stop_service(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        let body = serde_json::json!({ "service": name, "action": "stop" });
        client.api_post("/status/service", &body).await?;
        Ok(())
    }

    pub async fn restart_service(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        let body = serde_json::json!({ "service": name, "action": "restart" });
        client.api_post("/status/service", &body).await?;
        Ok(())
    }

    pub async fn get_traffic_graph(client: &PfsenseClient, interface: &str) -> PfsenseResult<TrafficGraph> {
        let resp = client.api_get(&format!("/status/interface/{interface}/traffic")).await?;
        let data = resp.get("data").cloned().unwrap_or(resp);
        Ok(TrafficGraph {
            interface: interface.to_string(),
            in_bytes: data.get("in_bytes").and_then(|v| v.as_u64()).unwrap_or(0),
            out_bytes: data.get("out_bytes").and_then(|v| v.as_u64()).unwrap_or(0),
            in_packets: data.get("in_packets").and_then(|v| v.as_u64()).unwrap_or(0),
            out_packets: data.get("out_packets").and_then(|v| v.as_u64()).unwrap_or(0),
        })
    }

    pub async fn get_cpu_usage(client: &PfsenseClient) -> PfsenseResult<f64> {
        let status = Self::get_system_status(client).await?;
        Ok(status.cpu_usage)
    }

    pub async fn get_memory_usage(client: &PfsenseClient) -> PfsenseResult<(u64, u64)> {
        let status = Self::get_system_status(client).await?;
        Ok((status.memory_used, status.memory_total))
    }

    pub async fn get_disk_usage(client: &PfsenseClient) -> PfsenseResult<f64> {
        let status = Self::get_system_status(client).await?;
        Ok(status.disk_usage)
    }

    pub async fn get_pf_info(client: &PfsenseClient) -> PfsenseResult<PfInfo> {
        crate::diagnostics::DiagnosticsManager::get_pf_info(client).await
    }
}
