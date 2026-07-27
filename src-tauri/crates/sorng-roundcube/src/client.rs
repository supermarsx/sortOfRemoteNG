// ── sorng-roundcube – REST API client ─────────────────────────────────────────
//! HTTP client wrapping a custom Roundcube admin/JSON API.

use crate::error::{RoundcubeError, RoundcubeErrorKind, RoundcubeResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

const DEFAULT_TIMEOUT_SECS: u64 = 30;

pub struct RoundcubeClient {
    pub config: RoundcubeConnectionConfig,
    http: HttpClient,
    token: tokio::sync::RwLock<Option<String>>,
}

impl RoundcubeClient {
    pub fn new(mut config: RoundcubeConnectionConfig) -> RoundcubeResult<Self> {
        config.base_url = Self::validate_base_url(&config.base_url)?;
        let timeout_secs = config.timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS);
        if timeout_secs == 0 {
            return Err(RoundcubeError::connection(
                "request timeout must be greater than zero seconds",
            ));
        }

        let http = HttpClient::builder()
            .timeout(Duration::from_secs(timeout_secs))
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
            .map_err(|e| Self::transport_error(&format!("POST {url}"), e))?;
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| Self::transport_error("read login response body", e))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        let raw: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| RoundcubeError::parse(format!("json: {e}")))?;
        if let Some(message) = Self::application_failure(&raw) {
            return Err(RoundcubeError::new(
                RoundcubeErrorKind::AuthenticationFailed,
                format!("Roundcube login rejected: {message}"),
            ));
        }
        let session_token = raw
            .get("token")
            .and_then(|v| v.as_str())
            .filter(|token| !token.trim().is_empty())
            .map(String::from)
            .ok_or_else(|| {
                RoundcubeError::new(
                    RoundcubeErrorKind::AuthenticationFailed,
                    "Roundcube login response did not contain a non-empty token",
                )
            })?;
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
            .map_err(|e| Self::transport_error(&format!("GET {url}"), e))?;
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
            .map_err(|e| Self::transport_error(&format!("GET {url}"), e))?;
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
            .map_err(|e| Self::transport_error(&format!("POST {url}"), e))?;
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
            .map_err(|e| Self::transport_error(&format!("POST {url}"), e))?;
        self.handle_mutation_response(resp).await
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
            .map_err(|e| Self::transport_error(&format!("PUT {url}"), e))?;
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
            .map_err(|e| Self::transport_error(&format!("PUT {url}"), e))?;
        self.handle_mutation_response(resp).await
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
            .map_err(|e| Self::transport_error(&format!("DELETE {url}"), e))?;
        self.handle_mutation_response(resp).await
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
            .map_err(|e| Self::transport_error("GET /system/info", e))?;
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| Self::transport_error("read /system/info response body", e))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        let raw: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| RoundcubeError::parse(format!("json: {e}")))?;
        if let Some(message) = Self::application_failure(&raw) {
            return Err(RoundcubeError::api(format!(
                "Roundcube system information request failed: {message}"
            )));
        }
        let object = raw.as_object().ok_or_else(|| {
            RoundcubeError::parse("Roundcube /system/info response must be a JSON object")
        })?;
        let version = object
            .get("version")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                RoundcubeError::parse(
                    "Roundcube /system/info response is missing the required version field",
                )
            })?
            .to_string();
        Ok(RoundcubeConnectionSummary {
            host: self.config.base_url.clone(),
            version: Some(version),
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
            .map_err(|e| Self::transport_error("read response body", e))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        let raw: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| RoundcubeError::parse(format!("json: {e}\nBody: {body_text}")))?;
        if let Some(message) = Self::application_failure(&raw) {
            return Err(RoundcubeError::api(format!(
                "Roundcube API operation failed: {message}"
            )));
        }
        serde_json::from_value(raw)
            .map_err(|e| RoundcubeError::parse(format!("response schema: {e}\nBody: {body_text}")))
    }

    async fn handle_mutation_response(&self, resp: reqwest::Response) -> RoundcubeResult<()> {
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
                return Err(RoundcubeError::api(format!(
                    "Roundcube API mutation failed: {message}"
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

    fn validate_base_url(base_url: &str) -> RoundcubeResult<String> {
        let normalized = base_url.trim().trim_end_matches('/');
        if normalized.is_empty() {
            return Err(RoundcubeError::connection(
                "Roundcube API base URL cannot be empty",
            ));
        }
        let parsed = reqwest::Url::parse(normalized).map_err(|error| {
            RoundcubeError::connection(format!("invalid Roundcube API base URL: {error}"))
        })?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(RoundcubeError::connection(format!(
                "unsupported Roundcube API URL scheme '{}'; expected http or https",
                parsed.scheme()
            )));
        }
        if parsed.query().is_some() || parsed.fragment().is_some() {
            return Err(RoundcubeError::connection(
                "Roundcube API base URL cannot contain a query string or fragment",
            ));
        }
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(RoundcubeError::connection(
                "Roundcube API base URL cannot contain embedded credentials",
            ));
        }
        Ok(normalized.to_string())
    }

    fn transport_error(operation: &str, error: reqwest::Error) -> RoundcubeError {
        if error.is_timeout() {
            RoundcubeError::timeout(format!("{operation} timed out: {error}"))
        } else {
            RoundcubeError::connection(format!("{operation}: {error}"))
        }
    }

    fn map_status_error(&self, status: u16, body: &str) -> RoundcubeError {
        let kind = match status {
            401 => RoundcubeErrorKind::AuthenticationFailed,
            403 => RoundcubeErrorKind::Forbidden,
            404 => RoundcubeErrorKind::NotFound,
            408 | 504 => RoundcubeErrorKind::Timeout,
            500..=599 => RoundcubeErrorKind::InternalError,
            _ => RoundcubeErrorKind::ApiError,
        };
        RoundcubeError {
            kind,
            message: format!("HTTP {status}: {body}"),
        }
    }
}
