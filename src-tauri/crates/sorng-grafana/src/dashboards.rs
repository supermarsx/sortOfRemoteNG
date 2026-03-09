// ── sorng-grafana/src/dashboards.rs ──────────────────────────────────────────
//! Dashboard management via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct DashboardManager;

impl DashboardManager {
    /// Search dashboards and folders.  GET /api/search
    pub async fn search(
        client: &GrafanaClient,
        query: &SearchQuery,
    ) -> GrafanaResult<Vec<Dashboard>> {
        let mut params = Vec::new();
        if let Some(ref q) = query.query {
            params.push(format!("query={q}"));
        }
        if let Some(ref tags) = query.tag {
            for t in tags {
                params.push(format!("tag={t}"));
            }
        }
        if let Some(ref t) = query.type_field {
            params.push(format!("type={t}"));
        }
        if let Some(starred) = query.starred {
            params.push(format!("starred={starred}"));
        }
        if let Some(limit) = query.limit {
            params.push(format!("limit={limit}"));
        }
        if let Some(page) = query.page {
            params.push(format!("page={page}"));
        }
        if let Some(ref ids) = query.folder_ids {
            for id in ids {
                params.push(format!("folderIds={id}"));
            }
        }
        if let Some(ref ids) = query.dashboard_ids {
            for id in ids {
                params.push(format!("dashboardIds={id}"));
            }
        }
        let qs = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        client.api_get(&format!("search{qs}")).await
    }

    /// Get dashboard by UID.  GET /api/dashboards/uid/:uid
    pub async fn get_by_uid(client: &GrafanaClient, uid: &str) -> GrafanaResult<DashboardDetail> {
        client.api_get(&format!("dashboards/uid/{uid}")).await
    }

    /// Create or update a dashboard.  POST /api/dashboards/db
    pub async fn save(
        client: &GrafanaClient,
        request: &SaveDashboardRequest,
    ) -> GrafanaResult<SaveDashboardResponse> {
        client.api_post("dashboards/db", request).await
    }

    /// Delete dashboard by UID.  DELETE /api/dashboards/uid/:uid
    pub async fn delete_by_uid(
        client: &GrafanaClient,
        uid: &str,
    ) -> GrafanaResult<serde_json::Value> {
        client.api_delete(&format!("dashboards/uid/{uid}")).await
    }

    /// Get home dashboard.  GET /api/dashboards/home
    pub async fn get_home(client: &GrafanaClient) -> GrafanaResult<DashboardDetail> {
        client.api_get("dashboards/home").await
    }

    /// List dashboard versions.  GET /api/dashboards/id/:id/versions
    pub async fn list_versions(
        client: &GrafanaClient,
        dashboard_id: u64,
    ) -> GrafanaResult<Vec<DashboardVersion>> {
        client
            .api_get(&format!("dashboards/id/{dashboard_id}/versions"))
            .await
    }

    /// Get a specific dashboard version.  GET /api/dashboards/id/:id/versions/:version
    pub async fn get_version(
        client: &GrafanaClient,
        dashboard_id: u64,
        version: u64,
    ) -> GrafanaResult<DashboardVersion> {
        client
            .api_get(&format!("dashboards/id/{dashboard_id}/versions/{version}"))
            .await
    }

    /// Restore a dashboard to a previous version.  POST /api/dashboards/id/:id/restore
    pub async fn restore_version(
        client: &GrafanaClient,
        dashboard_id: u64,
        version: u64,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "version": version });
        client
            .api_post(&format!("dashboards/id/{dashboard_id}/restore"), &body)
            .await
    }

    /// Get dashboard permissions.  GET /api/dashboards/uid/:uid/permissions
    pub async fn get_permissions(
        client: &GrafanaClient,
        dashboard_uid: &str,
    ) -> GrafanaResult<serde_json::Value> {
        client
            .api_get(&format!("dashboards/uid/{dashboard_uid}/permissions"))
            .await
    }

    /// Update dashboard permissions.  POST /api/dashboards/uid/:uid/permissions
    pub async fn update_permissions(
        client: &GrafanaClient,
        dashboard_uid: &str,
        permissions: &serde_json::Value,
    ) -> GrafanaResult<serde_json::Value> {
        client
            .api_post(
                &format!("dashboards/uid/{dashboard_uid}/permissions"),
                permissions,
            )
            .await
    }

    /// Calculate diff between two dashboard versions.  POST /api/dashboards/calculate-diff
    pub async fn calculate_diff(
        client: &GrafanaClient,
        base: &serde_json::Value,
        new: &serde_json::Value,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "base": base, "new": new, "diffType": "json" });
        client.api_post("dashboards/calculate-diff", &body).await
    }

    /// Get all dashboard tags.  GET /api/dashboards/tags
    pub async fn get_tags(client: &GrafanaClient) -> GrafanaResult<Vec<(String, u64)>> {
        #[derive(serde::Deserialize)]
        struct TagItem {
            term: String,
            count: u64,
        }
        let items: Vec<TagItem> = client.api_get("dashboards/tags").await?;
        Ok(items.into_iter().map(|t| (t.term, t.count)).collect())
    }
}
