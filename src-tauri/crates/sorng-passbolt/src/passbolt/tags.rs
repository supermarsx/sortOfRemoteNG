//! Tag operations for Passbolt.
//!
//! Endpoints:
//! - `GET  /tags.json`            — list all tags
//! - `PUT  /tags/{id}.json`       — update a tag (rename)
//! - `POST /tags/{id}.json`       — add tags to a resource
//! - `DELETE /tags/{id}.json`     — delete a tag

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::types::*;
use log::info;
use std::collections::HashMap;

/// Tag API operations.
pub struct PassboltTags;

impl PassboltTags {
    /// List all tags.
    pub async fn list(client: &PassboltApiClient) -> Result<Vec<Tag>, PassboltError> {
        let resp: ApiResponse<Vec<Tag>> = client.get("/tags.json").await?;
        info!("Listed {} tags", resp.body.len());
        Ok(resp.body)
    }

    /// List tags with search filter.
    pub async fn search(
        client: &PassboltApiClient,
        keyword: &str,
    ) -> Result<Vec<Tag>, PassboltError> {
        let mut query = HashMap::new();
        query.insert("filter[search]".into(), keyword.to_string());
        let resp: ApiResponse<Vec<Tag>> = client.get_with_params("/tags.json", &query).await?;
        Ok(resp.body)
    }

    /// Get a single tag.
    pub async fn get(client: &PassboltApiClient, tag_id: &str) -> Result<Tag, PassboltError> {
        let resp: ApiResponse<Tag> = client.get(&format!("/tags/{}.json", tag_id)).await?;
        Ok(resp.body)
    }

    /// Update (rename) a tag.
    pub async fn update(
        client: &PassboltApiClient,
        tag_id: &str,
        request: &UpdateTagRequest,
    ) -> Result<Tag, PassboltError> {
        info!("Updating tag {}", tag_id);
        let resp: ApiResponse<Tag> = client
            .put(&format!("/tags/{}.json", tag_id), request)
            .await?;
        Ok(resp.body)
    }

    /// Delete a tag.
    pub async fn delete(client: &PassboltApiClient, tag_id: &str) -> Result<(), PassboltError> {
        info!("Deleting tag {}", tag_id);
        client
            .delete_void(&format!("/tags/{}.json", tag_id))
            .await?;
        Ok(())
    }

    /// Add tags to a resource.
    pub async fn add_to_resource(
        client: &PassboltApiClient,
        resource_id: &str,
        tags: &[TagEntry],
    ) -> Result<Vec<Tag>, PassboltError> {
        let request = AddTagsRequest {
            tags: tags.to_vec(),
        };
        info!("Adding {} tags to resource {}", tags.len(), resource_id);
        let resp: ApiResponse<Vec<Tag>> = client
            .post(&format!("/resources/{}/tags.json", resource_id), &request)
            .await?;
        Ok(resp.body)
    }

    /// Remove a tag from a resource.
    pub async fn remove_from_resource(
        client: &PassboltApiClient,
        resource_id: &str,
        tag_id: &str,
    ) -> Result<(), PassboltError> {
        info!("Removing tag {} from resource {}", tag_id, resource_id);
        client
            .delete_void(&format!("/resources/{}/tags/{}.json", resource_id, tag_id))
            .await?;
        Ok(())
    }

    /// Rename a tag.
    pub async fn rename(
        client: &PassboltApiClient,
        tag_id: &str,
        new_slug: &str,
    ) -> Result<Tag, PassboltError> {
        let request = UpdateTagRequest {
            slug: new_slug.to_string(),
            is_shared: None,
        };
        Self::update(client, tag_id, &request).await
    }

    /// Create or find a tag by slug name.
    /// Returns the tag entry suitable for add_to_resource.
    pub fn make_tag_entry(slug: &str, is_shared: bool) -> TagEntry {
        TagEntry {
            slug: slug.to_string(),
            is_shared,
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_tag_request_serialize() {
        let req = UpdateTagRequest {
            slug: "new-name".into(),
            is_shared: Some(true),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["slug"], "new-name");
        assert_eq!(json["is_shared"], true);
    }

    #[test]
    fn test_add_tags_request_serialize() {
        let req = AddTagsRequest {
            tags: vec![
                TagEntry {
                    slug: "tag1".into(),
                    is_shared: false,
                },
                TagEntry {
                    slug: "#shared-tag".into(),
                    is_shared: true,
                },
            ],
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["tags"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_tag_deserialize() {
        let json = r#"{
            "id": "tag-uuid",
            "slug": "my-tag",
            "is_shared": false
        }"#;
        let t: Tag = serde_json::from_str(json).unwrap();
        assert_eq!(t.slug, "my-tag");
        assert!(!t.is_shared);
    }

    #[test]
    fn test_make_tag_entry() {
        let entry = PassboltTags::make_tag_entry("my-tag", true);
        assert_eq!(entry.slug, "my-tag");
        assert!(entry.is_shared);
    }
}
