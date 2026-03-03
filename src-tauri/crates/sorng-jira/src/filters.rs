// ── sorng-jira/src/filters.rs ──────────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct FilterManager;

impl FilterManager {
    pub async fn get(client: &JiraClient, filter_id: &str) -> JiraResult<JiraFilter> {
        client.get(&client.api_url(&format!("/filter/{}", filter_id))).await
    }

    pub async fn get_favourites(client: &JiraClient) -> JiraResult<Vec<JiraFilter>> {
        client.get(&client.api_url("/filter/favourite")).await
    }

    pub async fn get_my_filters(client: &JiraClient) -> JiraResult<Vec<JiraFilter>> {
        client.get(&client.api_url("/filter/my")).await
    }

    pub async fn create(client: &JiraClient, req: &CreateFilterRequest) -> JiraResult<JiraFilter> {
        client.post(&client.api_url("/filter"), req).await
    }

    pub async fn update(client: &JiraClient, filter_id: &str, req: &UpdateFilterRequest) -> JiraResult<JiraFilter> {
        client.put(&client.api_url(&format!("/filter/{}", filter_id)), req).await
    }

    pub async fn delete(client: &JiraClient, filter_id: &str) -> JiraResult<()> {
        client.delete(&client.api_url(&format!("/filter/{}", filter_id))).await
    }

    pub async fn search(client: &JiraClient, name: &str) -> JiraResult<Vec<JiraFilter>> {
        let params = vec![("filterName".into(), name.to_string())];
        client.get_with_params(&client.api_url("/filter/search"), &params).await
    }
}
