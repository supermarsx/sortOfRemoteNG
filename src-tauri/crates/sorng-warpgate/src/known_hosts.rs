// ── sorng-warpgate/src/known_hosts.rs ───────────────────────────────────────
//! Warpgate SSH known host management.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct KnownHostManager;

impl KnownHostManager {
    /// GET /ssh/known-hosts
    pub async fn list(client: &WarpgateClient) -> WarpgateResult<Vec<WarpgateKnownHost>> {
        let resp = client.get("/ssh/known-hosts").await?;
        let hosts: Vec<WarpgateKnownHost> = serde_json::from_value(resp)?;
        Ok(hosts)
    }

    /// POST /ssh/known-hosts
    pub async fn add(client: &WarpgateClient, req: &AddKnownHostRequest) -> WarpgateResult<WarpgateKnownHost> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/ssh/known-hosts", &body).await?;
        let host: WarpgateKnownHost = serde_json::from_value(resp)?;
        Ok(host)
    }

    /// DELETE /ssh/known-hosts/:id
    pub async fn delete(client: &WarpgateClient, host_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/ssh/known-hosts/{}", host_id)).await?;
        Ok(())
    }
}
