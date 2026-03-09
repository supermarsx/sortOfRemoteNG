// ── sorng-jira/src/fields.rs ───────────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct FieldManager;

impl FieldManager {
    pub async fn list(client: &JiraClient) -> JiraResult<Vec<JiraField>> {
        client.get(&client.api_url("/field")).await
    }

    pub async fn get_all_issue_types(client: &JiraClient) -> JiraResult<Vec<JiraIssueType>> {
        client.get(&client.api_url("/issuetype")).await
    }

    pub async fn get_priorities(client: &JiraClient) -> JiraResult<Vec<JiraPriority>> {
        client.get(&client.api_url("/priority")).await
    }

    pub async fn get_statuses(client: &JiraClient) -> JiraResult<Vec<JiraStatus>> {
        client.get(&client.api_url("/status")).await
    }

    pub async fn get_resolutions(client: &JiraClient) -> JiraResult<Vec<serde_json::Value>> {
        client.get(&client.api_url("/resolution")).await
    }

    pub async fn create_custom_field(
        client: &JiraClient,
        name: &str,
        field_type: &str,
        description: Option<&str>,
        searcher_key: Option<&str>,
    ) -> JiraResult<JiraField> {
        let mut body = serde_json::json!({ "name": name, "type": field_type });
        if let Some(d) = description {
            body["description"] = serde_json::json!(d);
        }
        if let Some(s) = searcher_key {
            body["searcherKey"] = serde_json::json!(s);
        }
        client.post(&client.api_url("/field"), &body).await
    }
}
