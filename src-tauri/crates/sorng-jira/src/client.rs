// ── sorng-jira/src/client.rs ───────────────────────────────────────────────────
use reqwest::{header, Client, Response, StatusCode};
use serde::de::DeserializeOwned;

use crate::error::{JiraError, JiraErrorKind, JiraResult};
use crate::types::{JiraAuthMethod, JiraConnectionConfig};

/// Low-level Jira HTTP client.
#[derive(Debug, Clone)]
pub struct JiraClient {
    pub(crate) http: Client,
    pub(crate) base_url: String,
    pub(crate) api_version: String,
    pub(crate) auth_header: String,
}

#[allow(dead_code)]
impl JiraClient {
    pub fn from_config(cfg: &JiraConnectionConfig) -> JiraResult<Self> {
        let http = Client::builder()
            .danger_accept_invalid_certs(cfg.skip_tls_verify)
            .timeout(std::time::Duration::from_secs(cfg.timeout_seconds))
            .build()
            .map_err(|e| JiraError::new(JiraErrorKind::ConnectionFailed, e.to_string()))?;

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

        Ok(Self {
            http,
            base_url: base,
            api_version: cfg.api_version.clone(),
            auth_header,
        })
    }

    fn default_headers(&self) -> header::HeaderMap {
        let mut h = header::HeaderMap::new();
        h.insert(
            header::AUTHORIZATION,
            header::HeaderValue::from_str(&self.auth_header)
                .unwrap_or_else(|_| header::HeaderValue::from_static("")),
        );
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

    /// REST API v2/v3 endpoint.
    pub(crate) fn api_url(&self, path: &str) -> String {
        format!("{}/rest/api/{}{}", self.base_url, self.api_version, path)
    }

    /// Agile API endpoint.
    pub(crate) fn agile_url(&self, path: &str) -> String {
        format!("{}/rest/agile/1.0{}", self.base_url, path)
    }

    pub(crate) async fn get<T: DeserializeOwned>(&self, url: &str) -> JiraResult<T> {
        let resp = self
            .http
            .get(url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn get_with_params<T: DeserializeOwned>(
        &self,
        url: &str,
        params: &[(String, String)],
    ) -> JiraResult<T> {
        let resp = self
            .http
            .get(url)
            .headers(self.default_headers())
            .query(params)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post<T: DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> JiraResult<T> {
        let resp = self
            .http
            .post(url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post_empty(&self, url: &str) -> JiraResult<()> {
        let resp = self
            .http
            .post(url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_empty(resp).await
    }

    pub(crate) async fn post_unit<B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> JiraResult<()> {
        let resp = self
            .http
            .post(url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_empty(resp).await
    }

    pub(crate) async fn put<T: DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> JiraResult<T> {
        let resp = self
            .http
            .put(url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn put_unit<B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> JiraResult<()> {
        let resp = self
            .http
            .put(url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_empty(resp).await
    }

    pub(crate) async fn delete(&self, url: &str) -> JiraResult<()> {
        let resp = self
            .http
            .delete(url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_empty(resp).await
    }

    async fn handle_response<T: DeserializeOwned>(&self, resp: Response) -> JiraResult<T> {
        let status = resp.status();
        if status.is_success() {
            let text = resp.text().await?;
            serde_json::from_str(&text).map_err(|e| {
                JiraError::new(
                    JiraErrorKind::ParseError,
                    format!("{}: {}", e, &text[..text.len().min(200)]),
                )
            })
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(self.status_error(status, body))
        }
    }

    async fn handle_empty(&self, resp: Response) -> JiraResult<()> {
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(self.status_error(status, body))
        }
    }

    fn status_error(&self, status: StatusCode, body: String) -> JiraError {
        let kind = match status.as_u16() {
            401 => JiraErrorKind::AuthError,
            403 => JiraErrorKind::Forbidden,
            404 => JiraErrorKind::NotFound,
            409 => JiraErrorKind::Conflict,
            429 => JiraErrorKind::RateLimited,
            _ => JiraErrorKind::ApiError(status.as_u16()),
        };
        JiraError::new(
            kind,
            format!("{}: {}", status, &body[..body.len().min(500)]),
        )
    }

    pub async fn ping(&self) -> JiraResult<crate::types::JiraConnectionStatus> {
        let url = format!("{}/rest/api/{}/serverInfo", self.base_url, self.api_version);
        match self
            .http
            .get(&url)
            .headers(self.default_headers())
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
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
            Ok(resp) => Ok(crate::types::JiraConnectionStatus {
                connected: false,
                server_title: None,
                version: None,
                deployment_type: None,
                message: Some(format!("HTTP {}", resp.status())),
            }),
            Err(e) => Ok(crate::types::JiraConnectionStatus {
                connected: false,
                server_title: None,
                version: None,
                deployment_type: None,
                message: Some(e.to_string()),
            }),
        }
    }
}
