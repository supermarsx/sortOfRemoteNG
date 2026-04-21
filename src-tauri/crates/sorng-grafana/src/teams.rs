// ── sorng-grafana/src/teams.rs ───────────────────────────────────────────────
//! Team management via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct TeamManager;

impl TeamManager {
    /// List / search teams.  GET /api/teams/search?name=:query
    pub async fn list(client: &GrafanaClient, query: Option<&str>) -> GrafanaResult<Vec<Team>> {
        let path = match query {
            Some(q) => format!("teams/search?name={q}"),
            None => "teams/search".to_string(),
        };
        #[derive(serde::Deserialize)]
        struct Wrapper {
            teams: Vec<Team>,
        }
        let w: Wrapper = client.api_get(&path).await?;
        Ok(w.teams)
    }

    /// Get team by ID.  GET /api/teams/:id
    pub async fn get(client: &GrafanaClient, id: u64) -> GrafanaResult<Team> {
        client.api_get(&format!("teams/{id}")).await
    }

    /// Create a team.  POST /api/teams
    pub async fn create(
        client: &GrafanaClient,
        name: &str,
        email: Option<&str>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({ "name": name });
        if let Some(e) = email {
            body["email"] = serde_json::json!(e);
        }
        client.api_post("teams", &body).await
    }

    /// Update a team.  PUT /api/teams/:id
    pub async fn update(
        client: &GrafanaClient,
        id: u64,
        name: &str,
        email: Option<&str>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({ "name": name });
        if let Some(e) = email {
            body["email"] = serde_json::json!(e);
        }
        client.api_put(&format!("teams/{id}"), &body).await
    }

    /// Delete a team.  DELETE /api/teams/:id
    pub async fn delete(client: &GrafanaClient, id: u64) -> GrafanaResult<serde_json::Value> {
        client.api_delete(&format!("teams/{id}")).await
    }

    /// List team members.  GET /api/teams/:id/members
    pub async fn list_members(client: &GrafanaClient, id: u64) -> GrafanaResult<Vec<TeamMember>> {
        client.api_get(&format!("teams/{id}/members")).await
    }

    /// Add team member.  POST /api/teams/:id/members
    pub async fn add_member(
        client: &GrafanaClient,
        id: u64,
        user_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "userId": user_id });
        client.api_post(&format!("teams/{id}/members"), &body).await
    }

    /// Remove team member.  DELETE /api/teams/:id/members/:userId
    pub async fn remove_member(
        client: &GrafanaClient,
        id: u64,
        user_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        client
            .api_delete(&format!("teams/{id}/members/{user_id}"))
            .await
    }

    /// Get team preferences.  GET /api/teams/:id/preferences
    pub async fn get_preferences(
        client: &GrafanaClient,
        id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        client.api_get(&format!("teams/{id}/preferences")).await
    }

    /// Update team preferences.  PUT /api/teams/:id/preferences
    pub async fn update_preferences(
        client: &GrafanaClient,
        id: u64,
        prefs: &serde_json::Value,
    ) -> GrafanaResult<serde_json::Value> {
        client
            .api_put(&format!("teams/{id}/preferences"), prefs)
            .await
    }
}
