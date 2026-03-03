// ── sorng-warpgate/src/users.rs ─────────────────────────────────────────────
//! Warpgate user management.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct UserManager;

impl UserManager {
    /// GET /users?search=
    pub async fn list(client: &WarpgateClient, search: Option<&str>) -> WarpgateResult<Vec<WarpgateUser>> {
        let resp = match search {
            Some(s) => client.get_with_params("/users", &[("search", s)]).await?,
            None => client.get("/users").await?,
        };
        let users: Vec<WarpgateUser> = serde_json::from_value(resp)?;
        Ok(users)
    }

    /// POST /users
    pub async fn create(client: &WarpgateClient, req: &CreateUserRequest) -> WarpgateResult<WarpgateUser> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/users", &body).await?;
        let user: WarpgateUser = serde_json::from_value(resp)?;
        Ok(user)
    }

    /// GET /users/:id
    pub async fn get(client: &WarpgateClient, user_id: &str) -> WarpgateResult<WarpgateUser> {
        let resp = client.get(&format!("/users/{}", user_id)).await?;
        let user: WarpgateUser = serde_json::from_value(resp)?;
        Ok(user)
    }

    /// PUT /users/:id
    pub async fn update(client: &WarpgateClient, user_id: &str, req: &UpdateUserRequest) -> WarpgateResult<WarpgateUser> {
        let body = serde_json::to_value(req)?;
        let resp = client.put(&format!("/users/{}", user_id), &body).await?;
        let user: WarpgateUser = serde_json::from_value(resp)?;
        Ok(user)
    }

    /// DELETE /users/:id
    pub async fn delete(client: &WarpgateClient, user_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/users/{}", user_id)).await?;
        Ok(())
    }

    /// GET /users/:id/roles
    pub async fn get_roles(client: &WarpgateClient, user_id: &str) -> WarpgateResult<Vec<WarpgateRole>> {
        let resp = client.get(&format!("/users/{}/roles", user_id)).await?;
        let roles: Vec<WarpgateRole> = serde_json::from_value(resp)?;
        Ok(roles)
    }

    /// POST /users/:id/roles/:role_id
    pub async fn add_role(client: &WarpgateClient, user_id: &str, role_id: &str) -> WarpgateResult<()> {
        client.post_empty(&format!("/users/{}/roles/{}", user_id, role_id)).await?;
        Ok(())
    }

    /// DELETE /users/:id/roles/:role_id
    pub async fn remove_role(client: &WarpgateClient, user_id: &str, role_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/users/{}/roles/{}", user_id, role_id)).await?;
        Ok(())
    }

    /// POST /users/:id/ldap-link/unlink
    pub async fn unlink_ldap(client: &WarpgateClient, user_id: &str) -> WarpgateResult<WarpgateUser> {
        let resp = client.post_empty(&format!("/users/{}/ldap-link/unlink", user_id)).await?;
        let user: WarpgateUser = serde_json::from_value(resp)?;
        Ok(user)
    }

    /// POST /users/:id/ldap-link/auto-link
    pub async fn auto_link_ldap(client: &WarpgateClient, user_id: &str) -> WarpgateResult<WarpgateUser> {
        let resp = client.post_empty(&format!("/users/{}/ldap-link/auto-link", user_id)).await?;
        let user: WarpgateUser = serde_json::from_value(resp)?;
        Ok(user)
    }
}
