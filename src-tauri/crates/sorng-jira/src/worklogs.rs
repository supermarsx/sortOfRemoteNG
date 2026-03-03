// ── sorng-jira/src/worklogs.rs ─────────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct WorklogManager;

impl WorklogManager {
    pub async fn list(client: &JiraClient, issue_id_or_key: &str, start_at: Option<u32>, max_results: Option<u32>) -> JiraResult<WorklogsResponse> {
        let mut params = Vec::new();
        if let Some(s) = start_at { params.push(("startAt".into(), s.to_string())); }
        if let Some(m) = max_results { params.push(("maxResults".into(), m.to_string())); }
        client.get_with_params(&client.api_url(&format!("/issue/{}/worklog", issue_id_or_key)), &params).await
    }

    pub async fn get(client: &JiraClient, issue_id_or_key: &str, worklog_id: &str) -> JiraResult<JiraWorklog> {
        client.get(&client.api_url(&format!("/issue/{}/worklog/{}", issue_id_or_key, worklog_id))).await
    }

    pub async fn add(client: &JiraClient, issue_id_or_key: &str, req: &AddWorklogRequest) -> JiraResult<JiraWorklog> {
        client.post(&client.api_url(&format!("/issue/{}/worklog", issue_id_or_key)), req).await
    }

    pub async fn update(client: &JiraClient, issue_id_or_key: &str, worklog_id: &str, req: &AddWorklogRequest) -> JiraResult<JiraWorklog> {
        client.put(&client.api_url(&format!("/issue/{}/worklog/{}", issue_id_or_key, worklog_id)), req).await
    }

    pub async fn delete(client: &JiraClient, issue_id_or_key: &str, worklog_id: &str) -> JiraResult<()> {
        client.delete(&client.api_url(&format!("/issue/{}/worklog/{}", issue_id_or_key, worklog_id))).await
    }
}
