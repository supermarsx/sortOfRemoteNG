// ── sorng-jira/src/projects.rs ─────────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct ProjectManager;

impl ProjectManager {
    pub async fn list(client: &JiraClient) -> JiraResult<Vec<JiraProject>> {
        client.get(&client.api_url("/project")).await
    }

    pub async fn get(client: &JiraClient, project_id_or_key: &str) -> JiraResult<JiraProject> {
        client
            .get(&client.api_url(&format!("/project/{}", project_id_or_key)))
            .await
    }

    pub async fn create(
        client: &JiraClient,
        req: &CreateProjectRequest,
    ) -> JiraResult<JiraProject> {
        client.post(&client.api_url("/project"), req).await
    }

    pub async fn delete(client: &JiraClient, project_id_or_key: &str) -> JiraResult<()> {
        client
            .delete(&client.api_url(&format!("/project/{}", project_id_or_key)))
            .await
    }

    pub async fn get_statuses(
        client: &JiraClient,
        project_id_or_key: &str,
    ) -> JiraResult<Vec<serde_json::Value>> {
        client
            .get(&client.api_url(&format!("/project/{}/statuses", project_id_or_key)))
            .await
    }

    pub async fn get_components(
        client: &JiraClient,
        project_id_or_key: &str,
    ) -> JiraResult<Vec<serde_json::Value>> {
        client
            .get(&client.api_url(&format!("/project/{}/components", project_id_or_key)))
            .await
    }

    pub async fn get_versions(
        client: &JiraClient,
        project_id_or_key: &str,
    ) -> JiraResult<Vec<serde_json::Value>> {
        client
            .get(&client.api_url(&format!("/project/{}/versions", project_id_or_key)))
            .await
    }
}
