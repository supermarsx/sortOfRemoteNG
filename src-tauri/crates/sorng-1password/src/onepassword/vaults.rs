use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Vault operations for 1Password Connect.
pub struct OnePasswordVaults;

impl OnePasswordVaults {
    /// List all vaults accessible by the current token.
    pub async fn list(
        client: &OnePasswordApiClient,
        params: &VaultListParams,
    ) -> Result<Vec<Vault>, OnePasswordError> {
        client.list_vaults(params.filter.as_deref()).await
    }

    /// Get a vault by its UUID.
    pub async fn get(
        client: &OnePasswordApiClient,
        vault_id: &str,
    ) -> Result<Vault, OnePasswordError> {
        client.get_vault(vault_id).await
    }

    /// Find a vault by name using SCIM eq filter.
    pub async fn find_by_name(
        client: &OnePasswordApiClient,
        name: &str,
    ) -> Result<Option<Vault>, OnePasswordError> {
        let filter = format!("name eq \"{}\"", name);
        let vaults = client.list_vaults(Some(&filter)).await?;
        Ok(vaults.into_iter().next())
    }

    /// Get vault statistics (item count, versions).
    pub async fn get_stats(
        client: &OnePasswordApiClient,
        vault_id: &str,
    ) -> Result<VaultStats, OnePasswordError> {
        let vault = client.get_vault(vault_id).await?;
        let items = client.list_items(vault_id, None).await?;

        let mut category_counts = std::collections::HashMap::new();
        for item in &items {
            *category_counts
                .entry(item.category.to_string())
                .or_insert(0u64) += 1;
        }

        Ok(VaultStats {
            vault_id: vault.id.clone(),
            vault_name: vault.name.unwrap_or_default(),
            total_items: items.len() as u64,
            attribute_version: vault.attribute_version.unwrap_or(0),
            content_version: vault.content_version.unwrap_or(0),
            category_counts,
        })
    }
}

/// Stats for a vault.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultStats {
    pub vault_id: String,
    pub vault_name: String,
    pub total_items: u64,
    pub attribute_version: i64,
    pub content_version: i64,
    pub category_counts: std::collections::HashMap<String, u64>,
}
