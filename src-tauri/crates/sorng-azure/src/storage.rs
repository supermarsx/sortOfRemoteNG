//! Azure Storage Accounts – list, get, create, delete, list keys,
//! regenerate keys, list containers, delete containers.

use std::collections::HashMap;

use log::debug;

use crate::client::AzureClient;
use crate::types::{
    AzureResult, BlobContainer, CreateStorageAccountRequest, StorageAccount,
    StorageAccountKey, StorageKeyList,
};

/// List all storage accounts in the subscription.
pub async fn list_storage_accounts(client: &AzureClient) -> AzureResult<Vec<StorageAccount>> {
    let api = &client.config().api_version_storage;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Storage/storageAccounts?api-version={}",
        api
    ))?;
    debug!("list_storage_accounts → {}", url);
    client.get_all_pages(&url).await
}

/// List storage accounts in a resource group.
pub async fn list_storage_accounts_in_rg(
    client: &AzureClient,
    resource_group: &str,
) -> AzureResult<Vec<StorageAccount>> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts?api-version={}",
            api
        ),
    )?;
    debug!("list_storage_accounts_in_rg({}) → {}", resource_group, url);
    client.get_all_pages(&url).await
}

/// Get a single storage account.
pub async fn get_storage_account(
    client: &AzureClient,
    resource_group: &str,
    account_name: &str,
) -> AzureResult<StorageAccount> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts/{}?api-version={}",
            account_name, api
        ),
    )?;
    debug!("get_storage_account({}/{}) → {}", resource_group, account_name, url);
    client.get_json(&url).await
}

/// Create a storage account.
pub async fn create_storage_account(
    client: &AzureClient,
    resource_group: &str,
    account_name: &str,
    request: &CreateStorageAccountRequest,
) -> AzureResult<StorageAccount> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts/{}?api-version={}",
            account_name, api
        ),
    )?;
    debug!("create_storage_account({}/{}) → {}", resource_group, account_name, url);
    client.put_json(&url, request).await
}

/// Delete a storage account.
pub async fn delete_storage_account(
    client: &AzureClient,
    resource_group: &str,
    account_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts/{}?api-version={}",
            account_name, api
        ),
    )?;
    debug!("delete_storage_account({}/{}) → {}", resource_group, account_name, url);
    client.delete(&url).await
}

/// List storage account access keys.
pub async fn list_keys(
    client: &AzureClient,
    resource_group: &str,
    account_name: &str,
) -> AzureResult<Vec<StorageAccountKey>> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts/{}/listKeys?api-version={}",
            account_name, api
        ),
    )?;
    debug!("list_keys({}/{}) → {}", resource_group, account_name, url);
    let resp: StorageKeyList = client.post_json(&url, &serde_json::json!({})).await?;
    Ok(resp.keys)
}

/// Regenerate a specific storage account key.
pub async fn regenerate_key(
    client: &AzureClient,
    resource_group: &str,
    account_name: &str,
    key_name: &str,
) -> AzureResult<Vec<StorageAccountKey>> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts/{}/regenerateKey?api-version={}",
            account_name, api
        ),
    )?;
    debug!("regenerate_key({}/{}/{}) → {}", resource_group, account_name, key_name, url);
    let body = serde_json::json!({ "keyName": key_name });
    let resp: StorageKeyList = client.post_json(&url, &body).await?;
    Ok(resp.keys)
}

/// List blob containers in a storage account.
pub async fn list_containers(
    client: &AzureClient,
    resource_group: &str,
    account_name: &str,
) -> AzureResult<Vec<BlobContainer>> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts/{}/blobServices/default/containers?api-version={}",
            account_name, api
        ),
    )?;
    debug!("list_containers({}/{}) → {}", resource_group, account_name, url);
    client.get_all_pages(&url).await
}

/// Get a single blob container.
pub async fn get_container(
    client: &AzureClient,
    resource_group: &str,
    account_name: &str,
    container_name: &str,
) -> AzureResult<BlobContainer> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts/{}/blobServices/default/containers/{}?api-version={}",
            account_name, container_name, api
        ),
    )?;
    debug!("get_container({}/{}/{}) → {}", resource_group, account_name, container_name, url);
    client.get_json(&url).await
}

/// Create a blob container.
pub async fn create_container(
    client: &AzureClient,
    resource_group: &str,
    account_name: &str,
    container_name: &str,
    public_access: Option<&str>,
) -> AzureResult<BlobContainer> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts/{}/blobServices/default/containers/{}?api-version={}",
            account_name, container_name, api
        ),
    )?;
    debug!("create_container({}/{}/{}) → {}", resource_group, account_name, container_name, url);
    let body = if let Some(access) = public_access {
        serde_json::json!({
            "properties": { "publicAccess": access }
        })
    } else {
        serde_json::json!({
            "properties": { "publicAccess": "None" }
        })
    };
    client.put_json(&url, &body).await
}

/// Delete a blob container.
pub async fn delete_container(
    client: &AzureClient,
    resource_group: &str,
    account_name: &str,
    container_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts/{}/blobServices/default/containers/{}?api-version={}",
            account_name, container_name, api
        ),
    )?;
    debug!("delete_container({}/{}/{}) → {}", resource_group, account_name, container_name, url);
    client.delete(&url).await
}

/// Update storage account tags.
pub async fn update_tags(
    client: &AzureClient,
    resource_group: &str,
    account_name: &str,
    tags: &HashMap<String, String>,
) -> AzureResult<StorageAccount> {
    let api = &client.config().api_version_storage;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Storage/storageAccounts/{}?api-version={}",
            account_name, api
        ),
    )?;
    debug!("update_tags({}/{}) → {}", resource_group, account_name, url);
    let body = serde_json::json!({ "tags": tags });
    client.patch_json(&url, &body).await
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AzureCredentials, StorageSku};

    #[test]
    fn create_request_serde() {
        let r = CreateStorageAccountRequest {
            location: "eastus".into(),
            kind: "StorageV2".into(),
            sku: StorageSku {
                name: Some("Standard_LRS".into()),
                tier: Some("Standard".into()),
            },
            tags: HashMap::new(),
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("StorageV2"));
        assert!(json.contains("Standard_LRS"));
    }

    #[test]
    fn storage_account_deserialization() {
        let json = r#"{"id":"x","name":"mystorage","location":"eastus","kind":"StorageV2","tags":{},"sku":{"name":"Standard_LRS","tier":"Standard"}}"#;
        let sa: StorageAccount = serde_json::from_str(json).unwrap();
        assert_eq!(sa.name, "mystorage");
        assert_eq!(sa.kind, Some("StorageV2".into()));
        assert_eq!(sa.sku.unwrap().name, Some("Standard_LRS".into()));
    }

    #[test]
    fn key_list_deserialization() {
        let json = r#"{"keys":[{"keyName":"key1","value":"abc123","permissions":"Full"},{"keyName":"key2","value":"def456","permissions":"Full"}]}"#;
        let kl: StorageKeyList = serde_json::from_str(json).unwrap();
        assert_eq!(kl.keys.len(), 2);
        assert_eq!(kl.keys[0].key_name, "key1");
    }

    #[test]
    fn container_deserialization() {
        let json = r#"{"id":"x","name":"mycontainer","properties":{"publicAccess":"None"}}"#;
        let c: BlobContainer = serde_json::from_str(json).unwrap();
        assert_eq!(c.name, "mycontainer");
    }

    #[test]
    fn url_patterns() {
        let mut c = AzureClient::new();
        c.set_credentials(AzureCredentials {
            subscription_id: "s1".into(),
            ..Default::default()
        });
        let url = c
            .resource_group_url("rg1", "/providers/Microsoft.Storage/storageAccounts?api-version=2023-05-01")
            .unwrap();
        assert!(url.contains("/resourceGroups/rg1/"));
        assert!(url.contains("storageAccounts"));
    }
}
