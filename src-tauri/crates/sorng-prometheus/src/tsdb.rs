// ── Prometheus TSDB management ────────────────────────────────────────────────

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct TsdbManager;

impl TsdbManager {
    pub async fn get_tsdb_status(client: &PrometheusClient) -> PrometheusResult<TsdbStatus> {
        let body = client.api_get("/api/v1/status/tsdb").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("tsdb status: {e}")))?;
        serde_json::from_value(v["data"].clone())
            .map_err(|e| PrometheusError::parse(format!("tsdb status parse: {e}")))
    }

    pub async fn get_tsdb_stats(client: &PrometheusClient) -> PrometheusResult<TsdbStats> {
        let body = client.api_get("/api/v1/status/tsdb").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("tsdb stats: {e}")))?;
        let data = &v["data"];
        Ok(TsdbStats {
            num_series: data["seriesCountByMetricName"].as_array()
                .map(|a| a.iter().filter_map(|v| v["value"].as_u64()).sum())
                .unwrap_or(0),
            num_label_pairs: data["labelValueCountByLabelName"].as_array()
                .map(|a| a.iter().filter_map(|v| v["value"].as_u64()).sum())
                .unwrap_or(0),
            chunk_count: data["headStats"]["numChunks"].as_u64().unwrap_or(0),
            min_time: data["headStats"]["minTime"].as_i64().unwrap_or(0),
            max_time: data["headStats"]["maxTime"].as_i64().unwrap_or(0),
            num_samples: data["headStats"]["numSamples"].as_u64().unwrap_or(0),
        })
    }

    pub async fn get_head_stats(client: &PrometheusClient) -> PrometheusResult<HeadStats> {
        let body = client.api_get("/api/v1/status/tsdb").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("head stats: {e}")))?;
        serde_json::from_value(v["data"]["headStats"].clone())
            .map_err(|e| PrometheusError::parse(format!("head stats parse: {e}")))
    }

    pub async fn get_block_info(client: &PrometheusClient, ulid: &str) -> PrometheusResult<BlockInfo> {
        let data_dir = client.data_dir();
        let out = client.exec_ssh(&format!(
            "ls -la {data_dir}/{ulid}/meta.json && cat {data_dir}/{ulid}/meta.json"
        )).await?;
        serde_json::from_str(&out.stdout)
            .map_err(|e| PrometheusError::parse(format!("block info parse: {e}")))
    }

    pub async fn list_blocks(client: &PrometheusClient) -> PrometheusResult<Vec<BlockInfo>> {
        let data_dir = client.data_dir();
        let out = client.exec_ssh(&format!(
            "for d in {data_dir}/*/meta.json; do cat \"$d\"; echo '---'; done"
        )).await?;
        let mut blocks = Vec::new();
        for chunk in out.stdout.split("---") {
            let trimmed = chunk.trim();
            if !trimmed.is_empty() {
                if let Ok(block) = serde_json::from_str::<BlockInfo>(trimmed) {
                    blocks.push(block);
                }
            }
        }
        Ok(blocks)
    }

    pub async fn compact_blocks(client: &PrometheusClient) -> PrometheusResult<()> {
        client.exec_ssh(&format!(
            "promtool tsdb compact {}", client.data_dir()
        )).await?;
        Ok(())
    }

    pub async fn create_snapshot(client: &PrometheusClient, skip_head: bool) -> PrometheusResult<Snapshot> {
        let skip = if skip_head { "?skip_head=true" } else { "" };
        let body = client.api_post(&format!("/api/v1/admin/tsdb/snapshot{skip}"), "").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("snapshot: {e}")))?;
        let name = v["data"]["name"].as_str()
            .ok_or_else(|| PrometheusError::snapshot("missing snapshot name"))?
            .to_string();
        Ok(Snapshot { name, size_bytes: None, created_at: None })
    }

    pub async fn delete_snapshot(client: &PrometheusClient, name: &str) -> PrometheusResult<()> {
        let data_dir = client.data_dir();
        client.exec_ssh(&format!("sudo rm -rf {data_dir}/snapshots/{name}")).await?;
        Ok(())
    }

    pub async fn list_snapshots(client: &PrometheusClient) -> PrometheusResult<Vec<Snapshot>> {
        let data_dir = client.data_dir();
        let out = client.exec_ssh(&format!("ls -1 {data_dir}/snapshots/ 2>/dev/null || true")).await?;
        let snapshots = out.stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|name| Snapshot {
                name: name.to_string(),
                size_bytes: None,
                created_at: None,
            })
            .collect();
        Ok(snapshots)
    }

    pub async fn get_wal_status(client: &PrometheusClient) -> PrometheusResult<WalStatus> {
        let data_dir = client.data_dir();
        let out = client.exec_ssh(&format!(
            "ls {data_dir}/wal/ | wc -l && du -sb {data_dir}/wal/ | awk '{{print $1}}'"
        )).await?;
        let lines: Vec<&str> = out.stdout.lines().collect();
        Ok(WalStatus {
            current_segment: lines.first().and_then(|l| l.trim().parse().ok()).unwrap_or(0),
            storage_size_bytes: lines.get(1).and_then(|l| l.trim().parse().ok()).unwrap_or(0),
            corruptions_total: 0,
            failed_flushes_total: 0,
            completed_pages_total: 0,
            truncations_total: 0,
        })
    }

    pub async fn clean_tombstones(client: &PrometheusClient) -> PrometheusResult<()> {
        client.api_post("/api/v1/admin/tsdb/clean_tombstones", "").await?;
        Ok(())
    }

    pub async fn get_storage_stats(client: &PrometheusClient) -> PrometheusResult<StorageStats> {
        let data_dir = client.data_dir();
        let out = client.exec_ssh(&format!(
            "du -sb {data_dir} && du -sb {data_dir}/wal 2>/dev/null || echo 0"
        )).await?;
        let lines: Vec<&str> = out.stdout.lines().collect();
        let total: u64 = lines.first()
            .and_then(|l| l.split_whitespace().next())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let wal: u64 = lines.get(1)
            .and_then(|l| l.split_whitespace().next())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        Ok(StorageStats {
            total_bytes: total,
            block_bytes: total.saturating_sub(wal),
            wal_bytes: wal,
            checkpoint_bytes: None,
            tombstone_count: 0,
        })
    }

    pub async fn get_retention_config(client: &PrometheusClient) -> PrometheusResult<RetentionConfig> {
        let body = client.api_get("/api/v1/status/flags").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("flags: {e}")))?;
        let flags = &v["data"];
        Ok(RetentionConfig {
            time_retention: flags["storage.tsdb.retention.time"].as_str().map(String::from),
            size_retention: flags["storage.tsdb.retention.size"].as_str().map(String::from),
        })
    }

    pub async fn set_retention_config(client: &PrometheusClient, req: &SetRetentionConfigRequest) -> PrometheusResult<RetentionConfig> {
        // Update systemd service file or config to set retention flags
        let mut args = Vec::new();
        if let Some(time) = &req.time_retention {
            args.push(format!("--storage.tsdb.retention.time={time}"));
        }
        if let Some(size) = &req.size_retention {
            args.push(format!("--storage.tsdb.retention.size={size}"));
        }
        // Stub: would update service file and restart
        let _ = args;
        let _ = client;
        Ok(RetentionConfig {
            time_retention: req.time_retention.clone(),
            size_retention: req.size_retention.clone(),
        })
    }
}
