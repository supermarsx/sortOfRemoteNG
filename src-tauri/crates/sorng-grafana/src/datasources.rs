// ── sorng-grafana/src/datasources.rs ─────────────────────────────────────────
//! Datasource management via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct DatasourceManager;

impl DatasourceManager {
    /// List all datasources.  GET /api/datasources
    pub async fn list(client: &GrafanaClient) -> GrafanaResult<Vec<Datasource>> {
        client.api_get("datasources").await
    }

    /// Get datasource by ID.  GET /api/datasources/:id
    pub async fn get_by_id(client: &GrafanaClient, id: u64) -> GrafanaResult<Datasource> {
        client.api_get(&format!("datasources/{id}")).await
    }

    /// Get datasource by UID.  GET /api/datasources/uid/:uid
    pub async fn get_by_uid(client: &GrafanaClient, uid: &str) -> GrafanaResult<Datasource> {
        client.api_get(&format!("datasources/uid/{uid}")).await
    }

    /// Get datasource by name.  GET /api/datasources/name/:name
    pub async fn get_by_name(client: &GrafanaClient, name: &str) -> GrafanaResult<Datasource> {
        client.api_get(&format!("datasources/name/{name}")).await
    }

    /// Create a datasource.  POST /api/datasources
    pub async fn create(
        client: &GrafanaClient,
        request: &DatasourceCreateRequest,
    ) -> GrafanaResult<serde_json::Value> {
        client.api_post("datasources", request).await
    }

    /// Update a datasource.  PUT /api/datasources/:id
    pub async fn update(
        client: &GrafanaClient,
        id: u64,
        request: &DatasourceCreateRequest,
    ) -> GrafanaResult<serde_json::Value> {
        client.api_put(&format!("datasources/{id}"), request).await
    }

    /// Delete datasource by ID.  DELETE /api/datasources/:id
    pub async fn delete_by_id(client: &GrafanaClient, id: u64) -> GrafanaResult<serde_json::Value> {
        client.api_delete(&format!("datasources/{id}")).await
    }

    /// Delete datasource by UID.  DELETE /api/datasources/uid/:uid
    pub async fn delete_by_uid(
        client: &GrafanaClient,
        uid: &str,
    ) -> GrafanaResult<serde_json::Value> {
        client.api_delete(&format!("datasources/uid/{uid}")).await
    }

    /// Test a datasource connection.  POST /api/datasources/:id/health
    pub async fn test(client: &GrafanaClient, id: u64) -> GrafanaResult<bool> {
        let resp: serde_json::Value = client.api_get(&format!("datasources/{id}/health")).await?;
        Ok(resp
            .get("status")
            .and_then(|s| s.as_str())
            .map(|s| s == "OK")
            .unwrap_or(false))
    }

    /// Get datasource health.  GET /api/datasources/uid/:uid/health
    pub async fn get_health(client: &GrafanaClient, uid: &str) -> GrafanaResult<serde_json::Value> {
        client
            .api_get(&format!("datasources/uid/{uid}/health"))
            .await
    }
}
