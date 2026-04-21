// ── sorng-jira/src/dashboards.rs ───────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct DashboardManager;

impl DashboardManager {
    pub async fn list(
        client: &JiraClient,
        start_at: Option<u32>,
        max_results: Option<u32>,
    ) -> JiraResult<DashboardsResponse> {
        let mut params = Vec::new();
        if let Some(s) = start_at {
            params.push(("startAt".into(), s.to_string()));
        }
        if let Some(m) = max_results {
            params.push(("maxResults".into(), m.to_string()));
        }
        client
            .get_with_params(&client.api_url("/dashboard"), &params)
            .await
    }

    pub async fn get(client: &JiraClient, dashboard_id: &str) -> JiraResult<JiraDashboard> {
        client
            .get(&client.api_url(&format!("/dashboard/{}", dashboard_id)))
            .await
    }

    pub async fn search(client: &JiraClient, name: &str) -> JiraResult<DashboardsResponse> {
        let params = vec![("filter".into(), name.to_string())];
        client
            .get_with_params(&client.api_url("/dashboard/search"), &params)
            .await
    }
}
