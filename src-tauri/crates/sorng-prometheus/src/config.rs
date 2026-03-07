// ── Prometheus config/runtime management ─────────────────────────────────────

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct ConfigManager;

impl ConfigManager {
    pub async fn get_config(client: &PrometheusClient) -> PrometheusResult<PrometheusConfig> {
        let body = client.api_get("/api/v1/status/config").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("config: {e}")))?;
        let yaml = v["data"]["yaml"].as_str()
            .ok_or_else(|| PrometheusError::parse("missing config yaml"))?
            .to_string();
        Ok(PrometheusConfig {
            yaml,
            loaded_config_file: Some(client.config_path().to_string()),
        })
    }

    pub async fn reload_config(client: &PrometheusClient) -> PrometheusResult<()> {
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn validate_config(client: &PrometheusClient, req: &ValidateConfigRequest) -> PrometheusResult<bool> {
        let tmp = "/tmp/prom_config_check.yml";
        client.write_remote_file(tmp, &req.config_yaml).await?;
        let out = client.exec_ssh(&format!("promtool check config {tmp}")).await?;
        let _ = client.exec_ssh(&format!("rm -f {tmp}")).await;
        Ok(out.exit_code == 0)
    }

    pub async fn get_flags(client: &PrometheusClient) -> PrometheusResult<PrometheusFlags> {
        let body = client.api_get("/api/v1/status/flags").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("flags: {e}")))?;
        let data = v["data"].as_object()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        let flags = data.iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
            .collect();
        Ok(PrometheusFlags { flags })
    }

    pub async fn get_runtime_info(client: &PrometheusClient) -> PrometheusResult<RuntimeInfo> {
        let body = client.api_get("/api/v1/status/runtimeinfo").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("runtime info: {e}")))?;
        serde_json::from_value(v["data"].clone())
            .map_err(|e| PrometheusError::parse(format!("runtime info parse: {e}")))
    }

    pub async fn get_build_info(client: &PrometheusClient) -> PrometheusResult<BuildInfo> {
        let body = client.api_get("/api/v1/status/buildinfo").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("build info: {e}")))?;
        serde_json::from_value(v["data"].clone())
            .map_err(|e| PrometheusError::parse(format!("build info parse: {e}")))
    }

    pub async fn check_health(client: &PrometheusClient) -> PrometheusResult<HealthStatus> {
        let healthy = client.api_get("/-/healthy").await.is_ok();
        let ready = client.api_get("/-/ready").await.is_ok();
        Ok(HealthStatus {
            healthy,
            ready,
            started: healthy,
        })
    }

    pub async fn get_readiness(client: &PrometheusClient) -> PrometheusResult<bool> {
        Ok(client.api_get("/-/ready").await.is_ok())
    }

    pub async fn get_startup_status(client: &PrometheusClient) -> PrometheusResult<bool> {
        Ok(client.api_get("/-/healthy").await.is_ok())
    }

    pub async fn get_lifecycle_status(client: &PrometheusClient) -> PrometheusResult<HealthStatus> {
        Self::check_health(client).await
    }
}
