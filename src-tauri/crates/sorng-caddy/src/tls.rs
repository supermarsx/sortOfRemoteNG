// ── caddy TLS management ─────────────────────────────────────────────────────

use crate::client::CaddyClient;
use crate::error::CaddyResult;
use crate::types::*;

pub struct CaddyTlsManager;

impl CaddyTlsManager {
    pub async fn get_app(client: &CaddyClient) -> CaddyResult<TlsApp> {
        client.get("/config/apps/tls").await
    }

    pub async fn set_app(client: &CaddyClient, tls: &TlsApp) -> CaddyResult<()> {
        client.put("/config/apps/tls", tls).await
    }

    pub async fn list_automate_domains(client: &CaddyClient) -> CaddyResult<Vec<String>> {
        client.get("/config/apps/tls/certificates/automate").await
    }

    pub async fn set_automate_domains(client: &CaddyClient, domains: &[String]) -> CaddyResult<()> {
        client
            .put("/config/apps/tls/certificates/automate", &domains)
            .await
    }

    pub async fn get_automation(client: &CaddyClient) -> CaddyResult<TlsAutomation> {
        client.get("/config/apps/tls/automation").await
    }

    pub async fn set_automation(
        client: &CaddyClient,
        automation: &TlsAutomation,
    ) -> CaddyResult<()> {
        client.put("/config/apps/tls/automation", automation).await
    }

    pub async fn list_certificates(client: &CaddyClient) -> CaddyResult<Vec<CaddyCertificate>> {
        // The /pki/ca/local/certificates endpoint or /tls/certificates
        client.get("/config/apps/tls/certificates").await
    }
}
