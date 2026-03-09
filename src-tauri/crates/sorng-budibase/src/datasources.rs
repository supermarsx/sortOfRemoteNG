// ── sorng-budibase/src/datasources.rs ──────────────────────────────────────────
//! Budibase datasource management.

use crate::client::BudibaseClient;
use crate::error::BudibaseResult;
use crate::types::*;

pub struct DatasourceManager;

impl DatasourceManager {
    pub async fn list(client: &BudibaseClient) -> BudibaseResult<Vec<BudibaseDatasource>> {
        let resp = client.get("/datasources").await?;
        let ds: Vec<BudibaseDatasource> = serde_json::from_value(
            resp.get("data")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![])),
        )?;
        Ok(ds)
    }

    pub async fn get(
        client: &BudibaseClient,
        datasource_id: &str,
    ) -> BudibaseResult<BudibaseDatasource> {
        let resp = client
            .get(&format!("/datasources/{}", datasource_id))
            .await?;
        let ds: BudibaseDatasource =
            serde_json::from_value(resp.get("data").cloned().unwrap_or(resp.clone()))?;
        Ok(ds)
    }

    pub async fn create(
        client: &BudibaseClient,
        req: &CreateDatasourceRequest,
    ) -> BudibaseResult<BudibaseDatasource> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/datasources", &body).await?;
        let ds: BudibaseDatasource =
            serde_json::from_value(resp.get("data").cloned().unwrap_or(resp.clone()))?;
        Ok(ds)
    }

    pub async fn update(
        client: &BudibaseClient,
        datasource_id: &str,
        req: &UpdateDatasourceRequest,
    ) -> BudibaseResult<BudibaseDatasource> {
        let body = serde_json::to_value(req)?;
        let resp = client
            .put(&format!("/datasources/{}", datasource_id), &body)
            .await?;
        let ds: BudibaseDatasource =
            serde_json::from_value(resp.get("data").cloned().unwrap_or(resp.clone()))?;
        Ok(ds)
    }

    pub async fn delete(
        client: &BudibaseClient,
        datasource_id: &str,
        rev: Option<&str>,
    ) -> BudibaseResult<()> {
        let path = if let Some(r) = rev {
            format!("/datasources/{}?rev={}", datasource_id, r)
        } else {
            format!("/datasources/{}", datasource_id)
        };
        client.delete(&path).await?;
        Ok(())
    }

    pub async fn test_connection(
        client: &BudibaseClient,
        datasource_id: &str,
    ) -> BudibaseResult<DatasourceTestResponse> {
        let resp = client
            .post_empty(&format!("/datasources/{}/test", datasource_id))
            .await?;
        let result: DatasourceTestResponse = serde_json::from_value(resp)?;
        Ok(result)
    }
}
