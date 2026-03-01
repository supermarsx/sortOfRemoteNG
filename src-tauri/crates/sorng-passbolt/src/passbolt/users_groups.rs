//! User and Group CRUD operations for Passbolt.
//!
//! User endpoints:
//! - `GET  /users.json`             — list users
//! - `POST /users.json`             — create a user (admin)
//! - `GET  /users/{id}.json`        — get a single user
//! - `PUT  /users/{id}.json`        — update a user
//! - `DELETE /users/{id}.json`      — delete a user
//! - `DELETE /users/{id}/dry-run.json` — dry-run user deletion
//!
//! Group endpoints:
//! - `GET  /groups.json`            — list groups
//! - `POST /groups.json`            — create a group
//! - `GET  /groups/{id}.json`       — get a single group
//! - `PUT  /groups/{id}.json`       — update a group
//! - `DELETE /groups/{id}.json`     — delete a group
//! - `PUT  /groups/{id}/dry-run.json` — dry-run group update
//! - `DELETE /groups/{id}/dry-run.json` — dry-run group deletion
//!
//! GPG Key endpoints:
//! - `GET /gpgkeys.json`            — list GPG keys
//! - `GET /gpgkeys/{id}.json`       — get a GPG key
//!
//! Role endpoints:
//! - `GET /roles.json`              — list roles

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::types::*;
use log::{debug, info};
use std::collections::HashMap;

// ── Users ───────────────────────────────────────────────────────────

/// User API operations.
pub struct PassboltUsers;

impl PassboltUsers {
    /// List users with optional filters.
    pub async fn list(
        client: &PassboltApiClient,
        params: Option<&UserListParams>,
    ) -> Result<Vec<User>, PassboltError> {
        let mut query: HashMap<String, String> = HashMap::new();

        if let Some(p) = params {
            if let Some(ref search) = p.search {
                query.insert("filter[search]".into(), search.clone());
            }
            if let Some(ref group_id) = p.has_groups {
                query.insert("filter[has-groups]".into(), group_id.clone());
            }
            if p.is_admin.unwrap_or(false) {
                query.insert("filter[is-admin]".into(), "1".into());
            }
            if p.is_active.unwrap_or(false) {
                query.insert("filter[is-active]".into(), "1".into());
            }
            if p.contain_profile.unwrap_or(false) {
                query.insert("contain[profile]".into(), "1".into());
            }
            if p.contain_gpgkey.unwrap_or(false) {
                query.insert("contain[gpgkey]".into(), "1".into());
            }
            if p.contain_groups_users.unwrap_or(false) {
                query.insert("contain[groups_users]".into(), "1".into());
            }
            if p.contain_role.unwrap_or(false) {
                query.insert("contain[role]".into(), "1".into());
            }
            if p.contain_last_logged_in.unwrap_or(false) {
                query.insert("contain[last_logged_in]".into(), "1".into());
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

        debug!("Listing users with {} query params", query.len());
        let resp: ApiResponse<Vec<User>> = if query.is_empty() {
            client.get("/users.json").await?
        } else {
            client.get_with_params("/users.json", &query).await?
        };
        info!("Listed {} users", resp.body.len());
        Ok(resp.body)
    }

    /// Get a single user by ID.
    pub async fn get(client: &PassboltApiClient, user_id: &str) -> Result<User, PassboltError> {
        let mut query = HashMap::new();
        query.insert("contain[profile]".into(), "1".into());
        query.insert("contain[gpgkey]".into(), "1".into());
        query.insert("contain[groups_users]".into(), "1".into());
        query.insert("contain[role]".into(), "1".into());
        query.insert("contain[last_logged_in]".into(), "1".into());

        let resp: ApiResponse<User> = client
            .get_with_params(&format!("/users/{}.json", user_id), &query)
            .await?;
        Ok(resp.body)
    }

    /// Get the current authenticated user ("me").
    pub async fn get_me(client: &PassboltApiClient) -> Result<User, PassboltError> {
        Self::get(client, "me").await
    }

    /// Create a new user (admin only).
    pub async fn create(
        client: &PassboltApiClient,
        request: &CreateUserRequest,
    ) -> Result<User, PassboltError> {
        info!("Creating user: {:?}", request.username);
        let resp: ApiResponse<User> = client.post("/users.json", request).await?;
        info!("Created user {}", resp.body.id);
        Ok(resp.body)
    }

    /// Update a user.
    pub async fn update(
        client: &PassboltApiClient,
        user_id: &str,
        request: &UpdateUserRequest,
    ) -> Result<User, PassboltError> {
        info!("Updating user {}", user_id);
        let resp: ApiResponse<User> = client
            .put(&format!("/users/{}.json", user_id), request)
            .await?;
        Ok(resp.body)
    }

    /// Delete a user.
    pub async fn delete(client: &PassboltApiClient, user_id: &str) -> Result<(), PassboltError> {
        info!("Deleting user {}", user_id);
        client
            .delete_void(&format!("/users/{}.json", user_id))
            .await?;
        Ok(())
    }

    /// Dry-run user deletion to check cascading effects.
    pub async fn delete_dry_run(
        client: &PassboltApiClient,
        user_id: &str,
    ) -> Result<serde_json::Value, PassboltError> {
        debug!("Dry-run deleting user {}", user_id);
        let resp: ApiResponse<serde_json::Value> = client
            .get(&format!("/users/{}/dry-run.json", user_id))
            .await?;
        Ok(resp.body)
    }

    /// Search users by name/email.
    pub async fn search(
        client: &PassboltApiClient,
        keyword: &str,
    ) -> Result<Vec<User>, PassboltError> {
        let params = UserListParams {
            search: Some(keyword.to_string()),
            contain_profile: Some(true),
            contain_gpgkey: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List admin users.
    pub async fn list_admins(client: &PassboltApiClient) -> Result<Vec<User>, PassboltError> {
        let params = UserListParams {
            is_admin: Some(true),
            contain_profile: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List active users in a group.
    pub async fn list_in_group(
        client: &PassboltApiClient,
        group_id: &str,
    ) -> Result<Vec<User>, PassboltError> {
        let params = UserListParams {
            has_groups: Some(group_id.to_string()),
            is_active: Some(true),
            contain_profile: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }
}

// ── Groups ──────────────────────────────────────────────────────────

/// Group API operations.
pub struct PassboltGroups;

impl PassboltGroups {
    /// List groups with optional filters.
    pub async fn list(
        client: &PassboltApiClient,
        params: Option<&GroupListParams>,
    ) -> Result<Vec<Group>, PassboltError> {
        let mut query: HashMap<String, String> = HashMap::new();

        if let Some(p) = params {
            if let Some(ref search) = p.search {
                query.insert("filter[search]".into(), search.clone());
            }
            if let Some(ref user_id) = p.has_users {
                query.insert("filter[has-users][]".into(), user_id.clone());
            }
            if let Some(ref manager_id) = p.has_manager {
                query.insert("filter[has-managers][]".into(), manager_id.clone());
            }
            if p.contain_users.unwrap_or(false) {
                query.insert("contain[user]".into(), "1".into());
            }
            if p.contain_groups_users.unwrap_or(false) {
                query.insert("contain[groups_users]".into(), "1".into());
            }
            if p.contain_my_group_user.unwrap_or(false) {
                query.insert("contain[my_group_user]".into(), "1".into());
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

        debug!("Listing groups with {} query params", query.len());
        let resp: ApiResponse<Vec<Group>> = if query.is_empty() {
            client.get("/groups.json").await?
        } else {
            client.get_with_params("/groups.json", &query).await?
        };
        info!("Listed {} groups", resp.body.len());
        Ok(resp.body)
    }

    /// Get a single group by ID.
    pub async fn get(client: &PassboltApiClient, group_id: &str) -> Result<Group, PassboltError> {
        let mut query = HashMap::new();
        query.insert("contain[user]".into(), "1".into());
        query.insert("contain[groups_users]".into(), "1".into());
        query.insert("contain[my_group_user]".into(), "1".into());

        let resp: ApiResponse<Group> = client
            .get_with_params(&format!("/groups/{}.json", group_id), &query)
            .await?;
        Ok(resp.body)
    }

    /// Create a new group.
    pub async fn create(
        client: &PassboltApiClient,
        request: &CreateGroupRequest,
    ) -> Result<Group, PassboltError> {
        info!("Creating group: {}", request.name);
        let resp: ApiResponse<Group> = client.post("/groups.json", request).await?;
        info!("Created group {}", resp.body.id);
        Ok(resp.body)
    }

    /// Update a group.
    pub async fn update(
        client: &PassboltApiClient,
        group_id: &str,
        request: &UpdateGroupRequest,
    ) -> Result<Group, PassboltError> {
        info!("Updating group {}", group_id);
        let resp: ApiResponse<Group> = client
            .put(&format!("/groups/{}.json", group_id), request)
            .await?;
        Ok(resp.body)
    }

    /// Dry-run a group update (to see sharing changes).
    pub async fn update_dry_run(
        client: &PassboltApiClient,
        group_id: &str,
        request: &UpdateGroupRequest,
    ) -> Result<GroupDryRunResult, PassboltError> {
        debug!("Dry-run updating group {}", group_id);
        let resp: ApiResponse<GroupDryRunResult> = client
            .put(&format!("/groups/{}/dry-run.json", group_id), request)
            .await?;
        Ok(resp.body)
    }

    /// Delete a group.
    pub async fn delete(client: &PassboltApiClient, group_id: &str) -> Result<(), PassboltError> {
        info!("Deleting group {}", group_id);
        client
            .delete_void(&format!("/groups/{}.json", group_id))
            .await?;
        Ok(())
    }

    /// Dry-run group deletion.
    pub async fn delete_dry_run(
        client: &PassboltApiClient,
        group_id: &str,
    ) -> Result<serde_json::Value, PassboltError> {
        debug!("Dry-run deleting group {}", group_id);
        let resp: ApiResponse<serde_json::Value> = client
            .get(&format!("/groups/{}/dry-run.json", group_id))
            .await?;
        Ok(resp.body)
    }

    /// Search groups by name.
    pub async fn search(
        client: &PassboltApiClient,
        keyword: &str,
    ) -> Result<Vec<Group>, PassboltError> {
        let params = GroupListParams {
            search: Some(keyword.to_string()),
            contain_users: Some(true),
            contain_groups_users: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List groups a specific user belongs to.
    pub async fn list_for_user(
        client: &PassboltApiClient,
        user_id: &str,
    ) -> Result<Vec<Group>, PassboltError> {
        let params = GroupListParams {
            has_users: Some(user_id.to_string()),
            contain_groups_users: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List groups managed by a specific user.
    pub async fn list_managed_by(
        client: &PassboltApiClient,
        user_id: &str,
    ) -> Result<Vec<Group>, PassboltError> {
        let params = GroupListParams {
            has_manager: Some(user_id.to_string()),
            contain_groups_users: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }
}

// ── GPG Keys ────────────────────────────────────────────────────────

/// GPG Key API operations.
pub struct PassboltGpgKeys;

impl PassboltGpgKeys {
    /// List all GPG keys.
    pub async fn list(client: &PassboltApiClient) -> Result<Vec<GpgKey>, PassboltError> {
        let resp: ApiResponse<Vec<GpgKey>> = client.get("/gpgkeys.json").await?;
        Ok(resp.body)
    }

    /// Get a single GPG key.
    pub async fn get(client: &PassboltApiClient, key_id: &str) -> Result<GpgKey, PassboltError> {
        let resp: ApiResponse<GpgKey> = client.get(&format!("/gpgkeys/{}.json", key_id)).await?;
        Ok(resp.body)
    }
}

// ── Roles ───────────────────────────────────────────────────────────

/// Role API operations.
pub struct PassboltRoles;

impl PassboltRoles {
    /// List all roles.
    pub async fn list(client: &PassboltApiClient) -> Result<Vec<Role>, PassboltError> {
        let resp: ApiResponse<Vec<Role>> = client.get("/roles.json").await?;
        Ok(resp.body)
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_user_request_serialize() {
        let req = CreateUserRequest {
            username: "user@example.com".into(),
            profile: CreateUserProfile {
                first_name: "John".into(),
                last_name: "Doe".into(),
            },
            role_id: Some("role-uuid".into()),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["username"], "user@example.com");
        assert_eq!(json["profile"]["first_name"], "John");
    }

    #[test]
    fn test_update_user_request_serialize() {
        let req = UpdateUserRequest {
            profile: Some(CreateUserProfile {
                first_name: "Jane".into(),
                last_name: "Doe".into(),
            }),
            role_id: None,
            disabled: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["profile"]["first_name"], "Jane");
        assert!(json.get("role_id").is_none());
    }

    #[test]
    fn test_create_group_request_serialize() {
        let req = CreateGroupRequest {
            name: "Dev Team".into(),
            groups_users: vec![GroupUserEntry {
                user_id: "user-uuid".into(),
                is_admin: true,
            }],
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["name"], "Dev Team");
        assert_eq!(json["groups_users"][0]["user_id"], "user-uuid");
    }

    #[test]
    fn test_user_deserialize() {
        let json = r#"{
            "id": "user-uuid",
            "username": "user@example.com",
            "active": true,
            "deleted": false,
            "created": "2024-01-01T00:00:00Z",
            "modified": "2024-01-02T00:00:00Z"
        }"#;
        let u: User = serde_json::from_str(json).unwrap();
        assert_eq!(u.id, "user-uuid");
        assert_eq!(u.username, Some("user@example.com".into()));
        assert!(u.active);
    }

    #[test]
    fn test_group_deserialize() {
        let json = r#"{
            "id": "group-uuid",
            "name": "Admins",
            "created": "2024-01-01T00:00:00Z",
            "modified": "2024-01-02T00:00:00Z",
            "created_by": "user-uuid",
            "modified_by": "user-uuid"
        }"#;
        let g: Group = serde_json::from_str(json).unwrap();
        assert_eq!(g.id, "group-uuid");
        assert_eq!(g.name, "Admins");
    }

    #[test]
    fn test_gpg_key_deserialize() {
        let json = r#"{
            "id": "key-uuid",
            "user_id": "user-uuid",
            "armored_key": "-----BEGIN PGP PUBLIC KEY BLOCK-----",
            "fingerprint": "ABCD1234",
            "created": "2024-01-01T00:00:00Z",
            "modified": "2024-01-01T00:00:00Z"
        }"#;
        let k: GpgKey = serde_json::from_str(json).unwrap();
        assert_eq!(k.fingerprint.unwrap(), "ABCD1234");
    }

    #[test]
    fn test_role_deserialize() {
        let json = r#"{
            "id": "role-uuid",
            "name": "admin",
            "description": "Administrator role",
            "created": "2024-01-01T00:00:00Z",
            "modified": "2024-01-01T00:00:00Z"
        }"#;
        let r: Role = serde_json::from_str(json).unwrap();
        assert_eq!(r.name, "admin");
    }

    #[test]
    fn test_user_list_params_default() {
        let params = UserListParams::default();
        assert!(params.search.is_none());
        assert!(params.is_admin.is_none());
    }

    #[test]
    fn test_group_list_params_default() {
        let params = GroupListParams::default();
        assert!(params.search.is_none());
        assert!(params.has_users.is_none());
    }
}
