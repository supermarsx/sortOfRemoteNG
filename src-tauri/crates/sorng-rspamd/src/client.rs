// ── sorng-rspamd – REST API client ───────────────────────────────────────────
//! HTTP client wrapping the Rspamd controller API (default: http://localhost:11334).

use crate::error::{RspamdError, RspamdErrorKind, RspamdResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

const DEFAULT_TIMEOUT_SECS: u64 = 30;

pub struct RspamdClient {
    pub config: RspamdConnectionConfig,
    http: HttpClient,
}

impl RspamdClient {
    pub fn new(mut config: RspamdConnectionConfig) -> RspamdResult<Self> {
        if config.tls_skip_verify.unwrap_or(false) {
            return Err(RspamdError::connection(
                "TLS certificate verification cannot be disabled: tls_skip_verify=true requires an explicit runtime acknowledgement contract",
            ));
        }
        config.base_url = Self::validate_base_url(&config.base_url)?;
        let timeout_secs = config.timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS);
        if timeout_secs == 0 {
            return Err(RspamdError::connection(
                "request timeout must be greater than zero seconds",
            ));
        }

        let http = HttpClient::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .redirect(reqwest::redirect::Policy::none())
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
        if let Some(pw) = self
            .config
            .password
            .as_deref()
            .filter(|password| !password.is_empty())
        {
            req.header("Password", pw)
        } else {
            req
        }
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> RspamdResult<T> {
        let url = self.url(path);
        debug!("RSPAMD GET {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error(&format!("GET {url}"), e))?;
        self.handle_response(resp).await
    }

    pub async fn get_raw(&self, path: &str) -> RspamdResult<String> {
        self.get_raw_with_headers(path, &[]).await
    }

    pub async fn get_raw_with_headers(
        &self,
        path: &str,
        headers: &[(&'static str, String)],
    ) -> RspamdResult<String> {
        let url = self.url(path);
        debug!("RSPAMD GET (raw) {url}");
        let mut req = self.http.get(&url);
        for (name, value) in headers {
            req = req.header(*name, value);
        }
        let resp = self
            .apply_auth(req)
            .send()
            .await
            .map_err(|e| Self::transport_error(&format!("GET {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.text()
            .await
            .map_err(|e| RspamdError::parse(format!("body: {e}")))
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> RspamdResult<T> {
        let url = self.url(path);
        debug!("RSPAMD POST {url}");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| Self::transport_error(&format!("POST {url}"), e))?;
        self.handle_response(resp).await
    }

    pub async fn post_raw(&self, path: &str, body: &str) -> RspamdResult<String> {
        let url = self.url(path);
        debug!("RSPAMD POST (raw) {url}");
        let resp = self
            .apply_auth(
                self.http
                    .post(&url)
                    .header("Content-Type", "text/plain")
                    .body(body.to_string()),
            )
            .send()
            .await
            .map_err(|e| Self::transport_error(&format!("POST {url}"), e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.text()
            .await
            .map_err(|e| RspamdError::parse(format!("body: {e}")))
    }

    pub async fn post_body<T: DeserializeOwned>(&self, path: &str, body: &str) -> RspamdResult<T> {
        let url = self.url(path);
        debug!("RSPAMD POST (body) {url}");
        let resp = self
            .apply_auth(
                self.http
                    .post(&url)
                    .header("Content-Type", "text/plain")
                    .body(body.to_string()),
            )
            .send()
            .await
            .map_err(|e| Self::transport_error(&format!("POST {url}"), e))?;
        self.handle_response(resp).await
    }

    pub async fn post_body_with_headers(
        &self,
        path: &str,
        body: &str,
        headers: &[(&'static str, String)],
    ) -> RspamdResult<()> {
        let url = self.url(path);
        debug!("RSPAMD POST (body with endpoint headers) {url}");
        let mut req = self
            .http
            .post(&url)
            .header("Content-Type", "text/plain")
            .body(body.to_string());
        for (name, value) in headers {
            req = req.header(*name, value);
        }
        let resp = self
            .apply_auth(req)
            .send()
            .await
            .map_err(|e| Self::transport_error(&format!("POST {url}"), e))?;
        self.handle_mutation_response(resp).await
    }

    pub async fn post_no_body(&self, path: &str) -> RspamdResult<()> {
        let url = self.url(path);
        debug!("RSPAMD POST (no body) {url}");
        let resp = self
            .apply_auth(self.http.post(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error(&format!("POST {url}"), e))?;
        self.handle_mutation_response(resp).await
    }

    pub async fn get_no_body(&self, path: &str) -> RspamdResult<()> {
        let url = self.url(path);
        debug!("RSPAMD GET (no body expected) {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error(&format!("GET {url}"), e))?;
        self.handle_mutation_response(resp).await
    }

    pub async fn delete(&self, path: &str) -> RspamdResult<()> {
        let url = self.url(path);
        debug!("RSPAMD DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error(&format!("DELETE {url}"), e))?;
        self.handle_mutation_response(resp).await
    }

    // ── Rspamd-specific endpoints ────────────────────────────────────

    /// GET /stat — verify authenticated controller access and gather summary
    pub async fn ping(&self) -> RspamdResult<RspamdConnectionSummary> {
        let url = self.url("/stat");
        debug!("RSPAMD GET /stat (ping)");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error("GET /stat", e))?;
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| Self::transport_error("read /stat response body", e))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        let raw: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| RspamdError::parse(format!("json: {e}")))?;
        if let Some(message) = Self::application_failure(&raw) {
            return Err(RspamdError::api(format!(
                "Rspamd statistics request failed: {message}"
            )));
        }
        let object = raw
            .as_object()
            .ok_or_else(|| RspamdError::parse("Rspamd /stat response must be a JSON object"))?;
        let version = object
            .get("version")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                RspamdError::parse("Rspamd /stat response is missing the required version field")
            })?
            .to_string();
        let uptime_secs = object
            .get("uptime")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| {
                RspamdError::parse("Rspamd /stat response is missing the required uptime field")
            })?;
        let scanned = object
            .get("scanned")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| {
                RspamdError::parse("Rspamd /stat response is missing the required scanned field")
            })?;
        Ok(RspamdConnectionSummary {
            host: self.config.base_url.clone(),
            version: Some(version),
            config_id: raw
                .get("config_id")
                .and_then(|v| v.as_str())
                .map(String::from),
            uptime_secs: Some(uptime_secs),
            scanned: Some(scanned),
        })
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> RspamdResult<T> {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| Self::transport_error("read response body", e))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        let raw: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| RspamdError::parse(format!("json: {e}\nBody: {body_text}")))?;
        if let Some(message) = Self::application_failure(&raw) {
            return Err(RspamdError::api(format!(
                "Rspamd API operation failed: {message}"
            )));
        }
        serde_json::from_value(raw)
            .map_err(|e| RspamdError::parse(format!("response schema: {e}\nBody: {body_text}")))
    }

    async fn handle_mutation_response(&self, resp: reqwest::Response) -> RspamdResult<()> {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| Self::transport_error("read mutation response body", e))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        if body_text.trim().is_empty() {
            return Ok(());
        }
        if let Ok(raw) = serde_json::from_str::<serde_json::Value>(&body_text) {
            if let Some(message) = Self::application_failure(&raw) {
                return Err(RspamdError::api(format!(
                    "Rspamd API mutation failed: {message}"
                )));
            }
        }
        Ok(())
    }

    fn application_failure(raw: &serde_json::Value) -> Option<String> {
        let object = raw.as_object()?;
        let failed = object.get("success").and_then(|value| value.as_bool()) == Some(false)
            || object.get("ok").and_then(|value| value.as_bool()) == Some(false);
        let explicit_error = object.get("error").filter(|value| match value {
            serde_json::Value::Null | serde_json::Value::Bool(false) => false,
            serde_json::Value::String(message) => !message.trim().is_empty(),
            _ => true,
        });
        if !failed && explicit_error.is_none() {
            return None;
        }
        Some(
            ["error", "message", "detail"]
                .iter()
                .find_map(|key| object.get(*key))
                .map(|value| {
                    value
                        .as_str()
                        .map(String::from)
                        .unwrap_or_else(|| value.to_string())
                })
                .unwrap_or_else(|| "the server reported success=false".to_string()),
        )
    }

    fn validate_base_url(base_url: &str) -> RspamdResult<String> {
        let normalized = base_url.trim().trim_end_matches('/');
        if normalized.is_empty() {
            return Err(RspamdError::connection(
                "Rspamd controller base URL cannot be empty",
            ));
        }
        let parsed = reqwest::Url::parse(normalized).map_err(|error| {
            RspamdError::connection(format!("invalid Rspamd controller base URL: {error}"))
        })?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(RspamdError::connection(format!(
                "unsupported Rspamd controller URL scheme '{}'; expected http or https",
                parsed.scheme()
            )));
        }
        if parsed.query().is_some() || parsed.fragment().is_some() {
            return Err(RspamdError::connection(
                "Rspamd controller base URL cannot contain a query string or fragment",
            ));
        }
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(RspamdError::connection(
                "Rspamd controller base URL cannot contain embedded credentials",
            ));
        }
        Ok(normalized.to_string())
    }

    fn transport_error(operation: &str, error: reqwest::Error) -> RspamdError {
        if error.is_timeout() {
            RspamdError::new(
                RspamdErrorKind::Timeout,
                format!("{operation} timed out: {error}"),
            )
        } else {
            RspamdError::connection(format!("{operation}: {error}"))
        }
    }

    fn map_status_error(&self, status: u16, body: &str) -> RspamdError {
        let kind = match status {
            401 => RspamdErrorKind::AuthenticationFailed,
            403 => RspamdErrorKind::Forbidden,
            404 => RspamdErrorKind::NotFound,
            408 | 504 => RspamdErrorKind::Timeout,
            500..=599 => RspamdErrorKind::InternalError,
            _ => RspamdErrorKind::ApiError,
        };
        RspamdError {
            kind,
            message: format!("HTTP {status}: {body}"),
        }
    }
}
