// ── sorng-warpgate/src/targets.rs ───────────────────────────────────────────
//! Warpgate target management.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct TargetManager;

impl TargetManager {
    /// GET /targets?search=&group_id=
    pub async fn list(client: &WarpgateClient, search: Option<&str>, group_id: Option<&str>) -> WarpgateResult<Vec<WarpgateTarget>> {
        let mut params = Vec::new();
        if let Some(s) = search { params.push(("search", s)); }
        if let Some(g) = group_id { params.push(("group_id", g)); }
        let resp = if params.is_empty() {
            client.get("/targets").await?
        } else {
            client.get_with_params("/targets", &params).await?
        };
        let targets: Vec<WarpgateTarget> = serde_json::from_value(resp)?;
        Ok(targets)
    }

    /// POST /targets
    pub async fn create(client: &WarpgateClient, req: &TargetDataRequest) -> WarpgateResult<WarpgateTarget> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/targets", &body).await?;
        let target: WarpgateTarget = serde_json::from_value(resp)?;
        Ok(target)
    }

    /// GET /targets/:id
    pub async fn get(client: &WarpgateClient, target_id: &str) -> WarpgateResult<WarpgateTarget> {
        let resp = client.get(&format!("/targets/{}", target_id)).await?;
        let target: WarpgateTarget = serde_json::from_value(resp)?;
        Ok(target)
    }

    /// PUT /targets/:id
    pub async fn update(client: &WarpgateClient, target_id: &str, req: &TargetDataRequest) -> WarpgateResult<WarpgateTarget> {
        let body = serde_json::to_value(req)?;
        let resp = client.put(&format!("/targets/{}", target_id), &body).await?;
        let target: WarpgateTarget = serde_json::from_value(resp)?;
        Ok(target)
    }

    /// DELETE /targets/:id
    pub async fn delete(client: &WarpgateClient, target_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/targets/{}", target_id)).await?;
        Ok(())
    }

    /// GET /targets/:id/known-ssh-host-keys
    pub async fn get_known_ssh_host_keys(client: &WarpgateClient, target_id: &str) -> WarpgateResult<Vec<WarpgateKnownHost>> {
        let resp = client.get(&format!("/targets/{}/known-ssh-host-keys", target_id)).await?;
        let hosts: Vec<WarpgateKnownHost> = serde_json::from_value(resp)?;
        Ok(hosts)
    }

    /// GET /targets/:id/roles
    pub async fn get_roles(client: &WarpgateClient, target_id: &str) -> WarpgateResult<Vec<WarpgateRole>> {
        let resp = client.get(&format!("/targets/{}/roles", target_id)).await?;
        let roles: Vec<WarpgateRole> = serde_json::from_value(resp)?;
        Ok(roles)
    }

    /// POST /targets/:id/roles/:role_id
    pub async fn add_role(client: &WarpgateClient, target_id: &str, role_id: &str) -> WarpgateResult<()> {
        client.post_empty(&format!("/targets/{}/roles/{}", target_id, role_id)).await?;
        Ok(())
    }

    /// DELETE /targets/:id/roles/:role_id
    pub async fn remove_role(client: &WarpgateClient, target_id: &str, role_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/targets/{}/roles/{}", target_id, role_id)).await?;
        Ok(())
    }
}
