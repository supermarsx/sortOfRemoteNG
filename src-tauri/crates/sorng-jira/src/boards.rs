// ── sorng-jira/src/boards.rs ───────────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct BoardManager;

impl BoardManager {
    pub async fn list(client: &JiraClient, start_at: Option<u32>, max_results: Option<u32>, project_key: Option<&str>, board_type: Option<&str>) -> JiraResult<BoardsResponse> {
        let mut params = Vec::new();
        if let Some(s) = start_at { params.push(("startAt".into(), s.to_string())); }
        if let Some(m) = max_results { params.push(("maxResults".into(), m.to_string())); }
        if let Some(p) = project_key { params.push(("projectKeyOrId".into(), p.to_string())); }
        if let Some(t) = board_type { params.push(("type".into(), t.to_string())); }
        client.get_with_params(&client.agile_url("/board"), &params).await
    }

    pub async fn get(client: &JiraClient, board_id: i64) -> JiraResult<JiraBoard> {
        client.get(&client.agile_url(&format!("/board/{}", board_id))).await
    }

    pub async fn get_issues(client: &JiraClient, board_id: i64, start_at: Option<u32>, max_results: Option<u32>, jql: Option<&str>) -> JiraResult<JiraSearchResponse> {
        let mut params = Vec::new();
        if let Some(s) = start_at { params.push(("startAt".into(), s.to_string())); }
        if let Some(m) = max_results { params.push(("maxResults".into(), m.to_string())); }
        if let Some(j) = jql { params.push(("jql".into(), j.to_string())); }
        client.get_with_params(&client.agile_url(&format!("/board/{}/issue", board_id)), &params).await
    }

    pub async fn get_backlog(client: &JiraClient, board_id: i64, start_at: Option<u32>, max_results: Option<u32>) -> JiraResult<JiraSearchResponse> {
        let mut params = Vec::new();
        if let Some(s) = start_at { params.push(("startAt".into(), s.to_string())); }
        if let Some(m) = max_results { params.push(("maxResults".into(), m.to_string())); }
        client.get_with_params(&client.agile_url(&format!("/board/{}/backlog", board_id)), &params).await
    }

    pub async fn get_configuration(client: &JiraClient, board_id: i64) -> JiraResult<serde_json::Value> {
        client.get(&client.agile_url(&format!("/board/{}/configuration", board_id))).await
    }

    pub async fn get_epics(client: &JiraClient, board_id: i64) -> JiraResult<serde_json::Value> {
        client.get(&client.agile_url(&format!("/board/{}/epic", board_id))).await
    }
}
