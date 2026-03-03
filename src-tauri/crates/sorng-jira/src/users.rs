// ── sorng-jira/src/users.rs ────────────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct JiraUserManager;

impl JiraUserManager {
    pub async fn get_myself(client: &JiraClient) -> JiraResult<JiraUser> {
        client.get(&client.api_url("/myself")).await
    }

    pub async fn get(client: &JiraClient, account_id: &str) -> JiraResult<JiraUser> {
        let params = vec![("accountId".into(), account_id.to_string())];
        client.get_with_params(&client.api_url("/user"), &params).await
    }

    pub async fn search(client: &JiraClient, query: &str, start_at: Option<u32>, max_results: Option<u32>) -> JiraResult<Vec<JiraUser>> {
        let mut params = vec![("query".into(), query.to_string())];
        if let Some(s) = start_at { params.push(("startAt".into(), s.to_string())); }
        if let Some(m) = max_results { params.push(("maxResults".into(), m.to_string())); }
        client.get_with_params(&client.api_url("/user/search"), &params).await
    }

    pub async fn find_assignable(client: &JiraClient, project: &str, query: Option<&str>) -> JiraResult<Vec<JiraUser>> {
        let mut params = vec![("project".into(), project.to_string())];
        if let Some(q) = query { params.push(("query".into(), q.to_string())); }
        client.get_with_params(&client.api_url("/user/assignable/search"), &params).await
    }

    pub async fn get_groups(client: &JiraClient, account_id: &str) -> JiraResult<Vec<serde_json::Value>> {
        let params = vec![("accountId".into(), account_id.to_string())];
        client.get_with_params(&client.api_url("/user/groups"), &params).await
    }
}
