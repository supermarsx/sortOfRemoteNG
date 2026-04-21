// ── sorng-prometheus/src/silences.rs ─────────────────────────────────────────
//! Alertmanager silence management via Alertmanager API v2.

use crate::client::PrometheusClient;
use crate::error::PrometheusResult;
use crate::types::*;

pub struct SilenceManager;

impl SilenceManager {
    /// List silences, optionally filtered by a label matcher expression.
    /// Endpoint: GET /api/v2/silences
    pub async fn list(
        client: &PrometheusClient,
        filter: Option<&str>,
    ) -> PrometheusResult<Vec<Silence>> {
        let url = client.alertmanager_url("silences");
        let url_with_filter = if let Some(f) = filter {
            format!("{url}?filter={}", urlencoded(f))
        } else {
            url
        };
        client.get_url_json(&url_with_filter).await
    }

    /// Get a specific silence by id.
    /// Endpoint: GET /api/v2/silence/{id}
    pub async fn get(client: &PrometheusClient, id: &str) -> PrometheusResult<Silence> {
        let url = client.alertmanager_url(&format!("silence/{id}"));
        client.get_url_json(&url).await
    }

    /// Create a new silence.
    /// Endpoint: POST /api/v2/silences
    pub async fn create(
        client: &PrometheusClient,
        matchers: Vec<SilenceMatcher>,
        starts_at: &str,
        ends_at: &str,
        created_by: &str,
        comment: &str,
    ) -> PrometheusResult<String> {
        let url = client.alertmanager_url("silences");
        let body = serde_json::json!({
            "matchers": matchers,
            "startsAt": starts_at,
            "endsAt": ends_at,
            "createdBy": created_by,
            "comment": comment,
        });
        let resp: serde_json::Value = client.post_url_json(&url, &body).await?;
        let id = resp
            .get("silenceID")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(id)
    }

    /// Update an existing silence (replaces with new version keeping same id).
    /// Endpoint: POST /api/v2/silences
    pub async fn update(
        client: &PrometheusClient,
        id: &str,
        matchers: Vec<SilenceMatcher>,
        starts_at: &str,
        ends_at: &str,
        created_by: &str,
        comment: &str,
    ) -> PrometheusResult<String> {
        let url = client.alertmanager_url("silences");
        let body = serde_json::json!({
            "id": id,
            "matchers": matchers,
            "startsAt": starts_at,
            "endsAt": ends_at,
            "createdBy": created_by,
            "comment": comment,
        });
        let resp: serde_json::Value = client.post_url_json(&url, &body).await?;
        let new_id = resp
            .get("silenceID")
            .and_then(|v| v.as_str())
            .unwrap_or(id)
            .to_string();
        Ok(new_id)
    }

    /// Expire (deactivate) a silence.
    /// Endpoint: DELETE /api/v2/silence/{id}
    pub async fn expire(client: &PrometheusClient, id: &str) -> PrometheusResult<()> {
        let url = client.alertmanager_url(&format!("silence/{id}"));
        client.delete_url(&url).await
    }

    /// Delete a silence (alias for expire in Alertmanager v2).
    pub async fn delete(client: &PrometheusClient, id: &str) -> PrometheusResult<()> {
        Self::expire(client, id).await
    }
}

/// Minimal percent-encoding for filter query param.
fn urlencoded(s: &str) -> String {
    s.replace('%', "%25")
        .replace(' ', "%20")
        .replace('{', "%7B")
        .replace('}', "%7D")
        .replace('"', "%22")
        .replace('=', "%3D")
}
