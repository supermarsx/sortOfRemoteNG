// ── sorng-grafana/src/folders.rs ─────────────────────────────────────────────
//! Folder management via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct FolderManager;

impl FolderManager {
    /// List all folders.  GET /api/folders
    pub async fn list(client: &GrafanaClient) -> GrafanaResult<Vec<Folder>> {
        client.api_get("folders").await
    }

    /// Get folder by UID.  GET /api/folders/:uid
    pub async fn get_by_uid(client: &GrafanaClient, uid: &str) -> GrafanaResult<Folder> {
        client.api_get(&format!("folders/{uid}")).await
    }

    /// Create a folder.  POST /api/folders
    pub async fn create(
        client: &GrafanaClient,
        uid: Option<&str>,
        title: &str,
    ) -> GrafanaResult<Folder> {
        let mut body = serde_json::json!({ "title": title });
        if let Some(u) = uid {
            body["uid"] = serde_json::Value::String(u.to_string());
        }
        client.api_post("folders", &body).await
    }

    /// Update a folder.  PUT /api/folders/:uid
    pub async fn update(
        client: &GrafanaClient,
        uid: &str,
        title: &str,
        version: Option<u64>,
    ) -> GrafanaResult<Folder> {
        let mut body = serde_json::json!({ "title": title });
        if let Some(v) = version {
            body["version"] = serde_json::json!(v);
        }
        client.api_put(&format!("folders/{uid}"), &body).await
    }

    /// Delete folder by UID.  DELETE /api/folders/:uid
    pub async fn delete_by_uid(
        client: &GrafanaClient,
        uid: &str,
    ) -> GrafanaResult<serde_json::Value> {
        client.api_delete(&format!("folders/{uid}")).await
    }

    /// Get folder permissions.  GET /api/folders/:uid/permissions
    pub async fn get_permissions(
        client: &GrafanaClient,
        uid: &str,
    ) -> GrafanaResult<serde_json::Value> {
        client.api_get(&format!("folders/{uid}/permissions")).await
    }

    /// Update folder permissions.  POST /api/folders/:uid/permissions
    pub async fn update_permissions(
        client: &GrafanaClient,
        uid: &str,
        permissions: &serde_json::Value,
    ) -> GrafanaResult<serde_json::Value> {
        client
            .api_post(&format!("folders/{uid}/permissions"), permissions)
            .await
    }
}
