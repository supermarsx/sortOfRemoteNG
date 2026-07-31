use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Favorites management for 1Password items.
pub struct OnePasswordFavorites;

impl OnePasswordFavorites {
    /// List all favorite items across all vaults.
    pub async fn list_all(
        client: &OnePasswordApiClient,
    ) -> Result<Vec<FavoriteItem>, OnePasswordError> {
        let deadline = super::api_client::operation_deadline();
        let vaults =
            super::api_client::within_operation_deadline(deadline, client.list_vaults(None))
                .await?;
        if vaults.len() > super::api_client::MAX_SCAN_VAULTS {
            return Err(OnePasswordError::server_error(
                "Favorite scan exceeds the configured vault limit",
            ));
        }
        let mut favorites = Vec::new();
        let mut scanned = 0usize;

        for vault in &vaults {
            let items = super::api_client::within_operation_deadline(
                deadline,
                client.list_items(&vault.id, None),
            )
            .await?;
            scanned = scanned.saturating_add(items.len());
            if scanned > super::api_client::MAX_SCAN_ITEMS {
                return Err(OnePasswordError::server_error(
                    "Favorite scan exceeds the configured item limit",
                ));
            }
            for item in items {
                if item.favorite == Some(true) {
                    favorites.push(Self::validated_favorite(item, &vault.id)?);
                }
            }
        }

        Ok(favorites)
    }

    /// List favorite items in a specific vault.
    pub async fn list_in_vault(
        client: &OnePasswordApiClient,
        vault_id: &str,
    ) -> Result<Vec<FavoriteItem>, OnePasswordError> {
        let deadline = super::api_client::operation_deadline();
        let items = super::api_client::within_operation_deadline(
            deadline,
            client.list_items(vault_id, None),
        )
        .await?;
        if items.len() > super::api_client::MAX_SCAN_ITEMS {
            return Err(OnePasswordError::server_error(
                "Favorite scan exceeds the configured item limit",
            ));
        }
        items
            .into_iter()
            .filter(|item| item.favorite == Some(true))
            .map(|item| Self::validated_favorite(item, vault_id))
            .collect()
    }

    /// Add an item to favorites.
    pub async fn add(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        super::items::OnePasswordItems::toggle_favorite(client, vault_id, item_id, true).await
    }

    /// Remove an item from favorites.
    pub async fn remove(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        super::items::OnePasswordItems::toggle_favorite(client, vault_id, item_id, false).await
    }

    fn validated_favorite(item: Item, vault_id: &str) -> Result<FavoriteItem, OnePasswordError> {
        let item_id = item.id.ok_or_else(|| {
            OnePasswordError::parse_error("Favorite item is missing its identifier")
        })?;
        OnePasswordApiClient::validate_identifier(&item_id, "Favorite item identifier")?;
        let title = item
            .title
            .filter(|title| {
                !title.is_empty() && title.len() <= 1_024 && !title.chars().any(char::is_control)
            })
            .ok_or_else(|| OnePasswordError::parse_error("Favorite item has an invalid title"))?;
        Ok(FavoriteItem {
            item_id,
            vault_id: vault_id.to_string(),
            title,
            category: item.category,
            favorited_at: item.updated_at,
        })
    }
}
