// ── sorng-osticket/src/agents.rs ───────────────────────────────────────────────
use crate::client::OsticketClient;
use crate::error::OsticketResult;
use crate::types::*;

pub struct AgentManager;

impl AgentManager {
    pub async fn list(client: &OsticketClient) -> OsticketResult<Vec<OsticketAgent>> {
        client.get("/agents").await
    }

    pub async fn get(client: &OsticketClient, agent_id: i64) -> OsticketResult<OsticketAgent> {
        client.get(&format!("/agents/{}", agent_id)).await
    }

    pub async fn create(client: &OsticketClient, req: &CreateAgentRequest) -> OsticketResult<OsticketAgent> {
        client.post("/agents", req).await
    }

    pub async fn update(client: &OsticketClient, agent_id: i64, req: &UpdateAgentRequest) -> OsticketResult<OsticketAgent> {
        client.patch(&format!("/agents/{}", agent_id), req).await
    }

    pub async fn delete(client: &OsticketClient, agent_id: i64) -> OsticketResult<()> {
        client.delete(&format!("/agents/{}", agent_id)).await
    }

    pub async fn set_vacation(client: &OsticketClient, agent_id: i64, on_vacation: bool) -> OsticketResult<OsticketAgent> {
        let body = serde_json::json!({ "on_vacation": on_vacation });
        client.patch(&format!("/agents/{}", agent_id), &body).await
    }

    pub async fn get_teams(client: &OsticketClient, agent_id: i64) -> OsticketResult<Vec<OsticketTeam>> {
        client.get(&format!("/agents/{}/teams", agent_id)).await
    }
}
