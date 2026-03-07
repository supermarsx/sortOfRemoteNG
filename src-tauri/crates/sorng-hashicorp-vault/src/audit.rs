// ── sorng-hashicorp-vault/src/audit.rs ────────────────────────────────────────
//! Audit device management operations.

use crate::client::VaultClient;
use crate::error::VaultResult;
use crate::types::*;
use serde_json::Value;

pub struct AuditManager;

impl AuditManager {
    pub async fn list_audit_devices(client: &VaultClient) -> VaultResult<Vec<VaultAuditDevice>> {
        client.list_audit_devices().await
    }

    pub async fn enable_audit_device(client: &VaultClient, path: &str, audit_type: &str, options: &Value) -> VaultResult<()> {
        client.enable_audit_device(path, audit_type, options).await
    }

    pub async fn disable_audit_device(client: &VaultClient, path: &str) -> VaultResult<()> {
        client.disable_audit_device(path).await
    }

    pub async fn calculate_hash(client: &VaultClient, path: &str, input: &str) -> VaultResult<String> {
        client.calculate_hash(path, input).await
    }
}
