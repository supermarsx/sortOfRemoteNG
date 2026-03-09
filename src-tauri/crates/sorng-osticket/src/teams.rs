// ── sorng-osticket/src/teams.rs ────────────────────────────────────────────────
use crate::client::OsticketClient;
use crate::error::OsticketResult;
use crate::types::*;

pub struct TeamManager;

impl TeamManager {
    pub async fn list(client: &OsticketClient) -> OsticketResult<Vec<OsticketTeam>> {
        client.get("/teams").await
    }

    pub async fn get(client: &OsticketClient, team_id: i64) -> OsticketResult<OsticketTeam> {
        client.get(&format!("/teams/{}", team_id)).await
    }

    pub async fn create(
        client: &OsticketClient,
        req: &CreateTeamRequest,
    ) -> OsticketResult<OsticketTeam> {
        client.post("/teams", req).await
    }

    pub async fn update(
        client: &OsticketClient,
        team_id: i64,
        req: &UpdateTeamRequest,
    ) -> OsticketResult<OsticketTeam> {
        client.patch(&format!("/teams/{}", team_id), req).await
    }

    pub async fn delete(client: &OsticketClient, team_id: i64) -> OsticketResult<()> {
        client.delete(&format!("/teams/{}", team_id)).await
    }

    pub async fn add_member(
        client: &OsticketClient,
        team_id: i64,
        staff_id: i64,
    ) -> OsticketResult<TeamMember> {
        let body = serde_json::json!({ "staff_id": staff_id });
        client
            .post(&format!("/teams/{}/members", team_id), &body)
            .await
    }

    pub async fn remove_member(
        client: &OsticketClient,
        team_id: i64,
        staff_id: i64,
    ) -> OsticketResult<()> {
        client
            .delete(&format!("/teams/{}/members/{}", team_id, staff_id))
            .await
    }

    pub async fn get_members(
        client: &OsticketClient,
        team_id: i64,
    ) -> OsticketResult<Vec<TeamMember>> {
        client.get(&format!("/teams/{}/members", team_id)).await
    }
}
