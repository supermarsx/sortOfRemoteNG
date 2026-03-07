// ── Grafana dashboard management ─────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct DashboardManager;

impl DashboardManager {
    pub async fn list_dashboards(client: &GrafanaClient) -> GrafanaResult<Vec<DashboardSearchResult>> {
        let body = client.api_get("/api/search?type=dash-db").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_dashboards: {e}")))
    }

    pub async fn search_dashboards(client: &GrafanaClient, query: &DashboardSearchQuery) -> GrafanaResult<Vec<DashboardSearchResult>> {
        let mut params = Vec::new();
        if let Some(ref q) = query.query { params.push(format!("query={q}")); }
        if let Some(ref tags) = query.tag { for t in tags { params.push(format!("tag={t}")); } }
        if let Some(starred) = query.starred { params.push(format!("starred={starred}")); }
        if let Some(ref ids) = query.folder_ids { for id in ids { params.push(format!("folderIds={id}")); } }
        if let Some(limit) = query.limit { params.push(format!("limit={limit}")); }
        if let Some(page) = query.page { params.push(format!("page={page}")); }
        if let Some(ref t) = query.search_type { params.push(format!("type={t}")); }
        if let Some(ref s) = query.sort { params.push(format!("sort={s}")); }
        let qs = if params.is_empty() { String::new() } else { format!("?{}", params.join("&")) };
        let body = client.api_get(&format!("/api/search{qs}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("search_dashboards: {e}")))
    }

    pub async fn get_dashboard(client: &GrafanaClient, uid: &str) -> GrafanaResult<serde_json::Value> {
        let body = client.api_get(&format!("/api/dashboards/uid/{uid}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_dashboard: {e}")))
    }

    pub async fn get_dashboard_by_uid(client: &GrafanaClient, uid: &str) -> GrafanaResult<serde_json::Value> {
        Self::get_dashboard(client, uid).await
    }

    pub async fn create_dashboard(client: &GrafanaClient, req: &CreateDashboardRequest) -> GrafanaResult<serde_json::Value> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/dashboards/db", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_dashboard: {e}")))
    }

    pub async fn update_dashboard(client: &GrafanaClient, req: &UpdateDashboardRequest) -> GrafanaResult<serde_json::Value> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/dashboards/db", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("update_dashboard: {e}")))
    }

    pub async fn delete_dashboard(client: &GrafanaClient, uid: &str) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/dashboards/uid/{uid}")).await?;
        Ok(())
    }

    pub async fn get_dashboard_versions(client: &GrafanaClient, dashboard_id: i64) -> GrafanaResult<Vec<DashboardVersion>> {
        let body = client.api_get(&format!("/api/dashboards/id/{dashboard_id}/versions")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_dashboard_versions: {e}")))
    }

    pub async fn restore_dashboard_version(client: &GrafanaClient, dashboard_id: i64, version: i64) -> GrafanaResult<serde_json::Value> {
        let payload = serde_json::json!({ "version": version }).to_string();
        let body = client.api_post(&format!("/api/dashboards/id/{dashboard_id}/restore"), &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("restore_dashboard_version: {e}")))
    }

    pub async fn get_dashboard_permissions(client: &GrafanaClient, uid: &str) -> GrafanaResult<Vec<DashboardPermission>> {
        let body = client.api_get(&format!("/api/dashboards/uid/{uid}/permissions")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_dashboard_permissions: {e}")))
    }

    pub async fn update_dashboard_permissions(client: &GrafanaClient, uid: &str, req: &UpdatePermissionsRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post(&format!("/api/dashboards/uid/{uid}/permissions"), &payload).await?;
        Ok(())
    }

    pub async fn get_dashboard_tags(client: &GrafanaClient) -> GrafanaResult<Vec<serde_json::Value>> {
        let body = client.api_get("/api/dashboards/tags").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_dashboard_tags: {e}")))
    }

    pub async fn export_dashboard(client: &GrafanaClient, uid: &str) -> GrafanaResult<serde_json::Value> {
        let body = client.api_get(&format!("/api/dashboards/uid/{uid}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("export_dashboard: {e}")))
    }

    pub async fn import_dashboard(client: &GrafanaClient, req: &ImportDashboardRequest) -> GrafanaResult<serde_json::Value> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/dashboards/import", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("import_dashboard: {e}")))
    }

    pub async fn star_dashboard(client: &GrafanaClient, dashboard_id: i64) -> GrafanaResult<()> {
        client.api_post(&format!("/api/user/stars/dashboard/{dashboard_id}"), "").await?;
        Ok(())
    }

    pub async fn unstar_dashboard(client: &GrafanaClient, dashboard_id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/user/stars/dashboard/{dashboard_id}")).await?;
        Ok(())
    }

    pub async fn get_home_dashboard(client: &GrafanaClient) -> GrafanaResult<serde_json::Value> {
        let body = client.api_get("/api/dashboards/home").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_home_dashboard: {e}")))
    }

    pub async fn set_home_dashboard(client: &GrafanaClient, dashboard_id: i64) -> GrafanaResult<()> {
        let payload = serde_json::json!({ "homeDashboardId": dashboard_id }).to_string();
        client.api_put("/api/org/preferences", &payload).await?;
        Ok(())
    }

    pub async fn calculate_diff(client: &GrafanaClient, req: &DashboardDiffRequest) -> GrafanaResult<DashboardDiff> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/dashboards/calculate-diff", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("calculate_diff: {e}")))
    }
}
