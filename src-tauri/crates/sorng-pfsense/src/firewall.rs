use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct FirewallManager;

impl FirewallManager {
    pub async fn list_rules(client: &PfsenseClient) -> PfsenseResult<Vec<FirewallRule>> {
        let resp: ApiListResponse<FirewallRule> = client.api_get("firewall/rule").await?;
        Ok(resp.data)
    }

    pub async fn get_rule(client: &PfsenseClient, id: &str) -> PfsenseResult<FirewallRule> {
        let resp: ApiResponse<FirewallRule> = client.api_get(&format!("firewall/rule/{id}")).await?;
        Ok(resp.data)
    }

    pub async fn create_rule(client: &PfsenseClient, rule: &FirewallRule) -> PfsenseResult<FirewallRule> {
        let resp: ApiResponse<FirewallRule> = client.api_post("firewall/rule", rule).await?;
        Ok(resp.data)
    }

    pub async fn update_rule(client: &PfsenseClient, id: &str, rule: &FirewallRule) -> PfsenseResult<FirewallRule> {
        let resp: ApiResponse<FirewallRule> = client.api_put(&format!("firewall/rule/{id}"), rule).await?;
        Ok(resp.data)
    }

    pub async fn delete_rule(client: &PfsenseClient, id: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("firewall/rule/{id}")).await
    }

    pub async fn apply_rules(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client.api_post("firewall/apply", &serde_json::json!({})).await
    }

    pub async fn list_aliases(client: &PfsenseClient) -> PfsenseResult<Vec<FirewallAlias>> {
        let resp: ApiListResponse<FirewallAlias> = client.api_get("firewall/alias").await?;
        Ok(resp.data)
    }

    pub async fn get_alias(client: &PfsenseClient, name: &str) -> PfsenseResult<FirewallAlias> {
        let resp: ApiResponse<FirewallAlias> = client.api_get(&format!("firewall/alias/{name}")).await?;
        Ok(resp.data)
    }

    pub async fn create_alias(client: &PfsenseClient, alias: &FirewallAlias) -> PfsenseResult<FirewallAlias> {
        let resp: ApiResponse<FirewallAlias> = client.api_post("firewall/alias", alias).await?;
        Ok(resp.data)
    }

    pub async fn update_alias(client: &PfsenseClient, name: &str, alias: &FirewallAlias) -> PfsenseResult<FirewallAlias> {
        let resp: ApiResponse<FirewallAlias> = client.api_put(&format!("firewall/alias/{name}"), alias).await?;
        Ok(resp.data)
    }

    pub async fn delete_alias(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("firewall/alias/{name}")).await
    }

    pub async fn get_states(client: &PfsenseClient) -> PfsenseResult<Vec<FirewallState>> {
        let resp: ApiListResponse<FirewallState> = client.api_get("status/filter_state").await?;
        Ok(resp.data)
    }

    pub async fn get_state_count(client: &PfsenseClient) -> PfsenseResult<u64> {
        let raw: serde_json::Value = client.api_get_raw("status/filter_state/size").await?;
        let count = raw.get("data")
            .and_then(|d| d.as_u64())
            .unwrap_or(0);
        Ok(count)
    }

    pub async fn flush_states(client: &PfsenseClient) -> PfsenseResult<()> {
        client.api_delete_void("status/filter_state").await
    }
}
