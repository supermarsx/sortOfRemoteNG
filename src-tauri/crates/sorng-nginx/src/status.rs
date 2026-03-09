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
        let config_ok = client
            .test_config()
            .await
            .map(|r| r.success)
            .unwrap_or(false);
        Ok(NginxHealthCheck {
            running: proc.process_type != "inactive",
            pid: Some(proc.pid),
            worker_count: 0,
            config_valid: config_ok,
            uptime_secs: proc.uptime_secs,
            status: stub,
        })
    }
}
