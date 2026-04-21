// ── sorng-warpgate/src/ssh_test.rs ──────────────────────────────────────────
//! Warpgate SSH connection testing.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct SshTestManager;

impl SshTestManager {
    /// POST /ssh/check-host-key
    pub async fn check_host_key(
        client: &WarpgateClient,
        req: &CheckSshHostKeyRequest,
    ) -> WarpgateResult<CheckSshHostKeyResponse> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/ssh/check-host-key", &body).await?;
        let result: CheckSshHostKeyResponse = serde_json::from_value(resp)?;
        Ok(result)
    }
}
