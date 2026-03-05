// ── nginx status & health monitoring ─────────────────────────────────────────

use crate::client::NginxClient;
use crate::error::NginxResult;
use crate::types::*;

pub struct StatusManager;

impl StatusManager {
    pub async fn stub_status(client: &NginxClient) -> NginxResult<NginxStubStatus> {
        client.stub_status().await
    }

    pub async fn process_status(client: &NginxClient) -> NginxResult<NginxProcess> {
        client.status().await
    }

    pub async fn health_check(client: &NginxClient) -> NginxResult<NginxHealthCheck> {
        let proc = client.status().await?;
        let stub = client.stub_status().await.ok();
        let config_ok = client.test_config().await.map(|r| r.success).unwrap_or(false);
        Ok(NginxHealthCheck {
            running: proc.running,
            config_valid: config_ok,
            active_connections: stub.as_ref().map(|s| s.active_connections),
            accepts_per_sec: None,
            requests_per_sec: None,
        })
    }
}
