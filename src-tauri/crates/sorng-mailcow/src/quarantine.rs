//! Quarantine management for Mailcow.

use crate::client::MailcowClient;
use crate::error::MailcowResult;
use crate::types::*;

pub struct QuarantineManager;

impl QuarantineManager {
    /// List all quarantined items. GET /api/v1/get/quarantine/all
    pub async fn list(client: &MailcowClient) -> MailcowResult<Vec<MailcowQuarantineItem>> {
        client.get("/get/quarantine/all").await
    }

    /// Get a single quarantine item by ID. GET /api/v1/get/quarantine/{id}
    pub async fn get(client: &MailcowClient, id: i64) -> MailcowResult<MailcowQuarantineItem> {
        client.get(&format!("/get/quarantine/{id}")).await
    }

    /// Release a quarantined message. POST /api/v1/edit/quarantine
    pub async fn release(
        client: &MailcowClient,
        id: i64,
    ) -> MailcowResult<serde_json::Value> {
        let payload = serde_json::json!({
            "items": [id],
            "attr": { "action": "release" }
        });
        client.post("/edit/quarantine", &payload).await
    }

    /// Delete a quarantined message. POST /api/v1/delete/quarantine
    pub async fn delete(
        client: &MailcowClient,
        id: i64,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/delete/quarantine", &serde_json::json!([id])).await
    }

    /// Whitelist the sender of a quarantined message. POST /api/v1/edit/quarantine
    pub async fn whitelist_sender(
        client: &MailcowClient,
        id: i64,
    ) -> MailcowResult<serde_json::Value> {
        let payload = serde_json::json!({
            "items": [id],
            "attr": { "action": "whitelist" }
        });
        client.post("/edit/quarantine", &payload).await
    }

    /// Get quarantine notification settings. GET /api/v1/get/quarantine/settings
    pub async fn get_settings(
        client: &MailcowClient,
    ) -> MailcowResult<serde_json::Value> {
        client.get("/get/quarantine/settings").await
    }

    /// Update quarantine notification settings. POST /api/v1/edit/quarantine_notification
    pub async fn update_settings(
        client: &MailcowClient,
        settings: &serde_json::Value,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/edit/quarantine_notification", settings).await
    }
}
