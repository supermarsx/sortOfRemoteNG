//! Azure Resource Groups – list, get, create, update, delete, export template,
//! list resources within a resource group.

use log::debug;

use crate::client::AzureClient;
use crate::types::{
    ArmList, AzureResource, AzureResult, CreateResourceGroupRequest, ResourceGroup,
};

/// List all resource groups in the subscription.
pub async fn list_resource_groups(client: &AzureClient) -> AzureResult<Vec<ResourceGroup>> {
    let api = &client.config().api_version_resources;
    let url = client.subscription_url(&format!(
        "/resourcegroups?api-version={}",
        api
    ))?;
    debug!("list_resource_groups → {}", url);
    client.get_all_pages(&url).await
}

/// Get a single resource group by name.
pub async fn get_resource_group(
    client: &AzureClient,
    name: &str,
) -> AzureResult<ResourceGroup> {
    let api = &client.config().api_version_resources;
    let url = client.subscription_url(&format!(
        "/resourcegroups/{}?api-version={}",
        name, api
    ))?;
    debug!("get_resource_group({}) → {}", name, url);
    client.get_json(&url).await
}

/// Create or update a resource group.
pub async fn create_resource_group(
    client: &AzureClient,
    name: &str,
    request: &CreateResourceGroupRequest,
) -> AzureResult<ResourceGroup> {
    let api = &client.config().api_version_resources;
    let url = client.subscription_url(&format!(
        "/resourcegroups/{}?api-version={}",
        name, api
    ))?;
    debug!("create_resource_group({}) → {}", name, url);
    client.put_json(&url, request).await
}

/// Update resource group tags.
pub async fn update_resource_group_tags(
    client: &AzureClient,
    name: &str,
    tags: &std::collections::HashMap<String, String>,
) -> AzureResult<ResourceGroup> {
    let api = &client.config().api_version_resources;
    let url = client.subscription_url(&format!(
        "/resourcegroups/{}?api-version={}",
        name, api
    ))?;
    debug!("update_resource_group_tags({}) → {}", name, url);
    let body = serde_json::json!({ "tags": tags });
    client.patch_json(&url, &body).await
}

/// Delete a resource group (and all its resources).
pub async fn delete_resource_group(
    client: &AzureClient,
    name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_resources;
    let url = client.subscription_url(&format!(
        "/resourcegroups/{}?api-version={}",
        name, api
    ))?;
    debug!("delete_resource_group({}) → {}", name, url);
    client.delete(&url).await
}

/// Export the ARM template for a resource group.
pub async fn export_template(
    client: &AzureClient,
    name: &str,
) -> AzureResult<serde_json::Value> {
    let api = &client.config().api_version_resources;
    let url = client.subscription_url(&format!(
        "/resourcegroups/{}/exportTemplate?api-version={}",
        name, api
    ))?;
    debug!("export_template({}) → {}", name, url);
    let body = serde_json::json!({ "resources": ["*"], "options": "IncludeParameterDefaultValue" });
    client.post_json(&url, &body).await
}

/// List resources within a resource group.
pub async fn list_resources_in_rg(
    client: &AzureClient,
    resource_group: &str,
) -> AzureResult<Vec<AzureResource>> {
    let api = &client.config().api_version_resources;
    let url = client.resource_group_url(
        resource_group,
        &format!("/resources?api-version={}", api),
    )?;
    debug!("list_resources_in_rg({}) → {}", resource_group, url);
    client.get_all_pages(&url).await
}

/// List all resources in the subscription.
pub async fn list_all_resources(client: &AzureClient) -> AzureResult<Vec<AzureResource>> {
    let api = &client.config().api_version_resources;
    let url = client.subscription_url(&format!(
        "/resources?api-version={}",
        api
    ))?;
    debug!("list_all_resources → {}", url);
    client.get_all_pages(&url).await
}

/// Check if a resource group exists (HEAD).
pub async fn exists(
    client: &AzureClient,
    name: &str,
) -> AzureResult<bool> {
    match get_resource_group(client, name).await {
        Ok(_) => Ok(true),
        Err(e) if e.kind == crate::types::AzureErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AzureCredentials;

    #[test]
    fn url_construction() {
        let mut c = AzureClient::new();
        c.set_credentials(AzureCredentials {
            subscription_id: "sub1".into(),
            ..Default::default()
        });
        let url = c.subscription_url("/resourcegroups?api-version=2024-03-01").unwrap();
        assert!(url.contains("/subscriptions/sub1/resourcegroups"));
    }

    #[test]
    fn create_rg_request_serde() {
        let r = CreateResourceGroupRequest {
            location: "eastus".into(),
            tags: std::collections::HashMap::new(),
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("eastus"));
    }

    #[test]
    fn rg_deserialization() {
        let json = r#"{"id":"/subscriptions/sub1/resourceGroups/rg1","name":"rg1","location":"eastus","tags":{},"properties":{"provisioningState":"Succeeded"}}"#;
        let rg: ResourceGroup = serde_json::from_str(json).unwrap();
        assert_eq!(rg.name, "rg1");
        assert_eq!(rg.properties.unwrap().provisioning_state, Some("Succeeded".into()));
    }

    #[test]
    fn rg_list_deserialization() {
        let json = r#"{"value":[{"id":"x","name":"rg1","location":"eastus","tags":{}}]}"#;
        let list: ArmList<ResourceGroup> = serde_json::from_str(json).unwrap();
        assert_eq!(list.value.len(), 1);
        assert!(list.next_link.is_none());
    }

    #[test]
    fn azure_resource_deserialization() {
        let json = r#"{"id":"/sub/res","name":"myvm","type":"Microsoft.Compute/virtualMachines","location":"westus","tags":{"env":"prod"}}"#;
        let r: AzureResource = serde_json::from_str(json).unwrap();
        assert_eq!(r.name, "myvm");
        assert_eq!(r.resource_type, "Microsoft.Compute/virtualMachines");
        assert_eq!(r.tags.get("env"), Some(&"prod".into()));
    }
}
