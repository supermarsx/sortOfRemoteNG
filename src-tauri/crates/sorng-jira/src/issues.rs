// ── sorng-jira/src/issues.rs ───────────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct IssueManager;

impl IssueManager {
    pub async fn get(client: &JiraClient, issue_id_or_key: &str, expand: Option<&str>) -> JiraResult<JiraIssue> {
        let mut url = client.api_url(&format!("/issue/{}", issue_id_or_key));
        if let Some(e) = expand { url.push_str(&format!("?expand={}", e)); }
        client.get(&url).await
    }

    pub async fn create(client: &JiraClient, req: &CreateIssueRequest) -> JiraResult<JiraIssue> {
        client.post(&client.api_url("/issue"), req).await
    }

    pub async fn bulk_create(client: &JiraClient, req: &BulkCreateIssueRequest) -> JiraResult<BulkCreateIssueResponse> {
        client.post(&client.api_url("/issue/bulk"), req).await
    }

    pub async fn update(client: &JiraClient, issue_id_or_key: &str, req: &UpdateIssueRequest) -> JiraResult<()> {
        client.put_unit(&client.api_url(&format!("/issue/{}", issue_id_or_key)), req).await
    }

    pub async fn delete(client: &JiraClient, issue_id_or_key: &str, delete_subtasks: bool) -> JiraResult<()> {
        let mut url = client.api_url(&format!("/issue/{}", issue_id_or_key));
        if delete_subtasks { url.push_str("?deleteSubtasks=true"); }
        client.delete(&url).await
    }

    pub async fn search(client: &JiraClient, req: &JiraSearchRequest) -> JiraResult<JiraSearchResponse> {
        client.post(&client.api_url("/search"), req).await
    }

    pub async fn get_transitions(client: &JiraClient, issue_id_or_key: &str) -> JiraResult<Vec<JiraTransition>> {
        #[derive(serde::Deserialize)]
        struct Wrap { transitions: Vec<JiraTransition> }
        let w: Wrap = client.get(&client.api_url(&format!("/issue/{}/transitions", issue_id_or_key))).await?;
        Ok(w.transitions)
    }

    pub async fn transition(client: &JiraClient, issue_id_or_key: &str, req: &TransitionRequest) -> JiraResult<()> {
        client.post_unit(&client.api_url(&format!("/issue/{}/transitions", issue_id_or_key)), req).await
    }

    pub async fn assign(client: &JiraClient, issue_id_or_key: &str, account_id: Option<&str>) -> JiraResult<()> {
        let body = serde_json::json!({ "accountId": account_id });
        client.put_unit(&client.api_url(&format!("/issue/{}/assignee", issue_id_or_key)), &body).await
    }

    pub async fn get_changelog(client: &JiraClient, issue_id_or_key: &str) -> JiraResult<Vec<JiraChangelogEntry>> {
        let issue: JiraIssue = client.get(&format!("{}?expand=changelog", client.api_url(&format!("/issue/{}", issue_id_or_key)))).await?;
        Ok(issue.changelog.map(|c| c.histories).unwrap_or_default())
    }

    pub async fn link(client: &JiraClient, link_type: &str, inward_key: &str, outward_key: &str) -> JiraResult<()> {
        let body = serde_json::json!({
            "type": { "name": link_type },
            "inwardIssue": { "key": inward_key },
            "outwardIssue": { "key": outward_key },
        });
        client.post_unit(&client.api_url("/issueLink"), &body).await
    }

    pub async fn get_watchers(client: &JiraClient, issue_id_or_key: &str) -> JiraResult<Vec<JiraUser>> {
        #[derive(serde::Deserialize)]
        struct Wrap { watchers: Vec<JiraUser> }
        let w: Wrap = client.get(&client.api_url(&format!("/issue/{}/watchers", issue_id_or_key))).await?;
        Ok(w.watchers)
    }

    pub async fn add_watcher(client: &JiraClient, issue_id_or_key: &str, account_id: &str) -> JiraResult<()> {
        client.post_unit(&client.api_url(&format!("/issue/{}/watchers", issue_id_or_key)), &serde_json::json!(account_id)).await
    }
}
