// ── sorng-rspamd – REST API client ───────────────────────────────────────────
//! HTTP client wrapping the Rspamd controller API (default: http://localhost:11334).

use crate::error::{RspamdError, RspamdErrorKind, RspamdResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

pub struct RspamdClient {
    pub config: RspamdConnectionConfig,
    http: HttpClient,
}

impl RspamdClient {
    pub fn new(config: RspamdConnectionConfig) -> RspamdResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(config.tls_skip_verify.unwrap_or(false))
            .build()
            .map_err(|e| RspamdError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL helpers ──────────────────────────────────────────────────

    fn base_url(&self) -> &str {
        self.config.base_url.trim_end_matches('/')
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url(), path)
    }

    // ── Auth ─────────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref pw) = self.config.password {
            req.header("Password", pw.as_str())
        } else {
            req
        }
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> RspamdResult<T> {
        let url = self.url(path);
        debug!("RSPAMD GET {url}");
        let resp = self.apply_auth(self.http.get(&url))
            .send().await
            .map_err(|e| RspamdError::connection(format!("GET {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn get_raw(&self, path: &str) -> RspamdResult<String> {
        let url = self.url(path);
        debug!("RSPAMD GET (raw) {url}");
        let resp = self.apply_auth(self.http.get(&url))
            .send().await
            .map_err(|e| RspamdError::connection(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.text().await.map_err(|e| RspamdError::parse(format!("body: {e}")))
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> RspamdResult<T> {
        let url = self.url(path);
        debug!("RSPAMD POST {url}");
        let resp = self.apply_auth(self.http.post(&url).json(body))
            .send().await
            .map_err(|e| RspamdError::connection(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn post_raw(&self, path: &str, body: &str) -> RspamdResult<String> {
        let url = self.url(path);
        debug!("RSPAMD POST (raw) {url}");
        let resp = self.apply_auth(self.http.post(&url)
            .header("Content-Type", "text/plain")
            .body(body.to_string()))
            .send().await
            .map_err(|e| RspamdError::connection(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.text().await.map_err(|e| RspamdError::parse(format!("body: {e}")))
    }

    pub async fn post_body<T: DeserializeOwned>(&self, path: &str, body: &str) -> RspamdResult<T> {
        let url = self.url(path);
        debug!("RSPAMD POST (body) {url}");
        let resp = self.apply_auth(self.http.post(&url)
            .header("Content-Type", "text/plain")
            .body(body.to_string()))
            .send().await
            .map_err(|e| RspamdError::connection(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn post_no_body(&self, path: &str) -> RspamdResult<()> {
        let url = self.url(path);
        debug!("RSPAMD POST (no body) {url}");
        let resp = self.apply_auth(self.http.post(&url))
            .send().await
            .map_err(|e| RspamdError::connection(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> RspamdResult<()> {
        let url = self.url(path);
        debug!("RSPAMD DELETE {url}");
        let resp = self.apply_auth(self.http.delete(&url))
            .send().await
            .map_err(|e| RspamdError::connection(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    // ── Rspamd-specific endpoints ────────────────────────────────────

    /// GET /ping — verify connectivity and gather summary
    pub async fn ping(&self) -> RspamdResult<RspamdConnectionSummary> {
        let url = self.url("/stat");
        debug!("RSPAMD GET /stat (ping)");
        let resp = self.apply_auth(self.http.get(&url))
            .send().await
            .map_err(|e| RspamdError::connection(format!("GET /stat: {e}")))?;
        let status = resp.status();
        let body_text = resp.text().await
            .map_err(|e| RspamdError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        let raw: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| RspamdError::parse(format!("json: {e}")))?;
        Ok(RspamdConnectionSummary {
            host: self.config.base_url.clone(),
            version: raw.get("version").and_then(|v| v.as_str()).map(String::from),
            config_id: raw.get("config_id").and_then(|v| v.as_str()).map(String::from),
            uptime_secs: raw.get("uptime").and_then(|v| v.as_u64()),
            scanned: raw.get("scanned").and_then(|v| v.as_u64()),
        })
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(&self, resp: reqwest::Response) -> RspamdResult<T> {
        let status = resp.status();
        let body_text = resp.text().await
            .map_err(|e| RspamdError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        serde_json::from_str(&body_text)
            .map_err(|e| RspamdError::parse(format!("json: {e}\nBody: {body_text}")))
    }

    fn map_status_error(&self, status: u16, body: &str) -> RspamdError {
        let kind = match status {
            401 => RspamdErrorKind::AuthenticationFailed,
            403 => RspamdErrorKind::Forbidden,
            404 => RspamdErrorKind::NotFound,
            500 => RspamdErrorKind::InternalError,
            408 => RspamdErrorKind::Timeout,
            _ => RspamdErrorKind::ApiError,
        };
        RspamdError { kind, message: format!("HTTP {status}: {body}") }
    }
}
