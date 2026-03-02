// ── sorng-docker/src/volumes.rs ───────────────────────────────────────────────
//! Docker volume management.

use crate::client::DockerClient;
use crate::error::DockerResult;
use crate::types::*;
use std::collections::HashMap;

pub struct VolumeManager;

impl VolumeManager {
    /// List volumes.
    pub async fn list(client: &DockerClient, opts: &ListVolumesOptions) -> DockerResult<Vec<VolumeInfo>> {
        let path = if let Some(ref f) = opts.filters {
            let fs = serde_json::to_string(f).unwrap_or_default();
            format!("/volumes?filters={}", fs)
        } else {
            "/volumes".to_string()
        };
        let resp: serde_json::Value = client.get(&path).await?;
        let volumes = resp.get("Volumes")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
            .unwrap_or_default();
        Ok(volumes)
    }

    /// Inspect a volume.
    pub async fn inspect(client: &DockerClient, name: &str) -> DockerResult<VolumeInfo> {
        client.get(&format!("/volumes/{}", name)).await
    }

    /// Create a volume.
    pub async fn create(client: &DockerClient, config: &CreateVolumeConfig) -> DockerResult<VolumeInfo> {
        client.post_json("/volumes/create", config).await
    }

    /// Remove a volume.
    pub async fn remove(client: &DockerClient, name: &str, force: bool) -> DockerResult<()> {
        if force {
            client.delete(&format!("/volumes/{}?force=true", name)).await
        } else {
            client.delete(&format!("/volumes/{}", name)).await
        }
    }

    /// Prune unused volumes.
    pub async fn prune(client: &DockerClient, filters: Option<&HashMap<String, Vec<String>>>) -> DockerResult<PruneResult> {
        let path = if let Some(f) = filters {
            let fs = serde_json::to_string(f).unwrap_or_default();
            format!("/volumes/prune?filters={}", fs)
        } else {
            "/volumes/prune".to_string()
        };
        let resp: serde_json::Value = client.post_json(&path, &serde_json::json!({})).await?;
        let deleted = resp.get("VolumesDeleted")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let space = resp.get("SpaceReclaimed").and_then(|v| v.as_i64()).unwrap_or(0);
        Ok(PruneResult { deleted_items: deleted, space_reclaimed: space })
    }
}
