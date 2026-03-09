// ── sorng-consul – REST API client ───────────────────────────────────────────
//! HTTP client wrapping the Consul HTTP API (default: http://localhost:8500).

use crate::error::{ConsulError, ConsulErrorKind, ConsulResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

pub struct ConsulClient {
    pub config: ConsulConnectionConfig,
    http: HttpClient,
}

impl ConsulClient {
    pub fn new(config: ConsulConnectionConfig) -> ConsulResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(config.tls_skip_verify.unwrap_or(false))
            .build()
            .map_err(|e| ConsulError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL helpers ──────────────────────────────────────────────────

    fn base_url(&self) -> &str {
        self.config.address.trim_end_matches('/')
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url(), path)
    }

    fn url_with_params(&self, path: &str, params: &[(&str, &str)]) -> String {
        let base = self.url(path);
        let mut parts: Vec<String> = Vec::new();
        if let Some(ref dc) = self.config.datacenter {
            parts.push(format!("dc={}", urlencoding(dc)));
        }
        if let Some(ref ns) = self.config.namespace {
            parts.push(format!("ns={}", urlencoding(ns)));
        }
        if let Some(ref partition) = self.config.partition {
            parts.push(format!("partition={}", urlencoding(partition)));
        }
        for (k, v) in params {
            parts.push(format!("{}={}", k, urlencoding(v)));
        }
        if parts.is_empty() {
            base
        } else {
            format!("{}?{}", base, parts.join("&"))
        }
    }

    // ── Auth ─────────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref token) = self.config.token {
            req.header("X-Consul-Token", token.as_str())
        } else {
            req
        }
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> ConsulResult<T> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL GET {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("GET {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> ConsulResult<T> {
        let url = self.url_with_params(path, params);
        debug!("CONSUL GET {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("GET {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn get_optional<T: DeserializeOwned>(&self, path: &str) -> ConsulResult<Option<T>> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL GET (optional) {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("GET {url}: {e}")))?;
        if resp.status().as_u16() == 404 {
            return Ok(None);
        }
        let val: T = self.handle_response(resp).await?;
        Ok(Some(val))
    }

    pub async fn get_raw(&self, path: &str) -> ConsulResult<String> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL GET (raw) {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.text()
            .await
            .map_err(|e| ConsulError::parse(format!("body: {e}")))
    }

    pub async fn put_body<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> ConsulResult<T> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL PUT {url}");
        let resp = self
            .apply_auth(self.http.put(&url).json(body))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("PUT {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn put_raw(&self, path: &str, body: &str) -> ConsulResult<bool> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL PUT (raw) {url}");
        let resp = self
            .apply_auth(
                self.http
                    .put(&url)
                    .header("Content-Type", "application/octet-stream")
                    .body(body.to_string()),
            )
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        let text = resp.text().await.unwrap_or_default();
        Ok(text.trim() == "true")
    }

    pub async fn put_raw_with_params(
        &self,
        path: &str,
        body: &str,
        params: &[(&str, &str)],
    ) -> ConsulResult<bool> {
        let url = self.url_with_params(path, params);
        debug!("CONSUL PUT (raw+params) {url}");
        let resp = self
            .apply_auth(
                self.http
                    .put(&url)
                    .header("Content-Type", "application/octet-stream")
                    .body(body.to_string()),
            )
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        let text = resp.text().await.unwrap_or_default();
        Ok(text.trim() == "true")
    }

    pub async fn put_no_body(&self, path: &str) -> ConsulResult<()> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL PUT (no body) {url}");
        let resp = self
            .apply_auth(self.http.put(&url))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn put_json_no_response<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> ConsulResult<()> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL PUT (json, no resp) {url}");
        let resp = self
            .apply_auth(self.http.put(&url).json(body))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> ConsulResult<T> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL POST {url}");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn post_no_body<T: DeserializeOwned>(&self, path: &str) -> ConsulResult<T> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL POST (no body) {url}");
        let resp = self
            .apply_auth(self.http.post(&url))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn post_with_params<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
        params: &[(&str, &str)],
    ) -> ConsulResult<T> {
        let url = self.url_with_params(path, params);
        debug!("CONSUL POST {url}");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn delete(&self, path: &str) -> ConsulResult<()> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn delete_bool(&self, path: &str) -> ConsulResult<bool> {
        let url = self.url_with_params(path, &[]);
        debug!("CONSUL DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| ConsulError::connection(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        let text = resp.text().await.unwrap_or_default();
        Ok(text.trim() == "true")
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> ConsulResult<T> {
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        let text = resp
            .text()
            .await
            .map_err(|e| ConsulError::parse(format!("reading body: {e}")))?;
        serde_json::from_str(&text).map_err(|e| {
            ConsulError::parse(format!("JSON parse: {e} — body: {}", truncate(&text, 200)))
        })
    }

    fn map_status_error(&self, status: u16, body: &str) -> ConsulError {
        match status {
            401 => ConsulError::auth(format!("Unauthorized (401): {}", truncate(body, 200))),
            403 => ConsulError::forbidden(format!("Forbidden (403): {}", truncate(body, 200))),
            404 => ConsulError::not_found(format!("Not found (404): {}", truncate(body, 200))),
            409 => ConsulError::new(
                ConsulErrorKind::ApiError,
                format!("Conflict (409): {}", truncate(body, 200)),
            ),
            500 => ConsulError::new(
                ConsulErrorKind::InternalError,
                format!("Server error (500): {}", truncate(body, 200)),
            ),
            _ => ConsulError::api(format!("HTTP {status}: {}", truncate(body, 200))),
        }
    }

    // ── Consul-specific endpoints ────────────────────────────────────

    /// GET /v1/agent/self — used to verify the connection.
    pub async fn ping(&self) -> ConsulResult<ConsulConnectionSummary> {
        let info: ConsulAgentInfo = self.get("/v1/agent/self").await?;
        let members: Vec<AgentMember> = self.get("/v1/agent/members").await?;
        let leader: String = self.get("/v1/status/leader").await?;

        let node_name = info
            .member
            .as_ref()
            .map(|m| m.name.clone())
            .unwrap_or_else(|| "unknown".into());
        let dc = info
            .config
            .as_ref()
            .and_then(|c| c.get("Datacenter"))
            .and_then(|v| v.as_str())
            .unwrap_or("dc1")
            .to_string();
        let version = info
            .config
            .as_ref()
            .and_then(|c| c.get("Version"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        Ok(ConsulConnectionSummary {
            address: self.config.address.clone(),
            datacenter: dc,
            node_name,
            version,
            leader,
            member_count: members.len(),
        })
    }

    /// GET /v1/catalog/services — list all services (name → tags).
    pub async fn catalog_services(&self) -> ConsulResult<HashMap<String, Vec<String>>> {
        self.get("/v1/catalog/services").await
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        &s[..max]
    }
}

fn urlencoding(s: &str) -> String {
    s.replace('%', "%25")
        .replace(' ', "%20")
        .replace('&', "%26")
        .replace('=', "%3D")
        .replace('+', "%2B")
        .replace('#', "%23")
}
