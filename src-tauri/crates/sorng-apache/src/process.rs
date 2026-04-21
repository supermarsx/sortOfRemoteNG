// ── apache process management ────────────────────────────────────────────────

use crate::client::ApacheClient;
use crate::error::ApacheResult;
use crate::types::*;

pub struct ApacheProcessManager;

impl ApacheProcessManager {
    pub async fn start(client: &ApacheClient) -> ApacheResult<()> {
        client.start().await
    }
    pub async fn stop(client: &ApacheClient) -> ApacheResult<()> {
        client.stop().await
    }
    pub async fn restart(client: &ApacheClient) -> ApacheResult<()> {
        client.restart().await
    }
    pub async fn reload(client: &ApacheClient) -> ApacheResult<()> {
        client.reload().await
    }
    pub async fn status(client: &ApacheClient) -> ApacheResult<ApacheProcess> {
        client.status().await
    }
    pub async fn version(client: &ApacheClient) -> ApacheResult<String> {
        client.version().await
    }
    pub async fn info(client: &ApacheClient) -> ApacheResult<ApacheInfo> {
        client.info().await
    }
    pub async fn test_config(client: &ApacheClient) -> ApacheResult<ConfigTestResult> {
        client.test_config().await
    }
}
