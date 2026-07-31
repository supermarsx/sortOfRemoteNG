// ── sorng-cicd – REST API client ─────────────────────────────────────────────
//! HTTP client wrapping CI/CD provider APIs.

use crate::error::{CicdError, CicdErrorKind, CicdResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;

pub struct CicdClient {
    pub config: CicdConnectionConfig,
    http: HttpClient,
}

impl CicdClient {
    pub fn new(config: CicdConnectionConfig) -> CicdResult<Self> {
        if config.tls_skip_verify.unwrap_or(false) {
            return Err(CicdError::connection(
                "TLS certificate verification cannot be disabled: tls_skip_verify=true requires an explicit runtime acknowledgement contract",
            ));
        }
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| CicdError::connection("failed to build HTTP client"))?;
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
        debug!("CICD GET");
        let resp = self
            .apply_auth(self.http.get(&url))
            .send()
            .await
            .map_err(|e| Self::transport_error("GET request", &e))?;
        self.handle_response(resp).await
    }

    pub async fn get_raw(&self, path: &str) -> CicdResult<String> {
        let url = self.url(path);
        debug!("CICD GET (raw)");
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

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> CicdResult<T> {
        let url = self.url(path);
        debug!("CICD POST");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| Self::transport_error("POST request", &e))?;
        self.handle_response(resp).await
    }

    pub async fn post_empty(&self, path: &str) -> CicdResult<()> {
        let url = self.url(path);
        debug!("CICD POST (empty)");
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

    pub async fn post_empty_with_body<B: Serialize>(&self, path: &str, body: &B) -> CicdResult<()> {
        let url = self.url(path);
        debug!("CICD POST (no response)");
        let resp = self
            .apply_auth(self.http.post(&url).json(body))
            .send()
            .await
            .map_err(|e| Self::transport_error("POST request", &e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        Ok(())
    }

    pub async fn put<B: Serialize>(&self, path: &str, body: &B) -> CicdResult<()> {
        let url = self.url(path);
        debug!("CICD PUT");
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

    pub async fn delete(&self, path: &str) -> CicdResult<()> {
        let url = self.url(path);
        debug!("CICD DELETE");
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

    fn transport_error(operation: &str, error: &reqwest::Error) -> CicdError {
        let reason = if error.is_timeout() {
            "timed out"
        } else if error.is_connect() {
            "connection failed"
        } else {
            "transport failed"
        };
        CicdError::connection(format!("{operation}: {reason}"))
    }

    async fn read_bounded_body(mut resp: reqwest::Response) -> CicdResult<Vec<u8>> {
        if resp
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
        {
            return Err(CicdError::parse(format!(
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
                return Err(CicdError::parse(format!(
                    "response body exceeds {MAX_RESPONSE_BODY_BYTES} byte limit"
                )));
            }
        }
        Ok(body)
    }

    async fn handle_response<T: DeserializeOwned>(&self, resp: reqwest::Response) -> CicdResult<T> {
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        let body = Self::read_bounded_body(resp).await?;
        serde_json::from_slice(&body).map_err(|e| {
            CicdError::parse(format!(
                "invalid JSON response at line {}, column {}",
                e.line(),
                e.column()
            ))
        })
    }

    fn map_status_error(&self, status: u16) -> CicdError {
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
            message: format!("HTTP {status}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insecure_config() -> CicdConnectionConfig {
        CicdConnectionConfig {
            provider: CicdProvider::Jenkins,
            base_url: "https://ci.example.test".to_string(),
            api_token: None,
            username: None,
            password: None,
            tls_skip_verify: Some(true),
            timeout_secs: Some(5),
            org: None,
            repo: None,
        }
    }

    #[test]
    fn rejects_tls_skip_verify_without_runtime_acknowledgement() {
        let error = match CicdClient::new(insecure_config()) {
            Ok(_) => panic!("insecure TLS configuration must be rejected"),
            Err(error) => error,
        };
        assert_eq!(
            error.message,
            "TLS certificate verification cannot be disabled: tls_skip_verify=true requires an explicit runtime acknowledgement contract"
        );
    }

    #[test]
    fn accepts_verified_tls_configuration() {
        let mut cfg = insecure_config();
        cfg.tls_skip_verify = Some(false);
        let _ = CicdClient::new(cfg).expect("client builds");
    }
}
