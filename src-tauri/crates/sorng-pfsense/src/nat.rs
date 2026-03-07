//! NAT rule management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct NatManager;

impl NatManager {
    pub async fn list_port_forwards(client: &PfsenseClient) -> PfsenseResult<Vec<NatRule>> {
        let resp = client.api_get("/firewall/nat/port_forward").await?;
        let rules = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        rules.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn create_port_forward(client: &PfsenseClient, req: &CreateNatRuleRequest) -> PfsenseResult<NatRule> {
        let body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/firewall/nat/port_forward", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn update_port_forward(client: &PfsenseClient, rule_id: &str, req: &CreateNatRuleRequest) -> PfsenseResult<NatRule> {
        let body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_put(&format!("/firewall/nat/port_forward/{rule_id}"), &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_port_forward(client: &PfsenseClient, rule_id: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/firewall/nat/port_forward/{rule_id}")).await
    }

    pub async fn list_outbound_rules(client: &PfsenseClient) -> PfsenseResult<Vec<OutboundNatRule>> {
        let resp = client.api_get("/firewall/nat/outbound").await?;
        let rules = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        rules.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_outbound_mode(client: &PfsenseClient) -> PfsenseResult<OutboundNatMode> {
        let resp = client.api_get("/firewall/nat/outbound/mode").await?;
        let mode_str = resp.get("data")
            .and_then(|d| d.get("mode"))
            .and_then(|m| m.as_str())
            .unwrap_or("automatic");
        let mode = match mode_str {
            "automatic" => OutboundNatMode::Automatic,
            "hybrid" => OutboundNatMode::Hybrid,
            "advanced" | "manual" => OutboundNatMode::Manual,
            "disabled" => OutboundNatMode::Disabled,
            _ => OutboundNatMode::Automatic,
        };
        Ok(mode)
    }

    pub async fn set_outbound_mode(client: &PfsenseClient, mode: &OutboundNatMode) -> PfsenseResult<()> {
        let mode_str = match mode {
            OutboundNatMode::Automatic => "automatic",
            OutboundNatMode::Hybrid => "hybrid",
            OutboundNatMode::Manual => "advanced",
            OutboundNatMode::Disabled => "disabled",
        };
        let body = serde_json::json!({ "mode": mode_str });
        client.api_put("/firewall/nat/outbound/mode", &body).await?;
        Ok(())
    }

    pub async fn create_outbound_rule(client: &PfsenseClient, req: &serde_json::Value) -> PfsenseResult<OutboundNatRule> {
        let resp = client.api_post("/firewall/nat/outbound", req).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn list_one_to_one(client: &PfsenseClient) -> PfsenseResult<Vec<serde_json::Value>> {
        let resp = client.api_get("/firewall/nat/one_to_one").await?;
        Ok(resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default())
    }

    pub async fn create_one_to_one(client: &PfsenseClient, req: &serde_json::Value) -> PfsenseResult<serde_json::Value> {
        let resp = client.api_post("/firewall/nat/one_to_one", req).await?;
        Ok(resp.get("data").cloned().unwrap_or(resp))
    }

    pub async fn delete_one_to_one(client: &PfsenseClient, rule_id: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/firewall/nat/one_to_one/{rule_id}")).await
    }
}
