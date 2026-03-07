// ── Prometheus federation management ─────────────────────────────────────────

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct FederationManager;

impl FederationManager {
    pub async fn list_federation_targets(client: &PrometheusClient) -> PrometheusResult<Vec<FederationTarget>> {
        let config = client.read_remote_file(client.config_path()).await?;
        parse_federation_targets(&config)
    }

    pub async fn add_federation_target(client: &PrometheusClient, req: &AddFederationTargetRequest) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = append_federation_target(&config, &req.target);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn remove_federation_target(client: &PrometheusClient, name: &str) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = remove_federation_target_from_config(&config, name);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn get_federation_metrics(client: &PrometheusClient, matchers: &[String]) -> PrometheusResult<String> {
        let params = matchers.iter()
            .map(|m| format!("match[]={m}"))
            .collect::<Vec<_>>()
            .join("&");
        let endpoint = format!("/federate?{params}");
        client.api_get(&endpoint).await
    }

    pub async fn list_remote_read_configs(client: &PrometheusClient) -> PrometheusResult<Vec<RemoteReadConfig>> {
        let config = client.read_remote_file(client.config_path()).await?;
        parse_remote_read_configs(&config)
    }

    pub async fn add_remote_read(client: &PrometheusClient, req: &AddRemoteReadRequest) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = append_remote_read(&config, &req.config);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn remove_remote_read(client: &PrometheusClient, url: &str) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = remove_remote_read_from_config(&config, url);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn list_remote_write_configs(client: &PrometheusClient) -> PrometheusResult<Vec<RemoteWriteConfig>> {
        let config = client.read_remote_file(client.config_path()).await?;
        parse_remote_write_configs(&config)
    }

    pub async fn add_remote_write(client: &PrometheusClient, req: &AddRemoteWriteRequest) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = append_remote_write(&config, &req.config);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn remove_remote_write(client: &PrometheusClient, url: &str) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = remove_remote_write_from_config(&config, url);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn get_remote_write_stats(client: &PrometheusClient) -> PrometheusResult<Vec<RemoteWriteStats>> {
        // Query internal metrics for remote write stats
        let body = client.api_get("/api/v1/query?query=prometheus_remote_storage_sent_batch_duration_seconds_count").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("remote write stats: {e}")))?;
        let results = v["data"]["result"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing results"))?;
        let mut stats = Vec::new();
        for r in results {
            let labels = r["metric"].as_object().cloned().unwrap_or_default();
            stats.push(RemoteWriteStats {
                name: labels.get("remote_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                url: labels.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                samples_total: 0,
                failed_samples_total: 0,
                retried_samples_total: 0,
                enqueue_retries_total: 0,
                sent_bytes_total: 0,
                highest_sent_timestamp: None,
                pending_samples: 0,
                shard_count: 0,
            });
        }
        Ok(stats)
    }
}

// ── Config helpers (stub) ────────────────────────────────────────────────────

fn parse_federation_targets(_config: &str) -> PrometheusResult<Vec<FederationTarget>> {
    Ok(Vec::new())
}

fn append_federation_target(config: &str, _target: &FederationTarget) -> String {
    config.to_string()
}

fn remove_federation_target_from_config(config: &str, _name: &str) -> String {
    config.to_string()
}

fn parse_remote_read_configs(_config: &str) -> PrometheusResult<Vec<RemoteReadConfig>> {
    Ok(Vec::new())
}

fn append_remote_read(config: &str, _rc: &RemoteReadConfig) -> String {
    config.to_string()
}

fn remove_remote_read_from_config(config: &str, _url: &str) -> String {
    config.to_string()
}

fn parse_remote_write_configs(_config: &str) -> PrometheusResult<Vec<RemoteWriteConfig>> {
    Ok(Vec::new())
}

fn append_remote_write(config: &str, _wc: &RemoteWriteConfig) -> String {
    config.to_string()
}

fn remove_remote_write_from_config(config: &str, _url: &str) -> String {
    config.to_string()
}
