// ── sorng-grafana/src/client.rs ──────────────────────────────────────────────
//! HTTP client for the Grafana REST API.

use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use std::time::Duration;

pub struct GrafanaClient {
    pub config: GrafanaConnectionConfig,
    http: HttpClient,
}

impl GrafanaClient {
    pub fn new(config: GrafanaConnectionConfig) -> GrafanaResult<Self> {
        let accept_invalid = config.accept_invalid_certs.unwrap_or(false);
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(accept_invalid)
            .build()
            .map_err(|e| GrafanaError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL builders ─────────────────────────────────────────────

    fn scheme(&self) -> &str {
        if self.config.use_tls.unwrap_or(true) { "https" } else { "http" }
    }

    fn base_url(&self) -> String {
        let port = self.config.port.unwrap_or(3000);
        format!("{}://{}:{}", self.scheme(), self.config.host, port)
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}/api/{}", self.base_url(), path)
    }

    // ── Auth headers ─────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref key) = self.config.api_key {
            req.header("Authorization", format!("Bearer {key}"))
        } else if let (Some(ref user), Some(ref pass)) =
            (&self.config.username, &self.config.password)
        {
            req.basic_auth(user, Some(pass))
        } else {
            req
        }
    }

    fn apply_org(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(org_id) = self.config.org_id {
            req.header("X-Grafana-Org-Id", org_id.to_string())
        } else {
            req
        }
    }

    fn prepare(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        self.apply_org(self.apply_auth(req))
    }

    // ── Status mapping ───────────────────────────────────────────

    fn map_status_error(&self, status: u16, body: &str) -> GrafanaError {
        match status {
            401 => GrafanaError::auth(format!("Authentication failed (HTTP 401): {body}")),
            403 => GrafanaError::permission_denied(format!("Access denied (HTTP 403): {body}")),
            404 => GrafanaError::api(format!("Not found (HTTP 404): {body}")),
            409 => GrafanaError::conflict(format!("Conflict (HTTP 409): {body}")),
            412 => GrafanaError::conflict(format!("Precondition failed (HTTP 412): {body}")),
            _ => GrafanaError::http(format!("HTTP {status}: {body}")),
        }
    }

    // ── Generic request helpers ──────────────────────────────────

    pub async fn api_get<T: DeserializeOwned>(&self, path: &str) -> GrafanaResult<T> {
        let url = self.api_url(path);
        debug!("GRAFANA GET {url}");
        let resp = self.prepare(self.http.get(&url))
            .send()
            .await
            .map_err(|e| GrafanaError::http(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| GrafanaError::parse(format!("GET {url} parse: {e}")))
    }

    pub async fn api_get_raw(&self, path: &str) -> GrafanaResult<serde_json::Value> {
        self.api_get(path).await
    }

    pub async fn api_post<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> GrafanaResult<T> {
        let url = self.api_url(path);
        debug!("GRAFANA POST {url}");
        let resp = self.prepare(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| GrafanaError::http(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| GrafanaError::parse(format!("POST {url} parse: {e}")))
    }

    pub async fn api_put<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> GrafanaResult<T> {
        let url = self.api_url(path);
        debug!("GRAFANA PUT {url}");
        let resp = self.prepare(self.http.put(&url).json(body))
            .send()
            .await
            .map_err(|e| GrafanaError::http(format!("PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| GrafanaError::parse(format!("PUT {url} parse: {e}")))
    }

    pub async fn api_patch<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> GrafanaResult<T> {
        let url = self.api_url(path);
        debug!("GRAFANA PATCH {url}");
        let resp = self.prepare(self.http.patch(&url).json(body))
            .send()
            .await
            .map_err(|e| GrafanaError::http(format!("PATCH {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| GrafanaError::parse(format!("PATCH {url} parse: {e}")))
    }

    pub async fn api_delete(&self, path: &str) -> GrafanaResult<serde_json::Value> {
        let url = self.api_url(path);
        debug!("GRAFANA DELETE {url}");
        let resp = self.prepare(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| GrafanaError::http(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| GrafanaError::parse(format!("DELETE {url} parse: {e}")))
    }

    // ── Convenience ──────────────────────────────────────────────

    pub async fn health(&self) -> GrafanaResult<HealthResponse> {
        self.api_get("health").await
    }

    pub async fn ping(&self) -> GrafanaResult<GrafanaConnectionSummary> {
        let health: HealthResponse = self.health().await?;
        let org: serde_json::Value = self.api_get("org").await.unwrap_or_default();
        let search: Vec<serde_json::Value> = self.api_get("search?type=dash-db").await.unwrap_or_default();
        let users: Vec<serde_json::Value> = self.api_get("org/users").await.unwrap_or_default();
        Ok(GrafanaConnectionSummary {
            host: self.config.host.clone(),
            version: health.version.unwrap_or_else(|| "unknown".into()),
            org_name: org.get("name").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            user_count: users.len() as u64,
            dashboard_count: search.len() as u64,
        })
    }
}
