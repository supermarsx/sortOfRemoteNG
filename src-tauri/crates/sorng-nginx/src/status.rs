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
        let stub = if client.status_url().is_some() {
            Some(client.stub_status().await?)
        } else {
            None
        };
        let config_ok = client.test_config().await?.success;
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
