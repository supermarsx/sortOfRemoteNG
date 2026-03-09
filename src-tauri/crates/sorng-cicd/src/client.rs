// ── sorng-cicd – REST API client ─────────────────────────────────────────────
//! HTTP client wrapping CI/CD provider APIs.

use crate::error::{CicdError, CicdErrorKind, CicdResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

pub struct CicdClient {
    pub config: CicdConnectionConfig,
    http: HttpClient,
}

impl CicdClient {
    pub fn new(config: CicdConnectionConfig) -> CicdResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(config.tls_skip_verify.unwrap_or(false))
            .build()
            .map_err(|e| CicdError::connection(format!("http client build: {e}")))?;
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
        match self.config.provider {
            CicdProvider::GitHubActions => {
                if let Some(ref token) = self.config.api_token {
                    req.header("Authorization", format!("Bearer {token}"))
                        .header("Accept", "application/vnd.github+json")
                        .header("X-GitHub-Api-Version", "2022-11-28")
                } else {
                    req
                }
            }
            CicdProvider::Drone => {
                if let Some(ref token) = self.config.api_token {
                    req.header("Authorization", format!("Bearer {token}"))
                } else {
                    req
                }
            }
            CicdProvider::Jenkins => {
                if let (Some(ref u), Some(ref t)) = (&self.config.username, &self.config.api_token)
                {
                    req.basic_auth(u, Some(t))
                } else if let (Some(ref u), Some(ref p)) =
                    (&self.config.username, &self.config.password)
                {
                    req.basic_auth(u, Some(p))
                } else {
                    req
                }
            }
        }
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> CicdResult<T> {
        let url = self.url(path);
        debug!("CICD GET {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| CicdError::connection(format!("GET {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn get_raw(&self, path: &str) -> CicdResult<String> {
        let url = self.url(path);
        debug!("CICD GET (raw) {url}");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| CicdError::connection(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.text()
            .await
            .map_err(|e| CicdError::parse(format!("body: {e}")))
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> CicdResult<T> {
        let url = self.url(path);
        debug!("CICD POST {url}");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| CicdError::connection(format!("POST {url}: {e}")))?;
        self.handle_response(resp).await
    }

    pub async fn post_empty(&self, path: &str) -> CicdResult<()> {
        let url = self.url(path);
        debug!("CICD POST (empty) {url}");
        let resp = self
            .apply_auth(self.http.post(&url))
            .send()
            .await
            .map_err(|e| CicdError::connection(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn post_empty_with_body<B: Serialize>(&self, path: &str, body: &B) -> CicdResult<()> {
        let url = self.url(path);
        debug!("CICD POST (no response) {url}");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| CicdError::connection(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn put<B: Serialize>(&self, path: &str, body: &B) -> CicdResult<()> {
        let url = self.url(path);
        debug!("CICD PUT {url}");
        let resp = self
            .apply_auth(
                self.http
                    .put(&url)
                    .header("Content-Type", "application/json")
                    .json(body),
            )
            .send()
            .await
            .map_err(|e| CicdError::connection(format!("PUT {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> CicdResult<()> {
        let url = self.url(path);
        debug!("CICD DELETE {url}");
        let resp = self
            .apply_auth(self.http.delete(&url))
            .send()
            .await
            .map_err(|e| CicdError::connection(format!("DELETE {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        Ok(())
    }

    // ── Ping ─────────────────────────────────────────────────────────

    pub async fn ping(&self) -> CicdResult<CicdConnectionSummary> {
        match self.config.provider {
            CicdProvider::Drone => {
                let _repos: Vec<DroneRepo> =
                    self.get("/api/user/repos?latest=true&per_page=1").await?;
                Ok(CicdConnectionSummary {
                    provider: CicdProvider::Drone,
                    base_url: self.config.base_url.clone(),
                    version: None,
                    user: None,
                })
            }
            CicdProvider::Jenkins => {
                let info: serde_json::Value = self.get("/api/json").await?;
                Ok(CicdConnectionSummary {
                    provider: CicdProvider::Jenkins,
                    base_url: self.config.base_url.clone(),
                    version: info
                        .get("hudson")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    user: None,
                })
            }
            CicdProvider::GitHubActions => {
                let user: serde_json::Value = self.get("/user").await?;
                Ok(CicdConnectionSummary {
                    provider: CicdProvider::GitHubActions,
                    base_url: self.config.base_url.clone(),
                    version: None,
                    user: user.get("login").and_then(|v| v.as_str()).map(String::from),
                })
            }
        }
    }

    // ── Response handling ────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(&self, resp: reqwest::Response) -> CicdResult<T> {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| CicdError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16(), &body_text));
        }
        serde_json::from_str(&body_text)
            .map_err(|e| CicdError::parse(format!("json: {e}\nBody: {body_text}")))
    }

    fn map_status_error(&self, status: u16, body: &str) -> CicdError {
        let kind = match status {
            401 => CicdErrorKind::AuthenticationFailed,
            403 => CicdErrorKind::PermissionDenied,
            404 => CicdErrorKind::BuildNotFound,
            429 => CicdErrorKind::RateLimited,
            408 => CicdErrorKind::Timeout,
            400 => CicdErrorKind::ProviderError,
            _ => CicdErrorKind::HttpError,
        };
        CicdError {
            kind,
            message: format!("HTTP {status}: {body}"),
        }
    }
}
