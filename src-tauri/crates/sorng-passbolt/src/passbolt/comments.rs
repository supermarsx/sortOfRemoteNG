//! Comment CRUD operations for Passbolt.
//!
//! Endpoints:
//! - `GET  /comments/resource/{id}.json` — list comments on a resource
//! - `POST /comments/resource/{id}.json` — add a comment to a resource
//! - `PUT  /comments/{id}.json`          — update a comment
//! - `DELETE /comments/{id}.json`        — delete a comment

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::types::*;
use log::info;

/// Comment API operations.
pub struct PassboltComments;

impl PassboltComments {
    /// List comments on a resource.
    pub async fn list(
        client: &PassboltApiClient,
        resource_id: &str,
    ) -> Result<Vec<Comment>, PassboltError> {
        let resp: ApiResponse<Vec<Comment>> = client
            .get(&format!("/comments/resource/{}.json", resource_id))
            .await?;
        info!(
            "Listed {} comments for resource {}",
            resp.body.len(),
            resource_id
        );
        Ok(resp.body)
    }

    /// Add a comment to a resource.
    pub async fn create(
        client: &PassboltApiClient,
        resource_id: &str,
        content: &str,
        parent_id: Option<&str>,
    ) -> Result<Comment, PassboltError> {
        let payload = CommentPayload {
            content: content.to_string(),
            parent_id: parent_id.map(String::from),
            foreign_key: Some(resource_id.to_string()),
            foreign_model: Some("Resource".to_string()),
        };

        info!("Adding comment to resource {}", resource_id);
        let resp: ApiResponse<Comment> = client
            .post(
                &format!("/comments/resource/{}.json", resource_id),
                &payload,
            )
            .await?;
        Ok(resp.body)
    }

    /// Reply to an existing comment.
    pub async fn reply(
        client: &PassboltApiClient,
        resource_id: &str,
        parent_comment_id: &str,
        content: &str,
    ) -> Result<Comment, PassboltError> {
        Self::create(client, resource_id, content, Some(parent_comment_id)).await
    }

    /// Update a comment.
    pub async fn update(
        client: &PassboltApiClient,
        comment_id: &str,
        content: &str,
    ) -> Result<Comment, PassboltError> {
        let payload = CommentPayload {
            content: content.to_string(),
            parent_id: None,
            foreign_key: None,
            foreign_model: None,
        };

        info!("Updating comment {}", comment_id);
        let resp: ApiResponse<Comment> = client
            .put(&format!("/comments/{}.json", comment_id), &payload)
            .await?;
        Ok(resp.body)
    }

    /// Delete a comment.
    pub async fn delete(client: &PassboltApiClient, comment_id: &str) -> Result<(), PassboltError> {
        info!("Deleting comment {}", comment_id);
        client
            .delete_void(&format!("/comments/{}.json", comment_id))
            .await?;
        Ok(())
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_comment_payload_serialize() {
        let p = CommentPayload {
            content: "Hello world!".into(),
            parent_id: None,
            foreign_key: Some("res-uuid".into()),
            foreign_model: Some("Resource".into()),
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["content"], "Hello world!");
        assert_eq!(json["foreign_key"], "res-uuid");
    }

    #[test]
    fn test_comment_payload_reply() {
        let p = CommentPayload {
            content: "reply".into(),
            parent_id: Some("parent-uuid".into()),
            foreign_key: None,
            foreign_model: None,
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["parent_id"], "parent-uuid");
    }

    #[test]
    fn test_comment_deserialize() {
        let json = r#"{
            "id": "comment-uuid",
            "user_id": "user-uuid",
            "foreign_key": "res-uuid",
            "foreign_model": "Resource",
            "content": "Nice password!",
            "created": "2024-01-01T00:00:00Z",
            "modified": "2024-01-01T00:00:00Z",
            "created_by": "user-uuid",
            "modified_by": "user-uuid"
        }"#;
        let c: Comment = serde_json::from_str(json).unwrap();
        assert_eq!(c.content, "Nice password!");
        assert_eq!(c.foreign_model, "Resource");
    }
}
