use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Sharing and vault access management.
pub struct OnePasswordSharing;

impl OnePasswordSharing {
    /// List vaults and their access permissions.
    /// Note: Connect API scopes vaults based on the token — this returns
    /// the vaults the token has access to.
    pub async fn list_accessible_vaults(
        client: &OnePasswordApiClient,
    ) -> Result<Vec<VaultAccess>, OnePasswordError> {
        let vaults = client.list_vaults(None).await?;
        Ok(vaults
            .iter()
            .map(|v| VaultAccess {
                vault_id: v.id.clone(),
                permissions: Vec::new(),
            })
            .collect())
    }

    /// Check if the token has read access to a specific vault.
    pub async fn can_access_vault(
        client: &OnePasswordApiClient,
        vault_id: &str,
    ) -> Result<bool, OnePasswordError> {
        match client.get_vault(vault_id).await {
            Ok(_) => Ok(true),
            Err(e) if e.kind == OnePasswordErrorKind::Forbidden => Ok(false),
            Err(e)
                if e.kind == OnePasswordErrorKind::NotFound
                    || e.kind == OnePasswordErrorKind::VaultNotFound =>
            {
                Ok(false)
            }
            Err(e) => Err(e),
        }
    }

    /// Check if the token can write to a vault by attempting an operation check.
    pub async fn can_write_vault(
        client: &OnePasswordApiClient,
        vault_id: &str,
    ) -> Result<bool, OnePasswordError> {
        client.get_vault(vault_id).await?;
        Err(OnePasswordError::config_error(
            "Connect does not expose a non-mutating write-permission check",
        ))
    }
}
