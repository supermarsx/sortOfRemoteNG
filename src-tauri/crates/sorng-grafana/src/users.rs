// ── sorng-grafana/src/users.rs ───────────────────────────────────────────────
//! User management via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct UserManager;

impl UserManager {
    /// List all users (admin).  GET /api/admin/users
    pub async fn list(client: &GrafanaClient) -> GrafanaResult<Vec<GrafanaUser>> {
        client.api_get("admin/users").await
    }

    /// Get user by ID.  GET /api/users/:id
    pub async fn get(client: &GrafanaClient, id: u64) -> GrafanaResult<GrafanaUser> {
        client.api_get(&format!("users/{id}")).await
    }

    /// Get user by login / username.  GET /api/users/lookup?loginOrEmail=:login
    pub async fn get_by_login(
        client: &GrafanaClient,
        login: &str,
    ) -> GrafanaResult<GrafanaUser> {
        client
            .api_get(&format!("users/lookup?loginOrEmail={login}"))
            .await
    }

    /// Get user by email.  GET /api/users/lookup?loginOrEmail=:email
    pub async fn get_by_email(
        client: &GrafanaClient,
        email: &str,
    ) -> GrafanaResult<GrafanaUser> {
        client
            .api_get(&format!("users/lookup?loginOrEmail={email}"))
            .await
    }

    /// Create a user (admin).  POST /api/admin/users
    pub async fn create(
        client: &GrafanaClient,
        name: Option<&str>,
        login: &str,
        email: Option<&str>,
        password: &str,
        org_id: Option<u64>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({
            "login": login,
            "password": password,
        });
        if let Some(n) = name {
            body["name"] = serde_json::json!(n);
        }
        if let Some(e) = email {
            body["email"] = serde_json::json!(e);
        }
        if let Some(oid) = org_id {
            body["orgId"] = serde_json::json!(oid);
        }
        client.api_post("admin/users", &body).await
    }

    /// Update user (admin).  PUT /api/users/:id
    pub async fn update(
        client: &GrafanaClient,
        id: u64,
        name: Option<&str>,
        login: Option<&str>,
        email: Option<&str>,
        theme: Option<&str>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({});
        if let Some(n) = name {
            body["name"] = serde_json::json!(n);
        }
        if let Some(l) = login {
            body["login"] = serde_json::json!(l);
        }
        if let Some(e) = email {
            body["email"] = serde_json::json!(e);
        }
        if let Some(t) = theme {
            body["theme"] = serde_json::json!(t);
        }
        client.api_put(&format!("users/{id}"), &body).await
    }

    /// Delete user (admin).  DELETE /api/admin/users/:id
    pub async fn delete(
        client: &GrafanaClient,
        id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        client.api_delete(&format!("admin/users/{id}")).await
    }

    /// Get current (signed-in) user.  GET /api/user
    pub async fn get_current(client: &GrafanaClient) -> GrafanaResult<GrafanaUser> {
        client.api_get("user").await
    }

    /// Update current user.  PUT /api/user
    pub async fn update_current(
        client: &GrafanaClient,
        name: Option<&str>,
        login: Option<&str>,
        email: Option<&str>,
        theme: Option<&str>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({});
        if let Some(n) = name {
            body["name"] = serde_json::json!(n);
        }
        if let Some(l) = login {
            body["login"] = serde_json::json!(l);
        }
        if let Some(e) = email {
            body["email"] = serde_json::json!(e);
        }
        if let Some(t) = theme {
            body["theme"] = serde_json::json!(t);
        }
        client.api_put("user", &body).await
    }

    /// Change current user password.  PUT /api/user/password
    pub async fn change_password(
        client: &GrafanaClient,
        old_password: &str,
        new_password: &str,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({
            "oldPassword": old_password,
            "newPassword": new_password,
        });
        client.api_put("user/password", &body).await
    }

    /// List user organizations.  GET /api/users/:id/orgs
    pub async fn list_orgs(
        client: &GrafanaClient,
        user_id: u64,
    ) -> GrafanaResult<Vec<serde_json::Value>> {
        client.api_get(&format!("users/{user_id}/orgs")).await
    }

    /// List user teams.  GET /api/users/:id/teams
    pub async fn list_teams(
        client: &GrafanaClient,
        user_id: u64,
    ) -> GrafanaResult<Vec<serde_json::Value>> {
        client.api_get(&format!("users/{user_id}/teams")).await
    }

    /// Set user admin permissions.  PUT /api/admin/users/:id/permissions
    pub async fn set_admin(
        client: &GrafanaClient,
        id: u64,
        is_admin: bool,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "isGrafanaAdmin": is_admin });
        client
            .api_put(&format!("admin/users/{id}/permissions"), &body)
            .await
    }
}
