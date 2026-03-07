//! Team management for Grafana.

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct TeamManager<'a> {
    client: &'a GrafanaClient,
}

impl<'a> TeamManager<'a> {
    pub fn new(client: &'a GrafanaClient) -> Self {
        Self { client }
    }

    /// List all teams with optional search.
    pub async fn list(&self, query: Option<&str>, page: Option<i64>, per_page: Option<i64>) -> GrafanaResult<Vec<GrafanaTeam>> {
        let mut params: Vec<(String, String)> = Vec::new();
        if let Some(q) = query {
            params.push(("query".into(), q.to_string()));
        }
        if let Some(p) = page {
            params.push(("page".into(), p.to_string()));
        }
        if let Some(pp) = per_page {
            params.push(("perpage".into(), pp.to_string()));
        }
        #[derive(serde::Deserialize)]
        struct TeamsResponse {
            teams: Vec<GrafanaTeam>,
        }
        if params.is_empty() {
            let resp: TeamsResponse = self.client.api_get("/teams/search").await?;
            Ok(resp.teams)
        } else {
            let resp: TeamsResponse = self.client.api_get_with_query("/teams/search", &params).await?;
            Ok(resp.teams)
        }
    }

    /// Get a team by ID.
    pub async fn get(&self, team_id: i64) -> GrafanaResult<GrafanaTeam> {
        self.client
            .api_get(&format!("/teams/{}", team_id))
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::team_not_found(format!("Team {} not found", team_id))
                }
                _ => e,
            })
    }

    /// Create a new team.
    pub async fn create(&self, req: CreateTeamRequest) -> GrafanaResult<serde_json::Value> {
        self.client.api_post("/teams", &req).await
    }

    /// Update a team.
    pub async fn update(&self, team_id: i64, req: CreateTeamRequest) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_put(&format!("/teams/{}", team_id), &req)
            .await
    }

    /// Delete a team.
    pub async fn delete(&self, team_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/teams/{}", team_id))
            .await
    }

    /// List members of a team.
    pub async fn list_members(&self, team_id: i64) -> GrafanaResult<Vec<TeamMember>> {
        self.client
            .api_get(&format!("/teams/{}/members", team_id))
            .await
    }

    /// Add a member to a team.
    pub async fn add_member(&self, team_id: i64, req: AddTeamMemberRequest) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_post(&format!("/teams/{}/members", team_id), &req)
            .await
    }

    /// Remove a member from a team.
    pub async fn remove_member(&self, team_id: i64, user_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/teams/{}/members/{}", team_id, user_id))
            .await
    }

    /// Get team preferences.
    pub async fn get_preferences(&self, team_id: i64) -> GrafanaResult<TeamPreferences> {
        self.client
            .api_get(&format!("/teams/{}/preferences", team_id))
            .await
    }

    /// Update team preferences.
    pub async fn update_preferences(
        &self,
        team_id: i64,
        prefs: TeamPreferences,
    ) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_put(&format!("/teams/{}/preferences", team_id), &prefs)
            .await
    }
}
