// ── sorng-budibase/src/rows.rs ─────────────────────────────────────────────────
//! Budibase row (record) management.

use crate::client::BudibaseClient;
use crate::error::BudibaseResult;
use crate::types::*;

pub struct RowManager;

impl RowManager {
    pub async fn list(client: &BudibaseClient, table_id: &str) -> BudibaseResult<Vec<BudibaseRow>> {
        let body = serde_json::json!({ "query": {} });
        let resp = client.post(&format!("/tables/{}/rows/search", table_id), &body).await?;
        let rows: Vec<BudibaseRow> = serde_json::from_value(
            resp.get("rows").or_else(|| resp.get("data")).cloned()
                .unwrap_or(serde_json::Value::Array(vec![]))
        )?;
        Ok(rows)
    }

    pub async fn search(client: &BudibaseClient, table_id: &str, req: &RowSearchRequest) -> BudibaseResult<RowSearchResponse> {
        let body = serde_json::to_value(req)?;
        let resp = client.post(&format!("/tables/{}/rows/search", table_id), &body).await?;
        let result: RowSearchResponse = serde_json::from_value(resp)?;
        Ok(result)
    }

    pub async fn get(client: &BudibaseClient, table_id: &str, row_id: &str) -> BudibaseResult<BudibaseRow> {
        let resp = client.get(&format!("/tables/{}/rows/{}", table_id, row_id)).await?;
        let row: BudibaseRow = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(row)
    }

    pub async fn create(client: &BudibaseClient, table_id: &str, row: &BudibaseRow) -> BudibaseResult<BudibaseRow> {
        let body = serde_json::to_value(row)?;
        let resp = client.post(&format!("/tables/{}/rows", table_id), &body).await?;
        let created: BudibaseRow = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(created)
    }

    pub async fn update(client: &BudibaseClient, table_id: &str, row_id: &str, row: &BudibaseRow) -> BudibaseResult<BudibaseRow> {
        let body = serde_json::to_value(row)?;
        let resp = client.put(&format!("/tables/{}/rows/{}", table_id, row_id), &body).await?;
        let updated: BudibaseRow = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(updated)
    }

    pub async fn delete(client: &BudibaseClient, table_id: &str, row_id: &str) -> BudibaseResult<()> {
        client.delete(&format!("/tables/{}/rows/{}", table_id, row_id)).await?;
        Ok(())
    }

    pub async fn bulk_create(client: &BudibaseClient, table_id: &str, rows: &[BudibaseRow]) -> BudibaseResult<BulkRowResponse> {
        let body = serde_json::json!({ "rows": rows });
        let resp = client.post(&format!("/tables/{}/rows", table_id), &body).await?;
        let result: BulkRowResponse = serde_json::from_value(resp)?;
        Ok(result)
    }

    pub async fn bulk_delete(client: &BudibaseClient, table_id: &str, req: &BulkRowDeleteRequest) -> BudibaseResult<BulkRowResponse> {
        let body = serde_json::to_value(req)?;
        let resp = client.post(&format!("/tables/{}/rows/delete", table_id), &body).await?;
        let result: BulkRowResponse = serde_json::from_value(resp)?;
        Ok(result)
    }
}
