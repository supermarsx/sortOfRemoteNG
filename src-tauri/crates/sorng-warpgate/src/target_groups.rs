// ── sorng-warpgate/src/target_groups.rs ─────────────────────────────────────
//! Warpgate target group management.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct TargetGroupManager;

impl TargetGroupManager {
    /// GET /target-groups
    pub async fn list(client: &WarpgateClient) -> WarpgateResult<Vec<WarpgateTargetGroup>> {
        let resp = client.get("/target-groups").await?;
        let groups: Vec<WarpgateTargetGroup> = serde_json::from_value(resp)?;
        Ok(groups)
    }

    /// POST /target-groups
    pub async fn create(
        client: &WarpgateClient,
        req: &TargetGroupDataRequest,
    ) -> WarpgateResult<WarpgateTargetGroup> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/target-groups", &body).await?;
        let group: WarpgateTargetGroup = serde_json::from_value(resp)?;
        Ok(group)
    }

    /// GET /target-groups/:id
    pub async fn get(
        client: &WarpgateClient,
        group_id: &str,
    ) -> WarpgateResult<WarpgateTargetGroup> {
        let resp = client.get(&format!("/target-groups/{}", group_id)).await?;
        let group: WarpgateTargetGroup = serde_json::from_value(resp)?;
        Ok(group)
    }

    /// PUT /target-groups/:id
    pub async fn update(
        client: &WarpgateClient,
        group_id: &str,
        req: &TargetGroupDataRequest,
    ) -> WarpgateResult<WarpgateTargetGroup> {
        let body = serde_json::to_value(req)?;
        let resp = client
            .put(&format!("/target-groups/{}", group_id), &body)
            .await?;
        let group: WarpgateTargetGroup = serde_json::from_value(resp)?;
        Ok(group)
    }

    /// DELETE /target-groups/:id
    pub async fn delete(client: &WarpgateClient, group_id: &str) -> WarpgateResult<()> {
        client
            .delete(&format!("/target-groups/{}", group_id))
            .await?;
        Ok(())
    }
}
