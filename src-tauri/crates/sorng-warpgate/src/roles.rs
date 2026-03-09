// ── sorng-warpgate/src/roles.rs ─────────────────────────────────────────────
//! Warpgate role management.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct RoleManager;

impl RoleManager {
    /// GET /roles?search=
    pub async fn list(
        client: &WarpgateClient,
        search: Option<&str>,
    ) -> WarpgateResult<Vec<WarpgateRole>> {
        let resp = match search {
            Some(s) => client.get_with_params("/roles", &[("search", s)]).await?,
            None => client.get("/roles").await?,
        };
        let roles: Vec<WarpgateRole> = serde_json::from_value(resp)?;
        Ok(roles)
    }

    /// POST /roles
    pub async fn create(
        client: &WarpgateClient,
        req: &RoleDataRequest,
    ) -> WarpgateResult<WarpgateRole> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/roles", &body).await?;
        let role: WarpgateRole = serde_json::from_value(resp)?;
        Ok(role)
    }

    /// GET /role/:id  (NOTE: Warpgate uses singular /role/:id)
    pub async fn get(client: &WarpgateClient, role_id: &str) -> WarpgateResult<WarpgateRole> {
        let resp = client.get(&format!("/role/{}", role_id)).await?;
        let role: WarpgateRole = serde_json::from_value(resp)?;
        Ok(role)
    }

    /// PUT /role/:id
    pub async fn update(
        client: &WarpgateClient,
        role_id: &str,
        req: &RoleDataRequest,
    ) -> WarpgateResult<WarpgateRole> {
        let body = serde_json::to_value(req)?;
        let resp = client.put(&format!("/role/{}", role_id), &body).await?;
        let role: WarpgateRole = serde_json::from_value(resp)?;
        Ok(role)
    }

    /// DELETE /role/:id
    pub async fn delete(client: &WarpgateClient, role_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/role/{}", role_id)).await?;
        Ok(())
    }

    /// GET /role/:id/targets
    pub async fn get_targets(
        client: &WarpgateClient,
        role_id: &str,
    ) -> WarpgateResult<Vec<WarpgateTarget>> {
        let resp = client.get(&format!("/role/{}/targets", role_id)).await?;
        let targets: Vec<WarpgateTarget> = serde_json::from_value(resp)?;
        Ok(targets)
    }

    /// GET /role/:id/users
    pub async fn get_users(
        client: &WarpgateClient,
        role_id: &str,
    ) -> WarpgateResult<Vec<WarpgateUser>> {
        let resp = client.get(&format!("/role/{}/users", role_id)).await?;
        let users: Vec<WarpgateUser> = serde_json::from_value(resp)?;
        Ok(users)
    }
}
