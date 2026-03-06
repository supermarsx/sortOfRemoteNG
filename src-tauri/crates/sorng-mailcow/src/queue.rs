//! Mail queue management for Mailcow.

use crate::client::MailcowClient;
use crate::error::MailcowResult;
use crate::types::*;

pub struct QueueManager;

impl QueueManager {
    /// Get queue summary (counts per queue). GET /api/v1/get/mailq/all
    pub async fn get_summary(client: &MailcowClient) -> MailcowResult<MailcowQueueSummary> {
        client.get("/get/mailq/all").await
    }

    /// List items in a specific queue. GET /api/v1/get/mailq/{queue_name}
    pub async fn list_queue(
        client: &MailcowClient,
        queue_name: &str,
    ) -> MailcowResult<Vec<MailcowQueueItem>> {
        client.get(&format!("/get/mailq/{queue_name}")).await
    }

    /// Flush a queue. POST /api/v1/edit/mailq
    pub async fn flush(
        client: &MailcowClient,
        queue_name: &str,
    ) -> MailcowResult<serde_json::Value> {
        let payload = serde_json::json!({
            "action": "flush",
            "queue": queue_name
        });
        client.post("/edit/mailq", &payload).await
    }

    /// Delete a single queue item. POST /api/v1/delete/mailq
    pub async fn delete_item(
        client: &MailcowClient,
        queue_id: &str,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/delete/mailq", &serde_json::json!([queue_id])).await
    }

    /// Delete all items in a queue (super delete).
    /// POST /api/v1/delete/mailq
    pub async fn super_delete(
        client: &MailcowClient,
        queue_name: &str,
    ) -> MailcowResult<serde_json::Value> {
        let payload = serde_json::json!({
            "action": "super_delete",
            "queue": queue_name
        });
        client.post("/delete/mailq", &payload).await
    }
}
