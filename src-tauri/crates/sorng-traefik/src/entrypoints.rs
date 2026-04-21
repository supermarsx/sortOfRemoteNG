// ── traefik entrypoint management ────────────────────────────────────────────

use crate::client::TraefikClient;
use crate::error::TraefikResult;
use crate::types::*;

pub struct EntrypointManager;

impl EntrypointManager {
    pub async fn list(client: &TraefikClient) -> TraefikResult<Vec<TraefikEntryPoint>> {
        client.get("/entrypoints").await
    }

    pub async fn get(client: &TraefikClient, name: &str) -> TraefikResult<TraefikEntryPoint> {
        client.get(&format!("/entrypoints/{}", name)).await
    }
}
