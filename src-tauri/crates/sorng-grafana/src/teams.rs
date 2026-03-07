// ── Grafana team management ──────────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct TeamManager;

impl TeamManager {
    pub async fn list_teams(client: &GrafanaClient) -> GrafanaResult<Vec<Team>> {
        let body = client.api_get("/api/teams/search").await?;
        let wrapper: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| GrafanaError::parse(format!("list_teams: {e}")))?;
        let items = wrapper.get("teams").cloned().unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(items).map_err(|e| GrafanaError::parse(format!("list_teams parse: {e}")))
    }

    pub async fn get_team(client: &GrafanaClient, id: i64) -> GrafanaResult<Team> {
        let body = client.api_get(&format!("/api/teams/{id}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_team: {e}")))
    }

    pub async fn create_team(client: &GrafanaClient, req: &CreateTeamRequest) -> GrafanaResult<Team> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/teams", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_team: {e}")))
    }

    pub async fn update_team(client: &GrafanaClient, id: i64, req: &UpdateTeamRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put(&format!("/api/teams/{id}"), &payload).await?;
        Ok(())
    }

    pub async fn delete_team(client: &GrafanaClient, id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/teams/{id}")).await?;
        Ok(())
    }

    pub async fn list_team_members(client: &GrafanaClient, id: i64) -> GrafanaResult<Vec<TeamMember>> {
        let body = client.api_get(&format!("/api/teams/{id}/members")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_team_members: {e}")))
    }

    pub async fn add_team_member(client: &GrafanaClient, team_id: i64, req: &AddTeamMemberRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post(&format!("/api/teams/{team_id}/members"), &payload).await?;
        Ok(())
    }

    pub async fn remove_team_member(client: &GrafanaClient, team_id: i64, user_id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/teams/{team_id}/members/{user_id}")).await?;
        Ok(())
    }

    pub async fn get_team_preferences(client: &GrafanaClient, id: i64) -> GrafanaResult<TeamPreferences> {
        let body = client.api_get(&format!("/api/teams/{id}/preferences")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_team_preferences: {e}")))
    }

    pub async fn update_team_preferences(client: &GrafanaClient, id: i64, prefs: &TeamPreferences) -> GrafanaResult<()> {
        let payload = serde_json::to_string(prefs).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put(&format!("/api/teams/{id}/preferences"), &payload).await?;
        Ok(())
    }

    pub async fn list_team_groups(client: &GrafanaClient, id: i64) -> GrafanaResult<Vec<TeamGroup>> {
        let body = client.api_get(&format!("/api/teams/{id}/groups")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_team_groups: {e}")))
    }

    pub async fn add_team_group(client: &GrafanaClient, team_id: i64, req: &AddTeamGroupRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post(&format!("/api/teams/{team_id}/groups"), &payload).await?;
        Ok(())
    }

    pub async fn remove_team_group(client: &GrafanaClient, team_id: i64, group_id: &str) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/teams/{team_id}/groups/{group_id}")).await?;
        Ok(())
    }
}
