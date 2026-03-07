// ── Grafana folder management ────────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct FolderManager;

impl FolderManager {
    pub async fn list_folders(client: &GrafanaClient) -> GrafanaResult<Vec<Folder>> {
        let body = client.api_get("/api/folders").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_folders: {e}")))
    }

    pub async fn get_folder(client: &GrafanaClient, id: i64) -> GrafanaResult<Folder> {
        let body = client.api_get(&format!("/api/folders/id/{id}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_folder: {e}")))
    }

    pub async fn get_folder_by_uid(client: &GrafanaClient, uid: &str) -> GrafanaResult<Folder> {
        let body = client.api_get(&format!("/api/folders/{uid}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_folder_by_uid: {e}")))
    }

    pub async fn create_folder(client: &GrafanaClient, req: &CreateFolderRequest) -> GrafanaResult<Folder> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/folders", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_folder: {e}")))
    }

    pub async fn update_folder(client: &GrafanaClient, uid: &str, req: &UpdateFolderRequest) -> GrafanaResult<Folder> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_put(&format!("/api/folders/{uid}"), &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("update_folder: {e}")))
    }

    pub async fn delete_folder(client: &GrafanaClient, uid: &str) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/folders/{uid}")).await?;
        Ok(())
    }

    pub async fn get_folder_permissions(client: &GrafanaClient, uid: &str) -> GrafanaResult<Vec<FolderPermission>> {
        let body = client.api_get(&format!("/api/folders/{uid}/permissions")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_folder_permissions: {e}")))
    }

    pub async fn update_folder_permissions(client: &GrafanaClient, uid: &str, req: &UpdateFolderPermissionsRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post(&format!("/api/folders/{uid}/permissions"), &payload).await?;
        Ok(())
    }

    pub async fn move_dashboard_to_folder(client: &GrafanaClient, dashboard_uid: &str, req: &MoveDashboardRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post(&format!("/api/dashboards/uid/{dashboard_uid}/move"), &payload).await?;
        Ok(())
    }

    pub async fn list_folder_dashboards(client: &GrafanaClient, uid: &str) -> GrafanaResult<Vec<DashboardSearchResult>> {
        let body = client.api_get(&format!("/api/search?folderUIDs={uid}&type=dash-db")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_folder_dashboards: {e}")))
    }
}
