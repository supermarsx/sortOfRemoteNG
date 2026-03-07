//! Static routing and gateway management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct RoutingManager;

impl RoutingManager {
    pub async fn list_routes(client: &PfsenseClient) -> PfsenseResult<Vec<StaticRoute>> {
        let resp = client.api_get("/routing/static_route").await?;
        let routes = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        routes.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn create_route(client: &PfsenseClient, route: &StaticRoute) -> PfsenseResult<StaticRoute> {
        let body = serde_json::to_value(route)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/routing/static_route", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_route(client: &PfsenseClient, route_id: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/routing/static_route/{route_id}")).await
    }

    pub async fn list_gateways(client: &PfsenseClient) -> PfsenseResult<Vec<Gateway>> {
        let resp = client.api_get("/routing/gateway").await?;
        let gateways = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        gateways.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_gateway_status(client: &PfsenseClient) -> PfsenseResult<Vec<GatewayStatus>> {
        let resp = client.api_get("/routing/gateway/status").await?;
        let statuses = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        statuses.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn create_gateway_group(client: &PfsenseClient, group: &GatewayGroup) -> PfsenseResult<GatewayGroup> {
        let body = serde_json::to_value(group)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/routing/gateway/group", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn list_gateway_groups(client: &PfsenseClient) -> PfsenseResult<Vec<GatewayGroup>> {
        let resp = client.api_get("/routing/gateway/group").await?;
        let groups = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        groups.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_routing_table(client: &PfsenseClient) -> PfsenseResult<Vec<SystemRoute>> {
        let output = client.exec_ssh("netstat -rn --libxo json").await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::routing(format!(
                "Failed to get routing table: {}",
                output.stderr
            )));
        }
        let parsed: serde_json::Value = serde_json::from_str(&output.stdout)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let rt = parsed.get("statistics")
            .and_then(|s| s.get("route-information"))
            .and_then(|r| r.get("route-table"))
            .and_then(|t| t.get("rt-family"))
            .and_then(|f| f.as_array())
            .cloned()
            .unwrap_or_default();

        let mut routes = Vec::new();
        for family in &rt {
            if let Some(entries) = family.get("rt-entry").and_then(|e| e.as_array()) {
                for entry in entries {
                    routes.push(SystemRoute {
                        destination: entry.get("destination").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        gateway: entry.get("gateway").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        flags: entry.get("flags").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        interface: entry.get("interface-name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        mtu: entry.get("mtu").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    });
                }
            }
        }
        Ok(routes)
    }
}
