// ── nginx process management ─────────────────────────────────────────────────

use crate::client::NginxClient;
use crate::error::NginxResult;
use crate::types::*;

pub struct ProcessManager;

impl ProcessManager {
    pub async fn start(client: &NginxClient) -> NginxResult<()> {
        client.start().await
    }

    pub async fn stop(client: &NginxClient) -> NginxResult<()> {
        client.stop().await
    }

    pub async fn restart(client: &NginxClient) -> NginxResult<()> {
        client.restart().await
    }

    pub async fn reload(client: &NginxClient) -> NginxResult<()> {
        client.reload().await
    }

    pub async fn status(client: &NginxClient) -> NginxResult<NginxProcess> {
        client.status().await
    }

    pub async fn version(client: &NginxClient) -> NginxResult<String> {
        client.version().await
    }

    pub async fn info(client: &NginxClient) -> NginxResult<NginxInfo> {
        client.info().await
    }

    pub async fn test_config(client: &NginxClient) -> NginxResult<ConfigTestResult> {
        client.test_config().await
    }
}
