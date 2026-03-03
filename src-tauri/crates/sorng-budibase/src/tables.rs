// ── sorng-budibase/src/tables.rs ───────────────────────────────────────────────
//! Budibase table management.

use crate::client::BudibaseClient;
use crate::error::BudibaseResult;
use crate::types::*;

pub struct TableManager;

impl TableManager {
    pub async fn list(client: &BudibaseClient) -> BudibaseResult<Vec<BudibaseTable>> {
        let resp = client.get("/tables").await?;
        let tables: Vec<BudibaseTable> = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(serde_json::Value::Array(vec![]))
        )?;
        Ok(tables)
    }

    pub async fn get(client: &BudibaseClient, table_id: &str) -> BudibaseResult<BudibaseTable> {
        let resp = client.get(&format!("/tables/{}", table_id)).await?;
        let table: BudibaseTable = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(table)
    }

    pub async fn create(client: &BudibaseClient, req: &CreateTableRequest) -> BudibaseResult<BudibaseTable> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/tables", &body).await?;
        let table: BudibaseTable = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(table)
    }

    pub async fn update(client: &BudibaseClient, table_id: &str, req: &UpdateTableRequest) -> BudibaseResult<BudibaseTable> {
        let body = serde_json::to_value(req)?;
        let resp = client.put(&format!("/tables/{}", table_id), &body).await?;
        let table: BudibaseTable = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(table)
    }

    pub async fn delete(client: &BudibaseClient, table_id: &str, rev: Option<&str>) -> BudibaseResult<()> {
        let path = if let Some(r) = rev {
            format!("/tables/{}?rev={}", table_id, r)
        } else {
            format!("/tables/{}", table_id)
        };
        client.delete(&path).await?;
        Ok(())
    }

    pub async fn get_schema(client: &BudibaseClient, table_id: &str) -> BudibaseResult<std::collections::HashMap<String, TableFieldSchema>> {
        let table = Self::get(client, table_id).await?;
        Ok(table.schema)
    }
}
