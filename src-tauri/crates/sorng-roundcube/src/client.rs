// ── sorng-roundcube – REST API client ─────────────────────────────────────────
//! HTTP client wrapping the Roundcube admin/JSON API.

use crate::error::{RoundcubeError, RoundcubeErrorKind, RoundcubeResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

pub struct RoundcubeClient {
    pub config: RoundcubeConnectionConfig,
    http: HttpClient,
    token: tokio::sync::RwLock<Option<String>>,
}

impl RoundcubeClient {
    pub fn new(config: RoundcubeConnectionConfig) -> RoundcubeResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(config.tls_skip_verify.unwrap_or(false))
            .build()
            .map_err(|e| RoundcubeError::connection(format!("http client build: {e}")))?;
        Ok(Self {
            config,
            http,
            token: tokio::sync::RwLock::new(None),
        })
    }

    // ── Authentication ───────────────────────────────────────────────

    /// POST /api/login – authenticate and store session token.
    pub async fn login(&self) -> RoundcubeResult<()> {
        let url = self.url("/login");
        debug!("ROUNDCUBE POST {url} (login)");
        let body = serde_json::json!({
            "user": self.config.username,
            "password": self.config.password,
        });
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| RoundcubeError::connection(format!("POST {url}: {e}")))?;
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| RoundcubeError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        let raw: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| RoundcubeError::parse(format!("json: {e}")))?;
        let session_token = raw
            .get("token")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_default();
        let mut guard = self.token.write().await;
        *guard = Some(session_token);
        Ok(())
    }

    // ── URL helpers ──────────────────────────────────────────────────

    fn base_url(&self) -> &str {
        self.config.base_url.trim_end_matches('/')
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url(), path)
    }

    // ── Auth ─────────────────────────────────────────────────────────

    async fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let guard = self.token.read().await;
        if let Some(ref t) = *guard {
            req.header("Authorization", format!("Bearer {t}"))
        } else {
            req
        }
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> RoundcubeResult<T> {
        let url = self.url(path);
        debug!("ROUNDCUBE GET {url}");
        let req = self.http.get(&url);
        let resp = self
            .apply_auth(req)
            .await
            .send()
            .await
            .map_err(|e| RoundcubeError::connection(format!("GET {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn get_raw(&self, path: &str) -> RoundcubeResult<String> {
        let url = self.url(path);
        debug!("ROUNDCUBE GET (raw) {url}");
        let req = self.http.get(&url);
        let resp = self
            .apply_auth(req)
            .await
            .send()
            .await
            .map_err(|e| RoundcubeError::connection(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.text()
            .await
            .map_err(|e| RoundcubeError::parse(format!("body: {e}")))
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> RoundcubeResult<T> {
        let url = self.url(path);
        debug!("ROUNDCUBE POST {url}");
        let req = self.http.post(&url).json(body);
        let resp = self
            .apply_auth(req)
            .await
            .send()
            .await
            .map_err(|e| RoundcubeError::connection(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn post_no_body(&self, path: &str) -> RoundcubeResult<()> {
        let url = self.url(path);
        debug!("ROUNDCUBE POST (no body) {url}");
        let req = self.http.post(&url);
        let resp = self
            .apply_auth(req)
            .await
            .send()
            .await
            .map_err(|e| RoundcubeError::connection(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn put<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> RoundcubeResult<T> {
        let url = self.url(path);
        debug!("ROUNDCUBE PUT {url}");
        let req = self.http.put(&url).json(body);
        let resp = self
            .apply_auth(req)
            .await
            .send()
            .await
            .map_err(|e| RoundcubeError::connection(format!("PUT {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn put_no_response<B: Serialize>(&self, path: &str, body: &B) -> RoundcubeResult<()> {
        let url = self.url(path);
        debug!("ROUNDCUBE PUT (no response) {url}");
        let req = self.http.put(&url).json(body);
        let resp = self
            .apply_auth(req)
            .await
            .send()
            .await
            .map_err(|e| RoundcubeError::connection(format!("PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> RoundcubeResult<()> {
        let url = self.url(path);
        debug!("ROUNDCUBE DELETE {url}");
        let req = self.http.delete(&url);
        let resp = self
            .apply_auth(req)
            .await
            .send()
            .await
            .map_err(|e| RoundcubeError::connection(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    // ── Roundcube-specific endpoints ─────────────────────────────────

    /// GET /api/system/info — verify connectivity and gather summary.
    pub async fn ping(&self) -> RoundcubeResult<RoundcubeConnectionSummary> {
        let url = self.url("/system/info");
        debug!("ROUNDCUBE GET /system/info (ping)");
        let req = self.http.get(&url);
        let resp = self
            .apply_auth(req)
            .await
            .send()
            .await
            .map_err(|e| RoundcubeError::connection(format!("GET /system/info: {e}")))?;
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| RoundcubeError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        let raw: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| RoundcubeError::parse(format!("json: {e}")))?;
        Ok(RoundcubeConnectionSummary {
            host: self.config.base_url.clone(),
            version: raw
                .get("version")
                .and_then(|v| v.as_str())
                .map(String::from),
            skin: raw.get("skin").and_then(|v| v.as_str()).map(String::from),
            product_name: raw
                .get("product_name")
                .and_then(|v| v.as_str())
                .map(String::from),
            plugins_count: raw.get("plugins_count").and_then(|v| v.as_u64()),
        })
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> RoundcubeResult<T> {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| RoundcubeError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        serde_json::from_str(&body_text)
            .map_err(|e| RoundcubeError::parse(format!("json: {e}\nBody: {body_text}")))
    }

    fn map_status_error(&self, status: u16, body: &str) -> RoundcubeError {
        let kind = match status {
            401 => RoundcubeErrorKind::AuthenticationFailed,
            403 => RoundcubeErrorKind::Forbidden,
            404 => RoundcubeErrorKind::NotFound,
            408 => RoundcubeErrorKind::Timeout,
            500 => RoundcubeErrorKind::InternalError,
            _ => RoundcubeErrorKind::ApiError,
        };
        RoundcubeError {
            kind,
            message: format!("HTTP {status}: {body}"),
        }
    }
}
