// ── sorng-traefik – REST API client ──────────────────────────────────────────
//! HTTP client wrapping the Traefik REST API (v2).
//! Endpoint: http://host:8080/api/

use crate::error::{TraefikError, TraefikErrorKind, TraefikResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

pub struct TraefikClient {
    pub config: TraefikConnectionConfig,
    http: HttpClient,
}

impl TraefikClient {
    pub fn new(config: TraefikConnectionConfig) -> TraefikResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(config.tls_skip_verify.unwrap_or(false))
            .build()
            .map_err(|e| TraefikError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL helpers ──────────────────────────────────────────────────

    fn base_url(&self) -> &str {
        self.config.api_url.trim_end_matches('/')
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url(), path)
    }

    // ── Auth ─────────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref key) = self.config.api_key {
            req.header("Authorization", format!("Bearer {key}"))
        } else if let (Some(ref user), Some(ref pass)) = (&self.config.username, &self.config.password) {
            req.basic_auth(user, Some(pass))
        } else {
            req
        }
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> TraefikResult<T> {
        let url = self.api_url(path);
        debug!("TRAEFIK GET {url}");
        let resp = self.apply_auth(self.http.get(&url))
            .send().await
            .map_err(|e| TraefikError::connection(format!("GET {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn get_raw(&self, path: &str) -> TraefikResult<String> {
        let url = self.api_url(path);
        debug!("TRAEFIK GET (raw) {url}");
        let resp = self.apply_auth(self.http.get(&url))
            .send().await
            .map_err(|e| TraefikError::connection(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.text().await.map_err(|e| TraefikError::parse(format!("body: {e}")))
    }

    pub async fn put<B: Serialize>(&self, path: &str, body: &B) -> TraefikResult<()> {
        let url = self.api_url(path);
        debug!("TRAEFIK PUT {url}");
        let resp = self.apply_auth(self.http.put(&url).json(body))
            .send().await
            .map_err(|e| TraefikError::connection(format!("PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> TraefikResult<()> {
        let url = self.api_url(path);
        debug!("TRAEFIK DELETE {url}");
        let resp = self.apply_auth(self.http.delete(&url))
            .send().await
            .map_err(|e| TraefikError::connection(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    // ── Ping / version ───────────────────────────────────────────────

    pub async fn ping(&self) -> TraefikResult<TraefikConnectionSummary> {
        let version: TraefikVersion = self.get("/version").await?;
        Ok(TraefikConnectionSummary {
            api_url: self.config.api_url.clone(),
            version: Some(version.version),
            codename: version.codename,
        })
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(&self, resp: reqwest::Response) -> TraefikResult<T> {
        let status = resp.status();
        let body_text = resp.text().await
            .map_err(|e| TraefikError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        serde_json::from_str(&body_text)
            .map_err(|e| TraefikError::parse(format!("json: {e}\nBody: {body_text}")))
    }

    fn map_status_error(&self, status: u16, body: &str) -> TraefikError {
        let kind = match status {
            401 | 403 => TraefikErrorKind::AuthenticationFailed,
            404 => TraefikErrorKind::RouterNotFound,
            408 => TraefikErrorKind::Timeout,
            _ => TraefikErrorKind::HttpError,
        };
        TraefikError { kind, message: format!("HTTP {status}: {body}") }
    }
}
