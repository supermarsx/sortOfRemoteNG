//! Domain alias management for Mailcow.

use crate::client::MailcowClient;
use crate::error::MailcowResult;
use crate::types::*;

pub struct DomainAliasManager;

impl DomainAliasManager {
    /// List all domain aliases. GET /api/v1/get/alias-domain/all
    pub async fn list(client: &MailcowClient) -> MailcowResult<Vec<MailcowDomainAlias>> {
        client.get("/get/alias-domain/all").await
    }

    /// Get a single domain alias. GET /api/v1/get/alias-domain/{alias_domain}
    pub async fn get(
        client: &MailcowClient,
        alias_domain: &str,
    ) -> MailcowResult<MailcowDomainAlias> {
        client
            .get(&format!("/get/alias-domain/{alias_domain}"))
            .await
    }

    /// Create a domain alias. POST /api/v1/add/alias-domain
    pub async fn create(
        client: &MailcowClient,
        req: &CreateDomainAliasRequest,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/add/alias-domain", req).await
    }

    /// Update a domain alias active state. POST /api/v1/edit/alias-domain
    pub async fn update(
        client: &MailcowClient,
        alias_domain: &str,
        active: bool,
    ) -> MailcowResult<serde_json::Value> {
        let payload = serde_json::json!({
            "items": [alias_domain],
            "attr": { "active": if active { "1" } else { "0" } }
        });
        client.post("/edit/alias-domain", &payload).await
    }

    /// Delete a domain alias. POST /api/v1/delete/alias-domain
    pub async fn delete(
        client: &MailcowClient,
        alias_domain: &str,
    ) -> MailcowResult<serde_json::Value> {
        client
            .post("/delete/alias-domain", &serde_json::json!([alias_domain]))
            .await
    }
}
