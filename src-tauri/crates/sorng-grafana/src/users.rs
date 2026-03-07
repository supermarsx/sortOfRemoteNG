//! User management for Grafana.

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct UserManager<'a> {
    client: &'a GrafanaClient,
}

impl<'a> UserManager<'a> {
    pub fn new(client: &'a GrafanaClient) -> Self {
        Self { client }
    }

    /// List all users (admin endpoint).
    pub async fn list(&self) -> GrafanaResult<Vec<GlobalUser>> {
        self.client.api_get("/admin/users").await
    }

    /// Get a user by ID.
    pub async fn get(&self, user_id: i64) -> GrafanaResult<GrafanaUser> {
        self.client
            .api_get(&format!("/users/{}", user_id))
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::user_not_found(format!("User {} not found", user_id))
                }
                _ => e,
            })
    }

    /// Create a new user (admin endpoint).
    pub async fn create(&self, req: CreateUserRequest) -> GrafanaResult<serde_json::Value> {
        self.client.api_post("/admin/users", &req).await
    }

    /// Update a user.
    pub async fn update(&self, user_id: i64, req: UpdateUserRequest) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_put(&format!("/users/{}", user_id), &req)
            .await
    }

    /// Delete a user (admin endpoint).
    pub async fn delete(&self, user_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/admin/users/{}", user_id))
            .await
    }

    /// Find a user by login or username.
    pub async fn get_by_login(&self, login: &str) -> GrafanaResult<GrafanaUser> {
        let query = [("loginOrEmail", login)];
        self.client
            .api_get_with_query("/users/lookup", &query)
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::user_not_found(format!("User '{}' not found", login))
                }
                _ => e,
            })
    }

    /// Find a user by email.
    pub async fn get_by_email(&self, email: &str) -> GrafanaResult<GrafanaUser> {
        let query = [("loginOrEmail", email)];
        self.client
            .api_get_with_query("/users/lookup", &query)
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::user_not_found(format!("User '{}' not found", email))
                }
                _ => e,
            })
    }

    /// Get the organizations a user belongs to.
    pub async fn get_orgs(&self, user_id: i64) -> GrafanaResult<Vec<UserOrg>> {
        self.client
            .api_get(&format!("/users/{}/orgs", user_id))
            .await
    }

    /// Set a user's password (admin endpoint).
    pub async fn set_password(&self, user_id: i64, new_password: &str) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "password": new_password });
        self.client
            .api_put(&format!("/admin/users/{}/password", user_id), &body)
            .await
    }

    /// Enable a user (admin endpoint).
    pub async fn enable(&self, user_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_post(&format!("/admin/users/{}/enable", user_id), &serde_json::json!({}))
            .await
    }

    /// Disable a user (admin endpoint).
    pub async fn disable(&self, user_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_post(&format!("/admin/users/{}/disable", user_id), &serde_json::json!({}))
            .await
    }

    /// List auth tokens for a user.
    pub async fn list_auth_tokens(&self, user_id: i64) -> GrafanaResult<Vec<serde_json::Value>> {
        self.client
            .api_get(&format!("/admin/users/{}/auth-tokens", user_id))
            .await
    }

    /// Revoke an auth token for a user.
    pub async fn revoke_auth_token(
        &self,
        user_id: i64,
        auth_token_id: i64,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "authTokenId": auth_token_id });
        self.client
            .api_post(&format!("/admin/users/{}/revoke-auth-token", user_id), &body)
            .await
    }

    /// Get the current user's preferences.
    pub async fn get_preferences(&self) -> GrafanaResult<UserPreferences> {
        self.client.api_get("/user/preferences").await
    }

    /// Update the current user's preferences.
    pub async fn update_preferences(&self, prefs: UserPreferences) -> GrafanaResult<serde_json::Value> {
        self.client.api_put("/user/preferences", &prefs).await
    }
}
