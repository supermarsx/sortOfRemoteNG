// ── Roundcube filter (ManageSieve) management ────────────────────────────────

use crate::client::RoundcubeClient;
use crate::error::RoundcubeResult;
use crate::types::*;
use log::debug;

pub struct FilterManager;

impl FilterManager {
    /// GET /filters — list all filters.
    pub async fn list(client: &RoundcubeClient) -> RoundcubeResult<Vec<RoundcubeFilter>> {
        debug!("ROUNDCUBE list_filters");
        client.get("/filters").await
    }

    /// GET /filters/:id — get a single filter.
    pub async fn get(client: &RoundcubeClient, id: &str) -> RoundcubeResult<RoundcubeFilter> {
        debug!("ROUNDCUBE get_filter id={id}");
        client.get(&format!("/filters/{id}")).await
    }

    /// POST /filters — create a new filter.
    pub async fn create(
        client: &RoundcubeClient,
        req: &CreateFilterRequest,
    ) -> RoundcubeResult<RoundcubeFilter> {
        debug!("ROUNDCUBE create_filter name={}", req.name);
        client.post("/filters", req).await
    }

    /// PUT /filters/:id — update an existing filter.
    pub async fn update(
        client: &RoundcubeClient,
        id: &str,
        req: &UpdateFilterRequest,
    ) -> RoundcubeResult<RoundcubeFilter> {
        debug!("ROUNDCUBE update_filter id={id}");
        client.put(&format!("/filters/{id}"), req).await
    }

    /// DELETE /filters/:id — delete a filter.
    pub async fn delete(client: &RoundcubeClient, id: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE delete_filter id={id}");
        client.delete(&format!("/filters/{id}")).await
    }

    /// POST /filters/:id/enable — enable a filter.
    pub async fn enable(client: &RoundcubeClient, id: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE enable_filter id={id}");
        client.post_no_body(&format!("/filters/{id}/enable")).await
    }

    /// POST /filters/:id/disable — disable a filter.
    pub async fn disable(client: &RoundcubeClient, id: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE disable_filter id={id}");
        client.post_no_body(&format!("/filters/{id}/disable")).await
    }

    /// PUT /filters/reorder — reorder filters by ID list.
    pub async fn reorder(client: &RoundcubeClient, ids: &[String]) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE reorder_filters count={}", ids.len());
        let body = serde_json::json!({ "ids": ids });
        client.put_no_response("/filters/reorder", &body).await
    }
}
