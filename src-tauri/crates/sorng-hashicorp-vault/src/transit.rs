// ── sorng-hashicorp-vault/src/transit.rs ──────────────────────────────────────
//! Transit secrets engine operations.

use crate::client::VaultClient;
use crate::error::VaultResult;
use crate::types::*;
use serde_json::Value;

pub struct TransitManager;

impl TransitManager {
    pub async fn create_key(client: &VaultClient, name: &str, key_type: Option<&str>) -> VaultResult<()> {
        client.transit_create_key(name, key_type).await
    }

    pub async fn read_key(client: &VaultClient, name: &str) -> VaultResult<VaultTransitKey> {
        client.transit_read_key(name).await
    }

    pub async fn list_keys(client: &VaultClient) -> VaultResult<Vec<String>> {
        client.transit_list_keys().await
    }

    pub async fn delete_key(client: &VaultClient, name: &str) -> VaultResult<()> {
        client.transit_delete_key(name).await
    }

    pub async fn update_key_config(client: &VaultClient, name: &str, config: &VaultTransitKeyConfig) -> VaultResult<()> {
        client.transit_update_key_config(name, config).await
    }

    pub async fn rotate_key(client: &VaultClient, name: &str) -> VaultResult<()> {
        client.transit_rotate_key(name).await
    }

    pub async fn encrypt(client: &VaultClient, name: &str, plaintext: &str, context: Option<&str>) -> VaultResult<VaultEncryptResponse> {
        client.transit_encrypt(name, plaintext, context).await
    }

    pub async fn decrypt(client: &VaultClient, name: &str, ciphertext: &str, context: Option<&str>) -> VaultResult<VaultDecryptResponse> {
        client.transit_decrypt(name, ciphertext, context).await
    }

    pub async fn rewrap(client: &VaultClient, name: &str, ciphertext: &str) -> VaultResult<VaultEncryptResponse> {
        client.transit_rewrap(name, ciphertext).await
    }

    pub async fn generate_data_key(client: &VaultClient, name: &str, key_type: &str) -> VaultResult<Value> {
        client.transit_generate_data_key(name, key_type).await
    }

    pub async fn sign(client: &VaultClient, name: &str, input: &str) -> VaultResult<Value> {
        client.transit_sign(name, input).await
    }

    pub async fn verify(client: &VaultClient, name: &str, input: &str, signature: &str) -> VaultResult<Value> {
        client.transit_verify(name, input, signature).await
    }

    pub async fn hash(client: &VaultClient, input: &str, algorithm: Option<&str>) -> VaultResult<Value> {
        client.transit_hash(input, algorithm).await
    }
}
