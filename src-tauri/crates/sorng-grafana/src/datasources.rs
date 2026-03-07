// ── Grafana datasource management ────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct DatasourceManager;

impl DatasourceManager {
    pub async fn list_datasources(client: &GrafanaClient) -> GrafanaResult<Vec<Datasource>> {
        let body = client.api_get("/api/datasources").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_datasources: {e}")))
    }

    pub async fn get_datasource(client: &GrafanaClient, id: i64) -> GrafanaResult<Datasource> {
        let body = client.api_get(&format!("/api/datasources/{id}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_datasource: {e}")))
    }

    pub async fn get_datasource_by_uid(client: &GrafanaClient, uid: &str) -> GrafanaResult<Datasource> {
        let body = client.api_get(&format!("/api/datasources/uid/{uid}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_datasource_by_uid: {e}")))
    }

    pub async fn create_datasource(client: &GrafanaClient, req: &CreateDatasourceRequest) -> GrafanaResult<Datasource> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/datasources", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_datasource: {e}")))
    }

    pub async fn update_datasource(client: &GrafanaClient, id: i64, req: &UpdateDatasourceRequest) -> GrafanaResult<Datasource> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_put(&format!("/api/datasources/{id}"), &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("update_datasource: {e}")))
    }

    pub async fn delete_datasource(client: &GrafanaClient, id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/datasources/{id}")).await?;
        Ok(())
    }

    pub async fn test_datasource(client: &GrafanaClient, id: i64) -> GrafanaResult<DatasourceHealth> {
        let ds = Self::get_datasource(client, id).await?;
        let payload = serde_json::to_string(&ds).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/datasources/proxy/health", &payload).await
            .unwrap_or_else(|_| r#"{"status":"ERROR","message":"Health check failed"}"#.to_string());
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("test_datasource: {e}")))
    }

    pub async fn get_datasource_health(client: &GrafanaClient, uid: &str) -> GrafanaResult<DatasourceHealth> {
        let body = client.api_get(&format!("/api/datasources/uid/{uid}/health")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_datasource_health: {e}")))
    }

    pub async fn list_datasource_types(client: &GrafanaClient) -> GrafanaResult<Vec<DatasourceType>> {
        let body = client.api_get("/api/datasources/plugins").await
            .or_else(|_| Ok::<String, GrafanaError>("[]".to_string()))?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_datasource_types: {e}")))
    }

    pub async fn get_datasource_proxy(client: &GrafanaClient, id: i64, path: &str) -> GrafanaResult<String> {
        client.api_get(&format!("/api/datasources/proxy/{id}/{path}")).await
    }

    pub async fn query_datasource(client: &GrafanaClient, req: &QueryDatasourceRequest) -> GrafanaResult<serde_json::Value> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/ds/query", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("query_datasource: {e}")))
    }
}
