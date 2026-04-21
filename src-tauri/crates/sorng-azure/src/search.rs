//! Azure Resource Graph – Cross-subscription/cross-resource-group search.

use log::debug;

use crate::client::AzureClient;
use crate::types::{AzureResult, ResourceSearchRequest, ResourceSearchResponse};

/// POST to the Resource Graph query endpoint.
///
/// ```text
/// POST https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01
/// ```
pub async fn search_resources(
    client: &AzureClient,
    query: &str,
    subscriptions: &[String],
    top: Option<i32>,
    skip: Option<i32>,
) -> AzureResult<ResourceSearchResponse> {
    let api = &client.config().api_version_resource_graph;
    let url = format!(
        "{}/providers/Microsoft.ResourceGraph/resources?api-version={}",
        crate::types::ARM_BASE,
        api
    );
    let body = ResourceSearchRequest {
        subscriptions: subscriptions.to_vec(),
        query: query.to_string(),
        options: Some(crate::types::ResourceSearchOptions {
            top,
            skip,
            result_format: Some("objectArray".into()),
        }),
    };
    debug!("search_resources(query={}) → {}", query, url);
    client.post_json(&url, &body).await
}

/// Convenience: search the subscription that the client is authenticated against.
pub async fn search_resources_in_subscription(
    client: &AzureClient,
    query: &str,
    top: Option<i32>,
    skip: Option<i32>,
) -> AzureResult<ResourceSearchResponse> {
    let sub = client.subscription_id()?.to_string();
    search_resources(client, query, &[sub], top, skip).await
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ResourceSearchRequest;

    #[test]
    fn search_request_serialize() {
        let req = ResourceSearchRequest {
            subscriptions: vec!["sub1".into()],
            query: "Resources | where type =~ 'Microsoft.Compute/virtualMachines'".into(),
            options: Some(crate::types::ResourceSearchOptions {
                top: Some(10),
                skip: None,
                result_format: Some("objectArray".into()),
            }),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("objectArray"));
        assert!(json.contains("virtualMachines"));
    }

    #[test]
    fn search_response_deserialize() {
        let json = r#"{"totalRecords":2,"count":2,"data":[{"id":"/sub/1","name":"vm1","type":"Microsoft.Compute/virtualMachines","location":"eastus"},{"id":"/sub/2","name":"vm2","type":"Microsoft.Compute/virtualMachines","location":"westus"}]}"#;
        let resp: ResourceSearchResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.total_records, 2);
        assert_eq!(resp.data.as_array().unwrap().len(), 2);
    }

    #[test]
    fn url_pattern() {
        let url = format!(
            "{}/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01",
            crate::types::ARM_BASE
        );
        assert!(url.contains("ResourceGraph"));
    }
}
