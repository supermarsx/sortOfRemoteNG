// ── sorng-docker/src/system.rs ────────────────────────────────────────────────
//! Docker system-level operations (info, version, disk usage, prune, events).

use crate::client::DockerClient;
use crate::error::DockerResult;
use crate::types::*;
use std::collections::HashMap;

pub struct SystemManager;

impl SystemManager {
    /// Get Docker daemon info.
    pub async fn info(client: &DockerClient) -> DockerResult<DockerSystemInfo> {
        client.info().await
    }

    /// Get Docker daemon version.
    pub async fn version(client: &DockerClient) -> DockerResult<DockerVersionInfo> {
        client.version().await
    }

    /// Ping the daemon.
    pub async fn ping(client: &DockerClient) -> DockerResult<bool> {
        client.ping().await
    }

    /// Get disk usage information.
    pub async fn disk_usage(client: &DockerClient) -> DockerResult<DockerDiskUsage> {
        let raw: serde_json::Value = client.get("/system/df").await?;

        let images_count = raw.get("Images").and_then(|v| v.as_array()).map(|a| a.len() as i32).unwrap_or(0);
        let images_size: i64 = raw.get("Images").and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|i| i.get("Size").and_then(|s| s.as_i64())).sum())
            .unwrap_or(0);

        let containers = raw.get("Containers").and_then(|v| v.as_array());
        let containers_count = containers.map(|a| a.len() as i32).unwrap_or(0);
        let containers_size: i64 = containers
            .map(|arr| arr.iter().filter_map(|c| c.get("SizeRw").and_then(|s| s.as_i64())).sum())
            .unwrap_or(0);

        let volumes = raw.get("Volumes").and_then(|v| v.as_array());
        let volumes_count = volumes.map(|a| a.len() as i32).unwrap_or(0);
        let volumes_size: i64 = volumes
            .map(|arr| arr.iter().filter_map(|v| {
                v.get("UsageData").and_then(|u| u.get("Size")).and_then(|s| s.as_i64())
            }).sum())
            .unwrap_or(0);

        let build_cache_size: i64 = raw.get("BuildCache").and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.get("Size").and_then(|s| s.as_i64())).sum())
            .unwrap_or(0);

        Ok(DockerDiskUsage {
            images_count,
            images_size,
            containers_count,
            containers_size,
            volumes_count,
            volumes_size,
            build_cache_size,
            total_size: images_size + containers_size + volumes_size + build_cache_size,
        })
    }

    /// Get docker daemon events (one-shot snapshot with since/until).
    pub async fn events(client: &DockerClient, filter: &DockerEventFilter) -> DockerResult<Vec<DockerEvent>> {
        let mut q = Vec::new();
        if let Some(ref since) = filter.since { q.push(("since", since.clone())); }
        if let Some(ref until) = filter.until { q.push(("until", until.clone())); }
        if let Some(ref f) = filter.filters {
            q.push(("filters", serde_json::to_string(f).unwrap_or_default()));
        }
        let path = if q.is_empty() {
            "/events".to_string()
        } else {
            let qs: Vec<String> = q.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
            format!("/events?{}", qs.join("&"))
        };
        // Docker events endpoint streams. For a non-streaming call we need `until`.
        // If neither since nor until is set, this would block. We return what we can parse.
        let text = client.get_text(&path).await?;
        let events: Vec<DockerEvent> = text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        Ok(events)
    }

    /// Prune everything (containers, images, networks, volumes, build cache).
    pub async fn system_prune(client: &DockerClient, all: bool, volumes: bool) -> DockerResult<PruneResult> {
        let mut q = Vec::new();
        if all { q.push(("all", "true")); }
        if volumes { q.push(("volumes", "true")); }
        let path = if q.is_empty() {
            "/system/prune".to_string()
        } else {
            let qs: Vec<String> = q.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
            format!("/system/prune?{}", qs.join("&"))
        };
        let resp: serde_json::Value = client.post_json(&path, &serde_json::json!({})).await?;
        let space = resp.get("SpaceReclaimed").and_then(|v| v.as_i64()).unwrap_or(0);
        Ok(PruneResult {
            deleted_items: vec!["system prune executed".to_string()],
            space_reclaimed: space,
        })
    }
}
