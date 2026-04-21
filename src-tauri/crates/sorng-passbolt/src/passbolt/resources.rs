//! Resource CRUD operations for Passbolt.
//!
//! Endpoints:
//! - `GET  /resources.json`        — list resources
//! - `POST /resources.json`        — create a resource
//! - `GET  /resources/{id}.json`   — get a single resource
//! - `PUT  /resources/{id}.json`   — update a resource
//! - `DELETE /resources/{id}.json` — delete a resource
//! - `GET  /resource-types.json`   — list resource types
//! - `GET  /resource-types/{id}.json` — get a resource type

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::types::*;
use log::{debug, info};
use std::collections::HashMap;

/// Resource API operations.
pub struct PassboltResources;

impl PassboltResources {
    /// List resources with optional query parameters.
    pub async fn list(
        client: &PassboltApiClient,
        params: Option<&ResourceListParams>,
    ) -> Result<Vec<Resource>, PassboltError> {
        let mut query: HashMap<String, String> = HashMap::new();

        if let Some(p) = params {
            if let Some(ref search) = p.search {
                query.insert("filter[search]".into(), search.clone());
            }
            if let Some(has_id) = &p.has_id {
                for id in has_id {
                    query.insert("filter[has-id][]".to_string(), id.clone());
                }
            }
            if let Some(ref folder_id) = p.folder_parent_id {
                query.insert("filter[has-parent]".into(), folder_id.clone());
            }
            if p.is_favorite.unwrap_or(false) {
                query.insert("filter[is-favorite]".into(), "1".into());
            }
            if let Some(ref group_id) = p.is_shared_with_group {
                query.insert("filter[is-shared-with-group]".into(), group_id.clone());
            }
            if p.is_owned_by_me.unwrap_or(false) {
                query.insert("filter[is-owned-by-me]".into(), "1".into());
            }
            if let Some(ref tag) = p.has_tag {
                query.insert("filter[has-tag]".into(), tag.clone());
            }
            if p.contain_creator.unwrap_or(false) {
                query.insert("contain[creator]".into(), "1".into());
            }
            if p.contain_modifier.unwrap_or(false) {
                query.insert("contain[modifier]".into(), "1".into());
            }
            if p.contain_favorite.unwrap_or(false) {
                query.insert("contain[favorite]".into(), "1".into());
            }
            if p.contain_permission.unwrap_or(false) {
                query.insert("contain[permission]".into(), "1".into());
            }
            if p.contain_permissions.unwrap_or(false) {
                query.insert("contain[permissions]".into(), "1".into());
            }
            if p.contain_secret.unwrap_or(false) {
                query.insert("contain[secret]".into(), "1".into());
            }
            if p.contain_tags.unwrap_or(false) {
                query.insert("contain[tag]".into(), "1".into());
            }
            if p.contain_resource_type.unwrap_or(false) {
                query.insert("contain[resource-type]".into(), "1".into());
            }
            if let Some(ref order) = p.order {
                query.insert("order[]".into(), order.clone());
            }
            if let Some(limit) = p.limit {
                query.insert("limit".into(), limit.to_string());
            }
            if let Some(page) = p.page {
                query.insert("page".into(), page.to_string());
            }
        }

        debug!("Listing resources with {} query params", query.len());
        let resp: ApiResponse<Vec<Resource>> = if query.is_empty() {
            client.get("/resources.json").await?
        } else {
            client.get_with_params("/resources.json", &query).await?
        };

        info!("Listed {} resources", resp.body.len());
        Ok(resp.body)
    }

    /// Get a single resource by ID.
    pub async fn get(
        client: &PassboltApiClient,
        resource_id: &str,
    ) -> Result<Resource, PassboltError> {
        let mut query = HashMap::new();
        query.insert("contain[creator]".into(), "1".into());
        query.insert("contain[modifier]".into(), "1".into());
        query.insert("contain[favorite]".into(), "1".into());
        query.insert("contain[permission]".into(), "1".into());
        query.insert("contain[permissions]".into(), "1".into());
        query.insert("contain[tag]".into(), "1".into());
        query.insert("contain[secret]".into(), "1".into());

        let resp: ApiResponse<Resource> = client
            .get_with_params(&format!("/resources/{}.json", resource_id), &query)
            .await?;
        Ok(resp.body)
    }

    /// Get a single resource by ID with custom contain flags.
    pub async fn get_with_contains(
        client: &PassboltApiClient,
        resource_id: &str,
        contains: &[&str],
    ) -> Result<Resource, PassboltError> {
        let mut query = HashMap::new();
        for c in contains {
            query.insert(format!("contain[{}]", c), "1".into());
        }
        let resp: ApiResponse<Resource> = client
            .get_with_params(&format!("/resources/{}.json", resource_id), &query)
            .await?;
        Ok(resp.body)
    }

    /// Create a new resource.
    pub async fn create(
        client: &PassboltApiClient,
        request: &CreateResourceRequest,
    ) -> Result<Resource, PassboltError> {
        info!("Creating resource: {}", request.name);
        let resp: ApiResponse<Resource> = client.post("/resources.json", request).await?;
        info!("Created resource {}", resp.body.id);
        Ok(resp.body)
    }

    /// Update an existing resource.
    pub async fn update(
        client: &PassboltApiClient,
        resource_id: &str,
        request: &UpdateResourceRequest,
    ) -> Result<Resource, PassboltError> {
        info!("Updating resource {}", resource_id);
        let resp: ApiResponse<Resource> = client
            .put(&format!("/resources/{}.json", resource_id), request)
            .await?;
        Ok(resp.body)
    }

    /// Delete a resource.
    pub async fn delete(
        client: &PassboltApiClient,
        resource_id: &str,
    ) -> Result<(), PassboltError> {
        info!("Deleting resource {}", resource_id);
        client
            .delete_void(&format!("/resources/{}.json", resource_id))
            .await?;
        Ok(())
    }

    /// List all resource types.
    pub async fn list_types(
        client: &PassboltApiClient,
    ) -> Result<Vec<ResourceType>, PassboltError> {
        let resp: ApiResponse<Vec<ResourceType>> = client.get("/resource-types.json").await?;
        Ok(resp.body)
    }

    /// Get a specific resource type.
    pub async fn get_type(
        client: &PassboltApiClient,
        type_id: &str,
    ) -> Result<ResourceType, PassboltError> {
        let resp: ApiResponse<ResourceType> = client
            .get(&format!("/resource-types/{}.json", type_id))
            .await?;
        Ok(resp.body)
    }

    /// Search resources by keyword.
    pub async fn search(
        client: &PassboltApiClient,
        keyword: &str,
    ) -> Result<Vec<Resource>, PassboltError> {
        let params = ResourceListParams {
            search: Some(keyword.to_string()),
            contain_creator: Some(true),
            contain_favorite: Some(true),
            contain_tags: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List resources in a specific folder.
    pub async fn list_in_folder(
        client: &PassboltApiClient,
        folder_id: &str,
    ) -> Result<Vec<Resource>, PassboltError> {
        let params = ResourceListParams {
            folder_parent_id: Some(folder_id.to_string()),
            contain_creator: Some(true),
            contain_tags: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List favorite resources.
    pub async fn list_favorites(
        client: &PassboltApiClient,
    ) -> Result<Vec<Resource>, PassboltError> {
        let params = ResourceListParams {
            is_favorite: Some(true),
            contain_creator: Some(true),
            contain_favorite: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List resources owned by the current user.
    pub async fn list_owned(client: &PassboltApiClient) -> Result<Vec<Resource>, PassboltError> {
        let params = ResourceListParams {
            is_owned_by_me: Some(true),
            contain_permission: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List resources shared with a specific group.
    pub async fn list_shared_with_group(
        client: &PassboltApiClient,
        group_id: &str,
    ) -> Result<Vec<Resource>, PassboltError> {
        let params = ResourceListParams {
            is_shared_with_group: Some(group_id.to_string()),
            contain_permissions: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List resources by tag.
    pub async fn list_by_tag(
        client: &PassboltApiClient,
        tag: &str,
    ) -> Result<Vec<Resource>, PassboltError> {
        let params = ResourceListParams {
            has_tag: Some(tag.to_string()),
            contain_tags: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List resources by multiple IDs.
    pub async fn list_by_ids(
        client: &PassboltApiClient,
        ids: &[String],
    ) -> Result<Vec<Resource>, PassboltError> {
        let params = ResourceListParams {
            has_id: Some(ids.to_vec()),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_resource_request_serialize() {
        let req = CreateResourceRequest {
            name: "Test".into(),
            username: Some("admin".into()),
            uri: Some("https://example.com".into()),
            description: Some("desc".into()),
            resource_type_id: Some("rt-uuid".into()),
            folder_parent_id: Some("folder-uuid".into()),
            secrets: vec![],
            metadata: None,
            metadata_key_id: None,
            metadata_key_type: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["name"], "Test");
        assert_eq!(json["username"], "admin");
        assert_eq!(json["folder_parent_id"], "folder-uuid");
    }

    #[test]
    fn test_update_resource_request_serialize() {
        let req = UpdateResourceRequest {
            name: Some("Updated".into()),
            username: None,
            uri: None,
            description: None,
            resource_type_id: None,
            folder_parent_id: None,
            secrets: None,
            metadata: None,
            metadata_key_id: None,
            metadata_key_type: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["name"], "Updated");
        // None fields should not be present
        assert!(json.get("username").is_none());
    }

    #[test]
    fn test_resource_list_params_default() {
        let params = ResourceListParams::default();
        assert!(params.search.is_none());
        assert!(params.has_id.is_none());
        assert!(params.limit.is_none());
    }

    #[test]
    fn test_resource_deserialize() {
        let json = r#"{
            "id": "res-uuid",
            "name": "My Resource",
            "created": "2024-01-01T00:00:00Z",
            "modified": "2024-01-02T00:00:00Z",
            "created_by": "user-uuid",
            "modified_by": "user-uuid"
        }"#;
        let res: Resource = serde_json::from_str(json).unwrap();
        assert_eq!(res.id, "res-uuid");
        assert_eq!(res.name.unwrap(), "My Resource");
    }

    #[test]
    fn test_resource_type_deserialize() {
        let json = r#"{
            "id": "rt-uuid",
            "slug": "password-and-description",
            "name": "Password with description",
            "description": "A resource type for passwords",
            "definition": {}
        }"#;
        let rt: ResourceType = serde_json::from_str(json).unwrap();
        assert_eq!(rt.slug, "password-and-description");
    }
}
