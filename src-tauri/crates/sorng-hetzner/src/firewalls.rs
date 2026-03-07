use crate::client::HetznerClient;
use crate::error::HetznerResult;
use crate::types::*;

pub struct FirewallManager;

impl FirewallManager {
    pub async fn list_firewalls(client: &HetznerClient) -> HetznerResult<Vec<HetznerFirewall>> {
        let resp: FirewallsResponse = client.get("/firewalls").await?;
        Ok(resp.firewalls)
    }

    pub async fn get_firewall(client: &HetznerClient, id: u64) -> HetznerResult<HetznerFirewall> {
        let resp: FirewallResponse = client.get(&format!("/firewalls/{id}")).await?;
        Ok(resp.firewall)
    }

    pub async fn create_firewall(
        client: &HetznerClient,
        request: CreateFirewallRequest,
    ) -> HetznerResult<HetznerFirewall> {
        let body = serde_json::to_value(&request)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        let resp: FirewallResponse = client.post("/firewalls", &body).await?;
        Ok(resp.firewall)
    }

    pub async fn update_firewall(
        client: &HetznerClient,
        id: u64,
        name: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerFirewall> {
        let mut body = serde_json::json!({});
        if let Some(n) = name {
            body["name"] = serde_json::Value::String(n);
        }
        if let Some(l) = labels {
            body["labels"] = l;
        }
        let resp: FirewallResponse = client.put(&format!("/firewalls/{id}"), &body).await?;
        Ok(resp.firewall)
    }

    pub async fn delete_firewall(client: &HetznerClient, id: u64) -> HetznerResult<()> {
        client.delete_req(&format!("/firewalls/{id}")).await
    }

    pub async fn set_rules(
        client: &HetznerClient,
        id: u64,
        rules: Vec<HetznerFirewallRule>,
    ) -> HetznerResult<Vec<HetznerAction>> {
        let body = serde_json::json!({ "rules": rules });
        let resp: ActionsResponse = client
            .post(&format!("/firewalls/{id}/actions/set_rules"), &body)
            .await?;
        Ok(resp.actions)
    }

    pub async fn apply_to_resources(
        client: &HetznerClient,
        id: u64,
        apply_to: Vec<HetznerFirewallAppliedTo>,
    ) -> HetznerResult<Vec<HetznerAction>> {
        let body = serde_json::json!({ "apply_to": apply_to });
        let resp: ActionsResponse = client
            .post(&format!("/firewalls/{id}/actions/apply_to_resources"), &body)
            .await?;
        Ok(resp.actions)
    }

    pub async fn remove_from_resources(
        client: &HetznerClient,
        id: u64,
        remove_from: Vec<HetznerFirewallAppliedTo>,
    ) -> HetznerResult<Vec<HetznerAction>> {
        let body = serde_json::json!({ "remove_from": remove_from });
        let resp: ActionsResponse = client
            .post(&format!("/firewalls/{id}/actions/remove_from_resources"), &body)
            .await?;
        Ok(resp.actions)
    }
}
