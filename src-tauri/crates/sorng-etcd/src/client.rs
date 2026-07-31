// ── sorng-etcd/src/client.rs ─────────────────────────────────────────────────
//! HTTP client wrapping the etcd v3 gRPC-gateway REST API.

use crate::error::{EtcdError, EtcdResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;

/// HTTP client for a single etcd cluster connection.
pub struct EtcdClient {
    pub config: EtcdConnectionConfig,
    base_url: String,
    http: HttpClient,
    auth_token: Option<String>,
}

impl EtcdClient {
    /// Build a new client from config and optionally authenticate.
    pub async fn new(config: EtcdConnectionConfig) -> EtcdResult<Self> {
        if config.tls_skip_verify.unwrap_or(false) {
            return Err(EtcdError::connection(
                "TLS certificate verification cannot be disabled: tls_skip_verify=true requires an explicit runtime acknowledgement contract",
            ));
        }
        let scheme = if config.tls { "https" } else { "http" };
        let base_url = format!("{}://{}:{}", scheme, config.host, config.port);

        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| EtcdError::connection("failed to build HTTP client"))?;

        let mut client = Self {
            auth_token: config.auth_token.clone(),
            config,
            base_url,
            http,
        };

        // If username/password provided but no token, authenticate.
        if client.auth_token.is_none() {
            if let (Some(ref user), Some(ref pass)) =
                (&client.config.username, &client.config.password)
            {
                let token = client.authenticate(user, pass).await?;
                client.auth_token = Some(token);
            }
        }

        Ok(client)
    }

    // ── URL helpers ──────────────────────────────────────────────────

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    // ── Auth ─────────────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref token) = self.auth_token {
            req.header("Authorization", token.as_str())
        } else {
            req
        }
    }

    async fn authenticate(&self, name: &str, password: &str) -> EtcdResult<String> {
        let body = serde_json::json!({
            "name": name,
            "password": password,
        });
        let url = self.url("/v3/auth/authenticate");
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| Self::transport_error("authentication request", &e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(EtcdError::auth(format!(
                "authentication failed with HTTP {}",
                status.as_u16()
            )));
        }
        let response_body = Self::read_bounded_body(resp).await?;
        let val: serde_json::Value = serde_json::from_slice(&response_body).map_err(|e| {
            EtcdError::internal(format!(
                "invalid authentication JSON response at line {}, column {}",
                e.line(),
                e.column()
            ))
        })?;
        val["token"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| EtcdError::auth("No token in auth response"))
    }

    // ── Typed REST helpers ───────────────────────────────────────────

    pub async fn post_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> EtcdResult<T> {
        let url = self.url(path);
        debug!("ETCD POST");
        let resp = self
            .apply_auth(self.http.post(&url))
            .json(body)
            .send()
            .await
            .map_err(|e| Self::transport_error("POST request", &e))?;
        self.handle_response(resp).await
    }

    pub async fn post_empty<T: DeserializeOwned>(&self, path: &str) -> EtcdResult<T> {
        let url = self.url(path);
        debug!("ETCD POST");
        let resp = self
            .apply_auth(self.http.post(&url))
            .json(&serde_json::json!({}))
            .send()
            .await
            .map_err(|e| Self::transport_error("POST request", &e))?;
        self.handle_response(resp).await
    }

    fn transport_error(operation: &str, error: &reqwest::Error) -> EtcdError {
        if error.is_timeout() {
            EtcdError::timeout(format!("{operation}: timed out"))
        } else {
            let reason = if error.is_connect() {
                "connection failed"
            } else {
                "transport failed"
            };
            EtcdError::connection(format!("{operation}: {reason}"))
        }
    }

    async fn read_bounded_body(mut resp: reqwest::Response) -> EtcdResult<Vec<u8>> {
        if resp
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
        {
            return Err(EtcdError::internal(format!(
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
                return Err(EtcdError::internal(format!(
                    "response body exceeds {MAX_RESPONSE_BODY_BYTES} byte limit"
                )));
            }
        }
        Ok(body)
    }

    async fn handle_response<T: DeserializeOwned>(&self, resp: reqwest::Response) -> EtcdResult<T> {
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_http_error(status.as_u16()));
        }
        let body = Self::read_bounded_body(resp).await?;
        serde_json::from_slice(&body).map_err(|e| {
            EtcdError::internal(format!(
                "invalid JSON response at line {}, column {}",
                e.line(),
                e.column()
            ))
        })
    }

    fn map_http_error(&self, status: u16) -> EtcdError {
        match status {
            401 => EtcdError::auth("Unauthorized"),
            403 => EtcdError::permission_denied("Forbidden"),
            408 => EtcdError::timeout("Request timeout"),
            413 => EtcdError::new(
                crate::error::EtcdErrorKind::RequestTooLarge,
                "Request too large",
            ),
            429 => EtcdError::new(
                crate::error::EtcdErrorKind::TooManyRequests,
                "Rate limited",
            ),
            503 => EtcdError::cluster_unavailable("Cluster unavailable"),
            _ => EtcdError::internal(format!("HTTP {status}")),
        }
    }

    // ── Status / ping ────────────────────────────────────────────────

    pub async fn get_status(&self) -> EtcdResult<EtcdStatusResponse> {
        self.post_empty("/v3/maintenance/status").await
    }

    pub async fn get_connection_summary(&self, id: &str) -> EtcdResult<EtcdConnectionSummary> {
        let status: EtcdStatusResponse = self.get_status().await?;
        Ok(EtcdConnectionSummary {
            id: id.to_string(),
            endpoints: self
                .config
                .endpoints
                .clone()
                .unwrap_or_else(|| vec![format!("{}:{}", self.config.host, self.config.port)]),
            version: status.version,
            leader_id: status.leader,
            cluster_id: 0,
            connected_at: chrono::Utc::now().to_rfc3339(),
        })
    }
}
