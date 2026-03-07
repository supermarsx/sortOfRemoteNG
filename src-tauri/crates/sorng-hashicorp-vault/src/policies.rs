// ── sorng-hashicorp-vault/src/policies.rs ────────────────────────────────────
//! Vault policy management operations.

use crate::client::VaultClient;
use crate::error::VaultResult;
use crate::types::*;

pub struct PolicyManager;

impl PolicyManager {
    pub async fn list_policies(client: &VaultClient) -> VaultResult<Vec<String>> {
        client.list_policies().await
    }

    pub async fn read_policy(client: &VaultClient, name: &str) -> VaultResult<VaultPolicy> {
        client.read_policy(name).await
    }

    pub async fn create_or_update_policy(client: &VaultClient, name: &str, policy_text: &str) -> VaultResult<()> {
        client.create_or_update_policy(name, policy_text).await
    }

    pub async fn delete_policy(client: &VaultClient, name: &str) -> VaultResult<()> {
        client.delete_policy(name).await
    }
}
