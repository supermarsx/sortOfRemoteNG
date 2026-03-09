// ── sorng-grafana/src/snapshots.rs ───────────────────────────────────────────
//! Snapshot management via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct SnapshotManager;

impl SnapshotManager {
    /// List snapshots.  GET /api/dashboard/snapshots
    pub async fn list(client: &GrafanaClient) -> GrafanaResult<Vec<Snapshot>> {
        client.api_get("dashboard/snapshots").await
    }

    /// Create a snapshot.  POST /api/snapshots
    pub async fn create(
        client: &GrafanaClient,
        dashboard: &serde_json::Value,
        name: Option<&str>,
        expires: Option<u64>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({ "dashboard": dashboard });
        if let Some(n) = name {
            body["name"] = serde_json::json!(n);
        }
        if let Some(e) = expires {
            body["expires"] = serde_json::json!(e);
        }
        client.api_post("snapshots", &body).await
    }

    /// Get snapshot by key.  GET /api/snapshots/:key
    pub async fn get_by_key(client: &GrafanaClient, key: &str) -> GrafanaResult<Snapshot> {
        client.api_get(&format!("snapshots/{key}")).await
    }

    /// Delete snapshot by key.  DELETE /api/snapshots/:key
    pub async fn delete_by_key(
        client: &GrafanaClient,
        key: &str,
    ) -> GrafanaResult<serde_json::Value> {
        client.api_delete(&format!("snapshots/{key}")).await
    }

    /// Delete snapshot by delete-key.  GET /api/snapshots-delete/:deleteKey
    pub async fn delete_by_delete_key(
        client: &GrafanaClient,
        delete_key: &str,
    ) -> GrafanaResult<serde_json::Value> {
        client
            .api_get(&format!("snapshots-delete/{delete_key}"))
            .await
    }
}
