// ── sorng-hashicorp-vault/src/auth_methods.rs ────────────────────────────────
//! Auth method management operations.

use crate::client::VaultClient;
use crate::error::VaultResult;
use crate::types::*;
use serde_json::Value;

pub struct AuthMethodManager;

impl AuthMethodManager {
    // ── Auth method lifecycle ────────────────────────────────────

    pub async fn list_auth_methods(client: &VaultClient) -> VaultResult<Vec<VaultAuthMount>> {
        client.list_auth_methods().await
    }

    pub async fn enable_auth_method(client: &VaultClient, path: &str, auth_type: &str, config: Option<&Value>) -> VaultResult<()> {
        client.enable_auth_method(path, auth_type, config).await
    }

    pub async fn disable_auth_method(client: &VaultClient, path: &str) -> VaultResult<()> {
        client.disable_auth_method(path).await
    }

    pub async fn read_auth_config(client: &VaultClient, path: &str) -> VaultResult<Value> {
        client.read_auth_config(path).await
    }

    pub async fn tune_auth_method(client: &VaultClient, path: &str, config: &Value) -> VaultResult<()> {
        client.tune_auth_method(path, config).await
    }

    // ── Userpass ─────────────────────────────────────────────────

    pub async fn userpass_create_user(client: &VaultClient, mount: &str, username: &str, password: &str, policies: &[String]) -> VaultResult<()> {
        client.userpass_create_user(mount, username, password, policies).await
    }

    pub async fn userpass_read_user(client: &VaultClient, mount: &str, username: &str) -> VaultResult<Value> {
        client.userpass_read_user(mount, username).await
    }

    pub async fn userpass_list_users(client: &VaultClient, mount: &str) -> VaultResult<Vec<String>> {
        client.userpass_list_users(mount).await
    }

    pub async fn userpass_delete_user(client: &VaultClient, mount: &str, username: &str) -> VaultResult<()> {
        client.userpass_delete_user(mount, username).await
    }

    // ── AppRole ──────────────────────────────────────────────────

    pub async fn approle_create_role(client: &VaultClient, mount: &str, name: &str, config: &Value) -> VaultResult<()> {
        client.approle_create_role(mount, name, config).await
    }

    pub async fn approle_read_role(client: &VaultClient, mount: &str, name: &str) -> VaultResult<Value> {
        client.approle_read_role(mount, name).await
    }

    pub async fn approle_list_roles(client: &VaultClient, mount: &str) -> VaultResult<Vec<String>> {
        client.approle_list_roles(mount).await
    }

    pub async fn approle_get_role_id(client: &VaultClient, mount: &str, name: &str) -> VaultResult<String> {
        client.approle_get_role_id(mount, name).await
    }

    pub async fn approle_generate_secret_id(client: &VaultClient, mount: &str, name: &str) -> VaultResult<Value> {
        client.approle_generate_secret_id(mount, name).await
    }
}
