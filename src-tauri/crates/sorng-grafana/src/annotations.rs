// ── sorng-grafana/src/annotations.rs ─────────────────────────────────────────
//! Annotation management via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct AnnotationManager;

impl AnnotationManager {
    /// List annotations.  GET /api/annotations
    pub async fn list(
        client: &GrafanaClient,
        from: Option<u64>,
        to: Option<u64>,
        dashboard_id: Option<u64>,
        panel_id: Option<u64>,
        tags: Option<&[String]>,
        limit: Option<u64>,
    ) -> GrafanaResult<Vec<Annotation>> {
        let mut params = Vec::new();
        if let Some(f) = from {
            params.push(format!("from={f}"));
        }
        if let Some(t) = to {
            params.push(format!("to={t}"));
        }
        if let Some(d) = dashboard_id {
            params.push(format!("dashboardId={d}"));
        }
        if let Some(p) = panel_id {
            params.push(format!("panelId={p}"));
        }
        if let Some(tag_list) = tags {
            for tag in tag_list {
                params.push(format!("tags={tag}"));
            }
        }
        if let Some(l) = limit {
            params.push(format!("limit={l}"));
        }
        let qs = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        client.api_get(&format!("annotations{qs}")).await
    }

    /// Get annotation by ID.  GET /api/annotations/:id
    pub async fn get(client: &GrafanaClient, id: u64) -> GrafanaResult<Annotation> {
        client.api_get(&format!("annotations/{id}")).await
    }

    /// Create an annotation.  POST /api/annotations
    pub async fn create(
        client: &GrafanaClient,
        request: &CreateAnnotationRequest,
    ) -> GrafanaResult<Annotation> {
        client.api_post("annotations", request).await
    }

    /// Update an annotation (full replace).  PUT /api/annotations/:id
    pub async fn update(
        client: &GrafanaClient,
        id: u64,
        text: &str,
        tags: Option<&[String]>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({ "text": text });
        if let Some(t) = tags {
            body["tags"] = serde_json::json!(t);
        }
        client.api_put(&format!("annotations/{id}"), &body).await
    }

    /// Partially update an annotation.  PATCH /api/annotations/:id
    pub async fn patch(
        client: &GrafanaClient,
        id: u64,
        text: Option<&str>,
        tags: Option<&[String]>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({});
        if let Some(t) = text {
            body["text"] = serde_json::json!(t);
        }
        if let Some(t) = tags {
            body["tags"] = serde_json::json!(t);
        }
        client.api_patch(&format!("annotations/{id}"), &body).await
    }

    /// Delete an annotation.  DELETE /api/annotations/:id
    pub async fn delete(client: &GrafanaClient, id: u64) -> GrafanaResult<serde_json::Value> {
        client.api_delete(&format!("annotations/{id}")).await
    }

    /// Create a Graphite-style event annotation.  POST /api/annotations/graphite
    pub async fn create_graphite(
        client: &GrafanaClient,
        what: &str,
        tags: Option<&[String]>,
        when: Option<u64>,
        data: Option<&str>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({ "what": what });
        if let Some(t) = tags {
            body["tags"] = serde_json::json!(t);
        }
        if let Some(w) = when {
            body["when"] = serde_json::json!(w);
        }
        if let Some(d) = data {
            body["data"] = serde_json::json!(d);
        }
        client.api_post("annotations/graphite", &body).await
    }
}
