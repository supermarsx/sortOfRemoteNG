use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Favorites management for 1Password items.
pub struct OnePasswordFavorites;

impl OnePasswordFavorites {
    /// List all favorite items across all vaults.
    pub async fn list_all(
        client: &OnePasswordApiClient,
    ) -> Result<Vec<FavoriteItem>, OnePasswordError> {
        let vaults = client.list_vaults(None).await?;
        let mut favorites = Vec::new();

        for vault in &vaults {
            let items = client.list_items(&vault.id, None).await?;
            for item in items {
                if item.favorite == Some(true) {
                    favorites.push(FavoriteItem {
                        item_id: item.id.clone().unwrap_or_default(),
                        vault_id: vault.id.clone(),
                        title: item.title.clone().unwrap_or_default(),
                        category: item.category.clone(),
                        favorited_at: item.updated_at.clone(),
                    });
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
        let items = client.list_items(vault_id, None).await?;
        Ok(items
            .into_iter()
            .filter(|i| i.favorite == Some(true))
            .map(|item| FavoriteItem {
                item_id: item.id.clone().unwrap_or_default(),
                vault_id: vault_id.to_string(),
                title: item.title.clone().unwrap_or_default(),
                category: item.category.clone(),
                favorited_at: item.updated_at.clone(),
            })
            .collect())
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
}
