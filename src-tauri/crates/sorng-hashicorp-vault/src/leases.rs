// ── sorng-hashicorp-vault/src/leases.rs ───────────────────────────────────────
//! Lease management operations.

use crate::client::VaultClient;
use crate::error::VaultResult;
use serde_json::Value;

pub struct LeaseManager;

impl LeaseManager {
    pub async fn read_lease(client: &VaultClient, lease_id: &str) -> VaultResult<Value> {
        client.read_lease(lease_id).await
    }

    pub async fn list_leases(client: &VaultClient, prefix: &str) -> VaultResult<Vec<String>> {
        client.list_leases(prefix).await
    }

    pub async fn renew_lease(
        client: &VaultClient,
        lease_id: &str,
        increment: Option<&str>,
    ) -> VaultResult<Value> {
        client.renew_lease(lease_id, increment).await
    }

    pub async fn revoke_lease(client: &VaultClient, lease_id: &str) -> VaultResult<()> {
        client.revoke_lease(lease_id).await
    }

    pub async fn revoke_force(client: &VaultClient, prefix: &str) -> VaultResult<()> {
        client.revoke_force(prefix).await
    }
}
