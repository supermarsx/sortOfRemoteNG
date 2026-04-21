// ── sorng-budibase/src/views.rs ────────────────────────────────────────────────
//! Budibase view management.

use crate::client::BudibaseClient;
use crate::error::BudibaseResult;
use crate::types::*;

pub struct ViewManager;

impl ViewManager {
    pub async fn list(
        client: &BudibaseClient,
        table_id: &str,
    ) -> BudibaseResult<Vec<BudibaseView>> {
        let table = crate::tables::TableManager::get(client, table_id).await?;
        let mut views = Vec::new();
        for (name, val) in &table.views {
            if let Ok(mut v) = serde_json::from_value::<BudibaseView>(val.clone()) {
                if v.name.is_empty() {
                    v.name = name.clone();
                }
                views.push(v);
            }
        }
        Ok(views)
    }

    pub async fn get(client: &BudibaseClient, view_id: &str) -> BudibaseResult<BudibaseView> {
        let resp = client.get(&format!("/views/{}", view_id)).await?;
        let view: BudibaseView =
            serde_json::from_value(resp.get("data").cloned().unwrap_or(resp.clone()))?;
        Ok(view)
    }

    pub async fn create(
        client: &BudibaseClient,
        req: &CreateViewRequest,
    ) -> BudibaseResult<BudibaseView> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/views", &body).await?;
        let view: BudibaseView =
            serde_json::from_value(resp.get("data").cloned().unwrap_or(resp.clone()))?;
        Ok(view)
    }

    pub async fn update(
        client: &BudibaseClient,
        view_id: &str,
        req: &CreateViewRequest,
    ) -> BudibaseResult<BudibaseView> {
        let body = serde_json::to_value(req)?;
        let resp = client.put(&format!("/views/{}", view_id), &body).await?;
        let view: BudibaseView =
            serde_json::from_value(resp.get("data").cloned().unwrap_or(resp.clone()))?;
        Ok(view)
    }

    pub async fn delete(client: &BudibaseClient, view_id: &str) -> BudibaseResult<()> {
        client.delete(&format!("/views/{}", view_id)).await?;
        Ok(())
    }

    pub async fn query(
        client: &BudibaseClient,
        view_id: &str,
    ) -> BudibaseResult<ViewQueryResponse> {
        let resp = client.get(&format!("/views/{}/rows", view_id)).await?;
        let result: ViewQueryResponse = serde_json::from_value(resp)?;
        Ok(result)
    }
}
