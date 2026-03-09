// ── sorng-budibase/src/apps.rs ─────────────────────────────────────────────────
//! Budibase application management.

use crate::client::BudibaseClient;
use crate::error::BudibaseResult;
use crate::types::*;

pub struct AppManager;

impl AppManager {
    pub async fn list(client: &BudibaseClient) -> BudibaseResult<Vec<BudibaseApp>> {
        let resp = client.get("/applications").await?;
        let apps: Vec<BudibaseApp> = serde_json::from_value(
            resp.get("data")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![])),
        )?;
        Ok(apps)
    }

    pub async fn search(
        client: &BudibaseClient,
        name: Option<&str>,
    ) -> BudibaseResult<Vec<BudibaseApp>> {
        let body = serde_json::json!({ "name": name });
        let resp = client.post("/applications/search", &body).await?;
        let apps: Vec<BudibaseApp> = serde_json::from_value(
            resp.get("data")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![])),
        )?;
        Ok(apps)
    }

    pub async fn get(client: &BudibaseClient, app_id: &str) -> BudibaseResult<BudibaseApp> {
        let resp = client.get(&format!("/applications/{}", app_id)).await?;
        let app: BudibaseApp =
            serde_json::from_value(resp.get("data").cloned().unwrap_or(resp.clone()))?;
        Ok(app)
    }

    pub async fn create(
        client: &BudibaseClient,
        req: &CreateAppRequest,
    ) -> BudibaseResult<BudibaseApp> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/applications", &body).await?;
        let app: BudibaseApp =
            serde_json::from_value(resp.get("data").cloned().unwrap_or(resp.clone()))?;
        Ok(app)
    }

    pub async fn update(
        client: &BudibaseClient,
        app_id: &str,
        req: &UpdateAppRequest,
    ) -> BudibaseResult<BudibaseApp> {
        let body = serde_json::to_value(req)?;
        let resp = client
            .put(&format!("/applications/{}", app_id), &body)
            .await?;
        let app: BudibaseApp =
            serde_json::from_value(resp.get("data").cloned().unwrap_or(resp.clone()))?;
        Ok(app)
    }

    pub async fn delete(client: &BudibaseClient, app_id: &str) -> BudibaseResult<()> {
        client.delete(&format!("/applications/{}", app_id)).await?;
        Ok(())
    }

    pub async fn publish(
        client: &BudibaseClient,
        app_id: &str,
    ) -> BudibaseResult<AppPublishResponse> {
        let resp = client
            .post_empty(&format!("/applications/{}/publish", app_id))
            .await?;
        let result: AppPublishResponse =
            serde_json::from_value(resp.get("data").cloned().unwrap_or(resp.clone()))?;
        Ok(result)
    }

    pub async fn unpublish(client: &BudibaseClient, app_id: &str) -> BudibaseResult<()> {
        client
            .post_empty(&format!("/applications/{}/unpublish", app_id))
            .await?;
        Ok(())
    }
}
