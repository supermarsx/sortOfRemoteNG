// ── Prometheus scrape configuration management ──────────────────────────────

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct ScrapeManager;

impl ScrapeManager {
    pub async fn list_scrape_configs(client: &PrometheusClient) -> PrometheusResult<Vec<ScrapeConfig>> {
        let body = client.api_get("/api/v1/status/config").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("scrape configs: {e}")))?;
        let yaml_str = v["data"]["yaml"].as_str()
            .ok_or_else(|| PrometheusError::parse("missing config yaml"))?;
        parse_scrape_configs_from_yaml(yaml_str)
    }

    pub async fn get_scrape_config(client: &PrometheusClient, job_name: &str) -> PrometheusResult<ScrapeConfig> {
        let configs = Self::list_scrape_configs(client).await?;
        configs.into_iter()
            .find(|c| c.job_name == job_name)
            .ok_or_else(|| PrometheusError::parse(format!("scrape config not found: {job_name}")))
    }

    pub async fn add_scrape_config(client: &PrometheusClient, req: &AddScrapeConfigRequest) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = append_scrape_config(&config, &req.config);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn update_scrape_config(client: &PrometheusClient, job_name: &str, req: &UpdateScrapeConfigRequest) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = replace_scrape_config(&config, job_name, &req.config);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn remove_scrape_config(client: &PrometheusClient, job_name: &str) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = remove_scrape_config_from_yaml(&config, job_name);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn get_scrape_pools(client: &PrometheusClient) -> PrometheusResult<Vec<ScrapePool>> {
        let body = client.api_get("/api/v1/scrape_pools").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("scrape pools: {e}")))?;
        let data = v["data"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        let mut pools = Vec::new();
        for item in data {
            pools.push(serde_json::from_value(item.clone())
                .map_err(|e| PrometheusError::parse(format!("pool parse: {e}")))?);
        }
        Ok(pools)
    }

    pub async fn get_scrape_metrics(client: &PrometheusClient, job_name: &str) -> PrometheusResult<Vec<String>> {
        let endpoint = format!("/api/v1/targets/metadata?match_target={{job=\"{job_name}\"}}");
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("scrape metrics: {e}")))?;
        let data = v["data"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        let names: Vec<String> = data.iter()
            .filter_map(|item| item["metric"].as_str().map(String::from))
            .collect();
        Ok(names)
    }

    pub async fn list_scrape_jobs(client: &PrometheusClient) -> PrometheusResult<Vec<ScrapeJob>> {
        let body = client.api_get("/api/v1/targets").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("scrape jobs: {e}")))?;
        let active = v["data"]["activeTargets"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing activeTargets"))?;
        let mut jobs_map = std::collections::HashMap::new();
        for t in active {
            let job_name = t["labels"]["job"].as_str().unwrap_or("unknown").to_string();
            let entry = jobs_map.entry(job_name.clone()).or_insert_with(|| ScrapeJob {
                job_name: job_name.clone(),
                health: "up".to_string(),
                target_count: 0,
                scrape_interval: t["scrapeInterval"].as_str().unwrap_or("15s").to_string(),
                scrape_timeout: t["scrapeTimeout"].as_str().unwrap_or("10s").to_string(),
                last_scrape: t["lastScrape"].as_str().map(String::from),
            });
            entry.target_count += 1;
            if t["health"].as_str() == Some("down") {
                entry.health = "down".to_string();
            }
        }
        Ok(jobs_map.into_values().collect())
    }

    pub async fn get_job_targets(client: &PrometheusClient, job_name: &str) -> PrometheusResult<Vec<Target>> {
        let body = client.api_get("/api/v1/targets").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("job targets: {e}")))?;
        let active = v["data"]["activeTargets"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing activeTargets"))?;
        let mut targets = Vec::new();
        for t in active {
            if t["labels"]["job"].as_str() == Some(job_name) {
                targets.push(serde_json::from_value(t.clone())
                    .map_err(|e| PrometheusError::parse(format!("target parse: {e}")))?);
            }
        }
        Ok(targets)
    }

    pub async fn set_scrape_interval(client: &PrometheusClient, req: &SetScrapeIntervalRequest) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = update_scrape_interval(&config, &req.job_name, &req.interval);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn get_scrape_stats(client: &PrometheusClient, job_name: &str) -> PrometheusResult<ScrapeStats> {
        let body = client.api_get("/api/v1/targets").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("scrape stats: {e}")))?;
        let active = v["data"]["activeTargets"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing activeTargets"))?;
        let mut total = 0u64;
        let mut failed = 0u64;
        let mut durations = Vec::new();
        for t in active {
            if t["labels"]["job"].as_str() == Some(job_name) {
                total += 1;
                if t["health"].as_str() == Some("down") {
                    failed += 1;
                }
                if let Some(d) = t["lastScrapeDuration"].as_f64() {
                    durations.push(d);
                }
            }
        }
        let avg = if durations.is_empty() { 0.0 } else { durations.iter().sum::<f64>() / durations.len() as f64 };
        Ok(ScrapeStats {
            job: job_name.to_string(),
            total_scrapes: total,
            failed_scrapes: failed,
            avg_duration_seconds: avg,
            last_scrape_duration: durations.last().copied(),
            samples_scraped: None,
        })
    }
}

// ── Config helpers (stub) ────────────────────────────────────────────────────

fn parse_scrape_configs_from_yaml(_yaml: &str) -> PrometheusResult<Vec<ScrapeConfig>> {
    // Stub: real implementation would parse YAML
    Ok(Vec::new())
}

fn append_scrape_config(config: &str, _sc: &ScrapeConfig) -> String {
    config.to_string()
}

fn replace_scrape_config(config: &str, _job_name: &str, _sc: &ScrapeConfig) -> String {
    config.to_string()
}

fn remove_scrape_config_from_yaml(config: &str, _job_name: &str) -> String {
    config.to_string()
}

fn update_scrape_interval(config: &str, _job_name: &str, _interval: &str) -> String {
    config.to_string()
}
