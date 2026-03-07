use crate::client::PrometheusClient;
use crate::error::PrometheusResult;
use crate::types::*;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    #[allow(dead_code)]
    status: String,
    data: T,
}

pub struct StatusManager<'a> {
    client: &'a PrometheusClient,
}

impl<'a> StatusManager<'a> {
    pub fn new(client: &'a PrometheusClient) -> Self {
        Self { client }
    }

    pub async fn get_build_info(&self) -> PrometheusResult<PromBuildInfo> {
        let resp: ApiResponse<PromBuildInfo> = self.client.api_get("status/buildinfo").await?;
        Ok(resp.data)
    }

    pub async fn get_runtime_info(&self) -> PrometheusResult<PromRuntimeInfo> {
        let resp: ApiResponse<PromRuntimeInfo> = self.client.api_get("status/runtimeinfo").await?;
        Ok(resp.data)
    }

    pub async fn is_ready(&self) -> PrometheusResult<bool> {
        let url = {
            let cfg = self.client.config();
            format!("{}://{}:{}/-/ready", cfg.scheme, cfg.host, cfg.port)
        };
        // Use health check style request
        self.client.health_check().await
    }

    pub async fn is_healthy(&self) -> PrometheusResult<bool> {
        self.client.health_check().await
    }

    pub async fn get_flags(&self) -> PrometheusResult<serde_json::Value> {
        let resp: ApiResponse<serde_json::Value> = self.client.api_get("status/flags").await?;
        Ok(resp.data)
    }

    pub async fn get_config_reload_status(&self) -> PrometheusResult<serde_json::Value> {
        let resp: ApiResponse<serde_json::Value> =
            self.client.api_get("status/runtimeinfo").await?;
        let data = resp.data;
        let reload_success = data
            .get("reloadConfigSuccess")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let last_config_time = data
            .get("lastConfigTime")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        Ok(serde_json::json!({
            "reload_config_success": reload_success,
            "last_config_time": last_config_time,
        }))
    }
}
