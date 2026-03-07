// ── Grafana snapshot management ──────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct SnapshotManager;

impl SnapshotManager {
    pub async fn list_snapshots(client: &GrafanaClient) -> GrafanaResult<Vec<GrafanaSnapshot>> {
        let body = client.api_get("/api/dashboard/snapshots").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_snapshots: {e}")))
    }

    pub async fn get_snapshot(client: &GrafanaClient, id: i64) -> GrafanaResult<GrafanaSnapshot> {
        let body = client.api_get(&format!("/api/dashboard/snapshots/{id}")).await
            .or_else(|_| client.api_get(&format!("/api/snapshots/{id}")))?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_snapshot: {e}")))
    }

    pub async fn create_snapshot(client: &GrafanaClient, req: &CreateSnapshotRequest) -> GrafanaResult<GrafanaSnapshot> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/snapshots", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_snapshot: {e}")))
    }

    pub async fn delete_snapshot(client: &GrafanaClient, id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/snapshots/{id}")).await?;
        Ok(())
    }

    pub async fn get_snapshot_by_key(client: &GrafanaClient, key: &str) -> GrafanaResult<GrafanaSnapshot> {
        let body = client.api_get(&format!("/api/snapshots/{key}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_snapshot_by_key: {e}")))
    }

    pub async fn delete_snapshot_by_key(client: &GrafanaClient, delete_key: &str) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/snapshots-delete/{delete_key}")).await?;
        Ok(())
    }
}
