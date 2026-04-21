use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct InterfaceManager;

impl InterfaceManager {
    pub async fn list(client: &PfsenseClient) -> PfsenseResult<Vec<NetworkInterface>> {
        let resp: ApiListResponse<NetworkInterface> = client.api_get("interface").await?;
        Ok(resp.data)
    }

    pub async fn get(client: &PfsenseClient, name: &str) -> PfsenseResult<NetworkInterface> {
        let resp: ApiResponse<NetworkInterface> =
            client.api_get(&format!("interface/{name}")).await?;
        Ok(resp.data)
    }

    pub async fn create(
        client: &PfsenseClient,
        iface: &InterfaceConfig,
    ) -> PfsenseResult<NetworkInterface> {
        let resp: ApiResponse<NetworkInterface> = client.api_post("interface", iface).await?;
        Ok(resp.data)
    }

    pub async fn update(
        client: &PfsenseClient,
        name: &str,
        iface: &InterfaceConfig,
    ) -> PfsenseResult<NetworkInterface> {
        let resp: ApiResponse<NetworkInterface> =
            client.api_put(&format!("interface/{name}"), iface).await?;
        Ok(resp.data)
    }

    pub async fn delete(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("interface/{name}")).await
    }

    pub async fn apply(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client
            .api_post("interface/apply", &serde_json::json!({}))
            .await
    }

    pub async fn get_stats(client: &PfsenseClient, name: &str) -> PfsenseResult<IfStats> {
        let resp: ApiResponse<IfStats> =
            client.api_get(&format!("status/interface/{name}")).await?;
        Ok(resp.data)
    }

    pub async fn list_stats(client: &PfsenseClient) -> PfsenseResult<Vec<IfStats>> {
        let resp: ApiListResponse<IfStats> = client.api_get("status/interface").await?;
        Ok(resp.data)
    }
}
