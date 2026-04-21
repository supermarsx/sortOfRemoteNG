//! Sharing, permissions, and favorites for Passbolt.
//!
//! Endpoints:
//! - `GET  /permissions/resource/{id}.json`    — list permissions for a resource
//! - `PUT  /share/{model}/{id}.json`           — share a resource or folder
//! - `POST /share/simulate/{model}/{id}.json`  — simulate sharing changes
//! - `GET  /share/search-aros.json`            — search AROs (users + groups)
//! - `POST /favorite/{model}/{id}.json`        — add a favorite
//! - `DELETE /favorite/{id}.json`              — remove a favorite

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::types::*;
use log::{debug, info};
use std::collections::HashMap;

/// Permission and sharing API operations.
pub struct PassboltSharing;

impl PassboltSharing {
    /// List permissions for a resource.
    pub async fn list_resource_permissions(
        client: &PassboltApiClient,
        resource_id: &str,
    ) -> Result<Vec<Permission>, PassboltError> {
        let resp: ApiResponse<Vec<Permission>> = client
            .get(&format!("/permissions/resource/{}.json", resource_id))
            .await?;
        Ok(resp.body)
    }

    /// List permissions for a folder.
    pub async fn list_folder_permissions(
        client: &PassboltApiClient,
        folder_id: &str,
    ) -> Result<Vec<Permission>, PassboltError> {
        let resp: ApiResponse<Vec<Permission>> = client
            .get(&format!("/permissions/folder/{}.json", folder_id))
            .await?;
        Ok(resp.body)
    }

    /// Share a resource with users/groups.
    pub async fn share_resource(
        client: &PassboltApiClient,
        resource_id: &str,
        request: &ShareRequest,
    ) -> Result<(), PassboltError> {
        info!(
            "Sharing resource {} with {} permission changes and {} secrets",
            resource_id,
            request.permissions.as_ref().map_or(0, |p| p.len()),
            request.secrets.as_ref().map_or(0, |s| s.len())
        );
        let _: ApiResponse<serde_json::Value> = client
            .put(&format!("/share/resource/{}.json", resource_id), request)
            .await?;
        info!("Resource {} shared successfully", resource_id);
        Ok(())
    }

    /// Share a folder with users/groups.
    pub async fn share_folder(
        client: &PassboltApiClient,
        folder_id: &str,
        request: &ShareRequest,
    ) -> Result<(), PassboltError> {
        info!(
            "Sharing folder {} with {} permission changes",
            folder_id,
            request.permissions.as_ref().map_or(0, |p| p.len())
        );
        let _: ApiResponse<serde_json::Value> = client
            .put(&format!("/share/folder/{}.json", folder_id), request)
            .await?;
        Ok(())
    }

    /// Simulate sharing changes for a resource (to determine needed secrets).
    pub async fn simulate_share_resource(
        client: &PassboltApiClient,
        resource_id: &str,
        request: &ShareRequest,
    ) -> Result<ShareSimulateResult, PassboltError> {
        debug!("Simulating share for resource {}", resource_id);
        let resp: ApiResponse<ShareSimulateResult> = client
            .post(
                &format!("/share/simulate/resource/{}.json", resource_id),
                request,
            )
            .await?;
        Ok(resp.body)
    }

    /// Simulate sharing changes for a folder.
    pub async fn simulate_share_folder(
        client: &PassboltApiClient,
        folder_id: &str,
        request: &ShareRequest,
    ) -> Result<ShareSimulateResult, PassboltError> {
        debug!("Simulating share for folder {}", folder_id);
        let resp: ApiResponse<ShareSimulateResult> = client
            .post(
                &format!("/share/simulate/folder/{}.json", folder_id),
                request,
            )
            .await?;
        Ok(resp.body)
    }

    /// Search Access Request Objects (users and groups).
    pub async fn search_aros(
        client: &PassboltApiClient,
        keyword: &str,
    ) -> Result<Vec<Aro>, PassboltError> {
        let mut query = HashMap::new();
        query.insert("filter[search]".into(), keyword.to_string());

        let resp: ApiResponse<Vec<Aro>> = client
            .get_with_params("/share/search-aros.json", &query)
            .await?;
        Ok(resp.body)
    }

    /// Add a resource to favorites.
    pub async fn add_favorite(
        client: &PassboltApiClient,
        resource_id: &str,
    ) -> Result<Favorite, PassboltError> {
        info!("Adding resource {} to favorites", resource_id);
        let resp: ApiResponse<Favorite> = client
            .post(
                &format!("/favorite/resource/{}.json", resource_id),
                &serde_json::json!({}),
            )
            .await?;
        Ok(resp.body)
    }

    /// Remove a favorite.
    pub async fn remove_favorite(
        client: &PassboltApiClient,
        favorite_id: &str,
    ) -> Result<(), PassboltError> {
        info!("Removing favorite {}", favorite_id);
        client
            .delete_void(&format!("/favorite/{}.json", favorite_id))
            .await?;
        Ok(())
    }

    /// Build a share request for granting read access to a user.
    pub fn build_read_permission(aro_foreign_key: &str, aro_type: &str) -> PermissionChange {
        PermissionChange {
            id: None,
            aro: aro_type.to_string(),
            aro_foreign_key: aro_foreign_key.to_string(),
            permission_type: Some(permission_types::READ),
            delete: None,
        }
    }

    /// Build a share request for granting update access to a user.
    pub fn build_update_permission(aro_foreign_key: &str, aro_type: &str) -> PermissionChange {
        PermissionChange {
            id: None,
            aro: aro_type.to_string(),
            aro_foreign_key: aro_foreign_key.to_string(),
            permission_type: Some(permission_types::UPDATE),
            delete: None,
        }
    }

    /// Build a share request for granting owner access to a user.
    pub fn build_owner_permission(aro_foreign_key: &str, aro_type: &str) -> PermissionChange {
        PermissionChange {
            id: None,
            aro: aro_type.to_string(),
            aro_foreign_key: aro_foreign_key.to_string(),
            permission_type: Some(permission_types::OWNER),
            delete: None,
        }
    }

    /// Build a permission deletion.
    pub fn build_delete_permission(permission_id: &str) -> PermissionChange {
        PermissionChange {
            id: Some(permission_id.to_string()),
            aro: String::new(),
            aro_foreign_key: String::new(),
            permission_type: None,
            delete: Some(true),
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_share_request_serialize() {
        let req = ShareRequest {
            permissions: Some(vec![PermissionChange {
                id: None,
                aro: "User".into(),
                aro_foreign_key: "user-uuid".into(),
                permission_type: Some(permission_types::READ),
                delete: None,
            }]),
            secrets: Some(vec![ShareSecret {
                user_id: "user-uuid".into(),
                data: "encrypted-data".into(),
            }]),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["permissions"][0]["aro"], "User");
        assert_eq!(json["secrets"][0]["user_id"], "user-uuid");
    }

    #[test]
    fn test_build_read_permission() {
        let perm = PassboltSharing::build_read_permission("uid", "User");
        assert_eq!(perm.permission_type, Some(permission_types::READ));
        assert_eq!(perm.aro, "User");
    }

    #[test]
    fn test_build_update_permission() {
        let perm = PassboltSharing::build_update_permission("uid", "Group");
        assert_eq!(perm.permission_type, Some(permission_types::UPDATE));
        assert_eq!(perm.aro, "Group");
    }

    #[test]
    fn test_build_owner_permission() {
        let perm = PassboltSharing::build_owner_permission("uid", "User");
        assert_eq!(perm.permission_type, Some(permission_types::OWNER));
    }

    #[test]
    fn test_build_delete_permission() {
        let perm = PassboltSharing::build_delete_permission("perm-uuid");
        assert_eq!(perm.id, Some("perm-uuid".into()));
        assert_eq!(perm.delete, Some(true));
    }

    #[test]
    fn test_permission_types_values() {
        assert_eq!(permission_types::READ, 1);
        assert_eq!(permission_types::UPDATE, 7);
        assert_eq!(permission_types::OWNER, 15);
    }

    #[test]
    fn test_permission_deserialize() {
        let json = r#"{
            "id": "perm-uuid",
            "aco": "Resource",
            "aco_foreign_key": "res-uuid",
            "aro": "User",
            "aro_foreign_key": "user-uuid",
            "type": 1,
            "created": "2024-01-01T00:00:00Z",
            "modified": "2024-01-01T00:00:00Z"
        }"#;
        let p: Permission = serde_json::from_str(json).unwrap();
        assert_eq!(p.aco, "Resource");
        assert_eq!(p.permission_type, 1);
    }

    #[test]
    fn test_favorite_deserialize() {
        let json = r#"{
            "id": "fav-uuid",
            "user_id": "user-uuid",
            "foreign_key": "res-uuid",
            "foreign_model": "Resource",
            "created": "2024-01-01T00:00:00Z",
            "modified": "2024-01-01T00:00:00Z"
        }"#;
        let f: Favorite = serde_json::from_str(json).unwrap();
        assert_eq!(f.id, "fav-uuid");
        assert_eq!(f.foreign_model, "Resource");
    }
}
