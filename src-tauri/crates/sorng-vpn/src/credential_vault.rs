//! Credential vault for VPN/proxy services.
//! Wraps sorng-vault's keychain API for storing/retrieving connection credentials.

use serde::{Deserialize, Serialize};

const VAULT_SERVICE: &str = "com.sortofremoteng.vpn";

/// Reference to a credential stored in the OS vault or inline (for backward compat).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CredentialRef {
    /// Credential stored in the OS keyring/vault
    VaultRef { service: String, account: String },
    /// Inline credential (legacy, migrated to VaultRef on next persist)
    Inline(String),
}

impl CredentialRef {
    /// Create a vault reference for a connection field.
    pub fn vault_ref(connection_id: &str, field: &str) -> Self {
        CredentialRef::VaultRef {
            service: VAULT_SERVICE.to_string(),
            account: format!("{}:{}", connection_id, field),
        }
    }
}

/// Store a credential in the OS vault.
/// Returns a CredentialRef pointing to the stored credential.
pub async fn store_credential(
    connection_id: &str,
    field: &str,
    secret: &str,
) -> Result<CredentialRef, String> {
    let account = format!("{}:{}", connection_id, field);
    sorng_vault::keychain::store(VAULT_SERVICE, &account, secret)
        .await
        .map_err(|e| format!("Failed to store credential: {}", e))?;
    Ok(CredentialRef::VaultRef {
        service: VAULT_SERVICE.to_string(),
        account,
    })
}

/// Read a credential from the OS vault or inline value.
pub async fn read_credential(cred_ref: &CredentialRef) -> Result<String, String> {
    match cred_ref {
        CredentialRef::VaultRef { service, account } => {
            sorng_vault::keychain::read(service, account)
                .await
                .map_err(|e| format!("Failed to read credential: {}", e))
        }
        CredentialRef::Inline(value) => Ok(value.clone()),
    }
}

/// Delete a credential from the OS vault.
pub async fn delete_credential(cred_ref: &CredentialRef) -> Result<(), String> {
    match cred_ref {
        CredentialRef::VaultRef { service, account } => {
            sorng_vault::keychain::delete(service, account)
                .await
                .map_err(|e| format!("Failed to delete credential: {}", e))
        }
        CredentialRef::Inline(_) => Ok(()), // Nothing to delete for inline
    }
}
