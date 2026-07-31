//! HTTP client wrapping the Mailcow REST API.
//! Endpoint: `https://{host}/api/v1/`
//! Authentication via `X-API-Key` header.

use crate::error::{MailcowError, MailcowErrorKind, MailcowResult};
use crate::types::*;
use log::debug;
use reqwest::header::HeaderValue;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

/// Mailcow REST API client.
pub struct MailcowClient {
    pub config: MailcowConnectionConfig,
    http: HttpClient,
    api_key: HeaderValue,
}

impl MailcowClient {
    /// Build a new client from the supplied config.
    pub fn new(config: MailcowConnectionConfig) -> MailcowResult<Self> {
        if config.tls_skip_verify {
            return Err(MailcowError::connection(
                "TLS certificate verification cannot be disabled: tls_skip_verify=true requires an explicit runtime acknowledgement contract",
            ));
        }
        let mut builder = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .redirect(reqwest::redirect::Policy::none());
        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| MailcowError::connection(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|e| MailcowError::connection(format!("http client build: {e}")))?;
        let api_key = HeaderValue::from_str(&config.api_key)
            .map_err(|e| MailcowError::auth(format!("invalid API key: {e}")))?;
        Ok(Self {
            config,
            http,
            api_key,
        })
    }

    // ── URL helpers ──────────────────────────────────────────────────

    fn base_url(&self) -> &str {
        self.config.base_url.trim_end_matches('/')
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}/api/v1{}", self.base_url(), path)
    }

    // ── Auth ─────────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        req.header("X-API-Key", self.api_key.clone())
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> MailcowResult<T> {
        let url = self.api_url(path);
        debug!("MAILCOW GET {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| self.request_error("GET", &url, e))?;
        self.handle_response(resp).await
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> MailcowResult<T> {
        let url = self.api_url(path);
        debug!("MAILCOW POST {url}");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| self.request_error("POST", &url, e))?;
        self.handle_response(resp).await
    }

    pub async fn put<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> MailcowResult<T> {
        let url = self.api_url(path);
        debug!("MAILCOW PUT {url}");
        let resp = self
            .apply_auth(self.http.put(&url).json(body))
            .send()
            .await
            .map_err(|e| self.request_error("PUT", &url, e))?;
        self.handle_response(resp).await
    }

    pub async fn delete_req(&self, path: &str) -> MailcowResult<()> {
        let url = self.api_url(path);
        debug!("MAILCOW DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| self.request_error("DELETE", &url, e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn post_empty<T: DeserializeOwned>(&self, path: &str) -> MailcowResult<T> {
        let url = self.api_url(path);
        debug!("MAILCOW POST (empty) {url}");
        let resp = self
            .apply_auth(self.http.post(&url).json(&serde_json::json!({})))
            .send()
            .await
            .map_err(|e| self.request_error("POST", &url, e))?;
        self.handle_response(resp).await
    }

    pub async fn delete_body<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> MailcowResult<T> {
        let url = self.api_url(path);
        debug!("MAILCOW DELETE+body {url}");
        let resp = self
            .apply_auth(self.http.delete(&url).json(body))
            .send()
            .await
            .map_err(|e| self.request_error("DELETE", &url, e))?;
        self.handle_response(resp).await
    }

    // ── Ping ─────────────────────────────────────────────────────────

    /// Verify connectivity by fetching container status.
    pub async fn ping(&self) -> MailcowResult<MailcowConnectionSummary> {
        let containers: Vec<MailcowContainerStatus> = self.get("/get/status/containers").await?;
        let host = self.config.base_url.clone();
        let hostname = containers.first().map(|c| c.container.clone());
        Ok(MailcowConnectionSummary {
            host,
            version: None,
            hostname,
            containers_count: containers.len(),
        })
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> MailcowResult<T> {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| MailcowError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        if let Some(error) = self.application_error(&body_text) {
            return Err(error);
        }
        serde_json::from_str(&body_text)
            .map_err(|e| MailcowError::parse(format!("json: {e}\nBody: {body_text}")))
    }

    fn request_error(&self, method: &str, url: &str, error: reqwest::Error) -> MailcowError {
        let message = format!("{method} {url}: {error}");
        if error.is_timeout() {
            MailcowError::timeout(message)
        } else {
            MailcowError::connection(message)
        }
    }

    fn application_error(&self, body: &str) -> Option<MailcowError> {
        fn error_message(value: &serde_json::Value) -> Option<String> {
            let kind = value.get("type")?.as_str()?;
            if !matches!(kind.to_ascii_lowercase().as_str(), "danger" | "error") {
                return None;
            }
            let message = value
                .get("msg")
                .or_else(|| value.get("message"))
                .map(|value| match value {
                    serde_json::Value::String(message) => message.clone(),
                    other => other.to_string(),
                })
                .unwrap_or_else(|| "Mailcow API reported an application error".to_string());
            Some(message)
        }

        let value: serde_json::Value = serde_json::from_str(body).ok()?;
        let message = match &value {
            serde_json::Value::Array(items) => items.iter().find_map(error_message),
            serde_json::Value::Object(_) => error_message(&value),
            _ => None,
        }?;
        Some(MailcowError::api(message))
    }

    fn map_status_error(&self, status: u16, body: &str) -> MailcowError {
        let kind = match status {
            401 => MailcowErrorKind::AuthenticationFailed,
            403 => MailcowErrorKind::Forbidden,
            404 => MailcowErrorKind::NotFound,
            409 => MailcowErrorKind::DuplicateEntry,
            429 => MailcowErrorKind::QuotaExceeded,
            _ => MailcowErrorKind::ApiError,
        };
        MailcowError {
            kind,
            message: format!("HTTP {status}: {body}"),
        }
    }
}
