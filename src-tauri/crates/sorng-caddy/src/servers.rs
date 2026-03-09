// ── caddy server management ──────────────────────────────────────────────────

use crate::client::CaddyClient;
use crate::error::CaddyResult;
use crate::types::*;
use std::collections::HashMap;

pub struct ServerManager;

impl ServerManager {
    pub async fn list(client: &CaddyClient) -> CaddyResult<HashMap<String, CaddyServer>> {
        let config: CaddyConfig = client.get_config().await?;
        Ok(config
            .apps
            .and_then(|a| a.http)
            .and_then(|h| h.servers)
            .unwrap_or_default())
    }

    pub async fn get(client: &CaddyClient, name: &str) -> CaddyResult<CaddyServer> {
        client
            .get(&format!("/config/apps/http/servers/{}", name))
            .await
    }

    pub async fn set(client: &CaddyClient, name: &str, server: &CaddyServer) -> CaddyResult<()> {
        client
            .put(&format!("/config/apps/http/servers/{}", name), server)
            .await
    }

    pub async fn delete(client: &CaddyClient, name: &str) -> CaddyResult<()> {
        client
            .delete(&format!("/config/apps/http/servers/{}", name))
            .await
    }
}
