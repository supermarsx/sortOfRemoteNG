// ── sorng-jira/src/sprints.rs ──────────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct SprintManager;

impl SprintManager {
    pub async fn list(client: &JiraClient, board_id: i64, start_at: Option<u32>, max_results: Option<u32>, state: Option<&str>) -> JiraResult<SprintsResponse> {
        let mut params = Vec::new();
        if let Some(s) = start_at { params.push(("startAt".into(), s.to_string())); }
        if let Some(m) = max_results { params.push(("maxResults".into(), m.to_string())); }
        if let Some(st) = state { params.push(("state".into(), st.to_string())); }
        client.get_with_params(&client.agile_url(&format!("/board/{}/sprint", board_id)), &params).await
    }

    pub async fn get(client: &JiraClient, sprint_id: i64) -> JiraResult<JiraSprint> {
        client.get(&client.agile_url(&format!("/sprint/{}", sprint_id))).await
    }

    pub async fn create(client: &JiraClient, req: &CreateSprintRequest) -> JiraResult<JiraSprint> {
        client.post(&client.agile_url("/sprint"), req).await
    }

    pub async fn update(client: &JiraClient, sprint_id: i64, req: &UpdateSprintRequest) -> JiraResult<JiraSprint> {
        client.put(&client.agile_url(&format!("/sprint/{}", sprint_id)), req).await
    }

    pub async fn delete(client: &JiraClient, sprint_id: i64) -> JiraResult<()> {
        client.delete(&client.agile_url(&format!("/sprint/{}", sprint_id))).await
    }

    pub async fn get_issues(client: &JiraClient, sprint_id: i64, start_at: Option<u32>, max_results: Option<u32>) -> JiraResult<JiraSearchResponse> {
        let mut params = Vec::new();
        if let Some(s) = start_at { params.push(("startAt".into(), s.to_string())); }
        if let Some(m) = max_results { params.push(("maxResults".into(), m.to_string())); }
        client.get_with_params(&client.agile_url(&format!("/sprint/{}/issue", sprint_id)), &params).await
    }

    pub async fn move_issues(client: &JiraClient, sprint_id: i64, req: &MoveIssuesToSprintRequest) -> JiraResult<()> {
        client.post_unit(&client.agile_url(&format!("/sprint/{}/issue", sprint_id)), req).await
    }

    pub async fn start(client: &JiraClient, sprint_id: i64) -> JiraResult<JiraSprint> {
        let req = UpdateSprintRequest { state: Some("active".into()), name: None, start_date: None, end_date: None, goal: None };
        client.put(&client.agile_url(&format!("/sprint/{}", sprint_id)), &req).await
    }

    pub async fn complete(client: &JiraClient, sprint_id: i64) -> JiraResult<JiraSprint> {
        let req = UpdateSprintRequest { state: Some("closed".into()), name: None, start_date: None, end_date: None, goal: None };
        client.put(&client.agile_url(&format!("/sprint/{}", sprint_id)), &req).await
    }
}
