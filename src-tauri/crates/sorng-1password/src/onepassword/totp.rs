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
                if !(4..=10).contains(&code.len())
                    || !code.bytes().all(|byte| byte.is_ascii_digit())
                {
                    return Err(OnePasswordError::parse_error(
                        "Connect server returned an invalid TOTP code",
                    ));
                }
                Ok(Some(TotpCode {
                    code,
                    expires_in_seconds: None,
                    period: None,
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
        if totp_uri.len() > 4096 {
            return Err(OnePasswordError::bad_request("TOTP URI is too large"));
        }
        let parsed = url::Url::parse(totp_uri)
            .map_err(|_| OnePasswordError::bad_request("TOTP URI is invalid"))?;
        let valid_secret = parsed
            .query_pairs()
            .any(|(key, value)| key == "secret" && !value.is_empty() && value.len() <= 1024);
        if parsed.scheme() != "otpauth"
            || parsed.host_str() != Some("totp")
            || parsed.username() != ""
            || parsed.password().is_some()
            || parsed.fragment().is_some()
            || !valid_secret
        {
            return Err(OnePasswordError::bad_request(
                "TOTP URI must be a valid otpauth://totp URI with a bounded secret",
            ));
        }
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
            .ok_or_else(|| OnePasswordError::not_found("TOTP field", item_id))?;

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
        let deadline = super::api_client::operation_deadline();
        let vaults =
            super::api_client::within_operation_deadline(deadline, client.list_vaults(None))
                .await?;
        if vaults.len() > super::api_client::MAX_SCAN_VAULTS {
            return Err(OnePasswordError::server_error(
                "TOTP scan exceeds the configured vault limit",
            ));
        }
        let mut results = Vec::new();
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
                    "TOTP scan exceeds the configured item limit",
                ));
            }
            for item in items {
                let id = item.id.as_deref().ok_or_else(|| {
                    OnePasswordError::parse_error("Connect item is missing its identifier")
                })?;
                let full = super::api_client::within_operation_deadline(
                    deadline,
                    client.get_item(&vault.id, id),
                )
                .await?;
                if full
                    .fields
                    .as_ref()
                    .map(|fields| {
                        fields
                            .iter()
                            .any(|field| field.field_type == FieldType::TOTP)
                    })
                    .unwrap_or(false)
                {
                    let full_id = full.id.clone().ok_or_else(|| {
                        OnePasswordError::parse_error("TOTP item is missing its identifier")
                    })?;
                    OnePasswordApiClient::validate_identifier(&full_id, "TOTP item identifier")?;
                    let title = full
                        .title
                        .clone()
                        .filter(|title| {
                            !title.is_empty()
                                && title.len() <= 1_024
                                && !title.chars().any(char::is_control)
                        })
                        .ok_or_else(|| {
                            OnePasswordError::parse_error("TOTP item has an invalid title")
                        })?;
                    results.push((
                        vault.id.clone(),
                        Item {
                            id: Some(full_id),
                            title: Some(title),
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

        Ok(results)
    }
}
