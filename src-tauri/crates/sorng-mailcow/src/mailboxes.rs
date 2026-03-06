//! Mailbox management for Mailcow.

use crate::client::MailcowClient;
use crate::error::MailcowResult;
use crate::types::*;

pub struct MailboxManager;

impl MailboxManager {
    /// List all mailboxes. GET /api/v1/get/mailbox/all
    pub async fn list(client: &MailcowClient) -> MailcowResult<Vec<MailcowMailbox>> {
        client.get("/get/mailbox/all").await
    }

    /// List mailboxes for a specific domain. GET /api/v1/get/mailbox/all/{domain}
    pub async fn list_by_domain(
        client: &MailcowClient,
        domain: &str,
    ) -> MailcowResult<Vec<MailcowMailbox>> {
        client.get(&format!("/get/mailbox/all/{domain}")).await
    }

    /// Get a single mailbox. GET /api/v1/get/mailbox/{username}
    pub async fn get(
        client: &MailcowClient,
        username: &str,
    ) -> MailcowResult<MailcowMailbox> {
        let items: Vec<MailcowMailbox> =
            client.get(&format!("/get/mailbox/{username}")).await?;
        items.into_iter().next().ok_or_else(|| {
            crate::error::MailcowError::mailbox_not_found(format!(
                "Mailbox not found: {username}"
            ))
        })
    }

    /// Create a mailbox. POST /api/v1/add/mailbox
    pub async fn create(
        client: &MailcowClient,
        req: &CreateMailboxRequest,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/add/mailbox", req).await
    }

    /// Update a mailbox. POST /api/v1/edit/mailbox
    pub async fn update(
        client: &MailcowClient,
        username: &str,
        req: &UpdateMailboxRequest,
    ) -> MailcowResult<serde_json::Value> {
        #[derive(serde::Serialize)]
        struct Envelope<'a> {
            items: Vec<&'a str>,
            attr: &'a UpdateMailboxRequest,
        }
        let payload = Envelope { items: vec![username], attr: req };
        client.post("/edit/mailbox", &payload).await
    }

    /// Delete a mailbox. POST /api/v1/delete/mailbox
    pub async fn delete(
        client: &MailcowClient,
        username: &str,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/delete/mailbox", &serde_json::json!([username])).await
    }

    /// Set quarantine notification for a mailbox.
    /// POST /api/v1/edit/quarantine_notification
    pub async fn quarantine_notifications(
        client: &MailcowClient,
        username: &str,
        enable: bool,
    ) -> MailcowResult<serde_json::Value> {
        let payload = serde_json::json!({
            "items": [username],
            "attr": {
                "quarantine_notification": if enable { "1" } else { "0" }
            }
        });
        client.post("/edit/quarantine_notification", &payload).await
    }

    /// Configure Pushover for a mailbox.
    /// POST /api/v1/edit/pushover
    pub async fn pushover_setup(
        client: &MailcowClient,
        username: &str,
        config: &serde_json::Value,
    ) -> MailcowResult<serde_json::Value> {
        let payload = serde_json::json!({
            "items": [username],
            "attr": config
        });
        client.post("/edit/pushover", &payload).await
    }
}
