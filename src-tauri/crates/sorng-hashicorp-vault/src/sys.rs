// ── sorng-hashicorp-vault/src/sys.rs ─────────────────────────────────────────
//! System backend operations.

use crate::client::VaultClient;
use crate::error::VaultResult;
use crate::types::*;
use serde_json::Value;

pub struct SysManager;

impl SysManager {
    // ── Seal / Unseal ────────────────────────────────────────────

    pub async fn seal_status(client: &VaultClient) -> VaultResult<VaultSealStatus> {
        client.seal_status().await
    }

    pub async fn seal(client: &VaultClient) -> VaultResult<()> {
        client.seal().await
    }

    pub async fn unseal(
        client: &VaultClient,
        key: &str,
        reset: bool,
        migrate: bool,
    ) -> VaultResult<VaultSealStatus> {
        client.unseal(key, reset, migrate).await
    }

    // ── Health / HA ──────────────────────────────────────────────

    pub async fn health(client: &VaultClient) -> VaultResult<VaultHealthResponse> {
        client.health().await
    }

    pub async fn leader(client: &VaultClient) -> VaultResult<VaultLeader> {
        client.leader().await
    }

    pub async fn ha_status(client: &VaultClient) -> VaultResult<Value> {
        client.ha_status().await
    }

    // ── Secret Engines ───────────────────────────────────────────

    pub async fn list_secret_engines(client: &VaultClient) -> VaultResult<Vec<VaultSecretEngine>> {
        client.list_secret_engines().await
    }

    pub async fn mount_secret_engine(
        client: &VaultClient,
        path: &str,
        engine_type: &str,
        config: Option<&Value>,
    ) -> VaultResult<()> {
        client.mount_secret_engine(path, engine_type, config).await
    }

    pub async fn unmount_secret_engine(client: &VaultClient, path: &str) -> VaultResult<()> {
        client.unmount_secret_engine(path).await
    }

    pub async fn tune_mount(client: &VaultClient, path: &str, config: &Value) -> VaultResult<()> {
        client.tune_mount(path, config).await
    }

    // ── Init / Root ──────────────────────────────────────────────

    pub async fn init_status(client: &VaultClient) -> VaultResult<Value> {
        client.init_status().await
    }

    pub async fn generate_root_status(client: &VaultClient) -> VaultResult<Value> {
        client.generate_root_status().await
    }

    // ── Mounts / Namespaces ──────────────────────────────────────

    pub async fn list_mounts(client: &VaultClient) -> VaultResult<Vec<VaultSecretEngine>> {
        client.list_secret_engines().await
    }

    pub async fn list_namespaces(client: &VaultClient) -> VaultResult<Vec<String>> {
        client.list_namespaces().await
    }
}
