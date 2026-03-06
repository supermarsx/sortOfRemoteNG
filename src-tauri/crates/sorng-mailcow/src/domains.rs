//! Domain management for Mailcow.

use crate::client::MailcowClient;
use crate::error::MailcowResult;
use crate::types::*;

pub struct DomainManager;

impl DomainManager {
    /// List all domains. GET /api/v1/get/domain/all
    pub async fn list(client: &MailcowClient) -> MailcowResult<Vec<MailcowDomain>> {
        client.get("/get/domain/all").await
    }

    /// Get a single domain. GET /api/v1/get/domain/{domain}
    pub async fn get(client: &MailcowClient, domain: &str) -> MailcowResult<MailcowDomain> {
        let items: Vec<MailcowDomain> = client.get(&format!("/get/domain/{domain}")).await?;
        items.into_iter().next().ok_or_else(|| {
            crate::error::MailcowError::domain_not_found(format!("Domain not found: {domain}"))
        })
    }

    /// Create a domain. POST /api/v1/add/domain
    pub async fn create(
        client: &MailcowClient,
        req: &CreateDomainRequest,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/add/domain", req).await
    }

    /// Update a domain. POST /api/v1/edit/domain
    pub async fn update(
        client: &MailcowClient,
        domain: &str,
        req: &UpdateDomainRequest,
    ) -> MailcowResult<serde_json::Value> {
        #[derive(serde::Serialize)]
        struct Envelope<'a> {
            items: Vec<&'a str>,
            attr: &'a UpdateDomainRequest,
        }
        let payload = Envelope { items: vec![domain], attr: req };
        client.post("/edit/domain", &payload).await
    }

    /// Delete a domain. POST /api/v1/delete/domain
    pub async fn delete(
        client: &MailcowClient,
        domain: &str,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/delete/domain", &serde_json::json!([domain])).await
    }
}
