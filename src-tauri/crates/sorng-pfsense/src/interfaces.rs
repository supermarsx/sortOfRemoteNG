//! Network interface management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct InterfaceManager;

impl InterfaceManager {
    pub async fn list(client: &PfsenseClient) -> PfsenseResult<Vec<PfsenseInterface>> {
        let resp = client.api_get("/interface").await?;
        let ifaces = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        ifaces.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get(client: &PfsenseClient, name: &str) -> PfsenseResult<PfsenseInterface> {
        let ifaces = Self::list(client).await?;
        ifaces.into_iter()
            .find(|i| i.name == name || i.if_name == name)
            .ok_or_else(|| PfsenseError::interface_not_found(name))
    }

    pub async fn get_stats(client: &PfsenseClient, name: &str) -> PfsenseResult<InterfaceStats> {
        let output = client.exec_ssh(&format!(
            "netstat -I {} -b --libxo json", name
        )).await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::api(format!("Failed to get stats for {name}: {}", output.stderr)));
        }
        let parsed: serde_json::Value = serde_json::from_str(&output.stdout)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let stats = parsed.get("statistics")
            .and_then(|s| s.get("interface"))
            .and_then(|a| a.as_array())
            .and_then(|a| a.first())
            .cloned()
            .unwrap_or_default();
        Ok(InterfaceStats {
            bytes_in: stats.get("received-bytes").and_then(|v| v.as_u64()).unwrap_or(0),
            bytes_out: stats.get("sent-bytes").and_then(|v| v.as_u64()).unwrap_or(0),
            packets_in: stats.get("received-packets").and_then(|v| v.as_u64()).unwrap_or(0),
            packets_out: stats.get("sent-packets").and_then(|v| v.as_u64()).unwrap_or(0),
            errors_in: stats.get("receive-errors").and_then(|v| v.as_u64()).unwrap_or(0),
            errors_out: stats.get("send-errors").and_then(|v| v.as_u64()).unwrap_or(0),
            collisions: stats.get("collisions").and_then(|v| v.as_u64()).unwrap_or(0),
        })
    }

    pub async fn create_vlan(client: &PfsenseClient, req: &CreateVlanRequest) -> PfsenseResult<VlanConfig> {
        let body = serde_json::json!({
            "if": req.parent_if,
            "tag": req.tag,
            "descr": req.description,
            "pcp": req.priority,
        });
        let resp = client.api_post("/interface/vlan", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_vlan(client: &PfsenseClient, vlan_id: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/interface/vlan/{vlan_id}")).await
    }

    pub async fn list_vlans(client: &PfsenseClient) -> PfsenseResult<Vec<VlanConfig>> {
        let resp = client.api_get("/interface/vlan").await?;
        let vlans = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        vlans.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn assign_interface(client: &PfsenseClient, req: &AssignInterfaceRequest) -> PfsenseResult<PfsenseInterface> {
        let body = serde_json::json!({
            "if": req.if_name,
            "descr": req.description,
            "enable": req.enabled,
            "type": "staticv4",
            "ipaddr": req.ipaddr,
            "subnet": req.subnet,
            "gateway": req.gateway,
        });
        let resp = client.api_post("/interface", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn enable_interface(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        let body = serde_json::json!({ "enable": true });
        client.api_put(&format!("/interface/{name}"), &body).await?;
        Ok(())
    }

    pub async fn disable_interface(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        let body = serde_json::json!({ "enable": false });
        client.api_put(&format!("/interface/{name}"), &body).await?;
        Ok(())
    }

    pub async fn get_interface_config(client: &PfsenseClient, name: &str) -> PfsenseResult<serde_json::Value> {
        let resp = client.api_get(&format!("/interface/{name}")).await?;
        Ok(resp.get("data").cloned().unwrap_or(resp))
    }

    pub async fn apply_changes(client: &PfsenseClient) -> PfsenseResult<()> {
        client.api_post("/interface/apply", &serde_json::json!({})).await?;
        Ok(())
    }
}
