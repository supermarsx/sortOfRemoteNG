// ── haproxy config management ────────────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct HaproxyConfigManager;

impl HaproxyConfigManager {
    pub async fn get_raw(client: &HaproxyClient) -> HaproxyResult<String> {
        let path = client
            .config
            .config_path
            .as_deref()
            .unwrap_or("/etc/haproxy/haproxy.cfg");
        client.read_remote_file(path).await
    }

    pub async fn update_raw(client: &HaproxyClient, content: &str) -> HaproxyResult<()> {
        let path = client
            .config
            .config_path
            .as_deref()
            .unwrap_or("/etc/haproxy/haproxy.cfg");
        client.write_remote_file(path, content).await
    }

    pub async fn validate(client: &HaproxyClient) -> HaproxyResult<ConfigValidationResult> {
        client.check_config().await
    }

    pub async fn reload(client: &HaproxyClient) -> HaproxyResult<()> {
        client.reload().await
    }

    pub async fn start(client: &HaproxyClient) -> HaproxyResult<()> {
        client.start().await
    }

    pub async fn stop(client: &HaproxyClient) -> HaproxyResult<()> {
        client.stop().await
    }

    pub async fn restart(client: &HaproxyClient) -> HaproxyResult<()> {
        client.restart().await
    }

    pub async fn version(client: &HaproxyClient) -> HaproxyResult<String> {
        client.version().await
    }
}
