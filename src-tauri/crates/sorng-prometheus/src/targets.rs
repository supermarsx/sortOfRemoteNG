// ── Prometheus target management ─────────────────────────────────────────────

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct TargetManager;

impl TargetManager {
    pub async fn list_targets(client: &PrometheusClient) -> PrometheusResult<Vec<Target>> {
        let body = client.api_get("/api/v1/targets").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("targets response: {e}")))?;
        let active = v["data"]["activeTargets"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing activeTargets"))?;
        let mut targets = Vec::new();
        for t in active {
            targets.push(serde_json::from_value(t.clone())
                .map_err(|e| PrometheusError::parse(format!("target parse: {e}")))?);
        }
        Ok(targets)
    }

    pub async fn get_target_metadata(client: &PrometheusClient, match_target: Option<&str>, metric: Option<&str>) -> PrometheusResult<Vec<TargetMetadata>> {
        let mut endpoint = "/api/v1/targets/metadata?".to_string();
        if let Some(mt) = match_target {
            endpoint.push_str(&format!("match_target={mt}&"));
        }
        if let Some(m) = metric {
            endpoint.push_str(&format!("metric={m}&"));
        }
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("target metadata: {e}")))?;
        let data = v["data"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        let mut result = Vec::new();
        for item in data {
            result.push(serde_json::from_value(item.clone())
                .map_err(|e| PrometheusError::parse(format!("metadata parse: {e}")))?);
        }
        Ok(result)
    }

    pub async fn get_target_health(client: &PrometheusClient) -> PrometheusResult<Vec<TargetHealth>> {
        let body = client.api_get("/api/v1/targets").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("targets health: {e}")))?;
        let active = v["data"]["activeTargets"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing activeTargets"))?;
        let mut health = Vec::new();
        for t in active {
            health.push(serde_json::from_value(t.clone())
                .map_err(|e| PrometheusError::parse(format!("target health parse: {e}")))?);
        }
        Ok(health)
    }

    pub async fn list_service_discovery(client: &PrometheusClient) -> PrometheusResult<Vec<ServiceDiscovery>> {
        let body = client.api_get("/api/v1/targets").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("service discovery: {e}")))?;
        let data = v["data"]["activeTargets"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        let mut result = Vec::new();
        for item in data {
            result.push(serde_json::from_value(item.clone())
                .map_err(|e| PrometheusError::parse(format!("sd parse: {e}")))?);
        }
        Ok(result)
    }

    pub async fn add_static_target(client: &PrometheusClient, req: &AddStaticTargetRequest) -> PrometheusResult<()> {
        // Read current config, add static target, write back, reload
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = append_static_target_to_config(&config, req);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn remove_static_target(client: &PrometheusClient, job: &str, instance: &str) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = remove_static_target_from_config(&config, job, instance);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn list_dropped_targets(client: &PrometheusClient) -> PrometheusResult<Vec<DroppedTarget>> {
        let body = client.api_get("/api/v1/targets").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("dropped targets: {e}")))?;
        let dropped = v["data"]["droppedTargets"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing droppedTargets"))?;
        let mut result = Vec::new();
        for t in dropped {
            result.push(serde_json::from_value(t.clone())
                .map_err(|e| PrometheusError::parse(format!("dropped target parse: {e}")))?);
        }
        Ok(result)
    }

    pub async fn get_target_labels(client: &PrometheusClient, match_target: &str) -> PrometheusResult<Vec<TargetMetadata>> {
        let endpoint = format!("/api/v1/targets/metadata?match_target={match_target}");
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("target labels: {e}")))?;
        let data = v["data"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        let mut result = Vec::new();
        for item in data {
            result.push(serde_json::from_value(item.clone())
                .map_err(|e| PrometheusError::parse(format!("labels parse: {e}")))?);
        }
        Ok(result)
    }

    pub async fn relabel_target(client: &PrometheusClient, req: &RelabelTargetRequest) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = apply_relabel_to_config(&config, req);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }
}

// ── Config helpers (stub) ────────────────────────────────────────────────────

fn append_static_target_to_config(config: &str, req: &AddStaticTargetRequest) -> String {
    let mut result = config.to_string();
    let targets_str: String = req.targets.iter()
        .map(|t| format!("'{t}'"))
        .collect::<Vec<_>>()
        .join(", ");
    result.push_str(&format!(
        "\n  - job_name: '{}'\n    static_configs:\n      - targets: [{}]\n",
        req.job, targets_str
    ));
    result
}

fn remove_static_target_from_config(config: &str, _job: &str, _instance: &str) -> String {
    // Stub: real implementation would parse YAML and remove matching target
    config.to_string()
}

fn apply_relabel_to_config(config: &str, _req: &RelabelTargetRequest) -> String {
    // Stub: real implementation would parse YAML and add relabel config
    config.to_string()
}
