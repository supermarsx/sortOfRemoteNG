//! Dashboard management for Grafana.

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct DashboardManager<'a> {
    client: &'a GrafanaClient,
}

impl<'a> DashboardManager<'a> {
    pub fn new(client: &'a GrafanaClient) -> Self {
        Self { client }
    }

    /// Search dashboards with optional filters.
    pub async fn search(&self, req: Option<SearchDashboardRequest>) -> GrafanaResult<Vec<GrafanaDashboard>> {
        match req {
            Some(params) => {
                let mut query: Vec<(String, String)> = Vec::new();
                if let Some(ref q) = params.query {
                    query.push(("query".into(), q.clone()));
                }
                if let Some(ref tags) = params.tag {
                    for t in tags {
                        query.push(("tag".into(), t.clone()));
                    }
                }
                if let Some(ref t) = params.type_ {
                    query.push(("type".into(), t.clone()));
                }
                if let Some(ref ids) = params.dashboard_ids {
                    for id in ids {
                        query.push(("dashboardIds".into(), id.to_string()));
                    }
                }
                if let Some(ref ids) = params.folder_ids {
                    for id in ids {
                        query.push(("folderIds".into(), id.to_string()));
                    }
                }
                if let Some(starred) = params.starred {
                    query.push(("starred".into(), starred.to_string()));
                }
                if let Some(limit) = params.limit {
                    query.push(("limit".into(), limit.to_string()));
                }
                if let Some(page) = params.page {
                    query.push(("page".into(), page.to_string()));
                }
                if let Some(ref sort) = params.sort {
                    query.push(("sort".into(), sort.clone()));
                }
                self.client.api_get_with_query("/search", &query).await
            }
            None => self.client.api_get("/search").await,
        }
    }

    /// Get a dashboard by its UID.
    pub async fn get_by_uid(&self, uid: &str) -> GrafanaResult<DashboardDetail> {
        self.client
            .api_get(&format!("/dashboards/uid/{}", uid))
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::dashboard_not_found(format!("Dashboard '{}' not found", uid))
                }
                _ => e,
            })
    }

    /// Create or update a dashboard.
    pub async fn create(&self, req: CreateDashboardRequest) -> GrafanaResult<serde_json::Value> {
        self.client.api_post("/dashboards/db", &req).await
    }

    /// Update a dashboard (same endpoint as create with overwrite).
    pub async fn update(&self, req: CreateDashboardRequest) -> GrafanaResult<serde_json::Value> {
        let mut r = req;
        r.overwrite = Some(true);
        self.client.api_post("/dashboards/db", &r).await
    }

    /// Delete a dashboard by UID.
    pub async fn delete(&self, uid: &str) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/dashboards/uid/{}", uid))
            .await
    }

    /// Get version history for a dashboard.
    pub async fn get_versions(&self, dashboard_id: i64) -> GrafanaResult<Vec<DashboardVersion>> {
        self.client
            .api_get(&format!("/dashboards/id/{}/versions", dashboard_id))
            .await
    }

    /// Get a specific version of a dashboard.
    pub async fn get_version(&self, dashboard_id: i64, version: i64) -> GrafanaResult<DashboardVersion> {
        self.client
            .api_get(&format!("/dashboards/id/{}/versions/{}", dashboard_id, version))
            .await
    }

    /// Restore a dashboard to a previous version.
    pub async fn restore_version(&self, dashboard_id: i64, version: i64) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "version": version });
        self.client
            .api_post(&format!("/dashboards/id/{}/restore", dashboard_id), &body)
            .await
    }

    /// Get permissions for a dashboard.
    pub async fn get_permissions(&self, dashboard_id: i64) -> GrafanaResult<Vec<DashboardPermission>> {
        self.client
            .api_get(&format!("/dashboards/id/{}/permissions", dashboard_id))
            .await
    }

    /// Update permissions for a dashboard.
    pub async fn update_permissions(
        &self,
        dashboard_id: i64,
        permissions: Vec<DashboardPermission>,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "items": permissions });
        self.client
            .api_post(&format!("/dashboards/id/{}/permissions", dashboard_id), &body)
            .await
    }

    /// Star a dashboard for the current user.
    pub async fn star(&self, dashboard_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_post(&format!("/user/stars/dashboard/{}", dashboard_id), &serde_json::json!({}))
            .await
    }

    /// Unstar a dashboard for the current user.
    pub async fn unstar(&self, dashboard_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/user/stars/dashboard/{}", dashboard_id))
            .await
    }

    /// Get the home dashboard.
    pub async fn get_home(&self) -> GrafanaResult<DashboardDetail> {
        self.client.api_get("/dashboards/home").await
    }

    /// Set the home dashboard for the org.
    pub async fn set_home(&self, dashboard_id: i64) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "homeDashboardId": dashboard_id });
        self.client.api_put("/org/preferences", &body).await
    }

    /// Import a dashboard from JSON.
    pub async fn import(&self, dashboard_json: serde_json::Value) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_post("/dashboards/import", &dashboard_json)
            .await
    }

    /// Export a dashboard by UID (returns full JSON model).
    pub async fn export(&self, uid: &str) -> GrafanaResult<serde_json::Value> {
        let detail: DashboardDetail = self.get_by_uid(uid).await?;
        Ok(detail.dashboard)
    }

    /// Get all tags used by dashboards.
    pub async fn get_tags(&self) -> GrafanaResult<Vec<serde_json::Value>> {
        self.client.api_get("/dashboards/tags").await
    }

    /// Calculate diff between two dashboard versions.
    pub async fn calculate_diff(
        &self,
        base_dashboard_id: i64,
        base_version: i64,
        new_dashboard_id: i64,
        new_version: i64,
        diff_type: Option<String>,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({
            "base": { "dashboardId": base_dashboard_id, "version": base_version },
            "new": { "dashboardId": new_dashboard_id, "version": new_version },
            "diffType": diff_type.unwrap_or_else(|| "json".to_string())
        });
        self.client.api_post("/dashboards/calculate-diff", &body).await
    }
}
