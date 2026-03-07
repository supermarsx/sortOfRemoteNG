//! Folder management for Grafana.

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct FolderManager<'a> {
    client: &'a GrafanaClient,
}

impl<'a> FolderManager<'a> {
    pub fn new(client: &'a GrafanaClient) -> Self {
        Self { client }
    }

    /// List all folders.
    pub async fn list(&self) -> GrafanaResult<Vec<GrafanaFolder>> {
        self.client.api_get("/folders").await
    }

    /// Get a folder by UID.
    pub async fn get_by_uid(&self, uid: &str) -> GrafanaResult<GrafanaFolder> {
        self.client
            .api_get(&format!("/folders/{}", uid))
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::folder_not_found(format!("Folder '{}' not found", uid))
                }
                _ => e,
            })
    }

    /// Create a new folder.
    pub async fn create(&self, req: CreateFolderRequest) -> GrafanaResult<GrafanaFolder> {
        self.client.api_post("/folders", &req).await
    }

    /// Update a folder by UID.
    pub async fn update(&self, uid: &str, req: UpdateFolderRequest) -> GrafanaResult<GrafanaFolder> {
        self.client
            .api_put(&format!("/folders/{}", uid), &req)
            .await
    }

    /// Delete a folder by UID.
    pub async fn delete(&self, uid: &str) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/folders/{}", uid))
            .await
    }

    /// Get permissions for a folder.
    pub async fn get_permissions(&self, uid: &str) -> GrafanaResult<Vec<FolderPermission>> {
        self.client
            .api_get(&format!("/folders/{}/permissions", uid))
            .await
    }

    /// Update permissions for a folder.
    pub async fn update_permissions(
        &self,
        uid: &str,
        permissions: Vec<FolderPermission>,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "items": permissions });
        self.client
            .api_post(&format!("/folders/{}/permissions", uid), &body)
            .await
    }
}
