//! Datasource management for Grafana.

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct DatasourceManager<'a> {
    client: &'a GrafanaClient,
}

impl<'a> DatasourceManager<'a> {
    pub fn new(client: &'a GrafanaClient) -> Self {
        Self { client }
    }

    /// List all datasources.
    pub async fn list(&self) -> GrafanaResult<Vec<GrafanaDatasource>> {
        self.client.api_get("/datasources").await
    }

    /// Get a datasource by numeric ID.
    pub async fn get_by_id(&self, id: i64) -> GrafanaResult<GrafanaDatasource> {
        self.client
            .api_get(&format!("/datasources/{}", id))
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::datasource_not_found(format!("Datasource ID {} not found", id))
                }
                _ => e,
            })
    }

    /// Get a datasource by UID.
    pub async fn get_by_uid(&self, uid: &str) -> GrafanaResult<GrafanaDatasource> {
        self.client
            .api_get(&format!("/datasources/uid/{}", uid))
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::datasource_not_found(format!("Datasource '{}' not found", uid))
                }
                _ => e,
            })
    }

    /// Get a datasource by name.
    pub async fn get_by_name(&self, name: &str) -> GrafanaResult<GrafanaDatasource> {
        self.client
            .api_get(&format!("/datasources/name/{}", name))
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::datasource_not_found(format!("Datasource '{}' not found", name))
                }
                _ => e,
            })
    }

    /// Create a new datasource.
    pub async fn create(&self, req: CreateDatasourceRequest) -> GrafanaResult<serde_json::Value> {
        self.client.api_post("/datasources", &req).await
    }

    /// Update an existing datasource by ID.
    pub async fn update(&self, id: i64, req: UpdateDatasourceRequest) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_put(&format!("/datasources/{}", id), &req)
            .await
    }

    /// Delete a datasource by ID.
    pub async fn delete(&self, id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/datasources/{}", id))
            .await
    }

    /// Check the health of a datasource by UID.
    pub async fn health_check(&self, uid: &str) -> GrafanaResult<DatasourceHealth> {
        self.client
            .api_get(&format!("/datasources/uid/{}/health", uid))
            .await
    }

    /// Get a datasource ID by name.
    pub async fn get_id_by_name(&self, name: &str) -> GrafanaResult<i64> {
        let ds: GrafanaDatasource = self
            .client
            .api_get(&format!("/datasources/id/{}", name))
            .await?;
        ds.id.ok_or_else(|| GrafanaError::datasource_not_found(format!("No ID for datasource '{}'", name)))
    }

    /// Proxy a request to a datasource.
    pub async fn proxy_request(
        &self,
        datasource_id: i64,
        path: &str,
    ) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_get(&format!("/datasources/proxy/{}/{}", datasource_id, path))
            .await
    }
}
