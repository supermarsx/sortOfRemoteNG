use crate::client::HetznerClient;
use crate::error::HetznerResult;
use crate::types::*;

pub struct NetworkManager;

impl NetworkManager {
    pub async fn list_networks(client: &HetznerClient) -> HetznerResult<Vec<HetznerNetwork>> {
        let resp: NetworksResponse = client.get("/networks").await?;
        Ok(resp.networks)
    }

    pub async fn get_network(client: &HetznerClient, id: u64) -> HetznerResult<HetznerNetwork> {
        let resp: NetworkResponse = client.get(&format!("/networks/{id}")).await?;
        Ok(resp.network)
    }

    pub async fn create_network(
        client: &HetznerClient,
        request: CreateNetworkRequest,
    ) -> HetznerResult<HetznerNetwork> {
        let body = serde_json::to_value(&request)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        let resp: NetworkResponse = client.post("/networks", &body).await?;
        Ok(resp.network)
    }

    pub async fn update_network(
        client: &HetznerClient,
        id: u64,
        name: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerNetwork> {
        let mut body = serde_json::json!({});
        if let Some(n) = name {
            body["name"] = serde_json::Value::String(n);
        }
        if let Some(l) = labels {
            body["labels"] = l;
        }
        let resp: NetworkResponse = client.put(&format!("/networks/{id}"), &body).await?;
        Ok(resp.network)
    }

    pub async fn delete_network(client: &HetznerClient, id: u64) -> HetznerResult<()> {
        client.delete_req(&format!("/networks/{id}")).await
    }

    pub async fn add_subnet(
        client: &HetznerClient,
        id: u64,
        subnet: HetznerSubnet,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::to_value(&subnet)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        client.post_action(&format!("/networks/{id}/actions/add_subnet"), &body).await
    }

    pub async fn delete_subnet(
        client: &HetznerClient,
        id: u64,
        ip_range: String,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({ "ip_range": ip_range });
        client.post_action(&format!("/networks/{id}/actions/delete_subnet"), &body).await
    }

    pub async fn add_route(
        client: &HetznerClient,
        id: u64,
        route: HetznerRoute,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::to_value(&route)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        client.post_action(&format!("/networks/{id}/actions/add_route"), &body).await
    }

    pub async fn delete_route(
        client: &HetznerClient,
        id: u64,
        route: HetznerRoute,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::to_value(&route)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        client.post_action(&format!("/networks/{id}/actions/delete_route"), &body).await
    }

    pub async fn change_ip_range(
        client: &HetznerClient,
        id: u64,
        ip_range: String,
    ) -> HetznerResult<HetznerAction> {
        let body = serde_json::json!({ "ip_range": ip_range });
        client.post_action(&format!("/networks/{id}/actions/change_ip_range"), &body).await
    }
}
