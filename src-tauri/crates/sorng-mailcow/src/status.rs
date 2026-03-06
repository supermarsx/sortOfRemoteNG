//! System status, Fail2Ban, rate limits, resources, app passwords for Mailcow.

use crate::client::MailcowClient;
use crate::error::MailcowResult;
use crate::types::*;

pub struct StatusManager;

impl StatusManager {
    // ── Containers / system ──────────────────────────────────────────

    /// Get container status. GET /api/v1/get/status/containers
    pub async fn get_container_status(
        client: &MailcowClient,
    ) -> MailcowResult<Vec<MailcowContainerStatus>> {
        client.get("/get/status/containers").await
    }

    /// Get Solr status. GET /api/v1/get/status/solr
    pub async fn get_solr_status(
        client: &MailcowClient,
    ) -> MailcowResult<serde_json::Value> {
        client.get("/get/status/solr").await
    }

    /// Get aggregated system status (containers + disk + solr).
    pub async fn get_system_status(
        client: &MailcowClient,
    ) -> MailcowResult<MailcowSystemStatus> {
        let containers: Vec<MailcowContainerStatus> =
            client.get("/get/status/containers").await.unwrap_or_default();
        let solr: Option<String> = client
            .get::<serde_json::Value>("/get/status/solr")
            .await
            .ok()
            .map(|v| v.to_string());
        Ok(MailcowSystemStatus {
            containers,
            disk_usage: None,
            solr_status: solr,
        })
    }

    /// Get Rspamd statistics. GET /api/v1/get/rspamd/stats
    pub async fn get_rspamd_stats(
        client: &MailcowClient,
    ) -> MailcowResult<serde_json::Value> {
        client.get("/get/rspamd/stats").await
    }

    // ── Fail2Ban ─────────────────────────────────────────────────────

    /// Get Fail2Ban config. GET /api/v1/get/fail2ban
    pub async fn get_fail2ban_config(
        client: &MailcowClient,
    ) -> MailcowResult<MailcowFail2BanConfig> {
        client.get("/get/fail2ban").await
    }

    /// Update Fail2Ban config. POST /api/v1/edit/fail2ban
    pub async fn update_fail2ban_config(
        client: &MailcowClient,
        config: &MailcowFail2BanConfig,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/edit/fail2ban", config).await
    }

    // ── Rate limits ──────────────────────────────────────────────────

    /// Get rate limits for a mailbox. GET /api/v1/get/rl-mbox/{mailbox}
    pub async fn get_rate_limits(
        client: &MailcowClient,
        mailbox: &str,
    ) -> MailcowResult<MailcowRateLimit> {
        client.get(&format!("/get/rl-mbox/{mailbox}")).await
    }

    /// Set a rate limit. POST /api/v1/edit/rl-mbox
    pub async fn set_rate_limit(
        client: &MailcowClient,
        req: &SetRateLimitRequest,
    ) -> MailcowResult<serde_json::Value> {
        let payload = serde_json::json!({
            "items": [&req.object],
            "attr": {
                "rl_value": &req.value,
                "rl_frame": &req.frame
            }
        });
        client.post("/edit/rl-mbox", &payload).await
    }

    /// Delete rate limit for a mailbox. POST /api/v1/edit/rl-mbox
    pub async fn delete_rate_limit(
        client: &MailcowClient,
        mailbox: &str,
    ) -> MailcowResult<serde_json::Value> {
        let payload = serde_json::json!({
            "items": [mailbox],
            "attr": {
                "rl_value": "",
                "rl_frame": ""
            }
        });
        client.post("/edit/rl-mbox", &payload).await
    }

    // ── App Passwords ────────────────────────────────────────────────

    /// List app passwords for a user. GET /api/v1/get/app-passwd/all/{username}
    pub async fn list_app_passwords(
        client: &MailcowClient,
        username: &str,
    ) -> MailcowResult<Vec<MailcowAppPassword>> {
        client.get(&format!("/get/app-passwd/all/{username}")).await
    }

    /// Create an app password. POST /api/v1/add/app-passwd
    pub async fn create_app_password(
        client: &MailcowClient,
        req: &CreateAppPasswordRequest,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/add/app-passwd", req).await
    }

    /// Delete an app password. POST /api/v1/delete/app-passwd
    pub async fn delete_app_password(
        client: &MailcowClient,
        id: i64,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/delete/app-passwd", &serde_json::json!([id])).await
    }

    // ── Resources ────────────────────────────────────────────────────

    /// List all resources. GET /api/v1/get/resource/all
    pub async fn list_resources(
        client: &MailcowClient,
    ) -> MailcowResult<Vec<MailcowResource>> {
        client.get("/get/resource/all").await
    }

    /// Get a single resource. GET /api/v1/get/resource/{name}
    pub async fn get_resource(
        client: &MailcowClient,
        name: &str,
    ) -> MailcowResult<MailcowResource> {
        client.get(&format!("/get/resource/{name}")).await
    }

    /// Create a resource. POST /api/v1/add/resource
    pub async fn create_resource(
        client: &MailcowClient,
        req: &CreateResourceRequest,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/add/resource", req).await
    }

    /// Update a resource. POST /api/v1/edit/resource
    pub async fn update_resource(
        client: &MailcowClient,
        name: &str,
        req: &CreateResourceRequest,
    ) -> MailcowResult<serde_json::Value> {
        #[derive(serde::Serialize)]
        struct Envelope<'a> {
            items: Vec<&'a str>,
            attr: &'a CreateResourceRequest,
        }
        let payload = Envelope { items: vec![name], attr: req };
        client.post("/edit/resource", &payload).await
    }

    /// Delete a resource. POST /api/v1/delete/resource
    pub async fn delete_resource(
        client: &MailcowClient,
        name: &str,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/delete/resource", &serde_json::json!([name])).await
    }
}
