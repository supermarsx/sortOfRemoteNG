use super::api_client::OnePasswordApiClient;
use super::types::*;

/// TOTP (Time-based One-Time Password) operations for 1Password items.
///
/// Items with a TOTP field (type = "TOTP") contain a `otpauth://` URI
/// in their value. The Connect API automatically generates the current
/// TOTP code when you retrieve the item's TOTP field via GET.
pub struct OnePasswordTotp;

impl OnePasswordTotp {
    /// Get the current TOTP code for an item.
    ///
    /// The Connect server calculates the code based on the stored TOTP
    /// secret — the field's `value` will contain the current OTP code.
    pub async fn get_code(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<Option<TotpCode>, OnePasswordError> {
        let item = client.get_item(vault_id, item_id).await?;
        let fields = item.fields.unwrap_or_default();

        let totp_field = fields.iter().find(|f| f.field_type == FieldType::TOTP);
        match totp_field {
            Some(field) => {
                let code = field.value.clone().unwrap_or_default();
                Ok(Some(TotpCode {
                    code,
                    expires_in_seconds: 30, // Standard TOTP period
                    period: 30,
                }))
            }
            None => Ok(None),
        }
    }

    /// Check if an item has a TOTP field configured.
    pub async fn has_totp(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<bool, OnePasswordError> {
        let item = client.get_item(vault_id, item_id).await?;
        Ok(item
            .fields
            .unwrap_or_default()
            .iter()
            .any(|f| f.field_type == FieldType::TOTP))
    }

    /// Add a TOTP field to an item.
    pub async fn add_totp(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        totp_uri: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let field = Field {
            id: uuid::Uuid::new_v4().to_string(),
            section: None,
            field_type: FieldType::TOTP,
            purpose: None,
            label: Some("one-time password".to_string()),
            value: Some(totp_uri.to_string()),
            generate: None,
            recipe: None,
            entropy: None,
        };

        let ops = vec![PatchOperation {
            op: PatchOp::Add,
            path: "/fields".to_string(),
            value: Some(serde_json::to_value(&field).map_err(|e| {
                OnePasswordError::parse_error(format!("Failed to serialize TOTP field: {}", e))
            })?),
        }];

        client.patch_item(vault_id, item_id, &ops).await
    }

    /// Remove a TOTP field from an item.
    pub async fn remove_totp(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let item = client.get_item(vault_id, item_id).await?;
        let fields = item.fields.unwrap_or_default();

        let totp_field = fields
            .iter()
            .find(|f| f.field_type == FieldType::TOTP)
            .ok_or_else(|| {
                OnePasswordError::not_found("TOTP field", item_id)
            })?;

        let ops = vec![PatchOperation {
            op: PatchOp::Remove,
            path: format!("/fields/{}", totp_field.id),
            value: None,
        }];

        client.patch_item(vault_id, item_id, &ops).await
    }

    /// List all items with TOTP fields across all vaults.
    pub async fn list_totp_items(
        client: &OnePasswordApiClient,
    ) -> Result<Vec<(String, Item)>, OnePasswordError> {
        let vaults = client.list_vaults(None).await?;
        let mut results = Vec::new();

        for vault in &vaults {
            let items = client.list_items(&vault.id, None).await?;
            for item in items {
                if let Some(id) = &item.id {
                    if let Ok(full) = client.get_item(&vault.id, id).await {
                        if full
                            .fields
                            .as_ref()
                            .map(|f| f.iter().any(|field| field.field_type == FieldType::TOTP))
                            .unwrap_or(false)
                        {
                            results.push((
                                vault.id.clone(),
                                Item {
                                    id: full.id,
                                    title: full.title,
                                    vault: full.vault,
                                    category: full.category,
                                    urls: full.urls,
                                    favorite: full.favorite,
                                    tags: full.tags,
                                    version: full.version,
                                    state: full.state,
                                    created_at: full.created_at,
                                    updated_at: full.updated_at,
                                    last_edited_by: full.last_edited_by,
                                },
                            ));
                        }
                    }
                }
            }
        }

        Ok(results)
    }
}
