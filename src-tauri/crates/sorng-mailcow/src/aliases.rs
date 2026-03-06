//! Alias management for Mailcow.

use crate::client::MailcowClient;
use crate::error::MailcowResult;
use crate::types::*;

pub struct AliasManager;

impl AliasManager {
    /// List all aliases. GET /api/v1/get/alias/all
    pub async fn list(client: &MailcowClient) -> MailcowResult<Vec<MailcowAlias>> {
        client.get("/get/alias/all").await
    }

    /// Get a single alias by ID. GET /api/v1/get/alias/{id}
    pub async fn get(client: &MailcowClient, id: i64) -> MailcowResult<MailcowAlias> {
        let items: Vec<MailcowAlias> =
            client.get(&format!("/get/alias/{id}")).await?;
        items.into_iter().next().ok_or_else(|| {
            crate::error::MailcowError::alias_not_found(format!("Alias not found: {id}"))
        })
    }

    /// Create an alias. POST /api/v1/add/alias
    pub async fn create(
        client: &MailcowClient,
        req: &CreateAliasRequest,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/add/alias", req).await
    }

    /// Update an alias. POST /api/v1/edit/alias
    pub async fn update(
        client: &MailcowClient,
        id: i64,
        req: &UpdateAliasRequest,
    ) -> MailcowResult<serde_json::Value> {
        #[derive(serde::Serialize)]
        struct Envelope<'a> {
            items: Vec<String>,
            attr: &'a UpdateAliasRequest,
        }
        let payload = Envelope { items: vec![id.to_string()], attr: req };
        client.post("/edit/alias", &payload).await
    }

    /// Delete an alias. POST /api/v1/delete/alias
    pub async fn delete(
        client: &MailcowClient,
        id: i64,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/delete/alias", &serde_json::json!([id.to_string()])).await
    }
}
