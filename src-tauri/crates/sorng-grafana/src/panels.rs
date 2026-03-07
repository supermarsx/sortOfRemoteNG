// ── Grafana panel management ─────────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct PanelManager;

impl PanelManager {
    pub async fn list_panel_types(client: &GrafanaClient) -> GrafanaResult<Vec<PanelType>> {
        let body = client.api_get("/api/plugins?type=panel").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_panel_types: {e}")))
    }

    pub async fn get_panel_schema(client: &GrafanaClient, panel_type: &str) -> GrafanaResult<PanelSchema> {
        let body = client.api_get(&format!("/api/plugins/{panel_type}/settings")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_panel_schema: {e}")))
    }

    pub async fn list_library_panels(client: &GrafanaClient) -> GrafanaResult<Vec<LibraryPanel>> {
        let body = client.api_get("/api/library-elements?kind=1").await?;
        let wrapper: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| GrafanaError::parse(format!("list_library_panels: {e}")))?;
        let result = wrapper.get("result").and_then(|r| r.get("elements"))
            .cloned().unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(result).map_err(|e| GrafanaError::parse(format!("list_library_panels parse: {e}")))
    }

    pub async fn get_library_panel(client: &GrafanaClient, uid: &str) -> GrafanaResult<LibraryPanel> {
        let body = client.api_get(&format!("/api/library-elements/{uid}")).await?;
        let wrapper: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| GrafanaError::parse(format!("get_library_panel: {e}")))?;
        let result = wrapper.get("result").cloned().unwrap_or(wrapper.clone());
        serde_json::from_value(result).map_err(|e| GrafanaError::parse(format!("get_library_panel parse: {e}")))
    }

    pub async fn create_library_panel(client: &GrafanaClient, req: &CreateLibraryPanelRequest) -> GrafanaResult<LibraryPanel> {
        let mut payload_val = serde_json::to_value(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        payload_val["kind"] = serde_json::Value::Number(1.into());
        let payload = serde_json::to_string(&payload_val).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/library-elements", &payload).await?;
        let wrapper: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| GrafanaError::parse(format!("create_library_panel: {e}")))?;
        let result = wrapper.get("result").cloned().unwrap_or(wrapper.clone());
        serde_json::from_value(result).map_err(|e| GrafanaError::parse(format!("create_library_panel parse: {e}")))
    }

    pub async fn update_library_panel(client: &GrafanaClient, uid: &str, req: &UpdateLibraryPanelRequest) -> GrafanaResult<LibraryPanel> {
        let mut payload_val = serde_json::to_value(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        payload_val["kind"] = serde_json::Value::Number(1.into());
        let payload = serde_json::to_string(&payload_val).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_patch(&format!("/api/library-elements/{uid}"), &payload).await?;
        let wrapper: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| GrafanaError::parse(format!("update_library_panel: {e}")))?;
        let result = wrapper.get("result").cloned().unwrap_or(wrapper.clone());
        serde_json::from_value(result).map_err(|e| GrafanaError::parse(format!("update_library_panel parse: {e}")))
    }

    pub async fn delete_library_panel(client: &GrafanaClient, uid: &str) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/library-elements/{uid}")).await?;
        Ok(())
    }

    pub async fn list_library_panel_connections(client: &GrafanaClient, uid: &str) -> GrafanaResult<Vec<LibraryPanelConnection>> {
        let body = client.api_get(&format!("/api/library-elements/{uid}/connections")).await?;
        let wrapper: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| GrafanaError::parse(format!("list_library_panel_connections: {e}")))?;
        let result = wrapper.get("result").cloned().unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(result).map_err(|e| GrafanaError::parse(format!("list_library_panel_connections parse: {e}")))
    }

    pub async fn get_panel_query_options(client: &GrafanaClient, panel_type: &str) -> GrafanaResult<PanelQueryOptions> {
        let body = client.api_get(&format!("/api/plugins/{panel_type}/settings")).await?;
        let val: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| GrafanaError::parse(format!("get_panel_query_options: {e}")))?;
        Ok(PanelQueryOptions {
            max_data_points: val.get("queryOptions").and_then(|q| q.get("maxDataPoints")).and_then(|v| v.as_i64()),
            interval: val.get("queryOptions").and_then(|q| q.get("minInterval")).and_then(|v| v.as_str()).map(String::from),
        })
    }
}
