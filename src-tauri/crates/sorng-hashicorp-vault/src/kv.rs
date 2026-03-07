// ── sorng-hashicorp-vault/src/kv.rs ──────────────────────────────────────────
//! KV secrets engine v2 operations.

use crate::client::VaultClient;
use crate::error::VaultResult;
use crate::types::*;
use serde_json::Value;

pub struct KvManager;

impl KvManager {
    pub async fn read_secret(client: &VaultClient, mount: &str, path: &str) -> VaultResult<VaultKvEntry> {
        client.kv_read(mount, path).await
    }

    pub async fn write_secret(client: &VaultClient, mount: &str, path: &str, data: Value) -> VaultResult<Value> {
        client.kv_write(mount, path, data).await
    }

    pub async fn delete_secret(client: &VaultClient, mount: &str, path: &str) -> VaultResult<()> {
        client.kv_delete(mount, path).await
    }

    pub async fn undelete_secret(client: &VaultClient, mount: &str, path: &str, versions: Vec<u64>) -> VaultResult<()> {
        client.kv_undelete(mount, path, versions).await
    }

    pub async fn destroy_secret(client: &VaultClient, mount: &str, path: &str, versions: Vec<u64>) -> VaultResult<()> {
        client.kv_destroy(mount, path, versions).await
    }

    pub async fn list_secrets(client: &VaultClient, mount: &str, path: &str) -> VaultResult<Vec<String>> {
        client.kv_list(mount, path).await
    }

    pub async fn read_metadata(client: &VaultClient, mount: &str, path: &str) -> VaultResult<VaultKvMetadata> {
        client.kv_read_metadata(mount, path).await
    }

    pub async fn delete_metadata(client: &VaultClient, mount: &str, path: &str) -> VaultResult<()> {
        client.kv_delete_metadata(mount, path).await
    }
}
