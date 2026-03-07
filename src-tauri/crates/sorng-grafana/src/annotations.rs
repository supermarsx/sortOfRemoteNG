// ── Grafana annotation management ────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct AnnotationManager;

impl AnnotationManager {
    pub async fn list_annotations(client: &GrafanaClient, query: &AnnotationQuery) -> GrafanaResult<Vec<Annotation>> {
        let mut params = Vec::new();
        if let Some(from) = query.from { params.push(format!("from={from}")); }
        if let Some(to) = query.to { params.push(format!("to={to}")); }
        if let Some(did) = query.dashboard_id { params.push(format!("dashboardId={did}")); }
        if let Some(ref duid) = query.dashboard_uid { params.push(format!("dashboardUID={duid}")); }
        if let Some(pid) = query.panel_id { params.push(format!("panelId={pid}")); }
        if let Some(aid) = query.alert_id { params.push(format!("alertId={aid}")); }
        if let Some(ref tags) = query.tags { for t in tags { params.push(format!("tags={t}")); } }
        if let Some(limit) = query.limit { params.push(format!("limit={limit}")); }
        if let Some(ref t) = query.annotation_type { params.push(format!("type={t}")); }
        let qs = if params.is_empty() { String::new() } else { format!("?{}", params.join("&")) };
        let body = client.api_get(&format!("/api/annotations{qs}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_annotations: {e}")))
    }

    pub async fn get_annotation(client: &GrafanaClient, id: i64) -> GrafanaResult<Annotation> {
        let body = client.api_get(&format!("/api/annotations/{id}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_annotation: {e}")))
    }

    pub async fn create_annotation(client: &GrafanaClient, req: &CreateAnnotationRequest) -> GrafanaResult<Annotation> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/annotations", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_annotation: {e}")))
    }

    pub async fn update_annotation(client: &GrafanaClient, id: i64, req: &UpdateAnnotationRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put(&format!("/api/annotations/{id}"), &payload).await?;
        Ok(())
    }

    pub async fn delete_annotation(client: &GrafanaClient, id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/annotations/{id}")).await?;
        Ok(())
    }

    pub async fn create_graphite_annotation(client: &GrafanaClient, req: &CreateGraphiteAnnotationRequest) -> GrafanaResult<Annotation> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/annotations/graphite", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_graphite_annotation: {e}")))
    }

    pub async fn find_annotations_by_tag(client: &GrafanaClient, tags: &[String]) -> GrafanaResult<Vec<Annotation>> {
        let tag_params: Vec<String> = tags.iter().map(|t| format!("tags={t}")).collect();
        let qs = tag_params.join("&");
        let body = client.api_get(&format!("/api/annotations?{qs}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("find_annotations_by_tag: {e}")))
    }

    pub async fn find_annotations_by_dashboard(client: &GrafanaClient, dashboard_id: i64) -> GrafanaResult<Vec<Annotation>> {
        let body = client.api_get(&format!("/api/annotations?dashboardId={dashboard_id}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("find_annotations_by_dashboard: {e}")))
    }

    pub async fn mass_delete_annotations(client: &GrafanaClient, req: &MassDeleteAnnotationsRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post("/api/annotations/mass-delete", &payload).await?;
        Ok(())
    }
}
