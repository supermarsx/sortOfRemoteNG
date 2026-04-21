use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct ServiceManager;

impl ServiceManager {
    pub async fn list(client: &PfsenseClient) -> PfsenseResult<Vec<PfsenseService>> {
        let resp: ApiListResponse<PfsenseService> = client.api_get("status/service").await?;
        Ok(resp.data)
    }

    pub async fn get_status(client: &PfsenseClient, name: &str) -> PfsenseResult<ServiceStatus> {
        let resp: ApiResponse<ServiceStatus> =
            client.api_get(&format!("status/service/{name}")).await?;
        Ok(resp.data)
    }

    pub async fn start(client: &PfsenseClient, name: &str) -> PfsenseResult<serde_json::Value> {
        client
            .api_post(
                &format!("status/service/{name}/start"),
                &serde_json::json!({}),
            )
            .await
    }

    pub async fn stop(client: &PfsenseClient, name: &str) -> PfsenseResult<serde_json::Value> {
        client
            .api_post(
                &format!("status/service/{name}/stop"),
                &serde_json::json!({}),
            )
            .await
    }

    pub async fn restart(client: &PfsenseClient, name: &str) -> PfsenseResult<serde_json::Value> {
        client
            .api_post(
                &format!("status/service/{name}/restart"),
                &serde_json::json!({}),
            )
            .await
    }
}
