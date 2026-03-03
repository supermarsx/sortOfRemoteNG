// ── sorng-budibase/src/queries.rs ──────────────────────────────────────────────
//! Budibase saved query management.

use crate::client::BudibaseClient;
use crate::error::BudibaseResult;
use crate::types::*;

pub struct QueryManager;

impl QueryManager {
    pub async fn list(client: &BudibaseClient) -> BudibaseResult<Vec<BudibaseQuery>> {
        let resp = client.get("/queries").await?;
        let queries: Vec<BudibaseQuery> = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(serde_json::Value::Array(vec![]))
        )?;
        Ok(queries)
    }

    pub async fn get(client: &BudibaseClient, query_id: &str) -> BudibaseResult<BudibaseQuery> {
        let resp = client.get(&format!("/queries/{}", query_id)).await?;
        let query: BudibaseQuery = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(query)
    }

    pub async fn execute(client: &BudibaseClient, query_id: &str, req: &ExecuteQueryRequest) -> BudibaseResult<QueryExecutionResponse> {
        let body = serde_json::to_value(req)?;
        let resp = client.post(&format!("/queries/{}/execute", query_id), &body).await?;
        let result: QueryExecutionResponse = serde_json::from_value(resp)?;
        Ok(result)
    }

    pub async fn create(client: &BudibaseClient, query: &BudibaseQuery) -> BudibaseResult<BudibaseQuery> {
        let body = serde_json::to_value(query)?;
        let resp = client.post("/queries", &body).await?;
        let created: BudibaseQuery = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(created)
    }

    pub async fn update(client: &BudibaseClient, query_id: &str, query: &BudibaseQuery) -> BudibaseResult<BudibaseQuery> {
        let body = serde_json::to_value(query)?;
        let resp = client.put(&format!("/queries/{}", query_id), &body).await?;
        let updated: BudibaseQuery = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(updated)
    }

    pub async fn delete(client: &BudibaseClient, query_id: &str) -> BudibaseResult<()> {
        client.delete(&format!("/queries/{}", query_id)).await?;
        Ok(())
    }
}
