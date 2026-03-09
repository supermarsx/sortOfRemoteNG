//! DKIM key management for Mailcow.

use crate::client::MailcowClient;
use crate::error::MailcowResult;
use crate::types::*;

pub struct DkimManager;

impl DkimManager {
    /// Get DKIM key for a domain. GET /api/v1/get/dkim/{domain}
    pub async fn get(client: &MailcowClient, domain: &str) -> MailcowResult<MailcowDkimKey> {
        client.get(&format!("/get/dkim/{domain}")).await
    }

    /// Generate DKIM key(s). POST /api/v1/add/dkim
    pub async fn generate(
        client: &MailcowClient,
        req: &GenerateDkimRequest,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/add/dkim", req).await
    }

    /// Delete DKIM key for a domain. POST /api/v1/delete/dkim
    pub async fn delete(client: &MailcowClient, domain: &str) -> MailcowResult<serde_json::Value> {
        client
            .post("/delete/dkim", &serde_json::json!([domain]))
            .await
    }

    /// Duplicate DKIM from one domain to another.
    /// POST /api/v1/add/dkim_duplicate
    pub async fn duplicate(
        client: &MailcowClient,
        src_domain: &str,
        dst_domain: &str,
    ) -> MailcowResult<serde_json::Value> {
        let payload = serde_json::json!({
            "from_domain": src_domain,
            "to_domain": dst_domain
        });
        client.post("/add/dkim_duplicate", &payload).await
    }
}
