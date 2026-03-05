// ── sorng-caddy – REST API client ────────────────────────────────────────────
//! HTTP client wrapping the Caddy admin API (default: http://localhost:2019).

use crate::error::{CaddyError, CaddyErrorKind, CaddyResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

pub struct CaddyClient {
    pub config: CaddyConnectionConfig,
    http: HttpClient,
}

impl CaddyClient {
    pub fn new(config: CaddyConnectionConfig) -> CaddyResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(config.tls_skip_verify.unwrap_or(false))
            .build()
            .map_err(|e| CaddyError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL helpers ──────────────────────────────────────────────────

    fn base_url(&self) -> &str {
        self.config.admin_url.trim_end_matches('/')
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url(), path)
    }

    // ── Auth ─────────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref key) = self.config.api_key {
            req.header("Authorization", format!("Bearer {key}"))
        } else if let (Some(ref u), Some(ref p)) = (&self.config.username, &self.config.password) {
            req.basic_auth(u, Some(p))
        } else {
            req
        }
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> CaddyResult<T> {
        let url = self.url(path);
        debug!("CADDY GET {url}");
        let resp = self.apply_auth(self.http.get(&url))
            .send().await
            .map_err(|e| CaddyError::connection(format!("GET {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn get_raw(&self, path: &str) -> CaddyResult<String> {
        let url = self.url(path);
        debug!("CADDY GET (raw) {url}");
        let resp = self.apply_auth(self.http.get(&url))
            .send().await
            .map_err(|e| CaddyError::connection(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.text().await.map_err(|e| CaddyError::parse(format!("body: {e}")))
    }

    pub async fn get_optional<T: DeserializeOwned>(&self, path: &str) -> CaddyResult<Option<T>> {
        let url = self.url(path);
        debug!("CADDY GET (optional) {url}");
        let resp = self.apply_auth(self.http.get(&url))
            .send().await
            .map_err(|e| CaddyError::connection(format!("GET {url}: {e}")))?;
        if resp.status().as_u16() == 404 {
            return Ok(None);
        }
        let val: T = self.handle_response(resp).await?;
        Ok(Some(val))
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> CaddyResult<T> {
        let url = self.url(path);
        debug!("CADDY POST {url}");
        let resp = self.apply_auth(self.http.post(&url).json(body))
            .send().await
            .map_err(|e| CaddyError::connection(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn post_no_body(&self, path: &str) -> CaddyResult<()> {
        let url = self.url(path);
        debug!("CADDY POST (no body) {url}");
        let resp = self.apply_auth(self.http.post(&url))
            .send().await
            .map_err(|e| CaddyError::connection(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn put<B: Serialize>(&self, path: &str, body: &B) -> CaddyResult<()> {
        let url = self.url(path);
        debug!("CADDY PUT {url}");
        let resp = self.apply_auth(self.http.put(&url)
            .header("Content-Type", "application/json")
            .json(body))
            .send().await
            .map_err(|e| CaddyError::connection(format!("PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn patch<B: Serialize>(&self, path: &str, body: &B) -> CaddyResult<()> {
        let url = self.url(path);
        debug!("CADDY PATCH {url}");
        let resp = self.apply_auth(self.http.patch(&url).json(body))
            .send().await
            .map_err(|e| CaddyError::connection(format!("PATCH {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> CaddyResult<()> {
        let url = self.url(path);
        debug!("CADDY DELETE {url}");
        let resp = self.apply_auth(self.http.delete(&url))
            .send().await
            .map_err(|e| CaddyError::connection(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    // ── Caddy-specific endpoints ─────────────────────────────────────

    /// GET /config/ — full running config
    pub async fn get_config(&self) -> CaddyResult<CaddyConfig> {
        self.get("/config/").await
    }

    /// POST /load — replace entire config (Caddyfile or JSON)
    pub async fn load_config(&self, config: &serde_json::Value) -> CaddyResult<()> {
        let url = self.url("/load");
        debug!("CADDY POST /load");
        let resp = self.apply_auth(self.http.post(&url)
            .header("Content-Type", "application/json")
            .json(config))
            .send().await
            .map_err(|e| CaddyError::connection(format!("POST /load: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    /// POST /adapt — adapt a Caddyfile to JSON
    pub async fn adapt_caddyfile(&self, caddyfile: &str) -> CaddyResult<CaddyfileAdaptResult> {
        let url = self.url("/adapt");
        debug!("CADDY POST /adapt");
        let resp = self.apply_auth(self.http.post(&url)
            .header("Content-Type", "text/caddyfile")
            .body(caddyfile.to_string()))
            .send().await
            .map_err(|e| CaddyError::connection(format!("POST /adapt: {e}")))?;
        self.handle_response(resp).await
    }

    /// POST /stop — stop the Caddy process gracefully
    pub async fn stop(&self) -> CaddyResult<()> {
        self.post_no_body("/stop").await
    }

    /// GET /reverse_proxy/upstreams — list upstream health
    pub async fn get_upstreams(&self) -> CaddyResult<Vec<serde_json::Value>> {
        self.get("/reverse_proxy/upstreams").await
    }

    /// Ping — verify connectivity
    pub async fn ping(&self) -> CaddyResult<CaddyConnectionSummary> {
        let config = self.get_config().await?;
        Ok(CaddyConnectionSummary {
            admin_url: self.config.admin_url.clone(),
            version: config.admin.and_then(|_a| None), // version not in config, need /config/admin
        })
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(&self, resp: reqwest::Response) -> CaddyResult<T> {
        let status = resp.status();
        let body_text = resp.text().await
            .map_err(|e| CaddyError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        serde_json::from_str(&body_text)
            .map_err(|e| CaddyError::parse(format!("json: {e}\nBody: {body_text}")))
    }

    fn map_status_error(&self, status: u16, body: &str) -> CaddyError {
        let kind = match status {
            401 | 403 => CaddyErrorKind::AuthenticationFailed,
            404 => CaddyErrorKind::RouteNotFound,
            400 => CaddyErrorKind::ConfigValidationError,
            _ => CaddyErrorKind::HttpError,
        };
        CaddyError { kind, message: format!("HTTP {status}: {body}") }
    }
}
