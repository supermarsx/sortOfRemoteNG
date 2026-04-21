// ── caddy config management ──────────────────────────────────────────────────

use crate::client::CaddyClient;
use crate::error::CaddyResult;
use crate::types::*;

pub struct CaddyConfigManager;

impl CaddyConfigManager {
    pub async fn get_full(client: &CaddyClient) -> CaddyResult<CaddyConfig> {
        client.get_config().await
    }

    pub async fn get_raw(client: &CaddyClient) -> CaddyResult<serde_json::Value> {
        client.get("/config/").await
    }

    pub async fn get_path(client: &CaddyClient, path: &str) -> CaddyResult<serde_json::Value> {
        client
            .get(&format!("/config/{}", path.trim_start_matches('/')))
            .await
    }

    pub async fn set_path(
        client: &CaddyClient,
        path: &str,
        value: &serde_json::Value,
    ) -> CaddyResult<()> {
        client
            .put(&format!("/config/{}", path.trim_start_matches('/')), value)
            .await
    }

    pub async fn patch_path(
        client: &CaddyClient,
        path: &str,
        value: &serde_json::Value,
    ) -> CaddyResult<()> {
        client
            .patch(&format!("/config/{}", path.trim_start_matches('/')), value)
            .await
    }

    pub async fn delete_path(client: &CaddyClient, path: &str) -> CaddyResult<()> {
        client
            .delete(&format!("/config/{}", path.trim_start_matches('/')))
            .await
    }

    pub async fn load(client: &CaddyClient, config: &serde_json::Value) -> CaddyResult<()> {
        client.load_config(config).await
    }

    pub async fn adapt_caddyfile(
        client: &CaddyClient,
        caddyfile: &str,
    ) -> CaddyResult<CaddyfileAdaptResult> {
        client.adapt_caddyfile(caddyfile).await
    }

    pub async fn stop_server(client: &CaddyClient) -> CaddyResult<()> {
        client.stop().await
    }
}
