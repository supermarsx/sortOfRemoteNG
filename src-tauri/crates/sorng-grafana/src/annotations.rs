//! Annotation management for Grafana.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct AnnotationManager<'a> {
    client: &'a GrafanaClient,
}

impl<'a> AnnotationManager<'a> {
    pub fn new(client: &'a GrafanaClient) -> Self {
        Self { client }
    }

    /// List annotations with optional filters.
    pub async fn list(
        &self,
        from: Option<i64>,
        to: Option<i64>,
        dashboard_id: Option<i64>,
        panel_id: Option<i64>,
        tags: Option<Vec<String>>,
        limit: Option<i64>,
    ) -> GrafanaResult<Vec<GrafanaAnnotation>> {
        let mut params: Vec<(String, String)> = Vec::new();
        if let Some(f) = from {
            params.push(("from".into(), f.to_string()));
        }
        if let Some(t) = to {
            params.push(("to".into(), t.to_string()));
        }
        if let Some(d) = dashboard_id {
            params.push(("dashboardId".into(), d.to_string()));
        }
        if let Some(p) = panel_id {
            params.push(("panelId".into(), p.to_string()));
        }
        if let Some(ref tag_list) = tags {
            for t in tag_list {
                params.push(("tags".into(), t.clone()));
            }
        }
        if let Some(l) = limit {
            params.push(("limit".into(), l.to_string()));
        }

        if params.is_empty() {
            self.client.api_get("/annotations").await
        } else {
            self.client.api_get_with_query("/annotations", &params).await
        }
    }

    /// Create a new annotation.
    pub async fn create(&self, req: CreateAnnotationRequest) -> GrafanaResult<serde_json::Value> {
        self.client.api_post("/annotations", &req).await
    }

    /// Update an existing annotation.
    pub async fn update(&self, annotation_id: i64, req: UpdateAnnotationRequest) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_put(&format!("/annotations/{}", annotation_id), &req)
            .await
    }

    /// Delete an annotation by ID.
    pub async fn delete(&self, annotation_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/annotations/{}", annotation_id))
            .await
    }

    /// Get a single annotation by ID.
    pub async fn get_by_id(&self, annotation_id: i64) -> GrafanaResult<GrafanaAnnotation> {
        self.client
            .api_get(&format!("/annotations/{}", annotation_id))
            .await
    }

    /// Create a Graphite-style annotation.
    pub async fn create_graphite(
        &self,
        what: &str,
        tags: Vec<String>,
        when: Option<i64>,
        data: Option<&str>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({
            "what": what,
            "tags": tags
        });
        if let Some(w) = when {
            body["when"] = serde_json::json!(w);
        }
        if let Some(d) = data {
            body["data"] = serde_json::json!(d);
        }
        self.client
            .api_post("/annotations/graphite", &body)
            .await
    }

    /// List annotation tags.
    pub async fn list_tags(&self) -> GrafanaResult<serde_json::Value> {
        self.client.api_get("/annotations/tags").await
    }

    /// Delete annotation by ID (alias).
    pub async fn delete_by_id(&self, annotation_id: i64) -> GrafanaResult<serde_json::Value> {
        self.delete(annotation_id).await
    }

    /// Mass delete annotations matching criteria.
    pub async fn mass_delete(
        &self,
        dashboard_id: Option<i64>,
        panel_id: Option<i64>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({});
        if let Some(d) = dashboard_id {
            body["dashboardId"] = serde_json::json!(d);
        }
        if let Some(p) = panel_id {
            body["panelId"] = serde_json::json!(p);
        }
        self.client
            .api_post("/annotations/mass-delete", &body)
            .await
    }
}
