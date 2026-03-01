use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Item CRUD operations for 1Password Connect.
pub struct OnePasswordItems;

impl OnePasswordItems {
    /// List all items in a vault (summary only — no fields/files).
    pub async fn list(
        client: &OnePasswordApiClient,
        vault_id: &str,
        params: &ItemListParams,
    ) -> Result<Vec<Item>, OnePasswordError> {
        client.list_items(vault_id, params.filter.as_deref()).await
    }

    /// Get full item details including fields, sections, & files.
    pub async fn get(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        client.get_item(vault_id, item_id).await
    }

    /// Find items by title using SCIM eq filter.
    pub async fn find_by_title(
        client: &OnePasswordApiClient,
        vault_id: &str,
        title: &str,
    ) -> Result<Vec<Item>, OnePasswordError> {
        let filter = format!("title eq \"{}\"", title);
        client.list_items(vault_id, Some(&filter)).await
    }

    /// Create a new item in the given vault.
    pub async fn create(
        client: &OnePasswordApiClient,
        vault_id: &str,
        request: &CreateItemRequest,
    ) -> Result<FullItem, OnePasswordError> {
        let full_item = FullItem {
            id: None,
            title: Some(request.title.clone()),
            vault: request.vault.clone(),
            category: request.category.clone(),
            urls: request.urls.clone(),
            favorite: request.favorite,
            tags: request.tags.clone(),
            version: None,
            state: None,
            created_at: None,
            updated_at: None,
            last_edited_by: None,
            sections: request.sections.clone(),
            fields: request.fields.clone(),
            files: None,
        };
        client.create_item(vault_id, &full_item).await
    }

    /// Replace an entire item (full PUT).
    pub async fn update(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        request: &UpdateItemRequest,
    ) -> Result<FullItem, OnePasswordError> {
        let full_item = FullItem {
            id: Some(request.id.clone()),
            title: request.title.clone(),
            vault: request.vault.clone(),
            category: request.category.clone(),
            urls: request.urls.clone(),
            favorite: request.favorite,
            tags: request.tags.clone(),
            version: None,
            state: None,
            created_at: None,
            updated_at: None,
            last_edited_by: None,
            sections: request.sections.clone(),
            fields: request.fields.clone(),
            files: None,
        };
        client.update_item(vault_id, item_id, &full_item).await
    }

    /// Patch an item with a partial update (RFC6902 subset).
    pub async fn patch(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        operations: &[PatchOperation],
    ) -> Result<FullItem, OnePasswordError> {
        client.patch_item(vault_id, item_id, operations).await
    }

    /// Delete an item from a vault.
    pub async fn delete(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<(), OnePasswordError> {
        client.delete_item(vault_id, item_id).await
    }

    /// Move an item to the trash (sets state to ARCHIVED).
    pub async fn archive(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let ops = vec![PatchOperation {
            op: PatchOp::Replace,
            path: "/state".to_string(),
            value: Some(serde_json::Value::String("ARCHIVED".to_string())),
        }];
        client.patch_item(vault_id, item_id, &ops).await
    }

    /// Restore an archived item.
    pub async fn restore(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let ops = vec![PatchOperation {
            op: PatchOp::Remove,
            path: "/state".to_string(),
            value: None,
        }];
        client.patch_item(vault_id, item_id, &ops).await
    }

    /// Toggle favorite status on an item.
    pub async fn toggle_favorite(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        favorite: bool,
    ) -> Result<FullItem, OnePasswordError> {
        let ops = vec![PatchOperation {
            op: PatchOp::Replace,
            path: "/favorite".to_string(),
            value: Some(serde_json::Value::Bool(favorite)),
        }];
        client.patch_item(vault_id, item_id, &ops).await
    }

    /// Add a tag to an item.
    pub async fn add_tag(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        tag: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let ops = vec![PatchOperation {
            op: PatchOp::Add,
            path: "/tags/-".to_string(),
            value: Some(serde_json::Value::String(tag.to_string())),
        }];
        client.patch_item(vault_id, item_id, &ops).await
    }

    /// Remove a tag from an item by array index.
    pub async fn remove_tag(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        tag_index: usize,
    ) -> Result<FullItem, OnePasswordError> {
        let ops = vec![PatchOperation {
            op: PatchOp::Remove,
            path: format!("/tags/{}", tag_index),
            value: None,
        }];
        client.patch_item(vault_id, item_id, &ops).await
    }

    /// List items of a specific category in a vault.
    pub async fn list_by_category(
        client: &OnePasswordApiClient,
        vault_id: &str,
        category: &ItemCategory,
    ) -> Result<Vec<Item>, OnePasswordError> {
        let all = client.list_items(vault_id, None).await?;
        Ok(all
            .into_iter()
            .filter(|item| &item.category == category)
            .collect())
    }

    /// Search items across all vaults by title substring.
    pub async fn search_all_vaults(
        client: &OnePasswordApiClient,
        query: &str,
    ) -> Result<Vec<(String, Item)>, OnePasswordError> {
        let vaults = client.list_vaults(None).await?;
        let mut results = Vec::new();
        let query_lower = query.to_lowercase();

        for vault in &vaults {
            let items = client.list_items(&vault.id, None).await?;
            for item in items {
                if let Some(title) = &item.title {
                    if title.to_lowercase().contains(&query_lower) {
                        results.push((vault.id.clone(), item));
                    }
                }
            }
        }
        Ok(results)
    }
}
