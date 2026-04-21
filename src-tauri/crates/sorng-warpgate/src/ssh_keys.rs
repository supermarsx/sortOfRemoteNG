// ── sorng-warpgate/src/ssh_keys.rs ──────────────────────────────────────────
//! Warpgate server SSH key management.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct SshKeyManager;

impl SshKeyManager {
    /// GET /ssh/own-keys
    pub async fn get_own_keys(client: &WarpgateClient) -> WarpgateResult<Vec<WarpgateSshKey>> {
        let resp = client.get("/ssh/own-keys").await?;
        let keys: Vec<WarpgateSshKey> = serde_json::from_value(resp)?;
        Ok(keys)
    }
}
