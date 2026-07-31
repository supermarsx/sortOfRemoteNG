// ── sorng-caddy – REST API client ────────────────────────────────────────────
//! HTTP client wrapping the Caddy admin API (default: http://localhost:2019).

use crate::error::{CaddyError, CaddyErrorKind, CaddyResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;

pub struct CaddyClient {
    pub config: CaddyConnectionConfig,
    http: HttpClient,
}

impl CaddyClient {
    pub fn new(config: CaddyConnectionConfig) -> CaddyResult<Self> {
        if config.tls_skip_verify.unwrap_or(false) {
            return Err(CaddyError::connection(
                "TLS certificate verification cannot be disabled: tls_skip_verify=true requires an explicit runtime acknowledgement contract",
            ));
        }
        let mut builder = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .redirect(reqwest::redirect::Policy::none());
        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|_| CaddyError::connection("invalid proxy URL"))?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|_| CaddyError::connection("failed to build HTTP client"))?;
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
        debug!("CADDY GET");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error("GET request", &e))?;
        self.handle_response(resp).await
    }

    pub async fn get_raw(&self, path: &str) -> CaddyResult<String> {
        let url = self.url(path);
        debug!("CADDY GET (raw)");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error("GET request", &e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        let body = Self::read_bounded_body(resp).await?;
        Ok(String::from_utf8_lossy(&body).into_owned())
    }

    pub async fn get_optional<T: DeserializeOwned>(&self, path: &str) -> CaddyResult<Option<T>> {
        let url = self.url(path);
        debug!("CADDY GET (optional)");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error("GET request", &e))?;
        if resp.status().as_u16() == 404 {
            return Ok(None);
        }
        let val: T = self.handle_response(resp).await?;
        Ok(Some(val))
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> CaddyResult<T> {
        let url = self.url(path);
        debug!("CADDY POST");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| Self::transport_error("POST request", &e))?;
        self.handle_response(resp).await
    }

    pub async fn post_no_body(&self, path: &str) -> CaddyResult<()> {
        let url = self.url(path);
        debug!("CADDY POST (no body)");
        let resp = self
            .apply_auth(self.http.post(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error("POST request", &e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Ok(())
    }

    pub async fn put<B: Serialize>(&self, path: &str, body: &B) -> CaddyResult<()> {
        let url = self.url(path);
        debug!("CADDY PUT");
        let resp = self
            .apply_auth(
                self.http
                    .put(&url)
                    .header("Content-Type", "application/json")
                    .json(body),
            )
            .send()
            .await
            .map_err(|e| Self::transport_error("PUT request", &e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Ok(())
    }

    pub async fn patch<B: Serialize>(&self, path: &str, body: &B) -> CaddyResult<()> {
        let url = self.url(path);
        debug!("CADDY PATCH");
        let resp = self
            .apply_auth(self.http.patch(&url).json(body))
            .send()
            .await
            .map_err(|e| Self::transport_error("PATCH request", &e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> CaddyResult<()> {
        let url = self.url(path);
        debug!("CADDY DELETE");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error("DELETE request", &e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
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
        debug!("CADDY POST load");
        let resp = self
            .apply_auth(
                self.http
                    .post(&url)
                    .header("Content-Type", "application/json")
                    .json(config),
            )
            .send()
            .await
            .map_err(|e| Self::transport_error("load request", &e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Ok(())
    }

    /// POST /adapt — adapt a Caddyfile to JSON
    pub async fn adapt_caddyfile(&self, caddyfile: &str) -> CaddyResult<CaddyfileAdaptResult> {
        let url = self.url("/adapt");
        debug!("CADDY POST adapt");
        let resp = self
            .apply_auth(
                self.http
                    .post(&url)
                    .header("Content-Type", "text/caddyfile")
                    .body(caddyfile.to_string()),
            )
            .send()
            .await
            .map_err(|e| Self::transport_error("adapt request", &e))?;
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
            version: config.admin.and(None), // version not in config, need /config/admin
        })
    }

    // ── Response handling ────────────────────────────────────────────

    fn transport_error(operation: &str, error: &reqwest::Error) -> CaddyError {
        let reason = if error.is_timeout() {
            "timed out"
        } else if error.is_connect() {
            "connection failed"
        } else {
            "transport failed"
        };
        CaddyError::connection(format!("{operation}: {reason}"))
    }

    async fn read_bounded_body(mut resp: reqwest::Response) -> CaddyResult<Vec<u8>> {
        if resp
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
        {
            return Err(CaddyError::parse(format!(
                "response body exceeds {MAX_RESPONSE_BODY_BYTES} byte limit"
            )));
        }

        let capacity = resp
            .content_length()
            .unwrap_or(0)
            .min(MAX_RESPONSE_BODY_BYTES as u64) as usize;
        let mut body = Vec::with_capacity(capacity);
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| Self::transport_error("response body", &e))?
        {
            let remaining = (MAX_RESPONSE_BODY_BYTES + 1).saturating_sub(body.len());
            body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            if body.len() > MAX_RESPONSE_BODY_BYTES {
                return Err(CaddyError::parse(format!(
                    "response body exceeds {MAX_RESPONSE_BODY_BYTES} byte limit"
                )));
            }
        }
        Ok(body)
    }

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> CaddyResult<T> {
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        let body = Self::read_bounded_body(resp).await?;
        serde_json::from_slice(&body).map_err(|e| {
            CaddyError::parse(format!(
                "invalid JSON response at line {}, column {}",
                e.line(),
                e.column()
            ))
        })
    }

    fn map_status_error(&self, status: u16) -> CaddyError {
        let kind = match status {
            401 | 403 => CaddyErrorKind::AuthenticationFailed,
            404 => CaddyErrorKind::RouteNotFound,
            400 => CaddyErrorKind::ConfigValidationError,
            _ => CaddyErrorKind::HttpError,
        };
        CaddyError {
            kind,
            message: format!("HTTP {status}"),
        }
    }
}
