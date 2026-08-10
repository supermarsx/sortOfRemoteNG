// ── sorng-jira/src/client.rs ───────────────────────────────────────────────────
use reqwest::{header, Client, Response, StatusCode};
use serde::de::DeserializeOwned;

use crate::error::{JiraError, JiraErrorKind, JiraResult};
use crate::types::{JiraAuthMethod, JiraConnectionConfig};

const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;

/// Low-level Jira HTTP client.
#[derive(Debug, Clone)]
pub struct JiraClient {
    pub(crate) http: Client,
    pub(crate) base_url: String,
    pub(crate) api_version: String,
    pub(crate) auth_header: header::HeaderValue,
}

#[allow(dead_code)]
impl JiraClient {
    pub fn from_config(cfg: &JiraConnectionConfig) -> JiraResult<Self> {
        let effective_tls_skip = cfg.skip_tls_verify
            && cfg
                .host
                .trim()
                .get(..8)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"));
        if effective_tls_skip != cfg.acknowledge_invalid_cert_risk {
            return Err(JiraError::validation(
                "TLS certificate verification bypass requires an explicit runtime acknowledgement for this connection attempt",
            ));
        }

        let mut builder = Client::builder()
            .danger_accept_invalid_certs(effective_tls_skip)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(cfg.timeout_seconds));
        if let Some(proxy_url) = cfg
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url).map_err(|_| {
                JiraError::new(
                    JiraErrorKind::ConnectionFailed,
                    "Invalid proxy configuration",
                )
            })?;
            builder = builder.proxy(proxy);
        }
        let http = builder.build().map_err(|_| {
            JiraError::new(
                JiraErrorKind::ConnectionFailed,
                "Failed to build Jira HTTP client",
            )
        })?;

        let base = cfg.host.trim_end_matches('/').to_string();

        let auth_header = match &cfg.auth {
            JiraAuthMethod::Basic { username, password } => {
                let encoded = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    format!("{}:{}", username, password),
                );
                format!("Basic {}", encoded)
            }
            JiraAuthMethod::ApiToken { email, token } => {
                let encoded = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    format!("{}:{}", email, token),
                );
                format!("Basic {}", encoded)
            }
            JiraAuthMethod::Bearer { token } => format!("Bearer {}", token),
            JiraAuthMethod::Pat { token } => format!("Bearer {}", token),
        };
        let mut auth_header = header::HeaderValue::from_str(&auth_header)
            .map_err(|_| JiraError::validation("Invalid authorization credentials"))?;
        auth_header.set_sensitive(true);

        Ok(Self {
            http,
            base_url: base,
            api_version: cfg.api_version.clone(),
            auth_header,
        })
    }

    fn default_headers(&self) -> header::HeaderMap {
        let mut h = header::HeaderMap::new();
        h.insert(header::AUTHORIZATION, self.auth_header.clone());
        h.insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );
        h.insert(
            header::ACCEPT,
            header::HeaderValue::from_static("application/json"),
        );
        h
    }

    fn validated_request_url(&self, url: &str) -> JiraResult<reqwest::Url> {
        let base = reqwest::Url::parse(&self.base_url)
            .map_err(|_| JiraError::validation("Invalid Jira base URL"))?;
        let request = reqwest::Url::parse(url)
            .map_err(|_| JiraError::validation("Invalid Jira request URL"))?;

        let same_origin = request.scheme() == base.scheme()
            && request.host_str() == base.host_str()
            && request.port_or_known_default() == base.port_or_known_default();
        if !same_origin {
            return Err(JiraError::validation(
                "Jira request URL must use the configured origin",
            ));
        }
        Ok(request)
    }

    /// REST API v2/v3 endpoint.
    pub(crate) fn api_url(&self, path: &str) -> String {
        format!("{}/rest/api/{}{}", self.base_url, self.api_version, path)
    }

    /// Agile API endpoint.
    pub(crate) fn agile_url(&self, path: &str) -> String {
        format!("{}/rest/agile/1.0{}", self.base_url, path)
    }

    pub(crate) async fn get<T: DeserializeOwned>(&self, url: &str) -> JiraResult<T> {
        let url = self.validated_request_url(url)?;
        let resp = self
            .http
            .get(url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| Self::transport_error("GET request", &e))?;
        self.handle_response(resp).await
    }

    pub(crate) async fn get_with_params<T: DeserializeOwned>(
        &self,
        url: &str,
        params: &[(String, String)],
    ) -> JiraResult<T> {
        let url = self.validated_request_url(url)?;
        let resp = self
            .http
            .get(url)
            .headers(self.default_headers())
            .query(params)
            .send()
            .await
            .map_err(|e| Self::transport_error("GET request", &e))?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post<T: DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> JiraResult<T> {
        let url = self.validated_request_url(url)?;
        let resp = self
            .http
            .post(url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await
            .map_err(|e| Self::transport_error("POST request", &e))?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post_empty(&self, url: &str) -> JiraResult<()> {
        let url = self.validated_request_url(url)?;
        let resp = self
            .http
            .post(url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| Self::transport_error("POST request", &e))?;
        self.handle_empty(resp).await
    }

    pub(crate) async fn post_unit<B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> JiraResult<()> {
        let url = self.validated_request_url(url)?;
        let resp = self
            .http
            .post(url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await
            .map_err(|e| Self::transport_error("POST request", &e))?;
        self.handle_empty(resp).await
    }

    pub(crate) async fn put<T: DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> JiraResult<T> {
        let url = self.validated_request_url(url)?;
        let resp = self
            .http
            .put(url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await
            .map_err(|e| Self::transport_error("PUT request", &e))?;
        self.handle_response(resp).await
    }

    pub(crate) async fn put_unit<B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> JiraResult<()> {
        let url = self.validated_request_url(url)?;
        let resp = self
            .http
            .put(url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await
            .map_err(|e| Self::transport_error("PUT request", &e))?;
        self.handle_empty(resp).await
    }

    pub(crate) async fn delete(&self, url: &str) -> JiraResult<()> {
        let url = self.validated_request_url(url)?;
        let resp = self
            .http
            .delete(url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| Self::transport_error("DELETE request", &e))?;
        self.handle_empty(resp).await
    }

    async fn handle_response<T: DeserializeOwned>(&self, resp: Response) -> JiraResult<T> {
        let status = resp.status();
        if status.is_success() {
            let body = Self::read_bounded_body(resp).await?;
            serde_json::from_slice(&body).map_err(|e| {
                JiraError::new(
                    JiraErrorKind::ParseError,
                    format!(
                        "Invalid JSON response at line {}, column {}",
                        e.line(),
                        e.column()
                    ),
                )
            })
        } else {
            Err(self.status_error(status))
        }
    }

    async fn handle_empty(&self, resp: Response) -> JiraResult<()> {
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(self.status_error(status))
        }
    }

    fn status_error(&self, status: StatusCode) -> JiraError {
        let kind = match status.as_u16() {
            401 => JiraErrorKind::AuthError,
            403 => JiraErrorKind::Forbidden,
            404 => JiraErrorKind::NotFound,
            409 => JiraErrorKind::Conflict,
            429 => JiraErrorKind::RateLimited,
            _ => JiraErrorKind::ApiError(status.as_u16()),
        };
        JiraError::new(kind, format!("Jira API returned HTTP {}", status.as_u16()))
    }

    fn transport_error(operation: &str, error: &reqwest::Error) -> JiraError {
        let reason = if error.is_timeout() {
            "timed out"
        } else if error.is_connect() {
            "connection failed"
        } else {
            "transport failed"
        };
        JiraError::new(
            JiraErrorKind::ConnectionFailed,
            format!("{operation}: {reason}"),
        )
    }

    async fn read_bounded_body(mut response: Response) -> JiraResult<Vec<u8>> {
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
        {
            return Err(JiraError::new(
                JiraErrorKind::ParseError,
                format!("Response body exceeds {MAX_RESPONSE_BODY_BYTES} byte limit"),
            ));
        }

        let capacity = response
            .content_length()
            .unwrap_or(0)
            .min(MAX_RESPONSE_BODY_BYTES as u64) as usize;
        let mut body = Vec::with_capacity(capacity);
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| Self::transport_error("Response body", &e))?
        {
            let remaining = (MAX_RESPONSE_BODY_BYTES + 1).saturating_sub(body.len());
            body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            if body.len() > MAX_RESPONSE_BODY_BYTES {
                return Err(JiraError::new(
                    JiraErrorKind::ParseError,
                    format!("Response body exceeds {MAX_RESPONSE_BODY_BYTES} byte limit"),
                ));
            }
        }
        Ok(body)
    }

    pub async fn ping(&self) -> JiraResult<crate::types::JiraConnectionStatus> {
        let url = format!("{}/rest/api/{}/serverInfo", self.base_url, self.api_version);
        let url = self.validated_request_url(&url)?;
        let resp = self
            .http
            .get(url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| Self::transport_error("Ping request", &e))?;
        let body: serde_json::Value = self.handle_response(resp).await?;
        Ok(crate::types::JiraConnectionStatus {
            connected: true,
            server_title: body
                .get("serverTitle")
                .and_then(|v| v.as_str())
                .map(String::from),
            version: body
                .get("version")
                .and_then(|v| v.as_str())
                .map(String::from),
            deployment_type: body
                .get("deploymentType")
                .and_then(|v| v.as_str())
                .map(String::from),
            message: Some("Connected".into()),
        })
    }
}
