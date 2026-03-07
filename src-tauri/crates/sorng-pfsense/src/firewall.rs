//! Firewall rule and alias management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct FirewallManager;

impl FirewallManager {
    pub async fn list_rules(client: &PfsenseClient, interface: Option<&str>) -> PfsenseResult<Vec<FirewallRule>> {
        let endpoint = match interface {
            Some(iface) => format!("/firewall/rule?interface={iface}"),
            None => "/firewall/rule".to_string(),
        };
        let resp = client.api_get(&endpoint).await?;
        let rules = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        rules.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_rule(client: &PfsenseClient, rule_id: &str) -> PfsenseResult<FirewallRule> {
        let rules = Self::list_rules(client, None).await?;
        rules.into_iter()
            .find(|r| r.id == rule_id || r.tracker == rule_id)
            .ok_or_else(|| PfsenseError::rule_not_found(rule_id))
    }

    pub async fn create_rule(client: &PfsenseClient, req: &CreateFirewallRuleRequest) -> PfsenseResult<FirewallRule> {
        let body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/firewall/rule", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn update_rule(client: &PfsenseClient, rule_id: &str, req: &UpdateFirewallRuleRequest) -> PfsenseResult<FirewallRule> {
        let body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_put(&format!("/firewall/rule/{rule_id}"), &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_rule(client: &PfsenseClient, rule_id: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/firewall/rule/{rule_id}")).await
    }

    pub async fn move_rule(client: &PfsenseClient, rule_id: &str, position: u32) -> PfsenseResult<()> {
        let body = serde_json::json!({
            "id": rule_id,
            "position": position,
        });
        client.api_post("/firewall/rule/reorder", &body).await?;
        Ok(())
    }

    pub async fn toggle_rule(client: &PfsenseClient, rule_id: &str, enabled: bool) -> PfsenseResult<()> {
        let body = serde_json::json!({ "disabled": !enabled });
        client.api_put(&format!("/firewall/rule/{rule_id}"), &body).await?;
        Ok(())
    }

    pub async fn list_aliases(client: &PfsenseClient) -> PfsenseResult<Vec<FirewallAlias>> {
        let resp = client.api_get("/firewall/alias").await?;
        let aliases = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        aliases.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_alias(client: &PfsenseClient, name: &str) -> PfsenseResult<FirewallAlias> {
        let aliases = Self::list_aliases(client).await?;
        aliases.into_iter()
            .find(|a| a.name == name)
            .ok_or_else(|| PfsenseError::rule_not_found(name))
    }

    pub async fn create_alias(client: &PfsenseClient, req: &CreateAliasRequest) -> PfsenseResult<FirewallAlias> {
        let body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/firewall/alias", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn update_alias(client: &PfsenseClient, name: &str, req: &CreateAliasRequest) -> PfsenseResult<FirewallAlias> {
        let body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_put(&format!("/firewall/alias/{name}"), &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_alias(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/firewall/alias/{name}")).await
    }

    pub async fn get_states_count(client: &PfsenseClient) -> PfsenseResult<u64> {
        let output = client.exec_ssh("pfctl -si | grep -i 'current entries'").await?;
        let count = output.stdout.split_whitespace()
            .last()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        Ok(count)
    }

    pub async fn clear_states(client: &PfsenseClient) -> PfsenseResult<()> {
        let output = client.exec_ssh("pfctl -Fs").await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::api(format!("Failed to clear states: {}", output.stderr)));
        }
        Ok(())
    }

    pub async fn get_rule_stats(client: &PfsenseClient, rule_id: &str) -> PfsenseResult<FirewallRule> {
        Self::get_rule(client, rule_id).await
    }

    pub async fn list_schedules(client: &PfsenseClient) -> PfsenseResult<Vec<FirewallSchedule>> {
        let resp = client.api_get("/firewall/schedule").await?;
        let scheds = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        scheds.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }
}
