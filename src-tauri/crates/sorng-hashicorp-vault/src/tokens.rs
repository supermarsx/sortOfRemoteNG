// ── sorng-hashicorp-vault/src/tokens.rs ───────────────────────────────────────
//! Token management operations.

use crate::client::VaultClient;
use crate::error::VaultResult;
use crate::types::*;
use serde_json::Value;

pub struct TokenManager;

impl TokenManager {
    pub async fn create_token(client: &VaultClient, request: &VaultTokenCreateRequest) -> VaultResult<VaultTokenInfo> {
        client.create_token(request).await
    }

    pub async fn lookup_token(client: &VaultClient, token: &str) -> VaultResult<VaultTokenInfo> {
        client.lookup_token(token).await
    }

    pub async fn lookup_self(client: &VaultClient) -> VaultResult<VaultTokenInfo> {
        client.lookup_self().await
    }

    pub async fn renew_token(client: &VaultClient, token: &str, increment: Option<&str>) -> VaultResult<Value> {
        client.renew_token(token, increment).await
    }

    pub async fn revoke_token(client: &VaultClient, token: &str) -> VaultResult<()> {
        client.revoke_token(token).await
    }

    pub async fn revoke_self(client: &VaultClient) -> VaultResult<()> {
        client.revoke_self().await
    }

    pub async fn revoke_token_and_orphans(client: &VaultClient, token: &str) -> VaultResult<()> {
        client.revoke_token_and_orphans(token).await
    }

    pub async fn list_accessors(client: &VaultClient) -> VaultResult<Vec<String>> {
        client.list_accessors().await
    }

    pub async fn lookup_accessor(client: &VaultClient, accessor: &str) -> VaultResult<VaultTokenInfo> {
        client.lookup_accessor(accessor).await
    }
}
