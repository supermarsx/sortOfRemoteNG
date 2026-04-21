use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Field-level operations for 1Password items.
pub struct OnePasswordFields;

impl OnePasswordFields {
    /// Get a specific field from an item by field ID.
    pub async fn get_field(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        field_id: &str,
    ) -> Result<Option<Field>, OnePasswordError> {
        let item = client.get_item(vault_id, item_id).await?;
        Ok(item
            .fields
            .unwrap_or_default()
            .into_iter()
            .find(|f| f.id == field_id))
    }

    /// Get a field by its label.
    pub async fn get_field_by_label(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        label: &str,
    ) -> Result<Option<Field>, OnePasswordError> {
        let item = client.get_item(vault_id, item_id).await?;
        Ok(item
            .fields
            .unwrap_or_default()
            .into_iter()
            .find(|f| f.label.as_deref() == Some(label)))
    }

    /// Get the password field value from an item.
    pub async fn get_password(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<Option<String>, OnePasswordError> {
        let item = client.get_item(vault_id, item_id).await?;
        Ok(item
            .fields
            .unwrap_or_default()
            .into_iter()
            .find(|f| f.purpose == Some(FieldPurpose::PASSWORD))
            .and_then(|f| f.value))
    }

    /// Get the username field value from an item.
    pub async fn get_username(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<Option<String>, OnePasswordError> {
        let item = client.get_item(vault_id, item_id).await?;
        Ok(item
            .fields
            .unwrap_or_default()
            .into_iter()
            .find(|f| f.purpose == Some(FieldPurpose::USERNAME))
            .and_then(|f| f.value))
    }

    /// Get the notes field value from an item.
    pub async fn get_notes(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<Option<String>, OnePasswordError> {
        let item = client.get_item(vault_id, item_id).await?;
        Ok(item
            .fields
            .unwrap_or_default()
            .into_iter()
            .find(|f| f.purpose == Some(FieldPurpose::NOTES))
            .and_then(|f| f.value))
    }

    /// Add a new field to an item via PATCH.
    pub async fn add_field(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        field: &Field,
    ) -> Result<FullItem, OnePasswordError> {
        let ops = vec![PatchOperation {
            op: PatchOp::Add,
            path: "/fields".to_string(),
            value: Some(serde_json::to_value(field).map_err(|e| {
                OnePasswordError::parse_error(format!("Failed to serialize field: {}", e))
            })?),
        }];
        client.patch_item(vault_id, item_id, &ops).await
    }

    /// Update a field's value by field ID via PATCH.
    pub async fn update_field_value(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        field_id: &str,
        new_value: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let ops = vec![PatchOperation {
            op: PatchOp::Replace,
            path: format!("/fields/{}/value", field_id),
            value: Some(serde_json::Value::String(new_value.to_string())),
        }];
        client.patch_item(vault_id, item_id, &ops).await
    }

    /// Update a field's label by field ID via PATCH.
    pub async fn update_field_label(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        field_id: &str,
        new_label: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let ops = vec![PatchOperation {
            op: PatchOp::Replace,
            path: format!("/fields/{}/label", field_id),
            value: Some(serde_json::Value::String(new_label.to_string())),
        }];
        client.patch_item(vault_id, item_id, &ops).await
    }

    /// Remove a field from an item by field ID via PATCH.
    pub async fn remove_field(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        field_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let ops = vec![PatchOperation {
            op: PatchOp::Remove,
            path: format!("/fields/{}", field_id),
            value: None,
        }];
        client.patch_item(vault_id, item_id, &ops).await
    }

    /// List all fields in an item, optionally filtered by type.
    pub async fn list_fields(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        field_type: Option<&FieldType>,
    ) -> Result<Vec<Field>, OnePasswordError> {
        let item = client.get_item(vault_id, item_id).await?;
        let fields = item.fields.unwrap_or_default();
        match field_type {
            Some(ft) => Ok(fields.into_iter().filter(|f| &f.field_type == ft).collect()),
            None => Ok(fields),
        }
    }

    /// List all concealed fields (passwords, secrets).
    pub async fn list_secrets(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<Vec<Field>, OnePasswordError> {
        Self::list_fields(client, vault_id, item_id, Some(&FieldType::CONCEALED)).await
    }
}
