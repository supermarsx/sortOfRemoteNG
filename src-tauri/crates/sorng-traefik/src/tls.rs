// ── traefik TLS management ───────────────────────────────────────────────────

use crate::client::TraefikClient;
use crate::error::TraefikResult;
use crate::types::*;

pub struct TlsManager;

impl TlsManager {
    pub async fn list_certificates(
        client: &TraefikClient,
    ) -> TraefikResult<Vec<TraefikTlsCertificate>> {
        client.get("/tls/certificates").await
    }

    pub async fn get_certificate(
        client: &TraefikClient,
        name: &str,
    ) -> TraefikResult<TraefikTlsCertificate> {
        client.get(&format!("/tls/certificates/{}", name)).await
    }
}
