use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct SystemManager;

impl SystemManager {
    pub async fn get_info(client: &PfsenseClient) -> PfsenseResult<SystemInfo> {
        let resp: ApiResponse<SystemInfo> = client.api_get("status/system").await?;
        Ok(resp.data)
    }

    pub async fn get_updates(client: &PfsenseClient) -> PfsenseResult<SystemUpdate> {
        let resp: ApiResponse<SystemUpdate> = client.api_get("system/update").await?;
        Ok(resp.data)
    }

    pub async fn get_general_config(client: &PfsenseClient) -> PfsenseResult<GeneralConfig> {
        let resp: ApiResponse<GeneralConfig> = client.api_get("system/config").await?;
        Ok(resp.data)
    }

    pub async fn update_general_config(client: &PfsenseClient, config: &GeneralConfig) -> PfsenseResult<GeneralConfig> {
        let resp: ApiResponse<GeneralConfig> = client.api_put("system/config", config).await?;
        Ok(resp.data)
    }

    pub async fn get_advanced_config(client: &PfsenseClient) -> PfsenseResult<AdvancedConfig> {
        let resp: ApiResponse<AdvancedConfig> = client.api_get("system/advanced").await?;
        Ok(resp.data)
    }

    pub async fn update_advanced_config(client: &PfsenseClient, config: &AdvancedConfig) -> PfsenseResult<AdvancedConfig> {
        let resp: ApiResponse<AdvancedConfig> = client.api_put("system/advanced", config).await?;
        Ok(resp.data)
    }

    pub async fn reboot(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client.api_post("system/reboot", &serde_json::json!({})).await
    }

    pub async fn halt(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client.api_post("system/halt", &serde_json::json!({})).await
    }

    pub async fn get_hostname(client: &PfsenseClient) -> PfsenseResult<String> {
        let info = Self::get_info(client).await?;
        Ok(format!("{}.{}", info.hostname, info.domain))
    }
}
